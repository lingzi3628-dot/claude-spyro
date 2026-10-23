/**
 * Which file to show when a folder is opened.
 *
 * Opening a project and staring at a "getting started" card is what makes a
 * returning user feel like a first-time one. Showing them an actual file is the
 * whole fix. Kept pure so the ordering can be tested without a browser.
 */

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

/**
 * Preference order — most-likely-to-be-the-point-of-the-project first. The
 * entry code beats the manifest, because a manifest is not what you came to
 * read.
 */
const PRIORITY = [
  "readme.md",
  "readme",
  "readme.txt",
  "app.js",
  "app.jsx",
  "app.ts",
  "app.tsx",
  "index.js",
  "index.jsx",
  "index.ts",
  "index.tsx",
  "main.py",
  "main.go",
  "main.rs",
  "main.js",
  "main.ts",
  "src/app.js",
  "src/index.js",
  "package.json",
  "pyproject.toml",
  "cargo.toml",
  "go.mod",
  "pom.xml",
  "index.html",
];

function rank(path: string): number {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() || lower;
  for (let i = 0; i < PRIORITY.length; i++) {
    const want = PRIORITY[i];
    if (want.includes("/") ? lower.endsWith("/" + want) : base === want) return i;
  }
  return -1;
}

/**
 * Entry-point candidates that exist in the tree, best first. Empty when the
 * folder has nothing recognisable — in that case the caller should keep its
 * neutral empty state rather than open a random file.
 */
export function pickEntryFiles(tree: TreeNode | null, limit = 3): string[] {
  if (!tree) return [];
  const found: { path: string; score: number }[] = [];

  const walk = (n: TreeNode) => {
    if (n.type === "file") {
      const s = rank(n.path);
      if (s >= 0) found.push({ path: n.path, score: s });
    }
    for (const c of n.children || []) walk(c);
  };
  walk(tree);

  found.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
  return found.slice(0, limit).map((f) => f.path);
}
