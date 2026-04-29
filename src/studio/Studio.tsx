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

  // ★ FIX: Auto-save current page edits to its snapshot
  const autoSaveCurrentPage = async () => {
    if (!studio.activePageId) return;
    try {
      const url = await renderToDataURL(buildOptions(), 1);
      const thumb = await renderThumbnail(url);
      studio.updateGeneratedPage(studio.activePageId, {
        fullDataUrl: url, thumbnail: thumb,
        snapshot: studio.getEditorSnapshot(),
      });
    } catch (e) { console.warn("auto-save failed", e); }
  };

  const handleAddCurrent = async () => {
    if (!studio.layers.length && !studio.images.length && !studio.svgElements.length) { toast.error("Add content first"); return; }
    const url = await renderToDataURL(buildOptions(), 1); const thumb = await renderThumbnail(url);
    const page: GeneratedPage = { id: `page_${Date.now()}`, rowIndex: null, thumbnail: thumb, fullDataUrl: url, snapshot: studio.getEditorSnapshot() };
    studio.addGeneratedPage(page); studio.setActivePage(page.id); toast.success("Page added");
  };

  const handleRerenderActive = async () => {
    if (!studio.activePageId) return;
    await autoSaveCurrentPage();
    toast.success("Page updated");
  };

  // ★ FIX: Proper page switching — auto-save old page, load new page
  const handleSelectPage = async (pageId: string) => {
    // Auto-save current page first (even if same page — saves latest edits)
    if (studio.activePageId) {
      await autoSaveCurrentPage();
    }
    // Load the selected page
    if (studio.activePageId !== pageId) {
      studio.loadPageIntoEditor(pageId);
    }
  };

  // ★ FIX: Generate — create PERFECT copies from template
  const handleGenerate = async () => {
    if (!studio.layers.length && !studio.images.length) { toast.error("Add content first"); return; }

    // ★ If editing a page, return to template first
    if (studio.activePageId) {
      await autoSaveCurrentPage();
      studio.returnToTemplate();
      // Wait a tick for state to settle
      await new Promise((r) => setTimeout(r, 50));
    }

    const imgs = [...studio.images];
    const hasCsv = !!studio.csv;
    const ei = hasCsv ? Array.from(studio.enabledRows).sort((a, b) => a - b) : [];
    if (!hasCsv && imgs.length <= 1) { await handleAddCurrent(); return; }
    if (hasCsv && !ei.length) { toast.error("No rows selected"); return; }
    const total = imgs.length > 0
  ? Math.max(imgs.length, hasCsv ? ei.length : 0)
  : (hasCsv ? ei.length : 0);

    // ★ CRITICAL: Snapshot the template ONCE — never read studio.layers inside the loop
    const templateLayers: TextLayer[] = studio.layers.map((l) => ({
      ...l, effects: { ...l.effects },
      shadowSettings: l.shadowSettings ? { ...l.shadowSettings } : undefined,
      styles: l.styles ? JSON.parse(JSON.stringify(l.styles)) : undefined,
    }));
    const templateSvgs = studio.svgElements.map((e) => ({ ...e }));
    const templateMapping = { ...studio.fieldMapping };
    const tBgMode = studio.bgMode, tBgColor = studio.bgColor;
    const tGradFrom = studio.gradientFrom, tGradTo = studio.gradientTo, tOverlay = studio.overlay;

    setGenerating(true); setProgress(0); studio.clearGenerated();

    try {
      for (let i = 0; i < total; i++) {
        // ★ FIX: cycle CSV rows when images > rows
       const row = hasCsv ? studio.csv!.rows[ei[i % ei.length]] : null;
        // ★ FIX: each image gets its own page
        const pi = imgs.length > 0 ? imgs[i % imgs.length] : null;
        const extras: Record<string, string> = pi ? { filename: filenameToTitle(pi.name) } : {};

        // ★ Substitute placeholders in a FRESH clone of template layers
        const substituted = templateLayers.map((l) => ({
          ...l, effects: { ...l.effects },
          shadowSettings: l.shadowSettings ? { ...l.shadowSettings } : undefined,
          styles: l.styles ? JSON.parse(JSON.stringify(l.styles)) : undefined,
          text: substitutePlaceholders(l.text, row, templateMapping, extras),
        }));

        const useBgMode = imgs.length > 0 ? "image" as const : tBgMode;
        const opts = {
          width: studio.canvasPreset.width, height: studio.canvasPreset.height,
          bgMode: useBgMode, bgColor: tBgColor, gradientFrom: tGradFrom, gradientTo: tGradTo,
          overlay: tOverlay, layers: substituted, backgroundImageUrl: pi?.dataUrl ?? null,
          svgElements: templateSvgs,
        };

        const url = await renderToDataURL(opts, 1);
        const thumb = await renderThumbnail(url);

        studio.addGeneratedPage({
          id: `page_${Date.now()}_${i}`,
          rowIndex: hasCsv ? ei[i] : null,
          thumbnail: thumb, fullDataUrl: url,
          rowData: row ?? undefined,
          snapshot: {
            layers: substituted.map((l) => ({ ...l, effects: { ...l.effects } })),
            svgElements: templateSvgs.map((e) => ({ ...e })),
            imageId: pi?.id ?? studio.activeImageId,
            bgMode: useBgMode, bgColor: tBgColor,
            gradientFrom: tGradFrom, gradientTo: tGradTo, overlay: tOverlay,
          },
        });

        setProgress(Math.round(((i + 1) / total) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }
      toast.success(`Generated ${total} designs — click any page to edit`);
    } catch (err) { console.error(err); toast.error("Failed: " + (err as Error).message); }
    finally { setGenerating(false); setProgress(0); }
  };

  const handleExport = async () => {
    // Auto-save current page if editing
    if (studio.activePageId) await autoSaveCurrentPage();

    const pagesAfter = studio.generated;

    if (!pagesAfter.length) {
      const ai = studio.images.find((i) => i.id === studio.activeImageId);
      const url = await renderToDataURL(buildOptions(), 1);
      saveAs(url, ai ? `${stripExtension(ai.name)}.png` : "design.png");
      toast.success("Exported"); return;
    }

    setGenerating(true); setProgress(0);
    try {
      const fresh: { name: string; dataUrl: string }[] = []; const used = new Map<string, number>();
      for (let i = 0; i < pagesAfter.length; i++) {
        const url = await renderToDataURL(optionsFromSnapshot(pagesAfter[i].snapshot), 1);
        let name = getExportName(pagesAfter[i], i); const bn = stripExtension(name); const cnt = used.get(name) ?? 0;
        if (cnt > 0) name = `${bn} (${cnt}).png`; used.set(name, cnt + 1);
        fresh.push({ name, dataUrl: url }); setProgress(Math.round(((i + 1) / pagesAfter.length) * 60)); await new Promise((r) => setTimeout(r, 0));
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