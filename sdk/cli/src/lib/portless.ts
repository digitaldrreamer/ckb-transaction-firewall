/**
 * Portless URL support for ckb-firewall gui.
 *
 * Adapted from https://github.com/vercel-labs/portless
 *   - proxy.ts  → createProxy()  (single-route HTTP proxy, no TLS complexity)
 *   - hosts.ts  → hosts helpers  (managed block, checkHostResolution)
 *
 * Strategy:
 *   1. App server starts on its own port (7979 or random).
 *   2. createProxy() tries to bind port 80 and forward
 *      Host: ckb-firewall.localhost → app server.
 *   3. If port 80 is available  → URL is http://ckb-firewall.localhost  (portless!)
 *      If EACCES / EADDRINUSE   → URL is http://ckb-firewall.localhost:APP_PORT
 *        (Chrome resolves *.localhost without a hosts entry; other browsers
 *         use the /etc/hosts entry we try to write).
 *   4. On SIGINT the proxy is closed and the hosts block is removed.
 */

import * as fs   from "node:fs";
import * as dns  from "node:dns";
import * as http from "node:http";
import * as net  from "node:net";
import type { AddressInfo } from "node:net";

// ── hostname ──────────────────────────────────────────────────────────────────

export const GUI_HOSTNAME = "ckb-firewall.localhost";

// ── /etc/hosts management (portless/src/hosts.ts) ────────────────────────────

const HOSTS_PATH =
  process.platform === "win32"
    ? (process.env["SystemRoot"] ?? "C:\\Windows") +
      "\\System32\\drivers\\etc\\hosts"
    : "/etc/hosts";

const MARKER_START = "# ckb-firewall-start";
const MARKER_END   = "# ckb-firewall-end";

function readHostsFile(): string {
  try { return fs.readFileSync(HOSTS_PATH, "utf-8"); } catch { return ""; }
}

function removeBlock(content: string): string {
  const s = content.indexOf(MARKER_START);
  const e = content.indexOf(MARKER_END);
  if (s === -1 || e === -1) return content;
  return (content.slice(0, s) + content.slice(e + MARKER_END.length))
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";
}

/** Write `127.0.0.1 ckb-firewall.localhost` into a managed hosts block.
 *  Returns true on success, false when the file isn't writable (no root). */
export function addHostsEntry(): boolean {
  try {
    const cleaned = removeBlock(readHostsFile());
    const block   = `${MARKER_START}\n127.0.0.1 ${GUI_HOSTNAME}\n${MARKER_END}`;
    fs.writeFileSync(HOSTS_PATH, cleaned.trimEnd() + "\n\n" + block + "\n");
    return true;
  } catch {
    return false;
  }
}

/** Remove the ckb-firewall managed block from /etc/hosts. */
export function removeHostsEntry(): void {
  try {
    const content = readHostsFile();
    if (!content.includes(MARKER_START)) return;
    fs.writeFileSync(HOSTS_PATH, removeBlock(content));
  } catch { /* best-effort */ }
}

/** True if ckb-firewall.localhost resolves to 127.0.0.1 via the system resolver. */
export function checkHostResolution(): Promise<boolean> {
  return new Promise((resolve) => {
    dns.lookup(GUI_HOSTNAME, { family: 4 }, (err, address) => {
      resolve(!err && address === "127.0.0.1");
    });
  });
}

// ── HTTP proxy (portless/src/proxy.ts, simplified) ───────────────────────────

export interface ProxyHandle {
  port: number;
  close: () => void;
}

/**
 * Start an HTTP proxy on `proxyPort` (default 80) that forwards all requests
 * to `appPort` on 127.0.0.1.
 *
 * Includes the WebSocket upgrade path (from portless proxy.ts) so SSE / WS
 * keep working if the GUI ever adds live updates.
 *
 * Returns null if the port is unavailable (EACCES / EADDRINUSE) — caller
 * should fall back to a high-port URL.
 */
export function createProxy(appPort: number, proxyPort = 80): Promise<ProxyHandle | null> {
  return new Promise((resolve) => {

    function proxyRequest(
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ): void {
      const proxyReq = http.request(
        {
          hostname: "127.0.0.1",
          port: appPort,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            // rewrite Host so the app server doesn't see ckb-firewall.localhost
            host: `127.0.0.1:${appPort}`,
            // pass original host info forward (portless x-forwarded-* pattern)
            "x-forwarded-host":  req.headers.host  ?? GUI_HOSTNAME,
            "x-forwarded-proto": "http",
            "x-forwarded-for":   req.socket.remoteAddress ?? "127.0.0.1",
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.on("error", () => {
            if (!res.headersSent) { res.writeHead(502); res.end(); }
            else { res.destroy(); }
          });
          proxyRes.pipe(res);
        },
      );

      proxyReq.on("error", (err) => {
        if (res.headersSent) return;
        const code = (err as NodeJS.ErrnoException).code;
        const msg  = code === "ECONNREFUSED"
          ? "App server is not responding."
          : "Bad Gateway";
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(msg);
      });

      // abort outgoing request if the client disconnects (portless pattern)
      res.on("close", () => { if (!proxyReq.destroyed) proxyReq.destroy(); });
      req.on("error",  () => { if (!proxyReq.destroyed) proxyReq.destroy(); });
      req.pipe(proxyReq);
    }

    function proxyUpgrade(
      req: http.IncomingMessage,
      socket: net.Socket,
      head: Buffer,
    ): void {
      socket.on("error", () => socket.destroy());

      const proxyReq = http.request({
        hostname: "127.0.0.1",
        port: appPort,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${appPort}`,
        },
      });

      proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
        let response = "HTTP/1.1 101 Switching Protocols\r\n";
        for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
          response += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}\r\n`;
        }
        response += "\r\n";
        socket.write(response);
        if (proxyHead.length > 0) socket.write(proxyHead);
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
        const cleanup = () => { proxySocket.destroy(); socket.destroy(); };
        proxySocket.on("error", cleanup);
        socket.on("error",      cleanup);
        proxySocket.on("close", cleanup);
        socket.on("close",      cleanup);
      });

      proxyReq.on("error", () => socket.destroy());
      if (head.length > 0) proxyReq.write(head);
      proxyReq.end();
    }

    const server = http.createServer((req, res) => {
      proxyRequest(req, res);
    });
    server.on("upgrade", proxyUpgrade);

    server.once("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EADDRINUSE") {
        resolve(null);
      } else {
        resolve(null); // unexpected — still fall back gracefully
      }
    });

    server.listen(proxyPort, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, close: () => server.close() });
    });
  });
}
