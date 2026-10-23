import { useState } from "react";

/**
 * First screen a returning or brand-new user sees.
 *
 * Sets expectations honestly in one line: this is a local tool, free, and the
 * account is stored on this machine — not a signup that emails anyone.
 */
export function Welcome({ onContinue, onSignIn }: { onContinue: () => void; onSignIn: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome-bg" aria-hidden="true" />
      <div className="welcome-inner">
        <div className="welcome-brand">
          <span className="welcome-mark">🐉</span>
          <span className="welcome-brand-name">Spyro</span>
        </div>

        <h1 className="welcome-title">
          Welcome to <span className="grad">Spyro Studio</span>
        </h1>
        <p className="welcome-lede">
          A free coding studio for developers and researchers. Write code with an agent beside you, explore
          ideas, and keep everything on your own machine.
        </p>

        <ul className="welcome-points">
          <li>
            <b>Free</b> — bring your own provider key, or run a local model. No subscription.
          </li>
          <li>
            <b>Yours</b> — your code, your keys and your account never leave this computer.
          </li>
          <li>
            <b>Three ways in</b> — a chat, a full editor, and a builder for whole apps.
          </li>
        </ul>

        <div className="welcome-cta">
          <button className="btn-primary big" onClick={onContinue}>
            Create your account
          </button>
          <button className="btn-ghost" onClick={onSignIn}>
            I already have one
          </button>
        </div>

        <p className="welcome-fine">Takes about twenty seconds. No email is ever sent.</p>
      </div>
    </div>
  );
}

/** Create-account and sign-in, in one screen so the step count stays honest. */
export function AccountScreen({
  mode,
  onBack,
  onDone,
}: {
  mode: "create" | "signin";
  onBack: () => void;
  onDone: (account: any) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);

  const creating = mode === "create";
  const canSubmit = creating ? name.trim() && email.trim() && password : email.trim() && password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/account?action=${creating ? "create" : "signin"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const j = await r.json();
      if (j?.error) {
        setError(j.error);
      } else {
        onDone(j.account);
      }
    } catch {
      setError("Could not reach the local server. Is Spyro Studio still running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-bg" aria-hidden="true" />
      <div className="account-card">
        <button className="account-back" onClick={onBack}>
          ‹ Back
        </button>

        <h2 className="account-title">{creating ? "Create your account" : "Welcome back"}</h2>
        <p className="account-sub">
          {creating
            ? "Stored on this device only. Your password is hashed and never leaves your machine."
            : "Enter the details you set up on this device."}
        </p>

        <form onSubmit={submit}>
          {creating && (
            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                autoFocus
              />
            </label>
          )}

          <label className="field">
            <span>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <div className="field-pass">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={show ? "text" : "password"}
                placeholder={creating ? "At least 8 characters" : "••••••••"}
                autoComplete={creating ? "new-password" : "current-password"}
              />
              <button type="button" className="field-eye" onClick={() => setShow((v) => !v)} aria-label="Show password">
                {show ? "🙈" : "👁"}
              </button>
            </div>
            {creating && password.length > 0 && password.length < 8 && (
              <small className="field-hint">A few more characters needed.</small>
            )}
          </label>

          {error && <div className="account-error">{error}</div>}

          <button className="btn-primary big full" type="submit" disabled={!canSubmit || busy}>
            {busy ? "Just a moment…" : creating ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="account-privacy">
          🔒 No email is sent, nothing is uploaded, and you can delete the account file at any time from{" "}
          <code>~/.claude-free/account.json</code>.
        </p>
      </div>
    </div>
  );
}
