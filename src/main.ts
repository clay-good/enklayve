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
