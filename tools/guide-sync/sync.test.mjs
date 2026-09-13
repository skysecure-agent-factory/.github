import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { BRANCH, GitHubApi, GuideSync, MIN_PUBLICATION_INTERVAL_MS, LOCAL_POLL_INTERVAL_MS,
  LIVE_VERIFY_INITIAL_DELAY_MS, LIVE_VERIFY_MAX_DELAY_MS, LIVE_VERIFY_WINDOW_MS, SYNC_DIRECTORY,
  VERSION_MARKER, gitBlobSha, readStableGuide, reconcileRemoteState, renderGuide,
  validateGuide, validateRemoteTree } from './sync.mjs';

const FIRST = '<!doctype html><html><head><title>SkySecure Engineering Guide</title>'
  + VERSION_MARKER + '</head><body><h1>Guide</h1></body></html>\n';
const SECOND = FIRST.replace('<h1>Guide</h1>', '<h1>Updated guide</h1>');
const THIRD = FIRST.replace('<h1>Guide</h1>', '<h1>Newest guide</h1>');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const INITIAL_TIME = Date.parse('2026-09-13T10:00:00.000Z');

function remoteFor(source = FIRST, commit = A, at = INITIAL_TIME) {
  const rendered = renderGuide(source, new Date(at).toISOString());
  return { commit, files: { 'index.html': rendered.indexBlobSha, '.nojekyll': gitBlobSha(''),
    'guide-version.json': gitBlobSha(rendered.manifestText) }, manifest: rendered.manifest };
}

class FakeApi {
  constructor() { this.remote = remoteFor(); this.creates = []; this.updates = []; this.uncertain = null; this.reads = 0; }
  async readRemote() { this.reads += 1; return structuredClone(this.remote); }
  async createGuideCommit(rendered, parentCommit) {
    this.creates.push({ rendered, parentCommit });
    this.next = { commit: B, files: { 'index.html': rendered.indexBlobSha, '.nojekyll': gitBlobSha(''),
      'guide-version.json': gitBlobSha(rendered.manifestText) }, manifest: rendered.manifest };
    return B;
  }
  async updateRef(commit) {
    this.updates.push(commit);
    if (this.uncertain !== 'not-landed') this.remote = this.next;
    if (this.uncertain) {
      const { SyncError } = await import('./sync.mjs');
      throw new SyncError('offline', { retryable: true });
    }
  }
}

async function harness(t) {
  const directory = await fs.mkdtemp(path.join(SYNC_DIRECTORY, '.test-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const api = new FakeApi();
  let source = FIRST;
  let metadata = 0;
  const counts = { stableReads: 0, fingerprints: 0, publicRequests: 0 };
  let now = INITIAL_TIME;
  const options = { directory, sourcePath: path.join(directory, 'guide.html'), api,
    now: () => now, stableRead: async () => { counts.stableReads += 1; return Buffer.from(source); },
    fingerprint: async () => { counts.fingerprints += 1; return metadata; }, log: () => {},
    fetchImpl: async (url) => {
      counts.publicRequests += 1;
      return new Response(url.includes('guide-version.json')
        ? JSON.stringify(api.remote.manifest) : (api.creates.at(-1)?.rendered.html ?? renderGuide(FIRST).html));
    } };
  const sync = await new GuideSync(options).initialize();
  return { directory, api, sync, options, counts,
    setSource: (value, { notifyMetadata = true } = {}) => { source = value; if (notifyMetadata) metadata += 1; },
    advance: (milliseconds) => { now += milliseconds; } };
}

test('renderer preserves content except the single version marker and hashes UTF-8 bytes', () => {
  const source = FIRST.replace('Guide</h1>', 'Guide — secure 🚀</h1>');
  const rendered = renderGuide(Buffer.from(source), '2026-09-13T10:00:00.000Z');
  assert.equal(rendered.sourceHash, createHash('sha256').update(Buffer.from(source)).digest('hex'));
  assert.equal(rendered.html, source.replace(VERSION_MARKER,
    `<meta name="skysecure-guide-version" content="${rendered.sourceHash}">`));
  assert.deepEqual(rendered.manifest, { sourceHash: rendered.sourceHash, updatedAt: '2026-09-13T10:00:00.000Z' });
  assert.equal(rendered.manifestText, JSON.stringify(rendered.manifest, null, 2) + '\n');
  assert.equal(rendered.indexBlobSha, gitBlobSha(rendered.html));
  assert.equal(gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('partial saves, duplicate markers, wrong title, malformed UTF-8, and actual-looking credentials are rejected', () => {
  for (const source of ['', FIRST.slice(0, -20), FIRST.replace(VERSION_MARKER, VERSION_MARKER.repeat(2)),
    FIRST.replace('SkySecure Engineering Guide', 'Unrelated page'), Buffer.from([0xff, 0xfe]),
    FIRST.replace('<h1>Guide</h1>', `ghp_${'a'.repeat(36)}`),
    FIRST.replace('<h1>Guide</h1>', '-----BEGIN PRIVATE KEY-----')]) {
    assert.throws(() => validateGuide(source));
  }
  assert.doesNotThrow(() => validateGuide(FIRST.replace('<h1>Guide</h1>', 'OPENAI_API_KEY=&lt;your-key&gt;')));
});

test('two-read stability detects a save during the read interval and supports atomic editor replacement', async (t) => {
  const { directory } = await harness(t);
  const filename = path.join(directory, 'stable.html');
  await fs.writeFile(filename, FIRST);
  await assert.rejects(readStableGuide(filename, { wait: async () => { await fs.writeFile(filename, SECOND); } }),
    (error) => error.code === 'source-unstable');
  const replacement = path.join(directory, 'replacement.html');
  await fs.writeFile(replacement, FIRST);
  await fs.rename(replacement, filename);
  assert.equal((await readStableGuide(filename, { wait: async () => {} })).toString(), FIRST);
});

test('remote tree accepts only the three expected plain files and an empty nojekyll marker', () => {
  const remote = remoteFor();
  const tree = { tree: Object.entries(remote.files).map(([filename, sha]) => ({ path: filename, sha, type: 'blob', mode: '100644' })) };
  assert.deepEqual(validateRemoteTree(tree), remote.files);
  assert.throws(() => validateRemoteTree({ ...tree, truncated: true }));
  assert.throws(() => validateRemoteTree({ tree: [...tree.tree, { path: 'workflow.yml', sha: A, type: 'blob', mode: '100644' }] }));
  assert.throws(() => validateRemoteTree({ tree: tree.tree.map((entry) => ({ ...entry, mode: '120000' })) }));
});

test('initial adoption requires matching rendered bytes and never writes to GitHub', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  assert.equal(h.sync.state.remoteCommit, A);
  assert.equal(h.sync.state.status, 'live');
  assert.equal(h.sync.state.lastPublishedAt, new Date(INITIAL_TIME).toISOString());
  assert.equal(h.api.creates.length, 0);
  const other = await harness(t);
  other.setSource(SECOND);
  await other.sync.tick();
  assert.equal(other.sync.state.lastError.code, 'adoption-mismatch');
  assert.equal(other.api.creates.length, 0);
});

test('save bursts coalesce to the newest content and respect the initial deployment time', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(1_000);
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'saved-awaiting-publish', JSON.stringify(h.sync.state));
  assert.equal(h.api.creates.length, 0);
  h.setSource(THIRD);
  h.advance(MIN_PUBLICATION_INTERVAL_MS);
  await h.sync.tick();
  assert.equal(h.api.creates.length, 1);
  assert.equal(h.api.creates[0].rendered.sourceHash, renderGuide(THIRD).sourceHash);
  assert.equal(h.api.creates[0].parentCommit, A);
  assert.equal(h.sync.state.remoteCommit, B, JSON.stringify(h.sync.state));
});

test('manual remote changes block publication without replacing the known baseline', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(MIN_PUBLICATION_INTERVAL_MS);
  h.api.remote.commit = C;
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'blocked');
  assert.equal(h.sync.state.lastError.code, 'remote-conflict');
  assert.equal(h.sync.state.remoteCommit, A);
  assert.equal(h.api.creates.length, 0);
});

test('the publication interval starts when a slow ref update completes', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(MIN_PUBLICATION_INTERVAL_MS);
  const update = h.api.updateRef.bind(h.api);
  h.api.updateRef = async (...args) => { h.advance(60_000); return update(...args); };
  await h.sync.tick();
  assert.equal(h.sync.state.lastPublishedAt,
    new Date(INITIAL_TIME + MIN_PUBLICATION_INTERVAL_MS + 60_000).toISOString());
  h.setSource(THIRD);
  h.advance(MIN_PUBLICATION_INTERVAL_MS - 30_000);
  await h.sync.tick();
  assert.equal(h.api.creates.length, 1);
  assert.equal(h.sync.state.status, 'saved-awaiting-publish');
});

test('a newer save during upload prevents publication of the outdated snapshot', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(MIN_PUBLICATION_INTERVAL_MS);
  const create = h.api.createGuideCommit.bind(h.api);
  h.api.createGuideCommit = async (...args) => {
    const commit = await create(...args);
    h.setSource(THIRD);
    return commit;
  };
  await h.sync.tick();
  assert.equal(h.sync.state.lastError.code, 'source-unstable');
  assert.equal(h.api.updates.length, 0);
  assert.equal(h.sync.state.pendingCommit.parentCommit, A);
  await h.sync.tick();
  assert.equal(h.api.updates.length, 1);
  assert.equal(h.api.creates.at(-1).rendered.sourceHash, renderGuide(THIRD).sourceHash);
});

test('an ambiguous ref update that landed is recovered from durable intent after restart', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(MIN_PUBLICATION_INTERVAL_MS);
  h.api.uncertain = 'landed';
  await h.sync.tick();
  const disk = JSON.parse(await fs.readFile(path.join(h.directory, 'state.json'), 'utf8'));
  assert.equal(disk.pendingCommit.sha, B);
  assert.equal(disk.remoteCommit, A);
  const restarted = await new GuideSync(h.options).initialize();
  await restarted.tick();
  assert.equal(restarted.state.remoteCommit, B);
  assert.equal(restarted.state.pendingCommit, null);
  assert.equal(restarted.state.status, 'live', JSON.stringify(restarted.state));
  assert.equal(h.api.updates.length, 1);
});

test('an ambiguous ref update that did not land retries using the latest save', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(MIN_PUBLICATION_INTERVAL_MS);
  h.api.uncertain = 'not-landed';
  await h.sync.tick();
  h.setSource(THIRD);
  h.advance(6_000);
  h.api.uncertain = null;
  await h.sync.tick();
  assert.equal(h.api.creates.length, 2, JSON.stringify(h.sync.state));
  assert.equal(h.api.creates[1].rendered.sourceHash, renderGuide(THIRD).sourceHash);
  assert.equal(h.sync.state.pendingCommit, null);
  assert.equal(h.sync.state.lastPublishedHash, renderGuide(THIRD).sourceHash);
});

test('an ambiguous update followed by an unrelated commit is a conflict', () => {
  const original = remoteFor();
  const rendered = renderGuide(SECOND);
  const state = { remoteCommit: A, lastPublishedHash: original.manifest.sourceHash,
    pendingCommit: { sha: B, parentCommit: A, sourceHash: rendered.sourceHash,
      indexBlobSha: rendered.indexBlobSha, updatedAt: rendered.manifest.updatedAt } };
  assert.throws(() => reconcileRemoteState(state, remoteFor(THIRD, C)), (error) => error.code === 'remote-conflict');
});

test('pause prevents writes and published status stays separate from public deployment verification', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(MIN_PUBLICATION_INTERVAL_MS);
  await fs.writeFile(path.join(h.directory, 'paused'), 'paused');
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'paused');
  assert.equal(h.api.creates.length, 0);
  await fs.unlink(path.join(h.directory, 'paused'));
  h.sync.fetch = async () => new Response(JSON.stringify(remoteFor().manifest));
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'published-awaiting-live');
  assert.equal(h.sync.state.lastPublishedHash, renderGuide(SECOND).sourceHash);
  assert.equal(h.sync.state.liveSourceHash, renderGuide(FIRST).sourceHash);
});

test('a new manifest requires matching served HTML before live status, with no repeat HTML fetch after verification', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(MIN_PUBLICATION_INTERVAL_MS);
  let served = renderGuide(FIRST).html;
  let pageFetches = 0;
  h.sync.fetch = async (url) => {
    if (url.includes('guide-version.json')) return new Response(JSON.stringify(h.api.remote.manifest));
    pageFetches += 1;
    return new Response(served);
  };
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'published-awaiting-live');
  assert.equal(h.sync.state.liveManifestHash, renderGuide(SECOND).sourceHash);
  assert.equal(h.sync.state.liveSourceHash, renderGuide(FIRST).sourceHash);
  served = renderGuide(SECOND).html;
  h.advance(LIVE_VERIFY_INITIAL_DELAY_MS);
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'live');
  assert.equal(pageFetches, 2);
  await h.sync.tick();
  assert.equal(pageFetches, 2);
});

test('a malformed ref success response is retryable so durable intent can be reconciled', async () => {
  const api = new GitHubApi({ credentialProvider: async () => 'test-only-placeholder',
    fetchImpl: async () => new Response('{}') });
  await assert.rejects(api.updateRef(B), (error) => error.retryable && error.code === 'offline');
});

test('Git Data publication has exact paths, one parent, explicit branch, and force false', async () => {
  const requests = [];
  const rendered = renderGuide(SECOND);
  const api = new GitHubApi({ credentialProvider: async () => 'test-only-placeholder',
    fetchImpl: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, ...options, body });
      if (url.endsWith('/git/blobs')) return new Response(JSON.stringify({ sha: gitBlobSha(Buffer.from(body.content, 'base64')) }));
      if (url.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: C }));
      if (url.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: B }));
      return new Response(JSON.stringify({ ref: `refs/heads/${BRANCH}`, object: { sha: B } }));
    } });
  const commit = await api.createGuideCommit(rendered, A);
  await api.updateRef(commit);
  assert.equal(requests.length, 5);
  assert.deepEqual(requests[2].body.tree.map((entry) => entry.path).sort(), ['.nojekyll', 'guide-version.json', 'index.html']);
  assert.equal(Object.hasOwn(requests[2].body, 'base_tree'), false);
  assert.deepEqual(requests[3].body.parents, [A]);
  assert.equal(requests[4].url, 'https://api.github.com/repos/skysecure-agent-factory/.github/git/refs/heads/guide-live');
  assert.deepEqual(requests[4].body, { sha: B, force: false });
  assert.ok(requests.every((request) => request.redirect === 'error'));
});

test('settled idle ticks use metadata only: zero GitHub/public traffic, content reads, and state rewrites', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  assert.equal(h.api.reads, 1);
  assert.equal(h.counts.publicRequests, 2);
  const baseline = { ...h.counts };
  const filename = path.join(h.directory, 'state.json');
  const bytes = await fs.readFile(filename, 'utf8');
  await fs.utimes(filename, 1_000, 1_000);
  const before = await fs.stat(filename, { bigint: true });
  for (let index = 0; index < 60; index += 1) {
    h.advance(LOCAL_POLL_INTERVAL_MS);
    await h.sync.tick();
  }
  const after = await fs.stat(filename, { bigint: true });
  assert.equal(h.api.reads, 1);
  assert.equal(h.counts.publicRequests, baseline.publicRequests);
  assert.equal(h.counts.stableReads, baseline.stableReads);
  assert.equal(h.counts.fingerprints - baseline.fingerprints, 60);
  assert.equal(await fs.readFile(filename, 'utf8'), bytes);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(h.sync.nextWakeDelay(), LOCAL_POLL_INTERVAL_MS);
});

test('save batching does not read GitHub or public pages before the eligible publication time', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  for (let index = 0; index < 6; index += 1) {
    h.advance(LOCAL_POLL_INTERVAL_MS);
    await h.sync.tick();
  }
  assert.equal(h.api.reads, 1);
  assert.equal(h.counts.publicRequests, 2);
  assert.equal(h.counts.stableReads, 2);
  assert.equal(h.api.updates.length, 0);
  assert.equal(h.sync.nextWakeDelay(), 30_000);
  h.advance(30_000);
  await h.sync.tick();
  assert.equal(h.api.reads, 2);
  assert.equal(h.api.updates.length, 1);
  assert.equal(h.sync.state.status, 'live');
});

test('crossing the batch deadline during a tick cannot publish without validating the remote branch', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND);
  h.advance(MIN_PUBLICATION_INTERVAL_MS - 1);
  const currentClock = h.sync.now;
  let reads = 0;
  h.sync.now = () => {
    reads += 1;
    // refreshSource timestamp, retry gate, and eligibleSave clock occur before this boundary.
    if (reads === 4) h.advance(2);
    return currentClock();
  };
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'saved-awaiting-publish');
  assert.equal(h.sync.halted, false);
  assert.equal(h.api.reads, 1);
  assert.equal(h.api.updates.length, 0);
  assert.equal(h.sync.nextWakeDelay(), 250);
  h.sync.now = currentClock;
  await h.sync.tick();
  assert.equal(h.api.reads, 2);
  assert.equal(h.api.updates.length, 1);
  assert.equal(h.sync.state.status, 'live');
});

test('save notifications reread even unchanged metadata, while metadata fallback catches missed notifications', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  h.setSource(SECOND, { notifyMetadata: false });
  await h.sync.tick({ sourceChanged: true });
  assert.equal(h.sync.state.lastLocalHash, renderGuide(SECOND).sourceHash);
  h.setSource(THIRD);
  await h.sync.tick();
  assert.equal(h.sync.state.lastLocalHash, renderGuide(THIRD).sourceHash);
  assert.equal(h.api.reads, 1);
  const stableReads = h.counts.stableReads;
  await h.sync.tick({ sourceChanged: true });
  assert.equal(h.counts.stableReads, stableReads + 1);
  assert.equal(h.api.reads, 1);
});

test('pending website verification backs off independently and becomes network-silent after its bound', async (t) => {
  const h = await harness(t);
  let publicRequests = 0;
  h.sync.fetch = async () => { publicRequests += 1; return new Response('{}', { status: 503 }); };
  await h.sync.tick();
  assert.equal(publicRequests, 1);
  assert.equal(h.sync.state.status, 'published-awaiting-live');
  let lastDelay = 0;
  while (h.sync.verification) {
    const { nextAt } = h.sync.verification;
    const lastTime = Date.parse(h.sync.state.liveCheckedAt);
    const delay = nextAt - lastTime;
    assert.ok(delay <= LIVE_VERIFY_MAX_DELAY_MS);
    if (nextAt < INITIAL_TIME + LIVE_VERIFY_WINDOW_MS) assert.ok(delay >= lastDelay);
    const countBefore = publicRequests;
    h.advance(Math.max(0, delay - 1));
    await h.sync.tick();
    assert.equal(publicRequests, countBefore);
    h.advance(1);
    await h.sync.tick();
    lastDelay = delay;
  }
  assert.equal(h.sync.state.status, 'published-verification-deferred');
  assert.equal(h.api.reads, 1);
  assert.ok(publicRequests <= 8, publicRequests);
  const requestsAtEnd = publicRequests;
  for (let index = 0; index < 20; index += 1) {
    h.advance(LOCAL_POLL_INTERVAL_MS);
    await h.sync.tick();
  }
  assert.equal(publicRequests, requestsAtEnd);
  assert.equal(h.api.reads, 1);
});

test('resume and restart perform one remote validation and can retry deferred website verification', async (t) => {
  const h = await harness(t);
  h.sync.fetch = async () => new Response('{}', { status: 503 });
  await h.sync.tick();
  h.advance(LIVE_VERIFY_WINDOW_MS);
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'published-verification-deferred');
  await fs.writeFile(path.join(h.directory, 'resume.request'), 'resume');
  h.sync.fetch = h.options.fetchImpl;
  await h.sync.tick();
  assert.equal(h.api.reads, 2);
  assert.equal(h.sync.state.status, 'live');
  await h.sync.tick();
  assert.equal(h.api.reads, 2);
  const requests = h.counts.publicRequests;
  const restarted = await new GuideSync(h.options).initialize();
  await restarted.tick();
  assert.equal(h.api.reads, 3);
  assert.equal(h.counts.publicRequests, requests);
  await restarted.tick();
  assert.equal(h.api.reads, 3);
});

test('an actual new edit restarts deferred verification without periodic remote reads during batching', async (t) => {
  const h = await harness(t);
  h.api.remote = remoteFor(FIRST, A, INITIAL_TIME + LIVE_VERIFY_WINDOW_MS);
  h.sync.fetch = async () => new Response('{}', { status: 503 });
  await h.sync.tick();
  h.advance(LIVE_VERIFY_WINDOW_MS);
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'published-verification-deferred');
  h.sync.fetch = h.options.fetchImpl;
  h.setSource(SECOND);
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'saved-awaiting-publish');
  assert.equal(h.sync.state.liveMatchesPublished, true);
  assert.equal(h.api.reads, 1);
});

test('transient stable-read failures retry without new metadata and invalid saves never spin on overdue verification', async (t) => {
  const h = await harness(t);
  h.sync.fetch = async () => new Response('{}', { status: 503 });
  await h.sync.tick();
  h.setSource(SECOND);
  const original = h.sync.stableRead;
  h.sync.stableRead = async () => {
    const { SyncError } = await import('./sync.mjs');
    throw new SyncError('source-missing', { retryable: true });
  };
  h.advance(LIVE_VERIFY_INITIAL_DELAY_MS);
  await h.sync.tick();
  assert.equal(h.sync.state.lastError.code, 'source-missing');
  assert.equal(h.sync.nextWakeDelay(), LOCAL_POLL_INTERVAL_MS);
  h.sync.stableRead = original;
  await h.sync.tick();
  assert.equal(h.sync.state.lastLocalHash, renderGuide(SECOND).sourceHash);
  h.setSource('partial HTML');
  await h.sync.tick();
  assert.equal(h.sync.state.status, 'waiting-for-valid-save');
  h.advance(LIVE_VERIFY_WINDOW_MS);
  const before = h.counts.stableReads;
  await h.sync.tick();
  assert.equal(h.counts.stableReads, before);
  assert.equal(h.sync.nextWakeDelay(), LOCAL_POLL_INTERVAL_MS);
  h.setSource(THIRD, { notifyMetadata: false });
  await h.sync.tick({ sourceChanged: true });
  assert.equal(h.sync.state.status, 'published-awaiting-live');
  assert.equal(h.sync.state.lastPublishedHash, renderGuide(THIRD).sourceHash);
});

test('legacy state lacking rendered hash migrates once and respects its known remote baseline', async (t) => {
  const h = await harness(t);
  await h.sync.tick();
  const legacy = JSON.parse(await fs.readFile(path.join(h.directory, 'state.json'), 'utf8'));
  delete legacy.lastPublishedIndexBlobSha;
  delete legacy.liveIndexBlobSha;
  await fs.writeFile(path.join(h.directory, 'state.json'), JSON.stringify(legacy));
  const migrated = await new GuideSync(h.options).initialize();
  await migrated.tick();
  assert.equal(migrated.state.status, 'live');
  assert.equal(migrated.state.lastPublishedIndexBlobSha, renderGuide(FIRST).indexBlobSha);
  assert.equal(h.api.updates.length, 0);
  const reads = h.api.reads;
  const requests = h.counts.publicRequests;
  await migrated.tick();
  assert.equal(h.api.reads, reads);
  assert.equal(h.counts.publicRequests, requests);
});
