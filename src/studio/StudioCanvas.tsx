import { useEffect, useRef, useState, useCallback } from "react";
import * as fabric from "fabric";
import { useStudio } from "./store";
import { applyBackground, applySvgFillOverride, svgToDataUrl } from "./canvasRenderer";
import { ensureFontReady } from "./fontLoader";
import type { ShadowSettings } from "./types";

let activeFabricCanvas: fabric.Canvas | null = null;
export function getActiveFabricCanvas(): fabric.Canvas | null { return activeFabricCanvas; }

export function applyStyleToSelection(patch: Record<string, unknown>, updateLayer: (id: string, u: Record<string, unknown>) => void): boolean {
  const c = activeFabricCanvas; if (!c) return false;
  const obj = c.getActiveObject() as (fabric.Textbox & { isEditing?: boolean; data?: { layerId?: string } }) | null;
  if (!obj || !(obj instanceof fabric.Textbox) || !obj.isEditing) return false;
  const start = obj.selectionStart ?? 0, end = obj.selectionEnd ?? 0;
  if (start === end) return false;
  obj.setSelectionStyles(patch, start, end); c.requestRenderAll();
  if (obj.data?.layerId) updateLayer(obj.data.layerId, { styles: obj.styles ? JSON.parse(JSON.stringify(obj.styles)) : undefined });
  return true;
}

function previewSubstitute(text: string, row: Record<string, string> | null, mapping: Record<string, string>): string {
  if (!row) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => { const col = mapping[key] ?? key; return row[col] ?? match; });
}

async function loadSvgAsFabricImage(svgContent: string, fill?: string | null): Promise<fabric.FabricImage> {
  let content = svgContent;
  if (fill) content = applySvgFillOverride(content, fill);
  const dataUrl = svgToDataUrl(content);
  return new Promise((resolve, reject) => {
    const imgEl = new Image(); imgEl.crossOrigin = "anonymous";
    imgEl.onload = () => resolve(new fabric.FabricImage(imgEl));
    imgEl.onerror = (e) => reject(e); imgEl.src = dataUrl;
  });
}

const DEFAULT_SHADOW: ShadowSettings = { enabled: true, color: "rgba(0,0,0,0.55)", blur: 12, offsetX: 0, offsetY: 4 };

function buildFabricShadow(layer: { effects: { shadow: boolean; glow: boolean }; fill: string; shadowSettings?: ShadowSettings }): fabric.Shadow | null {
  if (layer.shadowSettings?.enabled) {
    const s = layer.shadowSettings;
    return new fabric.Shadow({ color: s.color, blur: s.blur, offsetX: s.offsetX, offsetY: s.offsetY });
  }
  if (layer.effects.glow) return new fabric.Shadow({ color: layer.fill, blur: 30, offsetX: 0, offsetY: 0 });
  if (layer.effects.shadow) return new fabric.Shadow({ color: DEFAULT_SHADOW.color, blur: DEFAULT_SHADOW.blur, offsetX: DEFAULT_SHADOW.offsetX, offsetY: DEFAULT_SHADOW.offsetY });
  return null;
}

// Alignment guides
const SNAP_THRESHOLD = 8;
const GUIDE_COLOR = "#38bdf8";
const GUIDE_WIDTH = 1.5;

function clearGuideLines(canvas: fabric.Canvas) {
  const toRemove = canvas.getObjects().filter((o) => (o as fabric.Object & { data?: { guideLine?: boolean } }).data?.guideLine);
  toRemove.forEach((o) => canvas.remove(o));
}

function showGuide(canvas: fabric.Canvas, orientation: "h" | "v", pos: number) {
  const w = canvas.getWidth(), h = canvas.getHeight();
  const coords = orientation === "v" ? [pos, 0, pos, h] : [0, pos, w, pos];
  const line = new fabric.Line(coords, {
    stroke: GUIDE_COLOR, strokeWidth: GUIDE_WIDTH, strokeDashArray: [6, 3],
    selectable: false, evented: false, opacity: 1,
  });
  line.set("data", { guideLine: true });
  canvas.add(line);
}

function snapAndGuide(canvas: fabric.Canvas, obj: fabric.Object) {
  clearGuideLines(canvas);
  const cw = canvas.getWidth(), ch = canvas.getHeight();
  const bound = obj.getBoundingRect();
  const cx = bound.left + bound.width / 2, cy = bound.top + bound.height / 2;
  const l = bound.left, r = bound.left + bound.width, t = bound.top, b = bound.top + bound.height;

  const targets: { val: number; guide: number; axis: "x" | "y" }[] = [
    { val: cx, guide: cw / 2, axis: "x" }, { val: cy, guide: ch / 2, axis: "y" },
    { val: l, guide: 0, axis: "x" }, { val: r, guide: cw, axis: "x" },
    { val: t, guide: 0, axis: "y" }, { val: b, guide: ch, axis: "y" },
  ];

  canvas.getObjects().forEach((other) => {
    const d = (other as fabric.Object & { data?: { layerId?: string; svgId?: string; guideLine?: boolean } }).data;
    if (!d?.layerId && !d?.svgId) return;
    if (other === obj) return;
    const ob = other.getBoundingRect();
    const ocx = ob.left + ob.width / 2, ocy = ob.top + ob.height / 2;
    targets.push(
      { val: cx, guide: ocx, axis: "x" }, { val: cy, guide: ocy, axis: "y" },
      { val: l, guide: ob.left, axis: "x" }, { val: r, guide: ob.left + ob.width, axis: "x" },
      { val: t, guide: ob.top, axis: "y" }, { val: b, guide: ob.top + ob.height, axis: "y" },
    );
  });

  let snapX: number | null = null, snapY: number | null = null;
  for (const tgt of targets) {
    if (Math.abs(tgt.val - tgt.guide) < SNAP_THRESHOLD) {
      if (tgt.axis === "x" && snapX === null) {
        obj.set("left", (obj.left ?? 0) + (tgt.guide - tgt.val));
        snapX = tgt.guide; showGuide(canvas, "v", tgt.guide);
      } else if (tgt.axis === "y" && snapY === null) {
        obj.set("top", (obj.top ?? 0) + (tgt.guide - tgt.val));
        snapY = tgt.guide; showGuide(canvas, "h", tgt.guide);
      }
    }
  }
}

export function StudioCanvas() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const studio = useStudio();
  const studioRef = useRef(studio);
  studioRef.current = studio;

  // ★ FIX: One-shot scroll reset (only after dblclick), NOT a continuous listener
  const resetScrollOnce = useCallback(() => {
    requestAnimationFrame(() => {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      wrapperRef.current?.scrollTo(0, 0);
    });
  }, []);

  useEffect(() => {
    if (!canvasElRef.current) return;

    try {
      fabric.Object.prototype.set({
        borderColor: GUIDE_COLOR,
        cornerColor: GUIDE_COLOR,
        cornerStrokeColor: "#ffffff",
        cornerStyle: "circle",
        cornerSize: 10,
        transparentCorners: false,
        borderScaleFactor: 2,
      });
    } catch {}

    const c = new fabric.Canvas(canvasElRef.current, { preserveObjectStacking: true, backgroundColor: "#1a1a2e" });
    fabricRef.current = c; activeFabricCanvas = c;

    c.on("object:moving", (e) => { if (e.target) snapAndGuide(c, e.target); });
    c.on("object:moved", () => clearGuideLines(c));

    c.on("object:modified", (e) => {
      clearGuideLines(c);
      const obj = e.target as fabric.Object & { data?: { layerId?: string; svgId?: string } }; if (!obj?.data) return;
      if (obj.data.layerId) {
        const tb = obj as fabric.Textbox;
        studioRef.current.updateLayer(obj.data.layerId, { left: tb.left ?? 0, top: tb.top ?? 0, width: tb.width ?? 100, fontSize: Math.round((tb.fontSize ?? 16) * (tb.scaleX ?? 1)), styles: tb.styles ? JSON.parse(JSON.stringify(tb.styles)) : undefined });
        tb.set({ scaleX: 1, scaleY: 1 }); c.renderAll();
      }
      if (obj.data.svgId) {
        const img = obj as fabric.FabricImage;
        studioRef.current.updateSvgElement(obj.data.svgId, { left: img.left ?? 0, top: img.top ?? 0, width: Math.round((img.width ?? 100) * (img.scaleX ?? 1)), height: Math.round((img.height ?? 100) * (img.scaleY ?? 1)), angle: img.angle ?? 0 });
      }
    });

    c.on("text:changed", (e) => { const tb = e.target as fabric.Textbox & { data?: { layerId?: string } }; if (tb.data?.layerId) studioRef.current.updateLayer(tb.data.layerId, { text: tb.text ?? "", styles: tb.styles ? JSON.parse(JSON.stringify(tb.styles)) : undefined }); });
    c.on("selection:created", (e) => { const obj = e.selected?.[0] as (fabric.Object & { data?: { layerId?: string; svgId?: string } }) | undefined; if (obj?.data?.layerId) studioRef.current.setActiveLayer(obj.data.layerId); else if (obj?.data?.svgId) studioRef.current.setActiveSvgId(obj.data.svgId); });
    c.on("selection:updated", (e) => { const obj = e.selected?.[0] as (fabric.Object & { data?: { layerId?: string; svgId?: string } }) | undefined; if (obj?.data?.layerId) studioRef.current.setActiveLayer(obj.data.layerId); else if (obj?.data?.svgId) studioRef.current.setActiveSvgId(obj.data.svgId); });
    c.on("selection:cleared", () => { studioRef.current.setActiveLayer(null); studioRef.current.setActiveSvgId(null); });
    c.on("mouse:dblclick", (e) => {
      const target = e.target as fabric.Textbox | undefined;
      const layerId = (target as fabric.Object & { data?: { layerId?: string } })?.data?.layerId;
      if (!target || !layerId || !(target instanceof fabric.Textbox)) return;
      studioRef.current.setActiveLayer(layerId); target.enterEditing(); target.hiddenTextarea?.focus();
      // ★ FIX: one-shot reset only after dblclick — no continuous listener
      resetScrollOnce();
    });

    return () => { activeFabricCanvas = null; c.dispose(); fabricRef.current = null; };
  }, [resetScrollOnce]);

  // ★ FIX: REMOVED the continuous scroll listener that caused UI dance.
  // overflow:clip on the wrapper div handles scroll prevention via CSS.
  // No JS scroll listeners needed.

  // Resize
  useEffect(() => {
    const c = fabricRef.current, w = wrapperRef.current; if (!c || !w) return;
    c.setWidth(studio.canvasPreset.width); c.setHeight(studio.canvasPreset.height);
    const resize = () => { const s = Math.min((w.clientWidth - 32) / studio.canvasPreset.width, (w.clientHeight - 32) / studio.canvasPreset.height); setDisplayScale(s > 0 ? s : 1); };
    resize(); const ro = new ResizeObserver(resize); ro.observe(w); return () => ro.disconnect();
  }, [studio.canvasPreset]);

  // Background
  useEffect(() => {
    const c = fabricRef.current; if (!c) return; let cancelled = false;
    (async () => {
      const activeImage = studio.images.find((i) => i.id === studio.activeImageId);
      c.getObjects().forEach((o) => { const d = (o as fabric.Object & { data?: { layerId?: string; svgId?: string; guideLine?: boolean } }).data; if (!d?.layerId && !d?.svgId) c.remove(o); });
      c.backgroundColor = studio.bgColor;
      await applyBackground(c, { width: c.getWidth(), height: c.getHeight(), bgMode: studio.bgMode, bgColor: studio.bgColor, gradientFrom: studio.gradientFrom, gradientTo: studio.gradientTo, backgroundImageUrl: activeImage?.dataUrl ?? null, overlay: studio.overlay, layers: [] });
      if (cancelled) return;
      if (studio.overlay !== "none") {
        const w = c.getWidth(), h = c.getHeight(); let ov: fabric.Object | null = null;
        if (studio.overlay === "dark") ov = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: new fabric.Gradient({ type: "linear", coords: { x1: 0, y1: 0, x2: 0, y2: h }, colorStops: [{ offset: 0, color: "rgba(0,0,0,0.1)" }, { offset: 1, color: "rgba(0,0,0,0.75)" }] }), selectable: false, evented: false });
        else if (studio.overlay === "light") ov = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: "rgba(255,255,255,0.25)", selectable: false, evented: false });
        else if (studio.overlay === "vignette") ov = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: new fabric.Gradient({ type: "radial", coords: { x1: w / 2, y1: h / 2, r1: Math.min(w, h) * 0.3, x2: w / 2, y2: h / 2, r2: Math.max(w, h) * 0.7 }, colorStops: [{ offset: 0, color: "rgba(0,0,0,0)" }, { offset: 1, color: "rgba(0,0,0,0.7)" }] }), selectable: false, evented: false });
        if (ov) c.add(ov);
      }
      // Re-order layers
      const svgObjs = c.getObjects().filter((o) => (o as fabric.Object & { data?: { svgId?: string } }).data?.svgId);
      const textObjs = c.getObjects().filter((o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId);
      const bgObjs = c.getObjects().filter((o) => { const d = (o as fabric.Object & { data?: { layerId?: string; svgId?: string } }).data; return !d?.layerId && !d?.svgId; });
      bgObjs.forEach((o) => c.sendObjectToBack(o)); svgObjs.forEach((o) => c.bringObjectToFront(o)); textObjs.forEach((o) => c.bringObjectToFront(o));
      c.renderAll();
    })();
    return () => { cancelled = true; };
  }, [studio.images, studio.activeImageId, studio.overlay, studio.bgMode, studio.bgColor, studio.gradientFrom, studio.gradientTo]);

  // Sync SVG elements
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    const existing = new Map<string, fabric.FabricImage>();
    c.getObjects().forEach((o) => { const sid = (o as fabric.Object & { data?: { svgId?: string } }).data?.svgId; if (sid) existing.set(sid, o as fabric.FabricImage); });
    const svgIds = new Set(studio.svgElements.map((e) => e.id));
    existing.forEach((obj, id) => { if (!svgIds.has(id)) c.remove(obj); });

    let isCancelled = false;
    (async () => {
      for (const el of studio.svgElements) {
        if (isCancelled) return;
        let img = existing.get(el.id);
        const currentFill = img ? (img as any)._appliedFill ?? null : "__NONE__";
        const targetFill = el.fill ?? null;
        const needsReload = !img || currentFill !== targetFill;

        if (needsReload) {
          if (img) { c.remove(img); existing.delete(el.id); }
          try {
            const newImg = await loadSvgAsFabricImage(el.svgContent, el.fill);
            if (isCancelled) return;
            newImg.set("data", { svgId: el.id });
            (newImg as any)._appliedFill = targetFill;
            c.add(newImg); img = newImg; existing.set(el.id, newImg);
          } catch (err) { console.warn("SVG load fail:", el.name, err); continue; }
        }
        const sx = el.width / (img!.width || 1), sy = el.height / (img!.height || 1);
        img!.set({ left: el.left, top: el.top, scaleX: sx, scaleY: sy, angle: el.angle, opacity: el.opacity, originX: "center", originY: "center" });
        img!.setCoords();
      }
      if (isCancelled) return;
      const textObjs = c.getObjects().filter((o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId);
      textObjs.forEach((o) => c.bringObjectToFront(o));
      c.renderAll();
    })();
    return () => { isCancelled = true; };
  }, [studio.svgElements]);

  // Sync text layers
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    const existing = new Map<string, fabric.Textbox>();
    c.getObjects().forEach((o) => { const d = (o as fabric.Object & { data?: { layerId?: string } }).data; if (d?.layerId) existing.set(d.layerId, o as fabric.Textbox); });
    const layerIds = new Set(studio.layers.map((l) => l.id));
    existing.forEach((obj, id) => { if (!layerIds.has(id)) c.remove(obj); });

    let cancelled = false;
    (async () => {
      for (const layer of studio.layers) {
        await ensureFontReady(layer.fontFamily);
        if (cancelled) return;
        let tb = existing.get(layer.id); const isNew = !tb;
        if (!tb) { tb = new fabric.Textbox(layer.text, { left: layer.left, top: layer.top, width: layer.width, originX: "center", originY: "center" }); tb.set("data", { layerId: layer.id }); c.add(tb); }
        if ((tb as fabric.Textbox & { isEditing?: boolean }).isEditing) continue;
        const displayText = previewSubstitute(layer.text, studio.previewRow, studio.fieldMapping);
        if (tb.text !== displayText) tb.set({ text: displayText });
        const prevFont = tb.fontFamily;
        tb.set({
          fontFamily: layer.fontFamily, fontSize: layer.fontSize, fill: layer.fill,
          fontWeight: layer.fontWeight, fontStyle: layer.fontStyle, textAlign: layer.textAlign,
          opacity: layer.opacity, lineHeight: layer.lineHeight, charSpacing: layer.charSpacing,
          left: layer.left, top: layer.top, width: layer.width,
          shadow: buildFabricShadow(layer),
          stroke: layer.effects?.stroke ? layer.strokeColor : undefined,
          strokeWidth: layer.effects?.stroke ? layer.strokeWidth : 0, paintFirst: "stroke",
        });
        if (prevFont !== layer.fontFamily) { tb.set("dirty", true); tb.initDimensions(); }
        if (isNew) tb.styles = layer.styles ? JSON.parse(JSON.stringify(layer.styles)) : {};
        tb.setCoords();
      }
      if (!cancelled) c.renderAll();
    })();
    return () => { cancelled = true; };
  }, [studio.layers, studio.previewRow, studio.fieldMapping]);

  // Sync active selection
  useEffect(() => { const c = fabricRef.current; if (!c || !studio.activeLayerId) return; const obj = c.getObjects().find((o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId === studio.activeLayerId); if (obj && c.getActiveObject() !== obj && !(obj as fabric.Textbox & { isEditing?: boolean }).isEditing) { c.setActiveObject(obj); c.renderAll(); } }, [studio.activeLayerId]);
  useEffect(() => { const c = fabricRef.current; if (!c || !studio.activeSvgId) return; const obj = c.getObjects().find((o) => (o as fabric.Object & { data?: { svgId?: string } }).data?.svgId === studio.activeSvgId); if (obj && c.getActiveObject() !== obj) { c.setActiveObject(obj); c.renderAll(); } }, [studio.activeSvgId]);
  useEffect(() => { const c = fabricRef.current; if (!c) return; if (!studio.activeLayerId && !studio.activeSvgId) { c.discardActiveObject(); c.renderAll(); } }, [studio.activeLayerId, studio.activeSvgId]);

  // Select all
  useEffect(() => { if (!studio.selectAllNonce) return; const c = fabricRef.current; if (!c) return; const all = c.getObjects().filter((o) => { const d = (o as fabric.Object & { data?: { layerId?: string; svgId?: string } }).data; return d?.layerId || d?.svgId; }); if (!all.length) return; c.discardActiveObject(); if (all.length === 1) c.setActiveObject(all[0]); else c.setActiveObject(new fabric.ActiveSelection(all, { canvas: c })); c.requestRenderAll(); }, [studio.selectAllNonce]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && !(e.ctrlKey || e.metaKey)) {
        if (studioRef.current.activeSvgId) { e.preventDefault(); studioRef.current.removeSvgElement(studioRef.current.activeSvgId); return; }
        if (studioRef.current.activeLayerId) {
          const c = fabricRef.current;
          const obj = c?.getActiveObject() as (fabric.Textbox & { isEditing?: boolean }) | undefined;
          if (!obj?.isEditing) { e.preventDefault(); studioRef.current.removeLayer(studioRef.current.activeLayerId); return; }
        }
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); studioRef.current.undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); studioRef.current.redo(); }
      else if (k === "a") { e.preventDefault(); studioRef.current.selectAllLayers(); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="flex-1 flex items-center justify-center bg-background relative"
      style={{ overflow: "clip" }}
    >
      <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: "linear-gradient(45deg, oklch(0.2 0.02 280) 25%, transparent 25%), linear-gradient(-45deg, oklch(0.2 0.02 280) 25%, transparent 25%)", backgroundSize: "24px 24px" }} />
      <div className="relative" style={{ width: studio.canvasPreset.width * displayScale, height: studio.canvasPreset.height * displayScale, overflow: "clip" }}>
        <div className="shadow-panel rounded-lg ring-1 ring-border absolute top-0 left-0" style={{ width: studio.canvasPreset.width, height: studio.canvasPreset.height, transform: `scale(${displayScale})`, transformOrigin: "top left", overflow: "clip" }}>
          <canvas ref={canvasElRef} />
        </div>
      </div>
    </div>
  );
}