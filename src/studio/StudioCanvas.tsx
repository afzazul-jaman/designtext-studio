import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { useStudio } from "./store";
import { applyBackground, applySvgFillOverride, svgToDataUrl } from "./canvasRenderer";
import { ensureFontReady } from "./fontLoader";

let activeFabricCanvas: fabric.Canvas | null = null;
export function getActiveFabricCanvas(): fabric.Canvas | null {
  return activeFabricCanvas;
}

export function applyStyleToSelection(
  patch: Record<string, unknown>,
  updateLayer: (id: string, updates: Record<string, unknown>) => void
): boolean {
  const c = activeFabricCanvas;
  if (!c) return false;
  const obj = c.getActiveObject() as (fabric.Textbox & { isEditing?: boolean; data?: { layerId?: string } }) | null;
  if (!obj || !(obj instanceof fabric.Textbox)) return false;
  if (!obj.isEditing) return false;
  const start = obj.selectionStart ?? 0;
  const end = obj.selectionEnd ?? 0;
  if (start === end) return false;
  obj.setSelectionStyles(patch, start, end);
  c.requestRenderAll();
  if (obj.data?.layerId) {
    updateLayer(obj.data.layerId, {
      styles: obj.styles ? JSON.parse(JSON.stringify(obj.styles)) : undefined,
    });
  }
  return true;
}

function previewSubstitute(text: string, row: Record<string, string> | null, mapping: Record<string, string>): string {
  if (!row) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    const col = mapping[key] ?? key;
    return row[col] ?? match;
  });
}

/** Load SVG content as a fabric image */
async function loadSvgAsFabricImage(svgContent: string, fill?: string | null): Promise<fabric.FabricImage> {
  let content = svgContent;
  if (fill) content = applySvgFillOverride(content, fill);
  const dataUrl = svgToDataUrl(content);
  return new Promise((resolve, reject) => {
    const imgEl = new Image();
    imgEl.crossOrigin = "anonymous";
    imgEl.onload = () => resolve(new fabric.FabricImage(imgEl));
    imgEl.onerror = reject;
    imgEl.src = dataUrl;
  });
}

export function StudioCanvas() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const studio = useStudio();
  const studioRef = useRef(studio);
  studioRef.current = studio;

  // init fabric once
  useEffect(() => {
    if (!canvasElRef.current) return;
    const c = new fabric.Canvas(canvasElRef.current, {
      preserveObjectStacking: true,
      backgroundColor: "#1a1a2e",
    });
    fabricRef.current = c;
    activeFabricCanvas = c;

    c.on("object:modified", (e) => {
      const obj = e.target as fabric.Object & { data?: { layerId?: string; svgId?: string } };
      if (!obj?.data) return;

      // ★ Handle text layer modification
      if (obj.data.layerId) {
        const tb = obj as fabric.Textbox;
        studioRef.current.updateLayer(obj.data.layerId, {
          left: tb.left ?? 0, top: tb.top ?? 0, width: tb.width ?? 100,
          fontSize: Math.round((tb.fontSize ?? 16) * (tb.scaleX ?? 1)),
          styles: tb.styles ? JSON.parse(JSON.stringify(tb.styles)) : undefined,
        });
        tb.set({ scaleX: 1, scaleY: 1 });
        c.renderAll();
      }

      // ★ Handle SVG element modification
      if (obj.data.svgId) {
        const img = obj as fabric.FabricImage;
        studioRef.current.updateSvgElement(obj.data.svgId, {
          left: img.left ?? 0,
          top: img.top ?? 0,
          width: Math.round((img.width ?? 100) * (img.scaleX ?? 1)),
          height: Math.round((img.height ?? 100) * (img.scaleY ?? 1)),
          angle: img.angle ?? 0,
        });
      }
    });

    c.on("text:changed", (e) => {
      const tb = e.target as fabric.Textbox & { data?: { layerId?: string } };
      if (!tb.data?.layerId) return;
      studioRef.current.updateLayer(tb.data.layerId, {
        text: tb.text ?? "",
        styles: tb.styles ? JSON.parse(JSON.stringify(tb.styles)) : undefined,
      });
    });

    c.on("selection:created", (e) => {
      const obj = e.selected?.[0] as (fabric.Object & { data?: { layerId?: string; svgId?: string } }) | undefined;
      if (obj?.data?.layerId) studioRef.current.setActiveLayer(obj.data.layerId);
      else if (obj?.data?.svgId) studioRef.current.setActiveSvgId(obj.data.svgId);
    });
    c.on("selection:updated", (e) => {
      const obj = e.selected?.[0] as (fabric.Object & { data?: { layerId?: string; svgId?: string } }) | undefined;
      if (obj?.data?.layerId) studioRef.current.setActiveLayer(obj.data.layerId);
      else if (obj?.data?.svgId) studioRef.current.setActiveSvgId(obj.data.svgId);
    });
    c.on("selection:cleared", () => {
      studioRef.current.setActiveLayer(null);
      studioRef.current.setActiveSvgId(null);
    });

    c.on("mouse:dblclick", (e) => {
      const target = e.target as fabric.Textbox | undefined;
      const layerId = (target as fabric.Object & { data?: { layerId?: string } })?.data?.layerId;
      if (!target || !layerId || !(target instanceof fabric.Textbox)) return;
      studioRef.current.setActiveLayer(layerId);
      target.enterEditing();
      target.hiddenTextarea?.focus();
      requestAnimationFrame(() => {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        wrapperRef.current?.scrollTo(0, 0);
      });
    });

    return () => { activeFabricCanvas = null; c.dispose(); fabricRef.current = null; };
  }, []);

  // Prevent scroll
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ps = () => { wrapper.scrollTop = 0; wrapper.scrollLeft = 0; };
    wrapper.addEventListener("scroll", ps);
    const pds = () => { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; };
    document.addEventListener("scroll", pds);
    return () => { wrapper.removeEventListener("scroll", ps); document.removeEventListener("scroll", pds); };
  }, []);

  // Resize
  useEffect(() => {
    const c = fabricRef.current; const wrapper = wrapperRef.current;
    if (!c || !wrapper) return;
    c.setWidth(studio.canvasPreset.width); c.setHeight(studio.canvasPreset.height);
    const resize = () => {
      const padding = 32;
      const scale = Math.min((wrapper.clientWidth - padding) / studio.canvasPreset.width, (wrapper.clientHeight - padding) / studio.canvasPreset.height);
      setDisplayScale(scale > 0 ? scale : 1);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrapper);
    return () => ro.disconnect();
  }, [studio.canvasPreset]);

  // Background
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    let cancelled = false;
    (async () => {
      const activeImage = studio.images.find((i) => i.id === studio.activeImageId);
      c.getObjects().forEach((o) => {
        const data = (o as fabric.Object & { data?: { layerId?: string; svgId?: string } }).data;
        if (!data?.layerId && !data?.svgId) c.remove(o);
      });
      c.backgroundColor = studio.bgColor;
      await applyBackground(c, {
        width: c.getWidth(), height: c.getHeight(),
        bgMode: studio.bgMode, bgColor: studio.bgColor,
        gradientFrom: studio.gradientFrom, gradientTo: studio.gradientTo,
        backgroundImageUrl: activeImage?.dataUrl ?? null,
        overlay: studio.overlay, layers: [],
      });
      if (cancelled) return;
      if (studio.overlay !== "none") {
        const w = c.getWidth(); const h = c.getHeight();
        let ov: fabric.Object | null = null;
        if (studio.overlay === "dark") {
          ov = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: new fabric.Gradient({ type: "linear", coords: { x1: 0, y1: 0, x2: 0, y2: h }, colorStops: [{ offset: 0, color: "rgba(0,0,0,0.1)" }, { offset: 1, color: "rgba(0,0,0,0.75)" }] }), selectable: false, evented: false });
        } else if (studio.overlay === "light") {
          ov = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: "rgba(255,255,255,0.25)", selectable: false, evented: false });
        } else if (studio.overlay === "vignette") {
          ov = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: new fabric.Gradient({ type: "radial", coords: { x1: w / 2, y1: h / 2, r1: Math.min(w, h) * 0.3, x2: w / 2, y2: h / 2, r2: Math.max(w, h) * 0.7 }, colorStops: [{ offset: 0, color: "rgba(0,0,0,0)" }, { offset: 1, color: "rgba(0,0,0,0.7)" }] }), selectable: false, evented: false });
        }
        if (ov) c.add(ov);
      }
      // Re-order: bg objects → svg objects → text objects
      const svgObjs = c.getObjects().filter((o) => (o as fabric.Object & { data?: { svgId?: string } }).data?.svgId);
      const textObjs = c.getObjects().filter((o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId);
      const bgObjs = c.getObjects().filter((o) => { const d = (o as fabric.Object & { data?: { layerId?: string; svgId?: string } }).data; return !d?.layerId && !d?.svgId; });
      bgObjs.forEach((obj) => c.sendObjectToBack(obj));
      svgObjs.forEach((obj) => c.bringObjectToFront(obj));
      textObjs.forEach((obj) => c.bringObjectToFront(obj));
      c.renderAll();
    })();
    return () => { cancelled = true; };
  }, [studio.images, studio.activeImageId, studio.overlay, studio.bgMode, studio.bgColor, studio.gradientFrom, studio.gradientTo]);

  // ★ NEW: Sync SVG elements
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    const existing = new Map<string, fabric.FabricImage>();
    c.getObjects().forEach((o) => {
      const svgId = (o as fabric.Object & { data?: { svgId?: string } }).data?.svgId;
      if (svgId) existing.set(svgId, o as fabric.FabricImage);
    });

    const svgIds = new Set(studio.svgElements.map((e) => e.id));
    existing.forEach((obj, id) => { if (!svgIds.has(id)) c.remove(obj); });

    (async () => {
      for (const el of studio.svgElements) {
        let img = existing.get(el.id);
        if (!img) {
          try {
            img = await loadSvgAsFabricImage(el.svgContent, el.fill);
            img.set("data", { svgId: el.id });
            c.add(img);
          } catch (err) {
            console.warn("Failed to load SVG:", el.name, err);
            continue;
          }
        }
        // Update if fill changed (need to reload SVG with new fill)
        const currentFill = (img as fabric.FabricImage & { _appliedFill?: string | null })._appliedFill;
        if (currentFill !== (el.fill ?? null)) {
          try {
            const newImg = await loadSvgAsFabricImage(el.svgContent, el.fill);
            newImg.set("data", { svgId: el.id });
            (newImg as fabric.FabricImage & { _appliedFill?: string | null })._appliedFill = el.fill ?? null;
            const idx = c.getObjects().indexOf(img);
            c.remove(img);
            c.add(newImg);
            if (idx >= 0) c.moveTo(newImg, idx);
            img = newImg;
          } catch {}
        }

        const scaleX = el.width / (img.width || 1);
        const scaleY = el.height / (img.height || 1);
        img.set({
          left: el.left, top: el.top,
          scaleX, scaleY,
          angle: el.angle, opacity: el.opacity,
          originX: "center", originY: "center",
        });
        img.setCoords();
      }
      // Ensure layer order: SVGs behind text
      const textObjs = c.getObjects().filter((o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId);
      textObjs.forEach((obj) => c.bringObjectToFront(obj));
      c.renderAll();
    })();
  }, [studio.svgElements]);

  // Sync text layers
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    const existing = new Map<string, fabric.Textbox>();
    c.getObjects().forEach((o) => {
      const data = (o as fabric.Object & { data?: { layerId?: string } }).data;
      if (data?.layerId) existing.set(data.layerId, o as fabric.Textbox);
    });

    const layerIds = new Set(studio.layers.map((l) => l.id));
    existing.forEach((obj, id) => { if (!layerIds.has(id)) c.remove(obj); });

    (async () => {
      for (const layer of studio.layers) {
        await ensureFontReady(layer.fontFamily);
        let tb = existing.get(layer.id);
        const isNew = !tb;
        if (!tb) {
          tb = new fabric.Textbox(layer.text, { left: layer.left, top: layer.top, width: layer.width, originX: "center", originY: "center" });
          tb.set("data", { layerId: layer.id });
          c.add(tb);
        }
        const isEditing = (tb as fabric.Textbox & { isEditing?: boolean }).isEditing;
        if (isEditing) continue;

        const displayText = previewSubstitute(layer.text, studio.previewRow, studio.fieldMapping);
        if (tb.text !== displayText) tb.set({ text: displayText });

        tb.set({
          fontFamily: layer.fontFamily, fontSize: layer.fontSize, fill: layer.fill,
          fontWeight: layer.fontWeight, fontStyle: layer.fontStyle, textAlign: layer.textAlign,
          opacity: layer.opacity, lineHeight: layer.lineHeight, charSpacing: layer.charSpacing,
          left: layer.left, top: layer.top, width: layer.width,
          shadow: layer.effects.glow
            ? new fabric.Shadow({ color: layer.fill, blur: 30, offsetX: 0, offsetY: 0 })
            : layer.effects.shadow
            ? new fabric.Shadow({ color: "rgba(0,0,0,0.55)", blur: 12, offsetX: 0, offsetY: 4 })
            : null,
          stroke: layer.effects.stroke ? layer.strokeColor : undefined,
          strokeWidth: layer.effects.stroke ? layer.strokeWidth : 0,
          paintFirst: "stroke",
        });
        if (isNew) tb.styles = layer.styles ? JSON.parse(JSON.stringify(layer.styles)) : {};
        tb.setCoords();
      }
      c.renderAll();
    })();
  }, [studio.layers, studio.previewRow, studio.fieldMapping]);

  // Sync active selection (text)
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    if (!studio.activeLayerId) { return; }
    const obj = c.getObjects().find((o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId === studio.activeLayerId);
    if (obj && c.getActiveObject() !== obj) {
      const isEditing = (obj as fabric.Textbox & { isEditing?: boolean }).isEditing;
      if (!isEditing) { c.setActiveObject(obj); c.renderAll(); }
    }
  }, [studio.activeLayerId]);

  // ★ Sync active selection (SVG)
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    if (!studio.activeSvgId) return;
    const obj = c.getObjects().find((o) => (o as fabric.Object & { data?: { svgId?: string } }).data?.svgId === studio.activeSvgId);
    if (obj && c.getActiveObject() !== obj) { c.setActiveObject(obj); c.renderAll(); }
  }, [studio.activeSvgId]);

  // Deselect when nothing active
  useEffect(() => {
    const c = fabricRef.current; if (!c) return;
    if (!studio.activeLayerId && !studio.activeSvgId) { c.discardActiveObject(); c.renderAll(); }
  }, [studio.activeLayerId, studio.activeSvgId]);

  // Select all
  useEffect(() => {
    if (studio.selectAllNonce === 0) return;
    const c = fabricRef.current; if (!c) return;
    const all = c.getObjects().filter((o) => {
      const d = (o as fabric.Object & { data?: { layerId?: string; svgId?: string } }).data;
      return d?.layerId || d?.svgId;
    });
    if (all.length === 0) return;
    c.discardActiveObject();
    if (all.length === 1) c.setActiveObject(all[0]);
    else c.setActiveObject(new fabric.ActiveSelection(all, { canvas: c }));
    c.requestRenderAll();
  }, [studio.selectAllNonce]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const meta = e.ctrlKey || e.metaKey;

      // Delete key removes active SVG
      if ((e.key === "Delete" || e.key === "Backspace") && !meta) {
        if (studioRef.current.activeSvgId) {
          e.preventDefault();
          studioRef.current.removeSvgElement(studioRef.current.activeSvgId);
          return;
        }
      }

      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); studioRef.current.undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); studioRef.current.redo(); }
      else if (k === "a") { e.preventDefault(); studioRef.current.selectAllLayers(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div ref={wrapperRef} className="flex-1 flex items-center justify-center bg-background relative" style={{ overflow: "clip" }}>
      <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: "linear-gradient(45deg, oklch(0.2 0.02 280) 25%, transparent 25%), linear-gradient(-45deg, oklch(0.2 0.02 280) 25%, transparent 25%)", backgroundSize: "24px 24px" }} />
      <div className="relative" style={{ width: studio.canvasPreset.width * displayScale, height: studio.canvasPreset.height * displayScale, overflow: "clip" }}>
        <div className="shadow-panel rounded-lg ring-1 ring-border absolute top-0 left-0" style={{ width: studio.canvasPreset.width, height: studio.canvasPreset.height, transform: `scale(${displayScale})`, transformOrigin: "top left", overflow: "clip" }}>
          <canvas ref={canvasElRef} />
        </div>
      </div>
    </div>
  );
}