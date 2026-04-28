import { AlignCenter, AlignLeft, AlignRight, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useStudio } from "./store";
import { CANVAS_PRESETS } from "./types";
import type { ShadowSettings } from "./types";

const DEFAULT_SHADOW: ShadowSettings = { enabled: true, color: "rgba(0,0,0,0.55)", blur: 12, offsetX: 0, offsetY: 4 };

export function RightPanel() {
  const studio = useStudio();
  const layer = studio.layers.find((l) => l.id === studio.activeLayerId);

  const update = (patch: Parameters<typeof studio.updateLayer>[1]) => {
    if (layer) studio.updateLayer(layer.id, patch);
  };

  const shadow = layer?.shadowSettings ?? DEFAULT_SHADOW;
  const hasShadow = layer?.shadowSettings?.enabled ?? layer?.effects.shadow ?? false;

  const updateShadow = (patch: Partial<ShadowSettings>) => {
    if (!layer) return;
    const current = layer.shadowSettings ?? { ...DEFAULT_SHADOW, enabled: layer.effects.shadow };
    const next = { ...current, ...patch };
    update({ shadowSettings: next, effects: { ...layer.effects, shadow: next.enabled, glow: next.enabled ? false : layer.effects.glow } });
  };

  return (
    <aside className="w-[300px] border-l border-border bg-card flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Maximize2 className="w-4 h-4" /> Canvas</h3>
            <Select value={studio.canvasPreset.name} onValueChange={(v) => { const p = CANVAS_PRESETS.find((x) => x.name === v); if (p) studio.setCanvasPreset(p); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CANVAS_PRESETS.map((p) => (<SelectItem key={p.name} value={p.name}>{p.name} · {p.width}×{p.height}</SelectItem>))}
                <SelectItem value="Custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <div className="flex-1"><Label className="text-xs">W</Label><Input type="number" className="h-8" value={studio.canvasPreset.width} onChange={(e) => studio.setCustomSize(Number(e.target.value) || 100, studio.canvasPreset.height)} /></div>
              <div className="flex-1"><Label className="text-xs">H</Label><Input type="number" className="h-8" value={studio.canvasPreset.height} onChange={(e) => studio.setCustomSize(studio.canvasPreset.width, Number(e.target.value) || 100)} /></div>
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Text Properties</h3>
            {!layer && <p className="text-xs text-muted-foreground">Select a text layer to edit.</p>}

            {layer && (<>
              <div className="space-y-1">
                <Label className="text-xs flex items-center justify-between">Font Size <span className="text-muted-foreground">{layer.fontSize}px</span></Label>
                <Slider value={[layer.fontSize]} min={8} max={400} step={1} onValueChange={(v) => update({ fontSize: v[0] })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center justify-between">Line Height <span className="text-muted-foreground">{layer.lineHeight.toFixed(2)}</span></Label>
                <Slider value={[layer.lineHeight]} min={0.8} max={3} step={0.05} onValueChange={(v) => update({ lineHeight: v[0] })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center justify-between">Letter Spacing <span className="text-muted-foreground">{layer.charSpacing}</span></Label>
                <Slider value={[layer.charSpacing]} min={-100} max={400} step={5} onValueChange={(v) => update({ charSpacing: v[0] })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center justify-between">Opacity <span className="text-muted-foreground">{Math.round(layer.opacity * 100)}%</span></Label>
                <Slider value={[layer.opacity]} min={0} max={1} step={0.05} onValueChange={(v) => update({ opacity: v[0] })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center justify-between">Width <span className="text-muted-foreground">{Math.round(layer.width)}</span></Label>
                <Slider value={[layer.width]} min={50} max={2000} step={10} onValueChange={(v) => update({ width: v[0] })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alignment</Label>
                <div className="flex bg-muted rounded-md p-0.5">
                  {(["left", "center", "right"] as const).map((a) => {
                    const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
                    return (<Button key={a} size="sm" variant={layer.textAlign === a ? "default" : "ghost"} className="flex-1 h-8" onClick={() => update({ textAlign: a })}><Icon className="w-4 h-4" /></Button>);
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">X</Label><Input type="number" className="h-8" value={Math.round(layer.left)} onChange={(e) => update({ left: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Y</Label><Input type="number" className="h-8" value={Math.round(layer.top)} onChange={(e) => update({ top: Number(e.target.value) })} /></div>
              </div>

              {/* ★ NEW: Shadow Customization */}
              <div className="h-px bg-border" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Shadow</Label>
                  <button
                    onClick={() => updateShadow({ enabled: !hasShadow })}
                    className={`text-xs px-2 py-0.5 rounded-full transition-colors ${hasShadow ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >{hasShadow ? "ON" : "OFF"}</button>
                </div>

                {hasShadow && (
                  <div className="space-y-2 animate-fade-in">
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center justify-between">Color</Label>
                      <div className="flex gap-2">
                        <input type="color" value={shadow.color.startsWith("rgba") ? "#000000" : shadow.color}
                          onChange={(e) => updateShadow({ color: e.target.value })}
                          className="w-10 h-8 rounded cursor-pointer bg-transparent border border-border" />
                        <Input className="h-8 text-xs flex-1" value={shadow.color}
                          onChange={(e) => updateShadow({ color: e.target.value })}
                          placeholder="e.g. #000 or rgba(0,0,0,0.5)" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center justify-between">Blur <span className="text-muted-foreground">{shadow.blur}px</span></Label>
                      <Slider value={[shadow.blur]} min={0} max={100} step={1} onValueChange={(v) => updateShadow({ blur: v[0] })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center justify-between">Offset X <span className="text-muted-foreground">{shadow.offsetX}px</span></Label>
                      <Slider value={[shadow.offsetX]} min={-50} max={50} step={1} onValueChange={(v) => updateShadow({ offsetX: v[0] })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center justify-between">Offset Y <span className="text-muted-foreground">{shadow.offsetY}px</span></Label>
                      <Slider value={[shadow.offsetY]} min={-50} max={50} step={1} onValueChange={(v) => updateShadow({ offsetY: v[0] })} />
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { label: "Soft Drop", color: "rgba(0,0,0,0.4)", blur: 20, x: 0, y: 8 },
                        { label: "Hard Drop", color: "rgba(0,0,0,0.7)", blur: 4, x: 4, y: 4 },
                        { label: "Glow", color: "#7c3aed", blur: 30, x: 0, y: 0 },
                        { label: "Neon", color: "#22d3ee", blur: 25, x: 0, y: 0 },
                        { label: "Fire", color: "#f97316", blur: 20, x: 0, y: -4 },
                        { label: "Long", color: "rgba(0,0,0,0.3)", blur: 8, x: 0, y: 20 },
                      ].map((p) => (
                        <button key={p.label}
                          onClick={() => updateShadow({ enabled: true, color: p.color, blur: p.blur, offsetX: p.x, offsetY: p.y })}
                          className="text-[10px] px-2 py-1.5 rounded border border-border hover:bg-muted text-left"
                        >{p.label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>)}
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}