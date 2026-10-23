import { useCallback, useEffect, useState } from "react";

interface TableInfo {
  name: string;
  type: string;
  rows: number;
}
interface Column {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt: string | null;
}

const cell = (v: any) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/**
 * A database explorer for the open folder: pick a .db file, browse its tables,
 * and edit cells in place. Writes go through the same workspace guard as every
 * other tool, and schema-destroying SQL is refused server-side.
 */
export function DatabasePanel({ cwd }: { cwd: string }) {
  const [dbs, setDbs] = useState<string[]>([]);
  const [kind, setKind] = useState<"sqlite" | "sql">("sqlite");
  const [db, setDb] = useState("");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [table, setTable] = useState("");
  const [schema, setSchema] = useState<Column[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [rows, setRows] = useState<any[][]>([]);
  const [sql, setSql] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [draft, setDraft] = useState("");

  const find = useCallback(() => {
    fetch(`/api/db?action=find&root=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((j) => {
        setDbs(Array.isArray(j?.databases) ? j.databases : []);
        if (j?.databases?.length && !db) setDb(j.databases[0]);
      })
      .catch(() => setDbs([]));
  }, [cwd, db]);

  useEffect(find, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTables = useCallback(() => {
    if (!db) return;
    setErr("");
    fetch(`/api/db?action=tables&path=${encodeURIComponent(db)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.error) return setErr(j.error);
        setKind(j.kind === "sql" ? "sql" : "sqlite");
        setTables(j.tables || []);
        if (j.tables?.length && !table) setTable(j.tables[0].name);
      })
      .catch((e) => setErr(e.message));
  }, [db, table]);

  useEffect(loadTables, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  const browse = useCallback(
    (name: string) => {
      if (!db || !name) return;
      setErr("");
      const q =
        db.endsWith(".sql") || db.endsWith(".dump") || db.endsWith(".ddl")
          ? ""
          : `SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT 200`;
      if (!q) {
        setCols([]);
        setRows([]);
        return;
      }
      fetch(`/api/db?action=query&path=${encodeURIComponent(db)}&sql=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j) => {
          if (j?.error) return setErr(j.error);
          setCols(j.columns || []);
          setRows(j.rows || []);
        })
        .catch((e) => setErr(e.message));
      fetch(`/api/db?action=schema&path=${encodeURIComponent(db)}&table=${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .then((j) => setSchema(j.columns || []))
        .catch(() => setSchema([]));
    },
    [db],
  );

  useEffect(() => {
    if (table) browse(table);
  }, [table]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (r: number, c: number, value: string) => {
    const colInfo = schema[c];
    const pks = schema.filter((s) => s.pk);
    if (!pks.length) {
      // No primary key: fall back to rowid, which every SQLite table has.
      const st = await fetch(`/api/db?action=query&path=${encodeURIComponent(db)}&sql=${encodeURIComponent(`SELECT rowid FROM "${table.replace(/"/g, '""')}" LIMIT 200 OFFSET ${r}`)}`)
        .then((x) => x.json());
      const rid = st?.rows?.[0]?.[0];
      if (rid === undefined) return setErr("Could not identify that row.");
      const res = await fetch(`/api/db?action=update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: db, table, pk: { rowid: rid }, column: colInfo.name, value }),
      });
      const j = await res.json();
      if (j?.error) return setErr(j.error);
      const next = rows.slice();
      next[r][c] = value;
      setRows(next);
    } else {
      const pk: Record<string, any> = {};
      pks.forEach((p) => {
        pk[p.name] = rows[r][cols.indexOf(p.name)];
      });
      const res = await fetch(`/api/db?action=update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: db, table, pk, column: colInfo.name, value }),
      });
      const j = await res.json();
      if (j?.error) return setErr(j.error);
      const next = rows.slice();
      next[r][c] = value;
      setRows(next);
    }
    setErr("");
  };

  const runSql = async () => {
    if (!sql.trim()) return;
    setBusy(true);
    setErr("");
    fetch(`/api/db?action=query&path=${encodeURIComponent(db)}&sql=${encodeURIComponent(sql)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.error) return setErr(j.error);
        setCols(j.columns || []);
        setRows(j.rows || []);
        if (j.changes !== undefined) setErr(`${j.changes} row(s) changed.`);
        loadTables();
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  if (!dbs.length) {
    return (
      <div className="db-panel">
        <div className="db-head">Database</div>
        <div className="ide-empty">
          No database files found in this folder.
          <br />
          <small>.db, .sqlite, .sqlite3 — run <code>sqlite3 app.db</code> or open one from the agent.</small>
        </div>
        <button className="db-btn" onClick={find}>
          Scan again
        </button>
      </div>
    );
  }

  return (
    <div className="db-panel">
      <div className="db-head">Database</div>

      <select className="db-select" value={db} onChange={(e) => { setDb(e.target.value); setTable(""); }}>
        {dbs.map((d) => (
          <option key={d} value={d}>
            {d.split("/").pop()}
          </option>
        ))}
      </select>

      <div className="db-tables">
        {tables.map((t) => (
          <button
            key={t.name}
            className={`db-table${table === t.name ? " on" : ""}`}
            onClick={() => setTable(t.name)}
          >
            <span className="db-table-name">{t.name}</span>
            <span className="db-table-rows">{t.rows}</span>
          </button>
        ))}
        {tables.length === 0 && <div className="ide-empty">No tables.</div>}
      </div>

      {schema.length > 0 && (
        <div className="db-schema">
          {schema.map((c) => (
            <span key={c.name} className="db-col">
              {c.name}
              <i>{c.type}</i>
              {c.pk ? <b>pk</b> : null}
            </span>
          ))}
        </div>
      )}

      <div className="db-sql">
        <input
          value={sql}
          placeholder={`SELECT * FROM "${table}"`}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSql()}
          spellCheck={false}
        />
        <button className="db-btn" onClick={runSql} disabled={busy}>
          {busy ? "…" : "Run"}
        </button>
      </div>

      {err && <div className="db-msg">{err}</div>}

      <div className="db-grid-wrap">
        <table className="db-grid">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c}>
                  {c}
                  {schema[i]?.pk ? " 🔑" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((v, c) => (
                  <td
                    key={c}
                    className={v === null ? "null" : ""}
                    onDoubleClick={() => {
                      setEditing({ r, c });
                      setDraft(v === null ? "" : cell(v));
                    }}
                    title="Double-click to edit"
                  >
                    {editing?.r === r && editing?.c === c ? (
                      <input
                        className="db-cell-input"
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => { void save(r, c, draft); setEditing(null); }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      cell(v)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="ide-empty">No rows.</div>}
      </div>
      <div className="db-hint">
        {kind === "sql"
          ? "SQL dump — structure only. Run the file, or use the agent, to execute it."
          : "Double-click a cell to edit. Changes are written straight to the file."}
      </div>
    </div>
  );
}
