import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { getDb, withSystemTx } from "@/db/client";
import { todayIST } from "@/lib/format";
import { audit } from "@/modules/core/audit";
import { getIntegrationInternal } from "@/modules/core/service";
import { memberships, organizations, orgSettings } from "@/modules/core/schema";
import type { Ctx } from "@/modules/core/types";
import { countProducts, createProductInternal, productMatcherCatalog, updateRates } from "@/modules/catalog/service";
import { productGrades, products } from "@/modules/catalog/schema";
import { ensureDefaultTemplatesInternal } from "@/modules/templates/service";
import { seedRulesFromCatalogInternal } from "@/modules/buyleads/service";

type SeedProduct = { name: string; category: string | null; gst_percent: number | null; pack_size: string | null; grades: string[]; aliases: string[]; website_urls?: string[]; source: string; notes?: string | null };
type SeedRate = { product: string; grade: string; price_inr_per_kg: number; gst_percent: number; pack_size: string; price_basis: string; moq_kg: number | null; needs_confirmation: boolean; notes: string | null; raw_line: string };

export type SeedOptions = { orgName: string; ownerUserId: string; ownerEmail: string; seedDir?: string; log?: (s: string) => void };

function slugify(s: string) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/** Idempotent: safe to run twice. Creates org, owner membership, catalog + rates, templates, rules, integration rows. */
export async function seed(opts: SeedOptions) {
  const log = opts.log ?? (() => {});
  const dir = opts.seedDir ?? path.join(process.cwd(), "seed");
  const db = getDb();
  const slug = slugify(opts.orgName);

  let [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  if (!org) {
    [org] = await db.insert(organizations).values({ name: opts.orgName, slug, createdBy: "system:seed" }).returning();
    await db.insert(orgSettings).values({ orgId: org!.id, createdBy: "system:seed", features: { gmail: true, tradeindia: true, quotes: true, buyleads: true, mcp: true } });
    log(`Created organisation "${opts.orgName}" (${org!.id})`);
  } else log(`Organisation exists (${org.id})`);
  const ctx: Ctx = { orgId: org!.id, actor: { kind: "system", job: "seed" } };

  await withSystemTx(async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, opts.ownerUserId)));
    if (!m) {
      await tx.insert(memberships).values({ orgId: ctx.orgId, userId: opts.ownerUserId, email: opts.ownerEmail, role: "owner", createdBy: "system:seed" });
      await audit(tx, ctx, { action: "org.create", entityType: "organization", entityId: ctx.orgId, changes: { name: opts.orgName, owner: opts.ownerEmail } });
      log(`Owner membership added for ${opts.ownerEmail.replace(/^(.).*(@.*)$/, "$1***$2")}`);
    }
    await getIntegrationInternal(tx, ctx.orgId, "gmail");
    await getIntegrationInternal(tx, ctx.orgId, "tradeindia");
    await ensureDefaultTemplatesInternal(tx, ctx);
  });

  const hasCatalog = await withSystemTx((tx) => countProducts(tx, ctx.orgId));
  if (!hasCatalog) {
    const productsJson = JSON.parse(readFileSync(path.join(dir, "products.json"), "utf8")) as { products: SeedProduct[] };
    const ratesJson = JSON.parse(readFileSync(path.join(dir, "rates.json"), "utf8")) as { rates: SeedRate[] };
    await withSystemTx(async (tx) => {
      let i = 0;
      for (const p of productsJson.products) {
        await createProductInternal(tx, ctx, {
          name: p.name, category: p.category, aliases: p.aliases, grades: p.grades.length ? p.grades : ["Standard"],
          defaultGstPercent: p.gst_percent === null ? null : String(p.gst_percent), defaultPackSize: p.pack_size,
          websiteUrl: p.website_urls?.[0] ?? null, sortOrder: i++, notes: p.notes ?? null,
        });
      }
    });
    const gradeRows = await db.select({ id: productGrades.id, grade: productGrades.name, product: products.name })
      .from(productGrades).innerJoin(products, eq(products.id, productGrades.productId)).where(eq(productGrades.orgId, ctx.orgId));
    const gradeId = new Map(gradeRows.map((g) => [`${g.product}::${g.grade}`, g.id]));
    const items = ratesJson.rates.map((r) => {
      const id = gradeId.get(`${r.product}::${r.grade}`);
      if (!id) throw new Error(`Seed rate has no matching grade: ${r.product} / ${r.grade}`);
      return {
        gradeId: id, pricePerKgInr: String(r.price_inr_per_kg), gstPercent: String(r.gst_percent), priceBasis: r.price_basis,
        moqKg: r.moq_kg === null ? null : String(r.moq_kg), packSize: r.pack_size, needsConfirmation: r.needs_confirmation,
        note: r.notes ? `${r.notes} (rates file: "${r.raw_line}")` : `Rates file: "${r.raw_line}"`,
      };
    });
    await updateRates(ctx, { validFrom: todayIST(), items });
    log(`Imported ${productsJson.products.length} products and ${items.length} rates`);
  } else log(`Catalog already has ${hasCatalog} products; skipped`);

  await withSystemTx(async (tx) => seedRulesFromCatalogInternal(tx, ctx, await productMatcherCatalog(tx, ctx.orgId)));
  const [{ n } = { n: 0 }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from app.price_entries where org_id = ${ctx.orgId}`);
  log(`Done. Price entries: ${n}`);
  return { orgId: ctx.orgId };
}
