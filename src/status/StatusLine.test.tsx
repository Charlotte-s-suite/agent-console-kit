import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import StatusLine, { fmtTok, fmtUsd } from './StatusLine';
import CompactButton, { urgency, AMBER_AT, RED_AT, BLINK_AT } from './CompactButton';
import ConsolidateRefreshButton from './ConsolidateRefreshButton';
import InterruptButton from './InterruptButton';
import type { SessionUsage, Limits } from './types';

// SSR smoke — proves the JSX/TS transpiles, the components mount, and the density register renders
// (naked glyphs, terminal-mono, no framework chrome). Effects don't run under renderToStaticMarkup,
// so lineW stays at its wide default (no shedding) and the keyframe injection is skipped — the
// synchronous render bodies are what's exercised. Transport is delegated: the action callbacks are
// never invoked by a static render, so they're stubs here.

const noop = async () => true;              // CompactAction / RefreshAction — resolve ok
const noopVoid = async (): Promise<void> => {};   // InterruptAction — fire-and-forget
const usage: SessionUsage = { context: 250_000, output: 1_800 };
const limits: Limits = {
  session_pct: 42, weekly_pct: 61,
  model_limits: [{ name: 'fable', pct: 88, active: true }],
};

describe('fmtTok / fmtUsd', () => {
  it('formats token counts k/M', () => {
    expect(fmtTok(950)).toBe('950');
    expect(fmtTok(1_800)).toBe('2k');
    expect(fmtTok(250_000)).toBe('250k');
    expect(fmtTok(1_400_000)).toBe('1.4M');
  });
  it('formats USD with separators + 2dp', () => {
    expect(fmtUsd(1755.19)).toBe('$1,755.19');
    expect(fmtUsd(9)).toBe('$9.00');
  });
});

describe('urgency (context-pressure gauge tiers)', () => {
  it('crosses at the documented thresholds', () => {
    expect(urgency(0).blink).toBe(false);
    expect(urgency(AMBER_AT).tier).toContain('200k');
    expect(urgency(RED_AT).tier).toContain('400k');
    expect(urgency(BLINK_AT).blink).toBe(true);
    expect(urgency(null).tier).toBe('context healthy');
  });
});

describe('StatusLine renders the data-line', () => {
  it('shows the agent name + the live context/output tokens', () => {
    const html = renderToStaticMarkup(createElement(StatusLine, {
      status: 'working', name: 'oud-kempen', model: 'opus-4-8', usage,
      interruptible: true, onInterrupt: noopVoid, onCompact: noop, onRefresh: noop,
    }));
    expect(html).toContain('oud-kempen');
    expect(html).toContain('opus-4-8');
    expect(html).toContain('250k');   // context
    expect(html).toContain('2k');     // output
    expect(html).toContain('hq-spin');   // working → the spinner keyframe is referenced
    expect(html).toContain('■');      // inline interrupt echo while working
    expect(html).toContain('⊟');      // compact control
    expect(html).toContain('♻');      // consolidate+refresh control
  });

  it('omits the 🧠 drawer affordance unless onContextClick is supplied (merritt v1)', () => {
    const plain = renderToStaticMarkup(createElement(StatusLine, {
      status: 'idle', name: 'a', usage,
    }));
    expect(plain).not.toContain('🧠');
    expect(plain).toContain('250k');   // counter still shows, as plain text
    const withDrawer = renderToStaticMarkup(createElement(StatusLine, {
      status: 'idle', name: 'a', usage, onContextClick: () => {},
    }));
    expect(withDrawer).toContain('🧠');
  });

  it('renders the account limit bars incl. an active model-scoped cap', () => {
    const html = renderToStaticMarkup(createElement(StatusLine, {
      status: 'idle', name: 'a', limits,
    }));
    expect(html).toContain('42%');   // daily
    expect(html).toContain('61%');   // weekly
    expect(html).toContain('88%');   // fable model cap
    expect(html).toContain('◂');     // active-limit marker
  });

  it('omits compact/refresh controls when no callbacks are wired', () => {
    const html = renderToStaticMarkup(createElement(StatusLine, {
      status: 'idle', name: 'a', usage,
    }));
    expect(html).not.toContain('⊟');
    expect(html).not.toContain('♻');
  });

  it('waiting status uses the amber blink dot, not the spinner', () => {
    const html = renderToStaticMarkup(createElement(StatusLine, { status: 'waiting', name: 'a' }));
    expect(html).toContain('hq-dot-blink');
    expect(html).not.toContain('hq-spin');
  });
});

describe('the small controls render their naked glyphs', () => {
  it('CompactButton is a ⊟', () => {
    expect(renderToStaticMarkup(createElement(CompactButton, { status: 'idle', contextTokens: 10, onCompact: noop }))).toContain('⊟');
  });
  it('ConsolidateRefreshButton is a ♻', () => {
    expect(renderToStaticMarkup(createElement(ConsolidateRefreshButton, { status: 'idle', onRefresh: noop }))).toContain('♻');
  });
  it('InterruptButton is a mono ■ (both variants)', () => {
    expect(renderToStaticMarkup(createElement(InterruptButton, { onInterrupt: noopVoid }))).toContain('■');
    expect(renderToStaticMarkup(createElement(InterruptButton, { onInterrupt: noopVoid, variant: 'inline' }))).toContain('■');
  });
});
