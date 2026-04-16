import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  onRefresh: () => Promise<unknown> | void;
  threshold?: number;
  resistance?: number;
  enabled?: boolean;
}

/**
 * Attach a pull-to-refresh gesture to a scrollable container. Returns:
 *  - `pullDistance`: current pixel offset (0 when idle) to drive a visual hint
 *  - `refreshing`:   true while the refresh callback is in flight
 *  - `bind`:         { ref } to attach to the scroll container
 *
 * The gesture only fires when the container is scrolled to the very top and
 * the user pulls down > `threshold` pixels on a touch device.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 64,
  resistance = 2.2,
  enabled = true,
}: Options) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);
  const pullingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      if (!enabled || refreshing) return;
      const element = scrollRef.current;
      if (!element) return;
      if (element.scrollTop > 0) return;
      if (event.touches.length !== 1) return;
      startY.current = event.touches[0].clientY;
      pullingRef.current = true;
    },
    [enabled, refreshing]
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      if (!pullingRef.current || startY.current == null) return;
      const dy = event.touches[0].clientY - startY.current;
      if (dy <= 0) {
        setPullDistance(0);
        return;
      }
      const next = Math.min(dy / resistance, threshold * 1.6);
      setPullDistance(next);
    },
    [resistance, threshold]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!pullingRef.current) return;
    pullingRef.current = false;
    const reached = pullDistance >= threshold;
    setPullDistance(reached ? threshold : 0);

    if (reached) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    }
    startY.current = null;
  }, [onRefresh, pullDistance, threshold]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchmove", handleTouchMove, { passive: true });
    element.addEventListener("touchend", handleTouchEnd);
    element.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    pullDistance,
    refreshing,
    bind: { ref: scrollRef },
  };
}
