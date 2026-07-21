import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  TurnExplainButton, SelectionExplainChip, ExplainCard, SharpenButton, OpenQuestionsStrip,
  useExplain, useSharpen, type ExplainCardState,
} from './WorkshopSidecar';
import { flatTurnAdapter, type FlatTurn } from './explain';

// SSR smoke — proves the JSX/TS transpiles, the components mount, and the density register renders
// (naked glyphs, no framework chrome). Effects don't run under renderToStaticMarkup, so the hooks'
// synchronous bodies (useState/useRef) are exercised without touching document/selection.

describe('components render (density register: naked glyphs)', () => {
  it('TurnExplainButton is a bare ❓ glyph, hidden when not explainable', () => {
    const on = renderToStaticMarkup(createElement(TurnExplainButton, { onExplain: () => {}, canExplain: true }));
    expect(on).toContain('❓');
    expect(renderToStaticMarkup(createElement(TurnExplainButton, { onExplain: () => {}, canExplain: false }))).toBe('');
  });

  it('SelectionExplainChip renders only with a chip', () => {
    expect(renderToStaticMarkup(createElement(SelectionExplainChip, { chip: null, onExplain: () => {} }))).toBe('');
    const html = renderToStaticMarkup(createElement(SelectionExplainChip, {
      chip: { x: 10, y: 40, index: 2, excerpt: 'brass accents' }, onExplain: () => {},
    }));
    expect(html).toContain('❓ explain');
  });

  it('ExplainCard shows the highlighted excerpt + thread answer', () => {
    const card: ExplainCardState = { index: 1, excerpt: 'the hero', qa: [{ q: '', a: 'It means the top section.' }], busy: false, error: null };
    const html = renderToStaticMarkup(createElement(ExplainCard, { card, onFollowup: () => {}, onClose: () => {} }));
    expect(html).toContain('the hero');
    expect(html).toContain('It means the top section.');
    expect(html).toContain('ask more');   // follow-up input present once answered
  });

  it('ExplainCard busy state hides the ask-more input', () => {
    const card: ExplainCardState = { index: 0, qa: [], busy: true, error: null };
    const html = renderToStaticMarkup(createElement(ExplainCard, { card, onFollowup: () => {}, onClose: () => {} }));
    expect(html).toContain('explaining…');
    expect(html).not.toContain('ask more');
  });

  it('SharpenButton reflects has-draft / busy', () => {
    expect(renderToStaticMarkup(createElement(SharpenButton, { draft: '', busy: false, onSharpen: () => {} }))).toContain('✍️ workshop');
    expect(renderToStaticMarkup(createElement(SharpenButton, { draft: 'x', busy: true, onSharpen: () => {} }))).toContain('sharpening…');
  });

  it('OpenQuestionsStrip lists questions, empty when none', () => {
    expect(renderToStaticMarkup(createElement(OpenQuestionsStrip, { questions: null, onDismiss: () => {} }))).toBe('');
    const html = renderToStaticMarkup(createElement(OpenQuestionsStrip, { questions: ['which brand voice?'], onDismiss: () => {} }));
    expect(html).toContain('which brand voice?');
  });
});

describe('hooks mount (synchronous bodies run under SSR)', () => {
  const post = async () => ({ explanation: 'x' });
  function ExplainHarness() {
    const turns: FlatTurn[] = [{ role: 'assistant', text: 'hi' }];
    const ref = { current: null };
    const { explain, selChip } = useExplain({ turns, adapter: flatTurnAdapter, postWorkshop: post, scrollRef: ref, resetKey: 'h' });
    return createElement('i', null, String(explain === null && selChip === null));
  }
  function SharpenHarness() {
    const { busy } = useSharpen({ postWorkshop: post });
    return createElement('i', null, String(busy));
  }
  it('useExplain initializes null card + chip', () => {
    expect(renderToStaticMarkup(createElement(ExplainHarness))).toBe('<i>true</i>');
  });
  it('useSharpen initializes not-busy', () => {
    expect(renderToStaticMarkup(createElement(SharpenHarness))).toBe('<i>false</i>');
  });
});
