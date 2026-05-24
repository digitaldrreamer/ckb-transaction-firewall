# Security Policy

## Scope

This document covers the CKB Transaction Firewall — a dual-layer blacklist enforcement system consisting of four on-chain Rust smart contracts, a TypeScript SDK, and a CLI governance tooling suite.

## Reporting Vulnerabilities

Please report security issues privately. Do not open public GitHub issues for security vulnerabilities.

---

## Known Security Constraints (Testnet)

### C1 — Testnet Governance Keys Are Publicly Known

The testnet governance committee uses secp256k1 keys derived from trivial private keys (`0x01*32` through `0x05*32`). These keys are universally known to anyone who reads the repository source code.

**Impact:** Any party can sign and execute governance proposals (add/remove blacklist entries) on testnet without any real authorization.

**Mitigation for real deployments:** Replace `TESTNET_GOVERNANCE_PUBKEYS` in `sdk/cli/src/lib/defaults.ts` with pubkeys derived from freshly generated, secret private keys. The CLI will emit a CRITICAL warning at runtime if trivial keys are detected.

**Mainnet requirement:** Use hardware security modules (HSMs) or multi-party computation for key custody. Never store governance private keys in plaintext or source files.

---

### H3 — Review Window Enforced On-Chain via GOV1 v3 + CKB `since` ✓ Fixed

The mandatory 72-hour governance review window is now enforced at consensus level. `execute.ts` sets the `since` field on the governance cell input to an absolute median-time-past timestamp equal to `reviewWindowEndsAt`, and `governance-lock` verifies this constraint on-chain.

**How it works:**
- `execute.ts` builds a **GOV1 v3 witness** (141 bytes = v2 + 8-byte LE u64 `review_window_end_ms`)
- The governance input's `since` field is set to `0x4000_0000_0000_0000 | review_window_end_ms` (absolute MTP timestamp)
- `governance-lock` parses the v3 witness, extracts `review_window_end_ms`, loads the input's `since`, and returns `ERR_REVIEW_WINDOW_NOT_MET (6)` if the since value encodes an earlier timestamp or uses a non-timestamp metric
- `review_window_end_ms` is included in the signing preimage (v3 = 136 bytes), so it cannot be tampered with after signing

**Format:** GOV1 v3 witnesses (141 bytes, version=0x03) are required. Both contracts reject any other version.

---

## Security Architecture Overview

### Fail-Closed Design

The on-chain `firewall-lock` contract is fail-closed:
- Missing registry cell dep → transaction rejected
- Invalid or malformed registry data → transaction rejected
- Ambiguous registry matching → transaction rejected

The TypeScript SDK pre-flight check (`TransactionFirewall.checkTransaction()`) mirrors this behavior but is advisory only. The on-chain contract is the authoritative enforcement point.

### Signature Binding (Replay Prevention)

Governance signer signatures are bound to the exact 136-byte preimage:

```text
blake2b(proposal_id_hash(32) || vote_digest_hash(32) || old_root(32) || new_root(32) || review_window_end_ms(8))
```

This prevents:
- Reuse of signatures across different proposals
- Reuse of signatures if the registry state changes between signing and execution
- Replay of a prior execution with new registry state

### Registry Identity (Type ID Survival)

Registry cells are identified by `type_id_value` (bytes 34..66 of the 66-byte v2 type args), not by the governance-lock code hash. This means the registry cell's identity survives governance-lock contract upgrades — clients do not need to update their `registrySpec` when the governance committee's contract is rotated.

### RPC Transport Security

All remote RPC calls require HTTPS. The CLI enforces this at the call site and will throw an error if a non-localhost non-HTTPS URL is provided. Registry data integrity cannot be guaranteed over plaintext HTTP.

---

## Vulnerability Classification

| ID | Severity | Status | Description |
|----|----------|--------|-------------|
| C1 | Critical | Mitigated (warning) | Trivial testnet governance keys |
| H1 | High | Fixed | governance-lock module comment vs. implementation mismatch |
| H2 | High | Fixed | HTTPS not enforced (now throws) |
| H3 | High | Fixed | Review window now enforced on-chain via GOV1 v3 + CKB `since` |
| M1 | Medium | Fixed | SIG_THRESHOLD hardcoded, not from on-chain governance header |
| M2 | Medium | Fixed | `placeholderSigners` misleading comment |
| M3 | Medium | Fixed | `proposalPath` lacked hex format validation |
| M4 | Medium | Accepted | Vote timestamp uses local clock |
| M5 | Medium | Accepted | Race condition in `listProposals` auto-rejection (single-user CLI) |
| L1 | Low | Fixed | `firewall-lock` RegistryPayload comment described v1, not v2 |
| L2 | Low | Fixed | `flags` validation didn't guard against non-integer values |
| L3 | Low | Fixed | `registryIndex` not validated in `sign.ts` |
| L4 | Low | Fixed | `expiresAt * 1000` used Number instead of BigInt |
| L6 | Low | Fixed | Missing comment explaining `header_deps: []` in governance tx |
| L7 | Low | Accepted | `get_median_time` returns 0 on no header_deps (conservative) |

---

## Mainnet Readiness Checklist

Before any mainnet or high-value deployment:

- [ ] Generate fresh governance private keys (never expose them)
- [ ] Update `TESTNET_GOVERNANCE_PUBKEYS` and constants in `defaults.ts`
- [ ] Redeploy contracts with new governance committee pubkeys in BLKL registry
- [x] Implement on-chain review window enforcement via CKB `since` field (GOV1 v3)
- [ ] Establish key custody policy (HSM, multi-party signing, offline storage)
- [ ] Add governance proposal deposit / rate limiting to prevent spam
- [ ] Audit duplicate vote pubkey handling in `computeVoteDigestHash`
- [ ] Test with the target chain's actual validator set and Merkle tree
