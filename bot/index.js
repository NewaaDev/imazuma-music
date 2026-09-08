import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function canRun(executable) {
  try {
    execFileSync(fileURLToPath(executable), ['--version'], {
      stdio: 'ignore',
      timeout: 15_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function hasPython3() {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function checksumFor(checksums, assetName) {
  const line = checksums.split(/\r?\n/).find((entry) => entry.trim().endsWith(`  ${assetName}`));
  const digest = line?.trim().split(/\s+/)[0]?.toLowerCase();
  return /^[a-f0-9]{64}$/.test(digest || '') ? digest : '';
}

async function ensureYtDlp() {
  const executableName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const bundledExecutable = new URL(`./bin/${executableName}`, import.meta.url);

  // L'installation Windows est gérée par start-local.ps1 ou YTDLP_PATH.
  if (process.platform === 'win32') {
    if (process.env.YTDLP_PATH) return;
    if (existsSync(bundledExecutable) && canRun(bundledExecutable)) {
      process.env.YTDLP_PATH = fileURLToPath(bundledExecutable);
    }
    return;
  }

  // PyInstaller extrait ses bibliothèques natives dans /tmp à chaque commande.
  // Le tmpfs limité de OnePanel sature quand plusieurs recherches/lectures se
  // chevauchent, puis zlib échoue sur un fichier aléatoire (ARC4, curl_cffi…).
  // Utiliser le disque persistant du serveur supprime cette limite temporaire.
  const extractionDirectory = new URL('./.cache/yt-dlp-extraction/', import.meta.url);
  mkdirSync(extractionDirectory, { recursive: true });
  process.env.TMPDIR = fileURLToPath(extractionDirectory);
  process.env.TEMP = process.env.TMPDIR;
  process.env.TMP = process.env.TMPDIR;
  console.log(`[Inazuma Music] Extraction yt-dlp isolée dans ${process.env.TMPDIR}.`);

  // Le binaire Linux autonome est une archive PyInstaller. Certains conteneurs
  // OnePanel ont échoué pendant sa décompression (Cryptodome/_ARC4.abi3.so).
  // Si Python 3 est disponible, l'exécutable zipimport officiel évite totalement
  // cette extraction native. Sinon on garde le binaire adapté au conteneur.
  const assetName = hasPython3()
    ? 'yt-dlp'
    : process.platform === 'darwin'
      ? 'yt-dlp_macos'
      : existsSync('/etc/alpine-release')
        ? 'yt-dlp_musllinux'
        : 'yt-dlp_linux';
  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
  const checksumsUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';
  const temporaryExecutable = new URL(`./bin/${executableName}.download-${process.pid}-${Date.now()}`, import.meta.url);

  mkdirSync(new URL('./bin/', import.meta.url), { recursive: true });
  try {
    const checksumResponse = await fetch(checksumsUrl, { redirect: 'follow' });
    if (!checksumResponse.ok) throw new Error(`sommes de contrôle HTTP ${checksumResponse.status}`);
    const expectedHash = checksumFor(await checksumResponse.text(), assetName);
    if (!expectedHash) throw new Error(`somme SHA-256 absente pour ${assetName}`);

    if (existsSync(bundledExecutable) && sha256(bundledExecutable) === expectedHash && canRun(bundledExecutable)) {
      chmodSync(bundledExecutable, 0o755);
      process.env.YTDLP_PATH = fileURLToPath(bundledExecutable);
      console.log(`[Inazuma Music] yt-dlp vérifié (${assetName}).`);
      return;
    }

    console.log(`[Inazuma Music] Installation vérifiée de ${assetName}…`);
    const response = await fetch(downloadUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`téléchargement HTTP ${response.status}`);
    const binary = Buffer.from(await response.arrayBuffer());
    const actualHash = createHash('sha256').update(binary).digest('hex');
    if (actualHash !== expectedHash) throw new Error('la somme SHA-256 du téléchargement est invalide');

    writeFileSync(temporaryExecutable, binary);
    chmodSync(temporaryExecutable, 0o755);
    renameSync(temporaryExecutable, bundledExecutable);
    if (!canRun(bundledExecutable)) throw new Error('le binaire téléchargé est incompatible avec ce conteneur');
    process.env.YTDLP_PATH = fileURLToPath(bundledExecutable);
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
