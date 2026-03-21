import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  SessionDetailContract,
  SessionMessageContract,
  SessionToolCallContract,
} from "../../src/contracts/session.js";
import { useJson } from "../hooks/useJson";
import {
  formatDuration,
  formatDurationShort,
  formatTimestamp,
  formatTimestampShort,
  formatTokens,
} from "../lib/format";

// ---------------------------------------------------------------------------
// localStorage preference helpers
// ---------------------------------------------------------------------------
function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota etc. */
  }
}

// ---------------------------------------------------------------------------
// Simple markdown → HTML  (client-side, no server dependency on marked)
// We escape first, then process markdown primitives to stay safe.
// ---------------------------------------------------------------------------
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSafeMarkdown(raw: string): string {
  const escaped = escapeHtml(raw);
  // Code blocks: ```...```
  let html = escaped.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, _lang, code) => `<pre><code>${code}</code></pre>`,
  );
  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *...*
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Headings
  html = html.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // Unordered list items
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  // Links: [text](url) — only http/https
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  return html;
}

function renderSafeDiff(diff: string): string {
  const lines = escapeHtml(diff).split("\n");
  return lines
    .map((line) => {
      if (line.startsWith("+")) return `<span class="diff-add">${line}</span>`;
      if (line.startsWith("-")) return `<span class="diff-del">${line}</span>`;
      if (line.startsWith("@@"))
        return `<span class="diff-hunk">${line}</span>`;
      return line;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COLLAPSE_HEIGHT = 300;

const TOOL_ICONS: Record<string, string> = {
  read: "📄",
  grep: "🔍",
  bash: "⚡",
  glob: "📂",
  write: "✏️",
  edit: "✏️",
  apply_patch: "✏️",
  task: "🤖",
  background_output: "🤖",
  webfetch: "🌐",
  websearch_web_search_exa: "🌐",
  lsp_diagnostics: "🔧",
  todowrite: "📋",
  skill: "⚙️",
};

type FilterMode = "all" | "user" | "assistant";
const FILTER_CYCLE: FilterMode[] = ["all", "user", "assistant"];
const FILTER_LABELS: Record<FilterMode, string> = {
  all: "🧑‍💻🤖",
  user: "🧑‍💻",
  assistant: "🤖",
};

// ---------------------------------------------------------------------------
// Copy command logic  (ported from legacy SESSION_COPY_SCRIPT)
// ---------------------------------------------------------------------------
function buildCopyCommand(sessionId: string, directory: string): string {
  const ua =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    "";
  const isWindows = /Win/i.test(ua) || /Windows/i.test(navigator.userAgent);
  const quote = isWindows
    ? (v: string) => "'" + v.replace(/'/g, "''") + "'"
    : (v: string) => "'" + v.replace(/'/g, "'\\''") + "'";
  const d = quote(directory);
  const s = quote(sessionId);
  return isWindows
    ? `Set-Location -LiteralPath ${d}; if ($?) { opencode -s ${s} }`
    : `cd ${d} && opencode -s ${s}`;
}

// ---------------------------------------------------------------------------
// SessionDetail component
// ---------------------------------------------------------------------------
export function SessionDetail() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { data, error, loading } = useJson<SessionDetailContract>(
    `/api/session/${encodeURIComponent(sessionId)}`,
  );

  // --- View preferences (persisted in localStorage) ---
  const [collapseEnabled, setCollapseEnabled] = React.useState(
    () => readPref("ot-collapse", "true") !== "false",
  );
  const [filterMode, setFilterMode] = React.useState<FilterMode>(
    () => (readPref("ot-filter", "all") as FilterMode) || "all",
  );
  const [plainMode, setPlainMode] = React.useState(
    () => readPref("ot-plain", "false") === "true",
  );
  const [toolsVisible, setToolsVisible] = React.useState(
    () => readPref("ot-tools", "true") !== "false",
  );

  // --- Nav state ---
  const [navIndex, setNavIndex] = React.useState(-1);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "error">(
    "idle",
  );

  // --- Tool detail open map ---
  const [openDetails, setOpenDetails] = React.useState<Set<string>>(new Set());

  // --- Message body refs for overflow detection ---
  const messageBodyRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const chatRef = React.useRef<HTMLDivElement>(null);

  // Filtered messages
  const messages = data?.messages ?? [];
  const visibleMessages = React.useMemo(
    () =>
      messages
        .map((m, i) => ({ msg: m, idx: i }))
        .filter(({ msg }) => filterMode === "all" || msg.role === filterMode),
    [messages, filterMode],
  );

  // --- Persist preferences ---
  React.useEffect(() => {
    writePref("ot-collapse", String(collapseEnabled));
  }, [collapseEnabled]);
  React.useEffect(() => {
    writePref("ot-filter", filterMode);
  }, [filterMode]);
  React.useEffect(() => {
    writePref("ot-plain", String(plainMode));
  }, [plainMode]);
  React.useEffect(() => {
    writePref("ot-tools", String(toolsVisible));
  }, [toolsVisible]);

  // --- Overflow detection & collapse management ---
  const recheckOverflows = React.useCallback(() => {
    for (const [, el] of messageBodyRefs.current) {
      if (!el) continue;
      const contentEl = plainMode
        ? el.querySelector<HTMLElement>(".message-raw")
        : el.querySelector<HTMLElement>(".message-content");
      if (!contentEl) continue;
      const overflows = contentEl.scrollHeight > COLLAPSE_HEIGHT;
      el.classList.toggle("overflows", overflows);
      if (!overflows) {
        el.classList.remove("collapsed");
      } else if (collapseEnabled) {
        el.classList.add("collapsed");
      }
    }
  }, [plainMode, collapseEnabled]);

  React.useEffect(() => {
    recheckOverflows();
  }, [recheckOverflows]);

  // --- Anchor-based scroll preservation ---
  const getAnchor = React.useCallback(() => {
    const nodes = chatRef.current?.querySelectorAll<HTMLElement>(
      ".message:not(.hidden)",
    );
    if (!nodes) return null;
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      if (r.bottom > 0) return { el: node, offset: r.top };
    }
    return null;
  }, []);

  const restoreAnchor = React.useCallback(
    (anchor: { el: HTMLElement; offset: number } | null) => {
      if (!anchor) return;
      window.scrollBy(0, anchor.el.getBoundingClientRect().top - anchor.offset);
    },
    [],
  );

  // --- Control actions ---
  const togglePlainMode = React.useCallback(() => {
    const anchor = getAnchor();
    setPlainMode((prev) => !prev);
    requestAnimationFrame(() => {
      recheckOverflows();
      restoreAnchor(anchor);
    });
  }, [getAnchor, restoreAnchor, recheckOverflows]);

  const toggleCollapseAll = React.useCallback(() => {
    const anchor = getAnchor();
    setCollapseEnabled((prev) => {
      const next = !prev;
      requestAnimationFrame(() => {
        for (const [, el] of messageBodyRefs.current) {
          if (!el || !el.classList.contains("overflows")) continue;
          const btn = el.querySelector<HTMLElement>(".expand-btn");
          if (next) {
            el.classList.add("collapsed");
            if (btn) {
              btn.textContent = "続きを表示";
              btn.classList.remove("has-overflow");
            }
          } else {
            el.classList.remove("collapsed");
            if (btn) {
              btn.textContent = "折りたたむ";
              btn.classList.add("has-overflow");
            }
          }
        }
        restoreAnchor(anchor);
      });
      return next;
    });
  }, [getAnchor, restoreAnchor]);

  const cycleFilter = React.useCallback(() => {
    setFilterMode((prev) => {
      const idx = FILTER_CYCLE.indexOf(prev);
      return FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
    });
  }, []);

  const toggleTools = React.useCallback(() => {
    setToolsVisible((prev) => !prev);
  }, []);

  // --- Message navigation ---
  const syncNavToView = React.useCallback(() => {
    if (visibleMessages.length === 0) {
      setNavIndex(-1);
      return;
    }
    const nodes = chatRef.current?.querySelectorAll<HTMLElement>(
      ".message:not(.hidden)",
    );
    if (!nodes) return;
    let best = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].getBoundingClientRect().top <= window.innerHeight / 3)
        best = i;
    }
    setNavIndex(best);
  }, [visibleMessages.length]);

  const jumpMessage = React.useCallback((dir: number) => {
    const nodes = chatRef.current?.querySelectorAll<HTMLElement>(
      ".message:not(.hidden)",
    );
    if (!nodes || nodes.length === 0) return;
    setNavIndex((prev) => {
      const cur = prev < 0 ? 0 : prev;
      const next = Math.max(0, Math.min(nodes.length - 1, cur + dir));
      nodes[next].scrollIntoView({ behavior: "smooth", block: "start" });
      nodes[next].classList.add("nav-highlight");
      setTimeout(() => nodes[next]?.classList.remove("nav-highlight"), 800);
      return next;
    });
  }, []);

  // Keyboard navigation (j/k)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j" || (e.key === "ArrowDown" && e.altKey)) {
        e.preventDefault();
        jumpMessage(1);
      }
      if (e.key === "k" || (e.key === "ArrowUp" && e.altKey)) {
        e.preventDefault();
        jumpMessage(-1);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [jumpMessage]);

  // Scroll sync for nav counter
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(syncNavToView, 150);
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", handler);
    };
  }, [syncNavToView]);

  // --- Copy command ---
  const handleCopy = React.useCallback(async () => {
    if (!data) return;
    const cmd = buildCopyCommand(data.session.id, data.session.directory);
    try {
      await navigator.clipboard.writeText(cmd);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1200);
  }, [data]);

  // --- Delete session ---
  const handleDelete = React.useCallback(async () => {
    if (!data) return;
    if (
      !window.confirm(
        "このセッションとサブエージェントセッションを削除しますか？\nこの操作は取り消せません。",
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/session/${encodeURIComponent(data.session.id)}`,
        {
          method: "DELETE",
          headers: { "x-opencode-confirm-delete": data.session.id },
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        window.alert(`削除に失敗しました: ${err.error || res.statusText}`);
        return;
      }
      navigate("/");
    } catch (e) {
      window.alert(
        `削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [data, navigate]);

  // --- Toggle tool detail ---
  const toggleToolDetail = React.useCallback((detailId: string) => {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(detailId)) next.delete(detailId);
      else next.add(detailId);
      return next;
    });
  }, []);

  // --- Toggle individual message ---
  const handleToggleMessage = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const body = (e.target as HTMLElement).closest(
        ".message-body",
      ) as HTMLElement | null;
      if (!body) return;
      const anchor = getAnchor();
      const isCollapsed = body.classList.contains("collapsed");
      const btn = body.querySelector<HTMLElement>(".expand-btn");
      if (isCollapsed) {
        body.classList.remove("collapsed");
        if (btn) {
          btn.textContent = "折りたたむ";
          btn.classList.add("has-overflow");
        }
      } else {
        body.classList.add("collapsed");
        if (btn) {
          btn.textContent = "続きを表示";
          btn.classList.remove("has-overflow");
        }
      }
      restoreAnchor(anchor);
    },
    [getAnchor, restoreAnchor],
  );

  // --- Computed values ---
  const navCounterText =
    visibleMessages.length === 0
      ? "- / -"
      : `${navIndex + 1} / ${visibleMessages.length}`;

  // --- Body class for plain mode ---
  React.useEffect(() => {
    document.body.classList.toggle("plain-mode", plainMode);
    return () => {
      document.body.classList.remove("plain-mode");
    };
  }, [plainMode]);

  // -----------------------------------------------------------------------
  // RENDER
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <section className="surface">
        <p className="state" data-testid="route-loading">
          Loading session detail...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="surface">
        <p className="state state-error" data-testid="route-error">
          Session API unavailable: {error}
        </p>
      </section>
    );
  }

  if (!data) return null;

  const prettyDir = data.session.directory;
  const todos = data.todos ?? [];
  const doneCount = todos.filter((t) => t.status === "completed").length;

  return (
    <section className="session-detail-page" data-testid="session-detail">
      {/* Breadcrumb */}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <Link to={`/dir/${encodeURIComponent(data.session.directory)}`}>
          {prettyDir}
        </Link>
        <span className="sep">/</span>
        <span>Session</span>
      </nav>

      {/* Session header */}
      <div className="session-header">
        {data.session.parentId ? (
          <div className="header-parent">
            <Link
              to={`/session/${encodeURIComponent(data.session.parentId)}`}
              className="header-parent-link"
            >
              ↳ {data.session.parentId}
            </Link>
          </div>
        ) : null}
        <div className="header-top">
          <h1 className="session-title">{data.session.title}</h1>
          <div className="session-header-actions">
            {/* Copy button */}
            <button
              type="button"
              className={`session-copy-btn${copyState === "copied" ? " copied" : ""}${copyState === "error" ? " copy-error" : ""}`}
              onClick={handleCopy}
              aria-label={`${data.session.id} のコマンドをコピー`}
              title="コマンドをコピー"
              data-testid="copy-command-btn"
            >
              {copyState === "copied" ? (
                <span className="session-copy-icon-check" aria-hidden="true">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    role="img"
                    aria-hidden="true"
                  >
                    <title>Copied</title>
                    <polyline points="20 6 10 18 4 12" />
                  </svg>
                </span>
              ) : (
                <span className="session-copy-icon-copy" aria-hidden="true">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    role="img"
                    aria-hidden="true"
                  >
                    <title>Copy</title>
                    <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                </span>
              )}
              <span className="session-copy-id">{data.session.id}</span>
            </button>
            {/* Delete button */}
            <button
              type="button"
              className="session-copy-btn btn-delete"
              onClick={handleDelete}
              title="セッションを削除"
              data-testid="delete-btn"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-hidden="true"
              >
                <title>Delete</title>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        </div>
        <div className="header-dir">{prettyDir}</div>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">所要時間</div>
            <div className="metric-value">
              {data.subagents.length > 0
                ? formatDuration(
                    data.subagents.reduce(
                      (max, s) => Math.max(max, s.durationMs),
                      0,
                    ),
                  )
                : (formatTimestamp(data.session.createdAt).split(" ").pop() ??
                  "—")}
            </div>
            <div className="metric-sub">
              {formatTimestamp(data.session.createdAt)}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">メッセージ</div>
            <div className="metric-value">{data.messages.length}</div>
            <div className="metric-sub">
              User {data.messages.filter((m) => m.role === "user").length} /
              Assistant{" "}
              {data.messages.filter((m) => m.role === "assistant").length}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">ツール呼出</div>
            <div className="metric-value">
              {data.messages.reduce((sum, m) => sum + m.toolCalls.length, 0)}
            </div>
            <div className="metric-sub">
              サブエージェント {data.subagents.length}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">トークン</div>
            <div className="metric-value">
              {formatTokens(data.tokens.total)}
            </div>
            <div className="metric-sub">
              入力 {formatTokens(data.tokens.input)} / 出力{" "}
              {formatTokens(data.tokens.output)}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">コスト</div>
            <div className="metric-value">
              {data.tokens.cost > 0
                ? `$${data.tokens.cost.toFixed(4)}`
                : "$0.00"}
            </div>
            <div className="metric-sub">
              ファイル変更:{" "}
              {(data.session.summary?.files ?? 0) > 0
                ? `${data.session.summary.files} files (+${data.session.summary.additions} -${data.session.summary.deletions})`
                : "なし"}
            </div>
          </div>
        </div>
      </div>

      {/* Todos accordion */}
      {todos.length > 0 ? (
        <details className="card todo-accordion" data-testid="todos-accordion">
          <summary className="todo-summary">
            Todos{" "}
            <span className="todo-count">
              {doneCount}/{todos.length}
            </span>
          </summary>
          <div className="todo-list">
            {todos.map((t) => {
              const icon =
                t.status === "completed"
                  ? "✅"
                  : t.status === "in_progress"
                    ? "🔄"
                    : t.status === "cancelled"
                      ? "❌"
                      : "⬜";
              const dim = t.status === "completed" || t.status === "cancelled";
              return (
                <div
                  key={`${t.content}-${t.status}-${t.priority}`}
                  className="todo-item"
                  style={dim ? { opacity: 0.6 } : undefined}
                >
                  {icon} <span>{t.content}</span>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      {/* Diffs */}
      {data.summaryDiffs ? (
        <div
          className="card"
          style={{ marginTop: 16 }}
          data-testid="diffs-card"
        >
          <h3 style={{ margin: "0 0 12px 0", fontSize: "1em" }}>Changes</h3>
          <pre
            className="diff-view"
            dangerouslySetInnerHTML={{
              __html: renderSafeDiff(data.summaryDiffs),
            }}
          />
        </div>
      ) : null}

      {/* Messages */}
      {messages.length === 0 ? <p>メッセージはありません</p> : null}
      <div className="chat" ref={chatRef} data-testid="chat-messages">
        {messages.map((msg, msgIdx) => (
          <MessageRow
            key={`${msg.createdAt}-${msg.role}-${msg.text.slice(0, 32)}`}
            msg={msg}
            msgIdx={msgIdx}
            hidden={filterMode !== "all" && msg.role !== filterMode}
            plainMode={plainMode}
            toolsVisible={toolsVisible}
            openDetails={openDetails}
            toggleToolDetail={toggleToolDetail}
            onToggleMessage={handleToggleMessage}
            registerRef={(el) => {
              if (el) messageBodyRefs.current.set(msgIdx, el);
              else messageBodyRefs.current.delete(msgIdx);
            }}
          />
        ))}
      </div>

      {/* Control bar */}
      <div className="control-bar" data-testid="control-bar">
        <div className="control-bar-inner">
          <button
            type="button"
            className={`ctrl-btn${collapseEnabled ? " active" : ""}`}
            onClick={toggleCollapseAll}
            data-testid="btn-collapse"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              role="img"
              aria-hidden="true"
            >
              <title>Collapse</title>
              <path d="M4 6l4 4 4-4" />
            </svg>
            折りたたみ
          </button>
          <div className="ctrl-sep" />
          <button
            type="button"
            className={`ctrl-btn${filterMode !== "all" ? " active" : ""}`}
            onClick={cycleFilter}
            data-testid="btn-filter"
          >
            {FILTER_LABELS[filterMode]}
          </button>
          <div className="ctrl-sep" />
          <button
            type="button"
            className={`ctrl-btn${plainMode ? " active" : ""}`}
            onClick={togglePlainMode}
            data-testid="btn-plain"
          >
            Aa
          </button>
          <div className="ctrl-sep" />
          <button
            type="button"
            className={`ctrl-btn${toolsVisible ? " active" : ""}`}
            onClick={toggleTools}
            data-testid="btn-tools"
          >
            🔧
          </button>
          <div className="ctrl-sep" />
          <button
            type="button"
            className="ctrl-btn"
            onClick={() => jumpMessage(-1)}
            data-testid="btn-prev"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              role="img"
              aria-hidden="true"
            >
              <title>Previous</title>
              <path d="M12 10l-4-4-4 4" />
            </svg>
          </button>
          <span className="nav-counter" data-testid="nav-counter">
            {navCounterText}
          </span>
          <button
            type="button"
            className="ctrl-btn"
            onClick={() => jumpMessage(1)}
            data-testid="btn-next"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              role="img"
              aria-hidden="true"
            >
              <title>Next</title>
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MessageRow — individual message rendering
// ---------------------------------------------------------------------------
const MessageRow = React.memo(function MessageRow({
  msg,
  msgIdx,
  hidden,
  plainMode,
  toolsVisible,
  openDetails,
  toggleToolDetail,
  onToggleMessage,
  registerRef,
}: {
  msg: SessionMessageContract;
  msgIdx: number;
  hidden: boolean;
  plainMode: boolean;
  toolsVisible: boolean;
  openDetails: Set<string>;
  toggleToolDetail: (id: string) => void;
  onToggleMessage: (e: React.MouseEvent<HTMLButtonElement>) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  const isUser = msg.role === "user";
  const roleClass = isUser ? "message-user" : "message-assistant";
  const roleLabel = isUser ? "User" : "Assistant";
  const dateStr = formatTimestampShort(msg.createdAt);

  // Meta chips (assistant only)
  const metaChips: React.ReactNode[] = [];
  if (!isUser) {
    if (msg.modelId) {
      metaChips.push(
        <span key="model" className="meta-chip chip-model">
          {msg.modelId}
        </span>,
      );
    }
    if (msg.agent) {
      metaChips.push(
        <span key="agent" className="meta-chip chip-agent">
          {msg.agent}
        </span>,
      );
    }
    metaChips.push(
      <span key="tps" className="meta-chip chip-tps">
        TPS {msg.outputTpsLabel || "—"}
      </span>,
    );
  }

  // Subagent links
  const subagentLinks = !isUser && msg.subagentLinks.length > 0 && (
    <div className="subagent-links">
      {msg.subagentLinks.map((link) => (
        <Link
          key={link.id}
          to={`/session/${encodeURIComponent(link.id)}`}
          className="subagent-link"
        >
          → {link.title}
          {link.durationMs > 0
            ? ` (${formatDurationShort(link.durationMs)})`
            : ""}
        </Link>
      ))}
    </div>
  );

  return (
    <div
      className={`message ${roleClass}${hidden ? " hidden" : ""}`}
      data-role={msg.role}
      data-testid={`message-${msgIdx}`}
    >
      <div className="message-header">
        <span className="message-role">{roleLabel}</span>
        <span className="message-time">{dateStr}</span>
        {metaChips}
      </div>
      {subagentLinks}
      {/* Tool timeline */}
      {msg.toolCalls.length > 0 ? (
        <ToolTimeline
          calls={msg.toolCalls}
          msgIdx={msgIdx}
          visible={toolsVisible}
          openDetails={openDetails}
          toggleToolDetail={toggleToolDetail}
        />
      ) : null}
      <div className="message-body collapsed" ref={registerRef}>
        <div
          className="message-content"
          dangerouslySetInnerHTML={{
            __html: renderSafeMarkdown(msg.text),
          }}
        />
        <div className="message-raw">
          <span className="raw-label">
            {roleLabel} ({dateStr})
          </span>
          {"\n"}
          {msg.text}
        </div>
        <div className="content-fade" />
        <button type="button" className="expand-btn" onClick={onToggleMessage}>
          続きを表示
        </button>
      </div>
      <hr className="plain-sep" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// ToolTimeline — tool call pills
// ---------------------------------------------------------------------------
const ToolTimeline = React.memo(function ToolTimeline({
  calls,
  msgIdx,
  visible,
  openDetails,
  toggleToolDetail,
}: {
  calls: SessionToolCallContract[];
  msgIdx: number;
  visible: boolean;
  openDetails: Set<string>;
  toggleToolDetail: (id: string) => void;
}) {
  return (
    <div className={`tool-timeline${visible ? "" : " hidden"}`}>
      {calls.map((tc) => {
        const icon = TOOL_ICONS[tc.tool] || "🔧";
        const hasDetail = tc.fullInput || tc.fullOutput || tc.error;
        const detailId = [
          `tool-detail-${msgIdx}`,
          tc.tool,
          tc.status,
          tc.input ?? "",
          tc.error ?? "",
          String(tc.durationMs),
        ].join("-");
        const isOpen = openDetails.has(detailId);
        const durStr =
          tc.durationMs > 0
            ? tc.durationMs < 1000
              ? `${tc.durationMs}ms`
              : `${(tc.durationMs / 1000).toFixed(1)}s`
            : "";

        return (
          <React.Fragment
            key={[
              tc.tool,
              tc.status,
              tc.input ?? "",
              tc.error ?? "",
              String(tc.durationMs),
            ].join("-")}
          >
            {hasDetail ? (
              <button
                type="button"
                className={`tool-line status-${tc.status} clickable`}
                onClick={() => toggleToolDetail(detailId)}
              >
                {icon} <span className="tool-name">{tc.tool}</span>
                {tc.input ? (
                  <span className="tool-input">{tc.input}</span>
                ) : null}
                {durStr ? <span className="tool-dur">{durStr}</span> : null}
                {tc.status === "error" && tc.error ? (
                  <span className="tool-error">{tc.error}</span>
                ) : null}
              </button>
            ) : (
              <span className={`tool-line status-${tc.status}`}>
                {icon} <span className="tool-name">{tc.tool}</span>
                {tc.input ? (
                  <span className="tool-input">{tc.input}</span>
                ) : null}
                {durStr ? <span className="tool-dur">{durStr}</span> : null}
                {tc.status === "error" && tc.error ? (
                  <span className="tool-error">{tc.error}</span>
                ) : null}
              </span>
            )}
            {hasDetail && isOpen ? (
              <div className="tool-detail open">
                {tc.fullInput ? (
                  <div className="tool-detail-section">
                    <div className="tool-detail-label">Input</div>
                    <pre>{tc.fullInput}</pre>
                  </div>
                ) : null}
                {tc.fullOutput ? (
                  <div className="tool-detail-section">
                    <div className="tool-detail-label">Output</div>
                    <pre>{tc.fullOutput}</pre>
                  </div>
                ) : null}
                {tc.status === "error" && tc.error ? (
                  <div className="tool-detail-section">
                    <div className="tool-detail-label">Error</div>
                    <pre className="tool-detail-error">{tc.error}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
});
