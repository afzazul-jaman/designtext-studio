import { AlignCenter, AlignLeft, AlignRight, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useStudio } from "./store";
import { CANVAS_PRESETS } from "./types";

export function RightPanel() {
  const studio = useStudio();
  const layer = studio.layers.find((l) => l.id === studio.activeLayerId);

  const update = (patch: Parameters<typeof studio.updateLayer>[1]) => {
    if (layer) studio.updateLayer(layer.id, patch);
  };

  return (
    <aside className="w-[300px] border-l border-border bg-card flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Maximize2 className="w-4 h-4" /> Canvas</h3>
            <Select
              value={studio.canvasPreset.name}
              onValueChange={(v) => {
                const p = CANVAS_PRESETS.find((x) => x.name === v);
                if (p) studio.setCanvasPreset(p);
              }}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CANVAS_PRESETS.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name} · {p.width}×{p.height}
                  </SelectItem>
                ))}
                <SelectItem value="Custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs">W</Label>
                <Input
                  type="number"
                  className="h-8"
                  value={studio.canvasPreset.width}
                  onChange={(e) => studio.setCustomSize(Number(e.target.value) || 100, studio.canvasPreset.height)}
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs">H</Label>
                <Input
                  type="number"
                  className="h-8"
                  value={studio.canvasPreset.height}
                  onChange={(e) => studio.setCustomSize(studio.canvasPreset.width, Number(e.target.value) || 100)}
                />
              </div>
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Text Properties</h3>
            {!layer && <p className="text-xs text-muted-foreground">Select a text layer to edit.</p>}

            {layer && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center justify-between">
                    Font Size <span className="text-muted-foreground">{layer.fontSize}px</span>
                  </Label>
                  <Slider value={[layer.fontSize]} min={8} max={400} step={1} onValueChange={(v) => update({ fontSize: v[0] })} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs flex items-center justify-between">
                    Line Height <span className="text-muted-foreground">{layer.lineHeight.toFixed(2)}</span>
                  </Label>
                  <Slider value={[layer.lineHeight]} min={0.8} max={3} step={0.05} onValueChange={(v) => update({ lineHeight: v[0] })} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs flex items-center justify-between">
                    Letter Spacing <span className="text-muted-foreground">{layer.charSpacing}</span>
                  </Label>
                  <Slider value={[layer.charSpacing]} min={-100} max={400} step={5} onValueChange={(v) => update({ charSpacing: v[0] })} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs flex items-center justify-between">
                    Opacity <span className="text-muted-foreground">{Math.round(layer.opacity * 100)}%</span>
                  </Label>
                  <Slider value={[layer.opacity]} min={0} max={1} step={0.05} onValueChange={(v) => update({ opacity: v[0] })} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs flex items-center justify-between">
                    Width <span className="text-muted-foreground">{Math.round(layer.width)}</span>
                  </Label>
                  <Slider value={[layer.width]} min={50} max={2000} step={10} onValueChange={(v) => update({ width: v[0] })} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Alignment</Label>
                  <div className="flex bg-muted rounded-md p-0.5">
                    {(["left", "center", "right"] as const).map((a) => {
                      const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
                      return (
                        <Button
                          key={a}
                          size="sm"
                          variant={layer.textAlign === a ? "default" : "ghost"}
                          className="flex-1 h-8"
                          onClick={() => update({ textAlign: a })}
                        >
                          <Icon className="w-4 h-4" />
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">X</Label>
                    <Input type="number" className="h-8" value={Math.round(layer.left)} onChange={(e) => update({ left: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-xs">Y</Label>
                    <Input type="number" className="h-8" value={Math.round(layer.top)} onChange={(e) => update({ top: Number(e.target.value) })} />
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
