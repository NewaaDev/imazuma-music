import test from 'node:test';
import assert from 'node:assert/strict';
import { isYouTubeUrl } from '../src/services/youtube.js';

test('accepte uniquement les URL HTTPS YouTube prévues', () => {
  assert.equal(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
  assert.equal(isYouTubeUrl('https://music.youtube.com/watch?v=abc'), true);
  assert.equal(isYouTubeUrl('http://youtube.com/watch?v=abc'), false);
  assert.equal(isYouTubeUrl('https://youtube.com.example.org/watch?v=abc'), false);
  assert.equal(isYouTubeUrl('un titre de chanson'), false);
});
