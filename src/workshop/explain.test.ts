import { describe, it, expect } from 'vitest';
import {
  blockTurnAdapter, flatTurnAdapter, priorContext, explainRequest, followupThread,
  turnIndexOfNode, resolveSelection, EXPLAIN_CONTEXT_TURNS,
  type BlockTurn, type FlatTurn,
} from './explain';

// Ported verbatim from hydra-hq's explain.test.ts (PR #349, 22 cases) — the block-turn logic runs
// through `blockTurnAdapter`, and the DOM resolvers run against duck-typed node fakes instead of
// happy-dom (the kit carries no DOM test dependency). New `flatTurnAdapter` cases prove merritt's
// flat `{ role, text }` transcript shape reduces the same way.

const asst = (text: string, extra: BlockTurn['blocks'] = []): BlockTurn => ({
  type: 'assistant', blocks: [{ kind: 'text', text }, ...extra],
});
const user = (text: string): BlockTurn => ({ type: 'user', blocks: [{ kind: 'text', text }] });

describe('blockTurnAdapter.text (the explainable prose of a turn)', () => {
  it('joins only text blocks, trimmed', () => {
    const t: BlockTurn = {
      type: 'assistant',
      blocks: [
        { kind: 'thinking', text: 'hmm' },
        { kind: 'text', text: '  first  ' },
        { kind: 'tool_use', name: 'Bash', input: '{}' },
        { kind: 'text', text: 'second' },
      ],
    };
    expect(blockTurnAdapter.text(t)).toBe('first  \nsecond');
  });
  it('empty when a turn has no text blocks', () => {
    expect(blockTurnAdapter.text({ type: 'assistant', blocks: [{ kind: 'tool_use', name: 'Read', input: '{}' }] })).toBe('');
  });
});

describe('blockTurnAdapter.context (role-tagged flattening for context)', () => {
  it('tags the head and keeps text', () => {
    expect(blockTurnAdapter.context(asst('rebasing now'))).toBe('head: rebasing now');
  });
  it('tags the operator for user turns', () => {
    expect(blockTurnAdapter.context(user('do the thing'))).toBe('operator: do the thing');
  });
  it('collapses non-text blocks to short tags', () => {
    const t: BlockTurn = {
      type: 'assistant',
      blocks: [
        { kind: 'text', text: 'editing' },
        { kind: 'diff', name: 'Edit', diff: '', file: 'a.py' },
        { kind: 'tool_use', name: 'Bash', input: '{}' },
      ],
    };
    expect(blockTurnAdapter.context(t)).toBe('head: editing [edited a.py] [tool: Bash]');
  });
  it('empty for a contentless turn', () => {
    expect(blockTurnAdapter.context({ type: 'assistant', blocks: [] })).toBe('');
  });
});

describe('priorContext (up to N prior turns, oldest first)', () => {
  const turns = [user('u0'), asst('a1'), user('u2'), asst('a3'), asst('a4')];
  it('returns [] at the first turn', () => {
    expect(priorContext(turns, 0, blockTurnAdapter)).toEqual([]);
  });
  it('caps to the newest EXPLAIN_CONTEXT_TURNS before the index', () => {
    const ctx = priorContext(turns, 4, blockTurnAdapter);
    expect(ctx.length).toBe(EXPLAIN_CONTEXT_TURNS);
    expect(ctx).toEqual(['head: a1', 'operator: u2', 'head: a3']);
  });
  it('takes only what exists near the start', () => {
    expect(priorContext(turns, 1, blockTurnAdapter)).toEqual(['operator: u0']);
  });
  it('skips empty turns', () => {
    const withEmpty = [asst('a0'), { type: 'assistant', blocks: [] } as BlockTurn, asst('a2')];
    expect(priorContext(withEmpty, 2, blockTurnAdapter)).toEqual(['head: a0']);
  });
});

describe('explainRequest (POST body shape)', () => {
  const turns = [user('set it up'), asst('I will rebase feat/x onto main')];
  it('carries mode, turn text and context; omits excerpt when absent', () => {
    const b = explainRequest(turns, 1, blockTurnAdapter);
    expect(b.mode).toBe('explain');
    expect(b.turn).toBe('I will rebase feat/x onto main');
    expect(b.context).toEqual(['operator: set it up']);
    expect('excerpt' in b).toBe(false);
  });
  it('includes a trimmed excerpt when highlighted', () => {
    const b = explainRequest(turns, 1, blockTurnAdapter, '  rebase feat/x  ');
    expect(b.excerpt).toBe('rebase feat/x');
  });
  it('drops a whitespace-only excerpt', () => {
    expect('excerpt' in explainRequest(turns, 1, blockTurnAdapter, '   ')).toBe(false);
  });
});

describe('followupThread (stateless thread the relay replays)', () => {
  it('appends the new question as a trailing empty-answer pair', () => {
    const prior = [{ q: '', a: 'initial explanation' }];
    expect(followupThread(prior, '  why? ')).toEqual([
      { q: '', a: 'initial explanation' }, { q: 'why?', a: '' },
    ]);
  });
  it('drops any stale pending (answerless) pair before appending', () => {
    const prior = [{ q: '', a: 'A1' }, { q: 'stale', a: '' }];
    expect(followupThread(prior, 'next')).toEqual([
      { q: '', a: 'A1' }, { q: 'next', a: '' },
    ]);
  });
});

// duck-typed DOM fakes — real Elements satisfy the same shape in the browser; a text node is an
// object WITHOUT hasAttribute (so the resolver walks past it to its parent, as in the real DOM).
type Fake = { parentNode: Fake | null; hasAttribute?: (n: string) => boolean; getAttribute?: (n: string) => string | null };
const el = (attrs: Record<string, string> = {}, parent: Fake | null = null): Fake => ({
  parentNode: parent,
  hasAttribute: (n: string) => n in attrs,
  getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
});
const textNode = (parent: Fake): Fake => ({ parentNode: parent });   // no hasAttribute → skipped

describe('turnIndexOfNode (walk up to the tagged turn)', () => {
  it('finds the nearest data-turn-index ancestor', () => {
    const root = el();
    const div = el({ 'data-turn-index': '2' }, root);
    const p = el({}, div);
    const span = textNode(p);
    expect(turnIndexOfNode(span, root)).toBe(2);
  });
  it('returns null for a node outside any turn', () => {
    const root = el();
    const p = el({}, root);
    const span = textNode(p);
    expect(turnIndexOfNode(span, root)).toBe(null);
  });
});

describe('resolveSelection (selection → single turn + excerpt)', () => {
  const mkRoot = () => {
    const root = el();
    const turn0 = el({ 'data-turn-index': '0' }, root);
    const turn1 = el({ 'data-turn-index': '1' }, root);
    const t0 = textNode(turn0);
    const t1 = textNode(turn1);
    const members = new Set<Fake>([root, turn0, turn1, t0, t1]);
    (root as Fake & { contains: (n: unknown) => boolean }).contains = (n: unknown) => members.has(n as Fake);
    return { root: root as Fake & { contains: (n: unknown) => boolean }, t0, t1 };
  };
  const sel = (over: { isCollapsed?: boolean; anchorNode: Fake | null; focusNode?: Fake | null; text: string }) => ({
    isCollapsed: over.isCollapsed ?? false,
    anchorNode: over.anchorNode,
    focusNode: over.focusNode ?? over.anchorNode,
    toString: () => over.text,
  });

  it('resolves a selection inside one turn', () => {
    const { root, t1 } = mkRoot();
    expect(resolveSelection(sel({ anchorNode: t1, text: 'gamma' }), root)).toEqual({ index: 1, excerpt: 'gamma' });
  });
  it('rejects a collapsed selection', () => {
    const { root, t0 } = mkRoot();
    expect(resolveSelection(sel({ isCollapsed: true, anchorNode: t0, text: '' }), root)).toBe(null);
  });
  it('rejects a selection straddling two turns', () => {
    const { root, t0, t1 } = mkRoot();
    expect(resolveSelection(sel({ anchorNode: t0, focusNode: t1, text: 'beta gamma' }), root)).toBe(null);
  });
  it('rejects a selection outside the chat root', () => {
    const { root } = mkRoot();
    const outside = textNode(el());
    expect(resolveSelection(sel({ anchorNode: outside, text: 'stray' }), root)).toBe(null);
  });
  it('rejects whitespace-only text', () => {
    const { root, t0 } = mkRoot();
    expect(resolveSelection(sel({ anchorNode: t0, text: '   ' }), root)).toBe(null);
  });
});

// ---- new: flat {role,text} turns (merritt studio transcript) reduce the same way ----------------

describe('flatTurnAdapter (merritt flat transcript shape)', () => {
  const fu = (text: string): FlatTurn => ({ role: 'user', text });
  const fa = (text: string): FlatTurn => ({ role: 'assistant', text });
  it('text() is the trimmed prose', () => {
    expect(flatTurnAdapter.text(fa('  shipped the hero  '))).toBe('shipped the hero');
  });
  it('context() tags operator/head; empty for a blank turn', () => {
    expect(flatTurnAdapter.context(fu('tighten the copy'))).toBe('operator: tighten the copy');
    expect(flatTurnAdapter.context(fa('rebuilt the grid'))).toBe('head: rebuilt the grid');
    expect(flatTurnAdapter.context({ role: 'assistant', text: '   ' })).toBe('');
    expect(flatTurnAdapter.context({ role: 'assistant', text: null })).toBe('');
  });
  it('explainRequest assembles turn + prior context over flat turns', () => {
    const turns = [fu('make it feel premium'), fa('added serif headings + brass accents')];
    const b = explainRequest(turns, 1, flatTurnAdapter, 'brass accents');
    expect(b).toEqual({
      mode: 'explain',
      turn: 'added serif headings + brass accents',
      excerpt: 'brass accents',
      context: ['operator: make it feel premium'],
    });
  });
});
