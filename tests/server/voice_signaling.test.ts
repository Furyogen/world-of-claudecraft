import { describe, expect, it } from 'vitest';
import { nearestVoicePeers, VOICE_PEER_CAP, voicePeerLists } from '../../server/voice_signaling';

describe('nearestVoicePeers', () => {
  it('excludes self and sorts closest first', () => {
    const self = { pid: 1, name: 'Self', x: 0, z: 0 };
    const others = [
      { pid: 2, name: 'Far', x: 100, z: 0 },
      { pid: 3, name: 'Near', x: 5, z: 0 },
      { pid: 1, name: 'DuplicateSelfId', x: 1, z: 1 },
    ];
    const peers = nearestVoicePeers(self, others);
    expect(peers).toEqual([
      { pid: 3, name: 'Near' },
      { pid: 2, name: 'Far' },
    ]);
  });

  it('caps at the given limit, closest kept', () => {
    const self = { pid: 0, name: 'Self', x: 0, z: 0 };
    const others = Array.from({ length: 12 }, (_, i) => ({
      pid: i + 1,
      name: `P${i + 1}`,
      x: i + 1,
      z: 0,
    }));
    const peers = nearestVoicePeers(self, others, 8);
    expect(peers).toHaveLength(8);
    expect(peers.map((p) => p.pid)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('defaults the cap to VOICE_PEER_CAP', () => {
    const self = { pid: 0, name: 'Self', x: 0, z: 0 };
    const others = Array.from({ length: 20 }, (_, i) => ({
      pid: i + 1,
      name: `P${i + 1}`,
      x: i + 1,
      z: 0,
    }));
    expect(nearestVoicePeers(self, others)).toHaveLength(VOICE_PEER_CAP);
  });

  it('breaks distance ties by lower pid for a stable order', () => {
    const self = { pid: 0, name: 'Self', x: 0, z: 0 };
    const others = [
      { pid: 5, name: 'A', x: 3, z: 4 },
      { pid: 2, name: 'B', x: 3, z: 4 },
    ];
    expect(nearestVoicePeers(self, others).map((p) => p.pid)).toEqual([2, 5]);
  });
});

describe('voicePeerLists', () => {
  it('emits only mutual peer relationships in crowded groups', () => {
    const candidates = [
      { pid: 1, name: 'One', x: 0, z: 0 },
      { pid: 2, name: 'Two', x: 1, z: 0 },
      { pid: 3, name: 'Three', x: 2, z: 0 },
      { pid: 4, name: 'Four', x: 3, z: 0 },
    ];
    const lists = voicePeerLists(candidates, 1);

    for (const [pid, peers] of lists) {
      for (const peer of peers) {
        expect(lists.get(peer.pid)?.some((other) => other.pid === pid)).toBe(true);
      }
    }
    expect(lists.get(1)).toEqual([{ pid: 2, name: 'Two' }]);
    expect(lists.get(2)).toEqual([{ pid: 1, name: 'One' }]);
    expect(lists.get(3)).toEqual([{ pid: 4, name: 'Four' }]);
    expect(lists.get(4)).toEqual([{ pid: 3, name: 'Three' }]);
  });

  it('never exceeds the per-player cap', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      pid: i + 1,
      name: `P${i + 1}`,
      x: i,
      z: 0,
    }));
    const lists = voicePeerLists(candidates, 3);

    for (const peers of lists.values()) {
      expect(peers.length).toBeLessThanOrEqual(3);
    }
  });
});
