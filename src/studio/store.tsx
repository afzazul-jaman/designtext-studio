import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo, useRef } from "react";
import {
  TextLayer,
  SvgElement,
  UploadedImage,
  CSVData,
  CanvasPreset,
  CANVAS_PRESETS,
  BackgroundOverlay,
  GeneratedPage,
  PageSnapshot,
} from "./types";

export type SavedTemplate = {
  id: string;
  name: string;
  createdAt: number;
  layers: Omit<TextLayer, "id">[];
};

const TEMPLATE_STORAGE_KEY = "designtext.savedTemplates.v1";
const HISTORY_LIMIT = 50;

type StudioState = {
  images: UploadedImage[];
  activeImageId: string | null;
  overlay: BackgroundOverlay;
  bgColor: string;
  bgMode: "image" | "color" | "gradient";
  gradientFrom: string;
  gradientTo: string;
  layers: TextLayer[];
  activeLayerId: string | null;
  // ★ NEW: SVG elements
  svgElements: SvgElement[];
  activeSvgId: string | null;

  csv: CSVData | null;
  enabledRows: Set<number>;
  fieldMapping: Record<string, string>;
  canvasPreset: CanvasPreset;
  generated: GeneratedPage[];
  activePageId: string | null;
};

type StudioContextValue = StudioState & {
  addImages: (files: File[]) => Promise<void>;
  removeImage: (id: string) => void;
  setActiveImage: (id: string | null) => void;
  cycleImage: (dir: 1 | -1) => void;
  setOverlay: (o: BackgroundOverlay) => void;
  setBgColor: (c: string) => void;
  setBgMode: (m: "image" | "color" | "gradient") => void;
  setGradient: (from: string, to: string) => void;

  addLayer: (partial?: Partial<TextLayer>) => string;
  updateLayer: (id: string, updates: Partial<TextLayer>) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  applyTemplate: (layers: Omit<TextLayer, "id">[]) => void;

  // ★ NEW: SVG element CRUD
  addSvgElement: (svgContent: string, name: string) => string;
  updateSvgElement: (id: string, updates: Partial<SvgElement>) => void;
  removeSvgElement: (id: string) => void;
  setActiveSvgId: (id: string | null) => void;
  duplicateSvgElement: (id: string) => void;

  setCSV: (csv: CSVData | null) => void;
  toggleRow: (idx: number) => void;
  toggleAllRows: (enabled: boolean) => void;
  setMapping: (placeholder: string, column: string) => void;

  setCanvasPreset: (p: CanvasPreset) => void;
  setCustomSize: (w: number, h: number) => void;

  setGenerated: (pages: GeneratedPage[]) => void;
  addGeneratedPage: (page: GeneratedPage) => void;
  removeGeneratedPage: (id: string) => void;
  duplicateGeneratedPage: (id: string) => void;
  updateGeneratedPage: (id: string, updates: Partial<GeneratedPage>) => void;
  setActivePage: (id: string | null) => void;
  loadPageIntoEditor: (id: string) => void;
  getEditorSnapshot: () => PageSnapshot;
  insertTextIntoActiveLayer: (insert: string) => void;
  clearGenerated: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  savedTemplates: SavedTemplate[];
  saveCurrentAsTemplate: (name: string) => void;
  deleteSavedTemplate: (id: string) => void;
  applySavedTemplate: (id: string) => void;

  selectAllNonce: number;
  selectAllLayers: () => void;

  previewRow: Record<string, string> | null;
};

const StudioContext = createContext<StudioContextValue | null>(null);

let layerCounter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now()}_${++layerCounter}`;

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Parse SVG string to get intrinsic width/height */
function getSvgDimensions(svgContent: string): { width: number; height: number } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, "image/svg+xml");
    const svgEl = doc.querySelector("svg");
    if (!svgEl) return { width: 200, height: 200 };
    const viewBox = svgEl.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
        return { width: parts[2], height: parts[3] };
      }
    }
    const w = parseFloat(svgEl.getAttribute("width") || "0");
    const h = parseFloat(svgEl.getAttribute("height") || "0");
    if (w > 0 && h > 0) return { width: w, height: h };
    return { width: 200, height: 200 };
  } catch {
    return { width: 200, height: 200 };
  }
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<BackgroundOverlay>("none");
  const [bgColor, setBgColor] = useState("#1a1a2e");
  const [bgMode, setBgMode] = useState<"image" | "color" | "gradient">("image");
  const [gradientFrom, setGradientFrom] = useState("#7c3aed");
  const [gradientTo, setGradientTo] = useState("#22d3ee");

  const [layers, setLayers] = useState<TextLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  // ★ NEW: SVG elements on canvas
  const [svgElements, setSvgElements] = useState<SvgElement[]>([]);
  const [activeSvgId, setActiveSvgIdState] = useState<string | null>(null);

  const [csv, setCsvState] = useState<CSVData | null>(null);
  const [enabledRows, setEnabledRows] = useState<Set<number>>(new Set());
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [canvasPreset, setCanvasPresetState] = useState<CanvasPreset>(CANVAS_PRESETS[0]);
  const [generated, setGenerated] = useState<GeneratedPage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // ---- History ----
  const historyRef = useRef<TextLayer[][]>([[]]);
  const historyIdxRef = useRef<number>(0);
  const skipHistoryRef = useRef<boolean>(false);
  const [, forceHistoryTick] = useState(0);

  useEffect(() => {
    if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
    const head = historyRef.current[historyIdxRef.current];
    if (JSON.stringify(head) === JSON.stringify(layers)) return;
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(layers.map((l) => ({ ...l, effects: { ...l.effects } })));
    if (historyRef.current.length > HISTORY_LIMIT) { historyRef.current.shift(); }
    else { historyIdxRef.current += 1; }
    forceHistoryTick((t) => t + 1);
  }, [layers]);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    skipHistoryRef.current = true;
    setLayers(historyRef.current[historyIdxRef.current].map((l) => ({ ...l, effects: { ...l.effects } })));
    forceHistoryTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    skipHistoryRef.current = true;
    setLayers(historyRef.current[historyIdxRef.current].map((l) => ({ ...l, effects: { ...l.effects } })));
    forceHistoryTick((t) => t + 1);
  }, []);

  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;

  // ---- Saved templates ----
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>(() => {
    try { const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });

  const persistTemplates = useCallback((next: SavedTemplate[]) => {
    setSavedTemplates(next);
    try { localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const saveCurrentAsTemplate = useCallback((name: string) => {
    const tpl: SavedTemplate = {
      id: newId("tpl"),
      name: name.trim() || `Template ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      layers: layers.map(({ id: _, ...rest }) => ({ ...rest, effects: { ...rest.effects } })),
    };
    persistTemplates([tpl, ...savedTemplates]);
  }, [layers, savedTemplates, persistTemplates]);

  const deleteSavedTemplate = useCallback((id: string) => {
    persistTemplates(savedTemplates.filter((t) => t.id !== id));
  }, [savedTemplates, persistTemplates]);

  const applySavedTemplate = useCallback((id: string) => {
    const tpl = savedTemplates.find((t) => t.id === id);
    if (!tpl) return;
    const withIds = tpl.layers.map((l) => ({ ...l, id: newId("layer"), effects: { ...l.effects } }));
    setLayers(withIds);
    setActiveLayerId(withIds[0]?.id ?? null);
  }, [savedTemplates]);

  // ---- Multi-select ----
  const [selectAllNonce, setSelectAllNonce] = useState(0);
  const selectAllLayers = useCallback(() => setSelectAllNonce((n) => n + 1), []);

  // ---- Preview row ----
  const previewRow = useMemo<Record<string, string> | null>(() => {
    if (!csv || enabledRows.size === 0) return null;
    const firstIdx = Array.from(enabledRows).sort((a, b) => a - b)[0];
    return csv.rows[firstIdx] ?? null;
  }, [csv, enabledRows]);

  // ---- Images ----
  const addImages = useCallback(async (files: File[]) => {
    const newImgs: UploadedImage[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 15 * 1024 * 1024) continue;
      const dataUrl = await readFileAsDataURL(file);
      newImgs.push({ id: newId("img"), name: file.name, dataUrl });
    }
    setImages((prev) => {
      const merged = [...prev, ...newImgs];
      if (!activeImageId && merged.length > 0) { setActiveImageId(merged[0].id); setBgMode("image"); }
      return merged;
    });
  }, [activeImageId]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const filtered = prev.filter((i) => i.id !== id);
      if (activeImageId === id) setActiveImageId(filtered[0]?.id ?? null);
      return filtered;
    });
  }, [activeImageId]);

  const cycleImage = useCallback((dir: 1 | -1) => {
    setImages((prev) => {
      if (prev.length === 0) return prev;
      const idx = prev.findIndex((i) => i.id === activeImageId);
      const next = (idx + dir + prev.length) % prev.length;
      setActiveImageId(prev[next].id);
      return prev;
    });
  }, [activeImageId]);

  // ---- Text layers ----
  const addLayer = useCallback((partial?: Partial<TextLayer>): string => {
    const id = newId("layer");
    const layer: TextLayer = {
      id, text: "Your text here", fontFamily: "Inter", fontSize: 64, fill: "#ffffff",
      fontWeight: "bold", fontStyle: "normal", textAlign: "center",
      left: 540, top: 540, width: 800, opacity: 1, lineHeight: 1.2, charSpacing: 0,
      effects: { shadow: true, stroke: false, glow: false, gradient: false },
      strokeColor: "#000000", strokeWidth: 2, ...partial,
    };
    setLayers((prev) => [...prev, layer]);
    setActiveLayerId(id);
    setActiveSvgIdState(null);
    return id;
  }, []);

  const updateLayer = useCallback((id: string, updates: Partial<TextLayer>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates, effects: { ...l.effects, ...(updates.effects ?? {}) } } : l)));
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setActiveLayerId((cur) => (cur === id ? null : cur));
  }, []);

  const applyTemplate = useCallback((tplLayers: Omit<TextLayer, "id">[]) => {
    const withIds = tplLayers.map((l) => ({ ...l, id: newId("layer") }));
    setLayers(withIds);
    setActiveLayerId(withIds[0]?.id ?? null);
  }, []);

  // ★ NEW: SVG element CRUD
  const addSvgElement = useCallback((svgContent: string, name: string): string => {
    const id = newId("svg");
    const dims = getSvgDimensions(svgContent);
    // Scale down to fit nicely on canvas (max 300px)
    const maxDim = Math.max(dims.width, dims.height);
    const scale = maxDim > 300 ? 300 / maxDim : 1;
    const el: SvgElement = {
      id, name, svgContent,
      left: 540, top: 540,
      width: Math.round(dims.width * scale),
      height: Math.round(dims.height * scale),
      angle: 0, opacity: 1, fill: null,
    };
    setSvgElements((prev) => [...prev, el]);
    setActiveSvgIdState(id);
    setActiveLayerId(null);
    return id;
  }, []);

  const updateSvgElement = useCallback((id: string, updates: Partial<SvgElement>) => {
    setSvgElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  }, []);

  const removeSvgElement = useCallback((id: string) => {
    setSvgElements((prev) => prev.filter((e) => e.id !== id));
    setActiveSvgIdState((cur) => (cur === id ? null : cur));
  }, []);

  const setActiveSvgId = useCallback((id: string | null) => {
    setActiveSvgIdState(id);
    if (id) setActiveLayerId(null);
  }, []);

  const duplicateSvgElement = useCallback((id: string) => {
    setSvgElements((prev) => {
      const el = prev.find((e) => e.id === id);
      if (!el) return prev;
      const copy: SvgElement = { ...el, id: newId("svg"), left: el.left + 30, top: el.top + 30 };
      return [...prev, copy];
    });
  }, []);

  // When selecting a text layer, clear SVG selection
  const setActiveLayer = useCallback((id: string | null) => {
    setActiveLayerId(id);
    if (id) setActiveSvgIdState(null);
  }, []);

  // ---- CSV ----
  const setCSV = useCallback((c: CSVData | null) => {
    setCsvState(c);
    if (c) {
      setEnabledRows(new Set(c.rows.map((_, i) => i)));
      const auto: Record<string, string> = {};
      c.headers.forEach((h) => { auto[h] = h; });
      setFieldMapping(auto);
    } else { setEnabledRows(new Set()); setFieldMapping({}); }
  }, []);

  const toggleRow = useCallback((idx: number) => {
    setEnabledRows((prev) => { const next = new Set(prev); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; });
  }, []);

  const toggleAllRows = useCallback((enabled: boolean) => {
    setEnabledRows(() => !csv ? new Set() : enabled ? new Set(csv.rows.map((_, i) => i)) : new Set());
  }, [csv]);

  const setMapping = useCallback((placeholder: string, column: string) => {
    setFieldMapping((prev) => ({ ...prev, [placeholder]: column }));
  }, []);

  // ---- Canvas preset ----
  const setCanvasPreset = useCallback((p: CanvasPreset) => setCanvasPresetState(p), []);
  const setCustomSize = useCallback((w: number, h: number) => setCanvasPresetState({ name: "Custom", width: w, height: h }), []);

  // ---- Generated pages ----
  const addGeneratedPage = useCallback((page: GeneratedPage) => setGenerated((prev) => [...prev, page]), []);

  const removeGeneratedPage = useCallback((id: string) => {
    setGenerated((prev) => prev.filter((p) => p.id !== id));
    setActivePageId((cur) => (cur === id ? null : cur));
  }, []);

  const duplicateGeneratedPage = useCallback((id: string) => {
    setGenerated((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx], id: newId("page") });
      return next;
    });
  }, []);

  const updateGeneratedPage = useCallback((id: string, updates: Partial<GeneratedPage>) => {
    setGenerated((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  // ★ UPDATED: snapshot now includes svgElements
  const getEditorSnapshot = useCallback((): PageSnapshot => ({
    layers: layers.map((l) => ({ ...l, effects: { ...l.effects } })),
    svgElements: svgElements.map((e) => ({ ...e })),
    imageId: activeImageId,
    bgMode, bgColor, gradientFrom, gradientTo, overlay,
  }), [layers, svgElements, activeImageId, bgMode, bgColor, gradientFrom, gradientTo, overlay]);

  // ★ UPDATED: loadPageIntoEditor now restores svgElements
  const loadPageIntoEditor = useCallback((id: string) => {
    setGenerated((prev) => {
      const page = prev.find((p) => p.id === id);
      if (!page) return prev;
      const s = page.snapshot;
      setLayers(s.layers.map((l) => ({ ...l, effects: { ...l.effects } })));
      setSvgElements((s.svgElements ?? []).map((e) => ({ ...e })));
      setActiveImageId(s.imageId);
      setBgMode(s.bgMode);
      setBgColor(s.bgColor);
      setGradientFrom(s.gradientFrom);
      setGradientTo(s.gradientTo);
      setOverlay(s.overlay);
      setActiveLayerId(s.layers[0]?.id ?? null);
      setActiveSvgIdState(null);
      return prev;
    });
    setActivePageId(id);
  }, []);

  const insertTextIntoActiveLayer = useCallback((insert: string) => {
    let resolvedId: string | null = null;
    setActiveLayerId((curId) => {
      if (curId) {
        resolvedId = curId;
        setLayers((prev) => prev.map((l) => (l.id === curId ? { ...l, text: insert } : l)));
        return curId;
      }
      setLayers((prev) => {
        if (prev.length > 0) {
          resolvedId = prev[0].id;
          return prev.map((l, i) => (i === 0 ? { ...l, text: insert } : l));
        }
        resolvedId = newId("layer");
        const layer: TextLayer = {
          id: resolvedId!, text: insert, fontFamily: "Inter", fontSize: 64, fill: "#ffffff",
          fontWeight: "bold", fontStyle: "normal", textAlign: "center",
          left: 540, top: 540, width: 800, opacity: 1, lineHeight: 1.2, charSpacing: 0,
          effects: { shadow: true, stroke: false, glow: false, gradient: false },
          strokeColor: "#000000", strokeWidth: 2,
        };
        return [...prev, layer];
      });
      return resolvedId;
    });
  }, []);

  const clearGenerated = useCallback(() => { setGenerated([]); setActivePageId(null); }, []);

  const value = useMemo<StudioContextValue>(() => ({
    images, activeImageId, overlay, bgColor, bgMode, gradientFrom, gradientTo,
    layers, activeLayerId, svgElements, activeSvgId,
    csv, enabledRows, fieldMapping, canvasPreset,
    generated, activePageId, previewRow,
    addImages, removeImage, setActiveImage: setActiveImageId, cycleImage,
    setOverlay, setBgColor, setBgMode,
    setGradient: (f, t) => { setGradientFrom(f); setGradientTo(t); },
    addLayer, updateLayer, removeLayer, setActiveLayer, applyTemplate,
    addSvgElement, updateSvgElement, removeSvgElement, setActiveSvgId, duplicateSvgElement,
    setCSV, toggleRow, toggleAllRows, setMapping,
    setCanvasPreset, setCustomSize,
    setGenerated, addGeneratedPage, removeGeneratedPage, duplicateGeneratedPage,
    updateGeneratedPage, loadPageIntoEditor, getEditorSnapshot, insertTextIntoActiveLayer,
    setActivePage: setActivePageId, clearGenerated,
    undo, redo, canUndo, canRedo,
    savedTemplates, saveCurrentAsTemplate, deleteSavedTemplate, applySavedTemplate,
    selectAllNonce, selectAllLayers,
  }), [
    images, activeImageId, overlay, bgColor, bgMode, gradientFrom, gradientTo,
    layers, activeLayerId, svgElements, activeSvgId,
    csv, enabledRows, fieldMapping, canvasPreset,
    generated, activePageId, previewRow,
    addImages, removeImage, cycleImage, addLayer, updateLayer, removeLayer, setActiveLayer,
    applyTemplate, addSvgElement, updateSvgElement, removeSvgElement, setActiveSvgId, duplicateSvgElement,
    setCSV, toggleRow, toggleAllRows, setMapping,
    setCanvasPreset, setCustomSize, addGeneratedPage, removeGeneratedPage,
    duplicateGeneratedPage, updateGeneratedPage, loadPageIntoEditor,
    getEditorSnapshot, insertTextIntoActiveLayer, clearGenerated,
    undo, redo, canUndo, canRedo,
    savedTemplates, saveCurrentAsTemplate, deleteSavedTemplate, applySavedTemplate,
    selectAllNonce, selectAllLayers,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside StudioProvider");
  return ctx;
}