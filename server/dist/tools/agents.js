import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
/**
 * AGENTS.md — Project context file that gives the AI domain-specific knowledge.
 * Auto-read on startup, auto-created for known project types (Expo, etc.).
 */
const AGENTS_FILENAME = "AGENTS.md";
const SETTINGS_DIR = ".claude";
const SETTINGS_FILE = "settings.json";
export function readAgentsMd(cwd) {
    const path = join(cwd, AGENTS_FILENAME);
    if (!existsSync(path))
        return null;
    try {
        return readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
}
function readSettings(cwd) {
    const path = join(cwd, SETTINGS_DIR, SETTINGS_FILE);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
function detectProjectType(cwd) {
    const pkg = join(cwd, "package.json");
    if (existsSync(pkg)) {
        try {
            const j = JSON.parse(readFileSync(pkg, "utf8"));
            const deps = { ...j.dependencies, ...j.devDependencies };
            if (deps.expo)
                return "expo";
            if (deps["react-native"])
                return "react-native";
            if (deps.next || deps.react || deps.vue || deps.svelte)
                return "web";
            if (deps.express || deps.fastify || deps.koa || deps.hono)
                return "node";
        }
        catch { }
    }
    if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt")))
        return "python";
    if (existsSync(join(cwd, "Cargo.toml")))
        return "rust";
    if (existsSync(join(cwd, "go.mod")))
        return "go";
    return "unknown";
}
const expoAgentsMd = `# AGENTS.md — Expo Project Context

This project uses **Expo SDK** (React Native). Follow Expo conventions.

## Key Files
- \`app.json\` / \`app.config.js\` — App configuration (name, icons, plugins, etc.)
- \`package.json\` — Dependencies and scripts
- \`tsconfig.json\` — TypeScript config (Expo extends @tsconfig/expo)
- \`.expo/\` — Local dev server cache (gitignored)

## Development
- Start dev server: \`npx expo start\` (or \`expo_start\` tool)
- Tunnel for phone testing: \`npx expo start --tunnel\`
- Clear cache: \`npx expo start --clear\`
- Install packages: \`npx expo install <pkg>\` (ensures version compatibility)
- Doctor: \`npx expo-doctor\`

## Project Structure (Expo Router v3+)
\`\`\`
app/
  _layout.tsx      # Root layout
  index.tsx        # Home screen
  (tabs)/          # Tab navigator group
    _layout.tsx
    index.tsx
    settings.tsx
  +not-found.tsx   # 404 screen
components/        # Shared UI components
hooks/             # Custom hooks
constants/         # Colors, spacing, etc.
assets/            # Images, fonts
\`\`\`

## Navigation (Expo Router)
- File-based routing in \`app/\`
- Use \`useRouter()\` from \`expo-router\`
- Links: \`<Link href="/screen">\`
- Dynamic routes: \`app/[id].tsx\`

## Native & Config Plugins
- Modify native config via \`app.json\` plugins array
- Config plugins (with-eas-build, expo-font, etc.) run at prebuild
- \`npx expo prebuild\` generates \`ios/\` and \`android/\`

## Styling
- React Native StyleSheet (subset of CSS)
- Flexbox layout (Yoga)
- Expo supports: \`expo-linear-gradient\`, \`react-native-reanimated\`, \`nativewind\` (Tailwind)

## Testing on Device
1. \`expo_start --tunnel\` → scan QR with Expo Go
2. Or \`npx expo install expo-dev-client\` → development build

## Build & Deploy (EAS)
- \`eas build --platform ios|android|all --profile preview|production\`
- \`eas submit\` for App Store / Play Store
- Credentials managed via \`eas credentials\`

## Common Pitfalls
- ❌ Don't edit \`ios/\` or \`android/\` directly — use config plugins
- ❌ Don't use \`npm install\` for native deps — use \`expo install\`
- ❌ Don't assume web APIs exist — check \`Platform.OS\`
- ✅ Use \`expo-doctor\` before builds
- ✅ Test on real device (Expo Go or dev client)
`;
const reactNativeAgentsMd = `# AGENTS.md — React Native Project Context

This is a **React Native** project (bare or Expo). Follow RN conventions.

## Development
- Metro bundler: \`npx react-native start\`
- iOS: \`npx react-native run-ios\`
- Android: \`npx react-native run-android\`
- Clear cache: \`npx react-native start --reset-cache\`

## Project Structure
\`\`\`
src/
  components/
  screens/
  navigation/
  hooks/
  utils/
android/           # Native Android (gradle)
ios/               # Native iOS (Xcode)
\`\`\`

## Native Modules
- Android: \`android/app/src/main/java/.../MainApplication.kt\`
- iOS: \`ios/ProjectName/AppDelegate.mm\`
- Linking: \`npx react-native link\` (auto in 0.60+)

## Testing
- Jest + React Native Testing Library
- Detox for e2e
`;
const webAgentsMd = `# AGENTS.md — Web Project Context

This is a **web application** project.

## Common Stacks
- Next.js (App Router) — \`app/\`, \`components/\`, \`lib/\`
- React + Vite — \`src/\`, \`public/\`
- Vue/Nuxt — \`src/\`, \`pages/\`
- Svelte/SvelteKit — \`src/\`, \`routes/\`

## Development
- Dev server: \`npm run dev\`
- Build: \`npm run build\`
- Preview: \`npm run preview\`
- Lint: \`npm run lint\`
- Typecheck: \`npm run typecheck\`

## Deployment
- Vercel (Next.js), Netlify, Cloudflare Pages
- Static export: \`output: "export"\` (Next.js)
`;
const nodeAgentsMd = `# AGENTS.md — Node.js Project Context

This is a **Node.js** backend/service project.

## Structure
\`\`\`
src/
  routes/      # API routes
  services/    # Business logic
  models/      # Data models (Prisma, Drizzle, etc.)
  middleware/
  utils/
tests/
\`\`\`

## Common Tools
- TypeScript + tsx / ts-node-dev
- Fastify / Express / Hono / Elysia
- Prisma / Drizzle / Kysely (DB)
- Zod (validation)
- Vitest / Jest (testing)
`;
function generateAgentsMd(projectType) {
    switch (projectType) {
        case "expo": return expoAgentsMd;
        case "react-native": return reactNativeAgentsMd;
        case "web": return webAgentsMd;
        case "node": return nodeAgentsMd;
        default: return "";
    }
}
export async function ensureAgentsMd(cwd) {
    const existing = readAgentsMd(cwd);
    if (existing)
        return existing;
    const projectType = detectProjectType(cwd);
    if (projectType === "unknown")
        return null;
    const content = generateAgentsMd(projectType);
    if (!content)
        return null;
    const path = join(cwd, AGENTS_FILENAME);
    try {
        writeFileSync(path, content, "utf8");
        return content;
    }
    catch {
        return null;
    }
}
export async function ensureSettings(cwd) {
    const settingsDir = join(cwd, SETTINGS_DIR);
    const settingsPath = join(settingsDir, SETTINGS_FILE);
    if (existsSync(settingsPath)) {
        try {
            return JSON.parse(readFileSync(settingsPath, "utf8"));
        }
        catch {
            return null;
        }
    }
    const projectType = detectProjectType(cwd);
    const settings = {
        enabledPlugins: [],
        projectType,
    };
    try {
        mkdirSync(settingsDir, { recursive: true });
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
        return settings;
    }
    catch {
        return null;
    }
}
export function getProjectContext(cwd) {
    const agentsMd = readAgentsMd(cwd);
    const settings = readSettings(cwd);
    const projectType = settings?.projectType || detectProjectType(cwd);
    return { agentsMd, settings, projectType };
}
export const agentsTool = {
    name: "agents",
    description: "Read or manage the project's AGENTS.md context file. This file teaches the AI project-specific conventions, stack details, and workflows.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["read", "write", "regenerate", "settings_read", "settings_write"],
                description: "What to do",
            },
            content: { type: "string", description: "Content for write action" },
            settings: { type: "object", description: "Settings object for settings_write" },
        },
        required: ["action"],
    },
    async execute(args, ctx) {
        const cwd = ctx.cwd;
        switch (args.action) {
            case "read": {
                const existing = readAgentsMd(cwd);
                if (existing)
                    return existing;
                const generated = await ensureAgentsMd(cwd);
                return generated || "No AGENTS.md found and could not auto-generate (unknown project type).";
            }
            case "write": {
                if (!args.content)
                    return "Error: content required for write";
                const path = join(cwd, AGENTS_FILENAME);
                writeFileSync(path, args.content, "utf8");
                return `AGENTS.md written to ${path}`;
            }
            case "regenerate": {
                const projectType = detectProjectType(cwd);
                if (projectType === "unknown")
                    return "Cannot regenerate: unknown project type";
                const content = generateAgentsMd(projectType);
                const path = join(cwd, AGENTS_FILENAME);
                writeFileSync(path, content, "utf8");
                return `AGENTS.md regenerated for ${projectType} project`;
            }
            case "settings_read": {
                const settings = readSettings(cwd);
                return settings ? JSON.stringify(settings, null, 2) : "No .claude/settings.json found";
            }
            case "settings_write": {
                if (!args.settings)
                    return "Error: settings object required";
                const settingsDir = join(cwd, SETTINGS_DIR);
                const settingsPath = join(settingsDir, SETTINGS_FILE);
                mkdirSync(settingsDir, { recursive: true });
                writeFileSync(settingsPath, JSON.stringify(args.settings, null, 2), "utf8");
                return `.claude/settings.json updated`;
            }
            default:
                return `Unknown action: ${args.action}`;
        }
    },
};
