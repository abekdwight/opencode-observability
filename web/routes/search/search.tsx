import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  SearchContract,
  SearchResultContract,
} from "../../../src/contracts/search";
import { SessionCopyButton } from "../../components/session-copy-button";
import { useJson } from "../../hooks/use-json";
import { formatDateFull, formatTokens } from "../../lib/format";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, terms: string[]): React.ReactNode[] {
  if (!terms.length) return [text];

  const uniqueTerms = Array.from(
    new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0)),
  );
  if (!uniqueTerms.length) return [text];

  const re = new RegExp(`(${uniqueTerms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(re);
  let markIndex = 0;

  return parts.map((part, _i) => {
    if (re.test(part)) {
      markIndex += 1;
      return <mark key={`hl-${part}-${markIndex}`}>{part}</mark>;
    }
    // Reset regex lastIndex since we use test() above
    re.lastIndex = 0;
    return part;
  });
}

export function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") || "";

  const [inputValue, setInputValue] = React.useState(q);

  // Sync input when URL changes externally
  React.useEffect(() => {
    setInputValue(q);
  }, [q]);

  const apiUrl = q ? `/api/search?q=${encodeURIComponent(q)}` : "";
  const { data, error, loading } = useJson<SearchContract>(
    apiUrl || "/api/search?q=",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) {
      setSearchParams({ q: trimmed });
    } else {
      setSearchParams({});
    }
  };

  const showResults = q.length > 0;

  return (
    <section className="surface">
      <section className="card">
        <div className="section-header">
          <h2>Search Sessions</h2>
        </div>
        <form className="search-form" onSubmit={handleSubmit}>
          <input
            className="search-input"
            type="text"
            name="q"
            placeholder="Search titles and chat history"
            // biome-ignore lint/a11y/noAutofocus: search page requires immediate focus
            autoFocus
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button className="search-btn" type="submit">
            Search
          </button>
        </form>
        <p className="search-hint">
          Matches titles and user/agent chat text. Separate words with spaces
          for AND.
        </p>
      </section>

      {loading && showResults ? (
        <p className="state" data-testid="route-loading">
          Searching...
        </p>
      ) : null}

      {error && showResults ? (
        <p className="state state-error" data-testid="route-error">
          Search failed: {error}
        </p>
      ) : null}

      {data && showResults ? (
        <>
          <p className="search-result-count">
            {data.results.length === 0 ? (
              "No results found."
            ) : (
              <>
                {data.results.length} result
                {data.results.length === 1 ? "" : "s"} for{" "}
                <strong>&ldquo;{data.query}&rdquo;</strong> (AND match)
              </>
            )}
          </p>

          {data.results.length === 0 ? (
            <div className="search-no-results">
              No sessions matched &ldquo;{data.query}&rdquo;.
            </div>
          ) : (
            data.results.map((result) => (
              <SearchResultCard
                key={result.id}
                result={result}
                terms={data.searchTerms}
              />
            ))
          )}
        </>
      ) : null}
    </section>
  );
}

function SearchResultCard({
  result,
  terms,
}: {
  result: SearchResultContract;
  terms: string[];
}) {
  const sessionHref = `/session/${encodeURIComponent(result.id)}`;
  const highlightedTitle = highlightText(result.title || "(no title)", terms);

  return (
    <div className="search-result-card" data-testid="search-result">
      <div className="search-result-title-row">
        <Link className="search-result-title-link" to={sessionHref}>
          <div className="search-result-title">{highlightedTitle}</div>
        </Link>
        <div className="search-result-actions">
          <SessionCopyButton
            sessionId={result.id}
            directory={result.directory}
          />
        </div>
      </div>
      <Link className="search-result-main" to={sessionHref}>
        <div className="search-result-dir">{result.directory}</div>
        {result.snippet ? (
          <div className="search-snippet">
            &hellip;{highlightText(result.snippet, terms)}&hellip;
          </div>
        ) : null}
        <div className="search-result-meta">
          <span>{formatDateFull(result.createdAt)}</span>
          <span className="meta-pill">{result.messageCount} msgs</span>
          <span className="meta-pill">
            {formatTokens(result.totalTokens)} tokens
          </span>
        </div>
      </Link>
    </div>
  );
}
