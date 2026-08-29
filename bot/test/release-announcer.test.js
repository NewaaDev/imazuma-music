import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseAnnouncement } from '../src/release-announcer.js';

test('construit une annonce Inazuma avec la version et les changements', () => {
  const payload = releaseAnnouncement({ version: '2.2.2', changes: ['Correction écran noir', 'Import YouTube'], downloadUrl: 'https://example.com/release' });
  assert.equal(payload.embeds[0].data.title, '⚡ Mise à jour 2.2.2');
  assert.match(payload.embeds[0].data.description, /Correction écran noir/);
  assert.equal(payload.embeds[0].data.url, 'https://example.com/release');
});

test('refuse un manifeste incomplet', () => {
  assert.equal(releaseAnnouncement({ version: '2.2.2', changes: [] }), null);
});
