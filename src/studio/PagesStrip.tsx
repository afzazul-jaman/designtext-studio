import { Copy, Trash2, Download, Plus, RefreshCw, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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

  return (
    <aside className="w-[260px] shrink-0 border-l border-border bg-card flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
          Pages · {studio.generated.length}
        </h4>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={onAddPage} title="Add current canvas as a new page">
            <Plus className="w-3 h-3" />
          </Button>
          {studio.generated.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={studio.clearGenerated} title="Clear all">
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {studio.activePageId && (
        <div className="px-3 py-2 border-b border-border bg-primary/5">
          <Button
            size="sm"
            className="w-full h-8 text-xs gradient-primary text-white border-0"
            onClick={onRerender}
          >
            <RefreshCw className="w-3 h-3 mr-1.5" /> Save edits to page #
            {studio.generated.findIndex((p) => p.id === studio.activePageId) + 1}
          </Button>
        </div>
      )}

      {studio.generated.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            Hit <span className="text-primary font-semibold">Generate</span> to create pages.<br />
            Then scroll & click any page to edit.
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3">
            {studio.generated.map((p, i) => {
              const isActive = studio.activePageId === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "relative group rounded-md overflow-hidden ring-2 transition-all cursor-pointer bg-muted",
                    isActive ? "ring-primary shadow-glow" : "ring-border hover:ring-primary/60"
                  )}
                  onClick={() => studio.loadPageIntoEditor(p.id)}
                  title="Click to edit this page"
                >
                  <img
                    src={p.thumbnail}
                    alt={`Page ${i + 1}`}
                    className="w-full h-auto block"
                    draggable={false}
                  />
                  <div className="absolute top-1 left-1 bg-black/75 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                    #{i + 1}
                  </div>
                  {isActive && (
                    <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Pencil className="w-2.5 h-2.5" /> editing
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-1.5 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/85 to-transparent">
                    <button
                      className="bg-white/90 text-black p-1 rounded hover:bg-white"
                      onClick={(e) => { e.stopPropagation(); saveAs(p.fullDataUrl, `design-${i + 1}.png`); }}
                      title="Download this page"
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
              );
            })}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}
