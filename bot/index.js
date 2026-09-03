import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!existsSync(new URL('./node_modules/discord.js/package.json', import.meta.url))) {
  console.log('[Inazuma Music] Installation des dépendances manquantes…');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: new URL('.', import.meta.url),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

await import('./src/index.js');
