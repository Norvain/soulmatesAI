import { useEffect } from "react";

interface SwipeBackOptions {
  enabled?: boolean;
  onBack: () => void;
  edgeSize?: number;
  minDistance?: number;
  maxVerticalDeviation?: number;
}

/**
 * Attach an iOS-style "swipe from the left edge to go back" gesture to the
 * whole window. Keeps UX minimal: no visual preview, just fires `onBack` when
 * the user performs a confident rightward swipe that started inside the
 * edge-sensitive strip.
 */
export function useSwipeBack({
  enabled = true,
  onBack,
  edgeSize = 28,
  minDistance = 70,
  maxVerticalDeviation = 60,
}: SwipeBackOptions) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX > edgeSize) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      const dy = Math.abs(touch.clientY - startY);
      if (dy > maxVerticalDeviation) {
        tracking = false;
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dx >= minDistance && dy <= maxVerticalDeviation) {
        onBack();
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", () => {
      tracking = false;
    });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, onBack, edgeSize, minDistance, maxVerticalDeviation]);
}
