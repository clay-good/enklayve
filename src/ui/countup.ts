/**
 * The one delightful micro-interaction (BUILD-SPEC.md §10): a gentle count-up
 * on result reveal. It MUST respect the user's reduced-motion preference —
 * when motion is reduced (or no animation API is available, as in tests), the
 * final value is shown immediately with no tween.
 */

const DURATION_MS = 600;

/** True when the user asked the platform to minimize non-essential motion. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Ease-out cubic — fast start, gentle settle. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate `node`'s text from 0 to `target`, formatting each frame with
 * `format`. Returns a cancel function. When motion is reduced the final text
 * is set synchronously and the cancel function is a no-op.
 */
export function countUp(
  node: HTMLElement,
  target: number,
  format: (value: number) => string,
): () => void {
  const finalText = format(target);

  if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
    node.textContent = finalText;
    return () => {};
  }

  let raf = 0;
  let start: number | null = null;

  const step = (now: number): void => {
    if (start === null) start = now;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / DURATION_MS);
    node.textContent = t >= 1 ? finalText : format(target * easeOut(t));
    if (t < 1) raf = requestAnimationFrame(step);
  };

  raf = requestAnimationFrame(step);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    node.textContent = finalText;
  };
}
