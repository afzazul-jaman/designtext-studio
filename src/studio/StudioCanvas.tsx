import { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { useStudio } from "./store";
import { applyBackground } from "./canvasRenderer";
import { ensureFontReady } from "./fontLoader";

// Module-level reference so other panels (e.g. color picker) can apply styles
// to the currently-edited text selection without prop-drilling the canvas.
let activeFabricCanvas: fabric.Canvas | null = null;
export function getActiveFabricCanvas(): fabric.Canvas | null {
  return activeFabricCanvas;
}

/**
 * If a Textbox is currently in editing mode and has a character selection,
 * apply the given style patch to that range and persist it back into the layer.
 * Returns true if applied, false if no active editing/selection.
 */
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
      const obj = e.target as fabric.Object & { data?: { layerId?: string } };
      if (!obj?.data?.layerId) return;
      const id = obj.data.layerId;
      const tb = obj as fabric.Textbox;
      studioRef.current.updateLayer(id, {
        left: tb.left ?? 0,
        top: tb.top ?? 0,
        width: tb.width ?? 100,
        fontSize: Math.round((tb.fontSize ?? 16) * (tb.scaleX ?? 1)),
        styles: tb.styles ? JSON.parse(JSON.stringify(tb.styles)) : undefined,
      });
      tb.set({ scaleX: 1, scaleY: 1 });
      c.renderAll();
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
      const obj = e.selected?.[0] as (fabric.Object & { data?: { layerId?: string } }) | undefined;
      if (obj?.data?.layerId) studioRef.current.setActiveLayer(obj.data.layerId);
    });
    c.on("selection:updated", (e) => {
      const obj = e.selected?.[0] as (fabric.Object & { data?: { layerId?: string } }) | undefined;
      if (obj?.data?.layerId) studioRef.current.setActiveLayer(obj.data.layerId);
    });
    c.on("selection:cleared", () => studioRef.current.setActiveLayer(null));
    c.on("mouse:dblclick", (e) => {
      const target = e.target as fabric.Textbox | undefined;
      const layerId = (target as fabric.Object & { data?: { layerId?: string } })?.data?.layerId;
      if (!target || !layerId || !(target instanceof fabric.Textbox)) return;
      studioRef.current.setActiveLayer(layerId);
      target.enterEditing();
      target.hiddenTextarea?.focus();
    });

    return () => {
      activeFabricCanvas = null;
      c.dispose();
      fabricRef.current = null;
    };
  }, []);

  // Resize canvas to preset and fit wrapper
  useEffect(() => {
    const c = fabricRef.current;
    const wrapper = wrapperRef.current;
    if (!c || !wrapper) return;
    c.setWidth(studio.canvasPreset.width);
    c.setHeight(studio.canvasPreset.height);

    const resize = () => {
      const padding = 40;
      const aw = wrapper.clientWidth - padding;
      const ah = wrapper.clientHeight - padding;
      const scale = Math.min(aw / studio.canvasPreset.width, ah / studio.canvasPreset.height, 1);
      setDisplayScale(scale);
      const el = c.getElement().parentElement?.parentElement as HTMLElement | null;
      if (el) {
        el.style.transform = `scale(${scale})`;
        el.style.transformOrigin = "top left";
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [studio.canvasPreset]);

  // Re-render background when image/overlay/bg changes
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    let cancelled = false;
    (async () => {
      const activeImage = studio.images.find((i) => i.id === studio.activeImageId);
      // Remove existing bg/overlay rects (objects without layerId)
      const objs = c.getObjects();
      objs.forEach((o) => {
        const data = (o as fabric.Object & { data?: { layerId?: string } }).data;
        if (!data?.layerId) c.remove(o);
      });
      c.backgroundColor = studio.bgColor;
      await applyBackground(c, {
        width: c.getWidth(),
        height: c.getHeight(),
        bgMode: studio.bgMode,
        bgColor: studio.bgColor,
        gradientFrom: studio.gradientFrom,
        gradientTo: studio.gradientTo,
        backgroundImageUrl: activeImage?.dataUrl ?? null,
        overlay: studio.overlay,
        layers: [],
      });
      if (cancelled) return;
      // Re-add overlay rect
      if (studio.overlay !== "none") {
        const w = c.getWidth();
        const h = c.getHeight();
        let overlayObj: fabric.Object | null = null;
        if (studio.overlay === "dark") {
          overlayObj = new fabric.Rect({
            left: 0, top: 0, width: w, height: h,
            fill: new fabric.Gradient({
              type: "linear",
              coords: { x1: 0, y1: 0, x2: 0, y2: h },
              colorStops: [
                { offset: 0, color: "rgba(0,0,0,0.1)" },
                { offset: 1, color: "rgba(0,0,0,0.75)" },
              ],
            }),
            selectable: false, evented: false,
          });
        } else if (studio.overlay === "light") {
          overlayObj = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: "rgba(255,255,255,0.25)", selectable: false, evented: false });
        } else if (studio.overlay === "vignette") {
          overlayObj = new fabric.Rect({
            left: 0, top: 0, width: w, height: h,
            fill: new fabric.Gradient({
              type: "radial",
              coords: { x1: w/2, y1: h/2, r1: Math.min(w,h)*0.3, x2: w/2, y2: h/2, r2: Math.max(w,h)*0.7 },
              colorStops: [
                { offset: 0, color: "rgba(0,0,0,0)" },
                { offset: 1, color: "rgba(0,0,0,0.7)" },
              ],
            }),
            selectable: false, evented: false,
          });
        }
        if (overlayObj) c.add(overlayObj);
      }
      const textObjs = c.getObjects().filter((o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId);
      const bgObjs = c.getObjects().filter((o) => !(o as fabric.Object & { data?: { layerId?: string } }).data?.layerId);
      bgObjs.forEach((obj) => c.sendObjectToBack(obj));
      textObjs.forEach((obj) => c.bringObjectToFront(obj));
      c.renderAll();
    })();
    return () => { cancelled = true; };
  }, [studio.images, studio.activeImageId, studio.overlay, studio.bgMode, studio.bgColor, studio.gradientFrom, studio.gradientTo]);

  // Sync layers
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    const existing = new Map<string, fabric.Textbox>();
    c.getObjects().forEach((o) => {
      const data = (o as fabric.Object & { data?: { layerId?: string } }).data;
      if (data?.layerId) existing.set(data.layerId, o as fabric.Textbox);
    });

    // Remove deleted
    const layerIds = new Set(studio.layers.map((l) => l.id));
    existing.forEach((obj, id) => {
      if (!layerIds.has(id)) c.remove(obj);
    });

    // Add or update
    (async () => {
      for (const layer of studio.layers) {
        await ensureFontReady(layer.fontFamily);
        let tb = existing.get(layer.id);
        const isNew = !tb;
        if (!tb) {
          tb = new fabric.Textbox(layer.text, {
            left: layer.left,
            top: layer.top,
            width: layer.width,
            originX: "center",
            originY: "center",
          });
          tb.set("data", { layerId: layer.id });
          c.add(tb);
        }
        const isEditing = (tb as fabric.Textbox & { isEditing?: boolean }).isEditing;
        // Only overwrite text if not currently being edited (preserves caret/selection)
        if (!isEditing && tb.text !== layer.text) {
          tb.set({ text: layer.text });
        }
        tb.set({
          fontFamily: layer.fontFamily,
          fontSize: layer.fontSize,
          fill: layer.fill,
          fontWeight: layer.fontWeight,
          fontStyle: layer.fontStyle,
          textAlign: layer.textAlign,
          opacity: layer.opacity,
          lineHeight: layer.lineHeight,
          charSpacing: layer.charSpacing,
          left: layer.left,
          top: layer.top,
          width: layer.width,
          shadow: layer.effects.glow
            ? new fabric.Shadow({ color: layer.fill, blur: 30, offsetX: 0, offsetY: 0 })
            : layer.effects.shadow
            ? new fabric.Shadow({ color: "rgba(0,0,0,0.55)", blur: 12, offsetX: 0, offsetY: 4 })
            : null,
          stroke: layer.effects.stroke ? layer.strokeColor : undefined,
          strokeWidth: layer.effects.stroke ? layer.strokeWidth : 0,
          paintFirst: "stroke",
        });
        // Apply per-character styles
        if (isNew || !isEditing) {
          tb.styles = layer.styles ? JSON.parse(JSON.stringify(layer.styles)) : {};
        }
        tb.setCoords();
      }
      c.renderAll();
    })();
  }, [studio.layers]);

  // Sync active selection
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    if (!studio.activeLayerId) {
      c.discardActiveObject();
      c.renderAll();
      return;
    }
    const obj = c.getObjects().find((o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId === studio.activeLayerId);
    if (obj && c.getActiveObject() !== obj) {
      c.setActiveObject(obj);
      c.renderAll();
    }
  }, [studio.activeLayerId]);

  // Select-all trigger
  useEffect(() => {
    if (studio.selectAllNonce === 0) return;
    const c = fabricRef.current;
    if (!c) return;
    const textObjs = c.getObjects().filter(
      (o) => (o as fabric.Object & { data?: { layerId?: string } }).data?.layerId
    );
    if (textObjs.length === 0) return;
    c.discardActiveObject();
    if (textObjs.length === 1) {
      c.setActiveObject(textObjs[0]);
    } else {
      const sel = new fabric.ActiveSelection(textObjs, { canvas: c });
      c.setActiveObject(sel);
    }
    c.requestRenderAll();
  }, [studio.selectAllNonce]);

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo, Ctrl+A select-all
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (isEditable) return;
      const meta = e.ctrlKey || e.metaKey;
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
    <div ref={wrapperRef} className="flex-1 flex items-center justify-center overflow-hidden bg-background relative">
      {/* checkerboard subtle */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(45deg, oklch(0.2 0.02 280) 25%, transparent 25%), linear-gradient(-45deg, oklch(0.2 0.02 280) 25%, transparent 25%)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="relative" style={{ width: studio.canvasPreset.width * displayScale, height: studio.canvasPreset.height * displayScale }}>
        <div className="shadow-panel rounded-lg overflow-hidden ring-1 ring-border" style={{ width: studio.canvasPreset.width, height: studio.canvasPreset.height }}>
          <canvas ref={canvasElRef} />
        </div>
      </div>
    </div>
  );
}
