import { Hono } from "hono";
import type { SearchContract } from "../contracts/search.js";
import { buildSearchServiceResult } from "../services/search/search.service.js";

function toIso(value: number | string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value !== "string") {
    return new Date(0).toISOString();
  }

  const maybeNumeric = Number(value);
  if (Number.isFinite(maybeNumeric)) {
    return new Date(maybeNumeric).toISOString();
  }

  const maybeDate = Date.parse(value);
  if (Number.isFinite(maybeDate)) {
    return new Date(maybeDate).toISOString();
  }

  return value;
}

function buildSearchContract(query: string): SearchContract {
  const searchResult = buildSearchServiceResult(query);
  return {
    kind: "search.results",
    generatedAt: new Date().toISOString(),
    query: searchResult.query,
    searchTerms: searchResult.searchTerms,
    results: searchResult.results.map((result) => ({
      id: result.id,
      title: result.title,
      directory: result.directory,
      createdAt: toIso(result.time_created),
      snippet: result.snippet ?? null,
      messageCount: result.messageCount,
      totalTokens: result.totalTokens,
    })),
  };
}

export const searchApi = new Hono().get("/search", (c) => {
  const query = c.req.query("q") ?? "";
  return c.json(buildSearchContract(query));
});
