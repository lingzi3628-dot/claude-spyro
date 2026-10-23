import { readdir, readFile, stat, writeFile, rename, mkdir, unlink, rmdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { basename as pathBasename } from "node:path";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface FsEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

const IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
]);

export function homeDir(): string {
  return homedir();
}

/** List immediate children of a directory (for the folder picker / file tree). */
export async function listDir(path: string): Promise<{
  path: string;
  parent: string | null;
  entries: FsEntry[];
  isRoot: boolean;
}> {
  const abs = resolve(path || homedir());
  const dirents = await readdir(abs, { withFileTypes: true });
  const entries: FsEntry[] = [];

  for (const d of dirents) {
    if (d.name.startsWith(".") && d.name !== ".env") continue;
    const full = join(abs, d.name);
    entries.push({
      name: d.name,
      path: full,
      type: d.isDirectory() ? "dir" : "file",
    });
  }

  entries.sort(
    (a, b) =>
      (a.type === b.type ? 0 : a.type === "dir" ? -1 : 1) ||
      a.name.localeCompare(b.name),
  );

  const parent = dirname(abs);
  return {
    path: abs,
    parent: parent === abs ? null : parent,
    entries,
    isRoot: parent === abs,
  };
}

/** Build a bounded file tree for the sidebar. */
export async function readTree(root: string, depth = 4): Promise<TreeNode> {
  const abs = resolve(root);

  async function walk(dir: string, level: number): Promise<TreeNode[]> {
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: TreeNode[] = [];
    for (const d of dirents) {
      if (IGNORE.has(d.name)) continue;
      if (d.name.startsWith(".")) continue;
      const full = join(dir, d.name);
      if (d.isDirectory()) {
        nodes.push({
          name: d.name,
          path: full,
          type: "dir",
          children: level < depth ? await walk(full, level + 1) : [],
        });
      } else {
        nodes.push({ name: d.name, path: full, type: "file" });
      }
      if (nodes.length >= 2000) break;
    }
    nodes.sort(
      (a, b) =>
        (a.type === b.type ? 0 : a.type === "dir" ? -1 : 1) ||
        a.name.localeCompare(b.name),
    );
    return nodes;
  }

  return { name: pathBasename(abs) || abs, path: abs, type: "dir", children: await walk(abs, 0) };
}

/** Read a file's text content (bounded) or detect binary. */
export async function readFileForViewer(
  path: string,
): Promise<{ path: string; content: string; binary: boolean; truncated: boolean }> {
  const abs = resolve(path);
  const s = await stat(abs);
  const MAX = 500_000;
  const buf = await readFile(abs);
  const sample = buf.subarray(0, 8000);
  const binary = sample.includes(0);
  if (binary) {
    return { path: abs, content: `[binary file, ${s.size} bytes]`, binary: true, truncated: false };
  }
  let content = buf.toString("utf8");
  const truncated = content.length > MAX;
  if (truncated) content = content.slice(0, MAX);
  return { path: abs, content, binary: false, truncated };
}

export function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

/**
 * Write a text file from the IDE editor.
 *
 * The write-guard is enforced by the caller; this only handles the mechanics.
 */
/**
 * Move or rename a file/folder.
 * The IDE's explorer needs this, and it has to obey the same write-guard as
 * every other path that touches the filesystem.
 */
export async function moveEntry(from: string, to: string): Promise<{ from: string; to: string }> {
  const a = resolve(from);
  const b = resolve(to);
  await stat(a); // the source must exist
  if (existsSync(b)) throw new Error("A file or folder with that name already exists");
  if (dirname(b) === b) throw new Error("Invalid destination");
  if (b === a || b.startsWith(a + "/")) throw new Error("Cannot move a folder into itself");
  const st = await stat(a);
  if (st.isDirectory()) await mkdir(b, { recursive: true });
  await rename(a, b);
  return { from: a, to: b };
}

/** Remove a file or folder. Refuses anything outside the workspace, like the agent's own tools. */
export async function deleteEntry(path: string): Promise<{ path: string }> {
  const abs = resolve(path);
  const s = await stat(abs);
  if (s.isDirectory()) {
    if (readdirSync(abs).length > 0) throw new Error("Folder is not empty");
    await rmdir(abs);
  } else {
    await unlink(abs);
  }
  return { path: abs };
}

/** Create an empty file or a folder. */
export async function createEntry(path: string, kind: "file" | "dir"): Promise<{ path: string }> {
  const abs = resolve(path);
  if (existsSync(abs)) throw new Error("Something already exists there");
  if (kind === "dir") await mkdir(abs, { recursive: true });
  else {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, "", "utf8");
  }
  return { path: abs };
}

export async function writeTextFile(path: string, content: string): Promise<{ path: string; bytes: number }> {
  const abs = resolve(path);
  const s = await stat(abs); // must already exist — the editor never creates files
  if (!s.isFile()) throw new Error("Not a file");
  await writeFile(abs, content, "utf8");
  return { path: abs, bytes: Buffer.byteLength(content, "utf8") };
}
