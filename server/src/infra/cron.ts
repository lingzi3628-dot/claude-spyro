import { randomUUID } from "node:crypto";

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  createdAt: number;
  nextRun: number;
  runCount: number;
}

interface Field {
  min: number;
  max: number;
}

function expandField(field: string, { min, max }: Field): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = /^(\*|\d+(?:-\d+)?)\/(\d+)$/.exec(part);
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    const base = stepMatch ? stepMatch[1] : part;
    let lo: number;
    let hi: number;
    if (base === "*") {
      lo = min;
      hi = max;
    } else if (base.includes("-")) {
      const [a, b] = base.split("-").map(Number);
      lo = a;
      hi = b;
    } else {
      const n = Number(base);
      if (!Number.isInteger(n)) return null;
      lo = n;
      hi = n;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** True if the given date matches a standard 5-field cron expression. */
export function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const specs: Field[] = [
    { min: 0, max: 59 }, // minute
    { min: 0, max: 23 }, // hour
    { min: 1, max: 31 }, // day of month
    { min: 0, max: 11 }, // month (0-11)
    { min: 0, max: 6 }, // day of week (0=Sunday)
  ];
  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth(),
    date.getDay(),
  ];
  for (let i = 0; i < 5; i++) {
    const set = expandField(fields[i], specs[i]);
    if (!set) return false;
    if (!set.has(values[i])) return false;
  }
  return true;
}

/** Turn "every 30s" / "every 5m" / "@hourly" into { everyMs } or null. */
function parseInterval(expr: string): number | null {
  const m = /^every\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)$/i.exec(expr.trim());
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase()[0];
    const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
    return n * mult;
  }
  const named: Record<string, number> = {
    "@hourly": 3_600_000,
    "@daily": 86_400_000,
    "@weekly": 7 * 86_400_000,
  };
  return named[expr.trim().toLowerCase()] ?? null;
}

function nextRunFor(schedule: string, from = Date.now()): number {
  const interval = parseInterval(schedule);
  if (interval) return from + interval;
  // Standard cron: scan minute by minute (bounded to ~366 days).
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 527_040; i++) {
    if (matchesCron(schedule, d)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * A small cron scheduler for recurring agent prompts. It wakes up just before
 * the next due job (clamped to 250ms–60s), fires callbacks whose scheduled time
 * has arrived, and reschedules.
 */
export class CronScheduler {
  private jobs = new Map<string, CronJob>();
  private timer: NodeJS.Timeout | null = null;
  private onFire: ((job: CronJob) => void) | null = null;
  private running = false;

  start(onFire: (job: CronJob) => void): void {
    this.onFire = onFire;
    this.running = true;
    this.reschedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Recompute the wake-up time (call after jobs are added/removed). */
  private reschedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const now = Date.now();
    let soonest = Number.POSITIVE_INFINITY;
    for (const job of this.jobs.values()) soonest = Math.min(soonest, job.nextRun);
    const delay = Number.isFinite(soonest)
      ? Math.min(Math.max(soonest - now, 250), 60_000)
      : 60_000;
    this.timer = setTimeout(() => {
      this.tick();
      this.reschedule();
    }, delay);
    // Do not keep the process alive just for the scheduler.
    this.timer.unref?.();
  }

  private tick(): void {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.nextRun <= now) {
        job.runCount++;
        job.nextRun = nextRunFor(job.schedule, now);
        try {
          this.onFire?.(job);
        } catch {
          // never let a listener break the scheduler
        }
      }
    }
  }

  create(schedule: string, prompt: string): CronJob | null {
    const probe = nextRunFor(schedule);
    if (!Number.isFinite(probe)) return null;
    const job: CronJob = {
      id: `cron_${randomUUID().slice(0, 8)}`,
      schedule: schedule.trim(),
      prompt,
      createdAt: Date.now(),
      nextRun: probe,
      runCount: 0,
    };
    this.jobs.set(job.id, job);
    this.reschedule();
    return { ...job };
  }

  list(): CronJob[] {
    return [...this.jobs.values()].map((j) => ({ ...j }));
  }

  delete(id: string): boolean {
    const ok = this.jobs.delete(id);
    if (ok) this.reschedule();
    return ok;
  }

  clear(): void {
    this.jobs.clear();
    this.reschedule();
  }
}
