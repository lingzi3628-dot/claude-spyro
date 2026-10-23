import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);
/**
 * node:sqlite only exists on Node 22.5+. The desktop build ships Electron's
 * older runtime, so this is loaded lazily: a missing SQLite must disable the
 * database view, never take the whole server down at startup.
 */
let DatabaseSync = null;
let sqliteChecked = false;
function dbCtor() {
    if (!sqliteChecked) {
        sqliteChecked = true;
        try {
            DatabaseSync = nodeRequire("node:sqlite").DatabaseSync;
        }
        catch {
            DatabaseSync = null;
        }
    }
    if (!DatabaseSync) {
        throw new Error("SQLite is not available in this runtime (needs Node 22.5+). Use Spyro Studio on a system Node 22 or newer to browse databases.");
    }
    return DatabaseSync;
}
const DB_EXT = new Set([".db", ".sqlite", ".sqlite3", ".db3", ".sql", ".dump", ".ddl"]);
export function dbKind(path) {
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    return ext === ".sql" || ext === ".dump" || ext === ".ddl" ? "sql" : "sqlite";
}
export function isDatabaseFile(path) {
    const name = path.split("/").pop() || "";
    // Skip app-owned noise that merely looks like a database.
    if (/^(package|registry|manifest|metadata)\.json$/i.test(name))
        return false;
    return DB_EXT.has(path.slice(path.lastIndexOf(".")).toLowerCase());
}
/** Parse a .sql dump into its CREATE TABLE statements and row counts. */
export function readSqlDump(path) {
    const text = readFileSync(path, "utf8");
    const tables = [];
    const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([\w.]+)["'`]?\s*\(([\s\S]*?)\)\s*(?:;|$)/gi;
    let m;
    while ((m = createRe.exec(text)) !== null) {
        const body = m[2];
        const columns = [];
        let depth = 0;
        let current = "";
        for (const ch of body) {
            if (ch === "(")
                depth++;
            if (ch === ")")
                depth--;
            if (ch === "," && depth === 0) {
                columns.push(current.trim());
                current = "";
            }
            else {
                current += ch;
            }
        }
        if (current.trim())
            columns.push(current.trim());
        const name = m[1].split(".").pop() || m[1];
        // Count INSERT statements that target this table.
        const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const ins = new RegExp("INSERT\\s+INTO\\s+[\"'`]?" + safe + "[\"'`]?", "gi");
        tables.push({
            name,
            columns: columns
                .map((c) => c.split(/\s+/)[0].replace(/["'`]/g, ""))
                .filter(Boolean),
            statement: m[0].trim(),
            rows: (text.match(ins) || []).length,
        });
    }
    const statements = (text.match(/;\s*$/gm) || []).length || (text.split(";").length - 1);
    return { kind: "sql", tables, statements };
}
function open(path) {
    const Ctor = dbCtor();
    const abs = resolve(path);
    if (!existsSync(abs))
        throw new Error("No such database");
    // Read-write, so edits actually persist.
    return new Ctor(abs);
}
/** Tables and views, with a row count for each. */
export function listTables(path) {
    const db = open(path);
    try {
        const rows = db
            .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .all();
        const tables = rows.map((r) => {
            let count = 0;
            try {
                // Identifiers can't be parameterised; quote it safely instead.
                const q = `SELECT COUNT(*) AS n FROM "${r.name.replace(/"/g, '""')}"`;
                count = Number(db.prepare(q).get()?.n ?? 0);
            }
            catch {
                count = 0;
            }
            return { name: r.name, type: r.type, rows: count };
        });
        return { path: resolve(path), tables };
    }
    finally {
        db.close();
    }
}
export function tableSchema(path, table) {
    const db = open(path);
    try {
        const q = `PRAGMA table_info("${table.replace(/"/g, '""')}")`;
        const info = db.prepare(q).all();
        const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table);
        return {
            columns: info.map((c) => ({
                name: c.name,
                type: c.type || "",
                notnull: c.notnull ? 1 : 0,
                pk: c.pk ? 1 : 0,
                dflt: c.dflt_value ?? null,
            })),
            sql: ddl?.sql || "",
        };
    }
    finally {
        db.close();
    }
}
/**
 * Run SQL. Reads are unrestricted; writes are allowed but schema-destroying
 * statements are refused, because a stray click in a data grid should never be
 * able to drop a table.
 */
export function runQuery(path, sql, limit = 200) {
    const trimmed = sql.trim();
    const head = trimmed.split(/\s+/)[0]?.toUpperCase() || "";
    const blocked = ["DROP", "ALTER", "TRUNCATE", "ATTACH", "DETACH", "VACUUM", "REINDEX"];
    if (blocked.includes(head)) {
        throw new Error(`${head} is not allowed from the data editor.`);
    }
    const db = open(path);
    try {
        if (head === "SELECT" || head === "PRAGMA" || head === "WITH" || head === "EXPLAIN") {
            const stmt = db.prepare(trimmed);
            const rows = stmt.all();
            const columns = Object.keys(rows[0] || {});
            return { columns, rows: rows.slice(0, limit).map((r) => columns.map((c) => r[c])), truncated: rows.length > limit };
        }
        const info = db.prepare(trimmed).run();
        return { columns: [], rows: [], truncated: false, changes: Number(info.changes ?? 0) };
    }
    finally {
        db.close();
    }
}
/** Update one cell, addressed by its primary key (or rowid). */
export function updateCell(path, table, pk, column, value) {
    const db = open(path);
    try {
        const where = Object.keys(pk).map((k) => `"${k.replace(/"/g, '""')}" = ?`).join(" AND ");
        const sql = `UPDATE "${table.replace(/"/g, '""')}" SET "${column.replace(/"/g, '""')}" = ? WHERE ${where}`;
        const info = db.prepare(sql).run(value, ...Object.values(pk));
        return { changes: Number(info.changes ?? 0) };
    }
    finally {
        db.close();
    }
}
/** Describe any supported database file, whatever its format. */
export function describeDatabase(path) {
    if (dbKind(path) === "sql")
        return readSqlDump(path);
    const t = listTables(path);
    return { kind: "sqlite", tables: t.tables };
}
/** Find database files under a folder. */
export function findDatabases(root, depth = 5) {
    const out = [];
    const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "target"]);
    const walk = (dir, d) => {
        if (d > depth || out.length >= 50)
            return;
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (SKIP.has(e))
                continue;
            const p = resolve(dir, e);
            try {
                const st = statSync(p);
                if (st.isDirectory())
                    walk(p, d + 1);
                else if (isDatabaseFile(p))
                    out.push(p);
            }
            catch {
                /* ignore */
            }
        }
    };
    walk(resolve(root), 0);
    return out;
}
