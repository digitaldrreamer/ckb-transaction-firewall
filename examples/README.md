# Examples

These examples show where the transaction firewall belongs in real applications:
after a transaction is built, before it is signed, and before a compromised or
mistaken runtime can send funds to a blocked output. They fetch the live CKB
testnet registry from `https://testnet.ckb.dev`; the registry payload is not
mocked.

## Prerequisites

- **Node.js 20+** for TypeScript examples
- **Rust 1.70+** for the Rust example
- **`MISTRAL_API_KEY`** env var — required only for the `agent-preflight` example
- An internet connection (all examples hit the CKB testnet RPC)

## Included examples

| Example | Audience | What it demonstrates |
|---|---|---|
| [`typescript/agent-preflight.ts`](./typescript/src/agent-preflight.ts) | Agent runtime builders | AI SDK + Mistral `mistral-large-latest` tool calls are gated against the live registry before signing. |
| [`typescript/wallet-ui.ts`](./typescript/src/wallet-ui.ts) | Wallets and dapps | A browser UI converts live firewall decisions into user-facing transfer feedback. |
| [`typescript/blacklisted-transfer-safety.ts`](./typescript/src/blacklisted-transfer-safety.ts) | Wallets, agents, operators | A credentialless safety test for transfer attempts to an actually active blacklisted destination. |
| [`rust/preflight_service.rs`](./rust/src/bin/preflight_service.rs) | Custodians, relayers, backend services | A Rust service fetches the live registry and rejects unsafe unsigned transactions before they enter a signing queue. |

The TypeScript examples use the same public SDK surface as a wallet or agent
would use. The Rust example uses the local Rust SDK path dependency so it can be
run from this repository.

If the live testnet registry has no active entries, the examples cannot honestly
show a `BlacklistedLockArgs` result. In that case they still exercise the real
registry fetch, a clean candidate payment, and the fail-closed
`MissingRegistryCellDep` path. Once governance adds an active entry, the same
examples automatically use the first active entry as the blocked payment case.

## Build and test

```bash
cd examples/typescript
npm install
npm run typecheck
npm run agent # requires MISTRAL_API_KEY
npm run wallet
npm run blacklisted-transfer
npm run wallet-ui

cd ../rust
cargo fmt --check
cargo run --bin preflight_service
```

## Most relevant example apps to build next

1. **Autonomous agent payment demo.** This is the highest-signal demo for the
   project because it proves the core claim: an agent can plan payments freely,
   but every proposed transaction is checked before signing, and firewall-lock
   protected funds remain protected even if the preflight call is skipped.
2. **Wallet send-flow with UI feedback.** Users need to see why a transaction
   was blocked, whether the failure is a blacklist hit, missing registry dep,
   malformed registry data, or stale local registry information.
3. **Consensus fallback / failed preflight bypass demo.** Show a transaction
   that deliberately skips SDK preflight and is still rejected by the on-chain
   firewall lock. This is the strongest security-model proof, but it needs a
   live CKB transaction harness or captured testnet fixture.
4. **Missing or stale registry cell demo.** Governance updates consume the old
   registry cell. A demo should show how apps recover by refetching the current
   registry outpoint instead of treating the failure as a permanent user error.
5. **Multi-registry policy demo.** Useful for organizations that combine a
   public registry with a private policy registry. It should show required and
   optional registries and how ambiguous deps fail closed.
6. **Type-args protection demo.** Most users will think in terms of recipient
   lock args, but the firewall also supports blocking output type args. This is
   relevant for dapps that must avoid creating certain assets or contract states.
7. **Temporary blacklist entry demo.** Demonstrate expiring entries and explain
   why on-chain enforcement needs header deps for time-aware behavior.
8. **Governance lifecycle demo.** Start with a proposed blacklist update, gather
   threshold votes, wait through the review window, execute, then show the SDK
   blocking the newly listed destination.

## When to choose TypeScript vs Rust

Use TypeScript for wallets, browser dapps, CLI tooling, and autonomous agent
runtimes. Use Rust for relayers, custodial services, indexer-backed transaction
builders, and systems that already construct CKB transactions server-side.
