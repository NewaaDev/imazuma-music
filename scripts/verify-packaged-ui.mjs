import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// These are already supplied by electron-builder; do not install extra tooling.
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { path7za } = require('7zip-bin');
const yaml = require('js-yaml');
const tempPrefix = 'inazuma-package-verify-';
const fail = message => { throw new Error(message); };
const hash = (file, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);

function requireRegularFile(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size === 0) {
    fail(`Missing, empty or non-regular file: ${file}`);
  }
  return stat;
}

function assertSafeEntry(entry) {
  const value = entry.replaceAll('\\', '/');
  if (!value || value.startsWith('/') || /[:\x00-\x1f]/.test(value)
    || value.split('/').some(part => part === '..')) {
    fail(`Unsafe archive path: ${entry}`);
  }
  return value;
}

function readPackedFile(archive, entry) {
  assertSafeEntry(entry);
  // asar's directory traversal uses path.sep, including on Windows.
  const nativeEntry = path.normalize(entry);
  let stat;
  try { stat = asar.statFile(archive, nativeEntry, false); }
  catch { fail(`Required packaged file missing: ${entry} (${archive})`); }
  if (!stat || stat.link || stat.unpacked || !Number.isSafeInteger(stat.size) || stat.size <= 0) {
    fail(`Required packaged file is empty, linked or unpacked: ${entry}`);
  }
  return asar.extractFile(archive, nativeEntry, false);
}

function htmlAssets(html) {
  const document = html.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<html\b/i.test(document) || !/<\/html\s*>/i.test(document)
    || !/<head\b/i.test(document) || !/<\/head\s*>/i.test(document)
    || !/<body\b/i.test(document) || !/<\/body\s*>/i.test(document)) {
    fail('Malformed dist/index.html: HTML document structure missing');
  }
  if (/<base\b/i.test(document)) fail('dist/index.html must not override its local base URL');
  const references = new Set();
  let javascript = 0;
  let stylesheets = 0;
  for (const tag of document.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const attributes = new Map();
    for (const attr of tag[2].matchAll(/(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]);
    }
    for (const name of ['src', 'href']) {
      if (new RegExp(`\\b${name}\\s*=`, 'i').test(tag[2]) && !attributes.has(name)) {
        fail(`Malformed ${name} attribute in dist/index.html`);
      }
      const raw = attributes.get(name);
      if (!raw) continue;
      // External fonts/links are not packaged assets and cannot satisfy the gate.
      if (/^(?:https?:)?\/\//i.test(raw)) continue;
      let relative;
      try { relative = decodeURIComponent(raw.split(/[?#]/, 1)[0]); }
      catch { fail(`Malformed asset URL: ${raw}`); }
      if (!/\.(?:m?js|css)$/i.test(relative)) continue;
      if (relative.includes('\\')) fail(`Unsafe asset path: ${relative}`);
      assertSafeEntry(relative);
      const packaged = path.posix.normalize(`dist/${relative}`);
      if (!packaged.startsWith('dist/')) fail(`Asset escapes dist: ${relative}`);
      references.add(packaged);
      if (tag[1].toLowerCase() === 'script' && name === 'src' && /\.m?js$/i.test(relative)) javascript++;
      if (tag[1].toLowerCase() === 'link' && name === 'href' && /\.css$/i.test(relative)
        && /(?:^|\s)stylesheet(?:\s|$)/i.test(attributes.get('rel') ?? '')) stylesheets++;
    }
  }
  if (!javascript || !stylesheets) fail('dist/index.html must reference at least one local JavaScript and stylesheet');
  return { references: [...references], javascript, stylesheets };
}

export function verifyAsar(archive, expectedVersion) {
  archive = path.resolve(archive);
  requireRegularFile(archive);
  try {
    // Reject malicious header paths even though only named files are read.
    for (const entry of asar.listPackage(archive)) {
      assertSafeEntry(entry.replaceAll('\\', '/').replace(/^\//, ''));
    }
    const manifest = JSON.parse(readPackedFile(archive, 'package.json').toString('utf8'));
    if (manifest.version !== expectedVersion) fail(`Packaged version ${manifest.version} does not match ${expectedVersion}`);
    if (manifest.main !== 'dist-electron/main.js') fail(`Unexpected Electron entry point: ${manifest.main}`);
    readPackedFile(archive, 'dist-electron/main.js');
    readPackedFile(archive, 'dist-electron/preload.js');
    const assets = htmlAssets(readPackedFile(archive, 'dist/index.html').toString('utf8'));
    for (const entry of assets.references) readPackedFile(archive, entry);
    return { archive, version: manifest.version, ...assets, sha256: hash(archive) };
  } catch (error) {
    throw new Error(`Invalid packaged UI in ${archive}: ${error.message}`, { cause: error });
  } finally {
    asar.uncache?.(archive);
  }
}

function run7zip(args) {
  const result = spawnSync(path7za, args, {
    shell: false, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`7-Zip verification failed (exit ${result.status}): ${(result.stderr || result.stdout).slice(-1000)}`);
  return result.stdout;
}

function archiveEntries(archive) {
  const listing = run7zip(['l', '-slt', archive]);
  const separator = /^----------\r?$/m.exec(listing);
  if (!separator) fail(`Unrecognized installer archive: ${archive}`);
  return [...listing.slice(separator.index).matchAll(/^Path = (.+)\r?$/gm)]
    .map(match => ({ original: match[1].trimEnd(), normalized: assertSafeEntry(match[1].trimEnd()) }));
}

function extractNamed(archive, entry, directory) {
  assertSafeEntry(entry.original);
  // Flatten one exact entry; never extract a whole installer or execute it.
  run7zip(['e', archive, `-o${directory}`, '-y', '-bd', '-spd', entry.original]);
  const target = path.join(directory, path.posix.basename(entry.normalized));
  requireRegularFile(target);
  return target;
}

function cleanupOwnedTemp(directory, tempParent) {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat) return;
  const resolved = fs.realpathSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(resolved) !== tempParent
    || !path.basename(resolved).startsWith(tempPrefix)) fail(`Refusing unsafe temporary cleanup: ${directory}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

export function verifyInstaller(installer, expectedVersion) {
  installer = path.resolve(installer);
  requireRegularFile(installer);
  const tempParent = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(tempParent, tempPrefix));
  try {
    let archive = installer;
    let entries = archiveEntries(archive);
    let app = entries.filter(entry => entry.normalized === 'resources/app.asar');
    if (app.length === 0) {
      // NSIS can expose the app payload as a nested archive instead of an SFX.
      const payload = entries.filter(entry => /^(?:\$PLUGINSDIR\/)?app-(?:64|x64)\.7z$/i.test(entry.normalized));
      if (payload.length !== 1) fail(`Installer contains no unique x64 application payload: ${installer}`);
      archive = extractNamed(archive, payload[0], temporary);
      entries = archiveEntries(archive);
      app = entries.filter(entry => entry.normalized === 'resources/app.asar');
    }
    if (app.length !== 1) fail(`Installer contains no unique resources/app.asar: ${installer}`);
    const result = verifyAsar(extractNamed(archive, app[0], temporary), expectedVersion);
    return { ...result, archive: installer, embeddedArchive: 'resources/app.asar' };
  } finally {
    cleanupOwnedTemp(temporary, tempParent);
  }
}

export function verifyReleaseMetadata(metadataFile, installer, expectedVersion) {
  requireRegularFile(metadataFile);
  const size = requireRegularFile(installer).size;
  const metadata = yaml.load(fs.readFileSync(metadataFile, 'utf8'));
  const filename = path.basename(installer);
  if (!metadata || metadata.version !== expectedVersion) fail(`latest.yml version does not match ${expectedVersion}`);
  if (metadata.path !== filename) fail('latest.yml path does not match the verified setup filename');
  if (!Array.isArray(metadata.files)) fail('latest.yml files list missing');
  const matching = metadata.files.filter(file => file?.url === filename);
  if (matching.length !== 1) fail('latest.yml must reference the verified setup exactly once');
  if (matching[0].size !== size) fail('latest.yml installer size mismatch');
  const digest = hash(installer, 'sha512', 'base64');
  if (metadata.sha512 !== digest || matching[0].sha512 !== digest) fail('latest.yml installer SHA512 mismatch');
  return { metadata: path.resolve(metadataFile), version: expectedVersion, installer: filename, size, sha512: digest };
}

export function verifyRelease(root = process.cwd()) {
  root = path.resolve(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = manifest.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) fail('Invalid package.json version');
  const release = path.resolve(root, manifest.build?.directories?.output ?? 'release');
  const unpacked = verifyAsar(path.join(release, 'win-unpacked', 'resources', 'app.asar'), version);
  const setup = path.join(release, `Inazuma-Music-${version}-x64-setup.exe`);
  const portable = path.join(release, `Inazuma-Music-${version}-x64-portable.exe`);
  const packages = [unpacked];
  for (const file of [setup, ...(fs.existsSync(portable) ? [portable] : [])]) {
    const result = verifyInstaller(file, version);
    if (result.sha256 !== unpacked.sha256) fail(`Installer ASAR differs from the verified unpacked application: ${file}`);
    packages.push(result);
  }
  const metadata = verifyReleaseMetadata(path.join(release, 'latest.yml'), setup, version);
  return { version, packages, metadata };
}

export function main(args = process.argv.slice(2)) {
  let root = process.cwd();
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') {
      console.log('Usage: node verify-packaged-ui.mjs [--root REPO] [--asar FILE | --installer FILE | FILE ...]');
      return;
    }
    if (['--root', '--asar', '--installer'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) fail(`Missing value for ${arg}`);
      if (arg === '--root') root = path.resolve(value);
      else targets.push(value);
    } else if (arg.startsWith('-')) fail(`Unknown option: ${arg}`);
    else targets.push(arg);
  }
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const report = targets.length ? {
    version, packages: targets.map(file => {
      if (/\.asar$/i.test(file)) return verifyAsar(file, version);
      if (/\.exe$/i.test(file)) return verifyInstaller(file, version);
      fail(`Expected an .asar or installer .exe path: ${file}`);
    }),
  } : verifyRelease(root);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`Release verification failed: ${error.message}`); process.exitCode = 1; }
}
