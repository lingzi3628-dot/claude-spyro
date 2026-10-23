import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, } from "node:path";
import { Buffer } from "node:buffer";
/**
 * Free image generation.
 *
 * Pollinations needs no API key and no account — it is the only option that
 * works out of the box for a "free, no sign-up" agent. It exposes an
 * OpenAI-compatible text API too (below) if a key is ever wanted.
 */
const DEFAULT_MODEL = "flux";
/** Aspect presets so the model doesn't have to think in pixels. */
const ASPECTS = {
    square: [1024, 1024],
    landscape: [1216, 832],
    portrait: [832, 1216],
    wide: [1536, 640],
    tall: [640, 1536],
};
function slug(s) {
    return (s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "image");
}
export const generateImageTool = {
    name: "generate_image",
    description: "Generate an image from a text description and save it into the project. Works with no API key " +
        "and no account. Use it for illustrations, hero art, icons, diagrams, backgrounds or any " +
        "picture a project needs. Returns the saved file path so you can reference it.\n" +
        "For a QR code set kind='qr' and put the text or URL in prompt: those are drawn exactly and " +
        "always scan. NEVER ask for a QR code here without kind='qr' — a painted one will not scan.",
    parameters: {
        type: "object",
        properties: {
            prompt: {
                type: "string",
                description: "What to draw. Be specific and visual: subject, style, colours, lighting, mood. " +
                    '"a friendly fox logo, flat vector, orange and cream, on a transparent background" ' +
                    'works far better than "a fox".',
            },
            aspect: {
                type: "string",
                description: "square | landscape | portrait | wide | tall (default square). Use landscape for hero " +
                    "banners and square for icons or cards.",
            },
            width: { type: "number", description: "Exact width in pixels. Overrides aspect." },
            height: { type: "number", description: "Exact height in pixels. Overrides aspect." },
            model: {
                type: "string",
                description: "flux (default) | turbo (fast, simpler) | kontext (follows an input image)",
            },
            seed: { type: "number", description: "Same seed + same prompt = same image." },
            kind: {
                type: "string",
                description: "'image' (default) draws the prompt. 'qr' encodes the prompt as a QR code that actually " +
                    "scans — required for anything a phone camera has to read.",
            },
            filename: {
                type: "string",
                description: "Optional output filename (without extension).",
            },
        },
        required: ["prompt"],
    },
    requiresApproval: false,
    async execute(args, ctx) {
        const prompt = String(args.prompt || "").trim();
        if (!prompt)
            return "Error: prompt is required.";
        const kind = String(args.kind || "image").toLowerCase();
        if (kind === "qr" || kind === "qrcode" || kind === "barcode") {
            return makeQr(prompt, ctx?.cwd || process.cwd(), args);
        }
        const cwd = ctx?.cwd || process.cwd();
        const aspect = String(args.aspect || "square").toLowerCase();
        const [aw, ah] = ASPECTS[aspect] || ASPECTS.square;
        const width = Math.min(2048, Math.max(64, Number(args.width) || aw));
        const height = Math.min(2048, Math.max(64, Number(args.height) || ah));
        const model = String(args.model || DEFAULT_MODEL).replace(/[^a-z0-9-]/gi, "");
        const dir = join(cwd, "assets", "generated");
        try {
            mkdirSync(dir, { recursive: true });
        }
        catch (err) {
            return `Error: could not create ${dir} — ${err?.message || String(err)}`;
        }
        const base = slug(args.filename ? String(args.filename) : prompt);
        let file = join(dir, `${base}.jpg`);
        // Never clobber an existing asset.
        let n = 1;
        while (existsSync(file) && n < 100)
            file = join(dir, `${base}-${n++}.jpg`);
        const params = new URLSearchParams({
            width: String(width),
            height: String(height),
            model,
            nologo: "true",
            // Don't let generated images show up in public search results.
            private: "true",
            safe: "true",
        });
        if (args.seed !== undefined && args.seed !== null)
            params.set("seed", String(args.seed));
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
        try {
            const res = await fetch(url, {
                headers: { "User-Agent": "Spyro Studio/0.1" },
                // Generous: free generation can queue.
                timeoutMs: 180_000,
            });
            if (!res.ok) {
                return `Error: image service returned HTTP ${res.status}. Try a different prompt or the "turbo" model.`;
            }
            const type = res.headers.get("content-type") || "";
            if (!type.startsWith("image/")) {
                const body = (await res.text()).slice(0, 300);
                return `Error: expected an image but got ${type}. ${body}`;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 256)
                return "Error: the image service returned an empty image.";
            writeFileSync(file, buf);
            const rel = file.startsWith(cwd) ? file.slice(cwd.length + 1) : file;
            return [
                `Image generated and saved.`,
                ``,
                `  path    ${rel}`,
                `  size    ${width}x${height}, ${(buf.length / 1024).toFixed(0)} KB`,
                `  model   ${model}`,
                ``,
                `To show it in a README or web page use:`,
                `  ![${prompt.slice(0, 60)}](${rel})`,
                ``,
                `To display it directly in the chat, write this line into your reply verbatim:`,
                `  ![${prompt.slice(0, 60)}](/preview/${rel.split("/").map(encodeURIComponent).join("/")})`,
            ].join("\n");
        }
        catch (err) {
            return `Error generating image: ${err?.message || String(err)}`;
        }
    },
};
/**
 * QR codes are drawn, not painted.
 *
 * A diffusion model produces something that looks like a QR code and cannot be
 * scanned by anything. Anything a phone camera has to read has to come from a
 * real encoder, so this path never touches the image service.
 */
async function makeQr(text, cwd, args) {
    const target = text.trim();
    if (!target)
        return "Error: the QR payload is empty.";
    const dir = join(cwd, "assets", "generated");
    try {
        mkdirSync(dir, { recursive: true });
    }
    catch (err) {
        return `Error: could not create ${dir} — ${err?.message || String(err)}`;
    }
    const base = slug(args.filename ? String(args.filename) : "qr-code");
    let file = join(dir, `${base}.png`);
    let n = 1;
    while (existsSync(file) && n < 100)
        file = join(dir, `${base}-${n++}.png`);
    try {
        const QR = (await import("qrcode")).default;
        await QR.toFile(file, target, {
            type: "png",
            width: Math.min(2048, Math.max(256, Number(args.width) || 1024)),
            margin: 2,
            errorCorrectionLevel: "M",
        });
    }
    catch (err) {
        return `Error: could not encode the QR code — ${err?.message || String(err)}`;
    }
    const rel = file.startsWith(cwd) ? file.slice(cwd.length + 1) : file;
    const url = `/preview/${rel.split("/").map(encodeURIComponent).join("/")}`;
    return (`QR code generated and saved.\n` +
        `File: ${file}\n` +
        `Encodes exactly: ${target}\n` +
        `This is a real, scannable QR code (drawn by a QR encoder, not an image model).\n\n` +
        `Write this line into your reply so the user can see and scan it:\n` +
        `  ![QR code for ${target.slice(0, 60)}](${url})`);
}
