type OpType = "context" | "add" | "remove";

interface Op {
  type: OpType;
  line: string;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export interface DiffResult {
  diff: string;
  stats: DiffStats;
  changed: boolean;
}

const MAX_LCS_CELLS = 4_000_000;

function diffMiddle(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const ops: Op[] = [];

  if (n * m > MAX_LCS_CELLS) {
    // Too large for O(n*m): treat as a wholesale replacement.
    for (const line of a) ops.push({ type: "remove", line });
    for (const line of b) ops.push({ type: "add", line });
    return ops;
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "context", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", line: a[i] });
      i++;
    } else {
      ops.push({ type: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "remove", line: a[i++] });
  while (j < m) ops.push({ type: "add", line: b[j++] });
  return ops;
}

function diffOps(a: string[], b: string[]): Op[] {
  // Trim the common prefix and suffix so the LCS runs on the changed region only.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: "context", line: a[i] });
  ops.push(...diffMiddle(a.slice(start, endA), b.slice(start, endB)));
  for (let i = endA; i < a.length; i++) ops.push({ type: "context", line: a[i] });
  return ops;
}

/**
 * Produce a unified diff (like `diff -u`) between two texts, with `context`
 * lines of surrounding context per hunk.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  path: string,
  context = 3,
): DiffResult {
  if (oldText === newText) return { diff: "", stats: { added: 0, removed: 0 }, changed: false };

  const a = oldText.length ? oldText.split("\n") : [];
  const b = newText.length ? newText.split("\n") : [];
  const ops = diffOps(a, b);

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "remove") removed++;
  }

  // Decide which ops to include (changes + `context` surrounding lines).
  const include = new Array(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== "context") {
      const lo = Math.max(0, i - context);
      const hi = Math.min(ops.length - 1, i + context);
      for (let k = lo; k <= hi; k++) include[k] = true;
    }
  }

  // `include` marks every change plus `context` lines around it. Maximal runs
  // of included ops are exactly the hunks (nearby changes merge automatically).
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let idx = 0;
  while (idx < ops.length) {
    if (!include[idx]) {
      idx++;
      continue;
    }
    const start = idx;
    while (idx < ops.length && include[idx]) idx++;
    const end = idx; // exclusive

    let aStart = 0;
    let bStart = 0;
    for (let k = 0; k < start; k++) {
      if (ops[k].type !== "add") aStart++;
      if (ops[k].type !== "remove") bStart++;
    }

    let aLines = 0;
    let bLines = 0;
    const body: string[] = [];
    for (let k = start; k < end; k++) {
      const op = ops[k];
      if (op.type === "context") {
        body.push(" " + op.line);
        aLines++;
        bLines++;
      } else if (op.type === "remove") {
        body.push("-" + op.line);
        aLines++;
      } else {
        body.push("+" + op.line);
        bLines++;
      }
    }
    lines.push(`@@ -${aStart + 1},${aLines} +${bStart + 1},${bLines} @@`);
    lines.push(...body);
  }

  return { diff: lines.join("\n"), stats: { added, removed }, changed: true };
}
