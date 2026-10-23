import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const computerUseTool = {
    name: "computer_use",
    description: "Cross-platform GUI automation: take screenshots, click, type, scroll, and read UI elements. " +
        "Works on Windows (UI Automation), macOS (Accessibility), and Linux (AT-SPI/X11). " +
        "Use this to test desktop apps, verify UI, and automate GUI workflows.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["screenshot", "click", "type", "scroll", "get_text", "list_windows", "focus_window", "key_press"],
                description: "What to do",
            },
            x: { type: "number", description: "X coordinate" },
            y: { type: "number", description: "Y coordinate" },
            text: { type: "string", description: "Text to type" },
            key: { type: "string", description: "Key to press (Enter, Tab, Escape, etc.)" },
            window: { type: "string", description: "Window title to focus" },
            path: { type: "string", description: "Screenshot save path" },
        },
        required: ["action"],
    },
    async execute(args, _ctx) {
        const platform = process.platform;
        const action = String(args.action || "screenshot");
        if (platform === "linux") {
            return await linuxComputerUse(action, args);
        }
        else if (platform === "win32") {
            return await windowsComputerUse(action, args);
        }
        else if (platform === "darwin") {
            return await macComputerUse(action, args);
        }
        return `Unsupported platform: ${platform}`;
    },
};
async function linuxComputerUse(action, args) {
    switch (action) {
        case "screenshot": {
            const path = args.path || `/tmp/screenshot-${Date.now()}.png`;
            try {
                await exec("scrot", [path]);
                return `Screenshot saved to ${path}`;
            }
            catch {
                try {
                    await exec("gnome-screenshot", ["-f", path]);
                    return `Screenshot saved to ${path}`;
                }
                catch {
                    try {
                        await exec("import", ["-window", "root", path]);
                        return `Screenshot saved to ${path}`;
                    }
                    catch {
                        return "Error: no screenshot tool found. Install scrot, gnome-screenshot, or imagemagick.";
                    }
                }
            }
        }
        case "click": {
            if (args.x === undefined || args.y === undefined)
                return "Error: x and y required";
            try {
                await exec("xdotool", ["mousemove", String(args.x), String(args.y), "click", "1"]);
                return `Clicked at (${args.x}, ${args.y})`;
            }
            catch {
                return "Error: xdotool not found. Install with: sudo apt install xdotool";
            }
        }
        case "type": {
            if (!args.text)
                return "Error: text required";
            try {
                await exec("xdotool", ["type", "--clearmodifiers", args.text]);
                return `Typed: ${args.text}`;
            }
            catch {
                return "Error: xdotool not found.";
            }
        }
        case "key_press": {
            if (!args.key)
                return "Error: key required";
            try {
                await exec("xdotool", ["key", args.key]);
                return `Pressed: ${args.key}`;
            }
            catch {
                return "Error: xdotool not found.";
            }
        }
        case "scroll": {
            const amount = args.y || 3;
            try {
                await exec("xdotool", ["click", amount > 0 ? "5" : "4"]);
                return `Scrolled ${amount}`;
            }
            catch {
                return "Error: xdotool not found.";
            }
        }
        case "list_windows": {
            try {
                const r = await exec("wmctrl", ["-l"]);
                return r.stdout.trim() || "(no windows)";
            }
            catch {
                try {
                    const r = await exec("xdotool", ["search", "--name", "", "getwindowname"]);
                    return r.stdout.trim() || "(no windows)";
                }
                catch {
                    return "Error: wmctrl or xdotool not found.";
                }
            }
        }
        case "focus_window": {
            if (!args.window)
                return "Error: window title required";
            try {
                await exec("wmctrl", ["-a", args.window]);
                return `Focused window: ${args.window}`;
            }
            catch {
                try {
                    await exec("xdotool", ["search", "--name", args.window, "windowactivate"]);
                    return `Focused window: ${args.window}`;
                }
                catch {
                    return "Error: wmctrl or xdotool not found.";
                }
            }
        }
        case "get_text": {
            try {
                const r = await exec("xclip", ["-o", "-selection", "clipboard"]);
                return r.stdout.trim() || "(empty clipboard)";
            }
            catch {
                return "Error: xclip not found.";
            }
        }
        default:
            return `Unknown action: ${action}`;
    }
}
async function windowsComputerUse(action, args) {
    // PowerShell-based UI Automation
    const ps = (script) => exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
    switch (action) {
        case "screenshot": {
            const path = args.path || `C:\\temp\\screenshot-${Date.now()}.png`;
            const script = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
        $bitmap.Save('${path.replace(/\\/g, "\\\\")}')
        $graphics.Dispose()
        $bitmap.Dispose()
        Write-Output "saved"
      `;
            try {
                await ps(script);
                return `Screenshot saved to ${path}`;
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        case "click": {
            if (args.x === undefined || args.y === undefined)
                return "Error: x and y required";
            const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${args.x}, ${args.y})
        $mouse = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint cButtons, uint dwExtraInfo);' -Name Mouse -Namespace Win32 -PassThru
        $mouse::mouse_event(0x02, 0, 0, 0, 0)
        $mouse::mouse_event(0x04, 0, 0, 0, 0)
      `;
            try {
                await ps(script);
                return `Clicked at (${args.x}, ${args.y})`;
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        case "type": {
            if (!args.text)
                return "Error: text required";
            const script = `
        $wshell = New-Object -ComObject WScript.Shell
        $wshell.SendKeys('${args.text.replace(/'/g, "''")}')
      `;
            try {
                await ps(script);
                return `Typed: ${args.text}`;
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        case "key_press": {
            if (!args.key)
                return "Error: key required";
            const keyMap = {
                Enter: "{ENTER}", Tab: "{TAB}", Escape: "{ESC}", Backspace: "{BACKSPACE}",
                Delete: "{DELETE}", Up: "{UP}", Down: "{DOWN}", Left: "{LEFT}", Right: "{RIGHT}",
            };
            const key = keyMap[args.key] || args.key;
            const script = `
        $wshell = New-Object -ComObject WScript.Shell
        $wshell.SendKeys('${key}')
      `;
            try {
                await ps(script);
                return `Pressed: ${args.key}`;
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        case "list_windows": {
            const script = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty MainWindowTitle`;
            try {
                const r = await ps(script);
                return r.stdout.trim() || "(no windows)";
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        case "focus_window": {
            if (!args.window)
                return "Error: window title required";
            const script = `
        $wshell = New-Object -ComObject WScript.Shell
        $wshell.AppActivate('${args.window.replace(/'/g, "''")}')
      `;
            try {
                await ps(script);
                return `Focused: ${args.window}`;
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        default:
            return `Unknown action: ${action}`;
    }
}
async function macComputerUse(action, args) {
    const osascript = (script) => exec("osascript", ["-e", script]);
    switch (action) {
        case "screenshot": {
            const path = args.path || `/tmp/screenshot-${Date.now()}.png`;
            try {
                await exec("screencapture", ["-x", path]);
                return `Screenshot saved to ${path}`;
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        case "click": {
            if (args.x === undefined || args.y === undefined)
                return "Error: x and y required";
            const script = `tell application "System Events" to click at {${args.x}, ${args.y}}`;
            try {
                await osascript(script);
                return `Clicked at (${args.x}, ${args.y})`;
            }
            catch (e) {
                return `Error: ${e.message}. (Accessibility permission required)`;
            }
        }
        case "type": {
            if (!args.text)
                return "Error: text required";
            const script = `tell application "System Events" to keystroke "${args.text.replace(/"/g, '\\"')}"`;
            try {
                await osascript(script);
                return `Typed: ${args.text}`;
            }
            catch (e) {
                return `Error: ${e.message}. (Accessibility permission required)`;
            }
        }
        case "key_press": {
            if (!args.key)
                return "Error: key required";
            const keyMap = {
                Enter: "return", Tab: "tab", Escape: "escape", Backspace: "delete",
                Up: "up arrow", Down: "down arrow", Left: "left arrow", Right: "right arrow",
            };
            const key = keyMap[args.key] || args.key.toLowerCase();
            try {
                await osascript(`tell application "System Events" to keystroke "${key}"`);
                return `Pressed: ${args.key}`;
            }
            catch (e) {
                return `Error: ${e.message}. (Accessibility permission required)`;
            }
        }
        case "list_windows": {
            const script = `tell application "System Events" to get name of every process whose visible is true`;
            try {
                const r = await osascript(script);
                return r.stdout.trim() || "(no windows)";
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        case "focus_window": {
            if (!args.window)
                return "Error: window required";
            const script = `tell application "${args.window}" to activate`;
            try {
                await osascript(script);
                return `Focused: ${args.window}`;
            }
            catch (e) {
                return `Error: ${e.message}`;
            }
        }
        default:
            return `Unknown action: ${action}`;
    }
}
