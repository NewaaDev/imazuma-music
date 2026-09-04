import test from 'node:test';
import assert from 'node:assert/strict';
import { existingReleaseMessage, releaseAnnouncement } from '../src/release-announcer.js';

test('construit une annonce Inazuma avec la version et les changements', () => {
  const payload = releaseAnnouncement({ version: '2.2.2', changes: ['Correction écran noir', 'Import YouTube'], downloadUrl: 'https://example.com/release' });
  assert.equal(payload.embeds[0].data.title, '⚡ Mise à jour 2.2.2');
  assert.match(payload.embeds[0].data.description, /Correction écran noir/);
  assert.equal(payload.embeds[0].data.url, 'https://example.com/release');
});

test('refuse un manifeste incomplet', () => {
  assert.equal(releaseAnnouncement({ version: '2.2.2', changes: [] }), null);
});

test('conserve une annonce encore présente et répare seulement une annonce réellement absente', async () => {
  const release = { version: '2.2.9' };
  const state = { version: '2.2.9', channelId: '123', messageId: '456' };
  const message = { id: '456' };
  assert.equal(await existingReleaseMessage({ id: '123', messages: { fetch: async () => message } }, state, release), message);
  assert.equal(await existingReleaseMessage({ id: '123', messages: { fetch: async () => { const error = new Error('Unknown Message'); error.code = 10008; throw error; } } }, state, release), null);
  await assert.rejects(existingReleaseMessage({ id: '123', messages: { fetch: async () => { throw new Error('Discord indisponible'); } } }, state, release), /Discord indisponible/);
});
