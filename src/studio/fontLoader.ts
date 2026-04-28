import { FONT_LIBRARY } from "./types";

const loaded = new Set<string>();
const customFonts = new Map<string, string>(); // name -> dataUrl

const CUSTOM_FONTS_KEY = "designtext.customFonts.v1";

// Load custom fonts from localStorage on startup
try {
  const raw = localStorage.getItem(CUSTOM_FONTS_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as { name: string; dataUrl: string }[];
    parsed.forEach((f) => customFonts.set(f.name, f.dataUrl));
  }
} catch {}

function persistCustomFonts() {
  try {
    const arr = Array.from(customFonts.entries()).map(([name, dataUrl]) => ({ name, dataUrl }));
    localStorage.setItem(CUSTOM_FONTS_KEY, JSON.stringify(arr));
  } catch {}
}

/** Register a custom font uploaded by user */
export async function registerCustomFont(name: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      customFonts.set(name, dataUrl);
      persistCustomFonts();
      // Register with CSS
      const fontFace = new FontFace(name, `url(${dataUrl})`);
      try {
        const loadedFace = await fontFace.load();
        document.fonts.add(loadedFace);
        loaded.add(name);
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Get list of custom font names */
export function getCustomFontNames(): string[] {
  return Array.from(customFonts.keys());
}

/** Remove a custom font */
export function removeCustomFont(name: string) {
  customFonts.delete(name);
  loaded.delete(name);
  persistCustomFonts();
}

/** Load a custom font from localStorage (on page load) */
async function loadCustomFontFromStorage(name: string, dataUrl: string) {
  try {
    const fontFace = new FontFace(name, `url(${dataUrl})`);
    const loadedFace = await fontFace.load();
    document.fonts.add(loadedFace);
    loaded.add(name);
  } catch {
    // Font file might be corrupt
  }
}

export function loadGoogleFont(family: string) {
  if (loaded.has(family)) return;
  // Check if it's a custom font
  if (customFonts.has(family)) {
    loadCustomFontFromStorage(family, customFonts.get(family)!);
    return;
  }
  loaded.add(family);
  const link = document.createElement("link");
  const url = family.replace(/ /g, "+");
  link.href = `https://fonts.googleapis.com/css2?family=${url}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
  link.rel = "stylesheet";
  document.head.appendChild(link);
}

export function preloadAllFonts() {
  FONT_LIBRARY.forEach((cat) => cat.fonts.forEach((f) => loadGoogleFont(f)));
  // Also load custom fonts from storage
  customFonts.forEach((dataUrl, name) => {
    if (!loaded.has(name)) loadCustomFontFromStorage(name, dataUrl);
  });
}

export async function ensureFontReady(family: string): Promise<void> {
  loadGoogleFont(family);
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    // Wait with timeout
    const timeout = (ms: number) => new Promise<void>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));
    await Promise.race([
      Promise.all([
        document.fonts.load(`16px "${family}"`),
        document.fonts.load(`bold 16px "${family}"`),
        document.fonts.load(`italic 16px "${family}"`),
      ]),
      timeout(3000),
    ]);
  } catch {
    // Font may not be available yet, continue anyway
  }
}