import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID, scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

/**
 * Local accounts for Spyro Studio.
 *
 * Everything stays on this machine: the record is written to
 * `~/.claude-free/account.json` and never leaves it. Passwords are stored as
 * scrypt hashes with a per-user salt — the plaintext is never written anywhere,
 * and is not recoverable. This gates the app on first run; it is not a licence
 * check and it is not a substitute for a server if you ever add one.
 */
export interface Account {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
  onboarded: boolean;
  chosenMode?: "chat" | "ide" | "idea";
}

interface File extends Account {
  sessionToken?: string;
  sessionAt?: number;
}

const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

export class Accounts {
  private file: string;

  constructor(dir = join(homedir(), ".claude-free")) {
    this.file = resolve(dir, "account.json");
  }

  private read(): File | null {
    try {
      if (!existsSync(this.file)) return null;
      return JSON.parse(readFileSync(this.file, "utf8")) as File;
    } catch {
      return null;
    }
  }

  private write(data: File): void {
    mkdirSync(resolve(this.file, ".."), { recursive: true });
    // Owner-only: this file holds a password hash and a session token.
    writeFileSync(this.file, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* best effort on odd filesystems */
    }
  }

  static hash(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString("hex");
  }

  private static verify(password: string, salt: string, expected: string): boolean {
    const got = Buffer.from(Accounts.hash(password, salt), "hex");
    const want = Buffer.from(expected, "hex");
    if (got.length !== want.length) return false;
    return timingSafeEqual(got, want);
  }

  static validateName(name: string): string | null {
    const n = name.trim();
    if (n.length < 2) return "Please enter your name.";
    if (n.length > 60) return "That name is too long.";
    return null;
  }

  static validateEmail(email: string): string | null {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return "That does not look like an email address.";
    if (e.length > 120) return "That email is too long.";
    return null;
  }

  static validatePassword(password: string): string | null {
    if (password.length < 8) return "Use at least 8 characters.";
    if (password.length > 200) return "That password is too long.";
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return "Mix in at least one letter and one number.";
    }
    return null;
  }

  exists(): boolean {
    return this.read() !== null;
  }

  create(name: string, email: string, password: string): { ok: true; account: Omit<File, "passwordHash" | "salt"> } | { ok: false; error: string } {
    if (this.exists()) return { ok: false, error: "An account already exists on this device." };
    const n = Accounts.validateName(name);
    if (n) return { ok: false, error: n };
    const e = Accounts.validateEmail(email);
    if (e) return { ok: false, error: e };
    const p = Accounts.validatePassword(password);
    if (p) return { ok: false, error: p };

    const salt = randomBytes(16).toString("hex");
    const record: File = {
      id: randomUUID(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: Accounts.hash(password, salt),
      salt,
      createdAt: Date.now(),
      onboarded: false,
      sessionToken: randomBytes(32).toString("hex"),
      sessionAt: Date.now(),
    };
    this.write(record);
    return { ok: true, account: publicAccount(record) };
  }

  signIn(email: string, password: string): { ok: true; account: Omit<File, "passwordHash" | "salt"> } | { ok: false; error: string } {
    const rec = this.read();
    if (!rec) return { ok: false, error: "No account on this device yet." };
    if (rec.email !== email.trim().toLowerCase() || !Accounts.verify(password, rec.salt, rec.passwordHash)) {
      return { ok: false, error: "Email or password is incorrect." };
    }
    rec.sessionToken = randomBytes(32).toString("hex");
    rec.sessionAt = Date.now();
    this.write(rec);
    return { ok: true, account: publicAccount(rec) };
  }

  /** Re-establish a session from a stored token, for a returning user. */
  resume(token: string): Omit<File, "passwordHash" | "salt"> | null {
    const rec = this.read();
    if (!rec || !rec.sessionToken) return null;
    if (rec.sessionToken !== token) return null;
    if (Date.now() - (rec.sessionAt || 0) > SESSION_TTL) return null;
    return publicAccount(rec);
  }

  /** Change the password, requiring the current one. */
  changePassword(current: string, next: string): { ok: true } | { ok: false; error: string } {
    const rec = this.read();
    if (!rec) return { ok: false, error: "No account on this device yet." };
    if (!Accounts.verify(current, rec.salt, rec.passwordHash)) {
      return { ok: false, error: "Your current password is not correct." };
    }
    const invalid = Accounts.validatePassword(next);
    if (invalid) return { ok: false, error: invalid };
    if (current === next) return { ok: false, error: "Choose a different password." };

    const salt = randomBytes(16).toString("hex");
    rec.salt = salt;
    rec.passwordHash = Accounts.hash(next, salt);
    // A new password invalidates every existing session.
    rec.sessionToken = randomBytes(32).toString("hex");
    rec.sessionAt = Date.now();
    this.write(rec);
    return { ok: true };
  }

  setOnboarded(onboarded: boolean, chosenMode?: Account["chosenMode"]): void {
    const rec = this.read();
    if (!rec) return;
    rec.onboarded = onboarded;
    if (chosenMode) rec.chosenMode = chosenMode;
    this.write(rec);
  }

  get(): Omit<File, "passwordHash" | "salt"> | null {
    const rec = this.read();
    return rec ? publicAccount(rec) : null;
  }
}

/** Everything the client is allowed to see. Never the hash or the salt. */
function publicAccount(rec: File): Omit<File, "passwordHash" | "salt"> {
  const { passwordHash: _h, salt: _s, ...rest } = rec;
  return rest;
}

/** Stable id for a machine, used to bind sessions without storing anything else. */
export function machineId(): string {
  return createHash("sha256").update(homedir()).digest("hex").slice(0, 16);
}
