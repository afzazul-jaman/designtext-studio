import { createFileRoute } from "@tanstack/react-router";
import { Studio } from "@/studio/Studio";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DesignText — Bulk Design Studio" },
      { name: "description", content: "Canva-like bulk design tool. Upload images and CSV, design on canvas, generate hundreds of designs and export as ZIP." },
      { property: "og:title", content: "DesignText — Bulk Design Studio" },
      { property: "og:description", content: "Generate hundreds of on-brand designs in seconds with CSV-driven text layers." },
    ],
  }),
  component: IndexPage,
});

function IndexPage() {
  return (
    <>
      <Studio />
      <Toaster theme="dark" position="bottom-right" richColors />
    </>
  );
}
