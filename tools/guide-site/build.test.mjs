import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ARTIFACT_FILES, MAX_SOURCE_BYTES, VERSION_MARKER, buildGuide, gitBlobSha, renderGuide, validateGuide } from './build.mjs';

const timestamp = '2026-09-13T12:00:00.000Z';
const guide = (body = '<h1 id="start">Guide</h1><a href="#start">Start</a>', head = '') =>
  `<!doctype html>\n<html><head><title>SkySecure Engineering and Production Guide</title>${VERSION_MARKER}${head}</head><body>${body}</body></html>\n`;
const hasCode = (code) => (error) => error.code === code;

async function fixture(t, value = guide()) {
  const tempParent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(tempParent, 'skysecure-guide-site-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), tempParent);
    assert.ok(path.basename(resolved).startsWith('skysecure-guide-site-test-'));
    await fs.rm(resolved, { recursive: true, force: false });
  });
  await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(path.join(root, 'docs', 'index.html'), value);
  return root;
}

test('rendering hashes exact source bytes and only replaces the version marker', () => {
  const source = guide();
  const result = renderGuide(source, timestamp);
  assert.equal(result.sourceHash, createHash('sha256').update(source).digest('hex'));
  assert.equal(result.html, source.replace(VERSION_MARKER,
    `<meta name="skysecure-guide-version" content="${result.sourceHash}">`));
  assert.equal(result.indexBlobSha, gitBlobSha(result.html));
  assert.deepEqual(JSON.parse(result.manifestText), { sourceHash: result.sourceHash, updatedAt: timestamp });
  assert.deepEqual(result.checks, { idCount: 1, internalLinkCount: 1, scriptCount: 0 });
});

test('identical source has deterministic content hash regardless of build time', () => {
  const first = renderGuide(guide(), timestamp);
  const second = renderGuide(guide(), '2026-09-14T12:00:00Z');
  assert.equal(first.sourceHash, second.sourceHash);
  assert.equal(first.html, second.html);
  assert.notEqual(first.manifestText, second.manifestText);
  assert.notEqual(first.sourceHash, renderGuide(guide('changed'), timestamp).sourceHash);
});

test('rejects invalid UTF-8, empty, incomplete and oversized HTML', () => {
  for (const source of [Buffer.from([0xc3, 0x28]), '', guide().replace('</html>', ''), Buffer.alloc(MAX_SOURCE_BYTES)])
    assert.throws(() => validateGuide(source), hasCode('invalid-source'));
});

test('requires a guide title and exactly one actual local version meta element', () => {
  const source = guide();
  for (const candidate of [source.replace('SkySecure', 'OtherCompany'), source.replace(VERSION_MARKER, ''),
    source.replace(VERSION_MARKER, VERSION_MARKER + VERSION_MARKER),
    source.replace(VERSION_MARKER, `<!-- ${VERSION_MARKER} -->`),
    source.replace(VERSION_MARKER, `${VERSION_MARKER}<meta name='skysecure-guide-version' content='other'>`)])
    assert.throws(() => validateGuide(candidate), hasCode('invalid-source'));
});

test('rejects obvious credential patterns without including their content in errors', () => {
  const examples = ['ghp_' + 'a'.repeat(35), 'github_pat_' + 'a'.repeat(65), 'sk-proj-' + 'b'.repeat(45),
    'AKIA' + 'B'.repeat(16), '-----BEGIN PRIVATE KEY-----', 'AccountKey=' + 'a'.repeat(45),
    '?sig=' + 'a'.repeat(40), 'eyJ' + 'a'.repeat(25) + '.' + 'b'.repeat(25) + '.' + 'c'.repeat(25)];
  for (const example of examples) {
    assert.throws(() => validateGuide(guide(`<p>${example}</p>`)), (error) => {
      assert.equal(error.code, 'possible-credential');
      assert.ok(!error.message.includes(example));
      return true;
    });
  }
});

test('retains illustrative placeholders and ordinary engineering snippets', () => {
  assert.doesNotThrow(() => validateGuide(guide('<pre>AccountKey=&lt;your-key&gt;\nAKIAIOSFODNN7EXAMPLE\nsk-your-placeholder</pre>')));
});

test('rejects duplicate and empty IDs, including decoded attribute duplicates', () => {
  for (const body of ['<h1 id="same">A</h1><h2 id="same">B</h2>', '<h1 id="">A</h1>',
    '<h1 id="a&amp;b">A</h1><h2 id="a&#38;b">B</h2>'])
    assert.throws(() => validateGuide(guide(body)), hasCode('invalid-anchor'));
});

test('supports single-quoted and unquoted attributes plus percent-encoded fragment targets', () => {
  const checked = validateGuide(guide("<h1 id='café'>A</h1><a href='#caf%C3%A9'>A</a><h2 id=second>B</h2><a href=index.html#second>B</a>"));
  assert.equal(checked.idCount, 2);
  assert.equal(checked.internalLinkCount, 2);
});

test('rejects broken fragment links and invalid percent encoding with a controlled error', () => {
  for (const href of ['#missing', '#%', '#%C3%28', './index.html#missing'])
    assert.throws(() => validateGuide(guide(`<a href="${href}">Go</a>`)), hasCode('invalid-anchor'));
});

test('allows top links, text directives and external URLs without network access', () => {
  assert.doesNotThrow(() => validateGuide(guide('<h1 id="target">A</h1><a href="#">Top</a><a href="#:~:text=A">Text</a><a href="#target:~:text=A">Text</a><a href="https://example.invalid/#other">External</a>')));
});

test('HTML comments and raw script/style/text bodies do not invent duplicate IDs', () => {
  const body = '<h1 id="same">A</h1><!-- <h2 id="same">Ignored</h2> -->'
    + '<script>const sample = \'<h1 id="same"><a href="#absent">\';</script>'
    + '<style>body::before { content: \'<b id="same">\'; }</style>'
    + '<textarea><a id="same" href="#absent">Example</a></textarea>';
  const checked = validateGuide(guide(body));
  assert.equal(checked.idCount, 1);
  assert.equal(checked.scriptCount, 1);
});

test('parses inline script syntax without executing code', () => {
  const good = validateGuide(guide('<script>throw new Error("MUST NOT EXECUTE");</script>'));
  assert.equal(good.scriptCount, 1);
  assert.throws(() => validateGuide(guide('<script>const invalid = ;</script>')), hasCode('invalid-script'));
  assert.throws(() => validateGuide(guide('<script type="module">export const x = 1;</script>')), hasCode('invalid-script'));
  assert.doesNotThrow(() => validateGuide(guide('<script type="application/ld+json">{"@type":"Guide"}</script>')));
});

test('rejects duplicate security-relevant attributes and malformed numeric entities', () => {
  assert.throws(() => validateGuide(guide('<h1 id="first" id="second">X</h1>')), hasCode('invalid-source'));
  assert.throws(() => validateGuide(guide('<h1 id="&#999999999;">X</h1>')), hasCode('invalid-anchor'));
});

test('rejects invalid build timestamps', () => {
  for (const value of ['invalid', '', null, 0])
    assert.throws(() => renderGuide(guide(), value), hasCode('invalid-timestamp'));
});

test('--check semantics validate without creating output or modifying the source', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'docs', 'index.html'));
  const result = await buildGuide({ root, check: true, updatedAt: timestamp });
  assert.equal(result.outputPath, null);
  assert.deepEqual(await fs.readdir(root), ['docs']);
  assert.deepEqual(await fs.readFile(path.join(root, 'docs', 'index.html')), before);
});

test('build publishes exactly three files and no source, tools or repository files', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'private-not-for-site.txt'), 'DO NOT PUBLISH');
  const result = await buildGuide({ root, updatedAt: timestamp });
  assert.equal(result.outputPath, path.join(root, '_site'));
  assert.deepEqual((await fs.readdir(result.outputPath)).sort(), ARTIFACT_FILES);
  assert.equal(await fs.readFile(path.join(result.outputPath, 'index.html'), 'utf8'), result.html);
  assert.equal(await fs.readFile(path.join(result.outputPath, '.nojekyll'), 'utf8'), '');
  assert.equal(await fs.readFile(path.join(result.outputPath, 'guide-version.json'), 'utf8'), result.manifestText);
  assert.ok(!(await fs.readdir(root)).some((name) => name.startsWith('_site-stage-')));
});

test('build never deletes or overwrites an existing artifact directory', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, '_site'));
  await fs.writeFile(path.join(root, '_site', 'keep.txt'), 'keep');
  await assert.rejects(buildGuide({ root, updatedAt: timestamp }), hasCode('existing-artifact'));
  assert.equal(await fs.readFile(path.join(root, '_site', 'keep.txt'), 'utf8'), 'keep');
  assert.deepEqual((await fs.readdir(root)).sort(), ['_site', 'docs']);
});

test('invalid source fails before creating an artifact or staging directory', async (t) => {
  const root = await fixture(t, 'not HTML');
  await assert.rejects(buildGuide({ root, updatedAt: timestamp }), hasCode('invalid-source'));
  assert.deepEqual(await fs.readdir(root), ['docs']);
});

test('missing or directory source fails closed without creating an artifact', async (t) => {
  const root = await fixture(t);
  await fs.unlink(path.join(root, 'docs', 'index.html'));
  await assert.rejects(buildGuide({ root }), hasCode('unsafe-source'));
  await fs.mkdir(path.join(root, 'docs', 'index.html'));
  await assert.rejects(buildGuide({ root }), hasCode('unsafe-source'));
});

test('a file at the artifact path is preserved, not treated as disposable output', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, '_site'), 'owned content');
  await assert.rejects(buildGuide({ root }), hasCode('existing-artifact'));
  assert.equal(await fs.readFile(path.join(root, '_site'), 'utf8'), 'owned content');
});

test('source symbolic links cannot redirect publication to a different file', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'docs', 'index.html');
  const target = path.join(root, 'other-guide.html');
  await fs.rename(source, target);
  try { await fs.symlink(target, source, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('This local platform does not grant symbolic-link creation; Linux CI runs this test.');
      return;
    }
    throw error;
  }
  await assert.rejects(buildGuide({ root }), hasCode('unsafe-source'));
  assert.equal(await fs.readFile(target, 'utf8'), guide());
});

test('docs directory links cannot redirect the canonical source location', async (t) => {
  const root = await fixture(t);
  const docs = path.join(root, 'docs');
  const target = path.join(root, 'other-docs');
  await fs.rename(docs, target);
  try { await fs.symlink(target, docs, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('This local platform does not grant directory-link creation; Linux CI runs this test.');
      return;
    }
    throw error;
  }
  await assert.rejects(buildGuide({ root }), hasCode('unsafe-source'));
  assert.equal(await fs.readFile(path.join(target, 'index.html'), 'utf8'), guide());
});
