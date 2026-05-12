# CKB Transaction Firewall

> Protocol-level transaction safety for AI agents on Nervos CKB — community-governed blacklist enforcement via lock scripts.

## What this is (in brief)

**CKB Transaction Firewall** is a pair of on-chain scripts (firewall **lock** + blacklist **registry** type script) plus small **SDKs** (TypeScript and Rust) that run a **pre-flight** blacklist check before you sign a transaction.

**Why it matters:** autonomous agents can be steered by prompt injection, bad tools, or compromised code. Application-only checks can be skipped; consensus checks on cells locked with this script cannot be bypassed by buggy or malicious agent code.

**Long-form background** (threat model, why CKB, dual-layer design, components, security model): see **[ABOUT.md](./ABOUT.md)**.

---

## Documentation map

| Topic | Where |
|--------|--------|
| Narrative, architecture, security model | [ABOUT.md](./ABOUT.md) |
| Lock script interface (args, errors, registry rules) | [docs/lock-script-spec.md](./docs/lock-script-spec.md) |
| System architecture | [docs/architecture.md](./docs/architecture.md) |
| Governance (GOV1, drills, policy) | [docs/governance.md](./docs/governance.md), [governance/voting.md](./governance/voting.md) |
| Operator scripts (deploy, CI, governance automation) | [scripts/README.md](./scripts/README.md) |
| Contract-specific notes | [contracts/firewall-lock/README.md](./contracts/firewall-lock/README.md), [contracts/blacklist-registry/README.md](./contracts/blacklist-registry/README.md) |
| Release history | [CHANGELOG.md](./CHANGELOG.md) |

---

## Install the libraries

### TypeScript (`sdk/typescript`)

From a clone of this repo:

```bash
cd sdk/typescript
npm ci
npm run typecheck
```

To depend on it from another package (until a registry publish exists), use a **file** or **workspace** dependency, for example in your `package.json`:

```json
"dependencies": {
  "@ckb-firewall/sdk": "file:../path/to/ckb-transaction-firewall/sdk/typescript"
}
```

### Rust (`sdk/rust`)

```bash
cd sdk/rust
cargo build
cargo test
```

Add a path dependency in your `Cargo.toml` pointing at `sdk/rust`, or publish / vendor per your policy.

---

## Build the on-chain scripts

Install the RISC-V target and build each contract from its crate directory:

```bash
rustup target add riscv64imac-unknown-none-elf

cd contracts/firewall-lock
cargo build --release --target=riscv64imac-unknown-none-elf

cd ../blacklist-registry
# * dev-signer-keys matches local governance drill / test key material
cargo build --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys
```

`governance-lock` lives under `contracts/governance-lock/` for drill and supporting flows; build it the same way when you need that binary.

---

## Run contract VM tests

Integration-style VM tests live under `tests/unit` and expect the **release** RISC-V artifacts above to already exist:

```bash
cd contracts/firewall-lock
cargo build --release --target=riscv64imac-unknown-none-elf

cd ../blacklist-registry
cargo build --release --target=riscv64imac-unknown-none-elf --features dev-signer-keys

cd ../../tests/unit
cargo test --test firewall_lock_tests
cargo test --test blacklist_registry_tests
```

See [tests/unit/README.md](./tests/unit/README.md) for scope and fixtures.

---

## Using the Firewall lock on-chain

1. **Deploy** the firewall lock script and blacklist registry type script on your target network, and record **code hash**, **hash type**, and **registry type script identity** (see deployment runbooks under `docs/phase3/runbooks/` and [scripts/README.md](./scripts/README.md)).
2. **Normative layout** of lock args, flags, error codes, and registry `cell_dep` selection rules are specified in **[docs/lock-script-spec.md](./docs/lock-script-spec.md)** and summarized in [contracts/firewall-lock/README.md](./contracts/firewall-lock/README.md).
3. **Spend path:** cells whose **lock** is the firewall script must include a live blacklist registry cell as a `cell_dep` whose **type script** matches the registry identity encoded in the firewall lock args (exactly one match; zero or many → validation error).
4. **Inner lock:** the firewall delegates owner authorization to the configured inner lock (see spec). Without adopting this lock on an agent wallet cell, **only** the SDK pre-flight applies; miners do not run the firewall for standard secp-only locks.

The TypeScript SDK performs **off-chain** checks against the same blacklist payload shape the chain uses — call it **before signing**:

```typescript
import { TransactionFirewall } from "@ckb-firewall/sdk";

const firewall = new TransactionFirewall({
  registryScript: {
    codeHash: "0x<32-byte code hash hex>",
    hashType: "type",
    args: "0x<registry type args hex>",
  },
});

const decision = firewall.checkTransaction(unsignedTxLike);
if (!decision.ok) {
  console.error(decision.reason, "code", decision.code);
  // Do not sign.
}
```

Rust equivalent: `ckb_transaction_firewall_sdk::check_transaction` with `FirewallConfig` and `UnsignedTxLike` — see `sdk/rust/src/lib.rs`.

---

## Contributing

- **Code & docs:** open an issue for larger changes, then a PR against `main`. Match existing style; run relevant `cargo test` / `npm test` paths before pushing.
- **Blacklist governance:** proposals and voting are **not** ordinary PRs — follow **[governance/voting.md](./governance/voting.md)** and **[docs/governance.md](./docs/governance.md)**.
- **Security:** report sensitive issues through **GitHub Security Advisories** (private disclosure) for this repository when possible.

```bash
git checkout -b feat/your-change
# edit, test, commit
git push -u origin feat/your-change
# open PR → main
```

---

## Changelog and versioning

Semantic versions are tracked per crate / package (`Cargo.toml`, `sdk/typescript/package.json`); see **[CHANGELOG.md](./CHANGELOG.md)** for release notes.

---

## License

MIT — see `license = "MIT"` in each crate’s `Cargo.toml` (e.g. `contracts/firewall-lock/Cargo.toml`, `sdk/rust/Cargo.toml`).
