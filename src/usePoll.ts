// visiblePoll — a drop-in for the `load(); const id = setInterval(load, ms); return () => clearInterval(id)`
// pattern that PAUSES while the tab is backgrounded. HQ polls a lot (the chat transcript every 2 s, fleet
// / status / roadmap / stream on their own cadences); with the phone locked or the tab hidden those GETs
// kept hammering the backend for nothing. This skips the fetch while `document.hidden`, and fires ONE
// immediate refresh the moment the tab becomes visible again so nothing looks stale on return.
//
// Usage (inside a useEffect — keep the effect's own deps + `alive` guard):
//     const stop = visiblePoll(load, 10_000);
//     return () => { alive = false; stop(); };
// Behaviour while VISIBLE is identical to a bare setInterval (immediate call + every `ms`).
export function visiblePoll(fn: () => void, ms: number): () => void {
  const run = () => { if (!document.hidden) fn(); };   // the gate: never fetch while hidden
  run();                                                // immediate first call (matches the old load();)
  const id = setInterval(run, ms);
  const onVisible = () => { if (!document.hidden) fn(); };   // instant catch-up the moment we return
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
