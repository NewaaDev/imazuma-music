import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyAsar, verifyReleaseMetadata } from './verify-packaged-ui.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const version = '2.2.8';
const html = '<!doctype html><html><head><link rel="stylesheet" href="./assets/app.css"></head><body><div id="root"></div><script type="module" src="./assets/app.js"></script></body></html>';

async function fixture(t, changes = {}) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'inazuma-package-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('inazuma-package-test-'));
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const source = path.join(directory, 'source');
  const files = {
    'package.json': JSON.stringify({ version, main: 'dist-electron/main.js' }),
    'dist-electron/main.js': 'console.log("main");',
    'dist-electron/preload.js': 'console.log("preload");',
    'dist/index.html': html,
    'dist/assets/app.js': 'console.log("renderer");',
    'dist/assets/app.css': 'body { color: white; }',
    ...changes,
  };
  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    const target = path.join(source, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const archive = path.join(directory, 'app.asar');
  await asar.createPackage(source, archive);
  return { archive, directory };
}

test('accepts a complete packaged UI', async t => {
  const { archive } = await fixture(t);
  const result = verifyAsar(archive, version);
  assert.equal(result.version, version);
  assert.equal(result.javascript, 1);
  assert.equal(result.stylesheets, 1);
});

for (const missing of ['dist/index.html', 'dist-electron/main.js', 'dist-electron/preload.js', 'dist/assets/app.js', 'dist/assets/app.css']) {
  test(`rejects missing ${missing}`, async t => {
    const { archive } = await fixture(t, { [missing]: null });
    assert.throws(() => verifyAsar(archive, version), /Required packaged file missing/);
  });
}

test('rejects the renderer-less layout found in the published broken installer', async t => {
  const { archive } = await fixture(t, { 'dist/index.html': null, 'dist/assets/app.js': null, 'dist/assets/app.css': null });
  assert.throws(() => verifyAsar(archive, version), /dist\/index\.html/);
});

for (const unsafe of ['../app.js', '%2e%2e/app.js', '/assets/app.js', 'C:/app.js', './assets\\app.js']) {
  test(`rejects unsafe relative asset ${unsafe}`, async t => {
    const { archive } = await fixture(t, { 'dist/index.html': html.replace('./assets/app.js', unsafe) });
    assert.throws(() => verifyAsar(archive, version), /Unsafe/);
  });
}

test('rejects an additional referenced script that is absent', async t => {
  const { archive } = await fixture(t, { 'dist/index.html': html.replace('</head>', '<link rel="modulepreload" href="./assets/chunk.js"></head>') });
  assert.throws(() => verifyAsar(archive, version), /dist\/assets\/chunk\.js/);
});

test('rejects malformed HTML', async t => {
  const { archive } = await fixture(t, { 'dist/index.html': 'not an HTML document' });
  assert.throws(() => verifyAsar(archive, version), /Malformed/);
});

test('requires both a local script and stylesheet', async t => {
  const { archive } = await fixture(t, { 'dist/index.html': html.replace('./assets/app.js', 'https://example.invalid/app.js') });
  assert.throws(() => verifyAsar(archive, version), /at least one local/);
});

test('rejects a wrong packaged version', async t => {
  const { archive } = await fixture(t);
  assert.throws(() => verifyAsar(archive, '2.2.9'), /does not match/);
});

test('rejects a malformed packaged manifest', async t => {
  const { archive } = await fixture(t, { 'package.json': '{not valid JSON}' });
  assert.throws(() => verifyAsar(archive, version), /Invalid packaged UI/);
});

test('rejects a different Electron entry point', async t => {
  const { archive } = await fixture(t, { 'package.json': JSON.stringify({ version, main: '../main.js' }) });
  assert.throws(() => verifyAsar(archive, version), /Unexpected Electron entry point/);
});

test('rejects an empty referenced stylesheet', async t => {
  const { archive } = await fixture(t, { 'dist/assets/app.css': '' });
  assert.throws(() => verifyAsar(archive, version), /empty/);
});

test('validates latest.yml filename, version, size and both hashes', async t => {
  const { directory } = await fixture(t);
  const installer = path.join(directory, `Inazuma-Music-${version}-x64-setup.exe`);
  fs.writeFileSync(installer, 'metadata fixture, never executed');
  const digest = createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
  const metadataFile = path.join(directory, 'latest.yml');
  const valid = { version, path: path.basename(installer), sha512: digest, files: [{ url: path.basename(installer), size: fs.statSync(installer).size, sha512: digest }] };
  const check = metadata => { fs.writeFileSync(metadataFile, yaml.dump(metadata)); return verifyReleaseMetadata(metadataFile, installer, version); };
  assert.equal(check(valid).version, version);
  assert.throws(() => check({ ...valid, version: '2.2.7' }), /version/);
  assert.throws(() => check({ ...valid, path: 'other.exe' }), /filename/);
  assert.throws(() => check({ ...valid, files: [{ ...valid.files[0], size: 1 }] }), /size/);
  assert.throws(() => check({ ...valid, sha512: 'wrong' }), /SHA512/);
  assert.throws(() => check({ ...valid, files: [{ ...valid.files[0], sha512: 'wrong' }] }), /SHA512/);
  assert.throws(() => check({ ...valid, files: [{ ...valid.files[0], url: '../other.exe' }] }), /exactly once/);
});
