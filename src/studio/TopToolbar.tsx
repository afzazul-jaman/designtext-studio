import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Plus, Download, Sparkles, Type, Undo2, Redo2, MousePointerSquareDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useStudio } from "./store";
import { FONT_LIBRARY } from "./types";
import { loadGoogleFont } from "./fontLoader";

type Props = {
  onGenerate: () => void;
  onExport: () => void;
  generating: boolean;
};

export function TopToolbar({ onGenerate, onExport, generating }: Props) {
  const studio = useStudio();
  const active = studio.layers.find((l) => l.id === studio.activeLayerId);

  const updateActive = (patch: Parameters<typeof studio.updateLayer>[1]) => {
    if (active) studio.updateLayer(active.id, patch);
  };

  return (
    <div className="h-14 glass border-b border-border flex items-center px-4 gap-2 z-20 relative">
      <div className="flex items-center gap-2 mr-2">
        <div className="w-8 h-8 rounded-md gradient-primary flex items-center justify-center shadow-glow">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="font-semibold tracking-tight">DesignText</div>
      </div>

      <Separator orientation="vertical" className="h-8 mx-2" />

      <Select
        value={active?.fontFamily ?? "Inter"}
        onValueChange={(v) => {
          loadGoogleFont(v);
          updateActive({ fontFamily: v });
        }}
        disabled={!active}
      >
        <SelectTrigger className="w-44 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {FONT_LIBRARY.map((cat) => (
            <div key={cat.category}>
              <div className="px-2 py-1 text-xs uppercase text-muted-foreground tracking-wider">{cat.category}</div>
              {cat.fonts.map((f) => (
                <SelectItem key={f} value={f}>
                  <span style={{ fontFamily: f }}>{f}</span>
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" className="h-9 w-9" disabled={!active}
          onClick={() => active && updateActive({ fontSize: Math.max(8, active.fontSize - 4) })}>
          −
        </Button>
        <Input
          className="w-16 h-9 text-center"
          type="number"
          value={active?.fontSize ?? 64}
          onChange={(e) => updateActive({ fontSize: Number(e.target.value) || 12 })}
          disabled={!active}
        />
        <Button size="icon" variant="ghost" className="h-9 w-9" disabled={!active}
          onClick={() => active && updateActive({ fontSize: active.fontSize + 4 })}>
          +
        </Button>
      </div>

      <Separator orientation="vertical" className="h-8 mx-1" />

      <input
        type="color"
        className="w-9 h-9 rounded-md cursor-pointer bg-transparent border border-border"
        value={active?.fill ?? "#ffffff"}
        onChange={(e) => updateActive({ fill: e.target.value })}
        disabled={!active}
        title="Text color"
      />

      <Button size="icon" variant={active?.fontWeight === "bold" ? "default" : "ghost"} className="h-9 w-9" disabled={!active}
        onClick={() => updateActive({ fontWeight: active?.fontWeight === "bold" ? "normal" : "bold" })}>
        <Bold className="w-4 h-4" />
      </Button>
      <Button size="icon" variant={active?.fontStyle === "italic" ? "default" : "ghost"} className="h-9 w-9" disabled={!active}
        onClick={() => updateActive({ fontStyle: active?.fontStyle === "italic" ? "normal" : "italic" })}>
        <Italic className="w-4 h-4" />
      </Button>

      <div className="flex items-center bg-muted rounded-md p-0.5">
        {(["left", "center", "right"] as const).map((a) => {
          const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
          return (
            <Button key={a} size="icon" variant={active?.textAlign === a ? "default" : "ghost"} className="h-8 w-8" disabled={!active}
              onClick={() => updateActive({ textAlign: a })}>
              <Icon className="w-4 h-4" />
            </Button>
          );
        })}
      </div>

      <div className="flex-1" />

      <Button variant="outline" size="sm" onClick={() => studio.addLayer()}>
        <Type className="w-4 h-4 mr-1.5" /> Add Text
      </Button>
      <Button variant="secondary" size="sm" onClick={onGenerate} disabled={generating}>
        <Plus className="w-4 h-4 mr-1.5" /> {generating ? "Generating…" : "Generate"}
      </Button>
      <Button size="sm" className="gradient-primary text-white shadow-glow border-0" onClick={onExport}>
        <Download className="w-4 h-4 mr-1.5" /> Export
      </Button>
    </div>
  );
}
