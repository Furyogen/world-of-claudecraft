import { describe, expect, it } from 'vitest';
import { type ClaudiumNativeConfirm, confirmNativeSettlement } from '../src/net/economy_sdk';

describe('confirmNativeSettlement', () => {
  it('retries while a native payment is not finalized yet', async () => {
    const results: ClaudiumNativeConfirm[] = [
      { settled: false, balance: null, reason: 'not_found_onchain' },
      { settled: false, balance: null, reason: 'not_finalized' },
      { settled: false, balance: null, reason: 'unavailable' },
      { settled: true, balance: 300, reason: null },
    ];
    const calls: Array<{ reference: string; signature: string }> = [];
    const client = {
      async nativeConfirm(input: { reference: string; signature: string }) {
        calls.push(input);
        return results.shift() ?? { settled: false, balance: null, reason: 'unavailable' };
      },
    };
    const waits: number[] = [];

    const result = await confirmNativeSettlement(client, 'CLM_ref', 'SIG', Date.now() + 60_000, {
      delayMs: async (ms) => {
        waits.push(ms);
      },
    });

    expect(result).toEqual({ settled: true, balance: 300, reason: null });
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([1000, 1500, 2500]);
  });

  it('does not retry non-final settlement failures', async () => {
    const client = {
      nativeConfirm: async () => ({
        settled: false,
        balance: null,
        reason: 'wrong_destination',
      }),
    };
    const waits: number[] = [];

    const result = await confirmNativeSettlement(client, 'CLM_ref', 'SIG', Date.now() + 60_000, {
      delayMs: async (ms) => {
        waits.push(ms);
      },
    });

    expect(result.reason).toBe('wrong_destination');
    expect(waits).toEqual([]);
  });
});
