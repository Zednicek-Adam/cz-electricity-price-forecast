/**
 * The client's only way to the data: one GET per payload, typed by the API's
 * own contract (`@cz-epf/api`), imported across the workspace with nothing
 * generated.
 *
 * Each payload is fetched once per visit, the first time a view needs it, and
 * kept: switching back to a view, a metric or a day already seen costs no
 * request. Nothing polls and nothing refreshes on a timer, because previews
 * read production Neon and a tab left open must cost nothing (ADR-0010).
 */
import { useEffect, useState } from "react";

const responses = new Map<string, Promise<unknown>>();

export function getJson<T>(path: string): Promise<T> {
  let response = responses.get(path);
  if (!response) {
    response = fetch(path, { headers: { accept: "application/json" } }).then(
      async (r) => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return (await r.json()) as unknown;
      },
    );
    // A failure is not kept, so the next time the view asks it tries again.
    response.catch(() => responses.delete(path));
    responses.set(path, response);
  }
  return response as Promise<T>;
}

/** Forget every kept response. For tests, which each start a fresh visit. */
export function forgetResponses(): void {
  responses.clear();
}

export type Load<T> =
  { state: "loading" } | { state: "ready"; data: T } | { state: "failed" };

/** The payload at `path`, or `null` for a view that needs none right now. */
export function useJson<T>(path: string | null): Load<T> {
  const [load, setLoad] = useState<{ path: string | null; load: Load<T> }>({
    path,
    load: { state: "loading" },
  });
  useEffect(() => {
    if (path === null) return;
    let current = true;
    getJson<T>(path)
      .then(
        (data) => current && setLoad({ path, load: { state: "ready", data } }),
      )
      .catch(() => current && setLoad({ path, load: { state: "failed" } }));
    return () => {
      current = false;
    };
  }, [path]);
  return load.path === path ? load.load : { state: "loading" };
}
