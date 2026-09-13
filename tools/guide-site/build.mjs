import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const VERSION_MARKER = '<meta name="skysecure-guide-version" content="local">';
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const ARTIFACT_FILES = ['.nojekyll', 'guide-version.json', 'index.html'];

const messages = {
  'invalid-source': 'The guide must be complete UTF-8 HTML under 2 MB with the SkySecure guide title and exactly one local version marker.',
  'possible-credential': 'Possible credential found in the guide. Remove it before publishing; no content was printed.',
  'invalid-anchor': 'The guide contains a duplicate or empty ID, malformed fragment, or unresolved internal link.',
  'invalid-script': 'An inline guide script has invalid syntax or an unsupported module type.',
  'invalid-timestamp': 'The build timestamp must be a valid date string.',
  'unsafe-source': 'The guide source must be a regular docs/index.html file inside the repository, not a symbolic link.',
  'existing-artifact': 'The _site output already exists. Use a fresh checkout or move that exact generated folder before building again.',
  'build-failed': 'The guide artifact could not be written. No existing output was deleted.',
};

export class BuildError extends Error {
  constructor(code) {
    super(messages[code] ?? messages['build-failed']);
    this.name = 'BuildError';
    this.code = code;
  }
}

export function gitBlobSha(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function decodeAttribute(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_match, entity) => {
    if (entity[0] !== '#') {
      return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[entity.toLowerCase()];
    }
    const numeric = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 0x10ffff || (numeric >= 0xd800 && numeric <= 0xdfff))
      throw new BuildError('invalid-anchor');
    return String.fromCodePoint(numeric);
  });
}

function readAttributes(text) {
  const attributes = new Map();
  const pattern = /([^\s=/'"<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (attributes.has(name) && ['id', 'href', 'type', 'src'].includes(name))
      throw new BuildError('invalid-source');
    attributes.set(name, decodeAttribute(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

function inspectMarkup(source) {
  const ids = new Set();
  const fragments = [];
  let scriptCount = 0;
  let markerCount = 0;
  // Comments and raw-text script/style bodies are not HTML elements. In particular,
  // code examples inside scripts must not invent IDs or links for these checks.
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let match;
  while ((match = tokens.exec(source))) {
    if (!match[1] || /^<\//.test(match[0])) continue;
    const tag = match[1].toLowerCase();
    const attributes = readAttributes(match[2]);
    if (attributes.has('id')) {
      const id = attributes.get('id');
      if (!id || ids.has(id)) throw new BuildError('invalid-anchor');
      ids.add(id);
    }
    const href = attributes.get('href');
    if (href?.startsWith('#')) fragments.push(href.slice(1));
    else if (/^(?:\.\/)?index\.html#/.test(href ?? '')) fragments.push(href.slice(href.indexOf('#') + 1));
    if (tag === 'meta' && attributes.get('name') === 'skysecure-guide-version') markerCount += 1;

    if (!['script', 'style', 'textarea', 'title'].includes(tag)) continue;
    const closing = new RegExp(`</${tag}\\s*>`, 'gi');
    closing.lastIndex = tokens.lastIndex;
    const end = closing.exec(source);
    if (!end) throw new BuildError('invalid-source');
    if (tag === 'script' && !attributes.has('src')) {
      const type = (attributes.get('type') ?? '').trim().toLowerCase();
      if (type === 'module') throw new BuildError('invalid-script');
      if (!type || /^(?:text|application)\/(?:java|ecma)script$/.test(type)) {
        try { new Script(source.slice(tokens.lastIndex, end.index), { filename: 'guide-inline-script.js' }); }
        catch { throw new BuildError('invalid-script'); }
        scriptCount += 1;
      }
    }
    tokens.lastIndex = closing.lastIndex;
  }
  if (markerCount !== 1) throw new BuildError('invalid-source');
  for (const fragment of fragments) {
    if (!fragment) continue; // href="#" is the standard top-of-page link.
    let target;
    try { target = decodeURIComponent(fragment); }
    catch { throw new BuildError('invalid-anchor'); }
    // Browsers may append a text-fragment directive after the element fragment.
    target = target.split(':~:text=')[0];
    if (target && !ids.has(target)) throw new BuildError('invalid-anchor');
  }
  return { idCount: ids.size, internalLinkCount: fragments.length, scriptCount };
}

export function validateGuide(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  if (!bytes.length || bytes.length >= MAX_SOURCE_BYTES) throw new BuildError('invalid-source');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new BuildError('invalid-source'); }
  const title = source.match(/<title\b[^>]*>([\s\S]{1,300}?)<\/title\s*>/i)?.[1] ?? '';
  if (!/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(source)
      || !/<head\b/i.test(source) || !/<\/head\s*>/i.test(source) || !/<body\b/i.test(source)
      || !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(source)
      || !/skysecure/i.test(title) || !/guide/i.test(title) || !/(engineering|production|agent)/i.test(title)
      || source.split(VERSION_MARKER).length !== 2) throw new BuildError('invalid-source');
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/,
    /\bAKIA(?![A-Z0-9]*EXAMPLE)[A-Z0-9]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
    /\b(?:AccountKey|SharedAccessKey)\s*=\s*[A-Za-z0-9+/]{40,}={0,2}/i,
    /(?:\?|&amp;|&)sig=[A-Za-z0-9%+/]{35,}={0,2}/i,
  ];
  if (credentialPatterns.some((pattern) => pattern.test(source))) throw new BuildError('possible-credential');
  return { bytes, source, ...inspectMarkup(source) };
}

export function renderGuide(value, updatedAt = new Date().toISOString()) {
  const checked = validateGuide(value);
  if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)))
    throw new BuildError('invalid-timestamp');
  const sourceHash = createHash('sha256').update(checked.bytes).digest('hex');
  const html = checked.source.replace(VERSION_MARKER, `<meta name="skysecure-guide-version" content="${sourceHash}">`);
  const manifest = { sourceHash, updatedAt };
  return { sourceHash, html, indexBlobSha: gitBlobSha(html), manifest,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    checks: { idCount: checked.idCount, internalLinkCount: checked.internalLinkCount, scriptCount: checked.scriptCount } };
}

async function pathExists(filename) {
  try { await fs.lstat(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function buildGuide({ root = REPOSITORY_ROOT, check = false, updatedAt = new Date().toISOString() } = {}) {
  const repository = await fs.realpath(root);
  const docs = path.join(repository, 'docs');
  const sourcePath = path.join(docs, 'index.html');
  let bytes;
  try {
    const directory = await fs.lstat(docs);
    const source = await fs.lstat(sourcePath);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !source.isFile() || source.isSymbolicLink()
        || source.size >= MAX_SOURCE_BYTES || await fs.realpath(sourcePath) !== sourcePath)
      throw new BuildError('unsafe-source');
    bytes = await fs.readFile(sourcePath);
  } catch (error) {
    if (error instanceof BuildError) throw error;
    throw new BuildError('unsafe-source');
  }
  const rendered = renderGuide(bytes, updatedAt);
  if (check) return { ...rendered, outputPath: null };
  const outputPath = path.join(repository, '_site');
  if (await pathExists(outputPath)) throw new BuildError('existing-artifact');
  // Only this newly created staging directory is touched. Never recursively delete
  // an existing output, repository, or caller-computed path.
  const staging = await fs.mkdtemp(path.join(repository, '_site-stage-'));
  try {
    await fs.writeFile(path.join(staging, 'index.html'), rendered.html, { encoding: 'utf8', flag: 'wx' });
    await fs.writeFile(path.join(staging, 'guide-version.json'), rendered.manifestText, { encoding: 'utf8', flag: 'wx' });
    await fs.writeFile(path.join(staging, '.nojekyll'), '', { encoding: 'utf8', flag: 'wx' });
    if (await pathExists(outputPath)) throw new BuildError('existing-artifact');
    await fs.rename(staging, outputPath);
  } catch (error) {
    for (const name of ARTIFACT_FILES) await fs.unlink(path.join(staging, name)).catch(() => {});
    await fs.rmdir(staging).catch(() => {});
    if (error instanceof BuildError) throw error;
    throw new BuildError('build-failed');
  }
  return { ...rendered, outputPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    console.error('Usage: node tools/guide-site/build.mjs [--check]');
    process.exitCode = 1;
  } else {
    buildGuide({ check: args[0] === '--check' }).then((result) => {
      console.log(`${result.outputPath ? 'Built' : 'Validated'} guide: ${result.sourceHash}; ${result.checks.idCount} IDs, ${result.checks.internalLinkCount} internal links, ${result.checks.scriptCount} inline scripts.`);
    }).catch((error) => {
      console.error(error instanceof BuildError ? error.message : messages['build-failed']);
      process.exitCode = 1;
    });
  }
}
