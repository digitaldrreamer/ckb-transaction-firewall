# Research: CKB Transaction Firewall

## Background

### Nervos CKB and the Cell Model

Nervos CKB (Common Knowledge Base) uses a UTXO-inspired model called the **Cell Model**. Every piece of state on CKB is stored in a "cell": an immutable unit that contains capacity (storage, measured in CKBytes), data, a lock script (defining ownership), and an optional type script (defining state transition rules).

Unlike Ethereum's account model, CKB transactions consume input cells and produce output cells. Validation is entirely scripted; there is no built-in account logic. This makes CKB exceptionally composable but also means that safety guarantees must be explicitly programmed.

**Key primitives relevant to this project:**
- `lock_script`: Determines who can spend a cell. Evaluated on every input cell consumption.
- `type_script`: Determines what transformations are valid on a cell. Used for tokens, NFTs, and typed state.
- `witness`: Off-chain data passed alongside a transaction for script evaluation.
- `dep_cell` (cell dep): Cells referenced by scripts during transaction validation, used to load shared code or data.

### AI Agents and Blockchain

AI agents capable of autonomous blockchain interaction represent an emerging threat model. Research in 2023-2025 has demonstrated:

- LLM-based agents can be manipulated via prompt injection in tool call outputs (e.g., a malicious DeFi protocol returning fabricated data to an agent querying on-chain state).
- Agents with wallet access (private key or session-key delegation) can be directed to sign arbitrary transactions by adversarial instructions.
- Multi-agent systems compound risk: a compromised orchestrator can instruct sub-agents to perform malicious actions.

**Reference works:**
- "Compromising LLM-Integrated Applications" (Liu et al., 2023): prompt injection attack taxonomy.
- "AgentDojo" benchmark (2024): adversarial evaluation framework for agentic tasks.
- EIP-7702 (Ethereum, 2024): temporary code delegation for EOAs, creating similar agent-wallet risk patterns.

---

## Prior Art and Comparable Systems

### OFAC Screening in TradFi

Traditional financial systems screen all transactions against OFAC (Office of Foreign Assets Control) blacklists before settlement. The parallel is direct: a pre-settlement blacklist check that is mandatory and enforced at the infrastructure layer, not left to individual applications.

### Ethereum Token Blacklists

ERC-20 tokens like USDC and USDT implement address blacklists at the token contract level. The issuer can block transfers to/from blacklisted addresses. Limitations:
- Centralized: blacklist is controlled by a single entity (Circle, Tether).
- Token-scoped: does not protect against interactions with exploit contracts that do not hold the token.
- Not enforced at the wallet/lock level, only at the token contract.

### Solana "Have I Been Drained" Pattern

The `haveibeendrained` project (Solana) implements a community-governed, decentralized wallet security checker. Users can query whether their wallet has interacted with known exploit contracts. This is reactive (post-hoc) rather than preventive. CKB Transaction Firewall is inspired by the community governance model but moves enforcement to the pre-transaction layer.

### CKB Omnilock and xUDT

- **Omnilock**: A flexible lock script on CKB that supports multiple authentication methods (Ethereum, Bitcoin, BTC, Solana signatures). Its modular design informs the architecture of the Firewall Lock: composable script modules rather than monolithic contracts.
- **xUDT (Extensible UDT)**: Demonstrates the use of `type_args` extensions and cell deps for composable token logic. The Blacklist Registry Cell uses a similar pattern for on-chain data composition.

### MakerDAO and On-chain Governance

MakerDAO's governance system (Governance Module, executive votes, spell contracts) is the primary reference for the on-chain governance update flow. Key adaptations for CKB:
- CKB has no native contract storage; governance state must live in cells.
- "Spells" (executable upgrade payloads) translate to signed witness data in an update transaction.
- Timelock delays are implemented via a `since` constraint in input cell spending conditions.

---

## Design Decisions

### Why Lock Script Enforcement (Not Just SDK)?

Enforcing the blacklist only in the SDK (pre-broadcast) is insufficient:
1. SDK can be bypassed: an agent could construct a transaction without going through the SDK.
2. No consensus-level guarantee: a compromised agent runtime could skip the SDK check.
3. Relay nodes do not validate SDK-level logic.

Lock script enforcement provides:
- **Consensus-level guarantees**: CKB miners and nodes validate the lock script. A transaction spending a firewall-protected cell will be rejected if it violates the blacklist, regardless of how it was constructed.
- **Unstoppable enforcement**: Once deployed, the firewall rules are protocol-enforced without any server or API dependency.

### Why Community Governance?

A centrally controlled blacklist introduces:
- Single point of failure (key compromise = blacklist poisoning).
- Censorship risk: a malicious operator could block legitimate transactions.
- Trust assumptions that are incompatible with decentralized agent systems.

Community governance via multisig or DAO ensures:
- No single entity controls the blacklist.
- Updates require social consensus (visible, auditable).
- The process is transparent and on-chain.

### Dual Enforcement Model

The firewall runs checks at two layers:
1. **SDK layer (pre-broadcast)**: Fast, cheap, returns human-readable errors to the agent.
2. **Lock script layer (consensus)**: Authoritative, enforced by the network, cannot be bypassed.

This mirrors the defense-in-depth pattern used in network firewalls (host-based + network-based).

### Blacklist Cell as a Cell Dep

The Blacklist Registry Cell is referenced in transactions as a `cell_dep` (read-only reference). This means:
- No capacity is consumed during transaction validation.
- The registry can be updated independently of the lock script deployment.
- Multiple versions of the registry can coexist during governance transitions.

---

## Open Questions and Future Work

1. **Latency of blacklist updates**: Governance updates have a 72-hour minimum review window. During this window, newly identified exploit addresses are not blocked. A "fast-track" emergency update process with a higher multisig threshold could mitigate this.

2. **False positives**: A blacklisted address could be a legitimate user who was mistakenly flagged. The governance process must include a clear appeal and removal mechanism.

3. **Scalability of blacklist**: As the blacklist grows, the cell data size increases, affecting capacity requirements and script execution time. Bloom filters or Merkle proof patterns could be used to scale without full list iteration.

4. **Cross-chain agent wallets**: Agents operating across CKB and other chains (e.g., BTC via RGB++, Ethereum via force bridge) may need cross-chain blacklist synchronization. This is out of scope for v1 but is a known extension point.

5. **Privacy**: A fully public on-chain blacklist reveals information about which addresses are considered malicious. Partial privacy (e.g., hashed entries with zero-knowledge proofs of membership) could be explored in future versions.

6. **Integration with CKB Agent Control Hub**: This firewall is designed to compose with the Agent Control Hub (see companion repository). The Control Hub can configure per-agent firewall policies; the Firewall enforces them.

---

## References

1. Nervos CKB Developer Documentation: https://docs.nervos.org
2. ckb-std library: https://github.com/nervosnetwork/ckb-std
3. Omnilock specification: https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0042-omnilock/0042-omnilock.md
4. xUDT specification: https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0052-extensible-udt/0052-extensible-udt.md
5. "Compromising LLM-Integrated Applications with Indirect Prompt Injection": Liu et al., arXiv:2302.12173
6. AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks: Debenedetti et al., 2024, https://arxiv.org/abs/2406.13352
7. Circle stablecoin EVM contracts: https://github.com/circlefin/stablecoin-evm
8. MakerDAO Governance Module: https://docs.makerdao.com/smart-contract-modules/governance-module
9. EIP-7702: Set EOA account code: https://eips.ethereum.org/EIPS/eip-7702
