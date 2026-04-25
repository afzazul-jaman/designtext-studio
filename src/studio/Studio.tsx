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

function StudioInner() {
  const studio = useStudio();
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    preloadAllFonts();
  }, []);

  const buildOptions = (overrideLayers?: TextLayer[]) => ({
    width: studio.canvasPreset.width,
    height: studio.canvasPreset.height,
    bgMode: studio.bgMode,
    bgColor: studio.bgColor,
    gradientFrom: studio.gradientFrom,
    gradientTo: studio.gradientTo,
    backgroundImageUrl: studio.images.find((i) => i.id === studio.activeImageId)?.dataUrl ?? null,
    overlay: studio.overlay,
    layers: overrideLayers ?? studio.layers,
  });

  // Build render options from a snapshot (used at export time so the file matches the editor)
  const optionsFromSnapshot = (snap: PageSnapshot) => ({
    width: studio.canvasPreset.width,
    height: studio.canvasPreset.height,
    bgMode: snap.bgMode,
    bgColor: snap.bgColor,
    gradientFrom: snap.gradientFrom,
    gradientTo: snap.gradientTo,
    backgroundImageUrl: studio.images.find((i) => i.id === snap.imageId)?.dataUrl ?? null,
    overlay: snap.overlay,
    layers: snap.layers,
  });

  const renderThumbnail = async (fullUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const targetH = 360;
        const ratio = img.width / img.height;
        c.height = targetH;
        c.width = Math.round(targetH * ratio);
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/png"));
      };
      img.src = fullUrl;
    });
  };

  const handleAddCurrent = async () => {
    if (studio.layers.length === 0 && studio.images.length === 0) {
      toast.error("Add an image or text layer first");
      return;
    }
    const url = await renderToDataURL(buildOptions(), 1);
    const thumb = await renderThumbnail(url);
    const page: GeneratedPage = {
      id: `page_${Date.now()}`,
      rowIndex: null,
      thumbnail: thumb,
      fullDataUrl: url,
      snapshot: studio.getEditorSnapshot(),
    };
    studio.addGeneratedPage(page);
    studio.setActivePage(page.id);
    toast.success("Page added");
  };

  const handleRerenderActive = async () => {
    if (!studio.activePageId) return;
    const url = await renderToDataURL(buildOptions(), 1);
    const thumb = await renderThumbnail(url);
    studio.updateGeneratedPage(studio.activePageId, {
      fullDataUrl: url,
      thumbnail: thumb,
      snapshot: studio.getEditorSnapshot(),
    });
    toast.success("Page updated");
  };

  const handleSelectPage = async (pageId: string) => {
    if (studio.activePageId && studio.activePageId !== pageId) {
      try {
        const url = await renderToDataURL(buildOptions(), 1);
        const thumb = await renderThumbnail(url);
        studio.updateGeneratedPage(studio.activePageId, {
          fullDataUrl: url,
          thumbnail: thumb,
          snapshot: studio.getEditorSnapshot(),
        });
      } catch (e) {
        console.warn("auto-save before page switch failed", e);
      }
    }
    studio.loadPageIntoEditor(pageId);
  };

  const handleGenerate = async () => {
    if (studio.layers.length === 0 && studio.images.length === 0) {
      toast.error("Add at least one image or text layer");
      return;
    }

    const imgs = studio.images;
    const hasCsv = !!studio.csv;
    // CRITICAL: only use rows the user has selected — never others
    const enabledIndexes = hasCsv
      ? Array.from(studio.enabledRows).sort((a, b) => a - b)
      : [];

    if (!hasCsv && imgs.length <= 1) {
      await handleAddCurrent();
      return;
    }

    if (hasCsv && enabledIndexes.length === 0) {
      toast.error("No rows selected — tick rows in the Data tab");
      return;
    }

    const total = hasCsv ? enabledIndexes.length : imgs.length;

    // Snapshot the TEMPLATE (with {placeholder} text intact) ONCE, before the loop.
    // Never read studio.layers inside the loop — it may have been mutated by a prior
    // generate that loaded a substituted page back into the editor.
    const templateLayers: TextLayer[] = studio.layers.map((l) => ({
      ...l,
      effects: { ...l.effects },
      styles: l.styles ? JSON.parse(JSON.stringify(l.styles)) : undefined,
    }));
    const templateMapping = { ...studio.fieldMapping };
    const templateBgMode = studio.bgMode;
    const templateBgColor = studio.bgColor;
    const templateGradFrom = studio.gradientFrom;
    const templateGradTo = studio.gradientTo;
    const templateOverlay = studio.overlay;

    setGenerating(true);
    setProgress(0);
    studio.clearGenerated();

    try {
      const newPages: GeneratedPage[] = [];

      for (let i = 0; i < total; i++) {
        const row = hasCsv ? studio.csv!.rows[enabledIndexes[i]] : null;
        // Pick the per-page image FIRST so we can substitute {filename}
        let pageImage = null as typeof imgs[number] | null;
        if (imgs.length > 0) {
          pageImage = hasCsv ? imgs[i % imgs.length] : imgs[i];
        }
        const extras: Record<string, string> = pageImage
          ? { filename: filenameToTitle(pageImage.name) }
          : {};
        const substituted = templateLayers.map((l) => ({
          ...l,
          effects: { ...l.effects },
          styles: l.styles ? JSON.parse(JSON.stringify(l.styles)) : undefined,
          text: substitutePlaceholders(l.text, row, templateMapping, extras),
        }));

        const opts = {
          width: studio.canvasPreset.width,
          height: studio.canvasPreset.height,
          bgMode: imgs.length > 0 ? ("image" as const) : templateBgMode,
          bgColor: templateBgColor,
          gradientFrom: templateGradFrom,
          gradientTo: templateGradTo,
          overlay: templateOverlay,
          layers: substituted,
          backgroundImageUrl: pageImage?.dataUrl ?? null,
        };
        const imgIdForSnapshot = pageImage?.id ?? studio.activeImageId;

        const url = await renderToDataURL(opts, 1);
        const thumb = await renderThumbnail(url);
        const page: GeneratedPage = {
          id: `page_${Date.now()}_${i}`,
          rowIndex: hasCsv ? enabledIndexes[i] : null,
          thumbnail: thumb,
          fullDataUrl: url,
          rowData: row ?? undefined,
          snapshot: {
            layers: substituted.map((l) => ({ ...l, effects: { ...l.effects } })),
            imageId: imgIdForSnapshot,
            bgMode: imgs.length > 0 ? "image" : templateBgMode,
            bgColor: templateBgColor,
            gradientFrom: templateGradFrom,
            gradientTo: templateGradTo,
            overlay: templateOverlay,
          },
        };
        newPages.push(page);
        studio.addGeneratedPage(page);
        setProgress(Math.round(((i + 1) / total) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }

      // IMPORTANT: do NOT load the first generated page into the editor — that
      // would overwrite the template ({Name} placeholders) with substituted text,
      // breaking the next Generate. The editor stays on the template; clicking a
      // page card in the right strip lets the user edit that specific page.
      toast.success(`Generated ${newPages.length} designs — click any page on the right to edit it`);
    } catch (err) {
      console.error(err);
      toast.error("Generation failed: " + (err as Error).message);
    } finally {
      setGenerating(false);
      setProgress(0);
    }
  };

  const handleExport = async () => {
    // If user is editing a page, fold their unsaved edits into that page first
    if (studio.activePageId) {
      try {
        const url = await renderToDataURL(buildOptions(), 1);
        const thumb = await renderThumbnail(url);
        studio.updateGeneratedPage(studio.activePageId, {
          fullDataUrl: url,
          thumbnail: thumb,
          snapshot: studio.getEditorSnapshot(),
        });
      } catch (e) {
        console.warn("auto-save before export failed", e);
      }
    }

    // Snapshot the latest pages list AFTER the auto-save above
    const pagesAfter = studio.activePageId
      ? studio.generated.map((p) =>
          p.id === studio.activePageId
            ? { ...p, snapshot: studio.getEditorSnapshot() }
            : p
        )
      : studio.generated;

    if (pagesAfter.length === 0) {
      // Export current canvas at 2x
      const url = await renderToDataURL(buildOptions(), 2);
      saveAs(url, "design.png");
      toast.success("Exported design.png");
      return;
    }

    setGenerating(true);
    setProgress(0);
    try {
      // Always re-render from snapshot at 2x so the file matches the editor exactly
      const fresh: { name: string; dataUrl: string }[] = [];
      for (let i = 0; i < pagesAfter.length; i++) {
        const p = pagesAfter[i];
        const url = await renderToDataURL(optionsFromSnapshot(p.snapshot), 2);
        fresh.push({ name: `design-${String(i + 1).padStart(4, "0")}.png`, dataUrl: url });
        setProgress(Math.round(((i + 1) / pagesAfter.length) * 60));
        await new Promise((r) => setTimeout(r, 0));
      }

      if (fresh.length === 1) {
        saveAs(fresh[0].dataUrl, fresh[0].name);
        toast.success("Exported design");
        return;
      }

      const zip = new JSZip();
      const folder = zip.folder("designs")!;
      for (const f of fresh) {
        folder.file(f.name, f.dataUrl.split(",")[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob" }, (m) =>
        setProgress(60 + Math.round(m.percent * 0.4))
      );
      saveAs(blob, `designs-${fresh.length}.zip`);
      toast.success(`Exported ZIP with ${fresh.length} designs`);
    } catch (err) {
      console.error(err);
      toast.error("Export failed: " + (err as Error).message);
    } finally {
      setGenerating(false);
      setProgress(0);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <TopToolbar onGenerate={handleGenerate} onExport={handleExport} generating={generating} />
      <div className="flex-1 flex overflow-hidden">
        <LeftPanel />
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <StudioCanvas />
          {generating && (
            <div className="absolute inset-x-0 top-0 h-1 bg-muted">
              <div className="h-full gradient-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        <PagesStrip onAddPage={handleAddCurrent} onRerender={handleRerenderActive} onSelectPage={handleSelectPage} />
        <RightPanel />
      </div>
    </div>
  );
}

export function Studio() {
  return (
    <StudioProvider>
      <StudioInner />
    </StudioProvider>
  );
}
