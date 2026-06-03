# TypeScript Examples

Install dependencies from this directory:

```bash
npm install
```

Run the agent preflight demo with AI SDK and Mistral:

```bash
export MISTRAL_API_KEY=...
npm run agent
```

Run the wallet feedback CLI demo:

```bash
npm run wallet
```

Run the wallet feedback UI:

```bash
npm run wallet-ui
open http://localhost:4173
```

Run the credentialless blacklisted-transfer safety test:

```bash
npm run blacklisted-transfer
```

The examples fetch the current testnet registry with `get_cells` and
`get_live_cell`, then pass that live cell dep into
`TransactionFirewall.checkTransaction`. Set `CKB_RPC_URL` to use a different CKB
node and `CANDIDATE_LOCK_ARGS` to check a different recipient.

If the current registry has no active entries, the blacklisted-payment branch is
reported as unavailable instead of using mocked data.

`blacklisted-transfer` does not ask for a ckb-cli password or private key. It
first proves the destination is active in the live registry, then blocks before
any signing step. Set `BLACKLISTED_LOCK_ARGS` to force a specific destination.
