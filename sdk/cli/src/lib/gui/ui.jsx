// Shared UI primitives + format helpers for Transaction Firewall
// Uses CSS custom properties from theme; styling lives in index.html

const { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;

// ── format helpers ───────────────────────────────────────────────────────────
function trunc(s, n = 18) {
  if (!s) return "";
  if (s.length <= n) return s;
  const half = Math.floor((n - 1) / 2);
  return s.slice(0, half + 2) + "…" + s.slice(-half);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function fmtDateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function relTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "—";
  const ms = Date.now() - d.getTime();
  const abs = Math.abs(ms);
  const past = ms >= 0;
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  let v, unit;
  if (abs < hour) { v = Math.max(1, Math.floor(abs / min)); unit = "m"; }
  else if (abs < day) { v = Math.floor(abs / hour); unit = "h"; }
  else if (abs < 30 * day) { v = Math.floor(abs / day); unit = "d"; }
  else { v = Math.floor(abs / (30 * day)); unit = "mo"; }
  return past ? `${v}${unit} ago` : `in ${v}${unit}`;
}

function reviewCountdown(iso) {
  if (!iso || isNaN(new Date(iso).getTime())) return { text: "—", done: false };
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: "complete", done: true };
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  let text;
  if (d > 0) text = `${d}d ${h}h`;
  else if (h > 0) text = `${h}h ${m}m`;
  else text = `${m}m`;
  return { text, done: false };
}

// ── proposal status helpers ──────────────────────────────────────────────────
function countYes(p) { return (p.votes || []).filter(v => v.vote === "yes").length; }
function countNo(p) { return (p.votes || []).filter(v => v.vote === "no").length; }
function countAbstain(p) { return (p.votes || []).filter(v => v.vote === "abstain").length; }
function sigCount(p) { return (p.signatures || []).length; }
function reviewPassed(p) {
  const t = new Date(p.reviewWindowEndsAt).getTime();
  return !isNaN(t) && Date.now() >= t;
}
function isReady(p) {
  return reviewPassed(p)
    && countYes(p) >= 3
    && sigCount(p) >= 3
    && p.status !== "executed"
    && p.status !== "rejected";
}

// derived display status — accounts for "ready" being computable
function displayStatus(p) {
  if (isReady(p)) return "ready";
  return p.status;
}

const STATUS_META = {
  "pending-review":  { label: "pending review", tone: "amber" },
  "voting":          { label: "voting open",    tone: "blue"  },
  "approved":        { label: "awaiting sigs",  tone: "amber" },
  "ready":           { label: "ready to execute", tone: "green" },
  "executed":        { label: "executed",       tone: "mute"  },
  "rejected":        { label: "rejected",       tone: "red"   },
};

const SEVERITY_TONE = {
  critical: "red",
  high:     "amber",
  medium:   "blue",
  low:      "mute",
};

// ── primitives ───────────────────────────────────────────────────────────────
function Badge({ tone = "mute", children, size = "md", outline = false, onClick, style }) {
  const cls = `tfw-badge tfw-badge--${tone} tfw-badge--${size}${outline ? " tfw-badge--outline" : ""}${onClick ? " tfw-badge--clickable" : ""}`;
  return <span className={cls} onClick={onClick} style={style}>{children}</span>;
}

function StatusBadge({ proposal, size = "md" }) {
  const ds = displayStatus(proposal);
  const meta = STATUS_META[ds] || { label: ds, tone: "mute" };
  return <Badge tone={meta.tone} size={size}>{meta.label}</Badge>;
}

function ActionPill({ action }) {
  return (
    <span className={`tfw-action tfw-action--${action}`}>
      <span className="tfw-action__glyph">{action === "add" ? "+" : "−"}</span>
      <span className="tfw-action__word">{action === "add" ? "BLOCK" : "UNBLOCK"}</span>
    </span>
  );
}

function SeverityChip({ severity }) {
  const tone = SEVERITY_TONE[severity] || "mute";
  return <Badge tone={tone} size="sm" outline>{severity}</Badge>;
}

// ── progress: 3-of-3 dots, with hover tooltip showing y/n/a ──────────────────
function VoteDots({ proposal, total = 3 }) {
  const yes = countYes(proposal);
  const no = countNo(proposal);
  const abs = countAbstain(proposal);
  const dots = [];
  for (let i = 0; i < total; i++) {
    let cls = "tfw-dot tfw-dot--empty";
    if (i < yes) cls = "tfw-dot tfw-dot--yes";
    dots.push(<span key={i} className={cls} />);
  }
  return (
    <span className="tfw-meter" title={`yes ${yes} · no ${no} · abstain ${abs}`}>
      <span className="tfw-meter__label">VOTES</span>
      <span className="tfw-meter__dots">{dots}</span>
      <span className="tfw-meter__count">{yes}/{total}</span>
    </span>
  );
}

function SigDots({ proposal, total = 3 }) {
  const c = sigCount(proposal);
  const dots = [];
  for (let i = 0; i < total; i++) {
    let cls = "tfw-dot tfw-dot--empty";
    if (i < c) cls = "tfw-dot tfw-dot--sig";
    dots.push(<span key={i} className={cls} />);
  }
  return (
    <span className="tfw-meter" title={`${c} of ${total} signatures`}>
      <span className="tfw-meter__label">SIGS</span>
      <span className="tfw-meter__dots">{dots}</span>
      <span className="tfw-meter__count">{c}/{total}</span>
    </span>
  );
}

// ── address rendering ────────────────────────────────────────────────────────
function Address({ value, truncate = 22, onCopy, mono = true }) {
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(value);
    if (onCopy) onCopy();
  };
  const cls = mono ? "tfw-addr tfw-mono" : "tfw-addr";
  return (
    <span className={cls}>
      <span className="tfw-addr__text">{trunc(value, truncate)}</span>
      <button
        type="button"
        className="tfw-addr__copy"
        onClick={handleCopy}
        title="Copy full address"
      >⎘</button>
    </span>
  );
}

// ── classification dot (color-coded little square next to classification) ────
const CLASSIFICATION_COLORS = {
  theft:     "var(--c-red)",
  scam:      "var(--c-amber)",
  hack:      "var(--c-red)",
  sanctions: "var(--c-ink)",
  other:     "var(--c-mute)",
};
function ClassificationTag({ value }) {
  return (
    <span className="tfw-cls">
      <span className="tfw-cls__sq" style={{ background: CLASSIFICATION_COLORS[value] || "var(--c-mute)" }} />
      <span className="tfw-cls__txt">{value}</span>
    </span>
  );
}

// ── status dot in header ─────────────────────────────────────────────────────
function ConnectionDot({ state = "ok" }) {
  return <span className={`tfw-conndot tfw-conndot--${state}`} />;
}

// ── copy-on-click code block ─────────────────────────────────────────────────
function CodeBlock({ children, label }) {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    navigator.clipboard?.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="tfw-cmd">
      {label && <div className="tfw-cmd__label">{label}</div>}
      <div className="tfw-cmd__row">
        <code className="tfw-cmd__text tfw-mono">{children}</code>
        <button type="button" className="tfw-cmd__copy" onClick={onClick}>
          {copied ? "✓ COPIED" : "COPY"}
        </button>
      </div>
    </div>
  );
}

// ── stat cell: huge serif number with label below ────────────────────────────
function Stat({ value, label, sub, tone = "ink", onClick }) {
  return (
    <div
      className={`tfw-stat tfw-stat--${tone}${onClick ? " tfw-stat--clickable" : ""}`}
      onClick={onClick}
    >
      <div className="tfw-stat__num">{value}</div>
      <div className="tfw-stat__lbl">{label}</div>
      {sub && <div className="tfw-stat__sub">{sub}</div>}
    </div>
  );
}

// ── Section heading: small caps with rule ────────────────────────────────────
function SectionHead({ eyebrow, title, count, action }) {
  return (
    <div className="tfw-sechead">
      <div className="tfw-sechead__left">
        {eyebrow && <div className="tfw-sechead__eyebrow">{eyebrow}</div>}
        <div className="tfw-sechead__title">
          {title}
          {count !== undefined && <span className="tfw-sechead__count">{count}</span>}
        </div>
      </div>
      {action && <div className="tfw-sechead__act">{action}</div>}
    </div>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────
function EmptyState({ title, sub, glyph = "○" }) {
  return (
    <div className="tfw-empty">
      <div className="tfw-empty__glyph">{glyph}</div>
      <div className="tfw-empty__title">{title}</div>
      {sub && <div className="tfw-empty__sub">{sub}</div>}
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────
function Toast({ kind = "info", children, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4200);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`tfw-toast tfw-toast--${kind}`}>
      <span className="tfw-toast__msg">{children}</span>
      <button type="button" className="tfw-toast__close" onClick={onClose}>×</button>
    </div>
  );
}

// ── tiny utility components ──────────────────────────────────────────────────
function Pipe() {
  return <span className="tfw-pipe" aria-hidden="true" />;
}

function Tag({ children }) {
  return <span className="tfw-tag">{children}</span>;
}

// ── export to global scope ───────────────────────────────────────────────────
Object.assign(window, {
  // helpers
  TFW_trunc: trunc,
  TFW_fmtDate: fmtDate,
  TFW_fmtDateShort: fmtDateShort,
  TFW_relTime: relTime,
  TFW_reviewCountdown: reviewCountdown,
  TFW_countYes: countYes,
  TFW_countNo: countNo,
  TFW_countAbstain: countAbstain,
  TFW_sigCount: sigCount,
  TFW_reviewPassed: reviewPassed,
  TFW_isReady: isReady,
  TFW_displayStatus: displayStatus,
  TFW_STATUS_META: STATUS_META,
  TFW_SEVERITY_TONE: SEVERITY_TONE,
  // components
  TFW_Badge: Badge,
  TFW_StatusBadge: StatusBadge,
  TFW_ActionPill: ActionPill,
  TFW_SeverityChip: SeverityChip,
  TFW_VoteDots: VoteDots,
  TFW_SigDots: SigDots,
  TFW_Address: Address,
  TFW_ClassificationTag: ClassificationTag,
  TFW_ConnectionDot: ConnectionDot,
  TFW_CodeBlock: CodeBlock,
  TFW_Stat: Stat,
  TFW_SectionHead: SectionHead,
  TFW_EmptyState: EmptyState,
  TFW_Toast: Toast,
  TFW_Pipe: Pipe,
  TFW_Tag: Tag,
});
