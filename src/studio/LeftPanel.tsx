import { useRef, useState, DragEvent } from "react";
import Papa from "papaparse";
import { Upload, X, ChevronLeft, ChevronRight, FileSpreadsheet, Trash2, Image as ImageIcon, Type, Sparkles, Palette as PaletteIcon, Wand2, FileText, Hexagon, Copy, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useStudio } from "./store";
import { CSVData, COLOR_PALETTE, FONT_LIBRARY, TEMPLATES } from "./types";
import { extractPlaceholders } from "./canvasRenderer";
import { loadGoogleFont } from "./fontLoader";
import { applyStyleToSelection } from "./StudioCanvas";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function LeftPanel() {
  const studio = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<HTMLInputElement>(null);
  const [bulkText, setBulkText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [tplName, setTplName] = useState("");

  const placeholders = extractPlaceholders(studio.layers);
  const mappedCount = placeholders.filter((p) => studio.fieldMapping[p]).length;
  const mappingProgress = placeholders.length > 0 ? (mappedCount / placeholders.length) * 100 : 0;

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    await studio.addImages(Array.from(files));
    toast.success(`${files.length} image(s) uploaded`);
  };

  const handleDrop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };

  const handleCSV = (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("CSV file too large (max 10MB)"); return; }
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        if (res.errors.length > 0) { toast.error("CSV parse error: " + res.errors[0].message); return; }
        const headers = res.meta.fields ?? [];
        studio.setCSV({ fileName: file.name, headers, rows: res.data });
        toast.success(`Loaded ${res.data.length} rows`);
      },
      error: (err) => toast.error(err.message),
    });
  };

  // ★ NEW: Handle SVG upload
  const handleSvgUpload = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.name.toLowerCase().endsWith(".svg") && file.type !== "image/svg+xml") {
        toast.error(`${file.name} is not an SVG file`);
        return;
      }
      if (file.size > 5 * 1024 * 1024) { toast.error("SVG file too large (max 5MB)"); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        studio.addSvgElement(content, file.name.replace(/\.svg$/i, ""));
        toast.success(`Added ${file.name}`);
      };
      reader.onerror = () => toast.error(`Failed to read ${file.name}`);
      reader.readAsText(file);
    });
  };

  const applyBulkTitles = () => {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const data: CSVData = { fileName: "bulk-titles.txt", headers: ["title"], rows: lines.map((l) => ({ title: l })) };
    studio.setCSV(data);
    if (studio.layers.length > 0 && !studio.layers.some((l) => l.text.includes("{title}"))) {
      studio.updateLayer(studio.layers[0].id, { text: "{title}" });
    } else if (studio.layers.length === 0) { studio.addLayer({ text: "{title}" }); }
    toast.success(`${lines.length} titles ready`);
  };

  const activeImage = studio.images.find((i) => i.id === studio.activeImageId);
  const activeSvg = studio.svgElements.find((e) => e.id === studio.activeSvgId);

  return (
    <aside className="w-[340px] border-r border-border bg-card flex flex-col h-full min-h-0">
      <Tabs defaultValue="data" className="flex-1 flex flex-col overflow-hidden min-h-0">
        <TabsList className="grid grid-cols-6 mx-2 mt-2 bg-muted shrink-0">
          <TabsTrigger value="data" title="Data"><FileSpreadsheet className="w-4 h-4" /></TabsTrigger>
          <TabsTrigger value="images" title="Images"><ImageIcon className="w-4 h-4" /></TabsTrigger>
          <TabsTrigger value="text" title="Text & Fonts"><Type className="w-4 h-4" /></TabsTrigger>
          <TabsTrigger value="shapes" title="SVG Shapes"><Hexagon className="w-4 h-4" /></TabsTrigger>
          <TabsTrigger value="effects" title="Effects"><Sparkles className="w-4 h-4" /></TabsTrigger>
          <TabsTrigger value="templates" title="Templates"><Wand2 className="w-4 h-4" /></TabsTrigger>
        </TabsList>

        {/* DATA TAB */}
        <TabsContent value="data" className="flex-1 overflow-hidden m-0 min-h-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">CSV Upload</h3>
                  {studio.csv && (<Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => studio.setCSV(null)}><Trash2 className="w-3 h-3 mr-1" /> Clear</Button>)}
                </div>
                <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={(e) => handleCSV(e.target.files?.[0] ?? null)} />
                <Button variant="outline" className="w-full" onClick={() => csvRef.current?.click()}><Upload className="w-4 h-4 mr-2" /> Upload CSV</Button>
                {studio.csv && (() => {
                  const selectedRows = studio.csv.rows.map((r, i) => ({ r, i })).filter(({ i }) => studio.enabledRows.has(i));
                  const previewRows = selectedRows.slice(0, 30);
                  return (
                    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 animate-fade-in">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="font-medium truncate flex-1 min-w-0">{studio.csv.fileName}</span>
                        <Badge variant="secondary" className="shrink-0">{selectedRows.length}/{studio.csv.rows.length} selected</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Showing only selected rows.</p>
                      {previewRows.length === 0 ? (<p className="text-xs text-muted-foreground italic px-2 py-3 text-center">No rows selected.</p>) : (
                        <div className="max-h-40 overflow-auto rounded border border-border">
                          <table className="w-full text-[11px]">
                            <thead className="bg-muted sticky top-0"><tr><th className="px-2 py-1 text-left font-medium w-8">#</th>{studio.csv!.headers.map((h) => (<th key={h} className="px-2 py-1 text-left font-medium">{h}</th>))}</tr></thead>
                            <tbody>{previewRows.map(({ r, i }) => (<tr key={i} className="border-t border-border"><td className="px-2 py-1 text-muted-foreground font-mono">{i + 1}</td>{studio.csv!.headers.map((h) => (<td key={h} className="px-2 py-1 truncate max-w-[100px]">{r[h]}</td>))}</tr>))}</tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </section>
              {studio.csv && studio.csv.headers.length > 0 && (() => {
                const firstSelectedIdx = Array.from(studio.enabledRows).sort((a, b) => a - b)[0];
                const sampleRow = firstSelectedIdx != null ? studio.csv!.rows[firstSelectedIdx] : studio.csv!.rows[0];
                return (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">Insert CSV Field</h3>
                    <p className="text-xs text-muted-foreground">Click a field to insert into the selected text layer.</p>
                    <div className="flex flex-col gap-1.5">
                      {studio.csv!.headers.map((h) => { const sample = sampleRow?.[h] ?? ""; return (
                        <button key={h} onClick={() => { studio.insertTextIntoActiveLayer(`{${h}}`); studio.setMapping(h, h); toast.success(`Inserted {${h}}`); }}
                          className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md bg-primary/10 text-foreground border border-primary/30 hover:bg-primary/20 hover:shadow-glow transition-all text-left">
                          <span className="font-mono text-primary text-[10px] shrink-0 px-1.5 py-0.5 rounded bg-primary/15 border border-primary/30">{`{${h}}`}</span>
                          <span className="truncate flex-1 text-muted-foreground italic">{sample ? `e.g. ${sample}` : "(empty)"}</span>
                        </button>); })}
                    </div>
                  </section>);
              })()}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Bulk Titles</h3>
                <Textarea rows={4} placeholder={"Each line = one design\nProduct A\nProduct B\nProduct C"} value={bulkText} onChange={(e) => setBulkText(e.target.value)} className="text-xs font-mono" />
                <Button size="sm" variant="secondary" className="w-full" onClick={applyBulkTitles}>Use as data</Button>
              </section>
              <section className="space-y-2">
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Field Mapping</h3><span className="text-xs text-muted-foreground">{mappedCount}/{placeholders.length}</span></div>
                {placeholders.length === 0 ? (<p className="text-xs text-muted-foreground">Use placeholders like <code className="px-1 py-0.5 bg-muted rounded">{`{name}`}</code> in text layers.</p>) : (
                  <><Progress value={mappingProgress} className="h-1.5" /><div className="space-y-1.5">{placeholders.map((p) => (
                    <div key={p} className="flex items-center gap-2"><code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">{`{${p}}`}</code><span className="text-xs text-muted-foreground">→</span>
                      <Select value={studio.fieldMapping[p] ?? ""} onValueChange={(v) => studio.setMapping(p, v)}><SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{(studio.csv?.headers ?? []).map((h) => (<SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>))}</SelectContent></Select>
                    </div>))}</div></>)}
              </section>
              {studio.csv && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Select Rows</h3>
                    <div className="flex gap-1"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => studio.toggleAllRows(true)}>All</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => studio.toggleAllRows(false)}>None</Button></div>
                  </div>
                  <div className="max-h-48 overflow-auto rounded border border-border divide-y divide-border">
                    {studio.csv.rows.slice(0, 200).map((r, i) => (<label key={i} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 cursor-pointer text-xs"><Checkbox checked={studio.enabledRows.has(i)} onCheckedChange={() => studio.toggleRow(i)} /><span className="truncate flex-1">{Object.values(r).slice(0, 2).join(" — ")}</span></label>))}
                  </div>
                  <p className="text-xs text-muted-foreground">{studio.enabledRows.size} of {studio.csv.rows.length} selected</p>
                </section>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* IMAGES TAB */}
        <TabsContent value="images" className="flex-1 overflow-hidden m-0 min-h-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              <div className={cn("rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-all", dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/60")}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => fileRef.current?.click()}>
                <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" /><p className="text-sm font-medium">Drop images or click</p><p className="text-xs text-muted-foreground mt-1">PNG, JPG, WebP — up to 15MB</p>
              </div>
              {studio.images.length > 0 && (<>
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{studio.images.length} image(s)</h3><div className="flex gap-1"><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => studio.cycleImage(-1)}><ChevronLeft className="w-4 h-4" /></Button><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => studio.cycleImage(1)}><ChevronRight className="w-4 h-4" /></Button></div></div>
                <div className="grid grid-cols-3 gap-2">{studio.images.map((img) => (
                  <div key={img.id} className={cn("relative aspect-square rounded-md overflow-hidden cursor-pointer ring-2 transition-all group", img.id === studio.activeImageId ? "ring-primary shadow-glow" : "ring-transparent hover:ring-border")}
                    onClick={() => { studio.setActiveImage(img.id); studio.setBgMode("image"); }}>
                    <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                    <button className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" onClick={(e) => { e.stopPropagation(); studio.removeImage(img.id); }}><X className="w-3 h-3" /></button>
                  </div>))}</div></>
              )}
              <section className="space-y-2"><h3 className="text-sm font-semibold">Background Mode</h3>
                <div className="grid grid-cols-3 gap-1">{(["image", "color", "gradient"] as const).map((m) => (<Button key={m} size="sm" variant={studio.bgMode === m ? "default" : "outline"} onClick={() => studio.setBgMode(m)} className="capitalize text-xs">{m}</Button>))}</div>
                {studio.bgMode === "color" && (<input type="color" value={studio.bgColor} onChange={(e) => studio.setBgColor(e.target.value)} className="w-full h-10 rounded-md cursor-pointer bg-transparent border border-border" />)}
                {studio.bgMode === "gradient" && (<div className="flex gap-2"><input type="color" value={studio.gradientFrom} onChange={(e) => studio.setGradient(e.target.value, studio.gradientTo)} className="flex-1 h-10 rounded-md cursor-pointer bg-transparent border border-border" /><input type="color" value={studio.gradientTo} onChange={(e) => studio.setGradient(studio.gradientFrom, e.target.value)} className="flex-1 h-10 rounded-md cursor-pointer bg-transparent border border-border" /></div>)}
              </section>
              <section className="space-y-2"><h3 className="text-sm font-semibold">Overlay</h3>
                <div className="grid grid-cols-2 gap-1">{(["none", "dark", "light", "vignette"] as const).map((o) => (<Button key={o} size="sm" variant={studio.overlay === o ? "default" : "outline"} onClick={() => studio.setOverlay(o)} className="capitalize text-xs">{o}</Button>))}</div>
              </section>
              {studio.images.length > 0 && (
                <section className="space-y-2 pt-2 border-t border-border">
                  {activeImage && (<p className="text-xs text-muted-foreground truncate">Active: {activeImage.name}</p>)}
                  <Button size="sm" variant="secondary" className="w-full" onClick={() => { studio.insertTextIntoActiveLayer("{filename}"); toast.success("Inserted {filename}"); }}><FileText className="w-4 h-4 mr-2" /> Use filename as title</Button>
                  <p className="text-[10px] text-muted-foreground leading-snug">Inserts <code className="px-1 py-0.5 bg-muted rounded">{`{filename}`}</code> — each page gets its own image title.</p>
                </section>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* TEXT/FONT TAB */}
        <TabsContent value="text" className="flex-1 overflow-hidden m-0 min-h-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <Button variant="outline" className="w-full" onClick={() => studio.addLayer()}><Type className="w-4 h-4 mr-2" /> Add Text Layer</Button>
              {studio.csv && studio.csv.headers.length > 0 && (() => {
                const firstSelectedIdx = Array.from(studio.enabledRows).sort((a, b) => a - b)[0];
                const sampleRow = firstSelectedIdx != null ? studio.csv!.rows[firstSelectedIdx] : studio.csv!.rows[0];
                return (<section className="space-y-2"><h3 className="text-sm font-semibold">Insert CSV Field</h3><p className="text-[11px] text-muted-foreground">Click a field to add to the selected text layer.</p>
                  <div className="flex flex-col gap-1.5">{studio.csv!.headers.map((h) => { const sample = sampleRow?.[h] ?? ""; return (
                    <button key={h} onClick={() => { studio.insertTextIntoActiveLayer(`{${h}}`); studio.setMapping(h, h); toast.success(`Inserted {${h}}`); }}
                      className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-all text-left">
                      <span className="font-mono text-primary text-[10px] shrink-0 px-1.5 py-0.5 rounded bg-primary/15 border border-primary/30">{`{${h}}`}</span>
                      <span className="truncate flex-1 text-muted-foreground italic">{sample ? `e.g. ${sample}` : "(empty)"}</span>
                    </button>); })}</div></section>);
              })()}
              {studio.layers.length > 0 && (<section className="space-y-2"><h3 className="text-sm font-semibold">Layers ({studio.layers.length})</h3>
                <div className="space-y-1">{studio.layers.map((l) => (
                  <div key={l.id} onClick={() => studio.setActiveLayer(l.id)} className={cn("flex items-center gap-2 p-2 rounded-md cursor-pointer text-xs", studio.activeLayerId === l.id ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-muted/50")}>
                    <Type className="w-3 h-3 shrink-0 text-muted-foreground" />
                    <Input className="h-7 text-xs flex-1 bg-transparent border-0 px-1 focus-visible:ring-1" value={l.text} onChange={(e) => studio.updateLayer(l.id, { text: e.target.value })} onClick={(e) => e.stopPropagation()} />
                    <button onClick={(e) => { e.stopPropagation(); studio.removeLayer(l.id); }} className="text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>
                  </div>))}</div></section>
              )}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2"><PaletteIcon className="w-4 h-4" /> Color Palette</h3>
                <p className="text-[10px] text-muted-foreground leading-snug">Tip: <strong>double-click</strong> a text on the canvas, then <strong>select a word</strong> — clicking a color will only recolor that word.</p>
                <div className="grid grid-cols-8 gap-1.5">{COLOR_PALETTE.map((c) => (
                  <button key={c} className="aspect-square rounded-md ring-1 ring-border hover:scale-110 transition-transform" style={{ backgroundColor: c }}
                    onClick={() => { if (!studio.activeLayerId) return; const applied = applyStyleToSelection({ fill: c }, (id, updates) => studio.updateLayer(id, updates)); if (!applied) studio.updateLayer(studio.activeLayerId, { fill: c }); }} />
                ))}</div>
                <input type="color" className="w-full h-8 rounded-md cursor-pointer bg-transparent border border-border"
                  onChange={(e) => { if (!studio.activeLayerId) return; const applied = applyStyleToSelection({ fill: e.target.value }, (id, updates) => studio.updateLayer(id, updates)); if (!applied) studio.updateLayer(studio.activeLayerId, { fill: e.target.value }); }} />
              </section>
              <section className="space-y-2"><h3 className="text-sm font-semibold">Font Library</h3>
                {FONT_LIBRARY.map((cat) => (<div key={cat.category} className="space-y-1"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{cat.category}</div>
                  <div className="grid grid-cols-2 gap-1">{cat.fonts.map((f) => (
                    <button key={f} onMouseEnter={() => loadGoogleFont(f)} onClick={() => { loadGoogleFont(f); if (!studio.activeLayerId) return; const applied = applyStyleToSelection({ fontFamily: f }, (id, updates) => studio.updateLayer(id, updates)); if (!applied) studio.updateLayer(studio.activeLayerId, { fontFamily: f }); }}
                      className="text-xs px-2 py-1.5 rounded border border-border hover:bg-muted text-left truncate" style={{ fontFamily: f }} title={f}>{f}</button>
                  ))}</div></div>))}
              </section>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ★ NEW: SHAPES TAB */}
        <TabsContent value="shapes" className="flex-1 overflow-hidden m-0 min-h-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <input ref={svgRef} type="file" accept=".svg,image/svg+xml" multiple className="hidden" onChange={(e) => handleSvgUpload(e.target.files)} />
              <Button variant="outline" className="w-full" onClick={() => svgRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Upload SVG Shape
              </Button>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Upload <code className="px-1 py-0.5 bg-muted rounded">.svg</code> files to add shapes, icons, or decorative elements on top of your design. Move, resize, and rotate them on the canvas.
              </p>

              {studio.svgElements.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Shapes on Canvas ({studio.svgElements.length})</h3>
                  <div className="space-y-2">
                    {studio.svgElements.map((el) => {
                      const isActive = studio.activeSvgId === el.id;
                      // Create a tiny preview data URL
                      const previewUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(el.svgContent)))}`;
                      return (
                        <div
                          key={el.id}
                          onClick={() => studio.setActiveSvgId(el.id)}
                          className={cn(
                            "rounded-md border p-2 cursor-pointer transition-all",
                            isActive ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border hover:bg-muted/50"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-10 h-10 rounded bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden border border-border">
                              <img src={previewUrl} alt={el.name} className="w-8 h-8 object-contain" />
                            </div>
                            <span className="text-xs font-medium truncate flex-1">{el.name}</span>
                            <div className="flex gap-0.5 shrink-0">
                              <button onClick={(e) => { e.stopPropagation(); studio.duplicateSvgElement(el.id); toast.success("Duplicated"); }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Duplicate">
                                <Copy className="w-3 h-3" />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); studio.removeSvgElement(el.id); }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title="Delete">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* Show controls when active */}
                          {isActive && (
                            <div className="mt-3 space-y-2 pt-2 border-t border-border animate-fade-in">
                              <div className="space-y-1">
                                <Label className="text-xs flex items-center justify-between">
                                  Opacity <span className="text-muted-foreground">{Math.round(el.opacity * 100)}%</span>
                                </Label>
                                <Slider value={[el.opacity]} min={0} max={1} step={0.05}
                                  onValueChange={(v) => studio.updateSvgElement(el.id, { opacity: v[0] })} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs flex items-center justify-between">
                                  Rotation <span className="text-muted-foreground">{Math.round(el.angle)}°</span>
                                </Label>
                                <div className="flex gap-2 items-center">
                                  <Slider value={[el.angle]} min={0} max={360} step={1} className="flex-1"
                                    onValueChange={(v) => studio.updateSvgElement(el.id, { angle: v[0] })} />
                                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Reset rotation"
                                    onClick={() => studio.updateSvgElement(el.id, { angle: 0 })}>
                                    <RotateCw className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div><Label className="text-xs">W</Label>
                                  <Input type="number" className="h-8 text-xs" value={Math.round(el.width)}
                                    onChange={(e) => studio.updateSvgElement(el.id, { width: Number(e.target.value) || 50 })} /></div>
                                <div><Label className="text-xs">H</Label>
                                  <Input type="number" className="h-8 text-xs" value={Math.round(el.height)}
                                    onChange={(e) => studio.updateSvgElement(el.id, { height: Number(e.target.value) || 50 })} /></div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Color Override</Label>
                                <div className="flex gap-2">
                                  <input type="color" value={el.fill ?? "#ffffff"}
                                    onChange={(e) => studio.updateSvgElement(el.id, { fill: e.target.value })}
                                    className="w-10 h-8 rounded cursor-pointer bg-transparent border border-border" />
                                  {el.fill && (
                                    <Button size="sm" variant="ghost" className="h-8 text-xs"
                                      onClick={() => studio.updateSvgElement(el.id, { fill: null })}>
                                      Reset
                                    </Button>
                                  )}
                                </div>
                                <p className="text-[10px] text-muted-foreground">Changes all colors in the SVG to one color.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {studio.svgElements.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Hexagon className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No shapes yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Upload SVG files to add decorative shapes, icons, and elements to your design.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* EFFECTS TAB */}
        <TabsContent value="effects" className="flex-1 overflow-hidden m-0 min-h-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">Text Effects</h3>
              {(!studio.activeLayerId) && (<p className="text-xs text-muted-foreground">Select a text layer to apply effects.</p>)}
              {studio.activeLayerId && (() => {
                const l = studio.layers.find((x) => x.id === studio.activeLayerId)!;
                const Toggle = ({ k, label }: { k: keyof typeof l.effects; label: string }) => (
                  <button onClick={() => studio.updateLayer(l.id, { effects: { ...l.effects, [k]: !l.effects[k] } })}
                    className={cn("w-full flex items-center justify-between p-3 rounded-md border transition-all", l.effects[k] ? "border-primary bg-primary/10 shadow-glow" : "border-border hover:bg-muted/50")}>
                    <span className="text-sm font-medium">{label}</span>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", l.effects[k] ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l.effects[k] ? "ON" : "OFF"}</span>
                  </button>);
                return (<div className="space-y-2"><Toggle k="shadow" label="Drop Shadow" /><Toggle k="glow" label="Glow" /><Toggle k="stroke" label="Stroke / Outline" />
                  {l.effects.stroke && (<div className="pl-3 space-y-2 border-l-2 border-primary">
                    <div className="flex items-center gap-2"><span className="text-xs w-20">Color</span><input type="color" value={l.strokeColor} onChange={(e) => studio.updateLayer(l.id, { strokeColor: e.target.value })} className="flex-1 h-8 rounded border border-border" /></div>
                    <div className="flex items-center gap-2"><span className="text-xs w-20">Width</span><input type="range" min={0} max={20} value={l.strokeWidth} onChange={(e) => studio.updateLayer(l.id, { strokeWidth: Number(e.target.value) })} className="flex-1" /><span className="text-xs w-8 text-right">{l.strokeWidth}</span></div>
                  </div>)}</div>);
              })()}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* TEMPLATES TAB */}
        <TabsContent value="templates" className="flex-1 overflow-hidden m-0 min-h-0 data-[state=inactive]:hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <section className="space-y-2"><h3 className="text-sm font-semibold">My Templates</h3>
                <div className="flex gap-2"><Input placeholder="Template name…" className="h-8 text-xs" value={tplName} onChange={(e) => setTplName(e.target.value)} />
                  <Button size="sm" variant="secondary" className="h-8 shrink-0" onClick={() => { if (studio.layers.length === 0) { toast.error("Add some text layers first"); return; } studio.saveCurrentAsTemplate(tplName); setTplName(""); toast.success("Template saved"); }}>Save</Button></div>
                {studio.savedTemplates.length === 0 ? (<p className="text-[11px] text-muted-foreground italic">No saved templates yet.</p>) : (
                  <div className="space-y-1">{studio.savedTemplates.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50">
                      <button onClick={() => { studio.applySavedTemplate(t.id); toast.success(`Applied: ${t.name}`); }} className="flex-1 text-left text-xs font-medium truncate">{t.name}</button>
                      <span className="text-[10px] text-muted-foreground shrink-0">{t.layers.length} layer{t.layers.length === 1 ? "" : "s"}</span>
                      <button onClick={() => { studio.deleteSavedTemplate(t.id); toast.success("Deleted"); }} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="w-3 h-3" /></button>
                    </div>))}</div>)}
              </section>
              <section className="space-y-2 pt-2 border-t border-border"><h3 className="text-sm font-semibold">Smart Templates</h3>
                <div className="grid grid-cols-2 gap-2">{TEMPLATES.map((t) => (
                  <button key={t.id} onClick={() => { studio.applyTemplate(t.layers); toast.success(`Applied: ${t.name}`); }}
                    className="aspect-[4/5] rounded-md p-3 flex flex-col justify-end text-left text-white text-xs font-semibold ring-1 ring-border hover:ring-primary hover:shadow-glow transition-all" style={{ background: t.preview }}>{t.name}</button>
                ))}</div>
              </section>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  );
}