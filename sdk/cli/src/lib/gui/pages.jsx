// Pages: Overview, Registry, Proposals
// Each is a self-contained component receiving { state, dispatch } props

const {
  TFW_ProposalCard, TFW_Stat, TFW_SectionHead, TFW_EmptyState,
  TFW_Badge, TFW_VoteDots, TFW_StatusBadge, TFW_ActionPill,
  TFW_ClassificationTag, TFW_SeverityChip, TFW_Address,
  TFW_isReady, TFW_displayStatus, TFW_countYes,
  TFW_reviewPassed, TFW_relTime, TFW_fmtDateShort, TFW_trunc,
} = window;

const TFW_SHANNONS_PER_CKB = 100_000_000;

function TFW_fmtCkbFromShannons(value) {
  if (value === undefined || value === null || value === "") return "n/a";
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  return `${(n / TFW_SHANNONS_PER_CKB).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })} CKB`;
}

function TFW_TreasuryBanner({ treasury, compact = false }) {
  if (!treasury) return null;
  const used = typeof treasury.poolUsedPercent === "number" ? treasury.poolUsedPercent : null;
  const warning = Boolean(treasury.donateRecommended);
  const donationTarget = treasury.donationAddress || treasury.lockHash;
  const balance = TFW_fmtCkbFromShannons(treasury.balanceShannons);
  const capacity = TFW_fmtCkbFromShannons(treasury.poolCapacityShannons);
  return (
    <div className={`tfw-treasury${warning ? " tfw-treasury--warn" : ""}${compact ? " tfw-treasury--compact" : ""}`}>
      <div className="tfw-treasury__main">
        <div className="tfw-treasury__eyebrow">BLACKLIST POOL</div>
        <div className="tfw-treasury__line">
          <strong>{used === null ? "Usage unavailable" : `${used.toFixed(2)}% used`}</strong>
          <span>Reserve {balance}</span>
          <span>Pool {capacity}</span>
          {typeof treasury.liveCellCount === "number" && <span>{treasury.liveCellCount} treasury cell{treasury.liveCellCount === 1 ? "" : "s"}</span>}
        </div>
      </div>
      <div className="tfw-treasury__meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(0, used || 0))}%` }} />
      </div>
      {warning && (
        <div className="tfw-treasury__donate">
          <span>Donate CKB to keep registry growth funded</span>
          <code className="tfw-mono">{donationTarget}</code>
        </div>
      )}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewPage({ state, actions }) {
  const { proposals, registry, meta } = state;
  const now = Date.now() / 1000;
  const reg = registry || [];

  const activeReg = reg.filter(e => !e.expiresAt || Number(e.expiresAt) > now).length;
  const expiredReg = reg.filter(e => e.expiresAt && Number(e.expiresAt) <= now).length;

  const open = proposals.filter(p => p.status === "pending-review" || p.status === "voting");
  const yourPk = (meta?.yourPubkey || "").toLowerCase();
  const action = open.filter(p => !yourPk || !(p.votes || []).some(v => (v.pubkey || "").toLowerCase() === yourPk));
  const recent = [...proposals]
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 6);

  // your-vote indicators
  const youHaventVoted = open.filter(p => !yourPk || !(p.votes || []).some(v => (v.pubkey || "").toLowerCase() === yourPk));

  return (
    <div className="tfw-page tfw-page--overview">

      <TFW_TreasuryBanner treasury={meta.treasury} />

      {meta.registryError && (
        <div className="tfw-note tfw-note--warn" style={{ marginBottom: "var(--sp-4, 16px)" }}>
          <span className="tfw-note__icon">⚠</span>
          <span>Registry unavailable — {meta.registryError}</span>
        </div>
      )}

      {/* HERO STRIP — editorial-sized stats */}
      <div className="tfw-hero">
        <div className="tfw-hero__lead">
          <div className="tfw-hero__eyebrow">VALIDATOR STATUS · {new Date().toISOString().slice(0,10)}</div>
          <h1 className="tfw-hero__title">
            <span className="tfw-hero__title-line1">{activeReg === 0 ? "Registry" : "Blocking"}</span>
            <span className="tfw-hero__title-line2">
              {activeReg === 0 ? "is empty." : (
                <>{" "}<em className="tfw-hero__count">{activeReg}</em>{" "}{activeReg === 1 ? "address." : "addresses."}</>
              )}
            </span>
          </h1>
          <div className="tfw-hero__sub">
            {action.length > 0 ? (
              <>
                <strong>{action.length} proposal{action.length !== 1 ? "s" : ""}</strong> need
                {action.length === 1 ? "s" : ""} votes.
                {yourPk && youHaventVoted.length > 0 && (
                  <> You haven&rsquo;t voted on <strong>{youHaventVoted.length}</strong>.</>
                )}
              </>
            ) : (
              <>All clear. No proposals need votes right now.</>
            )}
          </div>
        </div>

        <div className="tfw-hero__stats">
          <TFW_Stat
            value={activeReg}
            label="ACTIVE ENTRIES"
            sub={expiredReg ? `${expiredReg} expired` : "on chain"}
          />
          <TFW_Stat
            value={open.length}
            label="OPEN FOR VOTE"
            tone="amber"
            sub={yourPk ? (youHaventVoted.length ? `${youHaventVoted.length} need you` : "all caught up") : (open.length ? "needs votes" : "none open")}
          />
        </div>
      </div>

      {/* VOTES NEEDED */}
      {action.length > 0 && (
        <div className="tfw-section">
          <TFW_SectionHead
            eyebrow="◆ PRIORITY"
            title="Votes needed"
            count={action.length}
            action={
              <button type="button" className="tfw-link" onClick={() => actions.setTab("proposals")}>
                See all proposals →
              </button>
            }
          />
          <div className="tfw-cards">
            {action.map(p => (
              <TFW_ProposalCard
                key={p.id}
                proposal={p}
                registry={registry}
                meta={meta}
                onOpen={actions.openProposal}
                onVote={actions.openVote}
                onAnchor={actions.openAnchor}
                onExecute={actions.openExecute}
              />
            ))}
          </div>
        </div>
      )}

      {/* RECENT */}
      <div className="tfw-section">
        <TFW_SectionHead
          eyebrow="○ ACTIVITY"
          title="Recent proposals"
          count={recent.length}
        />
        {recent.length === 0 ? (
          <TFW_EmptyState title="No proposals yet" sub="Create one to get started." />
        ) : (
          <div className="tfw-cards">
            {recent.map(p => (
              <TFW_ProposalCard
                key={p.id}
                proposal={p}
                registry={registry}
                meta={meta}
                onOpen={actions.openProposal}
                onVote={actions.openVote}
                onAnchor={actions.openAnchor}
                onExecute={actions.openExecute}
                compact
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────
function RegistryPage({ state, actions }) {
  const { registry, proposals, meta } = state;
  const reg = registry || [];

  const [query, setQuery] = React.useState("");
  const [showExpired, setShowExpired] = React.useState(false);
  const [sort, setSort] = React.useState("added"); // "added" | "expires"

  const now = Date.now() / 1000;

  // proposals indexed by address
  const propsByAddr = React.useMemo(() => {
    const m = {};
    proposals.forEach(p => {
      const k = (p.lockArgs || "").toLowerCase();
      if (!m[k]) m[k] = [];
      m[k].push(p);
    });
    return m;
  }, [proposals]);

  const filtered = reg
    .filter(e => {
      const exp = e.expiresAt ? Number(e.expiresAt) : null;
      const isExp = exp && exp <= now;
      if (!showExpired && isExp) return false;
      if (query && !e.identifier.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "added") {
        return Number(b.addedAt || 0) - Number(a.addedAt || 0);
      }
      const aE = a.expiresAt ? Number(a.expiresAt) : Infinity;
      const bE = b.expiresAt ? Number(b.expiresAt) : Infinity;
      return aE - bE;
    });

  const totalActive = reg.filter(e => !e.expiresAt || Number(e.expiresAt) > now).length;
  const totalExpired = reg.filter(e => e.expiresAt && Number(e.expiresAt) <= now).length;

  return (
    <div className="tfw-page tfw-page--registry">
      <TFW_TreasuryBanner treasury={meta.treasury} compact />

      {meta.registryError && (
        <div className="tfw-note tfw-note--warn" style={{ marginBottom: "var(--sp-4, 16px)" }}>
          <span className="tfw-note__icon">⚠</span>
          <span>Registry unavailable — {meta.registryError}</span>
        </div>
      )}

      <div className="tfw-pagehead">
        <div className="tfw-pagehead__col">
          <div className="tfw-pagehead__eyebrow">ON-CHAIN STATE</div>
          <h1 className="tfw-pagehead__title">Registry</h1>
          <div className="tfw-pagehead__sub">
            The live, on-chain blacklist. {totalActive} active · {totalExpired} expired ·
            cell <code className="tfw-mono">{TFW_trunc(meta.registryTxHash, 22)}</code>
          </div>
        </div>
      </div>

      <div className="tfw-toolbar">
        <input
          type="text"
          className="tfw-input tfw-input--search"
          placeholder="Search addresses…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="tfw-segmented">
          <button
            type="button"
            className={`tfw-seg${sort === "added" ? " tfw-seg--active" : ""}`}
            onClick={() => setSort("added")}
          >Newest first</button>
          <button
            type="button"
            className={`tfw-seg${sort === "expires" ? " tfw-seg--active" : ""}`}
            onClick={() => setSort("expires")}
          >Expires soonest</button>
        </div>
        <label className="tfw-check">
          <input
            type="checkbox"
            checked={showExpired}
            onChange={e => setShowExpired(e.target.checked)}
          />
          <span>Show expired</span>
        </label>
      </div>

      {filtered.length === 0 ? (
        <TFW_EmptyState
          title={query ? "No matching entries" : (reg.length === 0 ? "Registry is empty" : "No active entries")}
          sub={
            query
              ? "Try a different search"
              : (!showExpired && totalExpired > 0
                  ? `${totalExpired} expired ${totalExpired === 1 ? "entry" : "entries"} — enable "Show expired" to see ${totalExpired === 1 ? "it" : "them"}`
                  : "")
          }
        />
      ) : (
        <div className="tfw-table">
          <div className="tfw-table__head">
            <div className="tfw-table__cell tfw-table__cell--addr">LOCK ARGS</div>
            <div className="tfw-table__cell tfw-table__cell--date">ADDED</div>
            <div className="tfw-table__cell tfw-table__cell--date">EXPIRES</div>
            <div className="tfw-table__cell tfw-table__cell--status">STATUS</div>
            <div className="tfw-table__cell tfw-table__cell--props">PROPOSALS</div>
          </div>
          {filtered.map((e, i) => {
            const exp = e.expiresAt ? Number(e.expiresAt) : null;
            const isExp = exp && exp <= now;
            const rel = propsByAddr[e.identifier.toLowerCase()] || [];
            return (
              <button
                key={i}
                type="button"
                className={`tfw-table__row${isExp ? " tfw-table__row--expired" : ""}`}
                onClick={() => actions.openAddr(e.identifier)}
              >
                <div className="tfw-table__cell tfw-table__cell--addr">
                  <code className="tfw-mono">{TFW_trunc(e.identifier, 32)}</code>
                </div>
                <div className="tfw-table__cell tfw-table__cell--date tfw-mono">
                  {e.addedAt ? new Date(Number(e.addedAt) * 1000).toISOString().slice(0,10) : "—"}
                </div>
                <div className="tfw-table__cell tfw-table__cell--date tfw-mono">
                  {exp ? new Date(exp * 1000).toISOString().slice(0,10) : "never"}
                </div>
                <div className="tfw-table__cell tfw-table__cell--status">
                  {isExp
                    ? <TFW_Badge tone="red" size="sm">expired</TFW_Badge>
                    : <TFW_Badge tone="green" size="sm">active</TFW_Badge>}
                </div>
                <div className="tfw-table__cell tfw-table__cell--props">
                  {rel.length === 0 ? (
                    <span className="tfw-table__none">—</span>
                  ) : (
                    rel.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className={`tfw-table__proplink tfw-table__proplink--${TFW_displayStatus(p)}`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          actions.openProposal(p.id);
                        }}
                      >
                        {p.action === "add" ? "+" : "−"} #{p.id}
                      </button>
                    ))
                  )}
                </div>
              </button>
            );
          })}
          <div className="tfw-table__foot">
            <span>{filtered.length} of {reg.length} entries shown</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Proposals ────────────────────────────────────────────────────────────────
const PROP_FILTERS = [
  { key: "all",            label: "All" },
  { key: "action",         label: "Needs votes" },
  { key: "pending-review", label: "Pending review" },
  { key: "voting",         label: "Voting" },
  { key: "approved",       label: "Approved" },
  { key: "ready",          label: "Ready to execute" },
  { key: "executed",       label: "Executed" },
  { key: "rejected",       label: "Rejected" },
];

function ProposalsPage({ state, actions }) {
  const { proposals, registry, meta } = state;
  const [filter, setFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const yourPk = (meta?.yourPubkey || "").toLowerCase();

  const filtered = proposals
    .filter(p => {
      const ds = TFW_displayStatus(p);
      if (filter === "all") return true;
      if (filter === "action") {
        const isOpen = p.status === "pending-review" || p.status === "voting";
        if (!yourPk) return isOpen;
        return isOpen && !(p.votes || []).some(v => (v.pubkey || "").toLowerCase() === yourPk);
      }
      return ds === filter;
    })
    .filter(p => {
      if (!query) return true;
      const q = query.toLowerCase();
      return p.lockArgs.toLowerCase().includes(q)
        || p.id.includes(q)
        || p.proposer.toLowerCase().includes(q)
        || (p.rationale || "").toLowerCase().includes(q);
    })
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  // counts per filter
  const counts = {};
  proposals.forEach(p => {
    const ds = TFW_displayStatus(p);
    counts[ds] = (counts[ds] || 0) + 1;
    if (p.status === "pending-review" || p.status === "voting") {
      if (!yourPk || !(p.votes || []).some(v => (v.pubkey || "").toLowerCase() === yourPk)) {
        counts.action = (counts.action || 0) + 1;
      }
    }
  });
  counts.all = proposals.length;

  return (
    <div className="tfw-page tfw-page--proposals">
      <div className="tfw-pagehead">
        <div className="tfw-pagehead__col">
          <div className="tfw-pagehead__eyebrow">VALIDATOR WORKFLOW</div>
          <h1 className="tfw-pagehead__title">Proposals</h1>
          <div className="tfw-pagehead__sub">
            Review evidence, cast a vote, and export proposal JSON when another participant needs your vote.
          </div>
        </div>
        <button type="button" className="tfw-btn tfw-btn--primary" onClick={actions.openCreate}>
          + New Proposal
        </button>
      </div>

      <div className="tfw-filterbar">
        <div className="tfw-pills">
          {PROP_FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              className={`tfw-pill${filter === f.key ? " tfw-pill--active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              <span>{f.label}</span>
              {counts[f.key] !== undefined && counts[f.key] > 0 && (
                <span className="tfw-pill__count">{counts[f.key]}</span>
              )}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="tfw-input tfw-input--search"
          placeholder="Search id, address, proposer, rationale…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <TFW_EmptyState title="No proposals match" sub="Try clearing filters or search." />
      ) : (
        <div className="tfw-cards">
          {filtered.map(p => (
            <TFW_ProposalCard
              key={p.id}
              proposal={p}
              registry={registry}
              meta={meta}
              onOpen={actions.openProposal}
              onVote={actions.openVote}
              onAnchor={actions.openAnchor}
              onExecute={actions.openExecute}
            />
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, {
  TFW_OverviewPage: OverviewPage,
  TFW_RegistryPage: RegistryPage,
  TFW_ProposalsPage: ProposalsPage,
});
