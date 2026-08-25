import { spawn } from 'node:child_process';
import { config } from '../config.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export function isYouTubeUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isPlaylistUrl(input) {
  if (!isYouTubeUrl(input)) return false;
  try { return Boolean(new URL(input).searchParams.get('list')); }
  catch { return false; }
}

function toTrack(item, requestedBy) {
  if (!item?.id || !item?.title) return null;
  return {
    id: item.id,
    title: item.title,
    url: item.webpage_url || item.url || `https://www.youtube.com/watch?v=${item.id}`,
    thumbnail: item.thumbnail || item.thumbnails?.at(-1)?.url || null,
    duration: item.duration || 0,
    channel: item.channel || item.uploader || 'YouTube',
    requestedBy,
  };
}

function runJson(args, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ytDlpPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('YouTube ne répond pas dans le délai prévu.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT'
        ? new Error(`yt-dlp est introuvable (${config.ytDlpPath}). Consultez le README.`)
        : error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `yt-dlp a quitté avec le code ${code}.`));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error('Réponse illisible reçue de yt-dlp.')); }
    });
  });
}

export async function resolveTrack(input, requestedBy) {
  return (await resolveTracks(input, requestedBy))[0];
}

export async function resolveTracks(input, requestedBy) {
  if (isPlaylistUrl(input)) {
    const data = await runJson([
      '--dump-single-json', '--flat-playlist', '--playlist-end', '100',
      '--no-warnings', '--quiet', '--', input,
    ], 60_000);
    const tracks = (data.entries || []).map((item) => toTrack(item, requestedBy)).filter(Boolean);
    if (!tracks.length) throw new Error('Cette playlist YouTube est vide ou inaccessible.');
    return tracks;
  }

  const target = isYouTubeUrl(input) ? input : `ytsearch1:${input}`;
  const data = await runJson([
    '--dump-single-json', '--no-playlist', '--no-warnings', '--quiet', '--', target,
  ]);
  const item = data.entries?.find(Boolean) ?? data;
  const track = toTrack(item, requestedBy);
  if (!track) throw new Error('Aucun résultat YouTube trouvé.');
  return [track];
}

export async function findSimilarTrack(seed, excludedIds = new Set()) {
  const requestedBy = 'Lecture automatique';
  const excluded = new Set([...excludedIds, seed?.id].filter(Boolean));
  if (seed?.id) {
    try {
      const mixUrl = `https://www.youtube.com/watch?v=${seed.id}&list=RD${seed.id}`;
      const data = await runJson([
        '--dump-single-json', '--flat-playlist', '--playlist-end', '15',
        '--no-warnings', '--quiet', '--', mixUrl,
      ], 40_000);
      const candidate = (data.entries || [])
        .map((item) => toTrack(item, requestedBy))
        .find((track) => track && !excluded.has(track.id));
      if (candidate) return candidate;
    } catch (error) {
      console.warn(`Mix YouTube indisponible, recherche de secours: ${error.message}`);
    }
  }

  const query = [seed?.title, seed?.channel, 'musique similaire'].filter(Boolean).join(' ');
  const data = await runJson([
    '--dump-single-json', '--flat-playlist', '--playlist-end', '10',
    '--no-warnings', '--quiet', '--', `ytsearch10:${query}`,
  ], 35_000);
  const entries = data.entries || [data];
  const candidate = entries.map((item) => toTrack(item, requestedBy)).find((track) => track && !excluded.has(track.id));
  if (!candidate) throw new Error('Aucune musique similaire trouvée.');
  return candidate;
}

export function createDownload(track) {
  return spawn(config.ytDlpPath, [
    '--format', 'bestaudio/best', '--output', '-', '--no-playlist', '--no-warnings', '--quiet', '--', track.url,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
