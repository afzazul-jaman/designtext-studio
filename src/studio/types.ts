export type CanvasPreset = {
  name: string;
  width: number;
  height: number;
};

export const CANVAS_PRESETS: CanvasPreset[] = [
  { name: "Instagram Post", width: 1080, height: 1080 },
  { name: "Instagram Story", width: 1080, height: 1920 },
  { name: "Facebook Post", width: 1200, height: 630 },
  { name: "Twitter Post", width: 1600, height: 900 },
  { name: "A4 Portrait", width: 1240, height: 1754 },
  { name: "Custom 1200x800", width: 1200, height: 800 },
];

export type TextLayer = {
  id: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: "left" | "center" | "right";
  left: number;
  top: number;
  width: number;
  opacity: number;
  lineHeight: number;
  charSpacing: number; // fabric uses 1/1000 em
  effects: {
    shadow: boolean;
    stroke: boolean;
    glow: boolean;
    gradient: boolean;
  };
  strokeColor: string;
  strokeWidth: number;
};

export type UploadedImage = {
  id: string;
  name: string;
  dataUrl: string;
};

export type CSVData = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
};

export type BackgroundOverlay = "none" | "dark" | "light" | "vignette";

export type GeneratedPage = {
  id: string;
  rowIndex: number | null;
  thumbnail: string;
  fullDataUrl: string;
  rowData?: Record<string, string>;
};

export const FONT_LIBRARY: { category: string; fonts: string[] }[] = [
  {
    category: "Sans-serif",
    fonts: ["Inter", "Poppins", "Montserrat", "Roboto", "Work Sans", "DM Sans", "Manrope", "Outfit"],
  },
  {
    category: "Serif",
    fonts: ["Playfair Display", "Merriweather", "Lora", "DM Serif Display", "Cormorant Garamond"],
  },
  {
    category: "Display",
    fonts: ["Bebas Neue", "Anton", "Archivo Black", "Abril Fatface", "Bungee"],
  },
  {
    category: "Script",
    fonts: ["Pacifico", "Dancing Script", "Great Vibes", "Sacramento", "Caveat"],
  },
  {
    category: "Handwriting",
    fonts: ["Kalam", "Shadows Into Light", "Indie Flower", "Patrick Hand"],
  },
  {
    category: "Monospace",
    fonts: ["JetBrains Mono", "Fira Code", "Space Mono", "IBM Plex Mono"],
  },
];

export const COLOR_PALETTE = [
  "#ffffff", "#000000", "#f87171", "#fb923c", "#fbbf24", "#a3e635",
  "#34d399", "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fb7185",
  "#1e293b", "#475569", "#94a3b8", "#cbd5e1", "#fef3c7", "#fce7f3",
  "#7c3aed", "#0891b2", "#16a34a", "#dc2626", "#ea580c", "#0284c7",
];

export const TEMPLATES: {
  id: string;
  name: string;
  preview: string;
  layers: Omit<TextLayer, "id">[];
}[] = [
  {
    id: "headline-bold",
    name: "Bold Headline",
    preview: "linear-gradient(135deg, #7c3aed, #22d3ee)",
    layers: [
      {
        text: "BIG HEADLINE",
        fontFamily: "Bebas Neue",
        fontSize: 140,
        fill: "#ffffff",
        fontWeight: "bold",
        fontStyle: "normal",
        textAlign: "center",
        left: 540,
        top: 480,
        width: 900,
        opacity: 1,
        lineHeight: 1,
        charSpacing: 50,
        effects: { shadow: true, stroke: false, glow: false, gradient: false },
        strokeColor: "#000000",
        strokeWidth: 2,
      },
      {
        text: "Subtitle goes here",
        fontFamily: "Inter",
        fontSize: 42,
        fill: "#e2e8f0",
        fontWeight: "normal",
        fontStyle: "normal",
        textAlign: "center",
        left: 540,
        top: 620,
        width: 900,
        opacity: 0.95,
        lineHeight: 1.3,
        charSpacing: 0,
        effects: { shadow: true, stroke: false, glow: false, gradient: false },
        strokeColor: "#000000",
        strokeWidth: 0,
      },
    ],
  },
  {
    id: "minimal-quote",
    name: "Minimal Quote",
    preview: "linear-gradient(135deg, #1e293b, #0f172a)",
    layers: [
      {
        text: "“A good design speaks for itself.”",
        fontFamily: "Playfair Display",
        fontSize: 72,
        fill: "#ffffff",
        fontWeight: "normal",
        fontStyle: "italic",
        textAlign: "center",
        left: 540,
        top: 540,
        width: 880,
        opacity: 1,
        lineHeight: 1.2,
        charSpacing: 0,
        effects: { shadow: false, stroke: false, glow: false, gradient: false },
        strokeColor: "#000000",
        strokeWidth: 0,
      },
    ],
  },
  {
    id: "product-card",
    name: "Product Card",
    preview: "linear-gradient(135deg, #f43f5e, #fb923c)",
    layers: [
      {
        text: "{name}",
        fontFamily: "Montserrat",
        fontSize: 96,
        fill: "#ffffff",
        fontWeight: "bold",
        fontStyle: "normal",
        textAlign: "left",
        left: 80,
        top: 760,
        width: 920,
        opacity: 1,
        lineHeight: 1.05,
        charSpacing: 0,
        effects: { shadow: true, stroke: false, glow: false, gradient: false },
        strokeColor: "#000",
        strokeWidth: 0,
      },
      {
        text: "{price}",
        fontFamily: "Inter",
        fontSize: 56,
        fill: "#fbbf24",
        fontWeight: "bold",
        fontStyle: "normal",
        textAlign: "left",
        left: 80,
        top: 900,
        width: 600,
        opacity: 1,
        lineHeight: 1.2,
        charSpacing: 0,
        effects: { shadow: true, stroke: false, glow: false, gradient: false },
        strokeColor: "#000",
        strokeWidth: 0,
      },
    ],
  },
  {
    id: "neon-glow",
    name: "Neon Glow",
    preview: "linear-gradient(135deg, #a78bfa, #ec4899)",
    layers: [
      {
        text: "GLOW",
        fontFamily: "Anton",
        fontSize: 220,
        fill: "#22d3ee",
        fontWeight: "bold",
        fontStyle: "normal",
        textAlign: "center",
        left: 540,
        top: 540,
        width: 900,
        opacity: 1,
        lineHeight: 1,
        charSpacing: 80,
        effects: { shadow: false, stroke: false, glow: true, gradient: false },
        strokeColor: "#000",
        strokeWidth: 0,
      },
    ],
  },
];
