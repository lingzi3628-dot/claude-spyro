import { useState } from "react";
import type { UserQuestion, UserQuestionAnswer } from "../types";

interface Props {
  id: string;
  questions: UserQuestion[];
  onAnswer: (id: string, answers: UserQuestionAnswer[]) => void;
}

export function AskDialog({ id, questions, onAnswer }: Props) {
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});

  const toggle = (qi: number, label: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[qi] || []);
      if (set.has(label)) set.delete(label);
      else set.add(label);
      next[qi] = set;
      return next;
    });
  };

  const submit = () => {
    const answers: UserQuestionAnswer[] = questions.map((q, qi) => {
      const picks = [...(selected[qi] || [])];
      const free = (custom[qi] || "").trim();
      if (free && !picks.includes(free)) picks.push(free);
      return { header: q.header, question: q.question, answers: picks };
    });
    onAnswer(id, answers);
  };

  const anyAnswered = questions.some(
    (_, qi) => (selected[qi]?.size || 0) > 0 || (custom[qi] || "").trim(),
  );

  return (
    <div className="ask-dialog">
      <div className="ask-title">Spyro Studio wants to know</div>
      {questions.map((q, qi) => (
        <div key={qi} className="ask-q">
          <div className="ask-q-text">{q.question}</div>
          {q.options && q.options.length > 0 && (
            <div className={`ask-options${q.multiple ? " multi" : ""}`}>
              {q.options.map((o) => {
                const active = selected[qi]?.has(o.label);
                return (
                  <button
                    key={o.label}
                    className={`ask-option${active ? " active" : ""}`}
                    onClick={() => toggle(qi, o.label)}
                  >
                    <span className="ask-option-label">{o.label}</span>
                    {o.description && (
                      <span className="ask-option-desc">{o.description}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <input
            className="ask-custom"
            placeholder="Or type your own answer…"
            value={custom[qi] || ""}
            onChange={(e) =>
              setCustom((prev) => ({ ...prev, [qi]: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
      ))}
      <div className="ask-actions">
        <button className="btn-send" onClick={submit} disabled={!anyAnswered}>
          Submit
        </button>
      </div>
    </div>
  );
}
