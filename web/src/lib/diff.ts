/**
 * A line diff good enough to read a code change: LCS over lines, then a
 * side-by-side layout with change runs paired up.
 */

export type Kind = "same" | "add" | "del" | "mod";

export interface DiffLine {
  kind: Kind;
  left?: string;
  right?: string;
  leftNo?: number;
  rightNo?: number;
}

/** Longest common subsequence over lines, via dynamic programming. */
function lcs(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

export function diffLines(left: string, right: string): DiffLine[] {
  // An empty side is every-line-added or every-line-removed. Without this the
  // split produces one empty line that pairs up as a spurious "mod".
  if (left === "" && right === "") return [];
  if (left === "") return right.split("\n").map((text, i) => ({ kind: "add" as const, right: text, rightNo: i + 1 }));
  if (right === "") return left.split("\n").map((text, i) => ({ kind: "del" as const, left: text, leftNo: i + 1 }));

  const a = left.split("\n");
  const b = right.split("\n");
  const dp = lcs(a, b);

  const ops: { kind: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "del", text: a[i++] });
    } else {
      ops.push({ kind: "add", text: b[j++] });
    }
  }
  while (i < a.length) ops.push({ kind: "del", text: a[i++] });
  while (j < b.length) ops.push({ kind: "add", text: b[j++] });

  // Pair neighbouring delete/add runs so a changed line reads as one "mod".
  const out: DiffLine[] = [];
  let la = 1;
  let ra = 1;
  let k = 0;
  while (k < ops.length) {
    const o = ops[k];
    if (o.kind === "same") {
      out.push({ kind: "same", left: o.text, right: o.text, leftNo: la++, rightNo: ra++ });
      k++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k].kind === "del") dels.push(ops[k++].text);
    while (k < ops.length && ops[k].kind === "add") adds.push(ops[k++].text);
    const n = Math.max(dels.length, adds.length);
    for (let x = 0; x < n; x++) {
      if (dels[x] !== undefined && adds[x] !== undefined) {
        out.push({ kind: "mod", left: dels[x], right: adds[x], leftNo: la++, rightNo: ra++ });
      } else if (dels[x] !== undefined) {
        out.push({ kind: "del", left: dels[x], leftNo: la++ });
      } else {
        out.push({ kind: "add", right: adds[x], rightNo: ra++ });
      }
    }
  }
  return out;
}

/** How many lines differ, for the header summary. */
export function diffStats(rows: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === "add" || r.kind === "mod") added++;
    if (r.kind === "del" || r.kind === "mod") removed++;
  }
  return { added, removed };
}
