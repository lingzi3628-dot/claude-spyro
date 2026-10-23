import { inflateSync } from "node:zlib";
/**
 * Minimal PDF text extraction.
 *
 * There is no PDF library in this project, so this walks the raw file, finds
 * content streams, inflates the FlateDecode ones (Node's zlib), and pulls text
 * out of the Tj/TJ text-showing operators. It handles ordinary text PDFs; it
 * does NOT decode embedded fonts with custom encodings, so scanned/image-only
 * PDFs and PDFs with exotic CID encodings will yield little or nothing.
 */
const MAX_BYTES = 25 * 1024 * 1024;
/** Decode PDF literal strings, handling escapes and octal codes. */
function decodeLiteral(s) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch !== "\\") {
            out += ch;
            continue;
        }
        const n = s[++i];
        switch (n) {
            case "n":
                out += "\n";
                break;
            case "r":
                out += "\r";
                break;
            case "t":
                out += "\t";
                break;
            case "b":
                out += "\b";
                break;
            case "f":
                out += "\f";
                break;
            case "(":
                out += "(";
                break;
            case ")":
                out += ")";
                break;
            case "\\":
                out += "\\";
                break;
            case "\n": break; // line continuation
            default: {
                if (/[0-7]/.test(n)) {
                    let oct = n;
                    while (oct.length < 3 && /[0-7]/.test(s[i + 1] || ""))
                        oct += s[++i];
                    out += String.fromCharCode(parseInt(oct, 8));
                }
                else {
                    out += n;
                }
            }
        }
    }
    return out;
}
/** Decode a PDF hex string <48656C6C6F>. */
function decodeHex(s) {
    const hex = s.replace(/[^0-9A-Fa-f]/g, "");
    let out = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
}
/** Pull show-text operands out of one decoded content stream. */
function extractFromContent(content) {
    const parts = [];
    // Match: (literal) Tj | <hex> Tj | [ (a) -20 (b) ] TJ | <hex> Tj
    const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTJ\b|\bTj\b|\bTd\b|\bTD\b|\bT\*\b|\bET\b/g;
    let pending = "";
    let lastWasNewline = true;
    const pushText = (t) => {
        if (!t)
            return;
        if (lastWasNewline && parts.length)
            parts.push("\n");
        parts.push(t);
        lastWasNewline = false;
    };
    const tokens = content.match(re) || [];
    let i = 0;
    while (i < tokens.length) {
        const tok = tokens[i];
        if (tok.startsWith("(") || tok.startsWith("<")) {
            pending += tok.startsWith("(") ? decodeLiteral(tok.slice(1, -1)) : decodeHex(tok.slice(1, -1));
            i++;
            // If the very next token is Tj/TJ, flush as a shown string.
            const nxt = tokens[i + 1];
            if (nxt === "Tj" || nxt === "TJ" || nxt === "'" || nxt === '"') {
                pushText(pending);
                pending = "";
                i += 2;
            }
            continue;
        }
        if (tok === "Tj" || tok === "TJ") {
            pushText(pending);
            pending = "";
            i++;
            continue;
        }
        if (tok === "Td" || tok === "TD" || tok === "T*" || tok === "ET") {
            if (pending)
                pushText(pending);
            pending = "";
            lastWasNewline = true;
            parts.push("\n");
            i++;
            continue;
        }
        i++;
    }
    if (pending)
        pushText(pending);
    return parts.join("");
}
export function extractPdfText(buf) {
    let truncated = false;
    let data = buf;
    if (data.length > MAX_BYTES) {
        data = data.subarray(0, MAX_BYTES);
        truncated = true;
    }
    const raw = data.toString("latin1");
    const chunks = [];
    // Walk "N 0 obj ... << dict >> stream ... endstream" blocks.
    const streamRe = /stream\r?\n/g;
    let m;
    while ((m = streamRe.exec(raw)) !== null) {
        const start = m.index + m[0].length;
        const endIdx = raw.indexOf("endstream", start);
        if (endIdx === -1)
            continue;
        // Dictionary is the few hundred bytes before "stream".
        const dictStart = Math.max(0, m.index - 600);
        const dict = raw.slice(dictStart, m.index);
        let body = Buffer.from(raw.slice(start, endIdx), "latin1");
        if (/\/FlateDecode/.test(dict)) {
            try {
                body = inflateSync(body);
            }
            catch {
                continue; // not a decodable content stream
            }
        }
        else if (/\/Filter/.test(dict)) {
            continue; // DCT/JPX/etc. — image data, not text
        }
        const text = extractFromContent(body.toString("latin1"));
        if (text.trim())
            chunks.push(text);
        streamRe.lastIndex = endIdx;
    }
    const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const text = chunks.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { text, pages: pageCount || chunks.length, truncated };
}
