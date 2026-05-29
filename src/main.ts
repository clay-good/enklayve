import "./styles.css";

/**
 * Phase 0 hello page: renders the wordmark in royal purple. The full shell,
 * tiles, and command palette arrive in later phases (see BUILD-SPEC.md §13).
 */
export function renderHello(root: HTMLElement): void {
  const heading = document.createElement("h1");
  heading.className = "wordmark";
  heading.textContent = "enklayve";

  const tagline = document.createElement("p");
  tagline.className = "tagline";
  tagline.textContent =
    "Your private financial enclave. Every number is computed on your device. Nothing is ever sent anywhere.";

  root.replaceChildren(heading, tagline);
}

const app = document.getElementById("app");
if (app) {
  renderHello(app);
}
