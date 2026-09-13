import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export const SYNC_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE_PATH = path.join(path.dirname(SYNC_DIRECTORY), 'SKYSECURE_AI_AGENT_ENGINEERING_AND_PRODUCTION_GUIDE.html');
export const REPOSITORY = 'skysecure-agent-factory/.github';
export const BRANCH = 'guide-live';
export const PUBLIC_URL = 'https://skysecure-agent-factory.github.io/.github/';
export const MIN_PUBLICATION_INTERVAL_MS = 390_000;
export const VERSION_MARKER = '<meta name="skysecure-guide-version" content="local">';
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const API_BASE = `https://api.github.com/repos/${REPOSITORY}`;
const EXPECTED_PATHS = ['.nojekyll', 'guide-version.json', 'index.html'];
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;

const MESSAGES = {
  'invalid-source': 'The master HTML must be complete, valid UTF-8, under 2 MB, and contain its guide title and version marker.',
  'source-unstable': 'Waiting for the editor to finish saving the master HTML.',
  'source-missing': 'The master HTML is unavailable. Waiting for the file to return.',
  'possible-credential': 'Possible credential found in the master HTML. Remove it before publishing.',
  'remote-conflict': 'The publishing branch changed independently. Inspect it before reconciling; no overwrite was attempted.',
  'remote-scope': 'The publishing branch must contain exactly index.html, .nojekyll, and guide-version.json.',
  'adoption-mismatch': 'The remote guide does not match the local master. Initial adoption requires matching content.',
  'authentication': 'GitHub authentication failed. Sign in with Git Credential Manager, then run --resume.',
  'forbidden': 'GitHub rejected the operation. Check repository permissions and publishing-branch rules, then run --resume.',
  'rate-limit': 'GitHub rate limited the request. The newest saved version will be retried.',
  'offline': 'The service is temporarily unavailable. The newest saved version will be retried.',
  'unexpected-response': 'The service returned an unexpected response. Publishing is blocked for inspection.',
  'state-invalid': 'Local sync state is invalid. Inspect it before restarting; no publication was attempted.',
  'local-storage': 'Local sync state could not be saved. Check this folder before restarting.',
  'already-running': 'A guide sync process is already listening on localhost port 47863.',
  'paused': 'Publication is paused. Run --resume to continue.',
};

export class SyncError extends Error {
  constructor(code, { retryable = false, retryAfterMs = 0 } = {}) {
    super(MESSAGES[code] ?? 'Guide synchronization stopped for inspection.');
    this.name = 'SyncError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function gitBlobSha(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
const EMPTY_BLOB_SHA = gitBlobSha('');

export function validateGuide(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new SyncError('invalid-source');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new SyncError('invalid-source'); }
  const title = source.match(/<title\b[^>]*>([\s\S]{1,300}?)<\/title\s*>/i)?.[1] ?? '';
  if (!/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(source)
      || !/<head\b/i.test(source) || !/<body\b/i.test(source)
      || !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(source)
      || !/skysecure/i.test(title) || !/guide/i.test(title)
      || !/(engineering|production|agent)/i.test(title)
      || source.split(VERSION_MARKER).length !== 2) throw new SyncError('invalid-source');
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/,
    /\bAKIA(?![A-Z0-9]*EXAMPLE)[A-Z0-9]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
    /\b(?:AccountKey|SharedAccessKey)\s*=\s*[A-Za-z0-9+/]{40,}={0,2}/i,
    /(?:\?|&amp;|&)sig=[A-Za-z0-9%+/]{35,}={0,2}/i,
  ];
  if (credentialPatterns.some((pattern) => pattern.test(source))) throw new SyncError('possible-credential');
  return { bytes, source };
}

export function renderGuide(value, updatedAt = new Date().toISOString()) {
  const { bytes, source } = validateGuide(value);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new SyncError('invalid-source');
  const sourceHash = sha256(bytes);
  const html = source.replace(VERSION_MARKER, `<meta name="skysecure-guide-version" content="${sourceHash}">`);
  const manifest = { sourceHash, updatedAt };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  return { sourceHash, html, indexBlobSha: gitBlobSha(html), manifest, manifestText };
}

function validManifest(manifest) {
  return manifest && HEX64.test(manifest.sourceHash) && typeof manifest.updatedAt === 'string'
    && Number.isFinite(Date.parse(manifest.updatedAt));
}

export function validateRemoteTree(tree) {
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length !== EXPECTED_PATHS.length)
    throw new SyncError('remote-scope');
  const entries = [...tree.tree].sort((a, b) => a.path.localeCompare(b.path));
  if (entries.some((entry, index) => entry.path !== EXPECTED_PATHS[index]
      || entry.type !== 'blob' || entry.mode !== '100644' || !HEX40.test(entry.sha)))
    throw new SyncError('remote-scope');
  const files = Object.fromEntries(entries.map((entry) => [entry.path, entry.sha]));
  if (files['.nojekyll'] !== EMPTY_BLOB_SHA) throw new SyncError('remote-scope');
  return files;
}

function defaultState() {
  return { schemaVersion: 1, remoteCommit: null, lastLocalHash: null, lastPublishedHash: null,
    lastPublishedIndexBlobSha: null,
    lastPublishedAt: null, pendingCommit: null, liveSourceHash: null, liveVerifiedAt: null,
    status: 'not-started', publicUrl: PUBLIC_URL, sourcePath: SOURCE_PATH };
}

function validateState(state) {
  if (!state || state.schemaVersion !== 1
      || (state.remoteCommit !== null && !HEX40.test(state.remoteCommit))
      || (state.lastLocalHash !== null && !HEX64.test(state.lastLocalHash))
      || (state.lastPublishedHash !== null && !HEX64.test(state.lastPublishedHash))
      || (state.lastPublishedIndexBlobSha != null && !HEX40.test(state.lastPublishedIndexBlobSha))
      || (state.remoteCommit && (!state.lastPublishedHash || !Number.isFinite(Date.parse(state.lastPublishedAt)))))
    throw new SyncError('state-invalid');
  const pending = state.pendingCommit;
  if (pending && (!HEX40.test(pending.sha) || !HEX40.test(pending.parentCommit)
      || !HEX40.test(pending.indexBlobSha) || !HEX64.test(pending.sourceHash)
      || !Number.isFinite(Date.parse(pending.updatedAt)) || pending.parentCommit !== state.remoteCommit))
    throw new SyncError('state-invalid');
  return state;
}

export function reconcileRemoteState(state, remote) {
  if (!HEX40.test(remote.commit) || !validManifest(remote.manifest)) throw new SyncError('unexpected-response');
  const next = { ...state };
  const pending = state.pendingCommit;
  if (pending) {
    if (remote.commit === pending.sha) {
      if (remote.files['index.html'] !== pending.indexBlobSha || remote.manifest.sourceHash !== pending.sourceHash)
        throw new SyncError('remote-conflict');
      Object.assign(next, { remoteCommit: pending.sha, lastPublishedHash: pending.sourceHash,
        lastPublishedIndexBlobSha: pending.indexBlobSha, lastPublishedAt: pending.updatedAt, pendingCommit: null });
    } else if (remote.commit === pending.parentCommit) {
      // The uncertain ref update did not land. A fresh attempt will use the newest local save.
      next.pendingCommit = null;
    } else throw new SyncError('remote-conflict');
  }
  if (next.remoteCommit && remote.commit !== next.remoteCommit) throw new SyncError('remote-conflict');
  return next;
}

async function exists(filename) {
  try { await fs.access(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function atomicWrite(filename, text) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    // Windows indexers/OneDrive can briefly hold an existing destination open.
    // Retry the atomic replacement without deleting the last durable state.
    for (let attempt = 0; ; attempt += 1) {
      try { await fs.rename(temporary, filename); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
        await sleep(25 * 2 ** attempt);
      }
    }
  } catch {
    await fs.unlink(temporary).catch(() => {});
    throw new SyncError('local-storage');
  }
}

async function readState(directory) {
  try { return validateState(JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return defaultState();
    if (error instanceof SyncError) throw error;
    throw new SyncError('state-invalid');
  }
}

async function readSnapshot(filename) {
  try {
    const before = await fs.lstat(filename);
    if (!before.isFile() || before.size > MAX_SOURCE_BYTES) throw new SyncError('invalid-source');
    const bytes = await fs.readFile(filename);
    const after = await fs.lstat(filename);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size)
      throw new SyncError('source-unstable', { retryable: true });
    return bytes;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    if (['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code))
      throw new SyncError('source-missing', { retryable: true });
    throw new SyncError('invalid-source');
  }
}

export async function readStableGuide(filename = SOURCE_PATH, { stabilityMs = 1_000, wait = sleep } = {}) {
  const first = await readSnapshot(filename);
  await wait(stabilityMs);
  const second = await readSnapshot(filename);
  if (!first.equals(second)) throw new SyncError('source-unstable', { retryable: true });
  validateGuide(second);
  return second;
}

async function credentialFromGcm() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GCM_INTERACTIVE: '0', GIT_TERMINAL_PROMPT: '0', GCM_GUI_PROMPT: '0',
      GCM_TRACE: '0', GCM_TRACE_SECRETS: '0', GIT_TRACE: '0', GIT_TRACE_CURL: '0', GIT_CURL_VERBOSE: '0' };
    for (const key of Object.keys(env)) {
      if (/^(?:GIT_TRACE|GCM_TRACE)/i.test(key)) env[key] = '0';
    }
    const child = spawn('git', ['-c', 'credential.interactive=false', '-c', 'credential.trace=false',
      '-c', 'credential.traceSecrets=false', 'credential', 'fill'],
    { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new SyncError('authentication')); }, 20_000);
    child.on('error', () => { clearTimeout(timer); reject(new SyncError('authentication')); });
    child.stdin.on('error', () => {});
    child.stderr.resume(); // Never expose credential-helper diagnostics or its raw output.
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const credential = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      if (code !== 0 || size > 64 * 1024) { credential.fill(0); reject(new SyncError('authentication')); return; }
      const password = credential.toString('utf8').split(/\r?\n/).find((line) => line.startsWith('password='))?.slice(9);
      credential.fill(0);
      if (!password || /[\r\n]/.test(password)) reject(new SyncError('authentication'));
      else resolve(password);
    });
    child.stdin.end(`protocol=https\nhost=github.com\npath=${REPOSITORY}.git\n\n`);
  });
}

export class GitHubApi {
  constructor({ fetchImpl = fetch, credentialProvider = credentialFromGcm } = {}) {
    this.fetch = fetchImpl;
    this.credentialProvider = credentialProvider;
    this.token = null;
  }
  async request(method, endpoint, body) {
    if (!['GET', 'POST', 'PATCH'].includes(method) || !/^\/git\//.test(endpoint))
      throw new SyncError('unexpected-response');
    this.token ??= await this.credentialProvider();
    let response;
    try {
      response = await this.fetch(`${API_BASE}${endpoint}`, { method, redirect: 'error',
        signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SkySecure-Local-Guide-Sync' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new SyncError('offline', { retryable: true }); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401) { this.token = null; throw new SyncError('authentication'); }
      const limited = response.status === 429 || (response.status === 403
        && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
      if (limited) {
        const retry = response.headers.get('retry-after');
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const retryAfterMs = retry ? (Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now())
          : Math.max(0, reset - Date.now());
        throw new SyncError('rate-limit', { retryable: true, retryAfterMs: Math.max(0, retryAfterMs || 0) });
      }
      if (response.status >= 500) throw new SyncError('offline', { retryable: true });
      if (response.status === 403 || response.status === 404) throw new SyncError('forbidden');
      if (response.status === 409 || response.status === 422) throw new SyncError('remote-conflict');
      throw new SyncError('unexpected-response');
    }
    try { return await response.json(); }
    catch { throw new SyncError('unexpected-response'); }
  }
  async readRemote() {
    const ref = await this.request('GET', `/git/ref/heads/${BRANCH}`);
    if (ref.ref !== `refs/heads/${BRANCH}` || !HEX40.test(ref.object?.sha)) throw new SyncError('unexpected-response');
    const commit = await this.request('GET', `/git/commits/${ref.object.sha}`);
    if (!HEX40.test(commit.tree?.sha)) throw new SyncError('unexpected-response');
    const tree = await this.request('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
    const files = validateRemoteTree(tree);
    const blob = await this.request('GET', `/git/blobs/${files['guide-version.json']}`);
    let manifest;
    try {
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.content.length > 8192)
        throw new Error();
      const bytes = Buffer.from(blob.content, 'base64');
      if (gitBlobSha(bytes) !== files['guide-version.json']) throw new Error();
      manifest = JSON.parse(bytes.toString('utf8'));
      if (!validManifest(manifest)) throw new Error();
    } catch { throw new SyncError('unexpected-response'); }
    return { commit: ref.object.sha, tree: commit.tree.sha, files, manifest };
  }
  async createGuideCommit(rendered, parentCommit) {
    if (!HEX40.test(parentCommit)) throw new SyncError('unexpected-response');
    const index = await this.request('POST', '/git/blobs', { content: Buffer.from(rendered.html, 'utf8').toString('base64'), encoding: 'base64' });
    if (index.sha !== rendered.indexBlobSha) throw new SyncError('unexpected-response');
    const manifest = await this.request('POST', '/git/blobs', { content: Buffer.from(rendered.manifestText, 'utf8').toString('base64'), encoding: 'base64' });
    if (manifest.sha !== gitBlobSha(rendered.manifestText)) throw new SyncError('unexpected-response');
    const tree = await this.request('POST', '/git/trees', { tree: [
      { path: 'index.html', mode: '100644', type: 'blob', sha: index.sha },
      { path: '.nojekyll', mode: '100644', type: 'blob', sha: EMPTY_BLOB_SHA },
      { path: 'guide-version.json', mode: '100644', type: 'blob', sha: manifest.sha },
    ] });
    if (!HEX40.test(tree.sha)) throw new SyncError('unexpected-response');
    const commit = await this.request('POST', '/git/commits', {
      message: 'Update public SkySecure engineering guide', tree: tree.sha, parents: [parentCommit],
    });
    if (!HEX40.test(commit.sha)) throw new SyncError('unexpected-response');
    return commit.sha;
  }
  async updateRef(commit) {
    if (!HEX40.test(commit)) throw new SyncError('unexpected-response');
    let result;
    try { result = await this.request('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit, force: false }); }
    catch (error) {
      // A malformed success response is also ambiguous: read the ref on the next attempt.
      if (error.code === 'unexpected-response') throw new SyncError('offline', { retryable: true });
      throw error;
    }
    if (result.ref !== `refs/heads/${BRANCH}` || result.object?.sha !== commit)
      throw new SyncError('offline', { retryable: true });
  }
}

export class GuideSync {
  constructor({ sourcePath = SOURCE_PATH, directory = SYNC_DIRECTORY, api = new GitHubApi(),
    fetchImpl = fetch, now = () => Date.now(), stableRead = readStableGuide,
    log = (message) => console.log(message) } = {}) {
    this.sourcePath = sourcePath;
    this.directory = directory;
    this.api = api;
    this.fetch = fetchImpl;
    this.now = now;
    this.stableRead = stableRead;
    this.log = log;
    this.state = null;
    this.failures = 0;
    this.retryAt = 0;
    this.halted = false;
    this.lastLog = '';
  }
  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    this.state = await readState(this.directory);
    this.state.sourcePath = this.sourcePath;
    return this;
  }
  async persist() {
    validateState(this.state);
    await atomicWrite(path.join(this.directory, 'state.json'), `${JSON.stringify(this.state, null, 2)}\n`);
  }
  async isPaused() { return exists(path.join(this.directory, 'paused')); }
  setStatus(status, message) {
    this.state.status = status;
    this.state.message = message;
    this.state.lastCheckedAt = new Date(this.now()).toISOString();
    const signature = `${status}:${message}`;
    if (signature !== this.lastLog) {
      this.log(`${this.state.lastCheckedAt} ${status}: ${message}`);
      this.lastLog = signature;
    }
  }
  async verifyLive() {
    if (!this.state.lastPublishedHash) return;
    this.state.liveCheckedAt = new Date(this.now()).toISOString();
    try {
      const response = await this.fetch(`${PUBLIC_URL}guide-version.json?check=${this.now()}`, {
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(); }
      const text = await response.text();
      if (text.length > 8192) throw new Error();
      const manifest = JSON.parse(text);
      if (!validManifest(manifest)) throw new Error();
      this.state.liveManifestHash = manifest.sourceHash;
      this.state.liveMatchesPublished = false;
      this.state.liveError = null;
      if (manifest.sourceHash === this.state.lastPublishedHash) {
        if (this.state.liveSourceHash !== this.state.lastPublishedHash
            || this.state.liveIndexBlobSha !== this.state.lastPublishedIndexBlobSha) {
          const page = await this.fetch(`${PUBLIC_URL}?check=${this.now()}`, {
            redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
            headers: { 'Cache-Control': 'no-cache' },
          });
          if (!page.ok || Number(page.headers.get('content-length')) > MAX_SOURCE_BYTES) {
            await page.body?.cancel().catch(() => {});
            throw new Error();
          }
          const bytes = Buffer.from(await page.arrayBuffer());
          if (bytes.length > MAX_SOURCE_BYTES || gitBlobSha(bytes) !== this.state.lastPublishedIndexBlobSha)
            throw new Error();
          this.state.liveIndexBlobSha = this.state.lastPublishedIndexBlobSha;
          this.state.liveSourceHash = this.state.lastPublishedHash;
          this.state.liveVerifiedAt = this.state.liveCheckedAt;
        }
        this.state.liveMatchesPublished = true;
      }
    } catch {
      this.state.liveMatchesPublished = false;
      this.state.liveError = 'The public version could not yet be verified.';
    }
  }
  async tick() {
    if (!this.state) await this.initialize();
    try {
      if (await this.isPaused()) {
        this.setStatus('paused', MESSAGES.paused);
        await this.persist();
        return this.state;
      }
      const resumeFile = path.join(this.directory, 'resume.request');
      if (await exists(resumeFile)) {
        await fs.unlink(resumeFile);
        this.halted = false;
        this.retryAt = 0;
        this.failures = 0;
        this.api.token = null;
      }
      if (this.halted) return this.state;
      const source = await this.stableRead(this.sourcePath);
      const rendered = renderGuide(source, new Date(this.now()).toISOString());
      this.state.lastLocalHash = rendered.sourceHash;
      if (this.now() < this.retryAt) {
        this.state.nextAttemptAt = new Date(this.retryAt).toISOString();
        await this.persist();
        return this.state;
      }
      const remote = await this.api.readRemote();
      const recoveredPublication = this.state.pendingCommit && remote.commit === this.state.pendingCommit.sha;
      this.state = reconcileRemoteState(this.state, remote);
      if (recoveredPublication) this.state.lastPublishedAt = new Date(this.now()).toISOString();
      if (!this.state.remoteCommit) {
        if (remote.files['index.html'] !== rendered.indexBlobSha || remote.manifest.sourceHash !== rendered.sourceHash)
          throw new SyncError('adoption-mismatch');
        Object.assign(this.state, { remoteCommit: remote.commit, lastPublishedHash: rendered.sourceHash,
          lastPublishedIndexBlobSha: rendered.indexBlobSha, lastPublishedAt: remote.manifest.updatedAt });
      } else if (remote.manifest.sourceHash !== this.state.lastPublishedHash) throw new SyncError('remote-conflict');
      if (this.state.lastPublishedIndexBlobSha && remote.files['index.html'] !== this.state.lastPublishedIndexBlobSha)
        throw new SyncError('remote-conflict');
      this.state.lastPublishedIndexBlobSha ??= remote.files['index.html'];
      // Persist recovery/adoption before making any further remote changes.
      await this.persist();
      const earliest = Date.parse(this.state.lastPublishedAt) + MIN_PUBLICATION_INTERVAL_MS;
      if (rendered.sourceHash !== this.state.lastPublishedHash && this.now() >= earliest) {
        if (await this.isPaused()) throw new SyncError('paused');
        const commit = await this.api.createGuideCommit(rendered, remote.commit);
        this.state.pendingCommit = { sha: commit, parentCommit: remote.commit, sourceHash: rendered.sourceHash,
          indexBlobSha: rendered.indexBlobSha, updatedAt: rendered.manifest.updatedAt };
        // A lost PATCH response or process crash is reconciled against this durable intent on restart.
        await this.persist();
        if (await this.isPaused()) throw new SyncError('paused');
        const newest = renderGuide(await this.stableRead(this.sourcePath), rendered.manifest.updatedAt);
        if (newest.sourceHash !== rendered.sourceHash) throw new SyncError('source-unstable', { retryable: true });
        if (await this.isPaused()) throw new SyncError('paused');
        await this.api.updateRef(commit);
        Object.assign(this.state, { remoteCommit: commit, lastPublishedHash: rendered.sourceHash,
          lastPublishedIndexBlobSha: rendered.indexBlobSha, lastPublishedAt: new Date(this.now()).toISOString(),
          pendingCommit: null, liveMatchesPublished: false });
        await this.persist();
      }
      this.failures = 0;
      this.retryAt = 0;
      this.state.lastError = null;
      await this.verifyLive();
      if (rendered.sourceHash !== this.state.lastPublishedHash) {
        this.state.nextAttemptAt = new Date(earliest).toISOString();
        this.setStatus('saved-awaiting-publish', `The latest save is queued. Next publication is eligible at ${this.state.nextAttemptAt}.`);
      } else {
        this.state.nextAttemptAt = null;
        this.setStatus(this.state.liveMatchesPublished ? 'live' : 'published-awaiting-live',
          this.state.liveMatchesPublished ? 'The public URL matches the latest saved guide.'
            : 'GitHub contains the saved guide; waiting for the public URL to show it.');
      }
      await this.persist();
    } catch (caught) {
      const error = caught instanceof SyncError ? caught : new SyncError('local-storage');
      const fixableSource = ['invalid-source', 'possible-credential', 'source-missing', 'source-unstable'].includes(error.code);
      this.state.lastError = { code: error.code, at: new Date(this.now()).toISOString() };
      if (error.retryable && !fixableSource) {
        const delay = Math.max(error.retryAfterMs, Math.min(300_000, 5_000 * 2 ** Math.min(this.failures++, 6)));
        this.retryAt = this.now() + delay;
        this.state.nextAttemptAt = new Date(this.retryAt).toISOString();
      } else if (!fixableSource && error.code !== 'paused') this.halted = true;
      this.setStatus(error.code === 'paused' ? 'paused' : fixableSource ? 'waiting-for-valid-save'
        : error.retryable ? 'retrying' : 'blocked', error.message);
      try { await this.persist(); }
      catch { this.halted = true; this.log(`${new Date(this.now()).toISOString()} blocked: ${MESSAGES['local-storage']}`); }
    }
    return this.state;
  }
}

async function acquireLock() {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new SyncError('already-running')));
    server.listen({ host: '127.0.0.1', port: 47863, exclusive: true }, resolve);
  });
  return server;
}

async function main() {
  const [command = '--status', ...extra] = process.argv.slice(2);
  if (extra.length || !['--once', '--watch', '--status', '--pause', '--resume'].includes(command)) {
    console.error('Usage: node .guide-sync/sync.mjs --once|--watch|--status|--pause|--resume');
    process.exitCode = 1;
    return;
  }
  await fs.mkdir(SYNC_DIRECTORY, { recursive: true });
  if (command === '--pause') {
    await atomicWrite(path.join(SYNC_DIRECTORY, 'paused'), `${new Date().toISOString()}\n`);
    console.log(MESSAGES.paused);
    return;
  }
  if (command === '--resume') {
    await fs.unlink(path.join(SYNC_DIRECTORY, 'paused')).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await atomicWrite(path.join(SYNC_DIRECTORY, 'resume.request'), `${new Date().toISOString()}\n`);
    console.log('Publication is enabled. A running watcher will resume within 20 seconds; otherwise start --watch.');
    return;
  }
  if (command === '--status') {
    const state = await readState(SYNC_DIRECTORY);
    console.log(JSON.stringify({ ...state, paused: await exists(path.join(SYNC_DIRECTORY, 'paused')) }, null, 2));
    return;
  }
  const lock = await acquireLock();
  const sync = new GuideSync();
  try {
    await sync.initialize();
    if (command === '--once') {
      await sync.tick();
      if (sync.state.status === 'blocked' || sync.state.status === 'waiting-for-valid-save') process.exitCode = 1;
      return;
    }
    console.log(`Automatic public guide publishing is active for ${SOURCE_PATH}. Saved content is public and retained in Git history.`);
    let busy = false;
    let queued = false;
    let closed = false;
    let debounce;
    let watcher;
    const run = async () => {
      if (closed) return;
      if (busy) { queued = true; return; }
      busy = true;
      try { await sync.tick(); }
      finally {
        busy = false;
        if (queued && !closed) { queued = false; debounce = setTimeout(run, 1_500); }
      }
    };
    const interval = setInterval(run, 20_000);
    try {
      watcher = watch(path.dirname(SOURCE_PATH), { persistent: false }, (_event, filename) => {
        if (filename && filename.toString().toLowerCase() !== path.basename(SOURCE_PATH).toLowerCase()) return;
        clearTimeout(debounce);
        debounce = setTimeout(run, 1_500);
      });
      watcher.on('error', () => {
        console.log('Directory notifications are unavailable; the 20-second save check remains active.');
        watcher.close();
      });
    } catch { console.log('Directory notifications are unavailable; the 20-second save check remains active.'); }
    const stopped = new Promise((resolve) => {
      const stop = () => {
        closed = true;
        clearInterval(interval);
        clearTimeout(debounce);
        watcher?.close();
        resolve();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    await run();
    await stopped;
    // Allow any in-flight ref update to finish with its durable pending record intact.
    while (busy) await sleep(100);
  } finally { await new Promise((resolve) => lock.close(resolve)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof SyncError ? error.message : 'Guide sync could not start. Check the local folder and Node installation.');
    process.exitCode = 1;
  });
}
