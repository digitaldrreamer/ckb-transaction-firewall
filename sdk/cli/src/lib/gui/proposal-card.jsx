// Proposal card — the most-reused unit in the app
// Two variants: full (default) and compact

const {
  TFW_Badge, TFW_StatusBadge, TFW_ActionPill, TFW_SeverityChip,
  TFW_VoteDots, TFW_SigDots, TFW_Address, TFW_ClassificationTag,
  TFW_trunc, TFW_fmtDate, TFW_fmtDateShort, TFW_relTime, TFW_reviewCountdown,
  TFW_countYes, TFW_sigCount, TFW_reviewPassed, TFW_isReady, TFW_displayStatus,
} = window;

function ProposalCard({ proposal, onOpen, onVote, onSign, onExecute, registry, compact = false }) {
  const p = proposal;
  const ds = TFW_displayStatus(p);
  const reg = registry.find(e => e.identifier.toLowerCase() === p.lockArgs.toLowerCase());
  const now = Date.now() / 1000;
  const isInReg = !!reg;
  const isExpReg = isInReg && reg.expiresAt && Number(reg.expiresAt) <= now;

  const review = TFW_reviewCountdown(p.reviewWindowEndsAt);
  const yes = TFW_countYes(p);
  const sigs = TFW_sigCount(p);

  // Determine primary action
  let primaryAction = null;
  if ((p.status === "pending-review" || p.status === "voting") && sigs === 0) {
    primaryAction = { label: "Vote", onClick: () => onVote(p.id) };
  } else if (TFW_isReady(p)) {
    primaryAction = { label: "Execute →", onClick: () => onExecute(p.id), strong: true };
  } else if (TFW_reviewPassed(p) && yes >= 3 && p.status !== "executed" && p.status !== "rejected") {
    primaryAction = { label: "Sign", onClick: () => onSign(p.id), strong: true };
  }

  // Card-state class for left accent stripe
  const stateClass = `tfw-card--${ds}`;

  return (
    <div className={`tfw-card ${stateClass}${compact ? " tfw-card--compact" : ""}`} onClick={() => onOpen(p.id)}>
      <div className="tfw-card__rule" />

      <div className="tfw-card__head">
        <div className="tfw-card__id tfw-mono">№ {p.id}</div>
        <TFW_ActionPill action={p.action} />
        <code className="tfw-card__addr tfw-mono">{TFW_trunc(p.lockArgs, 28)}</code>
        <span className="tfw-card__spacer" />
        <TFW_StatusBadge proposal={p} />
      </div>

      {!compact && (
        <div className="tfw-card__body">
          <div className="tfw-card__rationale">
            {p.rationale.length > 180 ? p.rationale.slice(0, 178) + "…" : p.rationale}
          </div>

          <div className="tfw-card__meta">
            <span className="tfw-card__meta-item">
              <TFW_ClassificationTag value={p.classification} />
            </span>
            <span className="tfw-card__meta-item">
              <TFW_SeverityChip severity={p.severity} />
            </span>
            <span className="tfw-card__meta-item tfw-card__meta-sep">
              <span className="tfw-card__meta-label">PROPOSER</span>
              <span className="tfw-mono">{p.proposer}</span>
            </span>
            <span className="tfw-card__meta-item">
              <span className="tfw-card__meta-label">SUBMITTED</span>
              <span className="tfw-mono">{TFW_relTime(p.submittedAt)}</span>
            </span>
            <span className="tfw-card__meta-item">
              <span className="tfw-card__meta-label">REVIEW</span>
              <span className={`tfw-mono ${review.done ? "tfw-card__review-done" : "tfw-card__review-open"}`}>
                {review.done ? "✓ complete" : `${review.text} left`}
              </span>
            </span>
          </div>
        </div>
      )}

      <div className="tfw-card__foot">
        <TFW_VoteDots proposal={p} />
        <span className="tfw-card__foot-sep" />
        <TFW_SigDots proposal={p} />
        <span className="tfw-card__spacer" />

        {/* registry hint */}
        {!isInReg && (
          <span className="tfw-card__reghint tfw-card__reghint--none">
            <span className="tfw-card__reg-dot" />
            not on chain
          </span>
        )}
        {isInReg && !isExpReg && (
          <span className="tfw-card__reghint tfw-card__reghint--active">
            <span className="tfw-card__reg-dot tfw-card__reg-dot--on" />
            on chain
          </span>
        )}
        {isInReg && isExpReg && (
          <span className="tfw-card__reghint tfw-card__reghint--expired">
            <span className="tfw-card__reg-dot tfw-card__reg-dot--exp" />
            entry expired
          </span>
        )}

        {primaryAction && (
          <button
            type="button"
            className={`tfw-card__act${primaryAction.strong ? " tfw-card__act--strong" : ""}`}
            onClick={(e) => { e.stopPropagation(); primaryAction.onClick(); }}
          >
            {primaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { TFW_ProposalCard: ProposalCard });
