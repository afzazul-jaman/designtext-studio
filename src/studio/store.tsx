import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo, useRef } from "react";
import {
  TextLayer, SvgElement, SvgLibraryItem, UploadedImage, CSVData,
  CanvasPreset, CANVAS_PRESETS, BackgroundOverlay, GeneratedPage, PageSnapshot,
} from "./types";

export type SavedTemplate = { id: string; name: string; createdAt: number; layers: Omit<TextLayer, "id">[]; };

const TEMPLATE_STORAGE_KEY = "designtext.savedTemplates.v1";
const SVG_LIBRARY_KEY = "designtext.svgLibrary.v1";
const HISTORY_LIMIT = 30;

type HistoryEntry = { layers: TextLayer[]; svgElements: SvgElement[]; };

type StudioContextValue = {
  images: UploadedImage[]; activeImageId: string | null;
  overlay: BackgroundOverlay; bgColor: string; bgMode: "image" | "color" | "gradient";
  gradientFrom: string; gradientTo: string;
  layers: TextLayer[]; activeLayerId: string | null;
  svgElements: SvgElement[]; activeSvgId: string | null;
  svgLibrary: SvgLibraryItem[];
  csv: CSVData | null; enabledRows: Set<number>; fieldMapping: Record<string, string>;
  canvasPreset: CanvasPreset; generated: GeneratedPage[]; activePageId: string | null;
  previewRow: Record<string, string> | null;
  // ★ NEW: flag — are we editing a generated page or the template?
  isEditingPage: boolean;
  addImages: (files: File[]) => Promise<void>; removeImage: (id: string) => void;
  setActiveImage: (id: string | null) => void; cycleImage: (dir: 1 | -1) => void;
  setOverlay: (o: BackgroundOverlay) => void; setBgColor: (c: string) => void;
  setBgMode: (m: "image" | "color" | "gradient") => void; setGradient: (from: string, to: string) => void;
  addLayer: (partial?: Partial<TextLayer>) => string; updateLayer: (id: string, updates: Partial<TextLayer>) => void;
  removeLayer: (id: string) => void; setActiveLayer: (id: string | null) => void;
  applyTemplate: (layers: Omit<TextLayer, "id">[]) => void;
  addSvgElement: (svgContent: string, name: string) => string;
  addSvgFromLibrary: (libraryId: string) => void;
  updateSvgElement: (id: string, updates: Partial<SvgElement>) => void;
  removeSvgElement: (id: string) => void; setActiveSvgId: (id: string | null) => void;
  duplicateSvgElement: (id: string) => void;
  addToSvgLibrary: (svgContent: string, name: string) => string;
  removeFromSvgLibrary: (id: string) => void;
  renameSvgLibraryItem: (id: string, name: string) => void;
  setCSV: (csv: CSVData | null) => void; toggleRow: (idx: number) => void;
  toggleAllRows: (enabled: boolean) => void; setMapping: (placeholder: string, column: string) => void;
  setCanvasPreset: (p: CanvasPreset) => void; setCustomSize: (w: number, h: number) => void;
  setGenerated: (pages: GeneratedPage[]) => void; addGeneratedPage: (page: GeneratedPage) => void;
  removeGeneratedPage: (id: string) => void; duplicateGeneratedPage: (id: string) => void;
  updateGeneratedPage: (id: string, updates: Partial<GeneratedPage>) => void;
  setActivePage: (id: string | null) => void; loadPageIntoEditor: (id: string) => void;
  // ★ NEW: go back to template editing mode
  returnToTemplate: () => void;
  getEditorSnapshot: () => PageSnapshot; insertTextIntoActiveLayer: (insert: string) => void;
  clearGenerated: () => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  savedTemplates: SavedTemplate[]; saveCurrentAsTemplate: (name: string) => void;
  deleteSavedTemplate: (id: string) => void; applySavedTemplate: (id: string) => void;
  selectAllNonce: number; selectAllLayers: () => void;
};

const StudioContext = createContext<StudioContextValue | null>(null);

let layerCounter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now()}_${++layerCounter}`;

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file);
  });
}

function getSvgDimensions(svgContent: string): { width: number; height: number } {
  try {
    const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
    const svgEl = doc.querySelector("svg");
    if (!svgEl) return { width: 200, height: 200 };
    const vb = svgEl.getAttribute("viewBox");
    if (vb) { const p = vb.trim().split(/[\s,]+/).map(Number); if (p.length >= 4 && p[2] > 0 && p[3] > 0) return { width: p[2], height: p[3] }; }
    const w = parseFloat(svgEl.getAttribute("width") || "0");
    const h = parseFloat(svgEl.getAttribute("height") || "0");
    if (w > 0 && h > 0) return { width: w, height: h };
    return { width: 200, height: 200 };
  } catch { return { width: 200, height: 200 }; }
}

function cleanSvg(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/^\xEF\xBB\xBF/, "").trim();
}

function cloneLayers(layers: TextLayer[]): TextLayer[] {
  return layers.map((l) => ({ ...l, effects: { ...l.effects }, shadowSettings: l.shadowSettings ? { ...l.shadowSettings } : undefined }));
}

// ★ Store template state so we can restore it after page editing
type TemplateBackup = {
  layers: TextLayer[];
  svgElements: SvgElement[];
  imageId: string | null;
  bgMode: "image" | "color" | "gradient";
  bgColor: string;
  gradientFrom: string;
  gradientTo: string;
  overlay: BackgroundOverlay;
};

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
  const [svgElements, setSvgElements] = useState<SvgElement[]>([]);
  const [activeSvgIdState, setActiveSvgIdState] = useState<string | null>(null);
  const [csv, setCsvState] = useState<CSVData | null>(null);
  const [enabledRows, setEnabledRows] = useState<Set<number>>(new Set());
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [canvasPreset, setCanvasPresetState] = useState<CanvasPreset>(CANVAS_PRESETS[0]);
  const [generated, setGenerated] = useState<GeneratedPage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // ★ NEW: backup of template state before switching to page editing
  const templateBackupRef = useRef<TemplateBackup | null>(null);

  // Is user editing a specific generated page?
  const isEditingPage = activePageId !== null;

  // SVG Library
  const [svgLibrary, setSvgLibrary] = useState<SvgLibraryItem[]>(() => {
    try { const raw = localStorage.getItem(SVG_LIBRARY_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  const persistSvgLibrary = useCallback((next: SvgLibraryItem[]) => { setSvgLibrary(next); try { localStorage.setItem(SVG_LIBRARY_KEY, JSON.stringify(next)); } catch {} }, []);
  const addToSvgLibrary = useCallback((svgContent: string, name: string): string => { const id = newId("svglib"); persistSvgLibrary([{ id, name, svgContent: cleanSvg(svgContent), addedAt: Date.now() }, ...svgLibrary]); return id; }, [svgLibrary, persistSvgLibrary]);
  const removeFromSvgLibrary = useCallback((id: string) => persistSvgLibrary(svgLibrary.filter((i) => i.id !== id)), [svgLibrary, persistSvgLibrary]);
  const renameSvgLibraryItem = useCallback((id: string, name: string) => persistSvgLibrary(svgLibrary.map((i) => (i.id === id ? { ...i, name: name.trim() || i.name } : i))), [svgLibrary, persistSvgLibrary]);

  // History (debounced)
  const historyRef = useRef<HistoryEntry[]>([{ layers: [], svgElements: [] }]);
  const historyIdxRef = useRef(0);
  const skipHistoryRef = useRef(false);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceHistoryTick] = useState(0);

  useEffect(() => {
    if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      const entry: HistoryEntry = { layers: cloneLayers(layers), svgElements: svgElements.map((e) => ({ ...e })) };
      const head = historyRef.current[historyIdxRef.current];
      const headKey = head.layers.map((l) => `${l.id}:${l.text}:${l.fontFamily}:${l.left}:${l.top}`).join("|") + "||" + head.svgElements.map((e) => `${e.id}:${e.left}:${e.top}:${e.fill}`).join("|");
      const entryKey = entry.layers.map((l) => `${l.id}:${l.text}:${l.fontFamily}:${l.left}:${l.top}`).join("|") + "||" + entry.svgElements.map((e) => `${e.id}:${e.left}:${e.top}:${e.fill}`).join("|");
      if (headKey === entryKey) return;
      historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
      historyRef.current.push(entry);
      if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
      else historyIdxRef.current += 1;
      forceHistoryTick((t) => t + 1);
    }, 300);
    return () => { if (historyTimerRef.current) clearTimeout(historyTimerRef.current); };
  }, [layers, svgElements]);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
    historyIdxRef.current -= 1; skipHistoryRef.current = true;
    const e = historyRef.current[historyIdxRef.current];
    setLayers(cloneLayers(e.layers)); setSvgElements(e.svgElements.map((x) => ({ ...x })));
    forceHistoryTick((t) => t + 1);
  }, []);
  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
    historyIdxRef.current += 1; skipHistoryRef.current = true;
    const e = historyRef.current[historyIdxRef.current];
    setLayers(cloneLayers(e.layers)); setSvgElements(e.svgElements.map((x) => ({ ...x })));
    forceHistoryTick((t) => t + 1);
  }, []);
  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;

  // Templates
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>(() => { try { const r = localStorage.getItem(TEMPLATE_STORAGE_KEY); return r ? JSON.parse(r) : []; } catch { return []; } });
  const persistTemplates = useCallback((n: SavedTemplate[]) => { setSavedTemplates(n); try { localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(n)); } catch {} }, []);
  const saveCurrentAsTemplate = useCallback((name: string) => { persistTemplates([{ id: newId("tpl"), name: name.trim() || `Template ${new Date().toLocaleString()}`, createdAt: Date.now(), layers: layers.map(({ id: _, ...r }) => ({ ...r, effects: { ...r.effects } })) }, ...savedTemplates]); }, [layers, savedTemplates, persistTemplates]);
  const deleteSavedTemplate = useCallback((id: string) => persistTemplates(savedTemplates.filter((t) => t.id !== id)), [savedTemplates, persistTemplates]);
  const applySavedTemplate = useCallback((id: string) => { const t = savedTemplates.find((x) => x.id === id); if (!t) return; const w = t.layers.map((l) => ({ ...l, id: newId("layer"), effects: { ...l.effects } })); setLayers(w); setActiveLayerId(w[0]?.id ?? null); }, [savedTemplates]);

  const [selectAllNonce, setSelectAllNonce] = useState(0);
  const selectAllLayers = useCallback(() => setSelectAllNonce((n) => n + 1), []);

  // ★ FIX: previewRow only available when NOT editing a specific page
  const previewRow = useMemo<Record<string, string> | null>(() => {
    if (activePageId) return null; // ★ Don't substitute when editing a generated page
    if (!csv || enabledRows.size === 0) return null;
    return csv.rows[Array.from(enabledRows).sort((a, b) => a - b)[0]] ?? null;
  }, [csv, enabledRows, activePageId]);

  // Images
  const addImages = useCallback(async (files: File[]) => {
    const ni: UploadedImage[] = [];
    for (const f of files) { if (!f.type.startsWith("image/") || f.size > 15e6) continue; const dataUrl = await readFileAsDataURL(f); ni.push({ id: newId("img"), name: f.name, dataUrl }); }
    if (ni.length === 0) return;
    setImages((p) => { const m = [...p, ...ni]; setActiveImageId((cur) => cur ?? m[0].id); setBgMode("image"); return m; });
  }, []);
  const removeImage = useCallback((id: string) => { setImages((p) => { const f = p.filter((i) => i.id !== id); if (activeImageId === id) setActiveImageId(f[0]?.id ?? null); return f; }); }, [activeImageId]);
  const cycleImage = useCallback((dir: 1 | -1) => { setImages((p) => { if (!p.length) return p; const i = p.findIndex((x) => x.id === activeImageId); setActiveImageId(p[(i + dir + p.length) % p.length].id); return p; }); }, [activeImageId]);

  // Layers
  const addLayer = useCallback((partial?: Partial<TextLayer>): string => {
    const id = newId("layer");
    setLayers((p) => [...p, { id, text: "Your text here", fontFamily: "Inter", fontSize: 64, fill: "#ffffff", fontWeight: "bold", fontStyle: "normal", textAlign: "center", left: 540, top: 540, width: 800, opacity: 1, lineHeight: 1.2, charSpacing: 0, effects: { shadow: true, stroke: false, glow: false, gradient: false }, strokeColor: "#000000", strokeWidth: 2, ...partial }]);
    setActiveLayerId(id); setActiveSvgIdState(null); return id;
  }, []);
  const updateLayer = useCallback((id: string, u: Partial<TextLayer>) => {
    setLayers((p) => p.map((l) => {
      if (l.id !== id) return l;
      const merged = { ...l, ...u };
      merged.effects = { ...(l.effects ?? { shadow: false, stroke: false, glow: false, gradient: false }), ...(u.effects ?? {}) };
      return merged;
    }));
  }, []);
  const removeLayer = useCallback((id: string) => { setLayers((p) => p.filter((l) => l.id !== id)); setActiveLayerId((c) => c === id ? null : c); }, []);
  const applyTemplate = useCallback((tl: Omit<TextLayer, "id">[]) => { const w = tl.map((l) => ({ ...l, id: newId("layer") })); setLayers(w); setActiveLayerId(w[0]?.id ?? null); }, []);

  // SVG on canvas
  const addSvgElement = useCallback((svgContent: string, name: string): string => {
    const id = newId("svg"); const cleaned = cleanSvg(svgContent);
    const dims = getSvgDimensions(cleaned); const maxDim = Math.max(dims.width, dims.height); const scale = maxDim > 300 ? 300 / maxDim : 1;
    setSvgElements((p) => [...p, { id, name, svgContent: cleaned, left: 540, top: 540, width: Math.round(dims.width * scale), height: Math.round(dims.height * scale), angle: 0, opacity: 1, fill: null }]);
    setActiveSvgIdState(id); setActiveLayerId(null); return id;
  }, []);
  const addSvgFromLibrary = useCallback((libraryId: string) => { const item = svgLibrary.find((i) => i.id === libraryId); if (item) addSvgElement(item.svgContent, item.name); }, [svgLibrary, addSvgElement]);
  const updateSvgElement = useCallback((id: string, u: Partial<SvgElement>) => { setSvgElements((p) => p.map((e) => (e.id === id ? { ...e, ...u } : e))); }, []);
  const removeSvgElement = useCallback((id: string) => { setSvgElements((p) => p.filter((e) => e.id !== id)); setActiveSvgIdState((c) => c === id ? null : c); }, []);
  const setActiveSvgId = useCallback((id: string | null) => { setActiveSvgIdState(id); if (id) setActiveLayerId(null); }, []);
  const duplicateSvgElement = useCallback((id: string) => { setSvgElements((p) => { const e = p.find((x) => x.id === id); if (!e) return p; return [...p, { ...e, id: newId("svg"), left: e.left + 30, top: e.top + 30 }]; }); }, []);
  const setActiveLayer = useCallback((id: string | null) => { setActiveLayerId(id); if (id) setActiveSvgIdState(null); }, []);

  // CSV — ★ FIX: CSV operations never touch layers (no disconnect)
  const setCSV = useCallback((c: CSVData | null) => {
    setCsvState(c);
    if (c) {
      setEnabledRows(new Set(c.rows.map((_, i) => i)));
      const a: Record<string, string> = {};
      c.headers.forEach((h) => { a[h] = h; });
      setFieldMapping(a);
    } else {
      setEnabledRows(new Set());
      setFieldMapping({});
    }
    // ★ FIX: Do NOT touch layers or activeLayerId here — that was causing CSV "disconnect"
  }, []);
  const toggleRow = useCallback((i: number) => { setEnabledRows((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; }); }, []);
  const toggleAllRows = useCallback((en: boolean) => { setEnabledRows(() => !csv ? new Set() : en ? new Set(csv.rows.map((_, i) => i)) : new Set()); }, [csv]);
  const setMapping = useCallback((p: string, c: string) => setFieldMapping((prev) => ({ ...prev, [p]: c })), []);

  const setCanvasPreset = useCallback((p: CanvasPreset) => setCanvasPresetState(p), []);
  const setCustomSize = useCallback((w: number, h: number) => setCanvasPresetState({ name: "Custom", width: w, height: h }), []);

  const addGeneratedPage = useCallback((p: GeneratedPage) => setGenerated((prev) => [...prev, p]), []);
  const removeGeneratedPage = useCallback((id: string) => { setGenerated((p) => p.filter((x) => x.id !== id)); setActivePageId((c) => c === id ? null : c); }, []);
  const duplicateGeneratedPage = useCallback((id: string) => { setGenerated((p) => { const i = p.findIndex((x) => x.id === id); if (i === -1) return p; const n = [...p]; n.splice(i + 1, 0, { ...p[i], id: newId("page") }); return n; }); }, []);
  const updateGeneratedPage = useCallback((id: string, u: Partial<GeneratedPage>) => setGenerated((p) => p.map((x) => (x.id === id ? { ...x, ...u } : x))), []);

  const getEditorSnapshot = useCallback((): PageSnapshot => ({
    layers: cloneLayers(layers), svgElements: svgElements.map((e) => ({ ...e })),
    imageId: activeImageId, bgMode, bgColor, gradientFrom, gradientTo, overlay,
  }), [layers, svgElements, activeImageId, bgMode, bgColor, gradientFrom, gradientTo, overlay]);

  // ★ FIX: loadPageIntoEditor — saves template backup first, then loads page
  const loadPageIntoEditor = useCallback((id: string) => {
    // Save template backup if we're not already editing a page
    if (!activePageId && !templateBackupRef.current) {
      templateBackupRef.current = {
        layers: cloneLayers(layers),
        svgElements: svgElements.map((e) => ({ ...e })),
        imageId: activeImageId, bgMode, bgColor, gradientFrom, gradientTo, overlay,
      };
    }

    const page = generated.find((p) => p.id === id);
    if (!page) return;
    const s = page.snapshot;
    setLayers(cloneLayers(s.layers));
    setSvgElements((s.svgElements ?? []).map((e) => ({ ...e })));
    setActiveImageId(s.imageId); setBgMode(s.bgMode); setBgColor(s.bgColor);
    setGradientFrom(s.gradientFrom); setGradientTo(s.gradientTo); setOverlay(s.overlay);
    setActiveLayerId(s.layers[0]?.id ?? null); setActiveSvgIdState(null);
    setActivePageId(id);
  }, [activePageId, layers, svgElements, activeImageId, bgMode, bgColor, gradientFrom, gradientTo, overlay, generated]);

  // ★ NEW: Return to template editing mode — restores backup
  const returnToTemplate = useCallback(() => {
    if (templateBackupRef.current) {
      const b = templateBackupRef.current;
      setLayers(cloneLayers(b.layers));
      setSvgElements(b.svgElements.map((e) => ({ ...e })));
      setActiveImageId(b.imageId); setBgMode(b.bgMode); setBgColor(b.bgColor);
      setGradientFrom(b.gradientFrom); setGradientTo(b.gradientTo); setOverlay(b.overlay);
      templateBackupRef.current = null;
    }
    setActivePageId(null);
    setActiveLayerId(null);
    setActiveSvgIdState(null);
  }, []);

  const insertTextIntoActiveLayer = useCallback((insert: string) => {
    let resolvedId: string | null = null;
    setActiveLayerId((curId) => {
      if (curId) { resolvedId = curId; setLayers((p) => p.map((l) => (l.id === curId ? { ...l, text: insert } : l))); return curId; }
      setLayers((p) => {
        if (p.length > 0) { resolvedId = p[0].id; return p.map((l, i) => (i === 0 ? { ...l, text: insert } : l)); }
        resolvedId = newId("layer");
        return [...p, { id: resolvedId!, text: insert, fontFamily: "Inter", fontSize: 64, fill: "#ffffff", fontWeight: "bold" as const, fontStyle: "normal" as const, textAlign: "center" as const, left: 540, top: 540, width: 800, opacity: 1, lineHeight: 1.2, charSpacing: 0, effects: { shadow: true, stroke: false, glow: false, gradient: false }, strokeColor: "#000000", strokeWidth: 2 }];
      });
      return resolvedId;
    });
  }, []);

  const clearGenerated = useCallback(() => { setGenerated([]); setActivePageId(null); templateBackupRef.current = null; }, []);

  const value = useMemo<StudioContextValue>(() => ({
    images, activeImageId, overlay, bgColor, bgMode, gradientFrom, gradientTo,
    layers, activeLayerId, svgElements, activeSvgId: activeSvgIdState, svgLibrary,
    csv, enabledRows, fieldMapping, canvasPreset, generated, activePageId, previewRow,
    isEditingPage,
    addImages, removeImage, setActiveImage: setActiveImageId, cycleImage,
    setOverlay, setBgColor, setBgMode, setGradient: (f, t) => { setGradientFrom(f); setGradientTo(t); },
    addLayer, updateLayer, removeLayer, setActiveLayer, applyTemplate,
    addSvgElement, addSvgFromLibrary, updateSvgElement, removeSvgElement, setActiveSvgId, duplicateSvgElement,
    addToSvgLibrary, removeFromSvgLibrary, renameSvgLibraryItem,
    setCSV, toggleRow, toggleAllRows, setMapping, setCanvasPreset, setCustomSize,
    setGenerated, addGeneratedPage, removeGeneratedPage, duplicateGeneratedPage,
    updateGeneratedPage, loadPageIntoEditor, returnToTemplate, getEditorSnapshot, insertTextIntoActiveLayer,
    setActivePage: setActivePageId, clearGenerated,
    undo, redo, canUndo, canRedo,
    savedTemplates, saveCurrentAsTemplate, deleteSavedTemplate, applySavedTemplate,
    selectAllNonce, selectAllLayers,
  }), [
    images, activeImageId, overlay, bgColor, bgMode, gradientFrom, gradientTo,
    layers, activeLayerId, svgElements, activeSvgIdState, svgLibrary,
    csv, enabledRows, fieldMapping, canvasPreset, generated, activePageId, previewRow,
    isEditingPage,
    addImages, removeImage, cycleImage, addLayer, updateLayer, removeLayer, setActiveLayer,
    applyTemplate, addSvgElement, addSvgFromLibrary, updateSvgElement, removeSvgElement, setActiveSvgId, duplicateSvgElement,
    addToSvgLibrary, removeFromSvgLibrary, renameSvgLibraryItem,
    setCSV, toggleRow, toggleAllRows, setMapping, setCanvasPreset, setCustomSize,
    addGeneratedPage, removeGeneratedPage, duplicateGeneratedPage, updateGeneratedPage,
    loadPageIntoEditor, returnToTemplate, getEditorSnapshot, insertTextIntoActiveLayer, clearGenerated,
    undo, redo, canUndo, canRedo,
    savedTemplates, saveCurrentAsTemplate, deleteSavedTemplate, applySavedTemplate,
    selectAllNonce, selectAllLayers,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() { const ctx = useContext(StudioContext); if (!ctx) throw new Error("useStudio must be used inside StudioProvider"); return ctx; }