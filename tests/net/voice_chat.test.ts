import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../../src/net/online';
import { diffVoicePeers } from '../../src/net/voice_chat';

interface BareVoiceClient {
  ws: {
    readyState: number;
    send(raw: string): void;
  };
  connected: boolean;
  cfg: Record<string, unknown>;
  reconnectAttempts: number;
  voice: { isEnabled(): boolean };
  onMessage(raw: string): void;
}

describe('diffVoicePeers', () => {
  it('reports newly added peers', () => {
    const { added, removed } = diffVoicePeers(new Set(), [{ pid: 1 }, { pid: 2 }]);
    expect(added.sort()).toEqual([1, 2]);
    expect(removed).toEqual([]);
  });

  it('reports peers dropped from the server list', () => {
    const { added, removed } = diffVoicePeers(new Set([1, 2, 3]), [{ pid: 2 }]);
    expect(added).toEqual([]);
    expect(removed.sort()).toEqual([1, 3]);
  });

  it('is a no-op when the set is unchanged', () => {
    const { added, removed } = diffVoicePeers(new Set([1, 2]), [{ pid: 1 }, { pid: 2 }]);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('handles simultaneous add and remove', () => {
    const { added, removed } = diffVoicePeers(new Set([1, 2]), [{ pid: 2 }, { pid: 3 }]);
    expect(added).toEqual([3]);
    expect(removed).toEqual([1]);
  });
});

describe('ClientWorld voice opt-in', () => {
  it('resends active voice opt-in after the server hello binds a fresh session', () => {
    const g = globalThis as Record<string, unknown>;
    const prevWebSocket = g.WebSocket;
    g.WebSocket = { OPEN: 1 };
    try {
      const sent: unknown[] = [];
      const client = Object.create(ClientWorld.prototype) as BareVoiceClient;
      client.ws = {
        readyState: 1,
        send(raw: string) {
          sent.push(JSON.parse(raw));
        },
      };
      client.connected = false;
      client.cfg = {};
      client.reconnectAttempts = 0;
      client.voice = { isEnabled: () => true };

      client.onMessage(JSON.stringify({ t: 'hello', pid: 7, seed: 1234 }));

      expect(sent).toEqual([{ t: 'voiceoptin', on: true }]);
    } finally {
      g.WebSocket = prevWebSocket;
    }
  });
});
