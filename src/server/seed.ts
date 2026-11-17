import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { getDb, withSystemTx } from "@/db/client";
import { audit } from "@/modules/core/audit";
import { getIntegrationInternal } from "@/modules/core/service";
import { memberships, organizations, orgSettings } from "@/modules/core/schema";
import type { Ctx } from "@/modules/core/types";
import { countProducts, createProductInternal, productMatcherCatalog } from "@/modules/catalog/service";
import { applyPriceListImport, savePriceListMap } from "@/modules/catalog/price-list-service";
import { planCounts } from "@/modules/catalog/price-list";
import { ensureDefaultTemplatesInternal } from "@/modules/templates/service";
import { seedRulesFromCatalogInternal } from "@/modules/buyleads/service";

type SeedProduct = { name: string; category: string | null; gst_percent: number | null; pack_size: string | null; grades: string[]; aliases: string[]; website_urls?: string[]; source: string; notes?: string | null };
/** Optional `settings.json` in the seed folder: the company's name and quotation terms. */
type SeedSettings = { org_name?: string; payment_terms?: string; default_price_basis?: string; quote_validity_days?: number };

export type SeedOptions = {
  /** Overrides `org_name` in the seed folder's settings.json. */
  orgName?: string;
  ownerUserId: string;
  ownerEmail: string;
  /** Folder with the company's data: products.json, and optionally settings.json, price-list-map.json and price-lists/*.txt. */
  seedDir: string;
  log?: (s: string) => void;
};

function slugify(s: string) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/**
 * Idempotent: safe to run twice. Creates the organisation, owner membership, catalogue, templates, rules
 * and integration rows from one seed folder. Rates come from the newest file in `price-lists/`, read
 * through the same import the Rates screen uses, so a seed and a later import can never disagree.
 * Throws if the folder's own price list has a line that cannot be written (seed data must be clean).
 */
export async function seed(opts: SeedOptions) {
  const log = opts.log ?? (() => {});
  const dir = opts.seedDir;
  const file = (name: string) => path.join(dir, name);
  const settings: SeedSettings = existsSync(file("settings.json")) ? JSON.parse(readFileSync(file("settings.json"), "utf8")) : {};
  const orgName = opts.orgName ?? settings.org_name;
  if (!orgName) throw new Error(`No organisation name: set SEED_ORG_NAME or "org_name" in ${file("settings.json")}`);
  const db = getDb();
  const slug = slugify(orgName);

  let [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  if (!org) {
    [org] = await db.insert(organizations).values({ name: orgName, slug, createdBy: "system:seed" }).returning();
    await db.insert(orgSettings).values({
      orgId: org!.id, createdBy: "system:seed", features: { gmail: true, tradeindia: true, quotes: true, buyleads: true, mcp: true },
      paymentTerms: settings.payment_terms ?? null,
      ...(settings.default_price_basis ? { defaultPriceBasis: settings.default_price_basis } : {}),
      ...(settings.quote_validity_days ? { quoteValidityDays: settings.quote_validity_days } : {}),
    });
    log(`Created organisation "${orgName}" (${org!.id})`);
  } else log(`Organisation exists (${org.id})`);
  const ctx: Ctx = { orgId: org!.id, actor: { kind: "system", job: "seed" } };

  await withSystemTx(async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, opts.ownerUserId)));
    if (!m) {
      await tx.insert(memberships).values({ orgId: ctx.orgId, userId: opts.ownerUserId, email: opts.ownerEmail, role: "owner", createdBy: "system:seed" });
      await audit(tx, ctx, { action: "org.create", entityType: "organization", entityId: ctx.orgId, changes: { name: orgName, owner: opts.ownerEmail } });
      log(`Owner membership added for ${opts.ownerEmail.replace(/^(.).*(@.*)$/, "$1***$2")}`);
    }
    await getIntegrationInternal(tx, ctx.orgId, "gmail");
    await getIntegrationInternal(tx, ctx.orgId, "tradeindia");
    await ensureDefaultTemplatesInternal(tx, ctx);
  });

  const hasCatalog = await withSystemTx((tx) => countProducts(tx, ctx.orgId));
  if (!hasCatalog) {
    const productsJson = JSON.parse(readFileSync(file("products.json"), "utf8")) as { products: SeedProduct[] };
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
    log(`Imported ${productsJson.products.length} products`);
  } else log(`Catalog already has ${hasCatalog} products; skipped`);

  const [current] = await db.select({ map: orgSettings.priceListMap }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
  if (!current?.map && existsSync(file("price-list-map.json"))) {
    const saved = await savePriceListMap(ctx, { map: JSON.parse(readFileSync(file("price-list-map.json"), "utf8")) });
    log(`Saved the price list mapping (${saved.headings} headings, ${saved.lines} named lines)`);
  }

  const countRates = async () => (await db.execute<{ n: number }>(sql`select count(*)::int as n from app.price_entries where org_id = ${ctx.orgId}`))[0]?.n ?? 0;
  const lists = existsSync(file("price-lists")) ? readdirSync(file("price-lists")).filter((f) => f.endsWith(".txt")).sort() : [];
  if ((await countRates()) === 0 && lists.length) {
    const latest = lists[lists.length - 1]!;
    const { plan, counts } = await applyPriceListImport(ctx, { text: readFileSync(path.join(dir, "price-lists", latest), "utf8") });
    if (planCounts(plan).problems) throw new Error(`Seed price list ${latest} has lines that cannot be written. Run: npm run rates:import -- ${path.join(dir, "price-lists", latest)}`);
    log(`Imported ${counts.ratesWritten} rates from price list ${latest}`);
  }

  await withSystemTx(async (tx) => seedRulesFromCatalogInternal(tx, ctx, await productMatcherCatalog(tx, ctx.orgId)));
  log(`Done. Price entries: ${await countRates()}`);
  return { orgId: ctx.orgId };
}
