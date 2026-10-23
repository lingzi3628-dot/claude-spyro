import { Tool, ToolContext } from "./types.js";

/**
 * Browser automation via Playwright for preview control.
 * Gives the agent full control over the embedded preview: click, type, navigate, screenshot, console logs.
 */
let browser: any = null;
let page: any = null;
let context: any = null;

async function ensureBrowser() {
  if (browser) return;
  const { chromium } = await import("playwright");
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  page = await context.newPage();
  page.on("console", (msg: any) => {
    console.log(`[PREVIEW CONSOLE] ${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err: any) => {
    console.log(`[PREVIEW ERROR] ${err.message}`);
  });
}

export const browserTool: Tool = {
  name: "browser",
  description:
    "Control the live preview like a real browser. Navigate, click, type, scroll, screenshot, read console logs. Use this to test and debug what you build.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "navigate",
          "click",
          "type",
          "scroll",
          "screenshot",
          "get_text",
          "get_html",
          "console_logs",
          "wait_for",
          "evaluate",
          "hover",
          "select",
          "press_key",
          "go_back",
          "go_forward",
          "refresh",
          "get_url",
          "get_title",
        ],
        description: "What to do in the preview browser",
      },
      url: { type: "string", description: "URL to navigate to (for navigate action)" },
      selector: { type: "string", description: "CSS selector for element interactions" },
      text: { type: "string", description: "Text to type (for type action)" },
      key: { type: "string", description: "Key to press (Enter, Tab, Escape, ArrowDown, etc.)" },
      x: { type: "number", description: "X coordinate for scroll or mouse actions" },
      y: { type: "number", description: "Y coordinate for scroll or mouse actions" },
      options: { type: "object", description: "Additional options for the action" },
    },
    required: ["action"],
  },
  async execute(args: any, _ctx: ToolContext) {
    await ensureBrowser();

    try {
      switch (args.action) {
        case "navigate": {
          const target = args.url || "about:blank";
          const response = await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
          return `Navigated to ${target} (${response?.status()})`;
        }

        case "click": {
          if (!args.selector) return "Error: selector required for click";
          await page.click(args.selector, { timeout: 10000 });
          return `Clicked ${args.selector}`;
        }

        case "type": {
          if (!args.selector || !args.text) return "Error: selector and text required for type";
          await page.fill(args.selector, args.text, { timeout: 10000 });
          return `Typed into ${args.selector}`;
        }

        case "press_key": {
          if (!args.key) return "Error: key required";
          await page.keyboard.press(args.key);
          return `Pressed ${args.key}`;
        }

        case "scroll": {
          const x = args.x ?? 0;
          const y = args.y ?? 500;
          await page.mouse.wheel(x, y);
          return `Scrolled by (${x}, ${y})`;
        }

        case "screenshot": {
          const path = `/tmp/preview-${Date.now()}.png`;
          await page.screenshot({ path, fullPage: args.options?.fullPage ?? true });
          return `Screenshot saved to ${path}`;
        }

        case "get_text": {
          if (!args.selector) return "Error: selector required";
          const text = await page.textContent(args.selector);
          return text || "(empty)";
        }

        case "get_html": {
          if (!args.selector) {
            const html = await page.content();
            return html.slice(0, 50000);
          }
          const html = await page.$eval(args.selector, (el: any) => el.outerHTML);
          return html || "(empty)";
        }

        case "console_logs": {
          // Return recent console logs - we'd need to buffer these
          return "Console logging available via page.on('console') - check server logs";
        }

        case "wait_for": {
          if (!args.selector) return "Error: selector required";
          await page.waitForSelector(args.selector, { timeout: args.options?.timeout ?? 10000 });
          return `Element ${args.selector} is now visible`;
        }

        case "evaluate": {
          if (!args.selector) return "Error: selector required for evaluate context";
          const result = await page.$eval(args.selector, (_el: any, script: string) => eval(script), args.options?.script || "el");
          return String(result);
        }

        case "hover": {
          if (!args.selector) return "Error: selector required";
          await page.hover(args.selector);
          return `Hovered ${args.selector}`;
        }

        case "select": {
          if (!args.selector || !args.options?.value) return "Error: selector and value required";
          await page.selectOption(args.selector, args.options.value);
          return `Selected ${args.options.value} in ${args.selector}`;
        }

        case "go_back": {
          await page.goBack();
          return "Went back";
        }

        case "go_forward": {
          await page.goForward();
          return "Went forward";
        }

        case "refresh": {
          await page.reload({ waitUntil: "networkidle" });
          return "Refreshed";
        }

        case "get_url": {
          return page.url();
        }

        case "get_title": {
          return await page.title();
        }

        default:
          return `Unknown action: ${args.action}`;
      }
    } catch (err: any) {
      return `Browser error: ${err.message}`;
    }
  },
};

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    context = null;
  }
}
