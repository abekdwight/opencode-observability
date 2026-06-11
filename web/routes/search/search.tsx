import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  SearchContract,
  SearchResultContract,
} from "../../../src/contracts/search";
import { SessionCopyButton } from "../../components/session-copy-button";
import { Button } from "../../components/ui/button";
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
    <section className="grid gap-2.5">
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="m-0 text-[1.15em] font-bold">Search Sessions</h2>
        </div>
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <input
            className="w-full flex-1 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            type="text"
            name="q"
            placeholder="Search titles and chat history"
            // biome-ignore lint/a11y/noAutofocus: search page requires immediate focus
            autoFocus
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <Button type="submit" size="lg">
            Search
          </Button>
        </form>
        <p className="mt-2 text-[0.9em] text-[var(--color-text-secondary)]">
          Matches titles and user/agent chat text. Separate words with spaces
          for AND.
        </p>
      </section>

      {loading && showResults ? (
        <p
          className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Searching...
        </p>
      ) : null}

      {error && showResults ? (
        <p
          className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
          data-testid="route-error"
        >
          Search failed: {error}
        </p>
      ) : null}

      {data && showResults ? (
        <>
          <p className="text-[0.9em] text-[var(--color-text-secondary)]">
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
            <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
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
  const sessionHref = `/sessions/opencode/${encodeURIComponent(result.id)}`;
  const highlightedTitle = highlightText(result.title || "(no title)", terms);

  return (
    <div
      className="flex flex-col rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 transition-all hover:border-[var(--color-accent)] hover:shadow-[0_2px_8px_rgba(0,102,204,0.08)]"
      data-testid="search-result"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          className="flex-1 text-inherit no-underline hover:no-underline"
          to={sessionHref}
        >
          <div className="text-[1.05em] font-semibold text-[var(--color-text-primary)] hover:underline [&_mark]:rounded-sm [&_mark]:bg-[#fff176] [&_mark]:px-0.5 [&_mark]:text-inherit">
            {highlightedTitle}
          </div>
        </Link>
        <div className="flex shrink-0">
          <SessionCopyButton
            sessionId={result.id}
            directory={result.directory}
          />
        </div>
      </div>
      <Link
        className="block text-inherit no-underline hover:no-underline"
        to={sessionHref}
      >
        <div className="mt-1 text-[0.8em] text-[var(--color-text-secondary)]">
          {result.directory}
        </div>
        {result.snippet ? (
          <div className="mt-1.5 text-[0.88em] leading-relaxed text-[var(--color-text-primary)] [&_mark]:rounded-sm [&_mark]:bg-[#fff176] [&_mark]:px-0.5 [&_mark]:text-inherit">
            &hellip;{highlightText(result.snippet, terms)}&hellip;
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.82em] text-[var(--color-text-secondary)]">
          <span>{formatDateFull(result.createdAt)}</span>
          <span className="rounded-md bg-[#f0f0f0] px-2 py-0.5 font-medium">
            {result.messageCount} msgs
          </span>
          <span className="rounded-md bg-[#f0f0f0] px-2 py-0.5 font-medium">
            {formatTokens(result.totalTokens)} tokens
          </span>
        </div>
      </Link>
    </div>
  );
}
