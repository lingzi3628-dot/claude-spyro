/**
 * Multi-cursor editing maths, kept pure so it can be reasoned about and tested
 * without a DOM.
 *
 * A plain <textarea> only ever holds one native selection, so extra carets are
 * modelled here. Every edit is applied to all of the ranges at once, which is
 * why the offset arithmetic has to be exact.
 */
export interface Range {
  start: number;
  end: number;
}

/**
 * Apply `fn` to every range and return the new text plus the new caret ranges.
 *
 * The pass runs right-to-left: once a range to the right has grown or shrunk,
 * the offsets of everything to its left are still valid, which is what makes a
 * single forward pass safe.
 */
export function applyToRanges(
  text: string,
  ranges: Range[],
  fn: (slice: string) => string,
): { text: string; ranges: Range[] } {
  const order = ranges
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.start - a.c.start || b.c.end - a.c.end);

  let out = text;
  const deltas = new Array(ranges.length).fill(0);

  for (const { c, i } of order) {
    const rep = fn(out.slice(c.start, c.end));
    out = out.slice(0, c.start) + rep + out.slice(c.end);
    deltas[i] = rep.length - (c.end - c.start);
  }

  // A caret moves by the total length change of every range that sat before it.
  const next = ranges.map((c, i) => {
    let shift = 0;
    for (let j = 0; j < ranges.length; j++) {
      if (ranges[j].start < c.start) shift += deltas[j];
    }
    const rep = fn(text.slice(c.start, c.end));
    // The caret collapses to the end of whatever replaced the range: after the
    // text you typed, or where a selection was deleted from.
    return { start: c.start + shift + rep.length, end: c.start + shift + rep.length };
  });

  return { text: out, ranges: next };
}

/** Next occurrence of `needle` after `from` that isn't already a caret. */
export function nextOccurrence(text: string, needle: string, from: number, taken: number[], caseSensitive: boolean): number {
  if (!needle) return -1;
  const hay = caseSensitive ? text : text.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  let i = hay.indexOf(n, from);
  while (i !== -1 && taken.includes(i)) i = hay.indexOf(n, i + Math.max(1, n.length));
  return i;
}

/** Absolute offset at which a (0-based) line begins. */
export function lineStartAt(text: string, line: number): number {
  let pos = 0;
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf("\n", pos);
    if (nl === -1) return pos;
    pos = nl + 1;
  }
  return pos;
}

/** Collapse overlapping ranges so a multi-cursor selection never double-edits. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}
