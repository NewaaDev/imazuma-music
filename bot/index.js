import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

async function ensureYtDlp() {
  if (process.env.YTDLP_PATH) return;

  const executableName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const bundledExecutable = new URL(`./bin/${executableName}`, import.meta.url);
  if (existsSync(bundledExecutable)) {
    if (process.platform !== 'win32') chmodSync(bundledExecutable, 0o755);
    process.env.YTDLP_PATH = bundledExecutable.pathname;
    return;
  }

  // Windows utilise normalement start-local.ps1. Sur l'hébergement Linux,
  // yt-dlp n'est pas fourni par OnePanel : on l'installe localement au premier
  // démarrage afin que le bot ne dépende pas du PATH système.
  if (process.platform === 'win32') return;

  const downloadUrl = process.platform === 'darwin'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  const temporaryExecutable = new URL(`./bin/${executableName}.download`, import.meta.url);

  console.log('[Inazuma Music] Installation locale de yt-dlp…');
  mkdirSync(new URL('./bin/', import.meta.url), { recursive: true });
  try {
    const response = await fetch(downloadUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`téléchargement HTTP ${response.status}`);
    writeFileSync(temporaryExecutable, Buffer.from(await response.arrayBuffer()));
    chmodSync(temporaryExecutable, 0o755);
    renameSync(temporaryExecutable, bundledExecutable);
    process.env.YTDLP_PATH = bundledExecutable.pathname;
    console.log('[Inazuma Music] yt-dlp est prêt.');
  } catch (error) {
    rmSync(temporaryExecutable, { force: true });
    throw new Error(`Impossible d'installer yt-dlp automatiquement : ${error.message}`);
  }
}

const relayTokenFile = new URL('./remote-access-token.txt', import.meta.url);
if (existsSync(relayTokenFile)) {
  const relayToken = readFileSync(relayTokenFile, 'utf8').trim();
  if (relayToken) {
    process.env.NEWAA_RELAY_TOKEN = relayToken;
    process.env.NEWAA_RELAY_URL ||= 'wss://newaa-music-relay.augchast.workers.dev/ws';
  }
}

const packageLockFile = new URL('./package-lock.json', import.meta.url);
const installMarkerFile = new URL('./node_modules/.inazuma-package-lock.sha256', import.meta.url);
const packageLockDigest = existsSync(packageLockFile)
  ? createHash('sha256').update(readFileSync(packageLockFile)).digest('hex')
  : '';
const installedDigest = existsSync(installMarkerFile)
  ? readFileSync(installMarkerFile, 'utf8').trim()
  : '';
const dependenciesMissing = !existsSync(new URL('./node_modules/discord.js/package.json', import.meta.url));

if (dependenciesMissing || (packageLockDigest && installedDigest !== packageLockDigest)) {
  console.log('[Inazuma Music] Installation/mise à jour des dépendances…');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: new URL('.', import.meta.url),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (packageLockDigest) writeFileSync(installMarkerFile, packageLockDigest);
}

await ensureYtDlp();
await import('./src/index.js');
