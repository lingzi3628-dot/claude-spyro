// src/components/UrlCards.tsx
import { useEffect, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/\S*)?/i;
var NAME_FOR_PORT = {
  "3000": "Next.js / React dev server",
  "3001": "second app",
  "4200": "Angular dev server",
  "5173": "Vite dev server",
  "5174": "Vite (second app)",
  "8000": "Python / FastAPI server",
  "8080": "common dev server",
  "5000": "Express / Flask server",
  "4173": "Vite preview",
  "5500": "Live Server"
};
function labelFor(url) {
  const port = (() => {
    const m = url.match(/:(\d+)/);
    return m?.[1] ?? "";
  })();
  return NAME_FOR_PORT[port] || (port ? `Local server on :${port}` : "Local server");
}
function tidy(url) {
  return url.replace(/[.,;:)\]]+$/, "");
}
function useFoundUrls(items, extraText = "") {
  return useMemo(() => {
    const seen = /* @__PURE__ */ new Map();
    const consider = (text, source) => {
      const withScheme = text.replace(/\blocalhost:(\d{2,5})\b/g, "http://localhost:$1");
      const matches = withScheme.match(/https?:\/\/[^\s"'`<>)\]]+/gi) || [];
      for (const raw of matches) {
        const url = tidy(raw);
        if (!LOCAL.test(url)) continue;
        if (seen.has(url)) continue;
        seen.set(url, { url, label: labelFor(url), source });
      }
    };
    for (const it of items) {
      if (!it) continue;
      if (it.kind === "assistant" || it.kind === "system" || it.kind === "plan") {
        if (it.text) consider(it.text, "output");
      }
      if (it.kind === "tool") {
        const name = it.name || "tool";
        const body = typeof it.result === "string" ? it.result : JSON.stringify(it.result ?? "");
        if (body) consider(body, name);
      }
    }
    if (extraText) consider(extraText, "output");
    return [...seen.values()];
  }, [items, extraText]);
}
function UrlCards({ urls }) {
  if (urls.length === 0) return null;
  const [state, setState] = useState({});
  const check = async (u) => {
    setState((s) => ({ ...s, [u]: "checking" }));
    try {
      const res = await fetch(`/api/probe?url=${encodeURIComponent(u)}`, {
        method: "GET"
      });
      const data = await res.json();
      setState((s) => ({ ...s, [u]: data.up ? "up" : "down" }));
    } catch {
      setState((s) => ({ ...s, [u]: "down" }));
    }
  };
  useEffect(() => {
    if (urls.length) check(urls[urls.length - 1].url);
  }, [urls.length]);
  return /* @__PURE__ */ jsx("div", { className: "url-cards", children: urls.map((u) => /* @__PURE__ */ jsxs("div", { className: "url-card", children: [
    /* @__PURE__ */ jsxs("div", { className: "url-card-main", children: [
      /* @__PURE__ */ jsx("span", { className: `url-dot ${state[u.url] ?? "unknown"}` }),
      /* @__PURE__ */ jsxs("div", { className: "url-card-text", children: [
        /* @__PURE__ */ jsx("span", { className: "url-card-label", children: u.label }),
        /* @__PURE__ */ jsx("code", { className: "url-card-url", children: u.url })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "url-card-actions", children: [
      /* @__PURE__ */ jsx("button", { className: "url-open", onClick: () => check(u.url), title: "Check if it's responding", children: state[u.url] === "checking" ? "checking\u2026" : state[u.url] === "up" ? "up \u2713" : state[u.url] === "down" ? "down" : "check" }),
      /* @__PURE__ */ jsx("a", { className: "url-open-primary", href: u.url, target: "_blank", rel: "noreferrer", children: "Open \u2197" })
    ] })
  ] }, u.url)) });
}
export {
  UrlCards,
  useFoundUrls
};
