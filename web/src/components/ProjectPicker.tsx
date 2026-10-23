import { useEffect, useState } from "react";
import { DragonMark } from "./DragonMark";

export interface ProjectInfo {
  name: string;
  path: string;
  markers: string[];
  isGit: boolean;
  fileCount: number;
  mtime: number;
  cover: string;
}

function ago(ms: number): string {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** A deterministic gradient so each project gets a distinct look without images. */
function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function kindOf(p: ProjectInfo): string {
  const m = p.markers.join(",");
  if (m.includes("pyproject") || m.includes("requirements")) return "Python";
  if (m.includes("Cargo.toml")) return "Rust";
  if (m.includes("go.mod")) return "Go";
  if (m.includes("pom.xml") || m.includes("build.gradle")) return "Java";
  if (m.includes("index.html")) return "Web";
  if (m.includes("package.json")) return "Node";
  return "Project";
}

export function ProjectPicker({
  onOpen,
  onCreateNew,
  busy,
}: {
  onOpen: (path: string) => void;
  onCreateNew: () => void;
  busy?: boolean;
}) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [root, setRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let dead = false;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((j) => {
        if (dead) return;
        setProjects(j.projects || []);
        setRoot(j.root || "");
      })
      .catch(() => undefined)
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, []);

  const shown = projects.filter(
    (p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="projects">
      <div className="projects-head">
        <span className="projects-mark">
          <DragonMark size={22} />
        </span>
        <div className="projects-titles">
          <h2>Your projects</h2>
          <span className="projects-root" title={root}>
            {root || "no folder chosen"}
          </span>
        </div>
        <input
          className="projects-search"
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="projects-new" onClick={onCreateNew} disabled={busy}>
          New project
        </button>
      </div>

      {loading ? (
        <div className="projects-empty">Looking for projects…</div>
      ) : shown.length === 0 ? (
        <div className="projects-empty">
          {projects.length === 0
            ? "No projects found in this folder. Ask Spyro Studio to build one, or pick another folder."
            : `Nothing matches “${q}”.`}
        </div>
      ) : (
        <div className="projects-grid">
          {shown.map((p) => {
            const h = hueFor(p.name);
            return (
              <button
                key={p.path}
                className="proj-card"
                onClick={() => onOpen(p.path)}
                title={p.path}
              >
                <div
                  className="proj-art"
                  style={{
                    background: `linear-gradient(135deg, hsl(${h} 42% 30%), hsl(${(h + 48) % 360} 38% 18%))`,
                  }}
                >
                  {p.cover ? (
                    <img src={p.cover} alt="" loading="lazy" />
                  ) : (
                    <span className="proj-art-initials">
                      {p.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="proj-kind">{kindOf(p)}</span>
                </div>
                <div className="proj-meta">
                  <span className="proj-name">{p.name}</span>
                  <span className="proj-sub">
                    {ago(p.mtime)}
                    {p.fileCount ? ` · ${p.fileCount} files` : ""}
                    {p.isGit ? " · git" : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}