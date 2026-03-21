export interface SearchResultContract {
  id: string;
  title: string;
  directory: string;
  createdAt: string;
  snippet: string | null;
  messageCount: number;
  totalTokens: number;
}

export interface SearchContract {
  kind: "search.results";
  generatedAt: string;
  query: string;
  searchTerms: string[];
  results: SearchResultContract[];
}
