// Transaction Firewall — root app

const {
  TFW_PROPOSALS, TFW_REGISTRY_ENTRIES, TFW_META,
  TFW_OverviewPage, TFW_RegistryPage, TFW_ProposalsPage,
  TFW_Modal, TFW_ProposalDetailContent, TFW_AddressDetailContent,
  TFW_CreateForm, TFW_VoteForm, TFW_AnchorForm, TFW_ExecuteForm, TFW_ImportForm,
  TFW_ConnectionDot, TFW_Badge, TFW_StatusBadge, TFW_ActionPill, TFW_Toast,
  TFW_trunc, TFW_isReady, TFW_displayStatus,
} = window;

const { useState, useEffect, useReducer, useMemo, useCallback } = React;

// ─── reducer ──────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case "ADD_PROPOSAL":
      return { ...state, proposals: [action.proposal, ...state.proposals] };
    case "ADD_VOTE": {
      const proposals = state.proposals.map(p => {
        if (p.id !== action.proposalId) return p;
        const votes = [...(p.votes || []), { pubkey: action.pubkey, vote: action.vote, timestamp: action.timestamp }];
        let status = p.status;
        if (status === "pending-review") status = "voting";
        return { ...p, votes, status };
      });
      return { ...state, proposals };
    }
    case "UPDATE_PROPOSAL": {
      const proposals = state.proposals.map(p => p.id === action.proposal.id ? action.proposal : p);
      return { ...state, proposals };
    }
    case "EXECUTE": {
      const proposals = state.proposals.map(p => {
        if (p.id !== action.proposalId) return p;
        return { ...p, status: "executed", txHash: action.txHash };
      });
      // also update registry
      const target = state.proposals.find(p => p.id === action.proposalId);
      let registry = state.registry;
      if (target) {
        if (target.action === "add") {
          const existing = registry.find(e => e.identifier.toLowerCase() === target.lockArgs.toLowerCase());
          if (!existing) {
            registry = [
              { identifier: target.lockArgs, expiresAt: target.expiresAt && target.expiresAt !== "0" ? target.expiresAt : null, addedAt: String(Math.floor(Date.now()/1000)) },
              ...registry,
            ];
          }
        } else if (target.action === "remove") {
          registry = registry.filter(e => e.identifier.toLowerCase() !== target.lockArgs.toLowerCase());
        }
      }
      return { ...state, proposals, registry };
    }
    case "IMPORT_PROPOSAL": {
      const existing = state.proposals.find(p => p.id === action.proposal.id);
      if (!existing) {
        return { ...state, proposals: [action.proposal, ...state.proposals] };
      }
      // merge votes
      const votes = [
        ...(existing.votes || []),
        ...(action.proposal.votes || []).filter(v =>
          !(existing.votes || []).some(ev => ev.pubkey === v.pubkey)
        ),
      ];
      const proposals = state.proposals.map(p => p.id === existing.id ? {
        ...p,
        ...action.proposal,
        votes,
        signatures: [],
        proposalDataHash: p.proposalDataHash || action.proposal.proposalDataHash,
        reviewDelayMs: p.reviewDelayMs || action.proposal.reviewDelayMs,
        proposalCellTxHash: p.proposalCellTxHash || action.proposal.proposalCellTxHash,
        proposalCellIndex: p.proposalCellIndex ?? action.proposal.proposalCellIndex,
      } : p);
      return { ...state, proposals };
    }
    case "SET_DATA":
      return {
        ...state,
        proposals: action.proposals,
        registry: action.registry,
        meta: { ...action.meta,
          yourPubkey: state.meta.yourPubkey },
      };
    default:
      return state;
  }
}

// ─── App ─────────────────────────────────────────────────────────────────────
function App() {
  const [state, dispatch] = useReducer(reducer, {
    proposals: TFW_PROPOSALS,
    registry: TFW_REGISTRY_ENTRIES,
    meta: TFW_META,
  });
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState(null); // { kind, payload }
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [connState, setConnState] = useState("ok");

  // tick once a minute to update countdowns
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // live data refresh every 15 s
  useEffect(() => {
    const refresh = () => fetch('/api/data')
      .then(r => r.json())
      .then(d => {
        setConnState("ok");
        dispatch({ type: "SET_DATA",
          proposals: d.proposals || [],
          registry: (d.registry && d.registry.entries) || [],
          meta: Object.assign({}, d.meta || {}, {
            registryTxHash: d.registry && d.registry.txHash,
            registryError: d.registry && d.registry.error,
            treasury: (d.registry && d.registry.treasury) || null,
            threshold: (d.registry && d.registry.threshold) || null,
            governanceSetSize: (d.registry && d.registry.validatorCount) || null,
          }),
        });
      })
      .catch(() => setConnState("err"));
    const rid = setInterval(refresh, 15000);
    return () => clearInterval(rid);
  }, []);

  const addToast = (kind, msg) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, { id, kind, msg }]);
  };
  const removeToast = (id) => setToasts(ts => ts.filter(t => t.id !== id));

  const actions = useMemo(() => ({
    setTab,
    openProposal: (id) => setModal({ kind: "proposal", payload: id }),
    openAddr:     (id) => setModal({ kind: "addr",     payload: id }),
    openCreate:   ()   => setModal({ kind: "create" }),
    openVote:     (id) => setModal({ kind: "vote",     payload: id }),
    openAnchor:   (id) => setModal({ kind: "anchor",   payload: id }),
    openExecute:  (id) => setModal({ kind: "execute",  payload: id }),
    openImport:   ()   => setModal({ kind: "import" }),
    exportProposal: (p) => {
      const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `proposal-${p.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 250);
      addToast("info", `Exported proposal #${p.id}`);
    },
  }), []);

  const closeModal = () => setModal(null);

  // resolve proposal for active modal
  const modalProposal = useMemo(() => {
    if (!modal || !["proposal", "vote", "anchor", "execute"].includes(modal.kind)) return null;
    return state.proposals.find(p => p.id === modal.payload);
  }, [modal, state.proposals]);

  const effectiveConn = connState === "ok" && state.meta?.registryError ? "warn" : connState;
  const yourPk = state.meta.yourPubkey;
  const nowSec = Date.now() / 1000;
  const openCount = state.proposals.filter(p =>
    p.status === "pending-review" || p.status === "voting"
  ).length;
  const activeRegistryCount = state.registry.filter(
    e => !e.expiresAt || Number(e.expiresAt) > nowSec
  ).length;
  const yourTodos = yourPk ? state.proposals.filter(p =>
    (p.status === "pending-review" || p.status === "voting") &&
    !(p.votes || []).some(v => v.pubkey === yourPk)
  ).length : 0;

  return (
    <div className="tfw-root">

      {/* Header */}
      <header className="tfw-header">
        <div className="tfw-header__left">
          <div className="tfw-brand">
              <div className="tfw-brand__mark">
              <span className="tfw-brand__mark-bar" />
              <span className="tfw-brand__mark-bar" />
              <span className="tfw-brand__mark-bar" />
            </div>
            <div className="tfw-brand__text">
              <div className="tfw-brand__name">Transaction Firewall</div>
              <div className="tfw-brand__sub">{state.meta?.cliVersion} · validator console</div>
            </div>
          </div>
        </div>

        <nav className="tfw-nav">
          {[
            { k: "overview", label: "Overview" },
            { k: "registry", label: "Registry", count: activeRegistryCount },
            { k: "proposals", label: "Proposals", count: openCount, alert: !!(yourPk && yourTodos > 0) },
          ].map(item => (
            <button
              key={item.k}
              type="button"
              className={`tfw-nav__item${tab === item.k ? " tfw-nav__item--active" : ""}`}
              onClick={() => setTab(item.k)}
            >
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className={`tfw-nav__count${item.alert ? " tfw-nav__count--alert" : ""}`}>
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="tfw-header__right">
          <button
            type="button"
            className="tfw-btn tfw-btn--ghost tfw-btn--sm"
            onClick={actions.openImport}
          >↥ Import</button>
          <button
            type="button"
            className="tfw-btn tfw-btn--primary tfw-btn--sm"
            onClick={actions.openCreate}
          >+ New proposal</button>
          <div className="tfw-conn">
            <TFW_ConnectionDot state={effectiveConn} />
            <div className="tfw-conn__text">
              <div className="tfw-conn__line1">
                {effectiveConn === "ok" ? "Connected" : effectiveConn === "warn" ? "Registry error" : "Disconnected"}
              </div>
              <div className="tfw-conn__line2">{TFW_trunc(state.meta?.rpcUrl || "unknown", 24)}</div>
            </div>
          </div>
          <div className="tfw-you">
            <div className="tfw-you__avatar">{state.meta?.yourPubkey ? state.meta.yourPubkey.slice(2,4).toUpperCase() : "?"}</div>
            <div className="tfw-you__text">
              <div className="tfw-you__line1">{state.meta?.yourPubkey ? TFW_trunc(state.meta.yourPubkey, 16) : "anonymous"}</div>
              <div className="tfw-you__line2 tfw-mono">validator key</div>
            </div>
          </div>
        </div>
      </header>

      {/* Page */}
      <main className="tfw-main">
        {tab === "overview" && <TFW_OverviewPage state={state} actions={actions} />}
        {tab === "registry" && <TFW_RegistryPage state={state} actions={actions} />}
        {tab === "proposals" && <TFW_ProposalsPage state={state} actions={actions} />}
      </main>

      {/* Footer rule */}
      <footer className="tfw-footer">
        <div className="tfw-footer__left tfw-mono">
          ⌧ TRANSACTION-FIREWALL · CKB TESTNET
        </div>
        <div className="tfw-footer__right tfw-mono">
          REGISTRY CELL {TFW_trunc(state.meta.registryTxHash, 22)} · THRESHOLD {state.meta.threshold || 3}-OF-{state.meta.governanceSetSize || 5}
        </div>
      </footer>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="tfw-toasts">
          {toasts.map(tt => (
            <TFW_Toast key={tt.id} kind={tt.kind} onClose={() => removeToast(tt.id)}>
              {tt.msg}
            </TFW_Toast>
          ))}
        </div>
      )}

      {/* Modals */}
      <TFW_Modal
        open={modal?.kind === "proposal" && !!modalProposal}
        onClose={closeModal}
        size="lg"
        eyebrow={modalProposal ? `PROPOSAL № ${modalProposal.id}` : ""}
        title={modalProposal ? (
          <span>
            <TFW_ActionPill action={modalProposal.action} />
            <code className="tfw-mono" style={{ fontSize: "13px", marginLeft: 10 }}>
              {TFW_trunc(modalProposal.lockArgs, 34)}
            </code>
          </span>
        ) : ""}
        subtitle={modalProposal ? `${modalProposal.classification} · ${modalProposal.severity} · proposed by ${modalProposal.proposer}` : ""}
      >
        {modalProposal && (
          <TFW_ProposalDetailContent
            proposal={modalProposal}
            registry={state.registry}
            meta={state.meta}
            actions={actions}
            onClose={closeModal}
          />
        )}
      </TFW_Modal>

      <TFW_Modal
        open={modal?.kind === "addr"}
        onClose={closeModal}
        size="md"
        eyebrow="REGISTRY ENTRY"
        title={modal?.kind === "addr" ? <code className="tfw-mono" style={{ fontSize: "13px" }}>{TFW_trunc(modal.payload, 40)}</code> : ""}
      >
        {modal?.kind === "addr" && (
          <TFW_AddressDetailContent
            identifier={modal.payload}
            registry={state.registry}
            proposals={state.proposals}
            actions={actions}
          />
        )}
      </TFW_Modal>

      <TFW_Modal
        open={modal?.kind === "create"}
        onClose={closeModal}
        size="md"
        eyebrow="NEW SUBMISSION"
        title="Create proposal"
        subtitle={`Will enter a ${state.meta.reviewWindowHours || 72}-hour review window before voting opens.`}
      >
        <TFW_CreateForm
          meta={state.meta}
          onSubmit={(p) => {
            dispatch({ type: "ADD_PROPOSAL", proposal: p });
            addToast("success", `Proposal #${p.id} created`);
          }}
          onClose={closeModal}
        />
      </TFW_Modal>

      <TFW_Modal
        open={modal?.kind === "vote" && !!modalProposal}
        onClose={closeModal}
        size="md"
        eyebrow={modalProposal ? `VOTE · PROPOSAL № ${modalProposal.id}` : ""}
        title="Cast your vote"
      >
        {modalProposal && (
          <TFW_VoteForm
            proposal={modalProposal}
            meta={state.meta}
            onSubmit={(v) => {
              dispatch({ type: "ADD_VOTE", ...v });
              addToast("success", `Vote ${v.vote.toUpperCase()} recorded`);
            }}
            onClose={closeModal}
          />
        )}
      </TFW_Modal>

      <TFW_Modal
        open={modal?.kind === "anchor" && !!modalProposal}
        onClose={closeModal}
        size="md"
        eyebrow={modalProposal ? `ANCHOR · PROPOSAL № ${modalProposal.id}` : ""}
        title="Anchor proposal"
        subtitle="Creates or records the on-chain proposal anchor used to enforce the review window."
      >
        {modalProposal && (
          <TFW_AnchorForm
            proposal={modalProposal}
            meta={state.meta}
            onSubmit={(p) => {
              dispatch({ type: "UPDATE_PROPOSAL", proposal: p });
              addToast("success", p.proposalCellTxHash ? "Proposal cell outpoint recorded" : "Proposal cell data prepared");
            }}
            onClose={closeModal}
          />
        )}
      </TFW_Modal>

      <TFW_Modal
        open={modal?.kind === "execute" && !!modalProposal}
        onClose={closeModal}
        size="md"
        eyebrow={modalProposal ? `EXECUTE · PROPOSAL № ${modalProposal.id}` : ""}
        title="Build & download transaction"
      >
        {modalProposal && (
          <TFW_ExecuteForm
            proposal={modalProposal}
            meta={state.meta}
            onSubmit={() => {
              dispatch({ type: "EXECUTE", proposalId: modalProposal.id, txHash: null });
              addToast("success", "TX downloaded — broadcast it via ckb-cli to complete execution.");
            }}
            onClose={closeModal}
          />
        )}
      </TFW_Modal>

      <TFW_Modal
        open={modal?.kind === "import"}
        onClose={closeModal}
        size="md"
        eyebrow="IMPORT"
        title="Import proposal JSON"
      >
        <TFW_ImportForm
          onSubmit={(p) => {
            dispatch({ type: "IMPORT_PROPOSAL", proposal: p });
            addToast("success", `Imported proposal #${p.id}`);
          }}
          onClose={closeModal}
        />
      </TFW_Modal>

    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
