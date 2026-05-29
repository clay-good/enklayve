import "./styles.css";
import { mountApp } from "./ui/shell";

/**
 * Entry point. The shell (BUILD-SPEC.md Phase 4) owns the header, the command
 * palette, fragment routing, and the content area that home and tiles render
 * into. Everything is computed on the device; nothing is ever sent anywhere.
 */
const app = document.getElementById("app");
if (app) {
  void mountApp(app);
}

// Offline support (BUILD-SPEC.md §8): register the service worker after load so
// it never blocks first paint. Guarded and silent — the app works without it.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort; the app still works without it */
    });
  });
}
