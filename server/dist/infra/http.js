import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
/**
 * A `fetch` implementation built on node:http/https.
 *
 * Why this exists: on some hosts (containers, certain VPNs, IPv6-broken
 * networks) Node's built-in fetch/undici picks an IPv6 address that is
 * unreachable and the request dies with ETIMEDOUT, while node:https over
 * IPv4 works fine. This shim forces `family: 4` so outbound requests use
 * IPv4, and otherwise behaves like fetch (returns a real Response).
 */
/** Socket deadline used when a caller doesn't specify one. */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
export function nodeFetch(input, init = {}) {
    const url = new URL(input.toString());
    const isHttps = url.protocol === "https:";
    const mod = isHttps ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (err) => {
            if (settled)
                return;
            settled = true;
            reject(err);
        };
        const req = mod({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            method: init.method || "GET",
            headers: init.headers || {},
            // Force IPv4 — IPv6 is broken on some hosts and causes ETIMEDOUT.
            family: 4,
            // Must be set explicitly. Node 24 emits 'timeout' on a ClientRequest
            // after 5 s even when no timeout is configured, which silently killed
            // every model call that took longer than five seconds to emit its first
            // byte — i.e. most local models. Default high; callers that genuinely
            // want a short deadline pass their own.
            timeout: init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }, (res) => {
            if (settled)
                return;
            const status = res.statusCode || 0;
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
                if (Array.isArray(v))
                    for (const item of v)
                        headers.append(k, item);
                else if (v != null)
                    headers.set(k, String(v));
            }
            let web;
            try {
                web = Readable.toWeb(res);
            }
            catch {
                web = new ReadableStream({
                    start(c) {
                        res.on("data", (chunk) => c.enqueue(new Uint8Array(chunk)));
                        res.on("end", () => c.close());
                        res.on("error", (e) => c.error(e));
                    },
                });
            }
            resolve(new Response(web, { status, statusText: res.statusMessage || "", headers }));
        });
        req.on("error", fail);
        req.on("timeout", () => {
            req.destroy();
            fail(new Error(`Request to ${url.hostname} timed out`));
        });
        if (init.signal) {
            if (init.signal.aborted) {
                req.destroy();
                fail(new Error("Aborted"));
            }
            else {
                init.signal.addEventListener("abort", () => {
                    const err = new Error("Aborted");
                    req.destroy(err);
                    fail(err);
                }, { once: true });
            }
        }
        if (init.body !== undefined && init.body !== null) {
            req.write(typeof init.body === "string" ? init.body : init.body);
        }
        req.end();
    });
}
/**
 * Replace the global fetch with the IPv4-forcing implementation.
 * Safe to call once at server start.
 */
export function installFetch() {
    globalThis.fetch = nodeFetch;
}
