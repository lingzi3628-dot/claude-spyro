import { useEffect, useRef, useState } from "react";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

/** Files the IDE knows how to run or open directly. */
const RUNNABLE: Record<string, string> = {
  ".html": "open", // served through the preview, not the host browser
};

export function FileTree({
  cwd,
  onOpenFile,
  onRunFile,
  onChanged,
}: {
  cwd: string;
  onOpenFile: (path: string) => void;
  onRunFile?: (path: string) => void;
  /** Fired after a create/rename/delete so the editor can drop stale tabs. */
  onChanged?: (path: string, action: "create" | "rename" | "delete") => void;
}) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const [editing, setEditing] = useState<{ path: string; name: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setError(null);
    try {
      const u = new URL("/api/fs/tree", location.origin);
      u.searchParams.set("path", cwd);
      u.searchParams.set("depth", "4");
      const res = await fetch(u.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load tree");
      setTree(data.tree);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, [cwd]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  useEffect(() => {
    if (editing) renameRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const toggle = (path: string) => {
    const s = new Set(expanded);
    if (s.has(path)) s.delete(path);
    else s.add(path);
    setExpanded(s);
  };

  const parentOf = (p: string) => (p === cwd ? cwd : p.slice(0, p.lastIndexOf("/")));

  const op = async (action: "create" | "rename" | "delete", path: string, extra: Record<string, any> = {}) => {
    setBusy(path);
    try {
      const res = await fetch(`/api/fs/op?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, ...extra }),
      });
      const j = await res.json();
      if (j?.error) {
        setToast(j.error);
      } else {
        await load();
        onChanged?.(j.to || path, action);
        if (action === "delete") setToast(`Deleted ${path.split("/").pop()}`);
      }
    } catch (e: any) {
      setToast(e?.message || "That didn't work");
    } finally {
      setBusy("");
    }
  };

  const startRename = (node: TreeNode) => {
    setMenu(null);
    setEditing({ path: node.path, name: node.name });
  };

  const commitRename = async () => {
    if (!editing) return;
    const { path, name } = editing;
    setEditing(null);
    if (!name.trim() || name === path.split("/").pop()) return;
    await op("rename", path, { to: `${parentOf(path)}/${name.trim()}` });
  };

  const startCreate = (dir: string, kind: "file" | "dir") => {
    setMenu(null);
    setEditing({ path: `${dir}/__new__`, name: kind === "dir" ? "new-folder" : "untitled.txt" });
  };

  const commitCreate = async () => {
    if (!editing) return;
    const { path, name } = editing;
    setEditing(null);
    const isNew = path.endsWith("__new__");
    const real = isNew ? `${parentOf(path)}/${name.trim()}` : path;
    if (isNew) {
      if (!name.trim()) return;
      await op("create", real, { kind: real.endsWith("/") ? "dir" : "file" });
    }
  };

  const render = (node: TreeNode, level = 0) => {
    const ex = expanded.has(node.path);
    const isDir = node.type === "dir";
    const isEditing = editing?.path === node.path;
    return (
      <div key={node.path} style={{ marginLeft: level * 8 }}>
        <div
          className={`tree-node${busy === node.path ? " busy" : ""}`}
          onClick={() => {
            if (editing) return;
            if (isDir) toggle(node.path);
            else onOpenFile(node.path);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (editing) return;
            setMenu({ x: e.clientX, y: e.clientY, node });
          }}
          title={node.path}
        >
          <span className="tree-toggle">{isDir ? (ex ? "▾" : "▸") : ""}</span>
          {isEditing ? (
            <input
              ref={renameRef}
              className="tree-rename"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onBlur={() => (editing?.path.endsWith("__new__") ? commitCreate() : commitRename())}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (editing?.path.endsWith("__new__") ? commitCreate() : commitRename());
                if (e.key === "Escape") setEditing(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="tree-label">
              {isDir ? "📁" : "📄"} {node.name}
            </span>
          )}
        </div>
        {isDir && ex && node.children && node.children.map((c) => render(c, level + 1))}
      </div>
    );
  };

  if (error) return <div className="model-status model-error">{error}</div>;
  if (!tree) return <div className="model-status">Loading tree…</div>;

  const m = menu?.node;
  const ext = m?.name.split(".").pop()?.toLowerCase() || "";

  return (
    <div className="file-tree">
      {toast && <div className="tree-toast">{toast}</div>}
      <div
        className="tree-node tree-blank"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, node: { name: "", path: cwd, type: "dir" } });
        }}
      >
        <span className="tree-label" style={{ opacity: 0.55 }}>
          right-click for options
        </span>
      </div>
      {render(tree)}

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {m && m.type === "file" && (
            <>
              <button
                className="ctx-item"
                onClick={() => {
                  setMenu(null);
                  onOpenFile(m.path);
                }}
              >
                Open
              </button>
              {onRunFile && (
                <button
                  className="ctx-item"
                  onClick={() => {
                    setMenu(null);
                    onRunFile(m.path);
                  }}
                >
                  Run {RUNNABLE[`.${ext}`] === "open" ? "in preview" : "file"}
                </button>
              )}
              <div className="ctx-sep" />
            </>
          )}
          {m && m.type === "dir" && (
            <>
              <button className="ctx-item" onClick={() => startCreate(m.path, "file")}>
                New file
              </button>
              <button className="ctx-item" onClick={() => startCreate(m.path, "dir")}>
                New folder
              </button>
              <div className="ctx-sep" />
            </>
          )}
          {m && (
            <>
              <button className="ctx-item" onClick={() => startRename(m)}>
                Rename…
              </button>
              <button
                className="ctx-item danger"
                onClick={() => {
                  const node = m;
                  setMenu(null);
                  const label = node.type === "dir" ? "folder" : "file";
                  if (confirm(`Delete the ${label} “${node.name}”? This cannot be undone.`)) {
                    void op("delete", node.path);
                  }
                }}
              >
                Delete
              </button>
              <div className="ctx-sep" />
              <button
                className="ctx-item"
                onClick={() => {
                  const p = m.path;
                  setMenu(null);
                  navigator.clipboard?.writeText(p);
                  setToast("Path copied");
                }}
              >
                Copy path
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
