import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, rmSync, } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
/** Marker for files we deliberately do not snapshot (binary or too large). */
const SKIP = "__skip__";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Read a file, returning null when missing/too large/binary. */
function readBlobCandidate(abs) {
    if (!existsSync(abs))
        return null;
    let st;
    try {
        st = statSync(abs);
    }
    catch {
        return null;
    }
    if (!st.isFile())
        return SKIP;
    if (st.size > MAX_FILE_BYTES)
        return SKIP;
    let buf;
    try {
        buf = readFileSync(abs);
    }
    catch {
        return SKIP;
    }
    // Treat binary files (null bytes) as un-snapshotable.
    if (buf.includes(0))
        return SKIP;
    return { data: buf };
}
function hash(buf) {
    return createHash("sha256").update(buf).digest("hex").slice(0, 32);
}
/**
 * Content-addressed file snapshots for checkpoint rewind.
 *
 * Files are stored once by content hash and shared across checkpoints, so many
 * checkpoints of the same file cost one copy. For each file the agent touches we
 * remember its pre-edit state; a checkpoint records the state at that moment.
 * Rewinding restores tracked files that appear in the checkpoint, and for files
 * first created *after* the checkpoint, it falls back to the pre-edit state —
 * which correctly removes newly created files too.
 */
export class FileSnapshotStore {
    blobsDir;
    tracked = new Set();
    pre = new Map();
    constructor(root = join(homedir(), ".claude-free", "snapshots")) {
        this.blobsDir = join(root, "blobs");
        this.ensure();
    }
    ensure() {
        try {
            if (!existsSync(this.blobsDir))
                mkdirSync(this.blobsDir, { recursive: true });
        }
        catch {
            // ignore
        }
    }
    blobPath(h) {
        return join(this.blobsDir, h);
    }
    /** Store content and return its hash (or SKIP/null). */
    store(abs) {
        const c = readBlobCandidate(abs);
        if (c === SKIP)
            return SKIP;
        if (c === null)
            return null;
        const h = hash(c.data);
        const bp = this.blobPath(h);
        if (!existsSync(bp)) {
            try {
                writeFileSync(bp, c.data);
            }
            catch {
                return SKIP;
            }
        }
        return h;
    }
    readBlob(h) {
        const bp = this.blobPath(h);
        try {
            return readFileSync(bp);
        }
        catch {
            return null;
        }
    }
    /** Called right before a mutating tool edits `abs`. Captures pre-edit state. */
    markEdit(abs) {
        if (this.tracked.has(abs))
            return;
        this.tracked.add(abs);
        this.pre.set(abs, this.store(abs));
    }
    /** Snapshot the current state of every tracked file (called at checkpoint time). */
    capture() {
        const m = {};
        for (const p of this.tracked) {
            if (this.pre.get(p) === SKIP)
                continue; // never snapshot un-snapshotable files
            m[p] = this.store(p);
        }
        return m;
    }
    /** Apply a single path/hash to disk. */
    apply(path, h, report) {
        if (h === SKIP) {
            report.skipped.push(path);
            return;
        }
        if (h === null) {
            // Did not exist at snapshot time → remove it now (undo a creation).
            if (existsSync(path)) {
                try {
                    unlinkSync(path);
                    report.deleted.push(path);
                }
                catch {
                    report.skipped.push(path);
                }
            }
            return;
        }
        const buf = this.readBlob(h);
        if (!buf) {
            report.skipped.push(path);
            return;
        }
        try {
            let same = false;
            if (existsSync(path)) {
                const cur = readBlobCandidate(path);
                if (cur !== SKIP && cur !== null && hash(cur.data) === h)
                    same = true;
            }
            if (!same) {
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, buf);
                if (existsSync(path))
                    report.restored.push(path);
                else
                    report.created.push(path);
            }
        }
        catch {
            report.skipped.push(path);
        }
    }
    /**
     * Restore the working tree to a checkpoint. Files in the manifest are set to
     * their snapshot state; tracked files absent from the manifest (created after
     * this checkpoint) fall back to their pre-edit state.
     */
    restore(manifest) {
        const report = { restored: [], created: [], deleted: [], skipped: [] };
        for (const [path, h] of Object.entries(manifest)) {
            this.apply(path, h, report);
        }
        // Undo files that were first created after this checkpoint.
        for (const p of this.tracked) {
            if (p in manifest)
                continue;
            const pre = this.pre.get(p);
            if (pre === undefined)
                continue;
            if (pre === SKIP) {
                report.skipped.push(p);
                continue;
            }
            this.apply(p, pre, report);
        }
        return report;
    }
    /** Best-effort GC: drop blobs not referenced by any live checkpoint manifest. */
    gc(liveHashes) {
        this.ensure();
        let entries;
        try {
            entries = readdirSync(this.blobsDir);
        }
        catch {
            return;
        }
        for (const f of entries) {
            if (!liveHashes.has(f)) {
                try {
                    rmSync(this.blobPath(f), { force: true });
                }
                catch {
                    // ignore
                }
            }
        }
    }
}
