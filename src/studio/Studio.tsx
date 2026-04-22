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
import { renderToDataURL, substitutePlaceholders } from "./canvasRenderer";
import { GeneratedPage, TextLayer } from "./types";
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

  const renderThumbnail = async (fullUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const targetH = 200;
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
    const page: GeneratedPage = { id: `page_${Date.now()}`, rowIndex: null, thumbnail: thumb, fullDataUrl: url };
    studio.addGeneratedPage(page);
    studio.setActivePage(page.id);
    toast.success("Page added");
  };

  const handleGenerate = async () => {
    if (!studio.csv) {
      // No CSV — just snapshot current
      await handleAddCurrent();
      return;
    }
    if (studio.layers.length === 0) {
      toast.error("Add at least one text layer");
      return;
    }

    setGenerating(true);
    setProgress(0);
    studio.clearGenerated();

    try {
      const enabledIndexes = Array.from(studio.enabledRows).sort((a, b) => a - b);
      const total = enabledIndexes.length;
      if (total === 0) {
        toast.error("No rows selected");
        setGenerating(false);
        return;
      }

      // multi-image cycling
      const imgs = studio.images;
      const newPages: GeneratedPage[] = [];

      for (let i = 0; i < enabledIndexes.length; i++) {
        const rowIndex = enabledIndexes[i];
        const row = studio.csv.rows[rowIndex];
        const substituted = studio.layers.map((l) => ({
          ...l,
          text: substitutePlaceholders(l.text, row, studio.fieldMapping),
        }));

        const opts = buildOptions(substituted);
        if (imgs.length > 0) {
          const img = imgs[i % imgs.length];
          opts.backgroundImageUrl = img.dataUrl;
        }

        const url = await renderToDataURL(opts, 1);
        const thumb = await renderThumbnail(url);
        const page: GeneratedPage = {
          id: `page_${Date.now()}_${i}`,
          rowIndex,
          thumbnail: thumb,
          fullDataUrl: url,
          rowData: row,
        };
        newPages.push(page);
        studio.addGeneratedPage(page);
        setProgress(Math.round(((i + 1) / total) * 100));
        // yield to UI
        await new Promise((r) => setTimeout(r, 0));
      }

      if (newPages[0]) studio.setActivePage(newPages[0].id);
      toast.success(`Generated ${newPages.length} designs`);
    } catch (err) {
      console.error(err);
      toast.error("Generation failed: " + (err as Error).message);
    } finally {
      setGenerating(false);
      setProgress(0);
    }
  };

  const handleExport = async () => {
    const pages = studio.generated;
    if (pages.length === 0) {
      // Export current canvas
      const url = await renderToDataURL(buildOptions(), 2);
      saveAs(url, "design.png");
      toast.success("Exported design.png");
      return;
    }
    if (pages.length === 1) {
      saveAs(pages[0].fullDataUrl, "design-1.png");
      toast.success("Exported design");
      return;
    }
    const zip = new JSZip();
    const folder = zip.folder("designs")!;
    for (let i = 0; i < pages.length; i++) {
      const dataUrl = pages[i].fullDataUrl;
      const base64 = dataUrl.split(",")[1];
      folder.file(`design-${String(i + 1).padStart(4, "0")}.png`, base64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: "blob" }, (m) => setProgress(Math.round(m.percent)));
    saveAs(blob, `designs-${pages.length}.zip`);
    toast.success(`Exported ZIP with ${pages.length} designs`);
    setProgress(0);
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
          <PagesStrip onAddPage={handleAddCurrent} />
        </div>
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
