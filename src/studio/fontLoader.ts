import { FONT_LIBRARY } from "./types";

const loaded = new Set<string>();

export function loadGoogleFont(family: string) {
  if (loaded.has(family)) return;
  loaded.add(family);
  const link = document.createElement("link");
  const url = family.replace(/ /g, "+");
  link.href = `https://fonts.googleapis.com/css2?family=${url}:wght@400;700&display=swap`;
  link.rel = "stylesheet";
  document.head.appendChild(link);
}

export function preloadAllFonts() {
  FONT_LIBRARY.forEach((cat) => cat.fonts.forEach((f) => loadGoogleFont(f)));
}

export async function ensureFontReady(family: string): Promise<void> {
  loadGoogleFont(family);
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await document.fonts.load(`16px "${family}"`);
    await document.fonts.load(`bold 16px "${family}"`);
  } catch {
    // ignore
  }
}
