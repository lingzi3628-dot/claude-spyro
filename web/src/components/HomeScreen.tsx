import { useEffect, useRef, useState } from "react";
import { DragonMark } from "./DragonMark";

const IDEAS = [
  "a pomodoro timer that logs focus sessions to SQLite",
  "a markdown notes app with tags and full-text search",
  "a URL shortener with a click counter",
  "a recipe manager with an ingredient search",
  "a habit tracker with a 30-day heatmap",
  "a password strength auditor that checks your own passwords locally",
  "a colour palette generator from an uploaded image",
  "a CSV to chart dashboard with sortable tables",
  "a dev server log viewer that tails and filters",
  "a personal weather dashboard with a 5-day forecast",
  "a book library with cover images and a reading-progress bar",
  "a JSON schema validator with friendly error messages",
  "a pomodoro timer that plays a chime when the timer ends",
  "a link shortener with expiry dates",
  "a kanban board that saves to a JSON file",
  "a command that finds the 10 biggest files in a folder",
  "a typing speed test with a live WPM counter",
  "a QR code generator that works entirely offline",
  "a quiz app that reads questions from a YAML file",
  "a spend tracker that imports a bank CSV",
  "a markdown to PDF converter",
  "a file duplicate finder with a checksum report",
  "a pomodoro tracker that exports a weekly summary",
];

const PLACEHOLDERS = [
  "Build a task manager with a web UI and a SQLite database…",
  "Make me a URL shortener, then start it and give me the link…",
  "Create a Next.js dashboard with dark mode and charts…",
  "Write a Python CLI that renames files in bulk, with --dry-run…",
  "Build a markdown notes app with tags and search…",
  "Find the bug in this project and fix it with a test…",
  "Scaffold an Express API with SQLite and write the endpoints…",
  "Build a recipe site: search, filter and a detail page…",
];

const CHAT_PLACEHOLDERS = [
  "Why is my build failing only on this machine?",
  "Explain how this project is structured…",
  "What's the difference between these two approaches?",
  "Review this code and tell me what you'd change…",
  "Help me decide between these options…",
];

const CHAT_STARTERS = [
  { icon: "❓", title: "Explain", prompt: "Explain what this project does and how it fits together." },
  { icon: "⚕", title: "Debug", prompt: "Find the bug in this project and explain why it happens." },
  { icon: "◑", title: "Plan", prompt: "Plan a refactor of this codebase. Don't write code yet." },
  { icon: "✎", title: "Review", prompt: "Review my current changes and point out problems." },
];

const SUGGESTIONS = [
  { icon: "◈", title: "Landing page", prompt: "Build a clean landing page for a coffee shop called Ember, with a menu section and a contact form." },
  { icon: "◆", title: "REST API", prompt: "Build a small REST API in Python with SQLite for tracking habits, including GET, POST and DELETE endpoints." },
  { icon: "⬢", title: "Dashboard", prompt: "Build a React dashboard that shows sales charts from a JSON file, with a dark theme and a date filter." },
  { icon: "⚙", title: "CLI tool", prompt: "Build a Python CLI that renames video files in bulk and can be run with --dry-run first." },
  { icon: "✦", title: "Next.js app", prompt: "Scaffold a Next.js app with a home page, about page and a shared layout, then start the dev server and give me the link." },
  { icon: "⇄", title: "Fix a bug", prompt: "Read this project, find the bug, and fix it with a test that proves it works." },
  { icon: "◐", title: "Data tool", prompt: "Build a CLI that analyses a CSV and prints a summary with charts in the terminal." },
  { icon: "◑", title: "Automation", prompt: "Write a script that watches a folder and moves new files into subfolders by type." },
  { icon: "◇", title: "Offline tool", prompt: "Build a single-page app that works fully offline with no external services." },
  { icon: "◉", title: "Visualiser", prompt: "Build an interactive chart from sample data, with hover tooltips and a legend." },
  { icon: "▣", title: "With a UI", prompt: "Build a small web app with a clean dark interface, then start the dev server and give me the link." },
];

export function HomeScreen({
  onSubmit,
  busy,
  provider,
  providerLabel,
  onChangeProvider,
  folder,
}: {
  onSubmit: (text: string, mode: "idea" | "chat") => void;
  busy: boolean;
  provider: string;
  providerLabel?: string;
  onChangeProvider?: (p: string) => void;
  folder?: string;
}) {
  const [mode] = useState<"idea" | "chat">("idea");
  const [text, setText] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [ideaIdx, setIdeaIdx] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Rotate the placeholder and the "something to build" hint so the box never
  // reads as a dead end.
  useEffect(() => {
    const p = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length), 4200);
    const d = setInterval(() => setIdeaIdx((i) => (i + 1) % IDEAS.length), 5200);
    return () => {
      clearInterval(p);
      clearInterval(d);
    };
  }, []);

  const [shuffled, setShuffled] = useState(() => SUGGESTIONS.slice(0, 4));
  useEffect(() => {
    const t = setInterval(() => {
      const next = [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4);
      setShuffled(next);
    }, 9000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSubmit(t, mode);
    setText("");
  };

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-hero">
          <span className="home-mark">
            <DragonMark size={44} />
          </span>
          <h1>{mode === "idea" ? "What should we build?" : "What do you want to talk about?"}</h1>
          <p className="home-tag">
            {mode === "idea"
              ? "Describe it in a sentence. Spyro Studio plans it, writes every file, runs it, and gives you the link."
              : "Ask a question, review a decision, work through an idea. Nothing is created until you say so."}
          </p>
        </div>

        <div className="home-box">
          <textarea
            ref={ref}
            className="home-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={mode === "idea" ? PLACEHOLDERS[placeholderIdx] : CHAT_PLACEHOLDERS[placeholderIdx % CHAT_PLACEHOLDERS.length]}
            rows={2}
            disabled={busy}
          />
          {!text.trim() && mode === "idea" && (
            <div className="home-spark" aria-hidden="true">
              <span className="home-spark-label">or build</span>
              <button
                className="home-spark-idea"
                onClick={() => setText(`Build ${IDEAS[ideaIdx]}…`)}
                title="Use this idea"
              >
                {IDEAS[ideaIdx]}
              </button>
            </div>
          )}

          <div className="home-actions">
            <span className="home-meta">
              {folder ? (
                <>
                  <span className="home-folder" title={folder}>
                    {folder.split("/").filter(Boolean).slice(-1)[0]}
                  </span>
                </>
              ) : (
                "no folder chosen"
              )}
            </span>
            <div className="home-right">
              {onChangeProvider && (
                <select
                  className="home-provider"
                  value={provider}
                  onChange={(e) => onChangeProvider(e.target.value)}
                  title="Model provider"
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="ollama">Ollama (local)</option>
                  <option value="huggingface">Hugging Face</option>
                  <option value="groq">Groq</option>
                  <option value="gemini">Gemini</option>
                  <option value="cerebras">Cerebras</option>
                  <option value="mistral">Mistral</option>
                  <option value="nvidia">NVIDIA</option>
                  <option value="together">Together</option>
                  <option value="github">GitHub</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="xai">xAI</option>
                </select>
              )}
              <button className="home-go" onClick={submit} disabled={!text.trim() || busy}>
                <span className="home-go-label">
                  {busy ? "Working…" : mode === "idea" ? "Build it" : "Ask"}
                </span>{" "}
                <span className="home-go-key">↵</span>
              </button>
            </div>
          </div>
        </div>

        <div className="home-grid">
          {(mode === "idea" ? shuffled : CHAT_STARTERS).map((s) => (
            <button
              key={s.title}
              className="home-card"
              onClick={() => {
                setText(s.prompt);
                ref.current?.focus();
              }}
            >
              <span className="home-card-icon">{s.icon}</span>
              <span className="home-card-title">{s.title}</span>
              <span className="home-card-sub">{s.prompt.slice(0, 74)}…</span>
            </button>
          ))}
        </div>

        <p className="home-foot">
          Everything runs on your machine. {providerLabel ? `Using ${providerLabel}. ` : ""}
          Your files, your keys, no account.
        </p>
      </div>
    </div>
  );
}