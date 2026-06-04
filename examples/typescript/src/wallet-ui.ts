import { createServer } from "node:http";
import { TransactionFirewall } from "@ckb-firewall/sdk";
import {
  fetchLiveRegistry,
  firstActiveEntry,
  summarizeRegistry,
  TESTNET_ACCOUNT_2_LOCK_ARGS,
  TESTNET_REGISTRY_SPEC,
} from "./live-registry.js";

const port = Number(process.env.PORT ?? 4173);
const registry = await fetchLiveRegistry();
const firewall = new TransactionFirewall({ registries: [TESTNET_REGISTRY_SPEC] });

function json(status: number, body: unknown) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function renderHtml(): string {
  const activeEntry = firstActiveEntry(registry.payload);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CKB Firewall Wallet Feedback</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #16181d; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .meta { color: #5d6470; margin-bottom: 24px; }
    .panel { background: white; border: 1px solid #dfe3ea; border-radius: 8px; padding: 20px; }
    label { display: block; font-weight: 650; margin-bottom: 8px; }
    input { width: 100%; box-sizing: border-box; font: inherit; padding: 12px; border: 1px solid #cbd1da; border-radius: 6px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    button { border: 0; border-radius: 6px; padding: 10px 14px; font-weight: 700; cursor: pointer; background: #192235; color: white; }
    button.secondary { background: #e7ebf1; color: #18202f; }
    pre { overflow: auto; background: #10151f; color: #f4f7fb; border-radius: 6px; padding: 16px; min-height: 88px; }
    .ok { color: #0f7a3d; }
    .blocked { color: #b42318; }
  </style>
</head>
<body>
  <main>
    <h1>CKB Firewall Wallet Feedback</h1>
    <div class="meta">${summarizeRegistry(registry)}</div>
    <section class="panel">
      <label for="lockArgs">Recipient lock args</label>
      <input id="lockArgs" value="${TESTNET_ACCOUNT_2_LOCK_ARGS}" spellcheck="false" />
      <div class="actions">
        <button id="check">Check transfer</button>
        <button class="secondary" id="clean">Use account 2</button>
        <button class="secondary" id="blocked" ${activeEntry ? "" : "disabled"}>Use live blacklisted entry</button>
      </div>
      <p id="summary"></p>
      <pre id="result">Waiting for input.</pre>
    </section>
  </main>
  <script>
    const clean = ${JSON.stringify(TESTNET_ACCOUNT_2_LOCK_ARGS)};
    const blocked = ${JSON.stringify(activeEntry)};
    const input = document.querySelector('#lockArgs');
    const result = document.querySelector('#result');
    const summary = document.querySelector('#summary');

    async function check() {
      const res = await fetch('/api/check?lockArgs=' + encodeURIComponent(input.value.trim()));
      const body = await res.json();
      summary.className = body.ok ? 'ok' : 'blocked';
      summary.textContent = body.ok ? 'Approved for signing' : 'Blocked before signing';
      result.textContent = JSON.stringify(body, null, 2);
    }

    document.querySelector('#check').addEventListener('click', check);
    document.querySelector('#clean').addEventListener('click', () => { input.value = clean; check(); });
    document.querySelector('#blocked').addEventListener('click', () => { if (blocked) input.value = blocked; check(); });
    check();
  </script>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let response: { status: number; headers: Record<string, string>; body: string };

  if (url.pathname === "/") {
    response = { status: 200, headers: { "content-type": "text/html" }, body: renderHtml() };
  } else if (url.pathname === "/api/check") {
    const lockArgs = url.searchParams.get("lockArgs") ?? "";
    if (!/^0x[0-9a-fA-F]+$/.test(lockArgs)) {
      response = json(400, { ok: false, error: "lockArgs must be 0x-prefixed hex" });
    } else {
      const decision = firewall.checkTransaction({
        cellDeps: [registry.cellDep],
        outputs: [{ lockArgs }],
      });
      response = json(200, decision);
    }
  } else {
    response = { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
  }

  res.writeHead(response.status, response.headers);
  res.end(response.body);
});

server.listen(port, () => {
  console.log(`Wallet feedback UI: http://localhost:${port}`);
  console.log(`Loaded ${summarizeRegistry(registry)}`);
});
