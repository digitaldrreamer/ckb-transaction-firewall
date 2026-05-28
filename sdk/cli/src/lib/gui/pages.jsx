// Pages: Overview, Registry, Proposals
// Each is a self-contained component receiving { state, dispatch } props

const {
  TFW_ProposalCard, TFW_Stat, TFW_SectionHead, TFW_EmptyState,
  TFW_Badge, TFW_VoteDots, TFW_SigDots, TFW_StatusBadge, TFW_ActionPill,
  TFW_ClassificationTag, TFW_SeverityChip, TFW_Address,
  TFW_isReady, TFW_displayStatus, TFW_countYes, TFW_sigCount,
  TFW_reviewPassed, TFW_relTime, TFW_fmtDateShort, TFW_trunc,
} = window;

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewPage({ state, actions }) {
  const { proposals, registry, meta } = state;
  const now = Date.now() / 1000;

  const activeReg = registry.filter(e => !e.expiresAt || Number(e.expiresAt) > now).length;
  const expiredReg = registry.filter(e => e.expiresAt && Number(e.expiresAt) <= now).length;

  const open = proposals.filter(p => p.status === "pending-review" || p.status === "voting");
  const ready = proposals.filter(TFW_isReady);
  const approved = proposals.filter(p => p.status === "approved" && !TFW_isReady(p));
  const executed = proposals.filter(p => p.status === "executed");

  const action = ready.concat(open);
  const recent = [...proposals]
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 6);

  // your-vote indicators
  const yourPk = meta.yourPubkey;
  const youHaventVoted = open.filter(p => !(p.votes || []).some(v => v.pubkey === yourPk));

  return (
    <div className="tfw-page tfw-page--overview">

      {/* HERO STRIP — editorial-sized stats */}
      <div className="tfw-hero">
        <div className="tfw-hero__lead">
          <div className="tfw-hero__eyebrow">GOVERNANCE STATUS · {new Date().toISOString().slice(0,10)}</div>
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
                <strong>{action.length} item{action.length !== 1 ? "s" : ""}</strong> need
                {action.length === 1 ? "s" : ""} your attention.
                {youHaventVoted.length > 0 && (
                  <> You haven&rsquo;t voted on <strong>{youHaventVoted.length}</strong>.</>
                )}
              </>
            ) : (
              <>All clear. No proposals require action right now.</>
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
            sub={youHaventVoted.length ? `${youHaventVoted.length} need you` : "all caught up"}
          />
          <TFW_Stat
            value={ready.length}
            label="READY TO EXECUTE"
            tone="green"
          />
          <TFW_Stat
            value={approved.length}
            label="AWAITING SIGS"
            tone="amber"
          />
        </div>
      </div>

      {/* ACTION REQUIRED */}
      {action.length > 0 && (
        <div className="tfw-section">
          <TFW_SectionHead
            eyebrow="◆ PRIORITY"
            title="Action required"
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
                onOpen={actions.openProposal}
                onVote={actions.openVote}
                onSign={actions.openSign}
                onExecute={actions.openExecute}
              />
            ))}
          </div>
        </div>
      )}

      {/* AWAITING SIGS */}
      {approved.length > 0 && (
        <div className="tfw-section">
          <TFW_SectionHead
            eyebrow="◇ MULTISIG"
            title="Awaiting signatures"
            count={approved.length}
          />
          <div className="tfw-cards">
            {approved.map(p => (
              <TFW_ProposalCard
                key={p.id}
                proposal={p}
                registry={registry}
                onOpen={actions.openProposal}
                onVote={actions.openVote}
                onSign={actions.openSign}
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
                onOpen={actions.openProposal}
                onVote={actions.openVote}
                onSign={actions.openSign}
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

  const filtered = registry
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

  const totalActive = registry.filter(e => !e.expiresAt || Number(e.expiresAt) > now).length;
  const totalExpired = registry.filter(e => e.expiresAt && Number(e.expiresAt) <= now).length;

  return (
    <div className="tfw-page tfw-page--registry">
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
          title={query ? "No matching entries" : "Registry is empty"}
          sub={query ? "Try a different search" : ""}
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
            <span>{filtered.length} of {registry.length} entries shown</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Proposals ────────────────────────────────────────────────────────────────
const PROP_FILTERS = [
  { key: "all", label: "All" },
  { key: "action", label: "Needs action" },
  { key: "pending-review", label: "Pending review" },
  { key: "voting", label: "Voting" },
  { key: "approved", label: "Awaiting sigs" },
  { key: "ready", label: "Ready" },
  { key: "executed", label: "Executed" },
  { key: "rejected", label: "Rejected" },
];

function ProposalsPage({ state, actions }) {
  const { proposals, registry } = state;
  const [filter, setFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");

  const filtered = proposals
    .filter(p => {
      const ds = TFW_displayStatus(p);
      if (filter === "all") return true;
      if (filter === "action") {
        return p.status === "pending-review" || p.status === "voting" || TFW_isReady(p);
      }
      if (filter === "ready") return TFW_isReady(p);
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
    if (p.status === "pending-review" || p.status === "voting" || TFW_isReady(p)) {
      counts.action = (counts.action || 0) + 1;
    }
  });
  counts.all = proposals.length;
  counts.ready = proposals.filter(TFW_isReady).length;

  return (
    <div className="tfw-page tfw-page--proposals">
      <div className="tfw-pagehead">
        <div className="tfw-pagehead__col">
          <div className="tfw-pagehead__eyebrow">GOVERNANCE WORKFLOW</div>
          <h1 className="tfw-pagehead__title">Proposals</h1>
          <div className="tfw-pagehead__sub">
            Every proposal moves through review → voting → multisig → execution.
            3 of 5 keyholders must approve each on-chain change.
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
              onOpen={actions.openProposal}
              onVote={actions.openVote}
              onSign={actions.openSign}
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
