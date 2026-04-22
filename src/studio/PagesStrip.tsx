import { Copy, Trash2, Download, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useStudio } from "./store";
import fileSaver from "file-saver";
const { saveAs } = fileSaver;
import { cn } from "@/lib/utils";

type Props = {
  onAddPage: () => void;
  onRerender: () => void;
};

export function PagesStrip({ onAddPage, onRerender }: Props) {
  const studio = useStudio();
  if (studio.generated.length === 0) return null;

  return (
    <div className="border-t border-border bg-card/80 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Generated Pages · {studio.generated.length}
          {studio.activePageId && (
            <span className="ml-2 text-primary normal-case font-normal tracking-normal">
              Editing page #{studio.generated.findIndex((p) => p.id === studio.activePageId) + 1}
            </span>
          )}
        </h4>
        <div className="flex gap-1">
          {studio.activePageId && (
            <Button size="sm" variant="default" className="h-7 text-xs gradient-primary text-white border-0" onClick={onRerender}>
              <RefreshCw className="w-3 h-3 mr-1" /> Save edits
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onAddPage}>
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={studio.clearGenerated}>
            Clear all
          </Button>
        </div>
      </div>
      <ScrollArea className="w-full">
        <div className="flex gap-3 px-4 pb-3">
          {studio.generated.map((p, i) => (
            <div
              key={p.id}
              className={cn(
                "relative shrink-0 group rounded-md overflow-hidden ring-2 transition-all cursor-pointer",
                studio.activePageId === p.id ? "ring-primary shadow-glow" : "ring-border hover:ring-primary/60"
              )}
              onClick={() => studio.loadPageIntoEditor(p.id)}
              title="Click to edit this page"
            >
              <img src={p.thumbnail} alt={`Page ${i + 1}`} className="h-28 w-auto object-cover bg-muted" />
              <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">#{i + 1}</div>
              <div className="absolute inset-x-0 bottom-0 p-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/80 to-transparent">
                <button
                  className="bg-white/90 text-black p-1 rounded hover:bg-white"
                  onClick={(e) => { e.stopPropagation(); saveAs(p.fullDataUrl, `design-${i + 1}.png`); }}
                  title="Download"
                >
                  <Download className="w-3 h-3" />
                </button>
                <button
                  className="bg-white/90 text-black p-1 rounded hover:bg-white"
                  onClick={(e) => { e.stopPropagation(); studio.duplicateGeneratedPage(p.id); }}
                  title="Duplicate"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  className="bg-destructive text-destructive-foreground p-1 rounded hover:opacity-90"
                  onClick={(e) => { e.stopPropagation(); studio.removeGeneratedPage(p.id); }}
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
