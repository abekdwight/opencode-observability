import React from "react";

export interface UseJsonOptions {
  /**
   * Keep the last successful payload while refetching. Opt in for views
   * where the URL change is a filter on the same content (prevents layout
   * shift); leave off when the URL identifies a different entity, where
   * showing stale data would be misleading.
   */
  keepPreviousData?: boolean;
}

export function useJson<T>(url: string, options: UseJsonOptions = {}) {
  const { keepPreviousData = false } = options;
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    if (!keepPreviousData) {
      setData(null);
    }

    fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(payload?.message || `HTTP ${response.status}`);
        }
        return (await response.json()) as T;
      })
      .then((payload) => {
        setData(payload);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [url, keepPreviousData]);

  return { data, error, loading };
}
