"use client";

import { useCallback, useEffect, useState } from "react";
import { getEntities } from "./api";
import type { EntitySummary } from "./types";

// One shared request for the monument list: the 3D map and the home page both need it.
let cached: Promise<EntitySummary[]> | null = null;

function load(force = false) {
  if (!cached || force) {
    cached = getEntities().then((r) => r.entities);
    cached.catch(() => (cached = null)); // let the next caller retry after a failure
  }
  return cached;
}

export type EntitiesState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; entities: EntitySummary[] };

export function useEntities() {
  const [state, setState] = useState<EntitiesState>({ kind: "loading" });

  const run = useCallback((force = false) => {
    setState({ kind: "loading" });
    load(force)
      .then((entities) => setState({ kind: "ready", entities }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, []);

  useEffect(() => run(), [run]);

  return { state, retry: () => run(true) };
}
