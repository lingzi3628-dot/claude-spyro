import { useEffect, useRef, useState } from "react";

export type Mode = "chat" | "ide" | "idea";

interface Card {
  id: Mode;
  title: string;
  tagline: string;
  blurb: string;
  art: string;
  tint: string;
  glyph: string;
  bullets: string[];
  minutes: string;
}

const CARDS: Card[] = [
  {
    id: "chat",
    title: "Chat",
    tagline: "Ask, explore, decide",
    blurb:
      "A direct conversation with a coding agent. Paste an error, ask how something works, or think a problem through before touching anything.",
    art: "/art/chat.jpg",
    tint: "#f5a524",
    glyph: "💬",
    bullets: [
      "Bring your own model — cloud or a local one",
      "Reads your project so answers are specific",
      "Nothing is written unless you say so",
    ],
    minutes: "Best for thinking, not building",
  },
  {
    id: "ide",
    title: "IDE",
    tagline: "A real editor, agent beside it",
    blurb:
      "A full editor with tabs, search, an integrated terminal, git, a database browser and an extension marketplace — with the agent docked to the side.",
    art: "/art/ide.jpg",
    tint: "#7c6cff",
    glyph: "⌨",
    bullets: [
      "Code on your own — hide the agent entirely",
      "Rename, delete, run and debug in place",
      "See servers and databases without leaving the editor",
    ],
    minutes: "Best for day-to-day development",
  },
  {
    id: "idea",
    title: "Idea Box",
    tagline: "Describe it, get something real",
    blurb:
      "Describe an application in plain language. The agent plans it, writes it, runs it, and hands you a link you can open.",
    art: "/art/idea.jpg",
    tint: "#e0559b",
    glyph: "✦",
    bullets: [
      "Good for prototypes and whole small apps",
      "Plans first, then builds",
      "Ends with something running and previewable",
    ],
    minutes: "Best for starting from nothing",
  },
];

/** Three ways to use Spyro Studio — the choice that follows sign-up. */
export function ThreeWays({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div className="ways">
      <div className="ways-bg" aria-hidden="true" />
      <div className="ways-inner">
        <span className="ways-eyebrow">You're in</span>
        <h2 className="ways-title">
          You can use Spyro Studio in <span className="grad">three ways</span>
        </h2>
        <p className="ways-sub">Pick one to start. You can switch or use all three at any time.</p>

        <div className="ways-grid">
          {CARDS.map((c, i) => (
            <button
              key={c.id}
              className="way-card"
              style={{ ["--tint" as any]: c.tint, ["--i" as any]: i } as React.CSSProperties}
              onClick={() => onPick(c.id)}
            >
              <div className="way-art">
                <img src={c.art} alt="" loading="lazy" />
                <div className="way-art-sheen" />
              </div>
              <div className="way-body">
                <span className="way-glyph">{c.glyph}</span>
                <h3 className="way-name">{c.title}</h3>
                <p className="way-tagline">{c.tagline}</p>
                <p className="way-blurb">{c.blurb}</p>
                <span className="way-go">
                  Find out more <b>→</b>
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The "what is this, exactly?" screen shown after a card is chosen. */
export function ModeIntro({ card, onBack, onContinue }: { card: Card; onBack: () => void; onContinue: () => void }) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 40);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="intro" style={{ ["--tint" as any]: card.tint } as React.CSSProperties}>
      <div className="intro-bg" aria-hidden="true" />
      <div className={`intro-inner${shown ? " in" : ""}`} ref={ref}>
        <button className="intro-back" onClick={onBack}>
          ‹ All three ways
        </button>

        <div className="intro-art">
          <img src={card.art} alt="" />
          <span className="intro-glyph">{card.glyph}</span>
        </div>

        <div className="intro-copy">
          <span className="intro-eyebrow">{card.tagline}</span>
          <h2 className="intro-title">{card.title}</h2>
          <p className="intro-blurb">{card.blurb}</p>

          <ul className="intro-list">
            {card.bullets.map((b, i) => (
              <li key={i} style={{ animationDelay: `${140 + i * 90}ms` }}>
                <span className="intro-tick" />
                {b}
              </li>
            ))}
          </ul>

          <p className="intro-note">{card.minutes}</p>

          <div className="intro-actions">
            <button className="btn-primary big" onClick={onContinue}>
              Continue to {card.title}
            </button>
            <button className="btn-ghost" onClick={onBack}>
              Pick something else
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function cardFor(id: Mode): Card {
  return CARDS.find((c) => c.id === id) || CARDS[0];
}
