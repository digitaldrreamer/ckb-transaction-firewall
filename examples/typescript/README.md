# TypeScript Examples

Runnable demos showing where the CKB Transaction Firewall belongs in real applications — after a transaction is built, before it is signed. All examples fetch the **live testnet registry** from `https://testnet.ckb.dev`; nothing is mocked.

## Prerequisites

- **Node.js 20 or later**
- An internet connection (examples hit the CKB testnet RPC)
- `MISTRAL_API_KEY` — only required for the `agent` example

## Install

```bash
npm install
```

## Environment variables

| Variable | Default | Required for |
|----------|---------|--------------|
| `CKB_RPC_URL` | `https://testnet.ckb.dev` | All examples |
| `CANDIDATE_LOCK_ARGS` | `0x331cdd72...` (governance key 0) | All examples (clean recipient) |
| `BLACKLISTED_LOCK_ARGS` | first active registry entry | `blacklisted-transfer` |
| `MISTRAL_API_KEY` | — | `agent` only |
| `PORT` | `4173` | `wallet-ui` only |

## Examples

### `wallet-feedback` — Pre-flight check in a wallet send flow

```bash
npm run wallet
```

Models a wallet's send flow. Builds a candidate transaction and runs it through `TransactionFirewall.checkTransaction` against the live registry before any signing step is reached. Shows all three outcomes: approved, blocked (blacklisted recipient), and blocked (missing registry dep — fail-closed).

**SDK patterns:** `TransactionFirewall`, `findRegistryCell`, `parseRegistryPayload`, `CellDepLike`.

---

### `wallet-ui` — Browser UI with live firewall feedback

```bash
npm run wallet-ui
open http://localhost:4173
```

A minimal HTTP server with a browser UI. Enter any CKB lock args and click **Check transfer** — the page calls `/api/check` and shows a live firewall decision. Buttons pre-fill a known clean address and the first active blacklisted address from the live registry.

**SDK patterns:** server-side `TransactionFirewall`, per-request `checkTransaction`.

---

### `blacklisted-transfer-safety` — Credentialless safety test

```bash
npm run blacklisted-transfer
```

Proves the firewall blocks a transfer to an **actually active** blacklisted destination from the live registry without ever asking for a password, private key, or signing command. Exits with code 1 if no active entry is found so CI stays honest.

Set `BLACKLISTED_LOCK_ARGS` to force a specific destination if the live registry has no active entries yet.

**SDK patterns:** `firstActiveEntry`, `TransactionFirewall.checkTransaction`.

---

### `agent-preflight` — AI agent gated by the firewall

```bash
export MISTRAL_API_KEY=sk-...
npm run agent
```

A Mistral `mistral-large-latest` AI agent (via the [AI SDK](https://sdk.vercel.ai)) is given a `proposePayment` tool. Before any payment can proceed, that tool checks the recipient against the live registry. The agent cannot bypass the check — it happens inside the tool, not in the agent's reasoning.

**SDK patterns:** `TransactionFirewall` as a tool-use gate, fail-closed on missing registry dep.

---

## Type check

```bash
npm run typecheck
```
