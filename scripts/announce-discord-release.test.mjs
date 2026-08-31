import assert from 'node:assert/strict';
import test from 'node:test';
import { announceRelease, announcementPayload, validateWebhook, LOGO, MARKER, REPOSITORY, RESERVATION } from './announce-discord-release.mjs';

const TAG = 'v2.2.8';
const WEBHOOK_ID = '123456789012345678';
const CHANNEL_ID = '234567890123456789';
const MESSAGE_ID = '345678901234567890';
const WEBHOOK = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${'test-only-not-a-real-secret-'.repeat(3)}`;
const TOKEN = 'test-github-token-not-real';
const API = `https://api.github.com/repos/${REPOSITORY}`;
const UPLOAD = `https://uploads.github.com/repos/${REPOSITORY}/releases/42/assets`;
const response = (value, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

function fixture(overrides = {}) {
  let nextAssetId = 100;
  const state = {
    posts: 0, logs: [], requests: [], postedBody: null, postedPayload: null, markerBodies: {},
    discordStatus: 200, discordError: null, markerFailure: null,
    identity: { id: WEBHOOK_ID, channel_id: CHANNEL_ID, type: 1 },
    message: { id: MESSAGE_ID, channel_id: CHANNEL_ID, webhook_id: WEBHOOK_ID },
    release: {
      id: 42, tag_name: TAG, draft: false, prerelease: false,
      body: '- Webhooks par serveur\n- Annonces jaunes avec le logo',
      html_url: `https://github.com/${REPOSITORY}/releases/tag/${TAG}`,
      upload_url: `${UPLOAD}{?name,label}`, published_at: '2026-08-30T00:00:00Z',
    },
    assets: ['Inazuma-Music-2.2.8-x64-setup.exe', 'latest.yml'].map((name, index) => ({
      id: index + 1, name, state: 'uploaded', size: 1024,
      browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${TAG}/${name}`,
    })),
    ...overrides,
  };
  const fetchFn = async (url, options = {}) => {
    state.requests.push({ url, options });
    const method = options.method || 'GET';
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.startsWith(API) || url.startsWith(UPLOAD)) {
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    } else {
      assert.ok(!options.headers?.Authorization, 'GitHub credentials must never go to Discord');
    }
    if (url === `${API}/releases/tags/${TAG}` && method === 'GET') return response(state.release);
    if (url.startsWith(`${API}/releases/42/assets?`) && method === 'GET') return response(state.assets);
    if (url.startsWith(`${UPLOAD}?`) && method === 'POST') {
      const name = new URL(url).searchParams.get('name');
      if (state.markerFailure === name) return response({ secret: WEBHOOK }, 503);
      if (state.assets.some(asset => asset.name === name)) return response({}, 422);
      const asset = { id: nextAssetId++, name, state: 'uploaded', size: options.body.length };
      state.assets.push(asset);
      state.markerBodies[name] = JSON.parse(options.body);
      return response(asset, 201);
    }
    if (url.startsWith(`${API}/releases/assets/`) && method === 'DELETE') {
      const id = Number(url.split('/').at(-1));
      state.assets = state.assets.filter(asset => asset.id !== id);
      delete state.markerBodies[RESERVATION];
      return response(null, 204);
    }
    if (url === WEBHOOK && method === 'GET') return response(state.identity);
    if (url === `${WEBHOOK}?wait=true` && method === 'POST') {
      state.posts++;
      state.postedBody = options.body;
      state.postedPayload = JSON.parse(typeof options.body === 'string' ? options.body : options.body.get('payload_json'));
      if (state.discordError) throw state.discordError;
      return response(state.message, state.discordStatus);
    }
    throw new Error('Unexpected test request');
  };
  const options = {
    tag: TAG, repository: REPOSITORY, githubToken: TOKEN, webhook: WEBHOOK,
    fetchFn, assetsAttempts: 1, log: message => state.logs.push(message), now: () => '2026-08-30T01:00:00Z',
    sleep: async () => {},
  };
  return { state, options, run: changes => announceRelease({ ...options, ...changes }) };
}

test('yellow branded announcement, safe mentions and usable download links', () => {
  const { state } = fixture();
  const { payload, attachment } = announcementPayload({ ...state.release, assets: state.assets }, TAG);
  assert.equal(payload.username, 'Inazuma Music');
  assert.equal(payload.embeds[0].color, 0xf5b800);
  assert.equal(payload.embeds[0].thumbnail.url, LOGO);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.match(payload.embeds[0].fields[2].value, /Inazuma-Music-2\.2\.8-x64-setup\.exe/);
  assert.equal(payload.components, undefined);
  assert.equal(attachment, null);
});

test('success confirms Discord IDs and persists only nonsecret markers', async () => {
  const { state, run } = fixture();
  const result = await run();
  assert.equal(result.status, 'announced');
  assert.equal(state.posts, 1);
  assert.deepEqual(state.markerBodies[MARKER], {
    tag: TAG, messageId: MESSAGE_ID, channelId: CHANNEL_ID, time: '2026-08-30T01:00:00Z',
  });
  assert.deepEqual(Object.keys(state.markerBodies[RESERVATION]).sort(), ['tag', 'time']);
  for (const secret of [WEBHOOK, TOKEN]) {
    assert.ok(!JSON.stringify(state.markerBodies).includes(secret));
    assert.ok(!state.logs.join('\n').includes(secret));
  }
  const reservationIndex = state.requests.findIndex(item => item.url.includes(`name=${RESERVATION}`));
  const discordIndex = state.requests.findIndex(item => item.url === `${WEBHOOK}?wait=true`);
  assert.ok(reservationIndex < discordIndex, 'reserve before sending');
});

test('rerun after success skips without another Discord request', async () => {
  const { state, run } = fixture();
  await run();
  const requestsBefore = state.requests.length;
  assert.equal((await run()).status, 'already-announced');
  assert.equal(state.posts, 1);
  assert.ok(state.requests.slice(requestsBefore).every(item => !item.url.startsWith(WEBHOOK)));
});

test('long notes are attached intact as text with a compact embed', async () => {
  const { state, run } = fixture();
  state.release.body = 'Changement détaillé @everyone\n'.repeat(600);
  await run();
  assert.ok(state.postedBody instanceof FormData);
  assert.equal(await state.postedBody.get('files[0]').text(), state.release.body.trim());
  assert.ok(state.postedPayload.embeds[0].description.length <= 4096);
  assert.deepEqual(state.postedPayload.allowed_mentions, { parse: [] });
  assert.match(state.postedPayload.embeds[0].description, /changements complets/);
});

test('webhook validation rejects redirects, other hosts and secret-bearing unsafe forms', () => {
  for (const value of [
    '', WEBHOOK.replace('https:', 'http:'), WEBHOOK.replace('discord.com', 'discord.com.attacker.example'),
    WEBHOOK.replace('discord.com', 'discord.com:444'), WEBHOOK.replace('discord.com', 'user:pass@discord.com'),
    `${WEBHOOK}?wait=true`, `${WEBHOOK}#fragment`, `${WEBHOOK}/messages/1`, 'https://discord.com/api/webhooks/123/no',
  ]) {
    assert.throws(() => validateWebhook(value), error => !error.message.includes(value || TOKEN));
  }
  assert.equal(validateWebhook(WEBHOOK).href, WEBHOOK);
});

test('rejects a fork, unsafe tag or missing credentials without requests', async () => {
  for (const input of [{ repository: 'someone/fork' }, { tag: 'v2.2.8;echo secret' }, { githubToken: '' }, { webhook: '' }]) {
    const { state, run } = fixture();
    await assert.rejects(run(input));
    assert.equal(state.requests.length, 0);
  }
});

for (const field of ['draft', 'prerelease']) {
  test(`rejects ${field} releases`, async () => {
    const { state, run } = fixture();
    state.release[field] = true;
    await assert.rejects(run(), /versions officielles/);
    assert.equal(state.posts, 0);
  });
}

for (const assetName of ['Inazuma-Music-2.2.8-x64-setup.exe', 'latest.yml']) {
  test(`requires uploaded ${assetName} before sending or reserving`, async () => {
    const { state, run } = fixture();
    state.assets.find(asset => asset.name === assetName).state = 'starter';
    await assert.rejects(run(), /absent, incomplet ou invalide/);
    assert.equal(state.posts, 0);
    assert.deepEqual(state.markerBodies, {});
  });
}

test('waits for complete assets, then sends once', async () => {
  const { state, run } = fixture();
  state.assets[0].state = 'starter';
  let waits = 0;
  await run({ assetsAttempts: 2, sleep: async () => { waits++; state.assets[0].state = 'uploaded'; } });
  assert.equal(waits, 1);
  assert.equal(state.posts, 1);
});

test('rejects untrusted download and upload destinations', async () => {
  for (const kind of ['download', 'upload']) {
    const { state, run } = fixture();
    if (kind === 'download') state.assets[0].browser_download_url = 'https://attacker.example/setup.exe';
    else state.release.upload_url = 'https://attacker.example/assets{?name,label}';
    await assert.rejects(run());
    assert.equal(state.posts, 0);
    assert.ok(state.requests.every(item => !item.url.includes('attacker.example')));
  }
});

test('existing reservation blocks a potentially duplicate announcement', async () => {
  const { state, run } = fixture();
  state.assets.push({ name: RESERVATION, state: 'uploaded', size: 90 });
  await assert.rejects(run(), /déjà commencée/);
  assert.equal(state.posts, 0);
});

test('no Discord POST when the reservation cannot be persisted', async () => {
  const { state, run } = fixture({ markerFailure: RESERVATION });
  await assert.rejects(run(), /Enregistrement GitHub refusé/);
  assert.equal(state.posts, 0);
});

test('rejects a webhook with an unexpected identity before reservation', async () => {
  const { state, run } = fixture();
  state.identity.id = '999999999999999999';
  await assert.rejects(run(), /Identité ou salon/);
  assert.equal(state.posts, 0);
  assert.deepEqual(state.markerBodies, {});
});

for (const status of [400, 401, 403, 404, 429]) {
  test(`Discord ${status} releases the reservation and permits a corrected retry`, async () => {
    const { state, run } = fixture({ discordStatus: status });
    await assert.rejects(run(), /Aucun message créé/);
    assert.ok(!state.assets.some(asset => asset.name === RESERVATION));
    state.discordStatus = 200;
    assert.equal((await run()).status, 'announced');
    assert.equal(state.posts, 2);
  });
}

for (const status of [408, 500, 502]) {
  test(`ambiguous Discord ${status} retains reservation and blocks a second POST`, async () => {
    const { state, run } = fixture({ discordStatus: status });
    await assert.rejects(run(), /Réservation conservée/);
    await assert.rejects(run(), /déjà commencée/);
    assert.equal(state.posts, 1);
  });
}

test('network exception is sanitized and never blindly retried', async () => {
  const { state, run } = fixture({ discordError: new Error(`leaked URL: ${WEBHOOK} token ${TOKEN}`) });
  await assert.rejects(run(), error => {
    assert.match(error.message, /réponse réseau incertaine/);
    assert.ok(!error.message.includes(WEBHOOK) && !error.message.includes(TOKEN));
    return true;
  });
  await assert.rejects(run(), /déjà commencée/);
  assert.equal(state.posts, 1);
});

test('mismatched successful Discord response does not record success or resend', async () => {
  const { state, run } = fixture();
  state.message.channel_id = '999999999999999999';
  await assert.rejects(run(), /Message Discord non confirmé/);
  assert.equal(state.markerBodies[MARKER], undefined);
  await assert.rejects(run(), /déjà commencée/);
  assert.equal(state.posts, 1);
});

test('failure persisting the final marker does not allow another message', async () => {
  const { state, run } = fixture({ markerFailure: MARKER });
  await assert.rejects(run(), /Enregistrement GitHub refusé/);
  assert.equal(state.posts, 1);
  await assert.rejects(run(), /déjà commencée/);
  assert.equal(state.posts, 1);
  assert.equal(state.logs.filter(item => item.includes('annonce confirmée')).length, 0);
});

test('HTTP error bodies and rejected redirects cannot leak secrets in exceptions', async () => {
  const { run } = fixture();
  await assert.rejects(run({ fetchFn: async () => response({ url: WEBHOOK, token: TOKEN }, 403) }), error => {
    assert.equal(error.message, 'Lecture GitHub refusée (HTTP 403).');
    return true;
  });
  await assert.rejects(run({ fetchFn: async () => { throw new Error(WEBHOOK); } }), error => {
    assert.ok(!error.message.includes(WEBHOOK));
    return true;
  });
});
