import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';

// Exercise the real App component and its handlers; no Electron, browser,
// Discord connection, real timers, or YouTube/network requests are started.
const require = createRequire(import.meta.url);
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(appSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const track = (id, channel = 'Test artist') => ({ id, title: `Track ${id}`, channel, thumbnail: '', duration: '3:00', source: 'youtube' });

async function fixture(t, overrides = {}) {
  const messages = [], sockets = [], savedLibraries = [], configWrites = [], timers = new Map(), events = new Map();
  let nextTimer = 0, mediaListener, renderer;
  let savedConfig = {
    wsUrl: 'wss://test.invalid/ws', apiToken: 'test-only', demoMode: false, theme: 'inazuma',
    playbackTarget: 'discord', autoRadio: false, discordClientId: '123456789012345678',
    discordUserId: '234567890123456789', discordUserName: 'Test user', discordAvatar: '',
    preferredGuildId: '345678901234567890', preferredTextChannelId: '', releaseChannelId: '',
    autoJoin: true, autoLeave: true, controlMode: 'shared', allowedRoleIds: '',
    audioPreset: 'normal', normalizeVolume: true, crossfadeSeconds: 3, ...overrides.config,
  };
  const library = { history: [], playlists: [], favorites: [], pinned: [], searchHistory: [], stats: { totalSeconds: 0, tracksPlayed: 0, playCount: {}, lastPlayedAt: 0 } };
  const schedule = (fn, delay, interval = false) => { const id = ++nextTimer; timers.set(id, { fn, delay, interval }); return id; };
  const noop = () => {};
  const document = {
    documentElement: { dataset: {} }, addEventListener: noop, removeEventListener: noop,
    createElement(tag) {
      assert.equal(tag, 'textarea', 'The headless tests must never create a media player');
      return { innerHTML: '', get value() { return this.innerHTML; } };
    },
  };
  const window = {
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: id => timers.delete(id),
    addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener: (name, fn) => events.get(name)?.delete(fn),
    dispatchEvent: event => { for (const fn of events.get(event.type) || []) fn(event); return true; },
    newaa: {
      getConfig: async () => savedConfig,
      setConfig: async value => {
        configWrites.push(plain(value));
        savedConfig = overrides.setConfig ? await overrides.setConfig(value) : value;
        return savedConfig;
      },
      getLibrary: async () => library,
      saveLibrary: async value => { savedLibraries.push(plain(value)); return value; },
      onBotLog: () => noop, onUpdate: () => noop,
      onMediaCommand: fn => { mediaListener = fn; return () => { if (mediaListener === fn) mediaListener = undefined; }; },
      updatePresence: async () => {}, notifyTrack: async () => {},
      searchYouTube: overrides.searchYouTube || (async () => ({ items: [], nextPageToken: '' })),
    },
  };
  class FakeWebSocket {
    static OPEN = 1;
    readyState = FakeWebSocket.OPEN;
    constructor(url) { assert.equal(url, 'wss://test.invalid/ws'); sockets.push(this); }
    send(value) { messages.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
  }
  const icons = new Proxy({}, { get: (_target, name) => props => React.createElement('svg', { ...props, 'data-icon': String(name) }) });
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, console, window, document, WebSocket: FakeWebSocket,
    location: { search: '' }, URLSearchParams, URL,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    require(name) {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return icons;
      if (name === '../assets/inazuma-raimon.png') return { default: 'test-logo.png', __esModule: true };
      if (name === './youtube-player') return { loadYouTubeIframeApi: () => { throw new Error('No real media is allowed in this test'); }, YOUTUBE_CLIENT_IDENTITY: 'https://test.invalid', youtubePlaybackError: String };
      throw new Error(`Unmocked App dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, sandbox, { filename: 'App.test.cjs' });
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.default)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const component = name => renderer.root.find(node => typeof node.type === 'function' && node.type.name === name);
  const perform = async fn => { await act(async () => { await fn(); }); };
  const socket = sockets.at(-1);
  await perform(() => socket.onopen());
  const remote = {
    connected: true, botOnline: true, guildId: savedConfig.preferredGuildId, guildName: 'Test server',
    voiceChannel: 'Shared voice', current: track('discord-current'), queue: [track('discord-next')], playing: true,
    elapsed: 42, position: 23, volume: 61, loop: 'off',
  };
  await perform(() => socket.onmessage({ data: JSON.stringify({ type: 'state', payload: remote }) }));
  messages.length = 0;
  return {
    messages, timers, remote, savedLibraries, configWrites,
    component, perform,
    engine: () => component('LocalPlayerEngine').props,
    player: () => component('Player').props,
    choose: target => perform(() => component('OutputPicker').props.change(target)),
    command: (action, payload) => perform(() => component('Player').props.send(action, payload)),
    media: action => perform(() => mediaListener(action)),
    assertNoRemoteCommands() { assert.deepEqual(messages.filter(item => item.type === 'command'), []); },
  };
}

test('choosing Application does not stop or disconnect the shared Discord player', async t => {
  const f = await fixture(t);
  await f.choose('local');
  f.assertNoRemoteCommands();
  await f.choose('discord');
  assert.deepEqual(plain(f.player().state.current), f.remote.current);
  assert.deepEqual(plain(f.player().state.queue), f.remote.queue);
  assert.equal(f.player().state.playing, true);
  assert.equal(f.player().state.voiceChannel, 'Shared voice');
});

test('local track, queue, play state and elapsed time survive both output switches', async t => {
  const f = await fixture(t);
  await f.choose('local');
  await f.command('play_now', track('local-current'));
  await f.command('enqueue', track('local-next'));
  await f.perform(() => f.engine().progress(37, 180));
  await f.choose('discord');
  assert.equal(f.engine().state.current.id, 'local-current');
  assert.deepEqual(plain(f.engine().state.queue), [track('local-next')]);
  assert.equal(f.engine().state.playing, true);
  assert.equal(f.engine().state.elapsed, 37);
  assert.notEqual(f.engine().enabled, false, 'Changing the control target must not disable the local engine');
  await f.choose('local');
  assert.equal(f.player().state.current.id, 'local-current');
  assert.equal(f.player().state.elapsed, 37);
  f.assertNoRemoteCommands();
});

test('local end event while Discord is selected advances only the local queue', async t => {
  const f = await fixture(t);
  await f.choose('local');
  await f.command('play_now', track('local-current'));
  await f.command('enqueue', track('local-next'));
  await f.choose('discord');
  await f.perform(() => f.engine().ended());
  assert.equal(f.engine().state.current.id, 'local-next');
  assert.deepEqual(plain(f.engine().state.queue), []);
  assert.deepEqual(plain(f.player().state.current), f.remote.current);
  assert.deepEqual(plain(f.player().state.queue), f.remote.queue);
  f.assertNoRemoteCommands();
});

test('local seek, skip and stop never change the remote player', async t => {
  const f = await fixture(t);
  await f.choose('local');
  await f.command('play_now', track('local-current'));
  await f.command('enqueue', track('local-next'));
  await f.command('seek', 90);
  assert.equal(f.player().state.elapsed, 90);
  await f.command('skip');
  assert.equal(f.player().state.current.id, 'local-next');
  await f.command('stop');
  assert.equal(f.player().state.current, null);
  await f.choose('discord');
  assert.deepEqual(plain(f.player().state.current), f.remote.current);
  assert.deepEqual(plain(f.player().state.queue), f.remote.queue);
  f.assertNoRemoteCommands();
});

test('after-this-track sleep timer cannot stop the other player on output switch', async t => {
  const f = await fixture(t);
  const select = f.component('SleepTimer').findByType('select');
  await f.perform(() => select.props.onChange({ target: { value: 'track' } }));
  await f.choose('local');
  assert.equal(f.component('SleepTimer').findByType('select').props.value, 'off');
  await f.command('play_now', track('local-current'));
  const localSelect = f.component('SleepTimer').findByType('select');
  await f.perform(() => localSelect.props.onChange({ target: { value: 'track' } }));
  await f.choose('discord');
  assert.equal(f.component('SleepTimer').findByType('select').props.value, 'off');
  assert.equal(f.player().state.current.id, 'discord-current');
  f.assertNoRemoteCommands();
});

test('a pending local radio result cannot restart music after explicit stop', async t => {
  const searches = [];
  const f = await fixture(t, {
    config: { autoRadio: true },
    searchYouTube: () => new Promise(resolve => searches.push(resolve)),
  });
  await f.choose('local');
  await f.command('play_now', track('local-current'));
  assert.ok(searches.length > 0, 'The real App should prefetch similar songs');
  await f.command('skip');
  await f.command('stop');
  await f.perform(() => { for (const resolve of searches) resolve({ items: [track('recommended-next', 'Other artist')], nextPageToken: '' }); });
  assert.equal(f.engine().state.current, null);
  assert.equal(f.engine().state.playing, false);
  f.assertNoRemoteCommands();
});

test('multimedia skip uses the latest local queue instead of stale radio state', async t => {
  const f = await fixture(t, { config: { autoRadio: true } });
  await f.choose('local');
  await f.command('play_now', track('local-current'));
  await f.command('enqueue', track('queued-next'));
  await f.media('skip');
  assert.equal(f.engine().state.current.id, 'queued-next');
  assert.deepEqual(plain(f.engine().state.queue), []);
  f.assertNoRemoteCommands();
});

test('a local track completed while controlling Discord is saved to persistent history', async t => {
  const f = await fixture(t);
  await f.choose('local');
  await f.command('play_now', track('background-local'));
  await f.command('enqueue', track('background-next'));
  await f.perform(() => f.engine().progress(170, 180));
  await f.choose('discord');
  await f.perform(() => f.engine().ended());
  assert.equal(f.engine().state.current.id, 'background-next');
  assert.ok(f.savedLibraries.some(saved => saved.history.some(item => item.id === 'background-local')),
    'The real saveLibrary IPC must receive tracks completed by the background local engine');
  const saved = f.savedLibraries.at(-1);
  assert.equal(saved.stats.playCount['background-local'], 1);
  assert.equal(saved.stats.tracksPlayed, 1);
  assert.equal(saved.stats.totalSeconds, 170);
  assert.deepEqual(plain(f.player().state.current), f.remote.current);
  f.assertNoRemoteCommands();
});

test('switching the selected output alone creates no history entries or listening counts', async t => {
  const f = await fixture(t);
  await f.choose('local');
  await f.command('play_now', track('still-playing-local'));
  await f.perform(() => f.engine().progress(70, 180));
  const saveCount = f.savedLibraries.length;
  await f.choose('discord');
  await f.choose('local');
  await f.choose('discord');
  assert.equal(f.savedLibraries.length, saveCount, 'Viewing the other player is not a completed listen');
  assert.equal(f.engine().state.current.id, 'still-playing-local');
  assert.deepEqual(plain(f.player().state.current), f.remote.current);
  f.assertNoRemoteCommands();
});

test('failed config save leaves output and both players untouched and unlocks the picker', async t => {
  const f = await fixture(t, { setConfig: async () => { throw new Error('Test-only disk failure'); } });
  await f.choose('local');
  assert.equal(f.component('OutputPicker').props.value, 'discord');
  assert.equal(f.component('OutputPicker').props.disabled, false);
  assert.deepEqual(plain(f.player().state.current), f.remote.current);
  assert.deepEqual(plain(f.player().state.queue), f.remote.queue);
  assert.equal(f.engine().state.current, null);
  assert.equal(f.configWrites.length, 1);
  f.assertNoRemoteCommands();
});

test('rapid repeated output clicks cannot race two config writes or touch playback', async t => {
  let resolveWrite;
  const f = await fixture(t, { setConfig: value => new Promise(resolve => { resolveWrite = () => resolve(value); }) });
  let changeFinished;
  await f.perform(() => { changeFinished = f.component('OutputPicker').props.change('local'); });
  assert.equal(f.component('OutputPicker').props.disabled, true);
  await f.perform(() => {
    f.component('OutputPicker').props.change('local');
    f.component('OutputPicker').props.change('discord');
  });
  assert.equal(f.configWrites.length, 1);
  await f.perform(() => { resolveWrite(); return changeFinished; });
  assert.equal(f.component('OutputPicker').props.value, 'local');
  assert.equal(f.component('OutputPicker').props.disabled, false);
  assert.equal(f.configWrites.length, 1);
  assert.equal(f.engine().state.current, null);
  f.assertNoRemoteCommands();
});
