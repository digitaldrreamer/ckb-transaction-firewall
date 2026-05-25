/* Preview system — popover on desktop, bottom sheet on touch */
(function () {
  'use strict';

  /* ── glossary terms ────────────────────────────────────────────────── */
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
    'CellDepLike': 'Minimal cell dependency representation for firewall checking. Fields: type (ScriptLike | null, optional), data (0x-prefixed hex cell data).',
    'FirewallConfig': 'Top-level SDK configuration. Fields: registries: RegistrySpecLike[] (TypeScript) or Vec<RegistrySpec> (Rust). Passed to checkTransaction / preflightCheck.',
    'FirewallDecision': 'Discriminated union returned by the TypeScript SDK. Either { ok: true } or { ok: false; code: number; reason: string }.',
    'FirewallError': 'Rust SDK error enum whose variants map to the same numeric codes as FirewallDecision.code in TypeScript.',
    'FirewallLockConfig': 'Full configuration for building a v2 firewall lock script via the SDK builder helpers. Includes code hash/hash type, flags, registry specs, and inner lock details.',
    'FirewallSpendDepsConfig': 'Everything needed to build the cell_deps array for spending a firewall-protected cell: firewall-lock outpoint, inner-lock outpoint, and live registry cell outpoints.',
    'RegistryPayload': 'Parsed BLKL v2 registry cell contents. Fields: version, entries (guaranteed in strict ascending byte order), governanceHeader.',
    'RegistrySpec': 'Identifies one registry cell by type_id_value (bytes 34–66 of the 66-byte v2 type args). Fields: codeHash, hashType, typeIdValue, required.',
    'RegistrySpecLike': 'Identifies one registry cell by type_id_value. Fields: codeHash, hashType, typeIdValue, required. Optional registries (required: false) are silently skipped if absent from cell deps.',
    'TxOutputLike': 'Transaction output reduced to the two fields the firewall inspects. Fields: lockArgs (0x-prefixed hex), typeArgs (optional).',
    'UnsignedTxLike': 'Minimal unsigned transaction view for firewall checking. Fields: cellDeps: CellDepLike[], outputs: TxOutputLike[].',
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

  /* ── auto-linker ───────────────────────────────────────────────────── */
  var SKIP_TAGS = /^(CODE|PRE|A|H1|H2|H3|H4|H5|H6|SCRIPT|STYLE|BUTTON|LABEL)$/;

  function autoLink() {
    var content = document.querySelector('.sl-markdown-content');
    if (!content) return;

    // remove any previous triggers from a prior page-load run
    content.querySelectorAll('.pv-trigger[data-pv-auto]').forEach(function (el) {
      el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
    });

    // sort longest-first so "blacklist-registry" matches before "registry"
    var terms = Object.keys(TERMS).sort(function (a, b) { return b.length - a.length; });
    var seen = Object.create(null);

    var walker = document.createTreeWalker(
      content,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          var p = node.parentElement;
          while (p && p !== content) {
            if (SKIP_TAGS.test(p.tagName)) return NodeFilter.FILTER_REJECT;
            if (p.classList && p.classList.contains('pv-trigger')) return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      }
    );

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
        // word-boundary guard
        var pre = text[idx - 1], post = text[idx + term.length];
        if (pre  && /[\w-]/.test(pre))  return;
        if (post && /[\w-]/.test(post)) return;
        if (bestTerm === null || idx < bestIdx) { bestIdx = idx; bestTerm = term; }
      });

      if (!bestTerm) return;
      seen[bestTerm] = true;

      var parent = textNode.parentNode;
      var before = document.createTextNode(text.slice(0, bestIdx));
      var span   = document.createElement('span');
      span.className = 'pv-trigger';
      span.setAttribute('tabindex', '0');
      span.setAttribute('role', 'button');
      span.setAttribute('data-pv-auto', '1');
      span.setAttribute('data-pv-type', 'def');
      span.setAttribute('data-pv-text', TERMS[bestTerm]);
      span.setAttribute('aria-label', bestTerm + ': ' + TERMS[bestTerm]);
      span.textContent = bestTerm;
      var after = document.createTextNode(text.slice(bestIdx + bestTerm.length));

      parent.insertBefore(before, textNode);
      parent.insertBefore(span,   textNode);
      parent.insertBefore(after,  textNode);
      parent.removeChild(textNode);
    });
  }

  /* ── ui state ──────────────────────────────────────────────────────── */
  var SHOW_DELAY = 120;
  var HIDE_DELAY = 220;

  var popEl = null, sheetEl = null, overlayEl = null;
  var showTimer = null, hideTimer = null;
  var activeTrigger = null, returnFocus = null;

  /* ── helpers ───────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isTouch() {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  function buildDefPanel(trigger) {
    var div = document.createElement('div');
    div.className = 'pv-def-panel';
    div.innerHTML =
      '<strong class="pv-def-term">' + esc(trigger.textContent.trim()) + '</strong>' +
      '<p class="pv-def-body">' + esc(trigger.dataset.pvText || '') + '</p>';
    return div;
  }

  function buildPanel(trigger) {
    var type = trigger.dataset.pvType;
    if (type === 'def') return buildDefPanel(trigger);
    return null;
  }

  /* ── popover (desktop) ─────────────────────────────────────────────── */
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

    // clear content (keep close btn)
    while (popEl.children.length > 1) popEl.removeChild(popEl.lastChild);
    popEl.appendChild(panel);
    popEl.classList.remove('pv-hidden');

    // position
    var tr = trigger.getBoundingClientRect();
    var sw = popEl.offsetWidth  || 380;
    var sh = popEl.offsetHeight || 120;
    var vw = window.innerWidth, vh = window.innerHeight;
    var scrollY = window.scrollY, scrollX = window.scrollX;

    var left = scrollX + tr.left;
    var top  = scrollY + tr.bottom + 8;

    if (left + sw > scrollX + vw - 10) left = scrollX + vw - sw - 10;
    if (left < scrollX + 10) left = scrollX + 10;
    if (top + sh > scrollY + vh - 10) top = scrollY + tr.top - sh - 8;

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

  /* ── bottom sheet (touch) ──────────────────────────────────────────── */
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

  /* ── show / hide orchestration ─────────────────────────────────────── */
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

  /* ── event delegation ──────────────────────────────────────────────── */
  function onDocMouseOver(e) {
    var t = e.target.closest('.pv-trigger');
    if (!t) return;
    cancelHide();
    scheduleShow(t);
  }

  function onDocMouseOut(e) {
    if (!e.target.closest('.pv-trigger')) return;
    scheduleHide();
  }

  function onDocClick(e) {
    if (e.target.closest('#pv-pop') || e.target.closest('#pv-sheet') || e.target.closest('#pv-overlay')) return;
    var t = e.target.closest('.pv-trigger');
    if (t) { if (isTouch()) { cancelHide(); showSheet(t); } return; }
    hideAll();
  }

  function onDocKeyDown(e) {
    if (e.key === 'Escape') { hideAll(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement.classList.contains('pv-trigger')) {
      e.preventDefault();
      var t = document.activeElement;
      if (isTouch()) showSheet(t); else showPop(t);
    }
  }

  function onDocFocusIn(e) {
    var t = e.target;
    if (!t.classList.contains('pv-trigger')) { if (!t.closest('#pv-pop')) scheduleHide(); return; }
    cancelHide(); scheduleShow(t);
  }

  /* ── init (idempotent) ─────────────────────────────────────────────── */
  var listenersAttached = false;

  function init() {
    autoLink();
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener('mouseover',  onDocMouseOver);
    document.addEventListener('mouseout',   onDocMouseOut);
    document.addEventListener('click',      onDocClick);
    document.addEventListener('keydown',    onDocKeyDown);
    document.addEventListener('focusin',    onDocFocusIn);
  }

  /* ── Starlight uses view transitions: re-run autoLink on every nav ── */
  document.addEventListener('astro:page-load', init);
  if (document.readyState !== 'loading') { init(); }
  else { document.addEventListener('DOMContentLoaded', init); }

}());
