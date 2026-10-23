import { readFile } from "node:fs/promises";
import { extractPdfText } from "../infra/pdf.js";
import { safeResolve } from "./types.js";
export const readPdfTool = {
    name: "read_pdf",
    description: "Extract the text of a PDF file. Use this to read documentation, papers, reports, or specs the user " +
        "points you at. Scanned/image-only PDFs contain no extractable text and will return a note saying so.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Path to the .pdf file." },
            max_chars: { type: "number", description: "Truncate the output. Default 60000." },
        },
        required: ["path"],
    },
    async execute(args, ctx) {
        const abs = safeResolve(ctx.cwd, String(args.path || ""));
        if (!/\.pdf$/i.test(abs))
            return `Error: ${args.path} is not a .pdf file.`;
        let buf;
        try {
            buf = await readFile(abs);
        }
        catch (err) {
            return `Error reading PDF: ${err?.message || String(err)}`;
        }
        const { text, pages, truncated } = extractPdfText(buf);
        if (!text) {
            return (`No extractable text in ${abs} (${pages} page(s)). ` +
                `It is likely a scanned document or uses an embedded font encoding this reader does not handle.`);
        }
        const limit = Number(args.max_chars) || 60000;
        const clipped = text.length > limit;
        return (`# ${abs} — ${pages} page(s)${truncated ? " (file truncated at 25MB)" : ""}\n\n` +
            (clipped ? text.slice(0, limit) + "\n\n… [truncated]" : text));
    },
};
