import { useCallback, useEffect, useRef, useState } from "react";

export type ViewType =
  | "messages"
  | "discover"
  | "explore"
  | "moments"
  | "profile"
  | "chat"
  | "characterProfile";

const ALLOWED_VIEWS: ViewType[] = [
  "messages",
  "discover",
  "explore",
  "moments",
  "profile",
  "chat",
  "characterProfile",
];

function isViewType(value: string): value is ViewType {
  return (ALLOWED_VIEWS as string[]).includes(value);
}

function readViewFromHash(fallback: ViewType): ViewType {
  if (typeof window === "undefined") return fallback;
  const raw = window.location.hash.replace(/^#\/?/, "").trim();
  return raw && isViewType(raw) ? raw : fallback;
}

/**
 * Sync a view state with the URL hash and browser history stack so the native
 * back/forward buttons (including iOS swipe-back gesture) navigate between
 * views. A `push` replaces the current history entry if the same view is
 * already on top to avoid runaway history growth.
 */
export function useViewHistory(initial: ViewType) {
  const [view, setViewState] = useState<ViewType>(() => readViewFromHash(initial));
  const isPoppingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!window.location.hash) {
      window.history.replaceState({ view }, "", `#/${view}`);
    }

    const onPopState = (event: PopStateEvent) => {
      const next =
        (event.state && isViewType(event.state.view) && event.state.view) ||
        readViewFromHash(initial);
      isPoppingRef.current = true;
      setViewState(next);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initial, view]);

  const setView = useCallback(
    (next: ViewType, options: { replace?: boolean } = {}) => {
      setViewState((current) => {
        if (current === next) return current;

        if (isPoppingRef.current) {
          isPoppingRef.current = false;
          return next;
        }

        try {
          const hash = `#/${next}`;
          if (options.replace) {
            window.history.replaceState({ view: next }, "", hash);
          } else {
            window.history.pushState({ view: next }, "", hash);
          }
        } catch {
          // ignore — non-browser contexts or sandboxed iframes
        }
        return next;
      });
    },
    []
  );

  return [view, setView] as const;
}
