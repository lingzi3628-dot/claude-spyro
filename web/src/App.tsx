import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AttachedImage } from "./types";
import { useAgent } from "./useAgent";
import { decideRestore } from "./lib/onboarding";
import { Markdown } from "./components/Markdown";
import { ToolCard } from "./components/ToolCard";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { AskDialog } from "./components/AskDialog";
import { TodoPanel } from "./components/TodoPanel";
import { TaskPanel } from "./components/TaskPanel";
import { ShellPanel } from "./components/ShellPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { PluginsPanel } from "./components/PluginsPanel";
import { CheckpointsPanel } from "./components/CheckpointsPanel";
import { DragonMark } from "./components/DragonMark";
import { McpOAuthPanel } from "./components/McpOAuthPanel";
import { Onboarding } from "./components/Onboarding";
import { GuidePanel } from "./components/GuidePanel";
import { ErrorDialog, classifyError, type ErrorInfo } from "./components/ErrorDialog";
import { HomeScreen } from "./components/HomeScreen";
import { UrlCards, useFoundUrls } from "./components/UrlCards";
import { PreviewPanel } from "./components/PreviewPanel";
import { Welcome, AccountScreen } from "./components/Welcome";
import { ThreeWays, ModeIntro, cardFor, type Mode } from "./components/OnboardingFlow";
import { MentionMenu, detectMention, filterFiles, type FileHit } from "./components/MentionMenu";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { ProjectPicker } from "./components/ProjectPicker";
import { ThinkingBlock } from "./components/ThinkingBlock";
import { IdeShell } from "./components/IdeShell";
import { IdeOpenFolder } from "./components/IdeOpenFolder";
import { useIdeSettings, IdeSettingsPanel } from "./components/IdeSettings";
import { IdeTitleBar } from "./components/IdeTitleBar";
import { FolderPicker } from "./components/FolderPicker";
import { FileTree } from "./components/FileTree";
import { FileViewer } from "./components/FileViewer";

function pollinationsUrl(prompt: string, width = 256, height = 256): string {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model: "gptimage",
    nologo: "true",
    private: "true",
    safe: "true",
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
}

function projectImagePrompt(p: { name: string; markers: string[] }): string {
  const kind = p.markers.join(",");
  let desc = "";
  if (kind.includes("package.json") || kind.includes("index.html")) desc = "modern web application UI with clean code editor aesthetic";
  else if (kind.includes("pyproject") || kind.includes("requirements")) desc = "python script terminal with syntax highlighting";
  else if (kind.includes("Cargo.toml")) desc = "rust code editor with cargo build output";
  else if (kind.includes("go.mod")) desc = "golang code terminal with green text";
  else if (kind.includes("pom.xml") || kind.includes("build.gradle")) desc = "java IDE with project structure";
  else desc = "software development project abstract visualization";
  return `minimal ${desc}, ${p.name}, clean dark theme, professional, 4k, no text, no watermark`;
}

function HomeView({
  onEnterIde,
  onOpenFolder,
  onOpenInChat,
  onCreateNew,
  onStartIdea,
  busy,
  provider,
  folder,
}: {
  onEnterIde: () => void;
  onOpenFolder: (path: string) => void;
  onOpenInChat: (path: string) => void;
  onCreateNew: () => void;
  onStartIdea: (text: string, mode: "idea" | "chat") => void;
  busy: boolean;
  provider: string;
  folder?: string;
}) {
  const [tab, setTab] = useState<"idea" | "projects">("idea");
  const [projects, setProjects] = useState<any[]>([]);
  const [root, setRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let dead = false;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((j) => {
        if (dead) return;
        const withImages = (j.projects || []).map((p: any) => ({
          ...p,
          pollinationsCover: p.cover || pollinationsUrl(projectImagePrompt(p), 256, 256),
        }));
        setProjects(withImages);
        setRoot(j.root || "");
      })
      .catch(() => undefined)
      .finally(() => !dead && setLoading(false));
    return () => { dead = true; };
  }, []);

  const shown = projects.filter(
    (p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const IdeaBox = () => (
    <div className="home-idea-box">
      <HomeScreen
        onSubmit={onStartIdea}
        busy={busy}
        provider={provider}
        folder={folder}
      />
    </div>
  );

  const ProjectsTab = () => (
    <div className="projects-tab">
      <div className="projects-head">
        <span className="projects-mark"><DragonMark size={22} /></span>
        <div className="projects-titles">
          <h2>Your projects</h2>
          <span className="projects-root" title={root}>{root || "no folder chosen"}</span>
        </div>
        <input
          className="projects-search"
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="projects-new" onClick={onCreateNew} disabled={busy}>New project</button>
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
          {shown.map((p) => (
            <button
              key={p.path}
              className="proj-card"
              onClick={() => (p.origin === "ide" ? onOpenFolder(p.path) : onOpenInChat(p.path))}
              title={p.path}
            >
              <div className="proj-art" style={{ background: `linear-gradient(135deg, hsl(${((p.name.split("").reduce((a,c)=>a*31+c.charCodeAt(0),0))%360)} 42% 30%), hsl(${((p.name.split("").reduce((a,c)=>a*31+c.charCodeAt(0),0)+48)%360)} 38% 18%))` }}>
                {p.pollinationsCover ? (
                  <img src={p.pollinationsCover} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                ) : (
                  <span className="proj-art-initials">{p.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase()}</span>
                )}
                <span className="proj-kind">{(p.markers.join(",").includes("package.json")||p.markers.join(",").includes("index.html"))?"Web":p.markers.join(",").includes("pyproject")||p.markers.join(",").includes("requirements")?"Python":p.markers.join(",").includes("Cargo.toml")?"Rust":p.markers.join(",").includes("go.mod")?"Go":p.markers.join(",").includes("pom.xml")||p.markers.join(",").includes("build.gradle")?"Java":"Project"}</span>
                {p.origin === "ide" && <span className="proj-origin ide">IDE</span>}
                {p.origin === "chat" && <span className="proj-origin chat">Chat</span>}
              </div>
              <div className="proj-meta">
                <span className="proj-name">{p.name}</span>
                <span className="proj-sub">
                  {(p.mtime ? (()=>{const s=Math.floor((Date.now()-p.mtime)/1000);if(s<60)return"just now";if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;if(s<86400*30)return`${Math.floor(s/86400)}d ago`;return new Date(p.mtime).toLocaleDateString();})() : "")}
                  {p.fileCount ? ` · ${p.fileCount} files` : ""}
                  {p.isGit ? " · git" : ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="home-with-tabs">
      <nav className="home-tabs" role="tablist" aria-label="Home view">
        <button role="tab" aria-selected={tab === "idea"} className={tab === "idea" ? "active" : ""} onClick={() => setTab("idea")}>Idea Box</button>
        <button role="tab" aria-selected={tab === "projects"} className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>Projects</button>
      </nav>
      <div className="home-tab-panels">
        {tab === "idea" && <IdeaBox />}
        {tab === "projects" && <ProjectsTab />}
      </div>
    </div>
  );
}

const HINTS = [
  "List the files in this folder and summarize the project.",
  "Build a small React stopwatch in ./stopwatch and tell me how to run it.",
  "Find where the API base URL is configured.",
];

const REPO_URL = "https://github.com/lingzi3628-dot/spyro-studio";

const COMMANDS = [
  { cmd: "/guide", desc: "Open the guide: plugins, projects, MCP, troubleshooting" },
  { cmd: "/help", desc: "Show this help" },
  { cmd: "/clear", desc: "Clear the conversation" },
  { cmd: "/compact", desc: "Compact the context" },
  { cmd: "/context", desc: "Show how full the context window is" },
  { cmd: "/cost", desc: "Show token usage and spend for this session" },
  { cmd: "/usage", desc: "Alias for /cost" },
  { cmd: "/model", desc: "Open model settings" },
  { cmd: "/auto", desc: "Toggle auto-approve" },
  { cmd: "/plan", desc: "Show the current plan" },
  { cmd: "/permissions", desc: "Review or edit tool permissions" },
  { cmd: "/hooks", desc: "List configured lifecycle hooks" },
  { cmd: "/mcp", desc: "List connected MCP servers and tools" },
  { cmd: "/output-style", desc: "Cycle or set the output style" },
  { cmd: "/add-dir", desc: "Add another folder to this session" },
  { cmd: "/skills", desc: "List available skills" },
  { cmd: "/agents", desc: "List available subagents" },
  { cmd: "/plugins", desc: "Manage plugins" },
  { cmd: "/review", desc: "Review the current git diff" },
  { cmd: "/security-review", desc: "Security review of the current diff" },
  { cmd: "/pr-comments", desc: "Review comments on a GitHub pull request" },
  { cmd: "/init", desc: "Generate a CLAUDE.md project memory file" },
  { cmd: "/doctor", desc: "Run environment diagnostics" },
  { cmd: "/statusline", desc: "Configure the custom status line" },
  { cmd: "/terminal-setup", desc: "Terminal and shell integration help" },
  { cmd: "/rewind", desc: "Rewind the conversation to an earlier checkpoint" },
  { cmd: "/git", desc: "Show git status and recent commits" },
  { cmd: "/sessions", desc: "Saved sessions live in the sidebar" },
  { cmd: "/new", desc: "Start a new session" },
  { cmd: "/bug", desc: "Open the issue tracker" },
  { cmd: "/release-notes", desc: "Open the changelog" },
];

const BUILTIN_NAMES = new Set(COMMANDS.map((c) => c.cmd.slice(1)));

const HELP = [
  "Commands:",
  ...COMMANDS.map((c) => `${c.cmd.padEnd(11)}${c.desc}`),
].join("\n");

function basename(p: string): string {
  if (!p) return "";
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function when(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function formatTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function CollabPresence({ agent }: { agent: ReturnType<typeof useAgent> }) {
  const collab = agent.collab;
  if (!collab) return null;
  const [open, setOpen] = useState(false);
  const members = collab.members || [];
  const count = members.length;
  const isHost = collab.room !== null;
  const you = members.find((m) => m.local);

  return (
    <div className="collab-presence">
      <button
        className={`icon-btn${isHost ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={isHost ? `Collaboration room open (${count})` : "Start a collaboration session"}
      >
        <span className="collab-dot" style={{ background: you?.color || "#7c9cff" }} />
        {count > 1 && <span className="collab-count">{count}</span>}
      </button>
      {open && (
        <div className="collab-popover">
          <div className="collab-header">
            {isHost ? (
              <>
                <strong>Room: {collab.room}</strong>
                <span className="badge">{collab.readOnly ? "Read-only" : "Editing allowed"}</span>
              </>
            ) : (
              <span className="muted">No room open</span>
            )}
          </div>
          <div className="collab-members">
            {members.map((m) => (
              <div key={m.id} className="collab-member">
                <span
                  className="collab-avatar"
                  style={{ background: m.color }}
                  title={m.name}
                >
                  {m.name[0].toUpperCase()}
                </span>
                <span className="collab-name">{m.name}{m.local && " (you)"}</span>
                <span className={`collab-role ${m.role}`}>{m.role}</span>
                {isHost && m.id !== you?.id && (
                  <>
                    <button
                      className="icon-btn tiny"
                      onClick={() => agent.collabSetRole(m.id, m.role === "editor" ? "viewer" : "editor")}
                      title={m.role === "editor" ? "Make viewer" : "Allow editing"}
                    >
                      {m.role === "editor" ? "✎" : "👁"}
                    </button>
                    <button
                      className="icon-btn tiny danger"
                      onClick={() => agent.collabSetRole(m.id, "viewer")}
                      title="Remove"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          {isHost && (
            <div className="collab-actions">
              <button className="btn secondary" onClick={agent.collabCloseRoom}>
                Close room
              </button>
              {collab.url && (
                <button
                  className="btn"
                  onClick={() => {
                    navigator.clipboard.writeText(collab.url!);
                    alert("Invite link copied!");
                  }}
                >
                  Copy invite link
                </button>
              )}
              <label className="collab-readonly-toggle">
                <input
                  type="checkbox"
                  checked={collab.readOnly}
                  onChange={(e) => agent.collabSetReadOnly(e.target.checked)}
                />
                Read-only for guests
              </label>
            </div>
          )}
          {!isHost && (
            <button className="btn" onClick={agent.collabCreateRoom}>
              Create collaboration room
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const agent = useAgent();
  const [showSettings, setShowSettings] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [folderMode, setFolderMode] = useState<"workspace" | "addDir">("workspace");
  const [showFiles, setShowFiles] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [showMcpOauth, setShowMcpOauth] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showDiscordReminder, setShowDiscordReminder] = useState(false);
  const [discordJoined, setDiscordJoined] = useState(() => localStorage.getItem("cf-discord-joined") === "true");
  const [showGuide, setShowGuide] = useState(false);
  const [errDialog, setErrDialog] = useState<ErrorInfo | null>(null);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewPath, setViewPath] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  // "home" until the user actually starts something, then "chat".
  // "picker" asks once how to start; "home" is the idea box; "chat" is the thread.
  const [view, setView] = useState<"picker" | "home" | "chat" | "ide">("home");
  const [account, setAccount] = useState<any>(null);
  // "loading" until we know whether this person already has an account. Starting
  // at "welcome" flashed the new-user onboarding at existing users on every
  // launch, because the account check is async.
  const [onboard, setOnboard] = useState<{ step: "loading" | "welcome" | "create" | "signin" | "ways" | "intro" | "done"; mode: Mode | null }>({
    step: "loading",
    mode: null,
  });

  /** After sign-up or sign-in: straight to the three-ways choice. */
  const afterAccount = (acc: any) => {
    setAccount(acc);
    if (acc?.sessionToken) localStorage.setItem("cf-session", acc.sessionToken);
    setOnboard((o) => ({ ...o, step: "ways" }));
  };

  /** Back to the welcome screen, with the stored session forgotten. */
  const signOut = () => {
    localStorage.removeItem("cf-session");
    localStorage.removeItem("cf-onboarded");
    setAccount(null);
    setOnboard({ step: "welcome", mode: null });
    setView("home");
  };

  /** Change the password on the local account. */
  const changePassword = async (current: string, next: string) => {
    const r = await fetch("/api/account?action=changepassword", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    return r.json();
  };

  /** After "Continue": remember the choice, then drop them into the app. */
  const finishOnboarding = async (mode: Mode) => {
    localStorage.setItem("cf-onboarded", "1");
    setOnboard({ step: "done", mode });
    try {
      await fetch("/api/account?action=onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarded: true, mode }),
      });
    } catch {
      /* the choice is a nicety, not a gate */
    }
    if (mode === "ide") enterIde();
    else if (mode === "idea") setView("home");
    else setView("chat");
  };

  // Resume an existing session instead of showing the welcome screen again.
  // The window stays on a neutral splash until we know which it is.
  useEffect(() => {
    let live = true;
    const token = localStorage.getItem("cf-session") || "";

    /** The server may still be starting; give it a few chances before giving up. */
    const loadAccount = async (): Promise<any | null> => {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!live) return null;
        try {
          const r = await fetch("/api/account");
          if (r.ok) return await r.json();
        } catch {
          /* not up yet — retry */
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
    };

    (async () => {
      const j = await loadAccount();
      if (!live) return;

      const cachedBefore = localStorage.getItem("cf-onboarded") === "1";
      const decision = decideRestore(j, cachedBefore);

      // No server, or nobody has signed up here yet, or they never finished:
      // there is nothing more to load.
      if (!j || decision !== "done") {
        setOnboard({ step: decision, mode: null });
        return;
      }

      let acc = j.account;
      if (token) {
        try {
          const s = await fetch("/api/account?action=resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          }).then((x) => x.json());
          if (s?.ok) acc = s.account;
        } catch {
          /* keep the account we already fetched */
        }
      }
      if (!live) return;
      setAccount(acc);
      if (acc?.sessionToken) localStorage.setItem("cf-session", acc.sessionToken);
      const onboarded = Boolean(acc?.onboarded);
      localStorage.setItem("cf-onboarded", onboarded ? "1" : "0");
      setOnboard({ step: onboarded ? "done" : "welcome", mode: null });
    })();

    return () => {
      live = false;
    };
  }, []);
  const [ideFolder, setIdeFolder] = useState<string>("");
  const [ideProjects, setIdeProjects] = useState<{ name: string; path: string }[]>([]);
  const [showIdeSettings, setShowIdeSettings] = useState(false);
  // Per-project settings live in .vscode/settings.json inside the open folder,
  // so IDE settings never mix with the app's own preferences.
  const ideSettings = useIdeSettings(ideFolder);
  const [ideChatOpen, setIdeChatOpen] = useState(true);
  // Declared here (not with the other state) because clearRunState() touches them.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const lastSeenUrl = useRef<string | null>(null);
  const foundUrlsRef = useRef<unknown[]>([]);
  // @-mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // prompt history
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sessionFilter, setSessionFilter] = useState("");
  const [showClean, setShowClean] = useState(false);

  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase();
    if (!q) return agent.sessions;
    return agent.sessions.filter(
      (s) => (s.title || "").toLowerCase().includes(q) || (s.cwd || "").toLowerCase().includes(q),
    );
  }, [agent.sessions, sessionFilter]);

  /** Junk = a session with no real conversation in it. */
  const junkSessions = useMemo(
    () =>
      agent.sessions.filter(
        (s) => (s.messageCount ?? 0) <= 2 || /^(hii+|hi+|hello|new session|test|ok)$/i.test((s.title || "").trim()),
      ),
    [agent.sessions],
  );

  /**
   * Anything that starts a fresh conversation must also drop the preview —
   * otherwise the URL from the previous run lingers into a brand new chat.
   */
  const clearRunState = () => {
    setPreviewUrl(null);
    setShowPreview(true);
    lastSeenUrl.current = null;
    foundUrlsRef.current = [];
  };

  const goHome = () => {
    clearRunState();
    agent.reset();
    setView("home");
  };

  /**
   * The IDE is a separate surface: it parks the chat conversation, restores
   * its own, and points the agent at the folder the IDE has open. Leaving puts
   * the chat back exactly as it was, so the two never bleed into each other.
   */
  const enterIde = () => {
    chatCwdRef.current = agent.cwd;
    agent.swapSurface("ide");
    if (ideFolderRef.current) agent.setCwd(ideFolderRef.current);
    setView("ide");
  };

  const leaveIde = () => {
    ideFolderRef.current = agent.cwd;
    agent.swapSurface("chat");
    setView("home");
  };

  const handleDiscordJoin = () => {
    window.open("https://discord.com/invite/QZQ27rFVn", "_blank", "noopener");
    setDiscordJoined(true);
    localStorage.setItem("cf-discord-joined", "true");
    setShowDiscordReminder(false);
  };

  const dismissDiscordReminder = () => {
    setShowDiscordReminder(false);
    setTimeout(() => {
      if (!discordJoined) setShowDiscordReminder(true);
    }, 24 * 60 * 60 * 1000);
  };

  const enterChat = (path: string) => {
    ideFolderRef.current = "";
    agent.setCwd(path);
    agent.swapSurface("chat");
    setView("chat");
  };

  /** Create a new project folder and open it in the IDE. */
  const createProjectFolder = async (dir: string) => {
    try {
      const r = await fetch("/api/fs/op?action=create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dir, kind: "dir" }),
      });
      const j = await r.json();
      if (j?.error) {
        setIdeProjects((p) => p);
        openIdeFolder(dir);
        return;
      }
      openIdeFolder(dir);
    } catch {
      openIdeFolder(dir);
    }
  };

  const openIdeFolder = async (path: string) => {
    ideFolderRef.current = path;
    localStorage.setItem("cf-ide-folder", path);
    try {
      await fetch("/api/fs/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: `${path}/.spyro-ide`, content: JSON.stringify({ openedAt: Date.now() }, null, 2) }),
      });
    } catch { /* best effort */ }
    agent.setCwd(path);
    setIdeFolder(path);
    setView("ide");
  };

  /**
   * Restore the last IDE folder — but only if it still exists.
   *
   * A remembered folder that has since been renamed or deleted would leave the
   * editor showing a phantom project while the agent worked somewhere else
   * entirely, with no visible sign that the two had drifted apart.
   */
  useEffect(() => {
    const saved = localStorage.getItem("cf-ide-folder") || "";
    if (!saved) return;
    let live = true;
    fetch(`/api/fs/list?path=${encodeURIComponent(saved)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j && Array.isArray(j.entries)) {
          setIdeFolder(saved);
          ideFolderRef.current = saved;
        } else {
          localStorage.removeItem("cf-ide-folder");
        }
      })
      .catch(() => {
        if (live) localStorage.removeItem("cf-ide-folder");
      });
    return () => {
      live = false;
    };
  }, []);

  // Discord reminder - show after 5 minutes if not joined
  useEffect(() => {
    if (discordJoined) return;
    const timer = setTimeout(() => setShowDiscordReminder(true), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [discordJoined]);

  // The IDE start screen lists real folders, not app-level "projects".
  useEffect(() => {
    if (view !== "ide") return;
    let live = true;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((j) => {
        if (live && Array.isArray(j?.projects)) {
          setIdeProjects(j.projects.map((p: any) => ({ name: p.name, path: p.path })));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [view]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ideFolderRef = useRef<string>("");
  const chatCwdRef = useRef<string>("");
  const [menuIndex, setMenuIndex] = useState(0);
  // "system" follows the OS and keeps following it as it changes.
  const [themePref, setThemePref] = useState<"dark" | "light" | "system">(
    () => (localStorage.getItem("cf-theme") as "dark" | "light" | "system") || "system",
  );
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("cf-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = Number(localStorage.getItem("cf-font-scale"));
    return Number.isFinite(v) && v >= 85 && v <= 130 ? v : 100;
  });

  useEffect(() => {
    if (themePref !== "system") {
      setTheme(themePref);
      return;
    }
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const apply = () => setTheme(mq.matches ? "light" : "dark");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [themePref]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(fontScale / 100));
  }, [fontScale]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cf-theme", themePref);
  }, [theme]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.items]);

  // Surface failures as an actionable dialog instead of a plain red line.
  const lastErrId = useRef(0);
  useEffect(() => {
    const errs = agent.items.filter((it) => it.kind === "error");
    if (errs.length === lastErrId.current) return;
    lastErrId.current = errs.length;
    const latest = errs[errs.length - 1];
    if (latest && latest.kind === "error") {
      setErrDialog(classifyError(latest.text, agent.model?.provider));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.items]);

  // First run: open the quick setup once the server has told us it's needed.
  const dismissed = useRef(false);
  useEffect(() => {
    if (dismissed.current) return;
    if (agent.needsSetup && Object.keys(agent.providers).length > 0) {
      dismissed.current = true;
      setShowOnboarding(true);
    }
  }, [agent.needsSetup, agent.providers]);

  const current = agent.sessions.find((s) => s.id === agent.currentSessionId);
  const title = current?.title || "New session";

  const allCommands = [
    ...COMMANDS,
    ...agent.commands.map((c) => ({
      cmd: "/" + c.name,
      desc: c.argumentHint ? `${c.description} <${c.argumentHint}>` : c.description,
    })),
  ];

  const slashQuery =
    input.startsWith("/") && !input.includes(" ") ? input.toLowerCase() : null;
  const matches = slashQuery ? allCommands.filter((c) => c.cmd.startsWith(slashQuery)) : [];
  const menuOpen = slashQuery !== null && matches.length > 0;

  useEffect(() => {
    setMenuIndex(0);
  }, [slashQuery]);

  const runCommand = (raw: string) => {
    const text = raw;
    const [cmd] = raw.slice(1).split(/\s+/);
    switch (cmd) {
      case "help":
        agent.pushSystem(HELP);
        break;
      case "clear":
        agent.reset();
        break;
      case "compact":
        agent.forceCompact();
        break;
      case "context":
        agent.getContext();
        break;
      case "cost":
      case "usage": {
        const u = agent.usage;
        const who = agent.model
          ? `${agent.model.provider ? agent.model.provider + " / " : ""}${agent.model.model}`
          : "unknown";
        agent.pushSystem(
          [
            "Session usage",
            `  model: ${who}`,
            `  tokens: ${formatTok(u.totalTokens)} (in ${formatTok(u.promptTokens)} / out ${formatTok(u.completionTokens)})`,
            agent.cost > 0 ? `  cost: $${agent.cost.toFixed(4)}` : "  cost: free / not reported by this provider",
            "",
            "Run /context for context-window usage.",
          ].join("\n"),
        );
        break;
      }
      case "permissions":
        setShowSettings(true);
        agent.pushSystem("Permissions are in Settings → Permissions. You can also edit .claude/settings.json with an allow/deny/ask list.");
        break;
      case "hooks":
        agent.listHooks();
        break;
      case "mcp":
        agent.listMcp();
        break;
      case "output-style": {
        const arg = text.slice("/output-style".length).trim();
        const names = agent.outputStyles.map((x) => x.name);
        if (!names.length) {
          agent.pushSystem(
            "No output styles found. Add .claude/output-styles/<name>.md to define one.",
          );
          break;
        }
        if (arg) {
          if (names.includes(arg)) {
            agent.setActiveOutputStyle(arg);
            agent.pushSystem(`Output style: ${arg}`);
          } else {
            agent.pushSystem(`Unknown style: ${arg}. Available: ${names.join(", ")}`);
          }
          break;
        }
        const next = agent.outputStyle
          ? names[(names.indexOf(agent.outputStyle) + 1) % names.length]
          : names[0];
        agent.setActiveOutputStyle(next);
        agent.pushSystem(`Output style: ${next}`);
        break;
      }
      case "add-dir":
        setFolderMode("addDir");
        setShowFolder(true);
        break;
      case "init":
        agent.submit(
          "Analyze this project and create (or update) a CLAUDE.md file at the repository root. " +
            "Cover: what the project is, the stack and key directories, how to install/build/test/lint, " +
            "coding conventions, and any gotchas a new contributor must know. Read the actual files " +
            "(package manifests, README, config) before writing. Keep it concise and factual.",
        );
        break;
      case "security-review":
        agent.submit(
          "Perform a security review of the current uncommitted changes in this repository. " +
            "Use git_status and git_diff to gather them. Look specifically for injection, path traversal, " +
            "command execution, unsafe deserialization, secret leakage, missing authz/authn, SSRF, XSS, " +
            "and dependency risks. Report findings by severity with concrete file:line references and a " +
            "suggested fix. Do not make edits unless asked.",
        );
        break;
      case "pr-comments": {
        const arg = text.slice("/pr-comments".length).trim();
        if (!arg) {
          agent.pushSystem("Usage: /pr-comments <PR number or URL>");
          break;
        }
        agent.submit(
          `Fetch the review comments and conversation on GitHub pull request ${arg} using the \`gh\` CLI ` +
            `through the bash tool (for example \`gh pr view ${arg} --comments\` and \`gh api\` for review ` +
            `threads), then summarize each unresolved comment, what the reviewer is asking for, and ` +
            `whether the current code addresses it. Group by file. Do not post replies.`,
        );
        break;
      }
      case "doctor":
        agent.submit(
          "Run the doctor tool to check this machine's development environment, then explain any " +
            "problems it finds and how to fix them.",
        );
        break;
      case "statusline": {
        const arg = text.slice("/statusline".length).trim();
        if (!arg) {
          agent.pushSystem(
            agent.statusLineCommand
              ? [
                  `Status line command: ${agent.statusLineCommand}`,
                  `Current output: ${agent.statusLine || "(empty)"}`,
                  "",
                  "Set with /statusline <command>, disable with /statusline off.",
                  "The command receives JSON on stdin (cwd, model, cost, usage, context) and its first stdout line is shown.",
                ].join("\n")
              : [
                  "No custom status line configured.",
                  "Set one with /statusline <command>; disable with /statusline off.",
                  "The command receives JSON on stdin (cwd, model, cost, usage, context) and its first stdout line is shown.",
                ].join("\n"),
          );
          break;
        }
        if (/^(off|none|clear)$/i.test(arg)) {
          agent.updateStatusLine("");
          agent.pushSystem("Status line disabled.");
        } else {
          agent.updateStatusLine(arg);
          agent.pushSystem(`Status line set to: ${arg}`);
        }
        break;
      }
      case "terminal-setup":
        agent.pushSystem(
          [
            "Terminal setup",
            "  • The agent and the IDE terminal run your normal login shell, so your PATH and rc files already apply.",
            "  • For multi-line prompts, Shift+Enter inserts a newline; Enter sends.",
            "  • Use ! at the start of a message to run a command directly in the terminal.",
            "  • Background commands keep running: read them with bash_output and stop them with kill_shell.",
            "  • On Linux/macOS the bundled git-lfs is used automatically when needed.",
          ].join("\n"),
        );
        break;
      case "bug":
        window.open(`${REPO_URL}/issues/new`, "_blank", "noopener");
        agent.pushSystem(`Opened the issue tracker: ${REPO_URL}/issues`);
        break;
      case "release-notes":
        window.open(`${REPO_URL}/releases`, "_blank", "noopener");
        agent.pushSystem(`Opened the changelog: ${REPO_URL}/releases`);
        break;
      case "model":
        setShowSettings(true);
        break;
      case "auto":
        agent.toggleAutoApprove(!agent.autoApprove);
        break;
      case "plan":
        agent.pushSystem(
          agent.todos.length
            ? agent.todos
                .map(
                  (t) =>
                    `${
                      t.status === "completed" ? "✓" : t.status === "in_progress" ? "▸" : "○"
                    } ${t.content}`,
                )
                .join("\n")
            : "No plan yet. Ask the agent to plan a task.",
        );
        break;
      case "skills":
        agent.pushSystem(
          agent.skills.length
            ? "Skills in this workspace:\n" +
                agent.skills.map((s) => `• ${s.name} — ${s.description}`).join("\n")
            : "No skills found in this workspace.",
        );
        break;
      case "sessions":
        agent.pushSystem("Saved sessions are listed in the left sidebar.");
        break;
      case "new":
        agent.newSession();
        break;
      case "plugins":
        setShowPlugins(true);
        break;
      case "rewind":
        agent.listCheckpoints();
        setShowCheckpoints(true);
        break;
      case "review": {
        const arg = text.slice("/review".length).trim();
        if (/^#?\d+$/.test(arg) || /github\.com|\/[\w.-]+\/[\w.-]+/.test(arg)) {
          agent.submit(
            `Review the GitHub pull request ${arg}. Use github_pr_view to get the details and ` +
              `github_pr_diff to read the changes, then report concrete, actionable findings grouped by ` +
              `severity (bugs, security, correctness, tests, style), pointing at specific file:line. ` +
              `Do NOT post the review to GitHub unless I explicitly ask you to.`,
          );
          break;
        }
        agent.submit(
          "Review the current uncommitted changes in this repository. Use git_status and git_diff to gather " +
            "them, then report concrete, actionable findings grouped by severity (bugs, security, correctness, " +
            "tests, style). Point at specific file:line. Do not make any edits unless asked.",
        );
        break;
      }
      case "git":
        agent.submit(
          "Show me the git status, the recent commits, and a summary of what has changed. Then explain " +
            "the current state of this repository in a few sentences.",
        );
        break;
      case "agents":
        agent.pushSystem(
          agent.agents.length
            ? "Available subagents:\n" +
                agent.agents.map((a) => `• ${a.name} — ${a.description}`).join("\n")
            : "No subagents found in this workspace.",
        );
        break;
      default:
        agent.pushSystem(`Unknown command: /${cmd}. Type /help for a list.`);
    }
  };

  const onPickImages = (files: FileList | null) => {
    if (!files?.length) return;
    const next: AttachedImage[] = [];
    let pending = files.length;
    const pdfs: string[] = [];
    for (const f of Array.from(files)) {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        pending--;
        pdfs.push(f.name);
        continue;
      }
      if (!f.type.startsWith("image/")) {
        pending--;
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const base64 = dataUrl.split(",")[1] || "";
        next.push({ media_type: f.type, data: base64, name: f.name });
        if (--pending === 0) setImages((prev) => [...prev, ...next]);
      };
      reader.onerror = () => {
        if (--pending === 0) setImages((prev) => [...prev, ...next]);
      };
      reader.readAsDataURL(f);
    }
    if (pending <= 0 && pdfs.length) {
      agent.submit(
        `Please read the attached PDF(s) with the read_pdf tool: ${pdfs.join(", ")}, then tell me what they say.`,
      );
    }
  };

  const send = () => {
    const text = input.trim();
    if ((!text && !images.length) || agent.running) return;
    setInput("");
    setEditingId(null);
    if (text.startsWith("/")) {
      setImages([]);
      const [nameRaw, ...rest] = text.slice(1).split(/\s+/);
      if (nameRaw.toLowerCase() === "guide") {
        setShowGuide(true);
        setInput("");
        return;
      }
      if (BUILTIN_NAMES.has(nameRaw.toLowerCase())) {
        runCommand(text);
        return;
      }
      const custom = agent.commands.find((c) => c.name === nameRaw);
      if (custom) {
        agent.runCommand(custom.name, rest.join(" "));
        return;
      }
      agent.pushSystem(`Unknown command: /${nameRaw}. Type /help for a list.`);
      return;
    }
    const sent = images;
    setImages([]);
    if (editingId) {
      agent.editMessage(editingId, text);
      setEditingId(null);
      return;
    }
    // Already in the IDE? Keep the editor on screen — the docked chat is the
    // same conversation, so switching views would throw away the workbench.
    if (view !== "ide") setView("chat");
    if (text.trim()) setHistory((h) => [text, ...h].slice(0, 100));
    setHistoryIndex(-1);
    agent.submit(text, sent);
  };

  /**
   * Send whatever was typed on the home screen.
   * "idea" primes the agent for an end-to-end build (plan, write, run, link).
   * "chat" keeps it conversational and read-only-ish.
   */
  const startIdea = (idea: string, mode: "idea" | "chat" = "idea") => {
    setView("chat");
    if (mode === "chat") {
      agent.submit(idea, []);
      return;
    }
    agent.submit(
      `${idea}\n\nBuild this end to end: plan it first, then create every file, then start it ` +
        `in the background and tell me the URL to open. Show the preview when it is up.`,
      [],
    );
  };

  const foundUrls = useFoundUrls(agent.items);

  // Workspace file list, used by @-mentions.
  const [allFiles, setAllFiles] = useState<FileHit[]>([]);
  useEffect(() => {
    if (!agent.cwd) return;
    let dead = false;
    fetch(`/api/fs/tree?path=${encodeURIComponent(agent.cwd)}`)
      .then((r) => r.json())
      .then((j) => {
        if (dead) return;
        const out: FileHit[] = [];
        const walk = (n: any) => {
          if (!n) return;
          if (n.name) out.push({ path: n.path || n.name, name: n.name, isDir: !!n.isDir });
          for (const c of n.children || []) walk(c);
        };
        walk(j.tree || j);
        setAllFiles(out.slice(0, 4000));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [agent.cwd]);

  const mentionFiles = useMemo(
    () => (mentionQuery === null ? [] : filterFiles(allFiles, mentionQuery)),
    [mentionQuery, allFiles],
  );

  // Track an in-progress @mention as the caret moves.
  const refreshMention = (val: string, caret: number) => {
    const m = detectMention(val, caret);
    if (!m) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(m.query);
    setMentionIndex(0);
  };

  const acceptMention = (f: FileHit) => {
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : input.length;
    const m = detectMention(input, caret);
    if (!m) return;
    const next = `${input.slice(0, m.start)}@${f.path} ${input.slice(caret)}`;
    setInput(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const e = textareaRef.current;
      if (!e) return;
      const pos = m.start + f.path.length + 2;
      e.focus();
      e.setSelectionRange(pos, pos);
    });
  };
  // When the agent surfaces a new local server, surface it in the preview.
  foundUrlsRef.current = foundUrls;
  useEffect(() => {
    const latest = foundUrls[foundUrls.length - 1]?.url;
    if (latest && latest !== lastSeenUrl.current) {
      lastSeenUrl.current = latest;
      setPreviewUrl(latest);
      setShowPreview(true);
    }
  }, [foundUrls]);

  const completeCommand = (cmd: string) => setInput(cmd + " ");

  // Accept image files pasted from the clipboard or dropped anywhere.
  const acceptFiles = (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    let pending = imgs.length;
    const next: AttachedImage[] = [];
    for (const f of imgs) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        next.push({
          media_type: f.type,
          data: dataUrl.split(",")[1] || "",
          name: f.name,
        });
        if (--pending === 0) setImages((prev) => [...prev, ...next]);
      };
      reader.onerror = () => {
        if (--pending === 0) setImages((prev) => [...prev, ...next]);
      };
      reader.readAsDataURL(f);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      acceptFiles(files);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) acceptFiles(e.dataTransfer.files);
  };

  const recallHistory = (dir: -1 | 1) => {
    if (history.length === 0) return;
    const next = historyIndex + (dir === -1 ? 1 : -1);
    if (next < 0) {
      setHistoryIndex(-1);
      setInput("");
      return;
    }
    if (next >= history.length) return;
    setHistoryIndex(next);
    setInput(history[next]);
  };

  const paletteActions: PaletteAction[] = useMemo(() => {
    const acts: PaletteAction[] = [
      { id: "new", label: "New idea", hint: "start a build", run: () => setView("home") },
      { id: "newchat", label: "New chat", hint: "start a conversation", run: () => { clearRunState(); agent.reset(); setView("chat"); } },
      { id: "settings", label: "Open settings", run: () => setShowSettings(true) },
      { id: "ide", label: "Open the IDE", hint: "editor with the agent beside it", run: () => enterIde() },
      { id: "guide", label: "Open the guide", run: () => setShowGuide(true) },
      { id: "plugins", label: "Manage plugins", run: () => setShowPlugins(true) },
      { id: "files", label: "Browse files", run: () => setShowFiles(true) },
      { id: "folder", label: "Change workspace folder", run: () => { setFolderMode("workspace"); setShowFolder(true); } },
      { id: "adddir", label: "Add another folder to this session", run: () => { setFolderMode("addDir"); setShowFolder(true); } },
      { id: "theme", label: "Toggle light / dark", run: () => setTheme((t) => (t === "dark" ? "light" : "dark")) },
      { id: "checkpoints", label: "Open checkpoints", run: () => setShowCheckpoints(true) },
      { id: "review", label: "Review current diff", run: () => runCommand("/review") },
      { id: "git", label: "Git status and log", run: () => runCommand("/git") },
      { id: "rewind", label: "Rewind to a checkpoint", run: () => runCommand("/rewind") },
      { id: "plan", label: "Plan mode on", run: () => agent.togglePlanMode(true) },
      { id: "compact", label: "Compact the conversation", run: () => runCommand("/compact") },
      { id: "clear", label: "Clear the conversation", run: () => runCommand("/clear") },
      ...(["auto", "low", "medium", "high"] as const)
        .filter((n) => n !== agent.reasoningEffort)
        .map((n) => ({
          id: `effort-${n}`,
          label: `Thinking: ${n === "auto" ? "auto" : n === "low" ? "fast" : n === "high" ? "deep" : "normal"}`,
          group: "display",
          run: () => agent.setReasoningEffort(n),
        })),
      ...([90, 100, 115, 130] as const)
        .filter((n) => n !== fontScale)
        .map((n) => ({
          id: `font-${n}`,
          label: `Text size: ${n}%`,
          group: "display",
          run: () => {
            setFontScale(n);
            localStorage.setItem("cf-font-scale", String(n));
          },
        })),
    ];
    for (const m of ["default", "acceptEdits", "plan", "bypass"] as const) {
      acts.push({
        id: `mode-${m}`,
        label: `Permission: ${m === "default" ? "ask before changes" : m}`,
        group: "permissions",
        run: () => agent.setPermissionMode(m),
      });
    }
    for (const f of allFiles.filter((x) => !x.isDir).slice(0, 250)) {
      acts.push({
        id: `file:${f.path}`,
        label: f.path,
        hint: "file",
        run: () => {
          if (view !== "ide") setView("chat");
          setInput((prev) => (prev ? `${prev} @${f.path}` : `@${f.path}`));
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
      });
    }
    return acts;
  }, [allFiles, agent, setTheme]);

  // Ctrl/Cmd+K from anywhere in the app.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Command palette (global-ish, works from anywhere in the composer).
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen(true);
      return;
    }
    // @-mention navigation takes priority over history.
    if (mentionQuery !== null && mentionFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionFiles.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        acceptMention(mentionFiles[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    // Prompt history, only when not on the first line of a multi-line draft.
    if (e.key === "ArrowUp" && historyIndex >= 0) {
      e.preventDefault();
      recallHistory(-1);
      return;
    }
    if (e.key === "ArrowDown" && historyIndex >= 0) {
      e.preventDefault();
      recallHistory(1);
      return;
    }
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        completeCommand(matches[menuIndex].cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /** Transcript + composer. Shared by the chat view and the IDE's docked panel. */
  const chatPanel = (
    <>
      <div className="transcript" ref={scrollRef}>
        <div className="transcript-inner">
          {agent.planMode && (
            <div className="turn turn-planmode">
              <div className="planmode-bubble">
                Plan mode is on — read-only tools only. The agent will present a plan for approval.
              </div>
            </div>
          )}
          {agent.items.length === 0 && view === "chat" && (
            <div className="welcome">
              <div className="welcome-mark">
                <DragonMark size={40} />
              </div>
              <h1>What should we build?</h1>
              <p className="empty-hint">
                A free, provider-agnostic coding agent. It writes into{" "}
                <code>{agent.cwd || "your workspace"}</code>.
              </p>
              <div className="welcome-spyro">
                <span className="welcome-company">Spyro Technologies</span>
                <span className="welcome-tagline">AI &amp; software development studio</span>
                <span className="welcome-owner">
                  Lewis Kariuki — Senior Developer &amp; Owner
                </span>
              </div>
              <div className="hints">
                {HINTS.map((h) => (
                  <button key={h} onClick={() => agent.submit(h)}>
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}

          {agent.running && agent.reasoning && (
            <div className="turn turn-assistant">
              <ThinkingBlock text={agent.reasoning} live />
            </div>
          )}

          {agent.items.map((it, i) => {
            switch (it.kind) {
              case "user":
                return (
                  <div key={i} className="turn turn-user">
                    <div className="bubble">{it.text}</div>
                    {!agent.running && it.id && (
                      <div className="user-actions">
                        <button
                          className="user-act"
                          title="Edit this message and re-run from here"
                          onClick={() => {
                            setInput(it.text);
                            setEditingId(it.id!);
                            textareaRef.current?.focus();
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="user-act"
                          title="Re-run this message"
                          onClick={() => agent.editMessage(it.id!, it.text)}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {it.edited && <span className="edited-tag">edited</span>}
                  </div>
                );
              case "assistant":
                return (
                  <div key={i} className="turn turn-assistant">
                    {it.reasoning && <ThinkingBlock text={it.reasoning} ms={it.reasoningMs} />}
                    <Markdown text={it.text} />
                    {it.usage && (
                      <div className="msg-usage" title="Tokens used for this reply">
                        <span>{it.usage.totalTokens.toLocaleString()} tok</span>
                        <span className="msg-usage-sep">·</span>
                        <span title="prompt + completion">
                          {it.usage.promptTokens.toLocaleString()}↑{" "}
                          {it.usage.completionTokens.toLocaleString()}↓
                        </span>
                        {it.cost ? (
                          <>
                            <span className="msg-usage-sep">·</span>
                            <span>${it.cost.toFixed(4)}</span>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              case "system":
                return (
                  <div key={i} className="turn turn-system">
                    <div className="system-bubble">{it.text}</div>
                  </div>
                );
              case "error":
                return (
                  <div key={i} className="turn">
                    <div className="error-bubble">{it.text}</div>
                  </div>
                );
              case "notification":
                return (
                  <div key={i} className={`turn turn-notification ${it.level}`}>
                    <div className="notification-bubble">
                      <strong>{it.title}</strong>
                      {it.body ? <div className="notification-body">{it.body}</div> : null}
                    </div>
                  </div>
                );
              case "plan":
                return (
                  <div key={i} className="turn turn-plan">
                    <div className="plan-bubble">
                      <div className="plan-title">Plan</div>
                      <Markdown text={it.plan} />
                    </div>
                  </div>
                );
              case "tool":
                return (
                  <div key={i} className="turn">
                    <ToolCard
                      name={it.name}
                      args={it.args}
                      result={it.result}
                      status={it.status}
                      diff={it.diff}
                    />
                  </div>
                );
              case "approval":
                return (
                  <div key={i} className="turn">
                    <ApprovalDialog
                      name={it.name}
                      args={it.args}
                      preview={it.preview}
                      onDecision={(ok) => agent.approve(it.id, ok)}
                    />
                  </div>
                );
              case "team":
                return (
                  <div key={i} className="turn">
                    <div className="team-panel">
                      <div className="team-title">Team working in parallel</div>
                      {it.members.map((m) => (
                        <div key={m.name} className={`team-member ${m.status}`}>
                          <span className="team-dot" />
                          <span className="team-name">{m.name}</span>
                          <span className="team-status">{m.status === "done" ? "done" : "working…"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              case "ask":
                return (
                  <div key={i} className="turn">
                    <AskDialog
                      id={it.id}
                      questions={it.questions}
                      onAnswer={(id, answers) => agent.answer(id, answers)}
                    />
                  </div>
                );
            }
          })}
        </div>
      </div>

      {view === "chat" && (
        <UrlCards
          urls={foundUrls}
          onPreview={(u) => {
            setPreviewUrl(u);
            setShowPreview(true);
          }}
        />
      )}

      {mentionQuery !== null && mentionFiles.length > 0 && (
        <MentionMenu
          query={mentionQuery}
          files={mentionFiles}
          active={mentionIndex}
          position={{ top: -8, left: 16 }}
          onPick={acceptMention}
        />
      )}

      <div className={`composer-wrap${dragOver ? " drag-over" : ""}`}>
        {dragOver && <div className="drop-hint">Drop images to attach</div>}
        <div className="composer-inner">
          {menuOpen && (
            <div className="slash-menu">
              {matches.map((c, i) => (
                <button
                  key={c.cmd}
                  className={`slash-item${i === menuIndex ? " active" : ""}`}
                  onMouseEnter={() => setMenuIndex(i)}
                  onClick={() => completeCommand(c.cmd)}
                >
                  <span className="slash-cmd">{c.cmd}</span>
                  <span className="slash-desc">{c.desc}</span>
                </button>
              ))}
            </div>
          )}

          {agent.shells.length > 0 && (
            <div className="todo-wrap">
              <ShellPanel shells={agent.shells} onKill={agent.killShell} />
            </div>
          )}
          {agent.todos.length > 0 && (
            <div className="todo-wrap">
              <TodoPanel todos={agent.todos} />
            </div>
          )}
          {(agent.tasks.length > 0 || agent.crons.length > 0) && (
            <div className="todo-wrap">
              <TaskPanel tasks={agent.tasks} crons={agent.crons} />
            </div>
          )}

          <div className="composer">
            {images.length > 0 && (
              <div className="attach-strip">
                {images.map((img, i) => (
                  <span key={i} className="attach-chip" title={img.name}>
                    🖼 {img.name}
                    <button
                      className="attach-x"
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-row">
              <button
                className="icon-btn"
                onClick={() => fileRef.current?.click()}
                title="Attach image"
              >
                📎
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={(e) => {
                  onPickImages(e.target.files);
                  e.target.value = "";
                }}
              />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  refreshMention(e.target.value, e.target.selectionStart ?? 0);
                }}
                onClick={(e) => refreshMention(input, e.currentTarget.selectionStart ?? 0)}
                onKeyUp={(e) => {
                  if (e.key.startsWith("Arrow") || e.key === "Backspace")
                    refreshMention(input, (e.target as HTMLTextAreaElement).selectionStart ?? 0);
                }}
                onPaste={onPaste}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onKeyDown={onKeyDown}
                placeholder="Ask Spyro Studio to build something…  (type / for commands)"
                rows={1}
              />
              {agent.running ? (
                <button className="btn-cancel" onClick={agent.cancel} title="Stop">
                  ■
                </button>
              ) : (
                <button
                  className="btn-send"
                  onClick={send}
                  disabled={!input.trim() && images.length === 0}
                  title="Send"
                >
                  ↑
                </button>
              )}
            </div>
          </div>

          <div className="composer-controls">
            <button className="composer-chip" onClick={() => { setFolderMode("workspace"); setShowFolder(true); }} title={agent.cwd}>
              {agent.cwd ? basename(agent.cwd) : "workspace"}
            </button>
            <span className="composer-spacer" />
            <button
              className="composer-chip"
              onClick={() => {
                const names = agent.outputStyles.map((s) => s.name);
                if (!names.length) {
                  agent.pushSystem(
                    "No output styles found. Add .claude/output-styles/<name>.md to define one.",
                  );
                  return;
                }
                const next = agent.outputStyle
                  ? names[(names.indexOf(agent.outputStyle) + 1) % names.length]
                  : names[0];
                agent.setActiveOutputStyle(next);
              }}
              title="Cycle output style"
            >
              {agent.outputStyle ? `Style: ${agent.outputStyle}` : "Style: default"}
            </button>
            <button
              className={`composer-chip${agent.planMode ? " active" : ""}`}
              onClick={() => agent.togglePlanMode(!agent.planMode)}
              title="Toggle plan mode"
            >
              {agent.planMode ? "Plan: On" : "Plan: Off"}
            </button>
            <button
              className="composer-chip"
              onClick={() => agent.toggleAutoApprove(!agent.autoApprove)}
              title="Toggle auto-approve"
            >
              {agent.autoApprove ? "Auto" : "Manual"}
            </button>
            <button className="composer-chip" onClick={() => setShowSettings(true)}>
              {agent.model?.model || "model"}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  /** Everything shown before the account exists — and nothing else. */
  const onboardingOnly = () => {
    // Neutral splash while the account check is in flight. Rendering anything
    // branded here is what made returning users feel like first-time users.
    if (onboard.step === "loading") {
      return (
        <div className="boot">
          <DragonMark size={44} />
        </div>
      );
    }
    if (onboard.step === "welcome") {
      return (
        <Welcome
          onContinue={() => setOnboard({ ...onboard, step: "create" })}
          onSignIn={() => setOnboard({ ...onboard, step: "signin" })}
        />
      );
    }
    if (onboard.step === "create") {
      return <AccountScreen mode="create" onBack={() => setOnboard({ ...onboard, step: "welcome" })} onDone={afterAccount} />;
    }
    if (onboard.step === "signin") {
      return <AccountScreen mode="signin" onBack={() => setOnboard({ ...onboard, step: "welcome" })} onDone={afterAccount} />;
    }
    if (onboard.step === "ways") {
      return <ThreeWays onPick={(m) => setOnboard({ ...onboard, step: "intro", mode: m })} />;
    }
    if (onboard.step === "intro" && onboard.mode) {
      return (
        <ModeIntro
          card={cardFor(onboard.mode)}
          onBack={() => setOnboard({ ...onboard, step: "ways", mode: null })}
          onContinue={() => finishOnboarding(onboard.mode!)}
        />
      );
    }
    return <div className="welcome" />;
  };

  /**
   * Onboarding owns the whole window until it is finished. The app is not
   * rendered behind it at all — no flash, nothing clickable underneath, and
   * nothing to inspect before the account exists.
   */
  if (onboard.step !== "done") return onboardingOnly();

  return (
    <div className="app">
      <aside className={`sidebar${showNav ? " open" : ""}`}>
        <div className="brand">
          <span className="claude-mark">
            <DragonMark size={20} />
          </span>
          <span className="brand-name" onClick={goHome} style={{ cursor: "pointer" }}>
            Spyro Studio <span className="brand-suffix">Spyro</span>
          </span>
        </div>

        <button className="new-session" onClick={goHome}>
          <span className="plus">＋</span>
          <span>New idea</span>
        </button>

        <div className="sidebar-label">
          <span>Recent</span>
          {agent.sessions.length > 0 && (
            <button
              className="sidebar-clean"
              title="Delete short/empty sessions"
              onClick={() => setShowClean(true)}
            >
              tidy up
            </button>
          )}
        </div>
        <div className="sidebar-search">
          <input
            placeholder="Filter sessions…"
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
          />
        </div>
        <div className="sidebar-scroll">
          {agent.sessions.length > 0 && filteredSessions.length === 0 && (
            <div className="sidebar-empty">Nothing matches “{sessionFilter}”.</div>
          )}
          {agent.sessions.length === 0 && <div className="sidebar-empty">No sessions yet.</div>}
          {filteredSessions.map((s) => (
            <div key={s.id} className={`session-item${s.id === agent.currentSessionId ? " active" : ""}`}>
              <button
                className="session-item-main"
                onClick={() => {
                  clearRunState();
                  agent.loadSession(s.id);
                  setShowNav(false);
                }}
              >
                <span className={`session-dot ${s.status || "idle"}`} />
                <span className="session-item-title">{s.title || "Untitled"}</span>
                {s.diffStats && (s.diffStats.added > 0 || s.diffStats.removed > 0) && (
                  <span className="session-diff">
                    <span className="add">+{s.diffStats.added}</span>
                    <span className="del">−{s.diffStats.removed}</span>
                  </span>
                )}
              </button>
              <div className="session-item-actions">
                <span className="session-item-meta">{when(s.updatedAt)} · {s.messageCount} msgs</span>
                <button
                  className="session-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete session "${s.title || "Untitled"}"?`)) {
                      agent.deleteSession(s.id);
                    }
                  }}
                  title="Delete session"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <button className="model-button" onClick={() => setShowSettings(true)}>
            <span className={`conn-dot ${agent.connected ? "on" : "off"}`} />
            <span>{agent.model?.model || "choose model"}</span>
          </button>
        </div>
      </aside>

      {showNav && <div className="nav-backdrop" onClick={() => setShowNav(false)} />}

      <main className="main">
        {view === "ide" ? (
          <IdeTitleBar
            cwd={ideFolder || agent.cwd}
            onHome={leaveIde}
            onChat={enterIde}
            onCloseFolder={() => {
              ideFolderRef.current = "";
              localStorage.removeItem("cf-ide-folder");
              setIdeFolder("");
            }}
            model={agent.model?.model}
            provider={agent.model?.provider}
            permissionMode={agent.permissionMode}
            running={agent.running}
            onToggleChat={() => setIdeChatOpen((o) => !o)}
            chatOpen={ideChatOpen}
          />
        ) : (
        <header className="topbar">
          <button
            className="icon-btn nav-toggle"
            onClick={() => setShowNav(true)}
            title="Sessions and projects"
          >
            ☰
          </button>
          <div className="topbar-title">{view === "home" ? "Spyro Studio" : title}</div>
          <div className="topbar-actions">
            {agent.statusLine && (
              <span
                className={`chip statusline-chip${agent.statusLineError ? " error" : ""}`}
                title={agent.statusLineError || "Custom status line"}
              >
                {agent.statusLine}
              </span>
            )}
            {(agent.usage.totalTokens > 0 || agent.cost > 0) && (
              <span className="chip usage-chip" title="Tokens used this session">
                {formatTok(agent.usage.totalTokens)} tok
                {agent.cost > 0 && <> · ${agent.cost.toFixed(4)}</>}
              </span>
            )}
            <button className="chip" onClick={() => { setFolderMode("workspace"); setShowFolder(true); }} title={agent.cwd}>
              <span className="dot" />
              {agent.cwd ? basename(agent.cwd) : "connecting…"}
            </button>
            <button
              className={`chip${showFiles ? " active" : ""}`}
              onClick={() => setShowFiles((s) => !s)}
            >
              Files
            </button>
            <button
              className={`chip${view === "ide" ? " active" : ""}`}
              onClick={() => { if (view === "ide") leaveIde(); else enterIde(); }}
              title={view === "ide" ? "Leave IDE (go back to chat)" : "Open IDE"}
            >
              {view === "ide" ? "← Chat" : "IDE →"}
            </button>
            <div className="mode-select" title="How hard the model should think">
              <select
                value={agent.reasoningEffort}
                onChange={(e) =>
                  agent.setReasoningEffort(e.target.value as "auto" | "low" | "medium" | "high")
                }
              >
                <option value="auto">Thinking: auto</option>
                <option value="low">Thinking: fast</option>
                <option value="medium">Thinking: normal</option>
                <option value="high">Thinking: deep</option>
              </select>
            </div>
            <div className="mode-select" title="Permission mode">
              <select
                value={agent.permissionMode}
                onChange={(e) =>
                  agent.setPermissionMode(e.target.value as "default" | "acceptEdits" | "plan" | "bypass")
                }
              >
                <option value="default">Ask before changes</option>
                <option value="acceptEdits">Accept edits</option>
                <option value="plan">Plan only</option>
                <option value="bypass">Bypass permissions</option>
              </select>
            </div>
            <button
              className="icon-btn"
              onClick={() => setShowGuide(true)}
              title="Guide — plugins, projects, MCP, troubleshooting"
            >
              ?
            </button>
            <button
              className="icon-btn"
              onClick={() =>
                setThemePref(themePref === "dark" ? "light" : themePref === "light" ? "system" : "dark")
              }
              title={`Theme: ${themePref}${
                themePref === "system" ? ` (currently ${theme})` : ""
              } — click to change`}
            >
              {themePref === "system" ? (theme === "dark" ? "◐" : "◑") : theme === "dark" ? "☀" : "☾"}
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                agent.mcpOauthStatus();
                setShowMcpOauth(true);
              }}
              title="MCP server sign-in"
            >
              ⇄
            </button>
            <button
              className="icon-btn"
              onClick={() => setShowPlugins(true)}
              title="Plugins"
            >
              🧩
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                agent.listCheckpoints();
                setShowCheckpoints(true);
              }}
              title="Checkpoints"
            >
              ⟲
            </button>
            <CollabPresence agent={agent} />
            <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
              ⚙
            </button>
          </div>
        </header>
        )}

        {!agent.connected ? (
          <div className="skel-wrap">
            <div className="skel skel-title" />
            <div className="skel skel-line" />
            <div className="skel skel-line short" />
            <div className="skel skel-block" />
            <span className="skel-note">Connecting to the local server…</span>
          </div>
        ) : view === "ide" ? !ideFolder ? (
          <IdeOpenFolder
            cwd={agent.cwd}
            projects={ideProjects}
            onOpen={openIdeFolder}
            onCreate={createProjectFolder}
            home={agent.cwd}
            onClose={() => {
              leaveIde();
            }}
          />
        ) : (
          <IdeShell
            cwd={ideFolder}
            chatOpen={ideChatOpen}
            onToggleChat={() => setIdeChatOpen((o) => !o)}
            onOpenFullChat={enterIde}
            onLeave={leaveIde}
            onOpenFolder={openIdeFolder}
            shells={agent.shells}
            extraDirs={agent.extraDirs}
            onOpenServer={(u) => { setPreviewUrl(u); setShowPreview(true); }}
            onRunFile={(p) => {
              // Serve the file from the IDE folder and show it in the preview tab.
              const rel = ideFolder && p.startsWith(ideFolder) ? p.slice(ideFolder.length + 1) : p.replace(/^\/+/, "");
              setPreviewUrl(`/preview/${rel.split("/").map(encodeURIComponent).join("/")}`);
              setShowPreview(true);
            }}
            onOpenSettings={() => setShowIdeSettings(true)}
            settings={ideSettings.settings}
            previewUrl={previewUrl}
            onClosePreview={() => setShowPreview(false)}
            onUrlChange={setPreviewUrl}
            fsTick={agent.fsTick}
            fsChange={agent.fsChange}
            onShellStart={agent.shellStart}
            shellOutput={agent.shellOutput}
            shellRunning={agent.shellRunning}
            shellCwd={agent.shellCwd}
            onShellKill={agent.shellKill}
            statusLine={agent.statusLine}
            statusLineError={agent.statusLineError}
            chat={<div className="ide-agent">{chatPanel}</div>}
          />
        ) : view === "home" ? (
          <HomeView
            onEnterIde={enterIde}
            onOpenFolder={openIdeFolder}
            onOpenInChat={enterChat}
            onCreateNew={() => setOnboard({ ...onboard, step: "ways", mode: null })}
            onStartIdea={startIdea}
            busy={agent.running}
            provider={agent.model?.provider || "openrouter"}
            folder={agent.cwd}
          />
        ) : (
          chatPanel
        )}

      </main>

      {/* Docked beside the chat — except in the IDE, where it is an editor tab. */}
      {showPreview && previewUrl && view !== "ide" && (
        <PreviewPanel
          url={previewUrl}
          onClose={() => setShowPreview(false)}
          onUrlChange={setPreviewUrl}
        />
      )}
      {previewUrl && !showPreview && view !== "ide" && (
        <div className="preview-rail">
          <button className="preview-reopen" onClick={() => setShowPreview(true)} title="Show preview">
            ▣ preview
          </button>
        </div>
      )}

      {showFiles && agent.cwd && (
        <aside className="file-drawer">
          <div className="file-drawer-head">
            <span>Files</span>
            <button className="icon-btn" onClick={() => setShowFiles(false)}>
              ×
            </button>
          </div>
          <FileTree cwd={agent.cwd} onOpenFile={(p) => setViewPath(p)} />
        </aside>
      )}

      {showSettings && (
        <SettingsPanel
          model={agent.model}
          presets={agent.presets}
          apiKeys={agent.apiKeys}
          onSave={agent.setModelConfig}
          onClose={() => setShowSettings(false)}
          permissionRules={agent.permissions}
          onSavePermissions={agent.setPermissions}
          account={account}
          onChangePassword={changePassword}
          onSignOut={signOut}
        />
      )}

      {showFolder && (
        <FolderPicker
          cwd={agent.cwd}
          onSelect={(p) => {
            if (folderMode === "addDir") agent.addDir(p);
            else agent.setWorkspaceCwd(p);
            setShowFolder(false);
          }}
          onClose={() => setShowFolder(false)}
        />
      )}

      {showPlugins && (
        <PluginsPanel
          marketplaces={agent.marketplaces}
          installed={agent.installedPlugins}
          onClose={() => setShowPlugins(false)}
          onAddMarketplace={(r) => agent.pluginAddMarketplace(r)}
          onRemoveMarketplace={(n) => agent.pluginRemoveMarketplace(n)}
          onInstall={(n, m) => agent.pluginInstall(n, m)}
          onUninstall={(n) => agent.pluginUninstall(n)}
          onToggle={(n, e) => agent.pluginToggle(n, e)}
          onUpdate={(n) => agent.pluginUpdate(n)}
        />
      )}

      {showCheckpoints && (
        <CheckpointsPanel
          checkpoints={agent.checkpoints}
          onClose={() => setShowCheckpoints(false)}
          onRewind={(id) => {
            agent.rewindCheckpoint(id);
            setShowCheckpoints(false);
          }}
        />
      )}

      {showMcpOauth && (
        <McpOAuthPanel
          servers={agent.mcpOauthServers}
          currentUrl={agent.mcpOauthUrl}
          onClose={() => setShowMcpOauth(false)}
          onStatus={agent.mcpOauthStatus}
          onStart={agent.mcpOauthStart}
          onSubmitCode={agent.mcpOauthSubmit}
          onDisconnect={agent.mcpOauthDisconnect}
        />
      )}

      {showIdeSettings && ideFolder && (
        <IdeSettingsPanel
          folder={ideFolder}
          settings={ideSettings.settings}
          onChange={ideSettings.save}
          onClose={() => setShowIdeSettings(false)}
        />
      )}
      {showGuide && <GuidePanel onClose={() => setShowGuide(false)} />}
      {showDiscordReminder && !discordJoined && (
        <div className="modal-overlay" onClick={dismissDiscordReminder}>
          <div className="discord-reminder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="discord-reminder-header">
              <span className="discord-logo">💬</span>
              <h3>Join Our Discord Community</h3>
            </div>
            <p>Get the latest updates, ask questions, share your projects, and connect with other Spyro Studio users.</p>
            <div className="discord-benefits">
              <h4>Benefits:</h4>
              <ul>
                <li>🔔 Real-time updates & announcements</li>
                <li>🤝 Community support & tips</li>
                <li>🎁 Early access to new features</li>
                <li>👥 Invite friends for extra benefits</li>
              </ul>
            </div>
            <div className="discord-reminder-actions">
              <button className="btn-primary" onClick={handleDiscordJoin}>
                Join Discord →
              </button>
              <button className="btn-secondary" onClick={dismissDiscordReminder}>
                Remind me tomorrow
              </button>
            </div>
          </div>
        </div>
      )}
      <ErrorDialog info={errDialog} onClose={() => setErrDialog(null)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />

      {showClean && (
        <div className="modal-overlay" onClick={() => setShowClean(false)}>
          <div className="modal clean-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Tidy up sessions</h2>
            <p className="clean-sub">
              {junkSessions.length} of {agent.sessions.length} look like noise — 0–2 messages, or a
              title like “hii”. They can be deleted; anything with real work is kept.
            </p>
            <div className="clean-list">
              {junkSessions.slice(0, 40).map((s) => (
                <div key={s.id} className="clean-row">
                  <span className="clean-title">{s.title || "New session"}</span>
                  <span className="clean-count">{s.messageCount ?? 0} msgs</span>
                </div>
              ))}
              {junkSessions.length > 40 && (
                <div className="clean-row clean-more">+{junkSessions.length - 40} more</div>
              )}
              {junkSessions.length === 0 && <div className="clean-row clean-more">Nothing to clean.</div>}
            </div>
            <div className="clean-actions">
              <button className="btn-ghost" onClick={() => setShowClean(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={junkSessions.length === 0}
                onClick={() => {
                  for (const s of junkSessions) agent.deleteSession(s.id);
                  setShowClean(false);
                }}
              >
                Delete {junkSessions.length} session{junkSessions.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOnboarding && (
        <Onboarding
          providers={agent.providers}
          freeProviders={agent.freeProviders}
          savedKeys={agent.apiKeys}
          initialProvider={agent.model?.provider}
          initialBaseUrl={agent.model?.baseUrl}
          initialModel={agent.model?.model}
          onSave={(cfg) => {
            agent.setModelConfig({
              provider: cfg.provider,
              model: cfg.model,
              baseUrl: cfg.baseUrl,
              apiKey: cfg.apiKey ?? "",
            });
            setShowOnboarding(false);
          }}
          onSkip={() => setShowOnboarding(false)}
        />
      )}

      {viewPath && <FileViewer path={viewPath} onClose={() => setViewPath(null)} />}
    </div>
  );
}
