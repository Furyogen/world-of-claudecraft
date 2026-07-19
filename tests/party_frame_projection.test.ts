import { describe, expect, it } from 'vitest';
import {
  PartyFrameProjectionCache,
  type PartyFrameProjectionParty,
} from '../server/party_frame_projection';
import type { Aura } from '../src/sim/types';

function aura(partial: Partial<Aura> & Pick<Aura, 'id' | 'kind'>): Aura {
  return {
    name: partial.id,
    remaining: 10,
    duration: 10,
    value: 1,
    sourceId: 1,
    school: 'holy',
    ...partial,
  } as Aura;
}

const party: PartyFrameProjectionParty = {
  id: 7,
  leader: 11,
  raid: true,
  master: { enabled: true, looter: 11, threshold: 'rare' },
  members: [11, 22, 33],
};

describe('PartyFrameProjectionCache', () => {
  it('projects each member once per broadcast while preserving viewer-owned Echo auras', () => {
    const cache = new PartyFrameProjectionCache();
    let memberProjections = 0;
    let hp = 900;
    const projectMember = (pid: number) => {
      memberProjections++;
      return {
        member: {
          pid,
          name: `Player ${pid}`,
          cls: 'mage' as const,
          level: 60,
          hp,
          mhp: 1_000,
          res: 80,
          mres: 100,
          rtype: 'mana' as const,
          x: pid,
          z: -pid,
          dead: 0,
          inCombat: 1,
          group: 1 as const,
          absorb: 25,
          role: 'healer' as const,
          rewind: 100,
          connected: 1,
          hasAggro: 0,
          incomingHeal: 200,
        },
        auras: [
          aura({ id: 'rend', kind: 'dot', value: 5, sourceId: 99 }),
          aura({
            id: 'temporal_echo',
            kind: 'temporal_echo',
            value: 0,
            sourceId: 11,
            remaining: 11.1,
          }),
          aura({
            id: 'temporal_echo',
            kind: 'temporal_echo',
            value: 0,
            sourceId: 22,
            remaining: 22.1,
          }),
          aura({ id: 'renew', kind: 'hot', value: 20, sourceId: 33 }),
          ...Array.from({ length: 7 }, (_, index) =>
            aura({ id: `hot_${index}`, kind: 'hot', value: 20, sourceId: 33 }),
          ),
        ],
      };
    };

    cache.beginBroadcast();
    const forEleven = cache.forViewer(party, 11, projectMember);
    const forTwentyTwo = cache.forViewer(party, 22, projectMember);
    const forThirtyThree = cache.forViewer(party, 33, projectMember);

    // Three viewers of a three-person party must perform three common member
    // projections, not the previous 3 x 3 history/aura projection work.
    expect(memberProjections).toBe(party.members.length);
    expect(forEleven.members[0].auras).toEqual([
      { id: 'rend', kind: 'dot', remaining: 10 },
      { id: 'temporal_echo', kind: 'temporal_echo', remaining: 12 },
      { id: 'renew', kind: 'hot', remaining: 10 },
      { id: 'hot_0', kind: 'hot', remaining: 10 },
      { id: 'hot_1', kind: 'hot', remaining: 10 },
      { id: 'hot_2', kind: 'hot', remaining: 10 },
      { id: 'hot_3', kind: 'hot', remaining: 10 },
      { id: 'hot_4', kind: 'hot', remaining: 10 },
    ]);
    expect(forTwentyTwo.members[0].auras).toEqual([
      { id: 'rend', kind: 'dot', remaining: 10 },
      { id: 'temporal_echo', kind: 'temporal_echo', remaining: 23 },
      { id: 'renew', kind: 'hot', remaining: 10 },
      { id: 'hot_0', kind: 'hot', remaining: 10 },
      { id: 'hot_1', kind: 'hot', remaining: 10 },
      { id: 'hot_2', kind: 'hot', remaining: 10 },
      { id: 'hot_3', kind: 'hot', remaining: 10 },
      { id: 'hot_4', kind: 'hot', remaining: 10 },
    ]);
    expect(forThirtyThree.members[0].auras).toEqual([
      { id: 'rend', kind: 'dot', remaining: 10 },
      { id: 'renew', kind: 'hot', remaining: 10 },
      { id: 'hot_0', kind: 'hot', remaining: 10 },
      { id: 'hot_1', kind: 'hot', remaining: 10 },
      { id: 'hot_2', kind: 'hot', remaining: 10 },
      { id: 'hot_3', kind: 'hot', remaining: 10 },
      { id: 'hot_4', kind: 'hot', remaining: 10 },
      { id: 'hot_5', kind: 'hot', remaining: 10 },
    ]);

    // A second broadcast can happen without a sim tick. It must rebuild from
    // live state rather than reuse the previous broadcast's projection.
    hp = 700;
    cache.beginBroadcast();
    const nextBroadcast = cache.forViewer(party, 11, projectMember);
    expect(memberProjections).toBe(party.members.length * 2);
    expect(nextBroadcast.members[0].hp).toBe(700);
  });
});
