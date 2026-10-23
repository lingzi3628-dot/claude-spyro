import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const mobilePreviewTool = {
    name: "mobile_preview",
    description: "Mobile app preview: generate QR codes for Expo Go, detect connected devices, " +
        "and provide device frame previews. Works with Expo and React Native projects.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["qr", "devices", "frame", "tunnel", "status"],
                description: "What to do",
            },
            url: { type: "string", description: "Expo dev server URL (exp://...)" },
            platform: { type: "string", enum: ["ios", "android", "both"], description: "Target platform" },
        },
        required: ["action"],
    },
    async execute(args, _ctx) {
        const cwd = _ctx.cwd;
        const action = String(args.action || "status");
        switch (action) {
            case "qr": {
                if (!args.url)
                    return "Error: url required (exp://...)";
                const QR = (await import("qrcode")).default;
                const dir = join(cwd, "assets", "generated");
                mkdirSync(dir, { recursive: true });
                const path = join(dir, `mobile-qr-${Date.now()}.png`);
                await QR.toFile(path, args.url, { type: "png", width: 512, margin: 2, errorCorrectionLevel: "M" });
                const rel = path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
                return `QR code for Expo Go:\n  URL: ${args.url}\n  Image: /preview/${rel.split("/").map(encodeURIComponent).join("/")}\n\nScan with Expo Go app on your phone.`;
            }
            case "devices": {
                // Check for connected devices
                const devices = [];
                // Android
                try {
                    const r = await exec("adb", ["devices"]);
                    const lines = r.stdout.split("\n").slice(1).filter((l) => l.trim() && !l.includes("offline"));
                    if (lines.length)
                        devices.push(`Android: ${lines.length} device(s)`);
                }
                catch { }
                // iOS (macOS only)
                if (process.platform === "darwin") {
                    try {
                        const r = await exec("xcrun", ["simctl", "list", "devices", "available"]);
                        const booted = r.stdout.split("\n").filter((l) => l.includes("Booted"));
                        if (booted.length)
                            devices.push(`iOS Simulator: ${booted.length} booted`);
                    }
                    catch { }
                }
                return devices.length ? devices.join("\n") : "No devices detected. Connect a device or start a simulator.";
            }
            case "frame": {
                const platform = args.platform || "both";
                const frames = [];
                if (platform === "ios" || platform === "both") {
                    frames.push(`iOS frame: 390x844 (iPhone 14)`);
                }
                if (platform === "android" || platform === "both") {
                    frames.push(`Android frame: 412x915 (Pixel 7)`);
                }
                return `Device frames:\n${frames.join("\n")}\n\nUse these dimensions for responsive preview.`;
            }
            case "tunnel": {
                // Start Expo with tunnel
                return "Use expo_start with tunnel=true, then mobile_preview(action='qr', url=<returned_url>)";
            }
            case "status": {
                const lines = ["Mobile Preview Status:"];
                // Check Expo
                try {
                    const r = await exec("npx", ["expo", "--version"]);
                    lines.push(`  Expo CLI: ${r.stdout.trim()}`);
                }
                catch {
                    lines.push("  Expo CLI: not installed");
                }
                // Check adb
                try {
                    await exec("adb", ["version"]);
                    lines.push("  ADB: available");
                }
                catch {
                    lines.push("  ADB: not available");
                }
                // Check xcrun (macOS)
                if (process.platform === "darwin") {
                    try {
                        await exec("xcrun", ["simctl", "help"]);
                        lines.push("  iOS Simulator: available");
                    }
                    catch {
                        lines.push("  iOS Simulator: not available");
                    }
                }
                return lines.join("\n");
            }
            default:
                return `Unknown action: ${action}`;
        }
    },
};
