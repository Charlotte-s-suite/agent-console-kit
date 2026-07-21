// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useExplain } from './WorkshopSidecar';
import { flatTurnAdapter, type FlatTurn } from './explain';

// Regression for the request-nonce fix (kit-owner review nit on PR #2 / merritt #31): explain-card
// staleness was guarded by turn INDEX only, so a stale in-flight response for the same index could
// land on a newer card. The exact scenario: excerpt-explain a turn → close → whole-turn ❓ on the
// SAME turn index; the slow excerpt-scoped answer arrives last and used to clobber the fresh card.
// The per-request nonce drops any response a newer dispatch has superseded.

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('useExplain drops a superseded response (request nonce)', () => {
  it('a stale same-index response does not clobber the newer card', async () => {
    const turns: FlatTurn[] = [
      { role: 'user', text: 'lay out the page' },
      { role: 'assistant', text: 'the hero section uses brass accents over a dark field' },
    ];
    const scrollRef = { current: null };

    // two in-flight jobs, resolved out of order: the FIRST (excerpt) is slow, the SECOND (whole
    // turn) is fast. Both anchor to turn index 1.
    const excerptJob = deferred<Record<string, unknown>>();
    const wholeJob = deferred<Record<string, unknown>>();
    let call = 0;
    const postWorkshop = () => {
      call += 1;
      return call === 1 ? excerptJob.promise : wholeJob.promise;
    };

    const { result } = renderHook(() =>
      useExplain({ turns, adapter: flatTurnAdapter, postWorkshop, scrollRef, resetKey: 'head-a' }));

    // 1) excerpt-explain on turn 1 (dispatch #1, slow)
    act(() => { result.current.startExplain(1, 'brass accents'); });
    // 2) close the card
    act(() => { result.current.closeExplain(); });
    // 3) whole-turn explain on the SAME turn index (dispatch #2, fast)
    act(() => { result.current.startExplain(1); });

    // the fast whole-turn job resolves FIRST → it owns the card
    await act(async () => { wholeJob.resolve({ explanation: 'WHOLE-TURN explanation' }); });
    await waitFor(() => expect(result.current.explain?.busy).toBe(false));
    expect(result.current.explain?.excerpt).toBeUndefined();
    expect(result.current.explain?.qa[0]?.a).toBe('WHOLE-TURN explanation');

    // now the STALE excerpt job resolves LAST — it must be dropped, not clobber the fresh card
    await act(async () => { excerptJob.resolve({ explanation: 'STALE EXCERPT explanation' }); });
    // give any (incorrect) state update a chance to flush before asserting it did NOT happen
    await act(async () => { await Promise.resolve(); });

    expect(result.current.explain?.excerpt).toBeUndefined();
    expect(result.current.explain?.qa[0]?.a).toBe('WHOLE-TURN explanation');
  });

  it('a normal single explain still lands its answer', async () => {
    const turns: FlatTurn[] = [{ role: 'assistant', text: 'deploying the bundle now' }];
    const scrollRef = { current: null };
    const job = deferred<Record<string, unknown>>();
    const { result } = renderHook(() =>
      useExplain({ turns, adapter: flatTurnAdapter, postWorkshop: () => job.promise, scrollRef, resetKey: 'h' }));

    act(() => { result.current.startExplain(0); });
    expect(result.current.explain?.busy).toBe(true);
    await act(async () => { job.resolve({ explanation: 'it means the build is shipping' }); });
    await waitFor(() => expect(result.current.explain?.busy).toBe(false));
    expect(result.current.explain?.qa[0]?.a).toBe('it means the build is shipping');
  });
});
