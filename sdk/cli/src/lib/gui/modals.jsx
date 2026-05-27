// Modals: detail (proposal, address) and forms (create, vote, sign, execute, import)

const {
  TFW_Badge, TFW_StatusBadge, TFW_ActionPill, TFW_SeverityChip,
  TFW_VoteDots, TFW_SigDots, TFW_Address, TFW_ClassificationTag,
  TFW_CodeBlock, TFW_Stat,
  TFW_trunc, TFW_fmtDate, TFW_fmtDateShort, TFW_relTime, TFW_reviewCountdown,
  TFW_countYes, TFW_countNo, TFW_countAbstain, TFW_sigCount,
  TFW_reviewPassed, TFW_isReady, TFW_displayStatus,
} = window;

// ─── Modal shell ─────────────────────────────────────────────────────────────
function Modal({ open, onClose, eyebrow, title, subtitle, children, size = "md", footer }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="tfw-overlay" onClick={onClose}>
      <div
        className={`tfw-modal tfw-modal--${size}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="tfw-modal__head">
          <div className="tfw-modal__head-text">
            {eyebrow && <div className="tfw-modal__eyebrow">{eyebrow}</div>}
            <div className="tfw-modal__title">{title}</div>
            {subtitle && <div className="tfw-modal__subtitle">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="tfw-modal__close"
            onClick={onClose}
            aria-label="Close"
          >✕</button>
        </div>
        <div className="tfw-modal__body">{children}</div>
        {footer && <div className="tfw-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Proposal detail content ─────────────────────────────────────────────────
function ProposalDetailContent({ proposal, registry, actions, onClose }) {
  const p = proposal;
  const reg = registry.find(e => e.identifier.toLowerCase() === p.lockArgs.toLowerCase());
  const now = Date.now() / 1000;
  const inReg = !!reg;
  const isExpReg = inReg && reg.expiresAt && Number(reg.expiresAt) <= now;

  const yes = TFW_countYes(p);
  const no = TFW_countNo(p);
  const abs = TFW_countAbstain(p);
  const sigs = TFW_sigCount(p);
  const review = TFW_reviewCountdown(p.reviewWindowEndsAt);
  const ds = TFW_displayStatus(p);

  // pipeline steps
  const steps = [
    { key: "submit",   label: "Submitted",    done: true },
    { key: "review",   label: "Review",       done: TFW_reviewPassed(p), active: !TFW_reviewPassed(p) },
    { key: "vote",     label: "Vote",         done: yes >= 3, active: TFW_reviewPassed(p) && yes < 3 },
    { key: "sign",     label: "Multisig",     done: sigs >= 3, active: TFW_reviewPassed(p) && yes >= 3 && sigs < 3 },
    { key: "execute",  label: "Executed",     done: p.status === "executed", active: TFW_isReady(p) },
  ];
  if (p.status === "rejected") {
    steps[2] = { key: "vote", label: "Vote", done: false, rejected: true };
    steps[3] = { key: "sign", label: "Multisig", done: false };
    steps[4] = { key: "execute", label: "Rejected", done: false, rejected: true };
  }

  // primary actions
  const buttons = [];
  if ((p.status === "pending-review" || p.status === "voting") && sigs === 0) {
    buttons.push(
      <button key="vote" type="button" className="tfw-btn tfw-btn--primary"
              onClick={() => { onClose(); actions.openVote(p.id); }}>
        Cast vote
      </button>
    );
  }
  if (TFW_reviewPassed(p) && yes >= 3 && p.status !== "executed" && p.status !== "rejected" && !TFW_isReady(p)) {
    buttons.push(
      <button key="sign" type="button" className="tfw-btn tfw-btn--accent"
              onClick={() => { onClose(); actions.openSign(p.id); }}>
        Sign
      </button>
    );
  }
  if (TFW_isReady(p)) {
    buttons.push(
      <button key="exec" type="button" className="tfw-btn tfw-btn--accent"
              onClick={() => { onClose(); actions.openExecute(p.id); }}>
        Build &amp; download TX
      </button>
    );
  }
  buttons.push(
    <button key="export" type="button" className="tfw-btn tfw-btn--ghost"
            onClick={() => actions.exportProposal(p)}>
      ↓ Export JSON
    </button>
  );

  return (
    <div className="tfw-detail">

      {/* Pipeline */}
      <div className="tfw-pipeline">
        {steps.map((s, i) => (
          <React.Fragment key={s.key}>
            <div className={`tfw-pipe-step${s.done ? " tfw-pipe-step--done" : ""}${s.active ? " tfw-pipe-step--active" : ""}${s.rejected ? " tfw-pipe-step--rejected" : ""}`}>
              <div className="tfw-pipe-step__circle">
                {s.done ? "✓" : s.rejected ? "✕" : i + 1}
              </div>
              <div className="tfw-pipe-step__label">{s.label}</div>
            </div>
            {i < steps.length - 1 && (
              <div className={`tfw-pipe-conn${s.done ? " tfw-pipe-conn--done" : ""}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Top dossier */}
      <div className="tfw-dossier">
        <div className="tfw-dossier__row">
          <div className="tfw-dossier__label">ACTION</div>
          <div className="tfw-dossier__val"><TFW_ActionPill action={p.action} /></div>
        </div>
        <div className="tfw-dossier__row">
          <div className="tfw-dossier__label">LOCK ARGS</div>
          <div className="tfw-dossier__val tfw-mono tfw-dossier__addr">
            {p.lockArgs}
            <button
              type="button"
              className="tfw-dossier__copy"
              onClick={() => navigator.clipboard?.writeText(p.lockArgs)}
              title="Copy"
            >⎘</button>
          </div>
        </div>
        <div className="tfw-dossier__row">
          <div className="tfw-dossier__label">REGISTRY</div>
          <div className="tfw-dossier__val">
            {!inReg && <span className="tfw-dossier__none">Not on chain</span>}
            {inReg && isExpReg && (
              <TFW_Badge tone="red" size="sm">
                expired — {TFW_fmtDateShort(new Date(Number(reg.expiresAt) * 1000).toISOString())}
              </TFW_Badge>
            )}
            {inReg && !isExpReg && reg.expiresAt && (
              <TFW_Badge tone="green" size="sm">
                active — expires {TFW_fmtDateShort(new Date(Number(reg.expiresAt) * 1000).toISOString())}
              </TFW_Badge>
            )}
            {inReg && !isExpReg && !reg.expiresAt && (
              <TFW_Badge tone="green" size="sm">active — permanent</TFW_Badge>
            )}
          </div>
        </div>
        <div className="tfw-dossier__row">
          <div className="tfw-dossier__label">SEVERITY</div>
          <div className="tfw-dossier__val">
            <TFW_ClassificationTag value={p.classification} />
            <span style={{ marginLeft: 8 }}><TFW_SeverityChip severity={p.severity} /></span>
          </div>
        </div>
        <div className="tfw-dossier__row">
          <div className="tfw-dossier__label">PROPOSER</div>
          <div className="tfw-dossier__val tfw-mono">{p.proposer}</div>
        </div>
        <div className="tfw-dossier__row">
          <div className="tfw-dossier__label">SUBMITTED</div>
          <div className="tfw-dossier__val tfw-mono">{TFW_fmtDate(p.submittedAt)} ({TFW_relTime(p.submittedAt)})</div>
        </div>
        <div className="tfw-dossier__row">
          <div className="tfw-dossier__label">REVIEW ENDS</div>
          <div className="tfw-dossier__val tfw-mono">
            {TFW_fmtDate(p.reviewWindowEndsAt)}
            {!review.done && <span style={{ color: "var(--c-amber)", marginLeft: 8 }}>({review.text} left)</span>}
            {review.done && <span style={{ color: "var(--c-green)", marginLeft: 8 }}>(complete)</span>}
          </div>
        </div>
        {p.expiresAt && p.expiresAt !== "0" && (
          <div className="tfw-dossier__row">
            <div className="tfw-dossier__label">ENTRY EXPIRES</div>
            <div className="tfw-dossier__val tfw-mono">
              {TFW_fmtDate(new Date(Number(p.expiresAt) * 1000).toISOString())}
            </div>
          </div>
        )}
        {p.txHash && (
          <div className="tfw-dossier__row">
            <div className="tfw-dossier__label">TX HASH</div>
            <div className="tfw-dossier__val tfw-mono tfw-dossier__addr">{p.txHash}</div>
          </div>
        )}
      </div>

      {/* Evidence */}
      {p.evidence && (
        <div className="tfw-detail-sec">
          <div className="tfw-detail-sec__head">EVIDENCE</div>
          {/^https?:\/\//.test(p.evidence) ? (
            <a className="tfw-link" href={p.evidence} target="_blank" rel="noopener">{p.evidence} ↗</a>
          ) : (
            <p className="tfw-detail-sec__body">{p.evidence}</p>
          )}
        </div>
      )}

      {/* Rationale */}
      {p.rationale && (
        <div className="tfw-detail-sec">
          <div className="tfw-detail-sec__head">RATIONALE</div>
          <p className="tfw-detail-sec__body tfw-detail-sec__body--prose">{p.rationale}</p>
        </div>
      )}

      {/* Votes */}
      <div className="tfw-detail-sec">
        <div className="tfw-detail-sec__head">
          VOTES
          <span className="tfw-detail-sec__meta">
            <span className="tfw-vc tfw-vc--y">{yes} yes</span>
            <span className="tfw-vc tfw-vc--n">{no} no</span>
            <span className="tfw-vc tfw-vc--a">{abs} abstain</span>
          </span>
        </div>
        {(p.votes || []).length === 0 ? (
          <div className="tfw-detail-sec__empty">No votes yet.</div>
        ) : (
          <div className="tfw-list">
            {p.votes.map((v, i) => (
              <div key={i} className="tfw-list-row">
                <div className={`tfw-list-row__choice tfw-list-row__choice--${v.vote}`}>
                  {v.vote === "yes" ? "✓ YES" : v.vote === "no" ? "✕ NO" : "— ABSTAIN"}
                </div>
                <code className="tfw-mono tfw-list-row__id">{TFW_trunc(v.pubkey, 30)}</code>
                <span className="tfw-list-row__time">{TFW_fmtDate(v.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Signatures */}
      <div className="tfw-detail-sec">
        <div className="tfw-detail-sec__head">
          SIGNATURES <span className="tfw-detail-sec__meta">{sigs} / 3 required</span>
        </div>
        {sigs === 0 ? (
          <div className="tfw-detail-sec__empty">No signatures yet.</div>
        ) : (
          <div className="tfw-list">
            {p.signatures.map((s, i) => (
              <div key={i} className="tfw-list-row">
                <div className="tfw-list-row__sigidx tfw-mono">SIGNER #{s.signerIndex}</div>
                <code className="tfw-mono tfw-list-row__id">{TFW_trunc(s.signature, 34)}</code>
                <span className="tfw-list-row__time">{TFW_fmtDate(s.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CLI commands */}
      <div className="tfw-detail-sec">
        <div className="tfw-detail-sec__head">CLI COMMANDS</div>
        {(p.status === "pending-review" || p.status === "voting") && (
          <TFW_CodeBlock label="Vote on this proposal">{`ckb-firewall vote --proposal ${p.id}`}</TFW_CodeBlock>
        )}
        {(p.status === "approved" || (TFW_reviewPassed(p) && yes >= 3)) && p.status !== "executed" && (
          <TFW_CodeBlock label="Sign (3-of-5 required)">{`ckb-firewall sign --proposal ${p.id}`}</TFW_CodeBlock>
        )}
        {TFW_isReady(p) && (
          <TFW_CodeBlock label="Execute on-chain">{`ckb-firewall execute --proposal ${p.id}`}</TFW_CodeBlock>
        )}
        <TFW_CodeBlock label="Export JSON">{`ckb-firewall export --proposal ${p.id} --out proposal-${p.id}.json`}</TFW_CodeBlock>
        <TFW_CodeBlock label="Check this address in registry">{`ckb-firewall check --lock-args ${p.lockArgs}`}</TFW_CodeBlock>
      </div>

      {/* Action bar */}
      <div className="tfw-detail-actions">{buttons}</div>
    </div>
  );
}

// ─── Address detail content ─────────────────────────────────────────────────
function AddressDetailContent({ identifier, registry, proposals, actions }) {
  const reg = registry.find(e => e.identifier.toLowerCase() === identifier.toLowerCase());
  const related = proposals.filter(p => p.lockArgs.toLowerCase() === identifier.toLowerCase())
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const now = Date.now() / 1000;
  const exp = reg && reg.expiresAt ? Number(reg.expiresAt) : null;
  const isExp = exp && exp <= now;

  return (
    <div className="tfw-detail">
      <div className="tfw-detail-sec">
        <div className="tfw-detail-sec__head">IDENTIFIER</div>
        <div className="tfw-cmd">
          <div className="tfw-cmd__row">
            <code className="tfw-cmd__text tfw-mono">{identifier}</code>
            <button
              type="button"
              className="tfw-cmd__copy"
              onClick={() => navigator.clipboard?.writeText(identifier)}
            >COPY</button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {!reg && <span className="tfw-dossier__none">Not currently on chain</span>}
          {reg && isExp && (
            <TFW_Badge tone="red" size="md">
              Expired — {TFW_fmtDateShort(new Date(exp * 1000).toISOString())}
            </TFW_Badge>
          )}
          {reg && !isExp && exp && (
            <TFW_Badge tone="green" size="md">
              Active — expires {TFW_fmtDateShort(new Date(exp * 1000).toISOString())}
            </TFW_Badge>
          )}
          {reg && !isExp && !exp && (
            <TFW_Badge tone="green" size="md">Active — permanent</TFW_Badge>
          )}
        </div>
      </div>

      <div className="tfw-detail-sec">
        <div className="tfw-detail-sec__head">CLI</div>
        <TFW_CodeBlock label="Check this address">{`ckb-firewall check --lock-args ${identifier}`}</TFW_CodeBlock>
      </div>

      {related.length > 0 && (
        <div className="tfw-detail-sec">
          <div className="tfw-detail-sec__head">
            GOVERNANCE HISTORY <span className="tfw-detail-sec__meta">{related.length} proposal{related.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="tfw-list">
            {related.map(p => (
              <div
                key={p.id}
                className="tfw-list-row tfw-list-row--clickable"
                onClick={() => actions.openProposal(p.id)}
              >
                <span className="tfw-list-row__sigidx tfw-mono">№ {p.id}</span>
                <span className="tfw-list-row__action">
                  <TFW_ActionPill action={p.action} />
                </span>
                <span className="tfw-list-row__time">{TFW_fmtDate(p.submittedAt)}</span>
                <span style={{ marginLeft: "auto" }}>
                  <TFW_StatusBadge proposal={p} size="sm" />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Form helpers ────────────────────────────────────────────────────────────
function FormField({ label, hint, error, children }) {
  return (
    <div className="tfw-field">
      <label className="tfw-field__label">
        {label}
        {hint && <span className="tfw-field__hint"> · {hint}</span>}
      </label>
      {children}
      {error && <div className="tfw-field__err">{error}</div>}
    </div>
  );
}

function SecurityNote({ kind = "info", children }) {
  return (
    <div className={`tfw-note tfw-note--${kind}`}>
      <span className="tfw-note__icon">{kind === "warn" ? "⚠" : kind === "tip" ? "★" : "🔒"}</span>
      <span>{children}</span>
    </div>
  );
}

// ─── Create proposal form ───────────────────────────────────────────────────
function CreateForm({ onSubmit, onClose }) {
  const [action, setAction] = React.useState("add");
  const [lockArgs, setLockArgs] = React.useState("");
  const [classification, setClassification] = React.useState("theft");
  const [severity, setSeverity] = React.useState("critical");
  const [evidence, setEvidence] = React.useState("");
  const [rationale, setRationale] = React.useState("");
  const [proposer, setProposer] = React.useState("");
  const [expires, setExpires] = React.useState("0");
  const [errors, setErrors] = React.useState({});
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const validate = () => {
    const e = {};
    if (!/^0x[0-9a-fA-F]{2,}$/.test(lockArgs.trim())) e.lockArgs = "Must be 0x-prefixed hex";
    if ((rationale.trim()).length < 20) e.rationale = "Need at least 20 characters";
    if (!proposer.trim()) e.proposer = "Required";
    if (!evidence.trim()) e.evidence = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    setSubmitting(true);
    fetch('/api/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, lockArgs: lockArgs.trim(), classification, severity,
        evidence: evidence.trim(), rationale: rationale.trim(), proposer: proposer.trim(),
        expiresAt: action === 'add' ? expires : '0' }) })
      .then(r => r.json())
      .then(d => {
        setSubmitting(false);
        if (!d.ok) { setErrors({ proposer: d.error || 'Server error' }); return; }
        onSubmit(d.proposal);
        setSuccess(true);
        setTimeout(onClose, 1100);
      })
      .catch(e => { setSubmitting(false); setErrors({ proposer: e.message }); });
  };

  if (success) {
    return (
      <div className="tfw-form-success">
        <div className="tfw-form-success__glyph">✓</div>
        <div className="tfw-form-success__title">Proposal created</div>
        <div className="tfw-form-success__sub">It will appear in the queue momentarily.</div>
      </div>
    );
  }

  return (
    <div className="tfw-form">
      <SecurityNote kind="info">
        Proposals are stored locally. Nothing is written on-chain until the full governance process completes and you execute the transaction.
      </SecurityNote>

      <FormField label="Action">
        <div className="tfw-radio-grp">
          <label className={`tfw-radio-card${action === "add" ? " tfw-radio-card--checked" : ""}`}>
            <input type="radio" name="action" value="add" checked={action === "add"}
                   onChange={() => setAction("add")} />
            <span className="tfw-radio-card__glyph" style={{ color: "var(--c-red)" }}>+</span>
            <span className="tfw-radio-card__label">Add to blacklist</span>
          </label>
          <label className={`tfw-radio-card${action === "remove" ? " tfw-radio-card--checked" : ""}`}>
            <input type="radio" name="action" value="remove" checked={action === "remove"}
                   onChange={() => setAction("remove")} />
            <span className="tfw-radio-card__glyph" style={{ color: "var(--c-green)" }}>−</span>
            <span className="tfw-radio-card__label">Remove from blacklist</span>
          </label>
        </div>
      </FormField>

      <FormField label="Lock args" hint="0x-prefixed hex" error={errors.lockArgs}>
        <input
          type="text"
          className="tfw-input tfw-mono"
          value={lockArgs}
          onChange={e => setLockArgs(e.target.value)}
          placeholder="0xabc123…"
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>

      <div className="tfw-form-row">
        <FormField label="Classification">
          <select className="tfw-input" value={classification} onChange={e => setClassification(e.target.value)}>
            <option value="theft">theft</option>
            <option value="scam">scam</option>
            <option value="hack">hack</option>
            <option value="sanctions">sanctions</option>
            <option value="other">other</option>
          </select>
        </FormField>
        <FormField label="Severity">
          <select className="tfw-input" value={severity} onChange={e => setSeverity(e.target.value)}>
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </FormField>
      </div>

      <FormField label="Evidence" hint="URL or description" error={errors.evidence}>
        <textarea
          className="tfw-input"
          rows="2"
          value={evidence}
          onChange={e => setEvidence(e.target.value)}
          placeholder="https://… or describe forensic evidence"
        />
      </FormField>

      <FormField label="Rationale" hint="≥ 20 characters" error={errors.rationale}>
        <textarea
          className="tfw-input"
          rows="3"
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          placeholder="Why should this address be added/removed…"
        />
      </FormField>

      <div className="tfw-form-row">
        <FormField label="Proposer" hint="your handle" error={errors.proposer}>
          <input
            type="text"
            className="tfw-input"
            value={proposer}
            onChange={e => setProposer(e.target.value)}
            placeholder="e.g. alice"
          />
        </FormField>
        {action === "add" && (
          <FormField label="Expires at" hint="unix timestamp, 0 = never">
            <input
              type="number"
              className="tfw-input tfw-mono"
              value={expires}
              min="0"
              onChange={e => setExpires(e.target.value)}
            />
          </FormField>
        )}
      </div>

      <div className="tfw-form-actions">
        <button type="button" className="tfw-btn tfw-btn--ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="tfw-btn tfw-btn--primary"
          onClick={submit}
          disabled={submitting}
        >
          {submitting ? "Creating…" : "Create proposal"}
        </button>
      </div>
    </div>
  );
}

// ─── Vote form ───────────────────────────────────────────────────────────────
function VoteForm({ proposal, meta, onSubmit, onClose }) {
  const [choice, setChoice] = React.useState("yes");
  const [pk, setPk] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const submit = () => {
    setError("");
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk.trim())) {
      setError("Private key must be 0x + 64 hex chars");
      return;
    }
    setSubmitting(true);
    fetch('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: proposal.id, vote: choice, privateKey: pk.trim() }) })
      .then(r => r.json())
      .then(d => {
        setSubmitting(false);
        setPk("");
        if (!d.ok) { setError(d.error || 'Server error'); return; }
        onSubmit({ proposalId: proposal.id, vote: choice, pubkey: d.pubkey || '', timestamp: new Date().toISOString() });
        setSuccess(true);
        setTimeout(onClose, 1100);
      })
      .catch(e => { setSubmitting(false); setPk(""); setError(e.message); });
  };

  if (success) {
    return (
      <div className="tfw-form-success">
        <div className="tfw-form-success__glyph">✓</div>
        <div className="tfw-form-success__title">Vote recorded</div>
        <div className="tfw-form-success__sub">Your {choice.toUpperCase()} vote has been added.</div>
      </div>
    );
  }

  return (
    <div className="tfw-form">
      <SecurityNote kind="warn">
        Your private key is used <strong>only locally</strong> and zeroed immediately after signing.
        It is never stored, logged, or transmitted.
      </SecurityNote>

      <FormField label="Your vote">
        <div className="tfw-radio-grp tfw-radio-grp--3">
          {[
            { v: "yes", label: "✓ Yes", color: "var(--c-green)" },
            { v: "no", label: "✕ No", color: "var(--c-red)" },
            { v: "abstain", label: "— Abstain", color: "var(--c-amber)" },
          ].map(o => (
            <label
              key={o.v}
              className={`tfw-radio-card${choice === o.v ? " tfw-radio-card--checked" : ""}`}
              style={choice === o.v ? { borderColor: o.color } : null}
            >
              <input type="radio" name="vote" value={o.v} checked={choice === o.v}
                     onChange={() => setChoice(o.v)} />
              <span className="tfw-radio-card__label" style={{ color: choice === o.v ? o.color : null }}>
                {o.label}
              </span>
            </label>
          ))}
        </div>
      </FormField>

      <FormField label="Private key" hint="32 bytes, hex" error={error}>
        <input
          type="password"
          className="tfw-input tfw-mono"
          value={pk}
          onChange={e => setPk(e.target.value)}
          placeholder="0x… (64 hex chars)"
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>

      <div className="tfw-form-actions">
        <button type="button" className="tfw-btn tfw-btn--ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="tfw-btn tfw-btn--primary"
          onClick={submit}
          disabled={submitting}
        >
          {submitting ? "Signing…" : "Cast vote"}
        </button>
      </div>
    </div>
  );
}

// ─── Sign form ───────────────────────────────────────────────────────────────
function SignForm({ proposal, meta, onSubmit, onClose }) {
  const [idx, setIdx] = React.useState(String(meta.yourSignerIndex || 0));
  const [pk, setPk] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const submit = () => {
    setError("");
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i > 4) {
      setError("Signer index must be 0–4");
      return;
    }
    if ((proposal.signatures || []).some(s => s.signerIndex === i)) {
      setError("Signer #" + i + " has already signed.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk.trim())) {
      setError("Private key must be 0x + 64 hex chars");
      return;
    }
    setSubmitting(true);
    fetch('/api/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: proposal.id, signerIndex: i, privateKey: pk.trim() }) })
      .then(r => r.json())
      .then(d => {
        setSubmitting(false);
        setPk("");
        if (!d.ok) { setError(d.error || 'Server error'); return; }
        onSubmit({ proposalId: proposal.id, signerIndex: i, signature: d.signature || '', timestamp: new Date().toISOString() });
        setSuccess(true);
        setTimeout(onClose, 1100);
      })
      .catch(e => { setSubmitting(false); setPk(""); setError(e.message); });
  };

  if (success) {
    return (
      <div className="tfw-form-success">
        <div className="tfw-form-success__glyph">✓</div>
        <div className="tfw-form-success__title">Signature added</div>
        <div className="tfw-form-success__sub">Signature recorded.</div>
      </div>
    );
  }

  return (
    <div className="tfw-form">
      <SecurityNote kind="warn">
        Your private key is used only locally and zeroed immediately after signing. It is never stored, logged, or transmitted.
      </SecurityNote>

      <FormField label="Signer index" hint="0–4, your slot in the 5-key governance set">
        <input
          type="number"
          className="tfw-input tfw-mono"
          min="0"
          max="4"
          value={idx}
          onChange={e => setIdx(e.target.value)}
        />
      </FormField>

      <FormField label="Private key" hint="32 bytes, hex" error={error}>
        <input
          type="password"
          className="tfw-input tfw-mono"
          value={pk}
          onChange={e => setPk(e.target.value)}
          placeholder="0x… (64 hex chars)"
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>

      <div className="tfw-form-actions">
        <button type="button" className="tfw-btn tfw-btn--ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="tfw-btn tfw-btn--accent"
          onClick={submit}
          disabled={submitting}
        >
          {submitting ? "Signing…" : "Sign proposal"}
        </button>
      </div>
    </div>
  );
}

// ─── Execute form ────────────────────────────────────────────────────────────
function ExecuteForm({ proposal, onSubmit, onClose }) {
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const submit = () => {
    setSubmitting(true);
    fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: proposal.id }) })
      .then(r => r.json())
      .then(d => {
        setSubmitting(false);
        if (!d.ok) { setDone({ error: d.error || 'Server error' }); return; }
        const blob = new Blob([JSON.stringify(d.txJson, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = d.filename || ('gov_execute_tx_' + proposal.id + '.json');
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        onSubmit(proposal.id);
        setDone(true);
        setTimeout(onClose, 1500);
      })
      .catch(e => { setSubmitting(false); setDone({ error: e.message }); });
  };

  if (done) {
    return (
      <div className="tfw-form-success">
        <div className="tfw-form-success__glyph">↓</div>
        <div className="tfw-form-success__title">Transaction downloaded</div>
        <div className="tfw-form-success__sub">
          Broadcast <code className="tfw-mono">gov_execute_tx_{proposal.id}.json</code> via ckb-cli
          or your wallet to submit it to the network.
        </div>
      </div>
    );
  }

  return (
    <div className="tfw-form">
      <SecurityNote kind="tip">
        This verifies all 3 signatures, builds the on-chain transaction JSON, and downloads it.
        Submit it via <code className="tfw-mono">ckb-cli</code> or a CKB wallet.
      </SecurityNote>

      <div className="tfw-exec-preview">
        <div className="tfw-exec-preview__row">
          <span>Action</span>
          <span><TFW_ActionPill action={proposal.action} /></span>
        </div>
        <div className="tfw-exec-preview__row">
          <span>Target</span>
          <code className="tfw-mono" style={{ fontSize: "11px" }}>{TFW_trunc(proposal.lockArgs, 28)}</code>
        </div>
        <div className="tfw-exec-preview__row">
          <span>Signatures verified</span>
          <span className="tfw-mono">{TFW_sigCount(proposal)} / 3</span>
        </div>
        <div className="tfw-exec-preview__row">
          <span>Output file</span>
          <code className="tfw-mono">gov_execute_tx_{proposal.id}.json</code>
        </div>
      </div>

      <div className="tfw-form-actions">
        <button type="button" className="tfw-btn tfw-btn--ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="tfw-btn tfw-btn--accent"
          onClick={submit}
          disabled={submitting}
        >
          {submitting ? "Building…" : "Build & download TX"}
        </button>
      </div>
    </div>
  );
}

// ─── Import form ────────────────────────────────────────────────────────────
function ImportForm({ onSubmit, onClose }) {
  const [json, setJson] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setJson(ev.target.result);
    r.readAsText(f);
  };

  const submit = () => {
    setError("");
    if (!json.trim()) { setError("Paste or upload a proposal JSON first."); return; }
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { setError("Invalid JSON: " + e.message); return; }
    setSubmitting(true);
    fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed) })
      .then(r => r.json())
      .then(d => {
        setSubmitting(false);
        if (!d.ok) { setError(d.error || 'Server error'); return; }
        onSubmit(parsed);
        setSuccess(true);
        setTimeout(onClose, 1100);
      })
      .catch(e => { setSubmitting(false); setError(e.message); });
  };

  if (success) {
    return (
      <div className="tfw-form-success">
        <div className="tfw-form-success__glyph">↥</div>
        <div className="tfw-form-success__title">Proposal imported</div>
        <div className="tfw-form-success__sub">Merged any new votes or signatures.</div>
      </div>
    );
  }

  return (
    <div className="tfw-form">
      <SecurityNote kind="info">
        Paste or upload a proposal JSON exported by another governance participant.
        Votes and signatures will be merged.
      </SecurityNote>

      <FormField label="Upload JSON file">
        <input
          type="file"
          accept=".json,application/json"
          className="tfw-input"
          onChange={onFile}
        />
      </FormField>

      <FormField label="…or paste JSON" hint="full proposal object" error={error}>
        <textarea
          className="tfw-input tfw-mono"
          rows="10"
          value={json}
          onChange={e => setJson(e.target.value)}
          placeholder={'{"id":"0xff","lockArgs":"0x…","action":"add",…}'}
          style={{ fontSize: "11px" }}
        />
      </FormField>

      <div className="tfw-form-actions">
        <button type="button" className="tfw-btn tfw-btn--ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="tfw-btn tfw-btn--primary"
          onClick={submit}
          disabled={submitting}
        >
          {submitting ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}

Object.assign(window, {
  TFW_Modal: Modal,
  TFW_ProposalDetailContent: ProposalDetailContent,
  TFW_AddressDetailContent: AddressDetailContent,
  TFW_CreateForm: CreateForm,
  TFW_VoteForm: VoteForm,
  TFW_SignForm: SignForm,
  TFW_ExecuteForm: ExecuteForm,
  TFW_ImportForm: ImportForm,
});
