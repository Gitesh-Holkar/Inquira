/**
 * Crawls the organisation's TradeIndia-built catalogue site and prints products that are
 * missing from seed/products.json (by URL). Read-only: it never writes to the database.
 *   WEBSITE_URL=https://www.stdmfood.com npm run seed:website
 */
import { readFileSync } from "node:fs";

const base = (process.env.WEBSITE_URL ?? "https://www.stdmfood.com").replace(/\/$/, "");
const pages = ["/products.html", "/sitemap.html", "/protein-derivatives.html", "/starch-derivatives.html",
  "/modified-starch-derivatives-.html", "/dextrins-fibers.html"];

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const found = new Map<string, string>();
for (const p of pages) {
  const res = await fetch(base + p, { headers: { "User-Agent": "Mozilla/5.0 (Inquira catalogue check)" } });
  if (!res.ok) { console.warn(`skip ${p}: HTTP ${res.status}`); continue; }
  const html = await res.text();
  for (const m of html.matchAll(/<a[^>]+href=["']((?:https?:\/\/[^/"']+)?\/[^"']*?-\d{6,}\.html)["'][^>]*>([\s\S]*?)<\/a>/g)) {
    const url = base + m[1]!.replace(/^https?:\/\/[^/]+/, "");
    const title = decode(m[2]!);
    if (title && title.length < 120 && !found.has(url)) found.set(url, title);
  }
}
const seed = JSON.parse(readFileSync("seed/products.json", "utf8")) as { products: { name: string; website_urls?: string[] }[] };
const known = new Set(seed.products.flatMap((p) => p.website_urls ?? []));
const missing = [...found].filter(([u]) => !known.has(u));
const gone = [...known].filter((u) => !found.has(u));
console.log(`Website lists ${found.size} product pages; seed knows ${known.size}.`);
console.log(missing.length ? "New on website (add via Catalog):\n" + missing.map(([u, t]) => `  ${t}  ${u}`).join("\n") : "No new products.");
if (gone.length) console.log("In seed but no longer listed:\n" + gone.map((u) => "  " + u).join("\n"));
