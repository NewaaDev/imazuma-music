import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const relayTokenFile = new URL('./remote-access-token.txt', import.meta.url);
if (existsSync(relayTokenFile)) {
  const relayToken = readFileSync(relayTokenFile, 'utf8').trim();
  if (relayToken) {
    process.env.NEWAA_RELAY_TOKEN = relayToken;
    process.env.NEWAA_RELAY_URL ||= 'wss://newaa-music-relay.augchast.workers.dev/ws';
  }
}

if (!existsSync(new URL('./node_modules/discord.js/package.json', import.meta.url))) {
  console.log('[Inazuma Music] Installation des dépendances manquantes…');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: new URL('.', import.meta.url),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

await import('./src/index.js');
