import { readFile, writeFile } from "node:fs/promises";
import { safeResolve, isProtected } from "./types.js";
function sourceToString(src) {
    return Array.isArray(src) ? src.join("") : src || "";
}
function stringToSource(s) {
    // Jupyter convention: each line keeps its trailing newline.
    const lines = s.split("\n");
    return lines.map((l, i) => (i < lines.length - 1 ? l + "\n" : l)).filter((l) => l !== "");
}
function formatCell(cell, idx) {
    const src = sourceToString(cell.source);
    let out = `# Cell [${idx}] (${cell.cell_type})\n${src}`;
    if (cell.cell_type === "code" && cell.outputs?.length) {
        const texts = [];
        for (const o of cell.outputs) {
            if (o.output_type === "stream")
                texts.push(sourceToString(o.text));
            else if (o.output_type === "execute_result" || o.output_type === "display_data") {
                if (o.data?.["text/plain"])
                    texts.push(sourceToString(o.data["text/plain"]));
            }
            else if (o.output_type === "error") {
                texts.push((o.ename || "Error") + ": " + (o.evalue || ""));
            }
        }
        const joined = texts.join("\n").trimEnd();
        if (joined)
            out += `\n-- output --\n${joined}`;
    }
    return out;
}
export const notebookReadTool = {
    name: "notebook_read",
    description: "Read a Jupyter notebook (.ipynb) and return its cells in order, each labelled with its index " +
        "and type (code/markdown), plus any stored outputs.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Path to the .ipynb file." },
        },
        required: ["path"],
    },
    async execute(args, ctx) {
        const abs = safeResolve(ctx.cwd, String(args.path));
        ctx.markEdit?.(abs);
        let nb;
        try {
            nb = JSON.parse(await readFile(abs, "utf8"));
        }
        catch (err) {
            return `Error reading notebook ${args.path}: ${err.message}`;
        }
        if (!Array.isArray(nb.cells))
            return `Error: ${args.path} is not a valid notebook (no cells).`;
        return nb.cells.map((c, i) => formatCell(c, i)).join("\n\n");
    },
};
export const notebookEditTool = {
    name: "notebook_edit",
    description: "Edit a Jupyter notebook (.ipynb). Modes: 'replace' (default) overwrites a cell's source, " +
        "'insert' adds a new cell at the given index, 'delete' removes a cell. Provide cell_type for " +
        "insert (code/markdown); cell_index is required for replace/delete/insert.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Path to the .ipynb file." },
            mode: {
                type: "string",
                enum: ["replace", "insert", "delete"],
                description: "Edit mode. Default 'replace'.",
            },
            cell_index: { type: "number", description: "Zero-based index of the target cell." },
            cell_type: {
                type: "string",
                enum: ["code", "markdown"],
                description: "Type for inserted cells. Default 'code'.",
            },
            source: {
                type: "string",
                description: "New cell source (for replace/insert).",
            },
        },
        required: ["path", "cell_index"],
    },
    requiresApproval: true,
    async execute(args, ctx) {
        const abs = safeResolve(ctx.cwd, String(args.path));
        if (isProtected(ctx, abs)) {
            return `Error: ${args.path} is inside Spyro Studio's own source and cannot be modified.`;
        }
        ctx.markEdit?.(abs);
        let nb;
        try {
            nb = JSON.parse(await readFile(abs, "utf8"));
        }
        catch (err) {
            return `Error reading notebook ${args.path}: ${err.message}`;
        }
        if (!Array.isArray(nb.cells))
            return `Error: ${args.path} is not a valid notebook.`;
        const mode = String(args.mode || "replace");
        const idx = Number(args.cell_index);
        if (!Number.isInteger(idx) || idx < 0)
            return "Error: cell_index must be a non-negative integer.";
        if (mode === "delete") {
            if (idx >= nb.cells.length)
                return `Error: cell_index ${idx} is out of range.`;
            nb.cells.splice(idx, 1);
        }
        else if (mode === "insert") {
            if (idx > nb.cells.length)
                return `Error: cell_index ${idx} is out of range for insert.`;
            const cellType = args.cell_type === "markdown" ? "markdown" : "code";
            const cell = {
                cell_type: cellType,
                source: stringToSource(String(args.source ?? "")),
                metadata: {},
                ...(cellType === "code" ? { outputs: [], execution_count: null } : {}),
            };
            nb.cells.splice(idx, 0, cell);
        }
        else {
            if (idx >= nb.cells.length)
                return `Error: cell_index ${idx} is out of range.`;
            nb.cells[idx].source = stringToSource(String(args.source ?? ""));
            if (nb.cells[idx].cell_type === "code") {
                nb.cells[idx].outputs = [];
                nb.cells[idx].execution_count = null;
            }
        }
        nb.nbformat = nb.nbformat ?? 4;
        nb.nbformat_minor = nb.nbformat_minor ?? 5;
        try {
            await writeFile(abs, JSON.stringify(nb, null, 1), "utf8");
        }
        catch (err) {
            return `Error writing ${args.path}: ${err.message}`;
        }
        return `Notebook ${args.path}: ${mode} at cell ${idx}. Now ${nb.cells.length} cells.`;
    },
};
