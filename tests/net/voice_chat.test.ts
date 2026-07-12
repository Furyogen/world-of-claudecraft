import { describe, expect, it } from 'vitest';
import { diffVoicePeers } from '../../src/net/voice_chat';

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
