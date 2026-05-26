/* Preview system — popover on desktop, bottom sheet on touch */
(function () {
  'use strict';

  /* ── glossary terms (shown on hover of dotted-underlined text) ─────── */
  var TERMS = {
    'BLKL': 'Binary payload format stored in the live registry cell. The 4-byte ASCII magic is "BLKL" (0x42 0x4c 0x4b 0x4c). Current version is v2.',
    'GOV1': 'Governance witness payload binding a registry update to a specific proposal, vote digest, and BLKL state transition. Current version is v3.',
    'FirewallLockArgs': 'Binary encoding of a firewall lock\'s configuration stored in the lock script args field. Current version is v2.',
    'blacklist-registry': 'CKB type script that validates every registry cell update. Enforces correct BLKL v2 payload structure, strict entry sort order, governance-lock identity, and valid GOV1 v3 witness binding.',
    'firewall-lock': 'CKB lock script that enforces blacklist checks at consensus. Scans cell deps for registry cells, parses BLKL v2, checks outputs against the blacklist, and spawns the inner lock if all checks pass. Fail-closed.',
    'governance-lock': 'CKB lock script securing the registry cell. Validates governance signer signatures and that the review window has elapsed before allowing a registry update.',
    'spawn-aware-secp256k1': 'Canonical inner lock for secp256k1-blake160 wallets. Receives arguments via argv rather than lock script args, because the firewall lock occupies the args field.',
    'cell dep': 'A reference to a live cell included in a transaction. The firewall lock reads the registry cell via a cell dep to fetch the live BLKL payload.',
    'fail-closed': 'Security posture of the firewall: when in doubt, reject. Missing deps, malformed payloads, or blacklisted identifiers all result in transaction rejection with no fallback.',
    'firewall-protected cell': 'A CKB cell whose lock script is the firewall lock. Spending it triggers the blacklist check at consensus on every full node.',
    'header_deps': 'Block headers included in a transaction. The firewall lock uses them to compute the chain median block time and evaluate time-based (expiring) blacklist entries.',
    'inner lock': 'Lock script the firewall delegates to after the blacklist check passes, via the spawn_cell syscall. Handles signature verification; the canonical option is spawn-aware-secp256k1.',
    'multi-registry': 'Firewall lock configuration consulting multiple independent registry cells. The effective blacklist is the union of all active entries; all required registries must be present as cell deps.',
    'pre-flight check': 'Off-chain run of the same blacklist logic enforced on-chain. The SDK\'s checkTransaction / preflightCheck provides fast, actionable feedback before signing; does not replace the on-chain guarantee.',
    'registry cell': 'Single live CKB cell whose data is a BLKL v2 binary payload. Contains the governance header and sorted blacklist entries. Identified by stable type_id_value; its outpoint changes after each governance update.',
    'spawn': 'The spawn_cell CKB syscall used by the firewall lock to execute the inner lock as a child process, passing inner lock args and the user\'s signature via argv.',
    'type_id_value': '32-byte Type ID at bytes 34–66 of the 66-byte registry cell type args. Computed once at bootstrap, never changes. Survives governance-lock upgrades and registry cell outpoint changes.',
    'governance header': 'Metadata embedded inside the BLKL v2 payload. Contains signer count, threshold, compressed secp256k1 pubkeys for each signer (33 bytes each), validator count, and validator Merkle root.',
    'oldRoot': 'Blake2b hash of the input registry cell data. Stored in the GOV1 v3 witness and included in the signer signing preimage.',
    'newRoot': 'Blake2b hash of the output registry cell data. Stored in the GOV1 v3 witness and included in the signer signing preimage.',
    'proposalIdHash': 'Blake2b hash of all canonical proposal fields. Immutable: any field change produces a different hash and invalidates all existing signatures.',
    'review window': 'Mandatory 72-hour waiting period before a governance update can be applied on-chain. Enforced via the governance cell input\'s since field. Cannot be bypassed.',
    'reviewWindowEndMs': 'Unix timestamp in milliseconds when the review window ends. Encoded in the GOV1 v3 witness and in the governance cell input\'s since field.',
    'validator Merkle root': '32-byte Merkle root committing to the authorized off-chain validator set. Leaves are blake2b(compressed_pubkey); each vote record includes a Merkle proof verified by the CLI.',
    'voteDigestHash': 'Blake2b hash of the full sorted set of vote records ({ pubkey, vote, timestamp, signature } sorted by pubkey). Recomputed by the execute CLI command before building the governance transaction.',
    'signer': 'On-chain governance committee member whose secp256k1 signature is submitted in the governance transaction witness and verified on-chain by the governance-lock script.',
    'validator': 'Off-chain committee member who votes on proposals. Votes are cryptographic signatures verified off-chain by the execute CLI command before the governance transaction is built.',
  };

  /* ── code snippets (shown when hovering inline <code> elements) ────── */
  var CODE_INDEX = {
    /* TypeScript SDK types — sdk/typescript/src/types.ts */
    'CellDepLike': {
      file: 'sdk/typescript/src/types.ts', lines: [9, 12], lang: 'typescript',
      code: 'export interface CellDepLike {\n  type?: ScriptLike | null;\n  data: string;\n}'
    },
    'TxOutputLike': {
      file: 'sdk/typescript/src/types.ts', lines: [14, 17], lang: 'typescript',
      code: 'export interface TxOutputLike {\n  lockArgs: string;\n  typeArgs?: string;\n}'
    },
    'UnsignedTxLike': {
      file: 'sdk/typescript/src/types.ts', lines: [19, 22], lang: 'typescript',
      code: 'export interface UnsignedTxLike {\n  cellDeps: CellDepLike[];\n  outputs: TxOutputLike[];\n}'
    },
    'FirewallDecision': {
      file: 'sdk/typescript/src/types.ts', lines: [41, 48], lang: 'typescript',
      code: 'export type FirewallDecision =\n  | { ok: true }\n  | { ok: false; code: 8;  reason: "MissingRegistryCellDep" }\n  | { ok: false; code: 9;  reason: "InvalidRegistryData" }\n  | { ok: false; code: 10; reason: "RegistryNotSorted" }\n  | { ok: false; code: 11; reason: "BlacklistedLockArgs" }\n  | { ok: false; code: 12; reason: "BlacklistedTypeArgs" }\n  | { ok: false; code: 17; reason: "AmbiguousRegistryCellDep" };'
    },
    'RegistryPayload': {
      file: 'sdk/typescript/src/types.ts', lines: [64, 68], lang: 'typescript',
      code: 'export interface RegistryPayload {\n  version: number;\n  entries: RegistryEntry[];\n  governanceHeader?: GovernanceHeader;\n}'
    },
    'RegistrySpecLike': {
      file: 'sdk/typescript/src/types.ts', lines: [73, 78], lang: 'typescript',
      code: 'export interface RegistrySpecLike {\n  codeHash: string;\n  hashType: HashType;\n  typeIdValue: string;\n  required: boolean;\n}'
    },
    'RegistrySpec': {
      file: 'sdk/rust/src/types.rs', lines: [80, 86], lang: 'rust',
      code: 'pub struct RegistrySpec {\n    pub code_hash: [u8; 32],\n    pub hash_type: HashType,\n    pub type_id_value: [u8; 32],\n    pub required: bool,\n}'
    },
    'FirewallConfig': {
      file: 'sdk/typescript/src/types.ts', lines: [80, 82], lang: 'typescript',
      code: 'export interface FirewallConfig {\n  registries: RegistrySpecLike[];\n}'
    },
    'FirewallSpendDepsConfig': {
      file: 'sdk/typescript/src/types.ts', lines: [98, 108], lang: 'typescript',
      code: 'export interface FirewallSpendDepsConfig {\n  firewallLockOutPoint: OutPointLike;\n  innerLockOutPoint: OutPointLike;\n  registryOutPoints: OutPointLike[];\n}'
    },
    'FirewallLockConfig': {
      file: 'sdk/typescript/src/types.ts', lines: [112, 125], lang: 'typescript',
      code: 'export interface FirewallLockConfig {\n  firewallCodeHash: string;\n  firewallHashType: HashType;\n  flags: number;\n  registries: RegistrySpecLike[];\n  innerCodeHash: string;\n  innerHashType: HashType;\n  innerArgs: string;\n}'
    },
    /* TypeScript SDK functions */
    'checkTransaction': {
      file: 'sdk/typescript/src/firewall.ts', lines: [33, 49], lang: 'typescript',
      code: 'checkTransaction(tx: UnsignedTxLike): FirewallDecision {\n  let payloads: RegistryPayload[];\n  try {\n    const deps = resolveRegistryDeps(tx.cellDeps, this.config.registries);\n    payloads = deps.map((dep) => parseRegistryPayload(dep.data));\n  } catch (err: unknown) {\n    return mapUnknownToDecision(err);\n  }\n  for (const out of tx.outputs) {\n    if (isBlacklisted(out.lockArgs, payloads))\n      return { ok: false, code: 11, reason: "BlacklistedLockArgs" };\n    if (out.typeArgs && isTypeArgsBlacklisted(out.typeArgs, payloads))\n      return { ok: false, code: 12, reason: "BlacklistedTypeArgs" };\n  }\n  return { ok: true };\n}'
    },
    'preflightCheck': {
      file: 'sdk/typescript/src/firewall.ts', lines: [33, 49], lang: 'typescript',
      code: '// Standalone function form of checkTransaction — same validation logic.\n// Uses resolveRegistryDeps + parseRegistryPayload then checks each output\n// lockArgs and typeArgs against the active blacklist entries.'
    },
    'fetchRegistryPayload': {
      file: 'sdk/typescript/src/fetch.ts', lines: [15, 28], lang: 'typescript',
      code: 'export async function fetchRegistryPayload(\n  rpcUrl: string,\n  txHash: string,\n  outputIndex: number,\n  timeoutMs = DEFAULT_TIMEOUT_MS,\n): Promise<RegistryPayload>'
    },
    'parseRegistryPayload': {
      file: 'sdk/typescript/src/blacklist.ts', lines: [1, 10], lang: 'typescript',
      code: '// Parses a 0x-prefixed BLKL v2 hex string into RegistryPayload.\n// Validates magic "BLKL", version byte 0x02, governance header, and\n// that entries are in strict ascending lexicographic order.'
    },
    'buildFirewallLockArgs': {
      file: 'sdk/typescript/src/builder.ts', lines: [49, 58], lang: 'typescript',
      code: 'export function buildFirewallLockArgs(config: FirewallLockConfig): Uint8Array {\n  if (!Number.isInteger(config.flags) || config.flags < 0 || config.flags > 0xff)\n    throw new RangeError("flags must be an integer in 0x00..0xff");\n  if ((config.flags & 0x03) === 0)\n    throw new Error("flags must have at least one check bit set");\n  if (config.registries.length > 255)\n    throw new RangeError("registries.length exceeds 255");\n  // ... encodes v2 FirewallLockArgs binary\n}'
    },
    'buildFirewallLockScript': {
      file: 'sdk/typescript/src/builder.ts', lines: [98, 104], lang: 'typescript',
      code: 'export function buildFirewallLockScript(config: FirewallLockConfig): ScriptLike {\n  return {\n    codeHash: config.firewallCodeHash,\n    hashType: config.firewallHashType,\n    args: bytesToHex(buildFirewallLockArgs(config)),\n  };\n}'
    },
    'buildFirewallSpendCellDeps': {
      file: 'sdk/typescript/src/builder.ts', lines: [107, 120], lang: 'typescript',
      code: '// Returns the CellDepLike[] needed for spending a firewall-protected cell.\n// Includes: deployed firewall-lock binary, deployed inner-lock binary,\n// and the live registry cell(s) identified by registryOutPoints.'
    },
    /* Rust SDK */
    'check_transaction': {
      file: 'sdk/rust/src/firewall.rs', lines: [104, 115], lang: 'rust',
      code: 'pub fn check_transaction(\n    cfg: &FirewallConfig,\n    tx: &UnsignedTxLike,\n    now_secs: u64,\n) -> Result<(), FirewallError> {\n    let resolved = resolve_registry_deps(&tx.cell_deps, &cfg.registries)?;\n    let mut payloads = Vec::new();\n    for slot in resolved.into_iter().flatten() {\n        payloads.push(parse_registry_payload(&slot.data)?);\n    }\n    preflight_check(&tx.outputs, &payloads, now_secs)\n}'
    },
    'FirewallError': {
      file: 'sdk/rust/src/errors.rs', lines: [9, 22], lang: 'rust',
      code: 'pub enum FirewallError {\n    /// No registry cell dep matches the required spec (code 8).\n    MissingRegistryCellDep,\n    /// Registry cell data is malformed or unsupported version (code 9).\n    InvalidRegistryData,\n    /// Registry entries are not in ascending order (code 10).\n    RegistryNotSorted,\n    /// Output\'s lock args are blacklisted (code 11).\n    BlacklistedLockArgs,\n    /// Output\'s type args are blacklisted (code 12).\n    BlacklistedTypeArgs,\n    /// More than one cell dep matches the same registry spec (code 17).\n    AmbiguousRegistryCellDep,\n}'
    },
    'parse_registry_payload': {
      file: 'sdk/rust/src/registry.rs', lines: [96, 110], lang: 'rust',
      code: 'pub fn parse_registry_payload(data: &[u8]) -> Result<RegistryPayload, FirewallError> {\n    if data.len() < 7 { return Err(FirewallError::InvalidRegistryData); }\n    if &data[0..4] != b"BLKL" { return Err(FirewallError::InvalidRegistryData); }\n    if data[4] != 0x02 { return Err(FirewallError::InvalidRegistryData); }\n    let gov_len = u16::from_le_bytes([data[5], data[6]]) as usize;\n    // ... parses governance header then sorted entries\n}'
    },
    'encode_registry_payload': {
      file: 'sdk/rust/src/registry.rs', lines: [1, 10], lang: 'rust',
      code: '// Encodes a RegistryPayload into a BLKL v2 binary buffer.\n// Writes magic, version 0x02, governance header, entry count,\n// and entries in strict ascending lexicographic sort order.'
    },
    /* Contract entry points */
    'program_entry': {
      file: 'contracts/firewall-lock/src/main.rs', lines: [1, 10], lang: 'rust',
      code: '// RISC-V entry point for the firewall-lock contract.\n// 1. Reads FirewallLockArgs v2 from the consuming cell\'s lock args.\n// 2. Loads matching registry cell deps and parses BLKL v2 payloads.\n// 3. Checks every transaction output against the active blacklist.\n// 4. On pass: spawns the inner lock via spawn_cell syscall.\n// On any failure: returns a non-zero exit code (fail-closed).'
    },
    /* GOV1 witness parsing — shown for "GOV1" in contract context */
    'GovernanceWitness': {
      file: 'contracts/blacklist-registry/src/main.rs', lines: [210, 230], lang: 'rust',
      code: 'pub fn parse(raw: &[u8]) -> Result<Self, SysError> {\n    if raw.len() != 141 {\n        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));\n    }\n    if &raw[0..4] != b"GOV1" {\n        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));\n    }\n    if raw[4] != 0x03 {  // v3 only — v2 no longer accepted\n        return Err(error::to_sys_error(error::INVALID_GOVERNANCE_WITNESS));\n    }\n    // proposal_id_hash[5..37], vote_digest_hash[37..69],\n    // old_root[69..101], new_root[101..133], review_window_end_ms[133..141]\n}'
    },
    /* Signing preimage */
    'signing_message': {
      file: 'contracts/governance-lock/src/main.rs', lines: [350, 363], lang: 'rust',
      code: 'let mut preimage = [0u8; 136];\npreimage[..32].copy_from_slice(&proposal_id_hash);\npreimage[32..64].copy_from_slice(&vote_digest_hash);\npreimage[64..96].copy_from_slice(&old_root);\npreimage[96..128].copy_from_slice(&new_root);\npreimage[128..136].copy_from_slice(&review_window_end_ms.to_le_bytes());\nlet signing_message = blake2b_256(&preimage);'
    },
  };

  /* ── file-path patterns (inline <code> with a repo path) ───────────── */
  // Matches sdk/*, contracts/*, notes/* paths optionally followed by :N or :N-M
  var FILE_PATH_RE = /^((?:sdk|contracts|notes)\/[a-zA-Z0-9_/.-]+\.[a-z]+)(?::(\d+)(?:-(\d+))?)?$/;

  /* ── glossary auto-linker (text nodes → <span class="pv-trigger">) ─── */
  var SKIP_TAGS = /^(CODE|PRE|A|H1|H2|H3|H4|H5|H6|SCRIPT|STYLE|BUTTON|LABEL)$/;

  function autoLinkTerms(content) {
    var terms = Object.keys(TERMS).sort(function (a, b) { return b.length - a.length; });
    var seen = Object.create(null);

    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        while (p && p !== content) {
          if (SKIP_TAGS.test(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p.classList && p.classList.contains('pv-trigger')) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var bestIdx = -1, bestTerm = null;
      terms.forEach(function (term) {
        if (seen[term]) return;
        var idx = text.indexOf(term);
        if (idx === -1) return;
        var pre = text[idx - 1], post = text[idx + term.length];
        if (pre  && /[\w-]/.test(pre))  return;
        if (post && /[\w-]/.test(post)) return;
        if (bestIdx === -1 || idx < bestIdx) { bestIdx = idx; bestTerm = term; }
      });
      if (!bestTerm) return;
      seen[bestTerm] = true;

      var parent = textNode.parentNode;
      var span = document.createElement('span');
      span.className = 'pv-trigger';
      span.setAttribute('tabindex', '0');
      span.setAttribute('role', 'button');
      span.setAttribute('data-pv-auto', '1');
      span.setAttribute('data-pv-type', 'def');
      span.setAttribute('data-pv-text', TERMS[bestTerm]);
      span.setAttribute('aria-label', bestTerm + ': ' + TERMS[bestTerm]);
      span.textContent = bestTerm;

      parent.insertBefore(document.createTextNode(text.slice(0, bestIdx)), textNode);
      parent.insertBefore(span, textNode);
      parent.insertBefore(document.createTextNode(text.slice(bestIdx + bestTerm.length)), textNode);
      parent.removeChild(textNode);
    });
  }

  /* ── code auto-linker (inline <code> elements) ─────────────────────── */
  function autoLinkCode(content) {
    content.querySelectorAll('code').forEach(function (el) {
      if (el.parentElement.tagName === 'PRE') return;
      if (el.dataset.pvAuto) return;

      var text = el.textContent.trim();

      // 1. Known symbol in CODE_INDEX
      if (CODE_INDEX[text]) {
        var entry = CODE_INDEX[text];
        el.classList.add('pv-trigger');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('data-pv-auto', '1');
        el.setAttribute('data-pv-type', 'code');
        el.setAttribute('data-pv-file', entry.file);
        el.setAttribute('data-pv-lines', entry.lines[0] + '-' + entry.lines[1]);
        el.setAttribute('data-pv-lang', entry.lang);
        el.setAttribute('data-pv-code', entry.code);
        el.setAttribute('aria-label', text + ' — view source');
        return;
      }

      // 2. File path pattern (e.g. sdk/typescript/src/types.ts:80)
      var m = FILE_PATH_RE.exec(text);
      if (m) {
        el.classList.add('pv-trigger');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('data-pv-auto', '1');
        el.setAttribute('data-pv-type', 'file');
        el.setAttribute('data-pv-file', m[1]);
        if (m[2]) el.setAttribute('data-pv-lines', m[2] + (m[3] ? '-' + m[3] : ''));
        el.setAttribute('aria-label', text + ' — source file reference');
      }
    });
  }

  /* ── master autoLink ────────────────────────────────────────────────── */
  function autoLink() {
    var content = document.querySelector('.sl-markdown-content');
    if (!content) return;

    // remove previous auto-triggers so re-runs are idempotent
    content.querySelectorAll('.pv-trigger[data-pv-auto]').forEach(function (el) {
      if (el.tagName === 'SPAN') {
        el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
      } else {
        // <code> element — just strip the pv- attributes
        el.classList.remove('pv-trigger');
        el.removeAttribute('data-pv-auto');
        el.removeAttribute('data-pv-type');
        el.removeAttribute('data-pv-file');
        el.removeAttribute('data-pv-lines');
        el.removeAttribute('data-pv-code');
        el.removeAttribute('data-pv-lang');
        el.removeAttribute('data-pv-text');
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
      }
    });

    autoLinkTerms(content);
    autoLinkCode(content);
  }

  /* ── helpers ────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── minimal syntax tokenizer (TypeScript + Rust) ───────────────────── */
  var TS_KW = /^(export|import|interface|type|const|let|var|function|async|await|return|if|else|for|while|class|extends|new|true|false|null|undefined|void|readonly|static|from|of|in|public|private|protected|abstract|declare|namespace|enum|implements|keyof|typeof)\b/;
  var RS_KW = /^(pub|fn|let|const|return|if|else|for|while|loop|match|struct|enum|impl|use|mod|crate|self|super|mut|where|async|await|true|false|move|ref|type|trait|dyn|unsafe|extern|static)\b/;

  function tokenize(code, lang) {
    var isRust = lang === 'rust';
    var KW = isRust ? RS_KW : TS_KW;
    var out = '', s = code, m;

    while (s.length) {
      // line comment
      if ((m = s.match(/^\/\/[^\n]*/)))
        { out += '<span class="pv-h-cmt">' + esc(m[0]) + '</span>'; s = s.slice(m[0].length); continue; }
      // block comment
      if ((m = s.match(/^\/\*[\s\S]*?\*\//)))
        { out += '<span class="pv-h-cmt">' + esc(m[0]) + '</span>'; s = s.slice(m[0].length); continue; }
      // double-quoted string
      if ((m = s.match(/^"(?:[^"\\]|\\.)*"/)))
        { out += '<span class="pv-h-str">' + esc(m[0]) + '</span>'; s = s.slice(m[0].length); continue; }
      // single-quoted string / char literal
      if ((m = s.match(/^'(?:[^'\\]|\\.)*'/)))
        { out += '<span class="pv-h-str">' + esc(m[0]) + '</span>'; s = s.slice(m[0].length); continue; }
      // template literal (TS only)
      if (!isRust && (m = s.match(/^`(?:[^`\\]|\\.)*`/)))
        { out += '<span class="pv-h-str">' + esc(m[0]) + '</span>'; s = s.slice(m[0].length); continue; }
      // keyword
      if ((m = s.match(KW)))
        { out += '<span class="pv-h-kw">' + esc(m[0]) + '</span>'; s = s.slice(m[0].length); continue; }
      // PascalCase type / constructor
      if ((m = s.match(/^[A-Z][A-Za-z0-9_]*/)))
        { out += '<span class="pv-h-typ">' + esc(m[0]) + '</span>'; s = s.slice(m[0].length); continue; }
      // hex / decimal number
      if ((m = s.match(/^0x[0-9a-fA-F]+|\b\d+/)))
        { out += '<span class="pv-h-num">' + esc(m[0]) + '</span>'; s = s.slice(m[0].length); continue; }
      // anything else — one character verbatim
      out += esc(s[0]); s = s.slice(1);
    }
    return out;
  }

  /* Track the last input type via pointerdown — more reliable than the
     media query alone on hybrid devices and iOS Safari. Seed from the
     media query so the very first interaction is already correct. */
  var lastPointerType = window.matchMedia('(hover: none) and (pointer: coarse)').matches
    ? 'touch' : 'mouse';
  document.addEventListener('pointerdown', function (e) {
    lastPointerType = e.pointerType; // 'mouse' | 'touch' | 'pen'
  }, { passive: true, capture: true });

  function isTouch() { return lastPointerType === 'touch'; }

  /* ── GitHub link helpers ────────────────────────────────────────────── */
  var GH_BASE = 'https://github.com/digitaldrreamer/ckb-transaction-firewall/blob/main/';
  var LINK_ICON = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true" style="display:inline;vertical-align:-1px;margin-left:4px"><path d="M1.5 9.5 9 2m0 0H4m5 0v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function githubUrl(trigger) {
    var file = trigger.dataset.pvFile;
    if (!file) return null;
    var url = GH_BASE + file;
    var lines = trigger.dataset.pvLines;
    if (lines) {
      var parts = lines.split('-');
      url += '#L' + parts[0];
      if (parts[1]) url += '-L' + parts[1];
    }
    return url;
  }

  function hasGhLink(trigger) {
    var t = trigger.dataset.pvType;
    return t === 'code' || t === 'file';
  }

  /* ── panel builders ─────────────────────────────────────────────────── */
  function buildDefPanel(trigger) {
    var div = document.createElement('div');
    div.className = 'pv-def-panel';
    div.innerHTML =
      '<strong class="pv-def-term">' + esc(trigger.textContent.trim()) + '</strong>' +
      '<p class="pv-def-body">' + esc(trigger.dataset.pvText || '') + '</p>';
    return div;
  }

  function buildCodePanel(trigger) {
    var file  = trigger.dataset.pvFile  || '';
    var lines = trigger.dataset.pvLines || '';
    var code  = trigger.dataset.pvCode  || null;
    var lang  = trigger.dataset.pvLang  || '';
    var fileName = file.split('/').pop();

    var div = document.createElement('div');
    div.className = 'pv-code-panel';

    var meta = '<div class="pv-code-meta">' +
      '<span class="pv-code-file">' + esc(fileName) + '</span>' +
      (lines ? '<span class="pv-code-lines">:' + esc(lines) + '</span>' : '') +
      '<span class="pv-code-repo">ckb-transaction-firewall</span>' +
      '<span class="pv-code-path">' + esc(file) + '</span>' +
      '</div>';

    var body;
    if (code) {
      body = '<pre><code>' + esc(code) + '</code></pre>';
    } else {
      body = '<p class="pv-def-body" style="padding:10px 14px;margin:0">' +
        'Source file: <code style="font-size:0.8em">' + esc(file) + '</code></p>';
    }

    div.innerHTML = meta + body;
    return div;
  }

  function buildFilePanel(trigger) {
    return buildCodePanel(trigger); // same layout, just no code body
  }

  function buildPanel(trigger) {
    var type = trigger.dataset.pvType;
    if (type === 'def')  return buildDefPanel(trigger);
    if (type === 'code') return buildCodePanel(trigger);
    if (type === 'file') return buildFilePanel(trigger);
    return null;
  }

  /* ── popover (desktop) ──────────────────────────────────────────────── */
  var popEl = null;
  var activeTrigger = null;

  function ensurePop() {
    if (popEl) return;
    popEl = document.createElement('div');
    popEl.id = 'pv-pop';
    popEl.className = 'pv-hidden';
    popEl.setAttribute('role', 'tooltip');

    var btn = document.createElement('button');
    btn.className = 'pv-close-btn';
    btn.setAttribute('aria-label', 'Close');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', hideAll);
    popEl.appendChild(btn);
    document.body.appendChild(popEl);

    popEl.addEventListener('mouseenter', cancelHide);
    popEl.addEventListener('mouseleave', scheduleHide);
  }

  function showPop(trigger) {
    ensurePop();
    var panel = buildPanel(trigger);
    if (!panel) return;

    while (popEl.children.length > 1) popEl.removeChild(popEl.lastChild);
    popEl.appendChild(panel);
    if (hasGhLink(trigger)) {
      var url = githubUrl(trigger);
      if (url) {
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'pv-gh-link';
        a.innerHTML = 'See in GitHub' + LINK_ICON;
        popEl.appendChild(a);
      }
    }
    popEl.classList.remove('pv-hidden');

    var tr = trigger.getBoundingClientRect();
    var sw = popEl.offsetWidth  || 460;
    var sh = popEl.offsetHeight || 140;
    var vw = window.innerWidth, vh = window.innerHeight;
    var sy = window.scrollY,   sx = window.scrollX;

    var left = sx + tr.left;
    var top  = sy + tr.bottom + 8;
    if (left + sw > sx + vw - 10) left = sx + vw - sw - 10;
    if (left < sx + 10) left = sx + 10;
    if (top + sh > sy + vh - 10) top = sy + tr.top - sh - 8;

    popEl.style.left = left + 'px';
    popEl.style.top  = top  + 'px';

    activeTrigger = trigger;
    trigger.setAttribute('aria-describedby', 'pv-pop');
  }

  function hidePop() {
    if (!popEl) return;
    popEl.classList.add('pv-hidden');
    if (activeTrigger) { activeTrigger.removeAttribute('aria-describedby'); activeTrigger = null; }
  }

  /* ── bottom sheet (touch) ───────────────────────────────────────────── */
  var sheetEl = null, overlayEl = null, returnFocus = null;

  function ensureSheet() {
    if (sheetEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'pv-overlay';
    overlayEl.className = 'pv-hidden';
    overlayEl.addEventListener('click', hideAll);
    document.body.appendChild(overlayEl);

    sheetEl = document.createElement('div');
    sheetEl.id = 'pv-sheet';
    sheetEl.className = 'pv-hidden';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');

    var handle = document.createElement('div');
    handle.className = 'pv-handle';
    sheetEl.appendChild(handle);

    var body = document.createElement('div');
    body.className = 'pv-sheet-body';
    sheetEl.appendChild(body);

    var xBtn = document.createElement('button');
    xBtn.className = 'pv-close-btn pv-sheet-x';
    xBtn.setAttribute('aria-label', 'Close');
    xBtn.innerHTML = '&times;';
    xBtn.addEventListener('click', hideAll);
    sheetEl.appendChild(xBtn);

    document.body.appendChild(sheetEl);
  }

  function showSheet(trigger) {
    ensureSheet();
    var panel = buildPanel(trigger);
    if (!panel) return;
    returnFocus = trigger;
    var body = sheetEl.querySelector('.pv-sheet-body');
    while (body.firstChild) body.removeChild(body.firstChild);
    body.appendChild(panel);
    if (hasGhLink(trigger)) {
      var url = githubUrl(trigger);
      if (url) {
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'pv-gh-btn';
        a.innerHTML = 'See in GitHub' + LINK_ICON;
        body.appendChild(a);
      }
    }
    overlayEl.classList.remove('pv-hidden');
    sheetEl.classList.remove('pv-hidden');
    sheetEl.querySelector('.pv-close-btn').focus();
  }

  function hideSheet() {
    if (!sheetEl) return;
    sheetEl.classList.add('pv-hidden');
    overlayEl.classList.add('pv-hidden');
    if (returnFocus) { returnFocus.focus(); returnFocus = null; }
  }

  /* ── show / hide orchestration ──────────────────────────────────────── */
  var showTimer = null, hideTimer = null;
  var SHOW_DELAY = 120, HIDE_DELAY = 220;

  function hideAll() {
    clearTimeout(showTimer); clearTimeout(hideTimer);
    hidePop(); hideSheet();
  }

  function scheduleShow(trigger) {
    clearTimeout(hideTimer);
    showTimer = setTimeout(function () {
      if (isTouch()) showSheet(trigger); else showPop(trigger);
    }, SHOW_DELAY);
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    hideTimer = setTimeout(hideAll, HIDE_DELAY);
  }

  function cancelHide() { clearTimeout(hideTimer); }

  /* ── event delegation ───────────────────────────────────────────────── */
  function onMouseOver(e) {
    if (isTouch()) return; // synthesized by tap — handled by onClick instead
    var t = e.target.closest('.pv-trigger');
    if (!t) return;
    cancelHide(); scheduleShow(t);
  }

  function onMouseOut(e) {
    if (isTouch()) return;
    if (!e.target.closest('.pv-trigger')) return;
    scheduleHide();
  }

  function onClick(e) {
    if (e.target.closest('#pv-pop') || e.target.closest('#pv-sheet') || e.target.closest('#pv-overlay')) return;
    var t = e.target.closest('.pv-trigger');
    if (t && isTouch()) { cancelHide(); showSheet(t); return; }
    if (!t) hideAll();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { hideAll(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement.classList.contains('pv-trigger')) {
      e.preventDefault();
      var t = document.activeElement;
      if (isTouch()) showSheet(t); else showPop(t);
    }
  }

  function onFocusIn(e) {
    if (isTouch()) return; // touch uses click, not focus events
    var t = e.target;
    if (t.classList.contains('pv-trigger')) { cancelHide(); scheduleShow(t); return; }
    if (!t.closest('#pv-pop')) scheduleHide();
  }

  /* ── init (idempotent across view-transition navigations) ───────────── */
  var listenersAttached = false;

  function init() {
    autoLink();
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout',  onMouseOut);
    document.addEventListener('click',     onClick);
    document.addEventListener('keydown',   onKeyDown);
    document.addEventListener('focusin',   onFocusIn);
  }

  document.addEventListener('astro:page-load', init);
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);

}());
