import { WebSocket } from 'ws';
import { config } from './config.js';

export function createRemoteRelay() {
  if (!config.remoteRelayUrl || !config.remoteRelayToken) return { close() {} };
  let remote = null;
  let local = null;
  let stopped = false;
  let reconnectTimer = null;

  function connectLocal() {
    if (stopped || local?.readyState === WebSocket.OPEN || local?.readyState === WebSocket.CONNECTING) return;
    local = new WebSocket(`ws://127.0.0.1:${config.desktopPort}`);
    local.on('open', () => local.send(JSON.stringify({ type: 'auth', token: config.desktopToken })));
    local.on('message', (data) => {
      if (remote?.readyState === WebSocket.OPEN) remote.send(String(data));
    });
    local.on('close', () => { local = null; if (!stopped) setTimeout(connectLocal, 2_000); });
    local.on('error', () => local?.close());
  }

  function connectRemote() {
    if (stopped) return;
    remote = new WebSocket(config.remoteRelayUrl);
    remote.on('open', () => remote.send(JSON.stringify({ type: 'auth', token: config.remoteRelayToken, role: 'bot' })));
    remote.on('message', (data) => {
      try {
        const message = JSON.parse(String(data));
        if (message.type === 'event' && message.event === 'authenticated') { connectLocal(); return; }
      } catch {}
      if (local?.readyState === WebSocket.OPEN) local.send(data);
    });
    remote.on('close', () => {
      remote = null;
      if (!stopped) reconnectTimer = setTimeout(connectRemote, 3_000);
    });
    remote.on('error', () => remote?.close());
  }

  connectRemote();
  console.log(`Relais distant NEWAA Music : ${config.remoteRelayUrl}`);
  return {
    close() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      local?.close();
      remote?.close();
    },
  };
}
