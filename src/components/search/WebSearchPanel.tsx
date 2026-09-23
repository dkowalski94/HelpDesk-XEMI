import React, { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WebSearchResponse, WebSearchResult } from "@/types";

export default function WebSearchPanel() {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<WebSearchResult[] | null>(null);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!query.trim() || pending) return;

    setPending(true);
    setError(null);

    const body = new FormData();
    body.set("query", query);

    try {
      const response = await fetch("/api/web-search", { method: "POST", body });
      const payload = (await response.json()) as WebSearchResponse;
      if (payload.ok) {
        setResults(payload.results);
      } else {
        setError(payload.error);
        setResults(null);
      }
    } catch {
      setError("Could not reach the server. Try again.");
      setResults(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor="query" className="sr-only">
          Search query
        </label>
        <input
          id="query"
          name="query"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="What do you want to find?"
          className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:border-purple-300/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className={cn(
            "flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm transition-colors",
            pending || !query.trim() ? "cursor-not-allowed opacity-50" : "hover:bg-white/20",
          )}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {pending ? "Searching..." : "Search"}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      )}

      {results?.length === 0 && <p className="text-sm text-blue-100/60">No results for that query.</p>}

      {results && results.length > 0 && (
        <ul className="space-y-4">
          {results.map((result) => {
            const meta = [result.author, result.publishedDate?.slice(0, 10)].filter(Boolean).join(" · ");
            return (
              <li key={result.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-purple-200 hover:underline"
                >
                  {result.title}
                </a>
                <p className="mt-1 truncate text-xs text-blue-100/50">{result.url}</p>
                {meta && <p className="mt-1 text-xs text-blue-100/40">{meta}</p>}
                {result.highlights.map((highlight, index) => (
                  <p key={index} className="mt-2 border-l-2 border-purple-300/30 pl-3 text-sm text-blue-100/80">
                    {highlight}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
