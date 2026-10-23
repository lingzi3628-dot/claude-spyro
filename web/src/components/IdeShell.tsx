import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { highlight } from "../highlight";
import { PreviewPanel } from "./PreviewPanel";
import { Marketplace } from "./Marketplace";
import { DatabasePanel } from "./DatabasePanel";
import { DiffView } from "./DiffView";
import { PortsPanel } from "./PortsPanel";
import { applyToRanges, nextOccurrence, lineStartAt as lineOffset } from "../lib/multicursor";
import { pickEntryFiles, type TreeNode } from "../lib/entryfiles";
import { type IdeSettings } from "./IdeSettings";

/* ------------------------------------------------------------------ types */

export type { TreeNode };

export interface SearchHit {
  path: string;
  rel: string;
  line: number;
  col: number;
  text: string;
}

export interface GitState {
  isRepo: boolean;
  branch: string;
  status: { path: string; staged: boolean; untracked: boolean }[];
  staged: { path: string; staged: boolean; untracked: boolean }[];
  commits: { hash: string; author: string; when: string; subject: string }[];
}

type RailView = "files" | "search" | "git" | "ports" | "outline" | "db" | "market" | null;
type BottomView = "terminal" | "problems" | "output" | null;

const EXT_LANG: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  py: "python", rs: "rust", go: "go", java: "java", json: "json",
  css: "css", scss: "css", html: "html", svg: "html", md: "md",
  yml: "yaml", yaml: "yaml", toml: "yaml", sh: "sh", bash: "sh",
};

function langOf(path: string): string {
  const ext = path.split(".").pop() || "";
  return EXT_LANG[ext.toLowerCase()] || "";
}

/* --------------------------------------------------------------- the shell */

export interface IdeProps {
  cwd: string;
  /** The whole chat surface, rendered as the right-hand panel. */
  chat: React.ReactNode;
  chatOpen: boolean;
  onToggleChat: () => void;
  /** Live shells so the terminal panel reflects reality. */
  shells: { id: string; command: string; done?: boolean; exitCode?: number | null; tail?: string }[];
  /** Start a command in the IDE terminal. */
  onShellStart: (command: string, cwd: string, terminalId: string) => void;
  /** Streamed output for this terminal. */
  shellOutput?: Record<string, string>;
  /** The shell currently running per terminal id, so Ctrl+C knows what to stop. */
  shellRunning?: Record<string, string | null>;
  /** The directory each terminal is in, so `cd` sticks between commands. */
  shellCwd?: Record<string, string>;
  /** Live shells started from this terminal. */
  onShellKill?: (id: string, signal?: "SIGINT" | "SIGKILL" | "SIGTERM") => void;
  /** Increments when the server reports a change on disk. */
  fsTick?: number;
  /** The paths from the most recent change, so the IDE can reveal them. */
  fsChange?: { paths: string[]; at: number };
  /**
   * The live preview. In VS Code a preview is an editor tab, not a panel that
   * squeezes the layout — so it opens beside your files inside the editor area
   * and never moves the agent panel.
   */
  previewUrl?: string | null;
  onClosePreview: () => void;
  /** Keep the preview's URL bar in sync when the user edits it. */
  onUrlChange: (url: string) => void;
  /** Open a runnable file in the live preview (HTML). */
  onRunFile: (path: string) => void;
  /** Point the preview at a server URL. */
  onOpenServer: (url: string) => void;
  /** Per-project settings, read from .vscode/settings.json in the open folder. */
  settings?: IdeSettings;
  onOpenSettings?: () => void;
  /** Leave the IDE and show the chat full-screen. */
  onOpenFullChat: () => void;
  /** Leave the IDE entirely, restoring the chat surface. */
  onLeave: () => void;
  /** Open another folder, or the start screen when no path is given. */
  onOpenFolder: (path: string) => void;
  extraDirs?: string[];
  /** Custom status line output (Claude Code-style). */
  statusLine?: string;
  statusLineError?: string | null;
}

/** Just the last segment of a path, for a compact prompt. */
function nameOfPath(p: string): string {
  const parts = (p || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

/** Open tabs are remembered per folder, the way an editor should. */
const TABS_KEY = "cf-ide-tabs";

function allSavedTabs(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadSavedTabs(cwd: string): string[] {
  if (!cwd) return [];
  const list = allSavedTabs()[cwd];
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

function saveSavedTabs(cwd: string, paths: string[]): void {
  if (!cwd) return;
  try {
    const all = allSavedTabs();
    all[cwd] = paths.slice(0, 12);
    localStorage.setItem(TABS_KEY, JSON.stringify(all));
  } catch {
    /* private mode — remembering tabs is a convenience, not a requirement */
  }
}

/**
 * Spyro Studio IDE.
 *
 * A VS Code-shaped workbench: activity bar, side panel, tabbed editor, bottom
 * terminal — with the agent's chat docked on the right so you edit code and
 * talk to the agent in the same screen.
 */
export function IdeShell(props: IdeProps) {
  const { cwd, chat, chatOpen, onToggleChat, shells, onOpenFullChat } = props;
  const { onShellStart, shellOutput, shellRunning, shellCwd, previewUrl, onClosePreview, onUrlChange, settings, onOpenSettings, onRunFile, onOpenServer, fsTick = 0, fsChange } = props;
  const { statusLine, statusLineError } = props;
  const onShellKill = props.onShellKill;
  const fontSize = settings?.["editor.fontSize"] ?? 12.5;
  const tabSize = settings?.["editor.tabSize"] ?? 2;
  const wrap = settings?.["editor.wordWrap"] ?? false;
  const termFont = settings?.["terminal.fontSize"] ?? 12;
  const [rail, setRail] = useState<RailView>("files");
  const PREVIEW_TAB = "__preview__";
  const DIFF_TAB = "__diff__";
  const [pinned, setPinned] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [rename, setRename] = useState<{ path: string; name: string; mode: "rename" | "create" } | null>(null);
  const [treeNote, setTreeNote] = useState("");
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [bottom, setBottom] = useState<BottomView>("terminal");
  /**
   * Terminals, VS Code style: several side by side, each with its own id so
   * their output never mixes, plus its own scrollback and history.
   */
  const [termIds, setTermIds] = useState<string[]>(() => [`t_${Math.random().toString(36).slice(2, 9)}`]);
  const [termActive, setTermActive] = useState(0);
  const termId = termIds[Math.min(termActive, termIds.length - 1)];
  const addTerminal = () =>
    setTermIds((ids) => [...ids, `t_${Math.random().toString(36).slice(2, 9)}`].slice(-6));
  const closeTerminal = (i: number) => {
    // Closing a terminal must not leave its process running in the background.
    const closing = termIds[i];
    const running = closing ? shellRunning?.[closing] : null;
    if (closing && running) onShellKill?.(running, "SIGTERM");
    setTermIds((ids) => {
      const next = ids.length <= 1 ? ids : ids.filter((_, k) => k !== i);
      setTermActive((a) => Math.min(a, Math.max(0, next.length - 1)));
      return next;
    });
  };
  const selectTerminal = (i: number) => setTermActive(i);
  const [termInput, setTermInput] = useState("");
  const [termHistory, setTermHistory] = useState<Record<string, string[]>>({});
  const [termEcho, setTermEcho] = useState<Record<string, string>>({});
  // Find & replace, scoped to the active document.
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replText, setReplText] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [problems, setProblems] = useState<{ file: string; line: number; column: number; severity: string; code: string; message: string }[]>([]);
  const [diagnosing, setDiagnosing] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  /**
   * Multiple carets. A plain <textarea> only ever has one native selection, so
   * the extra carets are modelled here and drawn in the highlight layer, while
   * edits are applied to every range ourselves.
   */
  const [cursors, setCursors] = useState<{ start: number; end: number }[]>([]);
  const [cursorIdx, setCursorIdx] = useState(0);
  const termRef = useRef<HTMLDivElement>(null);
  const termInputRef = useRef<HTMLInputElement>(null);
  const out = (termEcho[termId] || "") + ((shellOutput || {})[termId] || "");
  const history = termHistory[termId] || [];

  const runTerm = (raw: string, target?: string) => {
    const cmd = raw.trim();
    const tid = target || termId;
    if (!cmd) return;
    // One command per terminal at a time, like a shell prompt. Running another
    // on top would lose track of the first, and Ctrl+C would stop the wrong one.
    if (shellRunning?.[tid]) return;
    setTermHistory((h) => ({ ...h, [tid]: [cmd, ...(h[tid] || []).filter((x) => x !== cmd)].slice(0, 60) }));
    if (tid === termId) {
      setTermInput("");
    }
    // Echo locally; sending "$ cmd" would execute it as a command.
    setTermEcho((e) => ({ ...e, [tid]: `${e[tid] || ""}$ ${cmd}\n` }));
    onShellStart(cmd, shellCwd?.[tid] || cwd, tid);
  };

  /** The shell running in the active terminal, if any. */
  const runningId = shellRunning?.[termId] || null;
  /** Where this terminal is — the folder it started in until a `cd` moves it. */
  const termCwd = shellCwd?.[termId] || cwd;

  /**
   * Ctrl+C: show the caret a real terminal shows, then interrupt the process.
   * The server sends SIGINT and force-kills if the process ignores it.
   */
  const interrupt = () => {
    if (!runningId) return;
    setTermEcho((e) => ({ ...e, [termId]: `${e[termId] || ""}^C\n` }));
    onShellKill?.(runningId, "SIGINT");
    termInputRef.current?.focus();
  };
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [treeErr, setTreeErr] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /**
   * Editor groups. VS Code lets you split the editor, and both sides share one
   * document model — so `docs` and `buffers` are keyed by path and shared, while
   * each group keeps its own tab strip and its own active file.
   */
  const [groups, setGroups] = useState<{ id: string; tabs: { path: string; label: string }[]; active: string | null }[]>([
    { id: "g0", tabs: [], active: null },
  ]);
  const [focus, setFocus] = useState(0);
  /** File contents, shared by every group that has the file open. */
  const [docs, setDocs] = useState<Record<string, { path: string; text: string }>>({});
  /** Edited text per path; presence means unsaved. */
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [docErr, setDocErr] = useState("");

  // Focus-scoped views over the focused group, so existing code reads naturally.
  const grp = groups[Math.min(focus, groups.length - 1)] || groups[0];
  const tabs = grp.tabs;
  const active = grp.active;
  const tab: string = diffFile
    ? DIFF_TAB
    : pinned && previewUrl
      ? PREVIEW_TAB
      : active || "";

  const patchGroup = (i: number, fn: (g: { id: string; tabs: { path: string; label: string }[]; active: string | null }) => typeof g) =>
    setGroups((gs) => gs.map((g, k) => (k === i ? { ...g, ...fn(g) } : g)));

  const setActive = (v: string | null | ((prev: string | null) => string | null)) =>
    patchGroup(focus, (g) => ({ ...g, active: typeof v === "function" ? v(g.active) : v }));
  const setTabs = (v: { path: string; label: string }[] | ((prev: { path: string; label: string }[]) => { path: string; label: string }[])) =>
    patchGroup(focus, (g) => ({ ...g, tabs: typeof v === "function" ? v(g.tabs) : v }));

  /** Close a group; the last one can never be closed. */
  const closeGroup = (i: number) =>
    setGroups((gs) => (gs.length <= 1 ? gs : gs.filter((_, k) => k !== i)));
  const splitEditor = () =>
    setGroups((gs) =>
      gs.length >= 2 ? gs : [...gs, { id: `g${gs.length}`, tabs: [], active: null }],
    );

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [git, setGit] = useState<GitState | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------------------------------------- data load */

  const loadTree = useCallback(async () => {
    if (!cwd) return null;
    try {
      const r = await fetch(`/api/fs/tree?path=${encodeURIComponent(cwd)}&depth=6`);
      const j = await r.json();
      if (j.tree) {
        setTree(j.tree);
        setTreeErr("");
        // Open the root plus its first folder, like a real file explorer.
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(j.tree.path);
          for (const c of j.tree.children || []) if (c.type === "dir") next.add(c.path);
          return next;
        });
        return j.tree as TreeNode;
      }
    } catch {
      setTreeErr("Could not read the folder.");
    }
    return null;
  }, [cwd]);

  const loadGit = useCallback(async () => {
    try {
      const r = await fetch(`/api/git?path=${encodeURIComponent(cwd)}`);
      setGit(await r.json());
    } catch {
      setGit(null);
    }
  }, [cwd]);

  useEffect(() => {
    let dead = false;
    setGroups([{ id: "g0", tabs: [], active: null }]);
    setFocus(0);
    setDocs({});
    setHits([]);
    setSearched(false);
    loadGit();

    // Reopen what this folder had open last time; if it is new to us, show a
    // real file rather than a "getting started" card, which is what made
    // returning users feel like first-time ones.
    (async () => {
      const tree = await loadTree();
      if (dead) return;
      const saved = loadSavedTabs(cwd).filter(Boolean);
      const picks = saved.length ? saved : pickEntryFiles(tree);
      for (const p of picks) {
        if (dead) return;
        await openFile(p);
      }
    })();

    return () => {
      dead = true;
    };
    // openFile is stable for a given cwd; re-running on it would fight the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, loadTree, loadGit]);

  // Remember the open tabs per folder. An empty set is ignored so that the
  // reset above cannot erase what the user had open.
  useEffect(() => {
    const paths = groups.flatMap((g) => g.tabs.map((t) => t.path));
    if (!paths.length || !cwd) return;
    saveSavedTabs(cwd, paths);
  }, [groups, cwd]);

  const openFile = useCallback(async (path: string, gotoLine?: number) => {
    try {
      const r = await fetch(`/api/fs/read?path=${encodeURIComponent(path)}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setDocs((d) => ({ ...d, [path]: { path, text: j.binary ? "(binary file — cannot edit here)" : (j.content ?? "") } }));
      setDocErr("");
      setPinned(false);
      setActive(path);
      const label = path.split("/").pop() || path;
      setTabs((t) => (t.some((x) => x.path === path) ? t : [...t, { path, label }].slice(-12)));
      // Jumping from a problem or outline entry lands on that line.
      if (gotoLine && !j.binary) {
        const lines = String(j.content ?? "").split("\n");
        let pos = 0;
        for (let i = 0; i < Math.max(0, gotoLine - 1) && i < lines.length; i++) pos += lines[i].length + 1;
        requestAnimationFrame(() => {
          const el = taRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(pos, pos + (lines[gotoLine - 1]?.length || 0));
          el.scrollTop = Math.max(0, (gotoLine - 6) * 20);
        });
      }
    } catch (e: any) {
      setDocErr(e?.message || "Could not open that file.");
    }
  }, []);

  const edit = useCallback((path: string, text: string) => {
    setBuffers((b) => ({ ...b, [path]: text }));
    setSaveMsg("");
  }, []);

  const save = useCallback(
    async (path: string) => {
      const text = buffers[path];
      if (text === undefined) return;
      setSaving(true);
      try {
        const r = await fetch("/api/fs/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content: text }),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        setBuffers((b) => {
          const next = { ...b };
          delete next[path];
          return next;
        });
        setDocs((d) => (d[path] ? { ...d, [path]: { ...d[path], text } } : d));
        setSaveMsg(`Saved ${j.bytes} bytes`);
      } catch (e: any) {
        setSaveMsg(`Save failed: ${e?.message || String(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [buffers],
  );

  /**
   * Follow the agent's writes.
   *
   * The tree is rebuilt so new files appear straight away, and any open file
   * the agent changed on disk is reloaded — but only when it has no unsaved
   * edits of its own, which must never be silently overwritten.
   */
  /**
   * Rows to flash: paths the agent touched in the last couple of seconds.
   * This is what makes a write legible — without it the tree silently
   * reorders and you cannot tell what just happened.
   */
  const [recent, setRecent] = useState<Record<string, number>>({});
  const [liveWrite, setLiveWrite] = useState<string>("");

  const fsTickRef = useRef(fsTick);
  useEffect(() => {
    if (fsTick === fsTickRef.current) return;
    fsTickRef.current = fsTick;

    const touched = (fsChange?.paths || []).filter(Boolean);
    if (touched.length) {
      const now = Date.now();
      setRecent((r) => {
        const next = { ...r };
        for (const p of touched) next[p] = now;
        // Keep the map from growing without bound during a long run.
        for (const [k, t] of Object.entries(next)) if (now - t > 8000) delete next[k];
        return next;
      });
      // The newest touch is what the agent is working on right now.
      setLiveWrite(touched[touched.length - 1]);

      // Reveal it: expand every folder between the root and the file.
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const p of touched) {
          const parts = p.split("/");
          for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
        }
        return next;
      });
    }

    loadTree();
    // Read through refs: this effect only re-runs on fsTick, so the captured
    // `buffers`/`groups` would be stale — and a stale buffer map means missing
    // a dirty file and silently overwriting the user's unsaved edits.
    const curBuffers = buffersRef.current;
    const curGroups = groupsRef.current;
    const stale = curGroups.flatMap((g) => g.tabs.map((t) => t.path));
    if (!stale.length) return;
    (async () => {
      const docs: Record<string, { path: string; text: string }> = {};
      let touched = false;
      for (const p of new Set(stale)) {
        if (curBuffers[p] !== undefined) continue; // has unsaved edits — leave it
        try {
          const r = await fetch(`/api/fs/read?path=${encodeURIComponent(p)}`);
          const j = await r.json();
          if (j?.error || j?.binary) continue;
          const cur = docsRef.current[p]?.text;
          if (cur !== undefined && cur === j.content) continue; // nothing moved
          docs[p] = { path: p, text: j.content ?? "" };
          touched = true;
        } catch {
          /* ignore */
        }
      }
      if (!touched) return;
      docsRef.current = { ...docsRef.current, ...docs };
      setDocs((d) => ({ ...d, ...docs }));
    })();
  }, [fsTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!liveWrite) return;
    const t = setTimeout(() => setLiveWrite(""), 2600);
    return () => clearTimeout(t);
  }, [liveWrite, fsTick]);

  const docsRef = useRef<Record<string, { path: string; text: string }>>({});
  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);
  const buffersRef = useRef(buffers);
  useEffect(() => {
    buffersRef.current = buffers;
  }, [buffers]);
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // Ctrl/Cmd+S saves the active file.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (active && buffers[active] !== undefined) void save(active);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        if (groups.length >= 2) closeGroup(groups.length - 1);
        else splitEditor();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpen((q) => !q);
        return;
      }
      // Ctrl+F find, Ctrl+H replace, Ctrl+G go to line — VS Code's defaults.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setFindOpen(true);
        setReplaceOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setQuickOpen((q) => !q);
        setQuickQuery("@line:");
        return;
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        setReplaceOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, buffers, save, findOpen, groups]);

  /* ---------------------------------------------------------------- search */

  const runSearch = useCallback(
    (q: string) => {
      setQuery(q);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (!q.trim()) {
        setHits([]);
        setSearched(false);
        return;
      }
      setSearching(true);
      searchTimer.current = setTimeout(async () => {
        try {
          const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(cwd)}`);
          const j = await r.json();
          setHits(j.results || []);
        } catch {
          setHits([]);
        } finally {
          setSearching(false);
          setSearched(true);
        }
      }, 350);
    },
    [cwd],
  );

  /** Ctrl/Cmd+P — jump to any file by name, VS Code style. */
  const quickMatches = useMemo(() => {
    if (!quickOpen) return [];
    const q = quickQuery.trim().toLowerCase();
    const files = flatVisibleFiles();
    if (!q) return files.slice(0, 12);
    return files
      .map((f) => {
        const n = f.name.toLowerCase();
        const p = f.path.toLowerCase();
        let s = -1;
        if (n.startsWith(q)) s = 100;
        else if (n.includes(q)) s = 70;
        else if (p.includes(q)) s = 50;
        else {
          let i = 0;
          for (const ch of n) if (ch === q[i]) i++;
          if (i === q.length && q.length >= 2) s = 30;
        }
        return { f, s };
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.f);
  }, [quickOpen, quickQuery, tree, expanded]);

  /** Every file under the tree, regardless of fold state. */
  function flatVisibleFiles(): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      if (n.type === "file") out.push(n);
      for (const c of n.children || []) walk(c);
    };
    if (tree) walk(tree);
    return out;
  }

  /* ---------------------------------------------------------------- render */

  const flatVisible = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode, depth: number) => {
      if (depth > 8) return;
      out.push(n);
      if (n.type === "dir" && expanded.has(n.path)) for (const c of n.children || []) walk(c, depth + 1);
    };
    if (tree) walk(tree, 0);
    return out;
  }, [tree, expanded]);

  // Run the project's own checker. Problems are real, not decorative.
  const refreshProblems = useCallback(async () => {
    setDiagnosing(true);
    try {
      const r = await fetch(`/api/diagnostics?path=${encodeURIComponent(cwd)}`);
      const j = await r.json();
      setProblems(Array.isArray(j?.problems) ? j.problems : []);
    } catch {
      setProblems([]);
    } finally {
      setDiagnosing(false);
    }
  }, [cwd]);

  const loadOutput = useCallback(async () => {
    try {
      const r = await fetch("/api/output");
      const j = await r.json();
      setOutputLines((j.lines || []).map((x: any) => x.line));
    } catch {
      setOutputLines([]);
    }
  }, []);

  // Fetch the server log the first time the Output tab is opened.
  useEffect(() => {
    if (bottom === "output" && !outputLines.length) void loadOutput();
  }, [bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;

  const railBtn = (view: RailView, icon: string, label: string) => (
    <button
      className={`ide-rail-btn${rail === view ? " on" : ""}`}
      onClick={() => setRail(rail === view ? null : view)}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );

  const activeDoc = active ? docs[active] ?? null : null;
  const editableText = activeDoc ? (buffers[activeDoc.path] ?? activeDoc.text) : "";

  /**
   * Map each changed file to a short status letter, so the explorer can carry
   * the same M / A / D decorations git users already expect.
   */
  const gitStatus = useMemo(() => {
    const map: Record<string, string> = {};
    const g: any = git;
    if (!g) return map;
    const mark = (file: string, code: string) => {
      if (!file) return;
      map[file.replace(cwd + "/", "")] = code;
    };
    for (const f of g.staged || []) mark(typeof f === "string" ? f : f.path, "A");
    for (const f of g.changed || []) mark(typeof f === "string" ? f : f.path, "M");
    for (const f of g.untracked || []) mark(typeof f === "string" ? f : f.path, "U");
    for (const f of g.deleted || []) mark(typeof f === "string" ? f : f.path, "D");
    return map;
  }, [git, cwd]);

  /** Path segments plus the enclosing symbol at the caret, VS Code style. */
  const crumbs = useMemo(() => {
    if (!activeDoc) return [] as { label: string; symbol: boolean }[];
    const rel = activeDoc.path.startsWith(cwd) ? activeDoc.path.slice(cwd.length + 1) : activeDoc.path;
    const parts = rel.split("/").filter(Boolean);
    return parts.map((label, i) => ({ label, symbol: i === parts.length - 1 }));
  }, [activeDoc, cwd]);

  /**
   * File outline. Deliberately a regex pass rather than a language server:
   * it works offline, costs nothing, and is right often enough to navigate by.
   */
  const outline = useMemo(() => {
    if (!activeDoc) return [] as { name: string; line: number; kind: string }[];
    const re = /^\s*(?:export\s+)?(?:(async\s+)?function\s*\*?\s*(\w+)|(?:const|let|var)\s+(\w+)\s*=|class\s+(\w+)|def\s+(\w+)|fn\s+(\w+)|(\w+)\s*\([^)]*\)\s*\{|(interface|type|struct|enum)\s+(\w+))/;
    const out: { name: string; line: number; kind: string }[] = [];
    editableText.split("\n").forEach((line, i) => {
      const m = re.exec(line);
      if (!m) return;
      const name = m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || m[8];
      if (!name || name === "if" || name === "for" || name === "while" || name === "switch") return;
      const kind = m[1] ? "function" : m[2] || m[3] ? "const" : m[4] ? "class" : m[5] ? "def" : m[6] ? "fn" : m[8] ? "type" : "method";
      out.push({ name, line: i + 1, kind });
    });
    return out.slice(0, 300);
  }, [activeDoc, editableText]);


  /** Every occurrence of the search text, as absolute offsets into the buffer. */
  const matches = useMemo(() => {
    if (!findText || tab === PREVIEW_TAB) return [] as { start: number; end: number }[];
    const hay = findCase ? editableText : editableText.toLowerCase();
    const needle = findCase ? findText : findText.toLowerCase();
    const out: { start: number; end: number }[] = [];
    if (!needle) return out;
    let i = hay.indexOf(needle);
    while (i !== -1 && out.length < 5000) {
      out.push({ start: i, end: i + needle.length });
      i = hay.indexOf(needle, i + Math.max(1, needle.length));
    }
    return out;
  }, [findText, findCase, editableText, tab]);

  const taRef = useRef<HTMLTextAreaElement>(null);

  /** Absolute offset where line `line` starts. */
  const lineStartAt = (line: number): number => {
    const full = editableText.split("\n");
    let pos = 0;
    for (let i = 0; i < line && i < full.length; i++) pos += full[i].length + 1;
    return pos;
  };

  /**
   * Split one line into decorated runs: find matches plus any extra multi-cursor
   * selections and carets. Ranges are merged into non-overlapping segments so
   * the syntax colouring underneath stays intact.
   */
  const matchSpansForLine = (line: number): { text: string; match: boolean; active: boolean; sel?: boolean }[] => {
    const full = editableText.split("\n");
    const lineStart = lineStartAt(line);
    const lineText = full[line] ?? "";
    const plain: { text: string; match: boolean; active: boolean; sel?: boolean }[] = [
      { text: lineText, match: false, active: false },
    ];
    if (lineText === "" && !matches.length && !cursors.length) return plain;

    type R = { s: number; e: number; cls: { match: boolean; active: boolean; sel: boolean } };
    const ranges: R[] = [];
    for (const m of matches) {
      if (m.end <= lineStart || m.start >= lineStart + lineText.length) continue;
      ranges.push({
        s: Math.max(m.start, lineStart) - lineStart,
        e: Math.min(m.end, lineStart + lineText.length) - lineStart,
        cls: { match: true, active: m === matches[matchIdx % matches.length], sel: false },
      });
    }
    for (const c of cursors) {
      if (c.end > c.start) {
        if (c.end <= lineStart || c.start >= lineStart + lineText.length) continue;
        ranges.push({
          s: Math.max(c.start, lineStart) - lineStart,
          e: Math.min(c.end, lineStart + lineText.length) - lineStart,
          cls: { match: false, active: false, sel: true },
        });
      }
    }
    if (!ranges.length) return [{ text: lineText, match: false, active: false }];
    ranges.sort((a, b) => a.s - b.s);

    const out: { text: string; match: boolean; active: boolean; sel?: boolean }[] = [];
    let cur = 0;
    for (const r of ranges) {
      if (r.s > cur) out.push({ text: lineText.slice(cur, r.s), match: false, active: false });
      if (r.e > r.s) out.push({ text: lineText.slice(r.s, r.e), ...r.cls });
      cur = Math.max(cur, r.e);
    }
    if (cur < lineText.length) out.push({ text: lineText.slice(cur), match: false, active: false });
    return out.length ? out : [{ text: lineText, match: false, active: false }];
  };

  /** Caret positions that must be painted, as offsets. */
  const caretOffsets = useMemo(() => {
    if (cursors.length < 2) return [] as number[];
    return cursors.map((c) => (c.end > c.start ? c.end : c.start));
  }, [cursors]);

  // Keep the caret on the current match so the next edit lands in the right place.
  useEffect(() => {
    if (!findOpen || !matches.length) return;
    const m = matches[Math.min(matchIdx, matches.length - 1)];
    if (!m) return;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(m.start, m.end);
    // Scroll the match into view without stealing the whole viewport.
    const before = editableText.slice(0, m.start);
    const line = before.split("\n").length;
    const lineH = fontSize * 1.62;
    if (el.scrollTop !== undefined) el.scrollTop = Math.max(0, (line - 6) * lineH);
  }, [matchIdx, matches, findOpen, editableText, fontSize]);

  /** Apply one edit to every caret at once. */
  const applyToCursors = (path: string, text: string, fn: (slice: string) => string) => {
    if (!cursors.length) return;
    const res = applyToRanges(text, cursors, fn);
    edit(path, res.text);
    setCursors(res.ranges);
    const p = res.ranges[Math.min(cursorIdx, res.ranges.length - 1)];
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el && p) el.setSelectionRange(p.start, p.end);
    });
  };

  /** Ctrl+D — add a caret on the next occurrence of the current selection. */
  const addNextOccurrence = () => {
    const el = taRef.current;
    if (!el) return;
    const sel = el.value.slice(el.selectionStart, el.selectionEnd);
    if (!sel) return;
    const from = Math.max(...cursors.map((c) => c.end));
    const i = nextOccurrence(el.value, sel, from, cursors.map((c) => c.start), findCase);
    if (i === -1) return;
    const next = [...cursors, { start: i, end: i + sel.length }].sort((a, b) => a.start - b.start);
    setCursors(next);
    setCursorIdx(next.findIndex((c) => c.start === i));
    requestAnimationFrame(() => el.setSelectionRange(i, i + sel.length));
  };

  /** Ctrl+Alt+Up/Down — add a caret on the line above or below. */
  const addCaretVertically = (dir: -1 | 1) => {
    const el = taRef.current;
    if (!el) return;
    const cur = cursors[cursorIdx] || { start: el.selectionStart, end: el.selectionEnd };
    const text = el.value;
    const startLine = text.slice(0, cur.start).split("\n").length - 1;
    const lines = text.split("\n");
    const col = cur.start - lineOffset(text, startLine);
    const target = startLine + dir;
    if (target < 0 || target >= lines.length) return;
    const pos = lineOffset(text, target) + Math.min(col, lines[target].length);
    // Dedup by position only — merging overlapping *selections* would collapse
    // the new caret into its neighbour.
    const seen = new Set<number>();
    const next = [...cursors, { start: pos, end: pos }]
      .filter((c) => (seen.has(c.start) ? false : (seen.add(c.start), true)))
      .sort((a, b) => a.start - b.start);
    setCursors(next);
    setCursorIdx(next.findIndex((c) => c.start === pos));
    requestAnimationFrame(() => el.setSelectionRange(pos, pos));
  };

  const collapseCursors = () => {
    setCursors([]);
    setCursorIdx(0);
  };

  /**
   * Alt+Click places an extra caret.
   *
   * The offset is measured against the highlight layer rather than the textarea,
   * because that is where the user actually pointed. A zero-length text node is
   * inserted at the very front first so the first line's offsets line up with
   * the document exactly.
   */
  const caretFromPoint = (clientX: number, clientY: number): number | null => {
    const pre = document.querySelector(".ide-highlight") as HTMLElement | null;
    if (!pre) return null;
    const marker = document.createTextNode("");
    pre.insertBefore(marker, pre.firstChild);

    let offset: number | null = null;
    const anyDoc = document as any;
    try {
      if (anyDoc.caretRangeFromPoint) {
        const r: Range = anyDoc.caretRangeFromPoint(clientX, clientY);
        if (pre.contains(r.startContainer)) {
          r.setStart(marker, 0);
          offset = r.startOffset;
        }
      } else if (anyDoc.caretPositionFromPoint) {
        const pos = anyDoc.caretPositionFromPoint(clientX, clientY);
        if (pos && pre.contains(pos.offsetNode)) {
          const r = document.createRange();
          r.setStart(marker, 0);
          r.setEnd(pos.offsetNode, pos.offset);
          offset = r.toString().length;
        }
      }
    } catch {
      offset = null;
    }
    marker.remove();
    return offset;
  };

  const stepMatch = (d: number) => {
    if (!matches.length) return;
    setMatchIdx((i) => (i + d + matches.length) % matches.length);
  };

  const doReplace = (all: boolean) => {
    if (!matches.length || tab === PREVIEW_TAB || !active) return;
    const apply = (needle: string) =>
      findCase
        ? editableText.split(needle).join(replText)
        : editableText.replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replText);
    const next = all ? apply(findText) : editableText.slice(0, matches[matchIdx].start) + replText + editableText.slice(matches[matchIdx].end);
    edit(active, next);
    if (all) setMatchIdx(0);
  };

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [ctx]);

  // Explorer operations: create / rename / delete, behind the same workspace guard.
  const treeOp = async (action: "create" | "rename" | "delete", path: string, extra: Record<string, any> = {}) => {
    try {
      const res = await fetch(`/api/fs/op?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, ...extra }),
      });
      const j = await res.json();
      if (j?.error) {
        setTreeNote(j.error);
        return;
      }
      setTreeNote(action === "delete" ? `Deleted ${path.split("/").pop()}` : "");
      // Drop open tabs that no longer exist (or whose path just moved).
      if (action === "delete" && active === path) setActive(null);
      if (action === "rename" && buffers[path] !== undefined && j.to) {
        setBuffers((b) => {
          const next = { ...b };
          delete next[path];
          next[j.to] = b[path];
          return next;
        });
        setTabs((t) => t.map((x) => (x.path === path ? { ...x, path: j.to, label: j.to.split("/").pop() || x.label } : x)));
        setActive(j.to);
      }
      loadTree();
    } catch (e: any) {
      setTreeNote(e?.message || "That didn't work");
    }
  };

  const parentDir = (p: string) => (p === cwd ? cwd : p.slice(0, p.lastIndexOf("/")));

  /**
   * Run a file the way the user would from a shell. Web pages open in the live
   * preview; everything else executes in the terminal below the editor.
   */
  const RUN_CMD: Record<string, string> = {
    py: "python3",
    js: "node",
    mjs: "node",
    cjs: "node",
    ts: "npx tsx",
    sh: "bash",
    rb: "ruby",
    php: "php",
    json: "cat",
    md: "cat",
    csv: "cat",
    txt: "cat",
    log: "cat",
    yml: "cat",
    yaml: "cat",
  };

  const runFile = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    if (ext === "html" || ext === "htm") {
      onRunFile(path);
      return;
    }
    setBottom("terminal");
    const runner = RUN_CMD[ext];
    if (!runner) {
      // Unknown type: open it in the editor rather than guessing a runtime.
      openFile(path);
      return;
    }
    runTerm(`${runner} ${JSON.stringify(path)}`);
  };

  // A preview that appears (dev server started) opens as its own editor tab.
  useEffect(() => {
    if (previewUrl) setPinned(true);
  }, [previewUrl]);

  // Follow the tail as output streams in.
  useEffect(() => {
    const el = termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [out]);


  return (
    <div className="ide">
      {/* activity bar */}
      <div className="ide-activity">
        {railBtn("files", "▤", "Explorer")}
        {railBtn("search", "⌕", "Search")}
        {railBtn("git", "⑂", "Source control")}
        {railBtn("ports", "⇄", "Servers")}
        {railBtn("outline", "≡", "Outline")}
        {railBtn("db", "⛁", "Database")}
        {railBtn("market", "◫", "Extensions")}
        <div className="ide-rail-gap" />
        <button
          className={`ide-rail-btn${chatOpen ? " on" : ""}`}
          onClick={onToggleChat}
          title={chatOpen ? "Hide the agent panel" : "Show the agent panel"}
          aria-label={chatOpen ? "Hide the agent panel" : "Show the agent panel"}
        >
          ✦
        </button>
      </div>

      {/* side panel */}
      {rail && (
        <div className="ide-side">
          {/* Feedback from explorer actions (renamed, deleted, refused). */}
          {treeNote && <div className="ide-tree-note">{treeNote}</div>}
          <div className="ide-side-title">
            {rail === "files"
              ? "Explorer"
              : rail === "search"
                ? "Search"
                : rail === "db"
                  ? "Database"
                  : rail === "ports"
                    ? "Servers"
                    : rail === "market"
                    ? "Extensions"
                    : "Source Control"}
          </div>

          {rail === "files" && (
            <>
              <div className="ide-side-sub" title={cwd}>
                {cwd.split("/").filter(Boolean).pop() || cwd}
              </div>
              {treeErr && <div className="ide-empty">{treeErr}</div>}
              {tabs.length > 0 && (
                <div className="ide-open-editors">
                  <div className="ide-group-label">Open Editors</div>
                  {tabs.map((t) => (
                    <button
                      key={t.path}
                      className={`ide-file${active === t.path && !pinned ? " on" : ""}`}
                      style={{ paddingLeft: 10 }}
                      onClick={() => openFile(t.path)}
                      title={t.path}
                    >
                      <span className="ide-file-icon">·</span>
                      {buffers[t.path] !== undefined && <span className="ide-dirty" />}
                      <span className="ide-file-name">{t.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {!tree && !treeErr && <div className="ide-empty">Loading…</div>}
              <div className="ide-tree">
                {flatVisible.map((n) => {
                  const isDir = n.type === "dir";
                  const isOpen = expanded.has(n.path);
                  return (
                    <button
                      key={n.path}
                      className={`ide-file${active === n.path ? " on" : ""}${recent[n.path] ? " flash" : ""}`}
                      style={{ paddingLeft: 10 + (countDepth(flatVisible, n.path) * 12) }}
                      onClick={() => {
                        if (rename) return;
                        if (isDir) {
                          setExpanded((s) => {
                            const next = new Set(s);
                            next.has(n.path) ? next.delete(n.path) : next.add(n.path);
                            return next;
                          });
                        } else {
                          openFile(n.path);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (rename) return;
                        setCtx({ x: e.clientX, y: e.clientY, node: n });
                      }}
                      title={n.path}
                    >
                      <span className="ide-file-icon">{isDir ? (isOpen ? "▾" : "▸") : "·"}</span>
                      {gitStatus[n.path.replace(cwd + "/", "")] && (
                        <span className={`ide-git git-${gitStatus[n.path.replace(cwd + "/", "")]}`}>
                          {gitStatus[n.path.replace(cwd + "/", "")]}
                        </span>
                      )}
                      {rename && rename.path === n.path ? (
                        <input
                          className="ide-rename"
                          autoFocus
                          value={rename.name}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRename({ ...rename, name: e.target.value })}
                          onBlur={() => {
                            const r = rename;
                            setRename(null);
                            if (!r.name.trim() || r.name === n.name) return;
                            void treeOp("rename", n.path, { to: `${parentDir(n.path)}/${r.name.trim()}` });
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setRename(null);
                          }}
                        />
                      ) : (
                        <span className="ide-file-name">{n.name}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {rail === "search" && (
            <>
              <input
                className="ide-search"
                autoFocus
                placeholder="Search in files"
                value={query}
                onChange={(e) => runSearch(e.target.value)}
              />
              <div className="ide-side-sub">
                {searching ? "Searching…" : searched ? `${hits.length} matches` : ""}
              </div>
              <div className="ide-hits">
                {hits.slice(0, 300).map((h, i) => (
                  <button key={`${h.path}:${h.line}:${i}`} className="ide-hit" onClick={() => openFile(h.path)}>
                    <span className="ide-hit-file">
                      {h.rel.split("/").pop()}
                      <span className="ide-hit-loc">:{h.line}</span>
                    </span>
                    <span className="ide-hit-text">{h.text.trim().slice(0, 120)}</span>
                  </button>
                ))}
                {searched && hits.length === 0 && <div className="ide-empty">No results.</div>}
              </div>
            </>
          )}

          {rail === "ports" && (
            <PortsPanel
              onOpen={(url) => {
                setDiffFile(null);
                onOpenServer(url);
                setPinned(true);
              }}
              onAdd={(cmd) => runTerm(cmd)}
            />
          )}
          {rail === "outline" && (
            <div className="ide-outline">
              <div className="ide-group-label">Outline</div>
              {outline.length === 0 && <div className="ide-empty">No symbols found in this file.</div>}
              {outline.map((o, i) => (
                <button key={i} className="ide-file" onClick={() => openFile(activeDoc!.path, o.line)}>
                  <span className="ide-file-icon">{o.kind === "function" ? "ƒ" : o.kind === "class" ? "◇" : "•"}</span>
                  <span className="ide-file-name">{o.name}</span>
                </button>
              ))}
            </div>
          )}
          {rail === "db" && <DatabasePanel cwd={cwd} />}
          {rail === "market" && <Marketplace />}
          {rail === "git" && (
            <>
              {!git && <div className="ide-empty">Loading…</div>}
              {git && !git.isRepo && (
                <div className="ide-empty">Not a git repository. Run `git init` in this folder.</div>
              )}
              {git?.isRepo && (
                <>
                  <div className="ide-branch">⑂ {git.branch || "HEAD"}</div>
                  {git.status.length > 0 && (
                    <>
                      <div className="ide-side-sub">Changes ({git.status.length})</div>
                      {git.status.map((f) => (
                        <div key={f.path} className="ide-git-row" title={f.path}>
                          <span className={`ide-git-badge${f.untracked ? " new" : ""}`}>
                            {f.untracked ? "U" : "M"}
                          </span>
                          <span className="ide-git-path">{f.path.split("/").pop()}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {git.status.length === 0 && <div className="ide-empty">Working tree clean.</div>}
                  <div className="ide-side-sub">Commits ({git.commits.length})</div>
                  {git.commits.slice(0, 15).map((c) => (
                    <div key={c.hash} className="ide-commit">
                      <span className="ide-commit-subject">{c.subject}</span>
                      <span className="ide-commit-meta">{c.hash.slice(0, 7)} · {c.when}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* main column */}
      <div className="ide-main">
        {/* tabs */}
        <div className="ide-groups">
          {groups.map((g, gi) => {
            const gDoc = g.active ? docs[g.active] ?? null : null;
            const gText = gDoc ? (buffers[gDoc.path] ?? gDoc.text) : "";
            return (
              <div
                key={g.id}
                className={`ide-group${gi === focus ? " on" : ""}`}
                onMouseDown={() => setFocus(gi)}
              >
          <div className="ide-tabs">
            {g.tabs.map((t) => (
              <button
                key={t.path}
                className={`ide-tab${g.active === t.path ? " on" : ""}`}
                onClick={() => { setFocus(gi); openFile(t.path); }}
                title={t.path}
              >
                {buffers[t.path] !== undefined && <span className="ide-dirty" title="Unsaved changes" />}
                {t.label}
                <span
                  className="ide-tab-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    patchGroup(gi, (gg) => ({ ...gg, tabs: gg.tabs.filter((x) => x.path !== t.path) }));
                    if (g.active === t.path) {
                      const rest = tabs.filter((x) => x.path !== t.path);
                      const next = rest[rest.length - 1];
                      if (next) openFile(next.path);
                      else {
                        patchGroup(gi, (gg) => ({ ...gg, active: null }));
                        setDocs((d) => { const n = { ...d }; delete n[t.path]; return n; });
                      }
                    }
                  }}
                >
                  ✕
                </span>
              </button>
            ))}
            {/* Preview and Changes belong to the focused group only, or a split
                view would show the same tab twice. */}
            {gi === focus && diffFile && (
              <button
                className={`ide-tab${tab === DIFF_TAB ? " on" : ""}`}
                onClick={() => setDiffFile(diffFile)}
                title={diffFile}
              >
                ⇄ Changes
                <span className="ide-tab-x" onClick={(e) => { e.stopPropagation(); setDiffFile(null); }}>✕</span>
              </button>
            )}
            {gi === focus && previewUrl && (
              <button
                className={`ide-tab${tab === PREVIEW_TAB ? " on" : ""}`}
                onClick={() => setPinned(true)}
                title={previewUrl}
              >
                ▣ Preview
                <span className="ide-tab-x" onClick={(e) => { e.stopPropagation(); setPinned(false); }}>✕</span>
              </button>
            )}
            <div className="ide-tabs-fill" />
          </div>

          {/* Breadcrumbs: the path, so you always know where you are. */}
          {gi === focus && tab !== PREVIEW_TAB && tab !== DIFF_TAB && gDoc && crumbs.length > 0 && (
            <div className="ide-crumbs">
              {crumbs.map((c, i) => (
                <span key={i} className="ide-crumb">
                  {i > 0 && <span className="ide-crumb-sep">›</span>}
                  <span className={c.symbol ? "sym" : ""}>{c.label}</span>
                </span>
              ))}
            </div>
          )}

          {quickOpen && (
            <div className="quick-open">
              <input
                className="quick-input"
                autoFocus
                placeholder="Go to file by name…"
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuickOpen(false);
                  if (e.key === "Enter" && quickMatches[0]) {
                    void openFile(quickMatches[0].path);
                    setQuickOpen(false);
                    setQuickQuery("");
                  }
                }}
              />
              <div className="quick-list">
                {quickMatches.map((f) => (
                  <button
                    key={f.path}
                    className="quick-item"
                    onClick={() => {
                      void openFile(f.path);
                      setQuickOpen(false);
                      setQuickQuery("");
                    }}
                  >
                    <span className="quick-name">{f.name}</span>
                    <span className="quick-path">{f.path.slice(cwd.length + 1) || f.name}</span>
                  </button>
                ))}
                {quickMatches.length === 0 && <div className="quick-empty">No matching files.</div>}
              </div>
            </div>
          )}

          {saveMsg && <div className="ide-savemsg">{saveMsg}</div>}

          {findOpen && (
            <div className="find-bar">
              <div className="find-row">
                <input
                  className="find-input"
                  autoFocus
                  placeholder="Find"
                  value={findText}
                  onChange={(e) => {
                    setFindText(e.target.value);
                    setMatchIdx(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") stepMatch(e.shiftKey ? -1 : 1);
                    if (e.key === "Escape") {
                      setFindOpen(false);
                      setReplaceOpen(false);
                    }
                  }}
                />
                <button
                  className={`find-toggle${findCase ? " on" : ""}`}
                  onClick={() => setFindCase((v) => !v)}
                  title="Match case"
                >
                  Aa
                </button>
                <span className="find-count">
                  {findText ? (matches.length ? `${(matchIdx % matches.length) + 1} of ${matches.length}` : "No results") : ""}
                </span>
                <button className="find-btn" onClick={() => stepMatch(-1)} disabled={!matches.length} title="Previous (Shift+Enter)">
                  ↑
                </button>
                <button className="find-btn" onClick={() => stepMatch(1)} disabled={!matches.length} title="Next (Enter)">
                  ↓
                </button>
                <button
                  className="find-btn"
                  onClick={() => {
                    setReplaceOpen((v) => !v);
                    setFindOpen(true);
                  }}
                  title="Toggle replace"
                >
                  {replaceOpen ? "▴" : "▾"}
                </button>
                <button
                  className="find-btn"
                  onClick={() => {
                    setFindOpen(false);
                    setReplaceOpen(false);
                  }}
                  title="Close (Esc)"
                >
                  ✕
                </button>
              </div>
              {replaceOpen && (
                <div className="find-row">
                  <input
                    className="find-input"
                    placeholder="Replace"
                    value={replText}
                    onChange={(e) => setReplText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setFindOpen(false);
                    }}
                  />
                  <button className="find-btn wide" onClick={() => doReplace(false)} disabled={!matches.length}>
                    Replace
                  </button>
                  <button className="find-btn wide" onClick={() => doReplace(true)} disabled={!matches.length}>
                    Replace All
                  </button>
                </div>
              )}
            </div>
          )}

          {/* editor */}
          <div className="ide-editor">
            {!gDoc && !docErr && (
              <div className="ide-welcome">
                <div className="ide-welcome-mark">✦</div>
                <p>No file open — pick one from the explorer, or ask the agent.</p>
              </div>
            )}
            {docErr && <div className="ide-empty">{docErr}</div>}
            {tab === PREVIEW_TAB && previewUrl && (
              <div className="ide-preview-host">
                <PreviewPanel url={previewUrl} onClose={() => { setPinned(false); onClosePreview(); }} onUrlChange={onUrlChange} />
              </div>
            )}
            {tab === DIFF_TAB && diffFile && (
              <DiffView cwd={cwd} file={diffFile} onClose={() => setDiffFile(null)} />
            )}
            {tab !== PREVIEW_TAB && tab !== DIFF_TAB && gDoc && (
              <div
                className="ide-edit"
                data-wrap={wrap ? "on" : "off"}
                style={{ fontSize, "--ide-tab-size": String(tabSize) } as React.CSSProperties}
              >
                {/* The highlight layer sits behind a transparent textarea so the
                    caret and selection stay real while the colours update. */}
                <pre className="ide-highlight" aria-hidden="true">
                  <code>
                    {gText.split("\n").map((line, i) => {
                      const spans = matchSpansForLine(i);
                      const start = lineStartAt(i);
                      const width = gText.split("\n")[i]?.length ?? 0;
                      const lineCarets = caretOffsets.filter((o) => o >= start && o <= start + width);
                      return (
                        <span key={i} className="ide-line">
                          <span className="ide-ln">{i + 1}</span>
                          <span className="ide-lc">
                            {spans.map((sp, k) =>
                              sp.sel ? (
                                <mark key={k} className="mc-sel">
                                  {highlight(sp.text, langOf(gDoc.path))}
                                </mark>
                              ) : sp.match ? (
                                <mark key={k} className={`find-hit${sp.active ? " cur" : ""}`}>
                                  {highlight(sp.text, langOf(gDoc.path))}
                                </mark>
                              ) : (
                                <span key={k}>{highlight(sp.text, langOf(gDoc.path))}</span>
                              ),
                            )}
                            {lineCarets.map((o, k) => (
                              <span key={`c${k}`} className="mc-caret" style={{ left: `${o - start}ch` }} />
                            ))}
                          </span>
                        </span>
                      );
                    })}
                    {"\n"}
                  </code>
                </pre>
                <textarea
                  ref={taRef}
                  className="ide-input"
                  value={gText}
                  spellCheck={false}
                  wrap="off"
                  onChange={(e) => {
                  if (cursors.length < 2) {
                    const el = e.currentTarget;
                    setCursors([{ start: el.selectionStart, end: el.selectionEnd }]);
                  }
                  edit(gDoc.path, e.target.value);
                }}
                onSelect={(e) => {
                  if (cursors.length < 2) {
                    const el = e.currentTarget;
                    const s = el.selectionStart;
                    const en = el.selectionEnd;
                    if (!cursors.length || cursors[0].start !== s || cursors[0].end !== en) {
                      setCursors([{ start: s, end: en }]);
                      setCursorIdx(0);
                    }
                  }
                }}
                onClick={(e) => {
                  if (e.altKey) {
                    const off = caretFromPoint(e.clientX, e.clientY);
                    if (off === null) return;
                    e.preventDefault();
                    setCursors((cs) =>
                      cs.some((c) => c.start === off) ? cs : [...cs, { start: off, end: off }].sort((a, b) => a.start - b.start),
                    );
                  }
                }}
                  onKeyDown={(e) => {
                    const mod = e.ctrlKey || e.metaKey;
                    if (mod && !e.altKey && e.key.toLowerCase() === "d") {
                      e.preventDefault();
                      addNextOccurrence();
                      return;
                    }
                    if (mod && e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                      e.preventDefault();
                      addCaretVertically(e.key === "ArrowDown" ? 1 : -1);
                      return;
                    }
                    if (e.key === "Escape" && cursors.length > 1) {
                      e.preventDefault();
                      collapseCursors();
                      return;
                    }
                    // A plain <textarea> would only edit its own single native
                    // selection, so with several carets we apply the edit to
                    // every one of them here.
                    if (cursors.length > 1) {
                      const printable = e.key.length === 1 && !mod && !e.altKey;
                      if (printable) {
                        e.preventDefault();
                        applyToCursors(gDoc.path, gText, () => e.key);
                        return;
                      }
                      if (e.key === "Backspace") {
                        e.preventDefault();
                        applyToCursors(gDoc.path, gText, (sl) => (sl === "" ? sl : sl.slice(0, -1)));
                        return;
                      }
                      if (e.key === "Delete") {
                        e.preventDefault();
                        applyToCursors(gDoc.path, gText, (sl) => sl.slice(1));
                        return;
                      }
                    }
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const s = el.selectionStart;
                      const next = `${gText.slice(0, s)}  ${gText.slice(el.selectionEnd)}`;
                      edit(gDoc.path, next);
                      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
                    }
                  }}
                />
              </div>
            )}
          </div>
              </div>
            );
          })}
        </div>

        {/* bottom panel */}
        {bottom && (
          <div className="ide-bottom">
            <div className="ide-bottom-tabs">
              {(["problems", "output", "terminal"] as BottomView[]).map((b) => (
                <button
                  key={b}
                  className={`ide-bottom-tab${bottom === b ? " on" : ""}`}
                  onClick={() => setBottom(bottom === b ? null : b)}
                >
                  {b === "terminal"
                    ? "Terminal"
                    : b === "problems"
                      ? `Problems${errors ? ` (${errors})` : ""}`
                      : "Output"}
                  {b === "problems" && <span className="ide-badge-n">0</span>}
                </button>
              ))}
              <div className="ide-tabs-fill" />
              <button className="ide-bottom-x" onClick={() => setBottom(null)}>
                ✕
              </button>
            </div>
            <div className="ide-bottom-body">
              {bottom === "terminal" && (
                <div className="ide-term">
                  {termIds.length > 1 && (
                    <div className="ide-term-tabs">
                      {termIds.map((t, i) => (
                        <button
                          key={t}
                          className={`ide-term-tab${i === termActive ? " on" : ""}`}
                          onClick={() => selectTerminal(i)}
                          title={`Terminal ${i + 1}`}
                        >
                          {i + 1}
                          {termIds.length > 1 && (
                            <span className="ide-term-x" onClick={(e) => { e.stopPropagation(); closeTerminal(i); }}>✕</span>
                          )}
                        </button>
                      ))}
                      <button className="ide-term-add" onClick={addTerminal} title="New terminal">+</button>
                    </div>
                  )}
                  <div className="ide-term-out" ref={termRef} style={{ fontSize: termFont }}>
                    {!out && (
                      <div className="ide-term-hint">
                        Run commands here — same shell and permissions as the agent. Try{" "}
                        <code>npm test</code>, <code>git status</code>, <code>ls</code>.
                      </div>
                    )}
                    <pre className="ide-term-pre">{out}</pre>
                  </div>
                  <div className="ide-term-in-row">
                    <span className="ide-term-prompt" title={termCwd}>
                      {runningId ? "…" : nameOfPath(termCwd) + " $"}
                    </span>
                    <input
                      ref={termInputRef}
                      className="ide-term-in"
                      value={termInput}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={runningId ? "Running — Ctrl+C to stop" : "Run a command"}
                      onChange={(e) => setTermInput(e.target.value)}
                      onKeyDown={(e) => {
                        // Ctrl+C, straight from the muscle memory of a real
                        // terminal: interrupt the running process.
                        if (e.ctrlKey && !e.metaKey && (e.key === "c" || e.key === "C")) {
                          if (runningId) {
                            e.preventDefault();
                            interrupt();
                          }
                          return;
                        }
                        if (e.key === "Enter") runTerm(termInput);
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setTermInput(history[0] || "");
                        }
                      }}
                    />
                    {runningId ? (
                      <button
                        className="ide-term-run stop"
                        onClick={() => interrupt()}
                        title="Stop the running command (Ctrl+C)"
                      >
                        Stop
                      </button>
                    ) : (
                      <button className="ide-term-run" onClick={() => runTerm(termInput)}>
                        Run
                      </button>
                    )}
                  </div>
                </div>
              )}
              {false && shells.length > 0 && shells.map((s) => (
                    <div key={s.id} className="ide-shell">
                      <div className="ide-shell-head">
                        <span>{s.command}</span>
                      </div>
                      <pre className="ide-shell-out">{(s.tail || "").slice(-4000)}</pre>
                    </div>
              ))}
              {bottom === "problems" && (
                <div className="problems">
                  <div className="problems-bar">
                    <button className="find-btn wide" onClick={refreshProblems} disabled={diagnosing}>
                      {diagnosing ? "Checking…" : "Run checks"}
                    </button>
                    <span className="problems-count">
                      <b className="err">{errors}</b> errors · <b className="warn">{warnings}</b> warnings
                    </span>
                  </div>
                  {problems.length === 0 && !diagnosing && (
                    <div className="ide-empty">No problems found. Run checks to analyse this project.</div>
                  )}
                  {problems.map((p, i) => (
                    <button
                      key={i}
                      className="problem"
                      onClick={() => openFile(p.file, p.line)}
                      title={`${p.file}:${p.line}:${p.column}`}
                    >
                      <span className={`problem-badge ${p.severity}`} />
                      <span className="problem-msg">
                        {p.message}
                        <span className="problem-meta">
                          {p.file.replace(cwd + "/", "")}:{p.line}:{p.column} · {p.code}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {bottom === "output" && (
                <div className="ide-term" ref={(el) => el && bottom === "output" && void 0}>
                  <div className="ide-term-out">
                    <pre className="ide-term-pre">{outputLines.join("\n")}</pre>
                  </div>
                  <div className="ide-term-in-row">
                    <button className="ide-term-run" onClick={addTerminal} title="New terminal">
                      + New terminal
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {ctx && (
        <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          {ctx.node.type === "file" ? (
            <>
              <button
                className="ctx-item"
                onClick={() => {
                  const p = ctx.node.path;
                  setCtx(null);
                  openFile(p);
                }}
              >
                Open
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  const p = ctx.node.path;
                  setCtx(null);
                  runFile(p);
                }}
              >
                Run
              </button>
              <div className="ctx-sep" />
            </>
          ) : (
            <>
              <button
                className="ctx-item"
                onClick={() => {
                  const dir = ctx.node.path;
                  setCtx(null);
                  setRename({ path: dir + "/__new__", name: "untitled.txt", mode: "create" });
                }}
              >
                New file
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  const dir = ctx.node.path;
                  setCtx(null);
                  setRename({ path: dir + "/__new__", name: "new-folder", mode: "create" });
                }}
              >
                New folder
              </button>
              <div className="ctx-sep" />
            </>
          )}
          {ctx.node.type === "file" && (
            <button
              className="ctx-item"
              onClick={() => {
                const p = ctx.node.path;
                setCtx(null);
                setDiffFile(p);
              }}
            >
              Show changes
            </button>
          )}
          <button
            className="ctx-item"
            onClick={() => {
              const n = ctx.node;
              setCtx(null);
              setRename({ path: n.path, name: n.name, mode: "rename" });
            }}
          >
            Rename…
          </button>
          <button
            className="ctx-item danger"
            onClick={() => {
              const n = ctx.node;
              setCtx(null);
              if (confirm(`Delete ${n.type === "dir" ? "folder" : "file"} “${n.name}”? This cannot be undone.`)) {
                void treeOp("delete", n.path);
              }
            }}
          >
            Delete
          </button>
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              const p = ctx.node.path;
              setCtx(null);
              navigator.clipboard?.writeText(p);
              setTreeNote("Path copied");
            }}
          >
            Copy path
          </button>
        </div>
      )}

      {/* status bar */}
        <div className="ide-status">
          <span title={cwd}>{cwd.split("/").filter(Boolean).pop() || cwd}</span>
          <span className="ide-tabs-fill" />
          {liveWrite && (
            <span className="ide-live" title={`The agent just changed ${liveWrite}`}>
              <span className="ide-live-dot" />
              Writing {liveWrite.replace(cwd + "/", "").split("/").pop()}
            </span>
          )}
          {active && (
            <button
              className="ide-status-btn"
              onClick={() => active && save(active)}
              disabled={buffers[active] === undefined}
              title="Save this file (Ctrl+S)"
            >
              {saving ? "Saving…" : buffers[active] !== undefined ? "● Save" : "Saved"}
            </button>
          )}
          <button className="ide-status-btn" onClick={() => setQuickOpen((q) => !q)} title="Go to file (Ctrl+P)">
            Go to file
          </button>
          <button
            className="ide-status-btn"
            onClick={() => (groups.length >= 2 ? closeGroup(groups.length - 1) : splitEditor())}
            title={groups.length >= 2 ? "Close split editor (Ctrl+\)" : "Split editor (Ctrl+\)"}
          >
            {groups.length >= 2 ? "Close split" : "Split"}
          </button>
          {previewUrl && (
            <button
              className={`ide-status-btn${pinned ? " on" : ""}`}
              onClick={() => setPinned((v) => !v)}
              title="Toggle the live preview (opens as an editor tab)"
            >
              ▣ Preview
            </button>
          )}
          {onOpenSettings && (
            <button className="ide-status-btn" onClick={onOpenSettings} title="Workspace settings (.vscode/settings.json)">
              ⚙ Settings
            </button>
          )}
          <button className="ide-status-btn" onClick={() => setBottom(bottom ? null : "terminal")}>
            Terminal
          </button>
          <button className="ide-status-btn" onClick={onToggleChat}>
            {chatOpen ? "Hide panel" : "Show panel"}
          </button>
          <button className="ide-status-btn" onClick={onOpenFullChat} title="Open chat full screen">
            Expand chat
          </button>
          {git?.isRepo && <span className="ide-status-btn">⑂ {git.branch}</span>}
          {statusLine && (
            <span className="ide-status-btn ide-statusline" title={statusLineError || "Custom status line"}>
              {statusLine}
            </span>
          )}
        </div>
      </div>

      {/* the agent, docked */}
      {chatOpen && <div className="ide-chat">{chat}</div>}
    </div>
  );
}

function countDepth(list: TreeNode[], path: string): number {
  const i = list.findIndex((n) => n.path === path);
  return i < 0 ? 0 : Math.min(6, i);
}
