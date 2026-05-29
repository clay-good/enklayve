/**
 * Fragment-based routing (BUILD-SPEC.md §2 principle 7, Phase 4).
 *
 * All navigable state lives in the URL fragment so a pasted link reproduces the
 * exact view and inputs, and nothing touches the network or the back end. A
 * route is `#/<tileId>?<encoded inputs>`; the bare `#` (or empty) is home.
 *
 * Sensitive figures live in the fragment, never in history-spamming pushes:
 * input edits use replaceState so the back button leaves a tile rather than
 * stepping through every keystroke.
 */

export interface Route {
  /** Tile id, or null for the home view. */
  tileId: string | null;
  /** Decoded per-tile state. */
  params: URLSearchParams;
}

/** Parse the current location fragment into a {@link Route}. */
export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const trimmed = raw.replace(/^\/+/, "");
  if (trimmed.length === 0) return { tileId: null, params: new URLSearchParams() };

  const qIndex = trimmed.indexOf("?");
  const tileId = qIndex === -1 ? trimmed : trimmed.slice(0, qIndex);
  const query = qIndex === -1 ? "" : trimmed.slice(qIndex + 1);
  return { tileId: decodeURIComponent(tileId), params: new URLSearchParams(query) };
}

/** Serialize a route to a fragment string (including the leading `#`). */
export function buildHash(tileId: string | null, params?: URLSearchParams): string {
  if (!tileId) return "#";
  const query = params?.toString() ?? "";
  return query.length > 0
    ? `#/${encodeURIComponent(tileId)}?${query}`
    : `#/${encodeURIComponent(tileId)}`;
}

/** Build the full shareable URL for the current route. */
export function permalinkFor(tileId: string | null, params?: URLSearchParams): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${buildHash(tileId, params)}`;
}

export type RouteHandler = (route: Route) => void;

export class Router {
  private handler: RouteHandler = () => {};

  /** Subscribe to route changes and fire once with the current route. */
  start(handler: RouteHandler): void {
    this.handler = handler;
    window.addEventListener("hashchange", this.onHashChange);
    this.handler(parseHash(window.location.hash));
  }

  stop(): void {
    window.removeEventListener("hashchange", this.onHashChange);
  }

  /** Navigate to a tile (pushes history — a real navigation). */
  navigate(tileId: string | null, params?: URLSearchParams): void {
    const hash = buildHash(tileId, params);
    if (hash === (window.location.hash || "#")) {
      // Same route: re-fire so a "go home" click from home still works.
      this.handler(parseHash(hash));
      return;
    }
    window.location.hash = hash;
  }

  /**
   * Update the current tile's encoded state without adding a history entry —
   * used as the user edits inputs so the URL always reflects the result.
   */
  replaceState(tileId: string, params: URLSearchParams): void {
    const hash = buildHash(tileId, params);
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    window.history.replaceState(null, "", url);
  }

  private onHashChange = (): void => {
    this.handler(parseHash(window.location.hash));
  };
}
