import * as fabric from "fabric";
import { TextLayer, SvgElement, BackgroundOverlay } from "./types";
import { ensureFontReady } from "./fontLoader";

export type RenderOptions = {
  width: number;
  height: number;
  backgroundImageUrl?: string | null;
  bgMode: "image" | "color" | "gradient";
  bgColor: string;
  gradientFrom: string;
  gradientTo: string;
  overlay: BackgroundOverlay;
  layers: TextLayer[];
  svgElements?: SvgElement[]; // ★ NEW
};

/** Apply fill color override to SVG markup (preserves fill="none") */
export function applySvgFillOverride(svgContent: string, fill: string): string {
  let result = svgContent;
  result = result.replace(/fill="(?!none)[^"]*"/g, `fill="${fill}"`);
  result = result.replace(/fill:\s*(?!none)[^;"]+/g, `fill: ${fill}`);
  return result;
}

/** Convert SVG string to a data URL */
export function svgToDataUrl(svgContent: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgContent)))}`;
}

function applyOverlay(canvas: fabric.StaticCanvas | fabric.Canvas, overlay: BackgroundOverlay) {
  if (overlay === "none") return;
  const w = canvas.getWidth();
  const h = canvas.getHeight();
  if (overlay === "dark") {
    const rect = new fabric.Rect({
      left: 0, top: 0, width: w, height: h,
      fill: new fabric.Gradient({
        type: "linear", coords: { x1: 0, y1: 0, x2: 0, y2: h },
        colorStops: [{ offset: 0, color: "rgba(0,0,0,0.1)" }, { offset: 1, color: "rgba(0,0,0,0.75)" }],
      }),
      selectable: false, evented: false,
    });
    canvas.add(rect);
  } else if (overlay === "light") {
    canvas.add(new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: "rgba(255,255,255,0.25)", selectable: false, evented: false }));
  } else if (overlay === "vignette") {
    canvas.add(new fabric.Rect({
      left: 0, top: 0, width: w, height: h,
      fill: new fabric.Gradient({
        type: "radial",
        coords: { x1: w / 2, y1: h / 2, r1: Math.min(w, h) * 0.3, x2: w / 2, y2: h / 2, r2: Math.max(w, h) * 0.7 },
        colorStops: [{ offset: 0, color: "rgba(0,0,0,0)" }, { offset: 1, color: "rgba(0,0,0,0.7)" }],
      }),
      selectable: false, evented: false,
    }));
  }
}

function buildTextbox(layer: TextLayer, interactive: boolean): fabric.Textbox {
  const tb = new fabric.Textbox(layer.text, {
    left: layer.left, top: layer.top, width: layer.width,
    fontFamily: layer.fontFamily, fontSize: layer.fontSize, fill: layer.fill,
    fontWeight: layer.fontWeight, fontStyle: layer.fontStyle, textAlign: layer.textAlign,
    opacity: layer.opacity, lineHeight: layer.lineHeight, charSpacing: layer.charSpacing,
    originX: "center", originY: "center",
    selectable: interactive, evented: interactive, editable: interactive, splitByGrapheme: false,
  });
  tb.set("data", { layerId: layer.id });
  if (layer.styles) tb.styles = JSON.parse(JSON.stringify(layer.styles));
  if (layer.effects.shadow) tb.set("shadow", new fabric.Shadow({ color: "rgba(0,0,0,0.55)", blur: 12, offsetX: 0, offsetY: 4 }));
  if (layer.effects.glow) tb.set("shadow", new fabric.Shadow({ color: layer.fill, blur: 30, offsetX: 0, offsetY: 0 }));
  if (layer.effects.stroke) tb.set({ stroke: layer.strokeColor, strokeWidth: layer.strokeWidth, paintFirst: "stroke" });
  return tb;
}

function imageToFabricImage(url: string): Promise<fabric.FabricImage> {
  return new Promise((resolve, reject) => {
    const imgEl = new Image();
    imgEl.crossOrigin = "anonymous";
    imgEl.onload = () => resolve(new fabric.FabricImage(imgEl));
    imgEl.onerror = reject;
    imgEl.src = url;
  });
}

/** ★ NEW: Load an SvgElement as a fabric image for rendering */
async function buildSvgObject(el: SvgElement, interactive: boolean): Promise<fabric.FabricImage> {
  let content = el.svgContent;
  if (el.fill) content = applySvgFillOverride(content, el.fill);
  const dataUrl = svgToDataUrl(content);
  const img = await imageToFabricImage(dataUrl);
  const scaleX = el.width / (img.width || 1);
  const scaleY = el.height / (img.height || 1);
  img.set({
    left: el.left, top: el.top,
    scaleX, scaleY,
    angle: el.angle, opacity: el.opacity,
    originX: "center", originY: "center",
    selectable: interactive, evented: interactive,
  });
  img.set("data", { svgId: el.id });
  return img;
}

export async function applyBackground(canvas: fabric.Canvas | fabric.StaticCanvas, opts: RenderOptions) {
  const w = opts.width;
  const h = opts.height;
  if (opts.bgMode === "color") {
    canvas.backgroundColor = opts.bgColor;
  } else if (opts.bgMode === "gradient") {
    const grad = new fabric.Gradient({
      type: "linear", coords: { x1: 0, y1: 0, x2: w, y2: h },
      colorStops: [{ offset: 0, color: opts.gradientFrom }, { offset: 1, color: opts.gradientTo }],
    });
    canvas.add(new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: grad as unknown as string, selectable: false, evented: false }));
  } else if (opts.bgMode === "image" && opts.backgroundImageUrl) {
    try {
      const img = await imageToFabricImage(opts.backgroundImageUrl);
      const scale = Math.max(w / img.width!, h / img.height!);
      img.scale(scale);
      img.set({ left: w / 2, top: h / 2, originX: "center", originY: "center", selectable: false, evented: false });
      canvas.add(img);
    } catch { canvas.backgroundColor = opts.bgColor; }
  } else {
    canvas.backgroundColor = opts.bgColor;
  }
}

export async function renderToDataURL(opts: RenderOptions, multiplier = 1): Promise<string> {
  await Promise.all(opts.layers.map((l) => ensureFontReady(l.fontFamily)));

  const staticCanvas = new fabric.StaticCanvas(undefined, {
    width: opts.width, height: opts.height, backgroundColor: opts.bgColor,
  });

  await applyBackground(staticCanvas, opts);
  applyOverlay(staticCanvas, opts.overlay);

  // ★ NEW: render SVG elements (between overlay and text)
  if (opts.svgElements && opts.svgElements.length > 0) {
    for (const el of opts.svgElements) {
      try {
        const svgObj = await buildSvgObject(el, false);
        staticCanvas.add(svgObj);
      } catch (err) {
        console.warn("Failed to render SVG element:", el.name, err);
      }
    }
  }

  for (const layer of opts.layers) {
    staticCanvas.add(buildTextbox(layer, false));
  }
  staticCanvas.renderAll();
  const url = staticCanvas.toDataURL({ format: "png", multiplier, quality: 1 });
  staticCanvas.dispose();
  return url;
}

export function substitutePlaceholders(
  text: string, row: Record<string, string> | null,
  mapping: Record<string, string>, extras?: Record<string, string>
): string {
  return text.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const trimmed = key.trim();
    if (extras && extras[trimmed] != null) return extras[trimmed];
    if (row) {
      const mapped = mapping[trimmed] ?? trimmed;
      if (row[mapped] != null) return row[mapped];
      if (row[trimmed] != null) return row[trimmed];
    }
    return `{${trimmed}}`;
  });
}

export function filenameToTitle(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

export function extractPlaceholders(layers: TextLayer[]): string[] {
  const set = new Set<string>();
  for (const l of layers) {
    const matches = l.text.matchAll(/\{([^}]+)\}/g);
    for (const m of matches) set.add(m[1].trim());
  }
  return Array.from(set);
}