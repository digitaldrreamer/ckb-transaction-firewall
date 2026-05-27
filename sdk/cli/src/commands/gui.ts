import { exec } from "node:child_process";
import chalk from "chalk";
import { startGuiServer } from "../lib/gui-server.js";
import { inspectDefaults } from "./inspect.js";
import {
  GUI_HOSTNAME,
  createProxy,
  addHostsEntry,
  removeHostsEntry,
  checkHostResolution,
  type ProxyHandle,
} from "../lib/portless.js";

export interface GuiOptions {
  port?: string;
  noOpen?: boolean;
}

export async function guiCommand(opts: GuiOptions): Promise<void> {
  const defs = inspectDefaults();
  const appPort = opts.port ? parseInt(opts.port, 10) : 7979;

  console.log();
  console.log(chalk.cyan("⬡"), chalk.bold("CKB Firewall GUI"), chalk.dim("— starting…"));
  console.log();

  // ── 1. Start the app server on its own port ───────────────────────────────
  let server: { port: number; close: () => void };
  try {
    server = await startGuiServer({
      rpcUrl: defs.rpcUrl,
      registryTx: defs.registryTx,
      registryIndex: parseInt(defs.registryIndex, 10),
      port: appPort,
    });
  } catch (err) {
    // Port in use — try any available port
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.log(chalk.yellow(`  Port ${appPort} in use, trying a random port…`));
      server = await startGuiServer({
        rpcUrl: defs.rpcUrl,
        registryTx: defs.registryTx,
        registryIndex: parseInt(defs.registryIndex, 10),
        port: 0,
      });
    } else {
      throw err;
    }
  }

  // ── 2. Attempt portless: bind port 80 proxy ───────────────────────────────
  let proxy: ProxyHandle | null = null;
  let browseUrl: string;

  proxy = await createProxy(server.port, 80);

  if (proxy !== null) {
    // Port 80 is available — full portless experience
    addHostsEntry();          // best-effort; silently skipped if no root
    browseUrl = `http://${GUI_HOSTNAME}`;
  } else {
    // Port 80 unavailable (EACCES / EADDRINUSE) — try /etc/hosts + high port
    const hostsOk = addHostsEntry();
    const resolves = hostsOk ? await checkHostResolution() : false;

    if (resolves || !hostsOk) {
      // Chrome/Firefox auto-resolve *.localhost without hosts entry too
      browseUrl = `http://${GUI_HOSTNAME}:${server.port}`;
    } else {
      // Fallback: plain localhost URL
      browseUrl = `http://localhost:${server.port}`;
    }

    // Hint on how to get the portless URL
    console.log(
      chalk.dim("  ℹ"),
      chalk.dim("Port 80 unavailable — using high-port URL."),
    );
    console.log(
      chalk.dim("    To get"),
      chalk.dim.bold(`http://${GUI_HOSTNAME}`),
      chalk.dim("run:"),
    );
    if (process.platform === "linux") {
      console.log(
        chalk.dim(`    sudo setcap cap_net_bind_service+eip $(which node)`),
      );
    } else {
      console.log(chalk.dim(`    sudo ckb-firewall gui`));
    }
    console.log();
  }

  // ── 3. Report and open ────────────────────────────────────────────────────
  console.log(chalk.green("✔"), "Server listening at", chalk.bold.cyan(browseUrl));
  console.log(chalk.dim("  Registry:"), chalk.dim(defs.rpcUrl));
  console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

  if (!opts.noOpen) openBrowser(browseUrl);

  // ── 4. Graceful shutdown ──────────────────────────────────────────────────
  process.on("SIGINT", () => {
    console.log(chalk.dim("\n  Shutting down GUI server…"));
    if (proxy) proxy.close();
    server.close();
    removeHostsEntry();
    process.exit(0);
  });

  // Keep the process alive while the server runs
  await new Promise<never>(() => {});
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? `open "${url}"` :
    process.platform === "win32"  ? `start "" "${url}"` :
                                    `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log(chalk.dim(`  (Could not open browser automatically — visit the URL above)`));
    }
  });
}
