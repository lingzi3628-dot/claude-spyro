import { Tool } from "./types.js";
import { join } from "node:path";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";

export const themeTool: Tool = {
  name: "theme",
  description:
    "Manage IDE and UI themes: list available themes, apply a theme, or create a custom theme. " +
    "Supports dark, light, and custom color schemes.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "apply", "create", "export"], description: "What to do" },
      name: { type: "string", description: "Theme name" },
      colors: { type: "object", description: "Custom color overrides (for create)" },
    },
    required: ["action"],
  },
  async execute(args, _ctx) {
    const cwd = _ctx.cwd;
    const action = String(args.action || "list");

    const themes: Record<string, Record<string, string>> = {
      "spyro-dark": {
        bg: "#1a1a1a", "bg-elev": "#242424", "bg-sunken": "#101010",
        text: "#e8e8e8", "text-dim": "#a0a0a0", "text-faint": "#666",
        accent: "#d97757", border: "#333",
      },
      "spyro-light": {
        bg: "#fafafa", "bg-elev": "#ffffff", "bg-sunken": "#f0f0f0",
        text: "#1a1a1a", "text-dim": "#555", "text-faint": "#999",
        accent: "#d97757", border: "#ddd",
      },
      "monokai": {
        bg: "#272822", "bg-elev": "#3e3d32", "bg-sunken": "#1e1f1c",
        text: "#f8f8f2", "text-dim": "#a6a696", "text-faint": "#75715e",
        accent: "#f92672", border: "#49483e",
      },
      "dracula": {
        bg: "#282a36", "bg-elev": "#44475a", "bg-sunken": "#1e1f29",
        text: "#f8f8f2", "text-dim": "#bfbfbf", "text-faint": "#6272a4",
        accent: "#bd93f9", border: "#44475a",
      },
      "nord": {
        bg: "#2e3440", "bg-elev": "#3b4252", "bg-sunken": "#242933",
        text: "#eceff4", "text-dim": "#d8dee9", "text-faint": "#4c566a",
        accent: "#88c0d0", border: "#4c566a",
      },
      "solarized-dark": {
        bg: "#002b36", "bg-elev": "#073642", "bg-sunken": "#001e27",
        text: "#839496", "text-dim": "#93a1a1", "text-faint": "#586e75",
        accent: "#268bd2", border: "#073642",
      },
    };

    switch (action) {
      case "list": {
        const lines = Object.keys(themes).map((name) => {
          const t = themes[name];
          return `- **${name}** — accent: ${t.accent}, bg: ${t.bg}`;
        });
        return `Available themes:\n${lines.join("\n")}\n\nApply with: theme(action="apply", name="dracula")`;
      }

      case "apply": {
        if (!args.name) return "Error: name required";
        const t = themes[args.name];
        if (!t) return `Error: unknown theme '${args.name}'. Use theme(action="list") to see available themes.`;
        const cssVars = Object.entries(t).map(([k, v]) => `  --${k}: ${v};`).join("\n");
        const css = `:root {\n${cssVars}\n}\n`;
        const themeDir = join(cwd, ".spyro", "themes");
        mkdirSync(themeDir, { recursive: true });
        writeFileSync(join(themeDir, `${args.name}.css`), css, "utf8");
        // Also write as active theme
        writeFileSync(join(themeDir, "active.css"), css, "utf8");
        writeFileSync(join(themeDir, "active.json"), JSON.stringify({ name: args.name, colors: t }, null, 2), "utf8");
        return `Applied theme '${args.name}'.\nCSS written to ${themeDir}/active.css\nRestart the app to see changes.`;
      }

      case "create": {
        if (!args.name) return "Error: name required";
        if (!args.colors) return "Error: colors object required";
        const t = { ...themes["spyro-dark"], ...args.colors };
        const cssVars = Object.entries(t).map(([k, v]) => `  --${k}: ${v};`).join("\n");
        const css = `:root {\n${cssVars}\n}\n`;
        const themeDir = join(cwd, ".spyro", "themes");
        mkdirSync(themeDir, { recursive: true });
        writeFileSync(join(themeDir, `${args.name}.css`), css, "utf8");
        themes[args.name] = t;
        return `Created custom theme '${args.name}'.\nApply with: theme(action="apply", name="${args.name}")`;
      }

      case "export": {
        const themeDir = join(cwd, ".spyro", "themes");
        if (!existsSync(join(themeDir, "active.json"))) return "No active theme. Apply one first.";
        const active = JSON.parse(readFileSync(join(themeDir, "active.json"), "utf8"));
        return `Active theme: ${active.name}\nColors: ${JSON.stringify(active.colors, null, 2)}`;
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
};
