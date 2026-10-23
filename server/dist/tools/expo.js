import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
/**
 * React Native / Expo Go tools.
 * Handles: starting Expo dev server, QR codes for Expo Go, tunnels, simulators, builds.
 */
const expoProcesses = new Map();
async function runInDir(cwd, cmd, args, timeoutMs = 120000) {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => stdout += d.toString());
        child.stderr.on("data", (d) => stderr += d.toString());
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve({ stdout, stderr, code: -1 });
        }, timeoutMs);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code: code ?? 0 });
        });
    });
}
function detectExpoProject(dir) {
    const pkg = join(dir, "package.json");
    if (!existsSync(pkg))
        return false;
    try {
        const j = JSON.parse(readFileSync(pkg, "utf8"));
        return !!(j.dependencies?.expo || j.devDependencies?.expo || j.expo);
    }
    catch {
        return false;
    }
}
function detectReactNativeProject(dir) {
    const pkg = join(dir, "package.json");
    if (!existsSync(pkg))
        return false;
    try {
        const j = JSON.parse(readFileSync(pkg, "utf8"));
        return !!(j.dependencies?.["react-native"] || j.devDependencies?.["react-native"]);
    }
    catch {
        return false;
    }
}
export const expoStartTool = {
    name: "expo_start",
    description: "Start an Expo development server. Returns the QR code URL and server URL for Expo Go. Use tunnel: true for external access.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Project directory (default: cwd)" },
            tunnel: { type: "boolean", description: "Use ngrok tunnel for external access (Expo Go on phone)" },
            port: { type: "number", description: "Port to run on (default: 8081)" },
            clear: { type: "boolean", description: "Clear cache on start" },
            background: { type: "boolean", description: "Run in background (default: true)" },
        },
        required: [],
    },
    async execute(args, ctx) {
        const projectDir = args.path ? resolve(ctx.cwd, args.path) : ctx.cwd;
        if (!detectExpoProject(projectDir) && !detectReactNativeProject(projectDir)) {
            return `Error: ${projectDir} does not appear to be an Expo/React Native project. Run expo_init first or cd to an existing project.`;
        }
        const port = args.port ?? 8081;
        if (args.background !== false) {
            const projectDir = args.path ? resolve(ctx.cwd, args.path) : ctx.cwd;
            const id = `expo_${Date.now()}`;
            const child = spawn("npx", ["expo", "start", ...(args.clear ? ["--clear"] : []), ...(args.tunnel ? ["--tunnel"] : []), "--port", String(port)], {
                cwd: projectDir,
                env: { ...process.env, PYTHONUNBUFFERED: "1" },
                detached: true,
                stdio: "ignore",
            });
            child.unref();
            expoProcesses.set(id, child);
            return `Started Expo dev server (PID ${child.pid}) on port ${port}. Use expo_qr to get the QR code for Expo Go.`;
        }
        else {
            const result = await runInDir(projectDir, "npx", ["expo", "start", ...(args.clear ? ["--clear"] : []), ...(args.tunnel ? ["--tunnel"] : []), "--port", String(port)], 5000);
            return `Expo output:\n${result.stdout}\n${result.stderr}`;
        }
    },
};
export const expoQrTool = {
    name: "expo_qr",
    description: "Get the QR code for Expo Go. Generates a QR code image and returns the URL to scan with the Expo Go app.",
    parameters: {
        type: "object",
        properties: {
            url: { type: "string", description: "Expo dev server URL (e.g., exp://192.168.1.5:8081)" },
            savePath: { type: "string", description: "Where to save the QR code PNG" },
        },
        required: ["url"],
    },
    async execute(args, ctx) {
        const QR = (await import("qrcode")).default;
        const savePath = args.savePath ? resolve(ctx.cwd, args.savePath) : join(ctx.cwd, "assets", "generated", `expo-qr-${Date.now()}.png`);
        const dir = join(savePath, "..");
        mkdirSync(dir, { recursive: true });
        await QR.toFile(savePath, args.url, {
            type: "png",
            width: 512,
            margin: 2,
            errorCorrectionLevel: "M",
        });
        const rel = savePath.startsWith(ctx.cwd) ? savePath.slice(ctx.cwd.length + 1) : savePath;
        return `QR code saved to ${rel}\nScan with Expo Go app: ${args.url}\nPreview: /preview/${rel.split("/").map(encodeURIComponent).join("/")}`;
    },
};
export const expoInitTool = {
    name: "expo_init",
    description: "Create a new Expo project with a template. Templates: blank, tabs, blank-typescript, tabs-typescript.",
    parameters: {
        type: "object",
        properties: {
            name: { type: "string", description: "Project name/folder" },
            template: { type: "string", enum: ["blank", "tabs", "blank-typescript", "tabs-typescript"], description: "Expo template" },
            path: { type: "string", description: "Parent directory (default: cwd)" },
        },
        required: ["name"],
    },
    async execute(args, ctx) {
        const parentDir = args.path ? resolve(ctx.cwd, args.path) : ctx.cwd;
        const projectDir = join(parentDir, args.name);
        const result = await runInDir(parentDir, "npx", ["create-expo-app@latest", args.name, "--template", args.template || "blank"], 180000);
        if (result.code !== 0) {
            return `Error creating Expo project:\n${result.stderr}`;
        }
        return `Created Expo project at ${projectDir}\n${result.stdout}\n\nNext: cd ${projectDir} && expo_start`;
    },
};
export const expoBuildTool = {
    name: "expo_build",
    description: "Build the Expo app for production (EAS Build). Requires EAS CLI and login.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Project directory" },
            platform: { type: "string", enum: ["android", "ios", "all"], description: "Build platform" },
            profile: { type: "string", description: "Build profile (preview, production, development)" },
        },
        required: ["path"],
    },
    async execute(args, ctx) {
        const projectDir = resolve(ctx.cwd, args.path);
        const platform = args.platform || "all";
        const profile = args.profile || "preview";
        const result = await runInDir(projectDir, "npx", ["eas", "build", "--platform", platform, "--profile", profile, "--non-interactive"], 600000);
        return `EAS Build (${platform}, ${profile}):\n${result.stdout}\n${result.stderr}`;
    },
};
export const expoDoctorTool = {
    name: "expo_doctor",
    description: "Run expo-doctor to diagnose project issues.",
    parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: [],
    },
    async execute(args, ctx) {
        const projectDir = args.path ? resolve(ctx.cwd, args.path) : ctx.cwd;
        const result = await runInDir(projectDir, "npx", ["expo-doctor@latest"], 60000);
        return `expo-doctor:\n${result.stdout}\n${result.stderr}`;
    },
};
export const expoInstallTool = {
    name: "expo_install",
    description: "Install packages with expo install (ensures version compatibility).",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Project directory" },
            packages: { type: "array", items: { type: "string" }, description: "Packages to install" },
        },
        required: ["packages"],
    },
    async execute(args, ctx) {
        const projectDir = args.path ? resolve(ctx.cwd, args.path) : ctx.cwd;
        const result = await runInDir(projectDir, "npx", ["expo", "install", ...args.packages], 120000);
        return `expo install ${args.packages.join(" ")}:\n${result.stdout}\n${result.stderr}`;
    },
};
export const expoStopTool = {
    name: "expo_stop",
    description: "Stop all Expo dev servers started by this session.",
    parameters: { type: "object", properties: {} },
    async execute(_args, _ctx) {
        let count = 0;
        for (const [_id, proc] of expoProcesses) {
            try {
                proc.kill("SIGTERM");
                count++;
            }
            catch { }
        }
        expoProcesses.clear();
        return `Stopped ${count} Expo process(es).`;
    },
};
