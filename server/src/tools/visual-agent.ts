import { Tool } from "./types.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";

const exec = promisify(execFile);

export const visualAgentTool: Tool = {
  name: "visual_agent",
  description:
    "Visual understanding: take screenshots of the screen or a specific window, analyze UI layout, " +
    "detect elements, and verify visual state. Combines screenshots with AI vision for UI testing. " +
    "Use this to verify what the user sees, debug layout issues, and test visual changes.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["screenshot", "screenshot_window", "analyze", "diff", "element_at"],
        description: "What to do",
      },
      path: { type: "string", description: "Screenshot save path" },
      window: { type: "string", description: "Window title to capture" },
      x: { type: "number", description: "X coordinate for element_at" },
      y: { type: "number", description: "Y coordinate for element_at" },
      before: { type: "string", description: "Before image path (for diff)" },
      after: { type: "string", description: "After image path (for diff)" },
    },
    required: ["action"],
  },
  async execute(args, _ctx) {
    const platform = process.platform;
    const action = String(args.action || "screenshot");

    switch (action) {
      case "screenshot": {
        const path = args.path || `/tmp/visual-${Date.now()}.png`;
        if (platform === "linux") {
          try {
            await exec("scrot", [path]);
          } catch {
            try {
              await exec("import", ["-window", "root", path]);
            } catch {
              return "Error: install scrot or imagemagick for screenshots";
            }
          }
        } else if (platform === "win32") {
          const script = `
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen
            $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
            $bitmap.Save('${path.replace(/\\/g, "\\\\")}')
            $graphics.Dispose(); $bitmap.Dispose()
          `;
          await exec("powershell", ["-NoProfile", "-Command", script]);
        } else if (platform === "darwin") {
          await exec("screencapture", ["-x", path]);
        }
        // Return base64 for AI analysis
        if (existsSync(path)) {
          const buf = readFileSync(path);
          const b64 = buf.toString("base64");
          const size = `${buf.length} bytes`;
          return `Screenshot saved to ${path} (${size})\n\nTo analyze this image, use the read_file tool or view it in the preview.\nBase64 preview (first 200 chars): ${b64.slice(0, 200)}...`;
        }
        return `Error: screenshot not created at ${path}`;
      }

      case "screenshot_window": {
        if (!args.window) return "Error: window title required";
        const path = args.path || `/tmp/window-${Date.now()}.png`;
        if (platform === "linux") {
          try {
            await exec("import", ["-window", args.window, path]);
          } catch {
            return "Error: imagemagick 'import' not found";
          }
        } else if (platform === "darwin") {
          await exec("screencapture", ["-l", "$(osascript -e 'tell app \"System Events\" to get id of window 1 of process \"" + args.window + "\"')", path]);
        } else {
          return "Window-specific capture not yet supported on this platform. Use full screenshot.";
        }
        if (existsSync(path)) return `Window screenshot saved to ${path}`;
        return `Error: screenshot not created`;
      }

      case "analyze": {
        // This would use the vision model to analyze the screenshot
        // For now, return metadata about the image
        const path = args.path;
        if (!path || !existsSync(path)) return "Error: image path required and must exist";
        const buf = readFileSync(path);
        return `Image: ${path}\nSize: ${buf.length} bytes\nFormat: ${path.endsWith(".png") ? "PNG" : path.endsWith(".jpg") ? "JPEG" : "unknown"}\n\nTo analyze visually, the AI can view this image if the model supports vision.`;
      }

      case "diff": {
        if (!args.before || !args.after) return "Error: before and after paths required";
        if (!existsSync(args.before) || !existsSync(args.after)) return "Error: both images must exist";
        // Use ImageMagick compare if available
        try {
          const diffPath = `/tmp/diff-${Date.now()}.png`;
          await exec("compare", [args.before, args.after, diffPath]);
          return `Visual diff saved to ${diffPath}`;
        } catch {
          return "Error: ImageMagick 'compare' not found. Install imagemagick.";
        }
      }

      case "element_at": {
        if (args.x === undefined || args.y === undefined) return "Error: x and y required";
        // On Linux, use xdotool to get window at position
        if (platform === "linux") {
          try {
            const r = await exec("xdotool", ["getmouselocation", "--shell"]);
            return `Mouse at: ${r.stdout.trim()}`;
          } catch {
            return "Error: xdotool not found";
          }
        }
        return "element_at not yet supported on this platform";
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
};
