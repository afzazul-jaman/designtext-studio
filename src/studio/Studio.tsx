import { useEffect, useState } from "react";
import JSZip from "jszip";
import fileSaver from "file-saver";
const { saveAs } = fileSaver;
import { toast } from "sonner";
import { StudioProvider, useStudio } from "./store";
import { TopToolbar } from "./TopToolbar";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { StudioCanvas } from "./StudioCanvas";
import { PagesStrip } from "./PagesStrip";
import { renderToDataURL, substitutePlaceholders, filenameToTitle } from "./canvasRenderer";
import { GeneratedPage, TextLayer, PageSnapshot } from "./types";
import { preloadAllFonts } from "./fontLoader";

function stripExtension(f: string): string { return f.replace(/\.[^.]+$/, ""); }

function StudioInner() {
  const studio = useStudio();
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => { preloadAllFonts(); }, []);

  const buildOptions = (overrideLayers?: TextLayer[]) => ({
    width: studio.canvasPreset.width, height: studio.canvasPreset.height,
    bgMode: studio.bgMode, bgColor: studio.bgColor, gradientFrom: studio.gradientFrom, gradientTo: studio.gradientTo,
    backgroundImageUrl: studio.images.find((i) => i.id === studio.activeImageId)?.dataUrl ?? null,
    overlay: studio.overlay, layers: overrideLayers ?? studio.layers, svgElements: studio.svgElements,
  });

  const optionsFromSnapshot = (snap: PageSnapshot) => ({
    width: studio.canvasPreset.width, height: studio.canvasPreset.height,
    bgMode: snap.bgMode, bgColor: snap.bgColor, gradientFrom: snap.gradientFrom, gradientTo: snap.gradientTo,
    backgroundImageUrl: studio.images.find((i) => i.id === snap.imageId)?.dataUrl ?? null,
    overlay: snap.overlay, layers: snap.layers, svgElements: snap.svgElements ?? [],
  });

  const getExportName = (page: GeneratedPage, index: number): string => {
    if (page.snapshot.imageId) { const img = studio.images.find((i) => i.id === page.snapshot.imageId); if (img) return `${stripExtension(img.name)}.png`; }
    if (page.rowData) { const nv = page.rowData["Name"] ?? page.rowData["name"] ?? page.rowData["Title"] ?? page.rowData["title"] ?? page.rowData["filename"]; if (nv) { const s = nv.replace(/[<>:"/\\|?*]/g, "").trim(); if (s) return `${s}.png`; } }
    return `design-${String(index + 1).padStart(4, "0")}.png`;
  };

  const renderThumbnail = async (url: string): Promise<string> => new Promise((res) => { const img = new Image(); img.onload = () => { const c = document.createElement("canvas"); const r = img.width / img.height; c.height = 360; c.width = Math.round(360 * r); c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/png")); }; img.src = url; });

  const handleAddCurrent = async () => {
    if (!studio.layers.length && !studio.images.length && !studio.svgElements.length) { toast.error("Add content first"); return; }
    const url = await renderToDataURL(buildOptions(), 1); const thumb = await renderThumbnail(url);
    const page: GeneratedPage = { id: `page_${Date.now()}`, rowIndex: null, thumbnail: thumb, fullDataUrl: url, snapshot: studio.getEditorSnapshot() };
    studio.addGeneratedPage(page); studio.setActivePage(page.id); toast.success("Page added");
  };

  const handleRerenderActive = async () => { if (!studio.activePageId) return; const url = await renderToDataURL(buildOptions(), 1); const thumb = await renderThumbnail(url); studio.updateGeneratedPage(studio.activePageId, { fullDataUrl: url, thumbnail: thumb, snapshot: studio.getEditorSnapshot() }); toast.success("Page updated"); };

  const handleSelectPage = async (pageId: string) => {
    if (studio.activePageId && studio.activePageId !== pageId) { try { const url = await renderToDataURL(buildOptions(), 1); const thumb = await renderThumbnail(url); studio.updateGeneratedPage(studio.activePageId, { fullDataUrl: url, thumbnail: thumb, snapshot: studio.getEditorSnapshot() }); } catch {} }
    studio.loadPageIntoEditor(pageId);
  };

  const handleGenerate = async () => {
    if (!studio.layers.length && !studio.images.length) { toast.error("Add content first"); return; }
    // ★ FIX: take a fresh copy of images at generate time (not stale closure)
    const imgs = [...studio.images];
    const hasCsv = !!studio.csv;
    const ei = hasCsv ? Array.from(studio.enabledRows).sort((a, b) => a - b) : [];
    if (!hasCsv && imgs.length <= 1) { await handleAddCurrent(); return; }
    if (hasCsv && !ei.length) { toast.error("No rows selected"); return; }
    const total = hasCsv ? ei.length : imgs.length;
    const tl: TextLayer[] = studio.layers.map((l) => ({ ...l, effects: { ...l.effects }, styles: l.styles ? JSON.parse(JSON.stringify(l.styles)) : undefined }));
    const tSvgs = studio.svgElements.map((e) => ({ ...e }));
    const tm = { ...studio.fieldMapping }; const tbm = studio.bgMode; const tbc = studio.bgColor; const tgf = studio.gradientFrom; const tgt = studio.gradientTo; const tov = studio.overlay;
    setGenerating(true); setProgress(0); studio.clearGenerated();
    try {
      for (let i = 0; i < total; i++) {
        const row = hasCsv ? studio.csv!.rows[ei[i]] : null;
        const pi = imgs.length > 0 ? (hasCsv ? imgs[i % imgs.length] : imgs[i]) : null;
        const extras: Record<string, string> = pi ? { filename: filenameToTitle(pi.name) } : {};
        const sub = tl.map((l) => ({ ...l, effects: { ...l.effects }, styles: l.styles ? JSON.parse(JSON.stringify(l.styles)) : undefined, text: substitutePlaceholders(l.text, row, tm, extras) }));
        const opts = { width: studio.canvasPreset.width, height: studio.canvasPreset.height, bgMode: imgs.length > 0 ? "image" as const : tbm, bgColor: tbc, gradientFrom: tgf, gradientTo: tgt, overlay: tov, layers: sub, backgroundImageUrl: pi?.dataUrl ?? null, svgElements: tSvgs };
        const url = await renderToDataURL(opts, 1); const thumb = await renderThumbnail(url);
        studio.addGeneratedPage({ id: `page_${Date.now()}_${i}`, rowIndex: hasCsv ? ei[i] : null, thumbnail: thumb, fullDataUrl: url, rowData: row ?? undefined,
          snapshot: { layers: sub.map((l) => ({ ...l, effects: { ...l.effects } })), svgElements: tSvgs, imageId: pi?.id ?? studio.activeImageId, bgMode: imgs.length > 0 ? "image" : tbm, bgColor: tbc, gradientFrom: tgf, gradientTo: tgt, overlay: tov } });
        setProgress(Math.round(((i + 1) / total) * 100)); await new Promise((r) => setTimeout(r, 0));
      }
      toast.success(`Generated ${total} designs`);
    } catch (err) { console.error(err); toast.error("Failed: " + (err as Error).message); }
    finally { setGenerating(false); setProgress(0); }
  };

  const handleExport = async () => {
    if (studio.activePageId) { try { const url = await renderToDataURL(buildOptions(), 1); const thumb = await renderThumbnail(url); studio.updateGeneratedPage(studio.activePageId, { fullDataUrl: url, thumbnail: thumb, snapshot: studio.getEditorSnapshot() }); } catch {} }
    const pa = studio.activePageId ? studio.generated.map((p) => p.id === studio.activePageId ? { ...p, snapshot: studio.getEditorSnapshot() } : p) : studio.generated;
    if (!pa.length) {
      const ai = studio.images.find((i) => i.id === studio.activeImageId);
      // ★ FIX: export at 1x — same size as canvas (1000x1500 → 1000x1500)
      const url = await renderToDataURL(buildOptions(), 1);
      saveAs(url, ai ? `${stripExtension(ai.name)}.png` : "design.png"); toast.success("Exported"); return;
    }
    setGenerating(true); setProgress(0);
    try {
      const fresh: { name: string; dataUrl: string }[] = []; const used = new Map<string, number>();
      for (let i = 0; i < pa.length; i++) {
        // ★ FIX: export at 1x
        const url = await renderToDataURL(optionsFromSnapshot(pa[i].snapshot), 1);
        let name = getExportName(pa[i], i); const bn = stripExtension(name); const cnt = used.get(name) ?? 0;
        if (cnt > 0) name = `${bn} (${cnt}).png`; used.set(name, cnt + 1);
        fresh.push({ name, dataUrl: url }); setProgress(Math.round(((i + 1) / pa.length) * 60)); await new Promise((r) => setTimeout(r, 0));
      }
      if (fresh.length === 1) { saveAs(fresh[0].dataUrl, fresh[0].name); toast.success(`Exported ${fresh[0].name}`); return; }
      const zip = new JSZip(); const folder = zip.folder("designs")!;
      for (const f of fresh) folder.file(f.name, f.dataUrl.split(",")[1], { base64: true });
      const blob = await zip.generateAsync({ type: "blob" }, (m) => setProgress(60 + Math.round(m.percent * 0.4)));
      saveAs(blob, `designs-${fresh.length}.zip`); toast.success(`Exported ${fresh.length} designs`);
    } catch (err) { console.error(err); toast.error("Export failed"); }
    finally { setGenerating(false); setProgress(0); }
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <TopToolbar onGenerate={handleGenerate} onExport={handleExport} generating={generating} />
      <div className="flex overflow-hidden min-h-0" style={{ height: 'calc(100vh - 3.5rem)' }}>
        <LeftPanel />
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0">
          <StudioCanvas />
          {generating && <div className="absolute inset-x-0 top-0 h-1 bg-muted"><div className="h-full gradient-primary transition-all" style={{ width: `${progress}%` }} /></div>}
        </div>
        <PagesStrip onAddPage={handleAddCurrent} onRerender={handleRerenderActive} onSelectPage={handleSelectPage} />
        <RightPanel />
      </div>
    </div>
  );
}

export function Studio() { return <StudioProvider><StudioInner /></StudioProvider>; }