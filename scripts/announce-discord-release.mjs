import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'NewaaDev/imazuma-music';
export const MARKER = 'discord-announcement.json';
export const RESERVATION = 'discord-announcement.pending.json';
export const LOGO = `https://raw.githubusercontent.com/${REPOSITORY}/feature/inazuma-v2/assets/icon.png`;
const API = `https://api.github.com/repos/${REPOSITORY}`;
const SNOWFLAKE = /^\d{17,20}$/;
const TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

// Only these deliberately written messages may reach logs. Never print fetch errors,
// request URLs, response bodies, environment variables, or the webhook/token.
export class AnnouncementError extends Error {}

function requireValue(condition, message) {
  if (!condition) throw new AnnouncementError(message);
}

export function validateWebhook(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new AnnouncementError('Secret DISCORD_RELEASE_WEBHOOK absent ou invalide.'); }
  requireValue(
    url.protocol === 'https:' && ['discord.com', 'discordapp.com'].includes(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && /^\/api\/(?:v10\/)?webhooks\/\d{17,20}\/[A-Za-z0-9_-]{20,200}$/.test(url.pathname),
    'Le secret doit contenir une URL HTTPS de webhook Discord valide, sans paramètres.',
  );
  return url;
}

function releaseLinks(release, tag) {
  const releaseUrl = `https://github.com/${REPOSITORY}/releases/tag/${tag}`;
  requireValue(release.html_url === releaseUrl, 'Lien de publication GitHub inattendu.');
  const setupName = `Inazuma-Music-${tag.slice(1)}-x64-setup.exe`;
  const setup = release.assets.find(asset => asset.name === setupName);
  const latest = release.assets.find(asset => asset.name === 'latest.yml');
  const ready = asset => asset && asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0
    && asset.browser_download_url === `https://github.com/${REPOSITORY}/releases/download/${tag}/${asset.name}`;
  return ready(setup) && ready(latest) ? { releaseUrl, setupUrl: setup.browser_download_url } : null;
}

export function announcementPayload(release, tag) {
  const links = releaseLinks(release, tag);
  requireValue(links, 'Installateur Windows ou latest.yml absent, incomplet ou invalide. Aucun message envoyé.');
  const notes = typeof release.body === 'string' && release.body.trim()
    ? release.body.trim() : 'Les détails de cette version sont disponibles sur la page de publication.';
  const attachment = notes.length > 3500 ? notes : null;
  const description = attachment
    ? `${notes.slice(0, 3400)}\n\n… Les changements complets sont joints dans le fichier texte et disponibles sur GitHub.`
    : notes;
  return {
    payload: {
      username: 'Inazuma Music',
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `⚡ Inazuma Music · ${tag.slice(1)}`,
        color: 0xf5b800,
        thumbnail: { url: LOGO },
        url: links.releaseUrl,
        description,
        fields: [
          { name: 'Version', value: tag.slice(1), inline: true },
          { name: 'Statut', value: 'OFFICIEL', inline: true },
          { name: 'Téléchargement', value: `[Installer Inazuma Music](${links.setupUrl})\n[Voir tous les changements](${links.releaseUrl})` },
        ],
        footer: { text: 'Inazuma Music · Nouvelle version disponible' },
        ...(release.published_at ? { timestamp: release.published_at } : {}),
      }],
      ...(attachment ? { attachments: [{ id: 0, filename: `Inazuma-Music-${tag.slice(1)}-changements.txt` }] } : {}),
    },
    attachment,
  };
}

export async function announceRelease({
  tag,
  repository = REPOSITORY,
  githubToken,
  webhook,
  fetchFn = fetch,
  sleep = delay,
  now = () => new Date().toISOString(),
  log = console.log,
  assetsAttempts = 20,
  assetsDelayMs = 15000,
  requestTimeoutMs = 15000,
}) {
  requireValue(repository === REPOSITORY, 'Ce workflow est réservé au dépôt officiel Inazuma Music.');
  requireValue(typeof tag === 'string' && TAG.test(tag), 'Version invalide : utiliser un tag officiel vX.Y.Z.');
  requireValue(typeof githubToken === 'string' && githubToken.trim(), 'Jeton GitHub absent.');
  requireValue(Number.isInteger(assetsAttempts) && assetsAttempts > 0 && assetsAttempts <= 20, 'Nombre de vérifications invalide.');
  const webhookUrl = validateWebhook(webhook);
  const githubHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Inazuma-Music-release-announcer',
  };
  async function request(url, options, label) {
    try {
      return await fetchFn(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch {
      throw new AnnouncementError(`${label} : réponse réseau incertaine. Aucun renvoi automatique ; vérifier avant de relancer.`);
    }
  }
  async function json(response, label) {
    try { return await response.json(); } catch { throw new AnnouncementError(`${label} : réponse invalide. Aucun renvoi automatique.`); }
  }
  async function githubGet(url) {
    const response = await request(url, { headers: githubHeaders }, 'Lecture GitHub');
    requireValue(response.ok, `Lecture GitHub refusée (HTTP ${response.status}).`);
    return json(response, 'Lecture GitHub');
  }
  async function allAssets(releaseId) {
    const assets = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await githubGet(`${API}/releases/${releaseId}/assets?per_page=100&page=${page}`);
      requireValue(Array.isArray(batch), 'Liste des fichiers GitHub invalide.');
      assets.push(...batch);
      if (batch.length < 100) return assets;
    }
    throw new AnnouncementError('Trop de fichiers dans cette publication ; vérification manuelle nécessaire.');
  }

  let release;
  for (let attempt = 0; attempt < assetsAttempts; attempt++) {
    release = await githubGet(`${API}/releases/tags/${encodeURIComponent(tag)}`);
    requireValue(release && Number.isSafeInteger(release.id) && release.id > 0 && release.tag_name === tag,
      'Publication GitHub invalide.');
    requireValue(release.draft === false && release.prerelease === false && Boolean(release.published_at),
      'Seules les versions officielles publiées peuvent être annoncées.');
    release.assets = await allAssets(release.id);
    const marker = release.assets.find(asset => asset.name === MARKER);
    if (marker) {
      requireValue(marker.state === 'uploaded' && marker.size > 0,
        'Marqueur d’annonce incomplet ; vérifier Discord avant toute reprise.');
      log(`Inazuma Music ${tag} : annonce déjà enregistrée, aucun doublon envoyé.`);
      return { status: 'already-announced', tag };
    }
    requireValue(!release.assets.some(asset => asset.name === RESERVATION),
      'Annonce déjà commencée sans confirmation finale. Vérifier Discord et la réservation avant toute reprise.');
    if (releaseLinks(release, tag)) break;
    requireValue(attempt + 1 < assetsAttempts,
      'Installateur Windows ou latest.yml absent, incomplet ou invalide. Aucun message envoyé.');
    log(`Inazuma Music ${tag} : attente de la fin du transfert des fichiers Windows.`);
    await sleep(assetsDelayMs);
  }

  const uploadBase = `https://uploads.github.com/repos/${REPOSITORY}/releases/${release.id}/assets`;
  requireValue(release.upload_url === `${uploadBase}{?name,label}`, 'Adresse de transfert GitHub inattendue.');
  const { payload, attachment } = announcementPayload(release, tag);
  const identityResponse = await request(webhookUrl.href, { method: 'GET' }, 'Vérification Discord');
  requireValue(identityResponse.ok, `Webhook Discord inaccessible (HTTP ${identityResponse.status}).`);
  const identity = await json(identityResponse, 'Vérification Discord');
  requireValue(identity && identity.type === 1 && SNOWFLAKE.test(identity.channel_id)
    && identity.id === webhookUrl.pathname.split('/').at(-2), 'Identité ou salon du webhook Discord invalide.');

  async function uploadMarker(name, value) {
    const response = await request(`${uploadBase}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { ...githubHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }, 'Enregistrement GitHub');
    requireValue(response.status === 201,
      `Enregistrement GitHub refusé (HTTP ${response.status}). Ne pas renvoyer l’annonce sans vérifier les marqueurs.`);
    const asset = await json(response, 'Enregistrement GitHub');
    requireValue(asset && Number.isSafeInteger(asset.id) && asset.id > 0 && asset.name === name
      && asset.state === 'uploaded' && asset.size > 0, 'Marqueur GitHub non confirmé. Vérification manuelle nécessaire.');
    return asset;
  }

  // Reserve before sending: a lost Discord response or crash cannot turn a rerun
  // into a duplicate. A leftover reservation requires human verification.
  const reservation = await uploadMarker(RESERVATION, { tag, time: now() });
  const postUrl = new URL(webhookUrl.href);
  postUrl.searchParams.set('wait', 'true');
  let body = JSON.stringify(payload);
  let headers = { 'Content-Type': 'application/json' };
  if (attachment) {
    body = new FormData();
    body.set('payload_json', JSON.stringify(payload));
    body.set('files[0]', new Blob([attachment], { type: 'text/plain;charset=utf-8' }), payload.attachments[0].filename);
    headers = {};
  }
  const response = await request(postUrl.href, { method: 'POST', headers, body }, 'Envoi Discord');
  if (!response.ok) {
    // Explicit rejection means Discord did not create the message. A timeout,
    // 408, 5xx, malformed success or transport error remains ambiguous: retain lock.
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      const cleanup = await request(`${API}/releases/assets/${reservation.id}`, {
        method: 'DELETE', headers: githubHeaders,
      }, 'Libération de la réservation');
      requireValue(cleanup.status === 204, 'Discord a refusé le message, mais la réservation reste à vérifier.');
      throw new AnnouncementError(`Discord a refusé le message (HTTP ${response.status}). Aucun message créé ; relance possible après correction.`);
    }
    throw new AnnouncementError(`Envoi Discord non confirmé (HTTP ${response.status}). Réservation conservée ; vérifier avant de relancer.`);
  }
  const message = await json(response, 'Confirmation Discord');
  requireValue(message && SNOWFLAKE.test(message.id) && message.channel_id === identity.channel_id
    && message.webhook_id === identity.id, 'Message Discord non confirmé. Réservation conservée ; vérifier avant de relancer.');
  const marker = { tag, messageId: message.id, channelId: message.channel_id, time: now() };
  await uploadMarker(MARKER, marker);
  log(`Inazuma Music ${tag} : annonce confirmée dans le salon ${marker.channelId}, message ${marker.messageId}.`);
  return { status: 'announced', ...marker };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  announceRelease({
    tag: process.env.RELEASE_TAG,
    repository: process.env.GITHUB_REPOSITORY,
    githubToken: process.env.GITHUB_TOKEN,
    webhook: process.env.DISCORD_RELEASE_WEBHOOK,
  }).catch(error => {
    console.error(error instanceof AnnouncementError ? error.message : 'Annonce interrompue. Vérifier les marqueurs avant de relancer.');
    process.exitCode = 1;
  });
}
