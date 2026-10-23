import { Tool, ToolContext } from "./types.js";
import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

/**
 * Smart Project Templates — pre-built scaffolds for common app types.
 * Each template creates a full project with AGENTS.md pre-configured,
 * so even a weak AI has the right context from the start.
 */

interface TemplateFile {
  path: string;
  content: string;
}

interface Template {
  name: string;
  description: string;
  category: "web" | "mobile" | "backend" | "cli" | "fullstack";
  markers: string[];
  files: TemplateFile[];
  installCmd?: string;
  devCmd?: string;
  agentsMd: string;
}

const TEMPLATES: Record<string, Template> = {
  "nextjs-dashboard": {
    name: "Next.js Dashboard",
    description: "Next.js 15 App Router with dark theme, Tailwind, and a dashboard layout",
    category: "web",
    markers: ["package.json", "next.config.js"],
    installCmd: "npm install",
    devCmd: "npm run dev",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "nextjs-dashboard",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "next lint",
          },
          dependencies: {
            next: "^15.0.0",
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            tailwindcss: "^3.4.0",
            autoprefixer: "^10.4.0",
            postcss: "^8.4.0",
            "lucide-react": "^0.400.0",
          },
          devDependencies: {
            typescript: "^5.5.0",
            "@types/node": "^22.0.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            eslint: "^9.0.0",
            "eslint-config-next": "^15.0.0",
          },
        }, null, 2),
      },
      {
        path: "next.config.js",
        content: `/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
module.exports = nextConfig;
`,
      },
      {
        path: "tailwind.config.js",
        content: `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
  darkMode: "class",
};
`,
      },
      {
        path: "postcss.config.js",
        content: `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
`,
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2017",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./*"] },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"],
        }, null, 2),
      },
      {
        path: "app/layout.tsx",
        content: `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Built with Spyro Studio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
`,
      },
      {
        path: "app/globals.css",
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      },
      {
        path: "app/page.tsx",
        content: `export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-4">Dashboard</h1>
      <p className="text-zinc-400">Welcome to your new dashboard.</p>
    </main>
  );
}
`,
      },
    ],
    agentsMd: `# AGENTS.md — Next.js Dashboard

This is a **Next.js 15** project using the App Router with Tailwind CSS.

## Development
- Dev server: \`npm run dev\` (port 3000)
- Build: \`npm run build\`
- Start: \`npm run start\`
- Lint: \`npm run lint\`

## Structure
\`\`\`
app/
  layout.tsx      # Root layout (dark theme)
  page.tsx        # Home page
  globals.css     # Tailwind imports
components/       # Shared UI components
lib/              # Utilities
\`\`\`

## Key Conventions
- App Router (not Pages Router)
- Tailwind CSS with dark mode (class strategy)
- TypeScript strict mode
- Use \`@/*\` path alias for imports
- Server Components by default; add "use client" only when needed

## Common Tasks
- Add a page: create \`app/<route>/page.tsx\`
- Add a component: create in \`components/\`
- Add API route: create \`app/api/<route>/route.ts\`
`,
  },

  "expo-blank": {
    name: "Expo Blank App",
    description: "Expo SDK with blank template, TypeScript, and Expo Router",
    category: "mobile",
    markers: ["package.json", "app.json"],
    installCmd: "npm install",
    devCmd: "npx expo start",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "expo-blank",
          version: "1.0.0",
          main: "expo-router/entry",
          scripts: {
            start: "expo start",
            android: "expo start --android",
            ios: "expo start --ios",
            web: "expo start --web",
          },
          dependencies: {
            expo: "~52.0.0",
            "expo-router": "~4.0.0",
            "expo-status-bar": "~2.0.0",
            react: "18.3.1",
            "react-native": "0.76.0",
            "react-native-safe-area-context": "4.12.0",
            "react-native-screens": "~4.4.0",
          },
          devDependencies: {
            "@babel/core": "^7.25.0",
            "@types/react": "~18.3.0",
            typescript: "^5.3.0",
          },
        }, null, 2),
      },
      {
        path: "app.json",
        content: JSON.stringify({
          expo: {
            name: "Expo Blank",
            slug: "expo-blank",
            version: "1.0.0",
            orientation: "portrait",
            icon: "./assets/icon.png",
            userInterfaceStyle: "light",
            newArchEnabled: true,
            splash: {
              image: "./assets/splash-icon.png",
              resizeMode: "contain",
              backgroundColor: "#ffffff",
            },
            ios: { supportsTablet: true },
            android: { adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#ffffff" } },
            web: { favicon: "./assets/favicon.png" },
            plugins: ["expo-router"],
            scheme: "expoblank",
          },
        }, null, 2),
      },
      {
        path: "app/_layout.tsx",
        content: `import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <Stack>
        <Stack.Screen name="index" options={{ title: "Home" }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
`,
      },
      {
        path: "app/index.tsx",
        content: `import { StyleSheet, Text, View } from "react-native";

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Expo</Text>
      <Text style={styles.subtitle}>Edit app/index.tsx to get started.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#666" },
});
`,
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          extends: "expo/tsconfig.base",
          compilerOptions: { strict: true },
        }, null, 2),
      },
      {
        path: "babel.config.js",
        content: `module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
`,
      },
    ],
    agentsMd: `# AGENTS.md — Expo Blank App

This is an **Expo SDK 52** project with Expo Router.

## Development
- Start: \`npx expo start\` (or \`expo_start\` tool)
- Tunnel: \`npx expo start --tunnel\` for phone testing
- Clear cache: \`npx expo start --clear\`
- Install packages: \`npx expo install <pkg>\`
- Doctor: \`npx expo-doctor\`

## Structure
\`\`\`
app/
  _layout.tsx      # Root layout
  index.tsx        # Home screen
assets/            # Images, icons
\`\`\`

## Navigation (Expo Router)
- File-based routing in \`app/\`
- Use \`useRouter()\` from \`expo-router\`
- Links: \`<Link href="/screen">\`

## Styling
- React Native StyleSheet
- Flexbox layout (Yoga)

## Testing on Device
1. \`expo_start --tunnel\` → scan QR with Expo Go
2. Or \`npx expo install expo-dev-client\` → development build

## Common Pitfalls
- Don't use \`npm install\` for native deps — use \`expo install\`
- Don't assume web APIs exist — check \`Platform.OS\`
- Test on real device (Expo Go or dev client)
`,
  },

  "express-api": {
    name: "Express API",
    description: "Express.js REST API with TypeScript, SQLite, and Zod validation",
    category: "backend",
    markers: ["package.json"],
    installCmd: "npm install",
    devCmd: "npm run dev",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "express-api",
          version: "1.0.0",
          type: "module",
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsc",
            start: "node dist/index.js",
          },
          dependencies: {
            express: "^4.21.0",
            "better-sqlite3": "^11.0.0",
            zod: "^3.23.0",
            cors: "^2.8.5",
          },
          devDependencies: {
            typescript: "^5.5.0",
            tsx: "^4.19.0",
            "@types/express": "^4.17.0",
            "@types/cors": "^2.8.0",
            "@types/better-sqlite3": "^7.6.0",
            "@types/node": "^22.0.0",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            outDir: "./dist",
            rootDir: "./src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ["src/**/*"],
        }, null, 2),
      },
      {
        path: "src/index.ts",
        content: `import express from "express";
import cors from "cors";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

const ItemSchema = z.object({ name: z.string(), value: z.number() });

app.get("/api/items", (req, res) => {
  res.json({ items: [] });
});

app.post("/api/items", (req, res) => {
  const parsed = ItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json({ item: parsed.data });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(\`API running on http://localhost:\${PORT}\`));
`,
      },
    ],
    agentsMd: `# AGENTS.md — Express API

This is an **Express.js** REST API with TypeScript and SQLite.

## Development
- Dev server: \`npm run dev\` (port 3001)
- Build: \`npm run build\`
- Start: \`npm run start\`

## Structure
\`\`\`
src/
  index.ts       # Entry point, routes
  routes/        # Route handlers
  models/        # Data models
  middleware/     # Express middleware
\`\`\`

## Key Conventions
- ESM modules (type: "module")
- Zod for validation
- better-sqlite3 for database
- TypeScript strict mode

## Common Tasks
- Add route: create handler in src/routes/
- Add model: create in src/models/
- Add middleware: create in src/middleware/
`,
  },

  "python-cli": {
    name: "Python CLI",
    description: "Python CLI tool with argparse, rich output, and pyproject.toml",
    category: "cli",
    markers: ["pyproject.toml"],
    installCmd: "pip install -e .",
    devCmd: "python -m src.cli",
    files: [
      {
        path: "pyproject.toml",
        content: `[project]
name = "python-cli"
version = "0.1.0"
description = "A Python CLI tool"
requires-python = ">=3.10"
dependencies = [
    "rich>=13.0",
    "click>=8.0",
]

[project.scripts]
python-cli = "src.cli:main"

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"
`,
      },
      {
        path: "src/__init__.py",
        content: "",
      },
      {
        path: "src/cli.py",
        content: `import click
from rich.console import Console

console = Console()

@click.group()
def cli():
    """Python CLI tool."""
    pass

@cli.command()
@click.argument("name")
def greet(name: str):
    """Greet someone."""
    console.print(f"[bold green]Hello, {name}![/bold green]")

if __name__ == "__main__":
    cli()
`,
      },
    ],
    agentsMd: `# AGENTS.md — Python CLI

This is a **Python** CLI tool using Click and Rich.

## Development
- Install: \`pip install -e .\`
- Run: \`python-cli\` or \`python -m src.cli\`
- Test: \`pytest\`

## Structure
\`\`\`
src/
  __init__.py
  cli.py         # Entry point
tests/
  test_cli.py
\`\`\`

## Key Conventions
- Click for CLI framework
- Rich for terminal output
- Type hints everywhere
- pytest for testing
`,
  },

  "react-vite": {
    name: "React + Vite",
    description: "React 19 + Vite + Tailwind with hot reload",
    category: "web",
    markers: ["package.json", "vite.config.ts"],
    installCmd: "npm install",
    devCmd: "npm run dev",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "react-vite",
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            dev: "vite",
            build: "tsc && vite build",
            preview: "vite preview",
          },
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
          devDependencies: {
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            "@vitejs/plugin-react": "^4.3.0",
            autoprefixer: "^10.4.0",
            postcss: "^8.4.0",
            tailwindcss: "^3.4.0",
            typescript: "^5.5.0",
            vite: "^6.0.0",
          },
        }, null, 2),
      },
      {
        path: "vite.config.ts",
        content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
`,
      },
      {
        path: "tailwind.config.js",
        content: `/** @type {import('tailwindcss').Config} */
export default { content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"], theme: { extend: {} }, plugins: [] };
`,
      },
      {
        path: "postcss.config.js",
        content: `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
`,
      },
      {
        path: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>React Vite</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`,
      },
      {
        path: "src/main.tsx",
        content: `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
`,
      },
      {
        path: "src/App.tsx",
        content: `export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <h1 className="text-3xl font-bold">Hello Vite + React</h1>
    </div>
  );
}
`,
      },
      {
        path: "src/index.css",
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2020",
            useDefineForClassFields: true,
            lib: ["ES2020", "DOM", "DOM.Iterable"],
            module: "ESNext",
            skipLibCheck: true,
            moduleResolution: "bundler",
            allowImportingTsExtensions: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: "react-jsx",
            strict: true,
          },
          include: ["src"],
        }, null, 2),
      },
    ],
    agentsMd: `# AGENTS.md — React + Vite

This is a **React 19 + Vite 6** project with Tailwind CSS.

## Development
- Dev server: \`npm run dev\` (port 5173)
- Build: \`npm run build\`
- Preview: \`npm run preview\`

## Structure
\`\`\`
src/
  main.tsx       # Entry point
  App.tsx        # Root component
  index.css      # Tailwind imports
index.html       # HTML template
\`\`\`

## Key Conventions
- Vite for bundling
- Tailwind CSS
- TypeScript strict mode
- React 19 with new JSX transform
`,
  },
};

export const templateTool: Tool = {
  name: "template",
  description:
    "Create a new project from a pre-built template. Templates include Next.js dashboard, Expo blank app, Express API, Python CLI, and React+Vite. " +
    "Each template comes with AGENTS.md pre-configured so the AI has the right context from the start.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "create", "info"],
        description: "list: show available templates; create: scaffold a new project; info: show template details",
      },
      name: {
        type: "string",
        description: "Template name (e.g. 'nextjs-dashboard', 'expo-blank', 'express-api', 'python-cli', 'react-vite')",
      },
      projectName: {
        type: "string",
        description: "Name for the new project folder",
      },
      path: {
        type: "string",
        description: "Parent directory (default: cwd)",
      },
    },
    required: ["action"],
  },
  async execute(args: any, ctx: ToolContext) {
    const cwd = ctx.cwd;

    switch (args.action) {
      case "list": {
        const lines = Object.entries(TEMPLATES).map(([key, t]) => {
          return `- **${key}** — ${t.name}\n  ${t.description}\n  Category: ${t.category} | Install: \`${t.installCmd}\` | Dev: \`${t.devCmd}\``;
        });
        return `Available templates:\n\n${lines.join("\n\n")}`;
      }

      case "info": {
        if (!args.name) return "Error: name required for info";
        const t = TEMPLATES[args.name];
        if (!t) return `Error: unknown template '${args.name}'. Use template(action="list") to see available templates.`;
        return `## ${t.name}\n\n${t.description}\n\n**Category:** ${t.category}\n**Markers:** ${t.markers.join(", ")}\n**Install:** \`${t.installCmd}\`\n**Dev:** \`${t.devCmd}\`\n\n**Files:**\n${t.files.map((f) => `- ${f.path}`).join("\n")}`;
      }

      case "create": {
        if (!args.name) return "Error: name required for create";
        if (!args.projectName) return "Error: projectName required for create";
        const t = TEMPLATES[args.name];
        if (!t) return `Error: unknown template '${args.name}'. Use template(action="list") to see available templates.`;

        const parentDir = args.path ? resolve(cwd, args.path) : cwd;
        const projectDir = resolve(parentDir, args.projectName);

        if (existsSync(projectDir)) {
          return `Error: directory already exists: ${projectDir}`;
        }

        mkdirSync(projectDir, { recursive: true });

        for (const file of t.files) {
          const filePath = resolve(projectDir, file.path);
          const dir = resolve(filePath, "..");
          mkdirSync(dir, { recursive: true });
          writeFileSync(filePath, file.content, "utf8");
        }

        // Write AGENTS.md
        writeFileSync(resolve(projectDir, "AGENTS.md"), t.agentsMd, "utf8");

        // Write .claude/settings.json
        const settingsDir = resolve(projectDir, ".claude");
        mkdirSync(settingsDir, { recursive: true });
        writeFileSync(
          resolve(settingsDir, "settings.json"),
          JSON.stringify({ enabledPlugins: [], projectType: t.category === "mobile" ? "expo" : t.category === "web" ? "web" : t.category === "backend" ? "node" : "unknown" }, null, 2),
          "utf8",
        );

        let result = `Created ${t.name} project at ${projectDir}\n\n`;
        result += `Files created: ${t.files.length + 2} (including AGENTS.md and .claude/settings.json)\n\n`;
        result += `Next steps:\n`;
        result += `1. cd ${args.projectName}\n`;
        result += `2. ${t.installCmd}\n`;
        result += `3. ${t.devCmd}\n`;

        return result;
      }

      default:
        return `Unknown action: ${args.action}`;
    }
  },
};

export { TEMPLATES };
