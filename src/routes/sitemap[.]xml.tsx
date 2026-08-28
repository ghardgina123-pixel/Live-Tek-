import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SITE_URL } from "@/lib/site";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/home", changefreq: "daily", priority: "0.9" },
          { path: "/lojas", changefreq: "daily", priority: "0.8" },
          { path: "/imoveis", changefreq: "daily", priority: "0.8" },
          { path: "/como-vender", changefreq: "monthly", priority: "0.8" },
          { path: "/ajuda", changefreq: "monthly", priority: "0.5" },
          { path: "/carrinho", changefreq: "monthly", priority: "0.3" },
          { path: "/checkout", changefreq: "monthly", priority: "0.3" },
          { path: "/chat", changefreq: "monthly", priority: "0.3" },
          { path: "/sobre", changefreq: "monthly", priority: "0.5" },
          { path: "/termos", changefreq: "yearly", priority: "0.3" },
          { path: "/login", changefreq: "monthly", priority: "0.4" },
          { path: "/cadastro", changefreq: "monthly", priority: "0.4" },
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${SITE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});