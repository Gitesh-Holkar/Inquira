/**
 * Shows what a new price list would change, and writes it only when asked (GOAL G-KB-6).
 *
 *   npm run rates:import -- seed/stdm/price-lists/2026-11-16.txt             # print the changes, write nothing
 *   npm run rates:import -- <list.txt> --confirm                             # apply them
 *   npm run rates:import -- <list.txt> --map <map.json> [--save-map]         # use (and keep) another mapping
 *   npm run rates:import -- <list.txt> --org <slug>                          # when the database has several companies
 *
 * The list is plain text, one item per line ("Pea Isolate Protein - 350 Rs/Kg"), as copied from the
 * company's own document. The same check and the same write run behind Rates → Import price list.
 * Old rates stay in history; nothing is overwritten or removed. Uses DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { closeDb, withSystemTx } from "@/db/client";
import { publicMessage } from "@/lib/errors";
import { organizations } from "@/modules/core/schema";
import type { Ctx } from "@/modules/core/types";
import { describePlan, planCounts } from "@/modules/catalog/price-list";
import { applyPriceListImport, planPriceListImport, savePriceListMap } from "@/modules/catalog/price-list-service";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = args.find((a, i) => !a.startsWith("--") && !["--map", "--org"].includes(args[i - 1] ?? ""));

async function main() {
  if (!file) {
    console.error("Usage: npm run rates:import -- <price-list.txt> [--map <map.json>] [--save-map] [--org <slug>] [--confirm]");
    return 1;
  }
  const orgs = await withSystemTx((tx) => tx.select({ id: organizations.id, slug: organizations.slug, name: organizations.name }).from(organizations));
  const org = value("--org") ? orgs.find((o) => o.slug === value("--org")) : orgs.length === 1 ? orgs[0] : undefined;
  if (!org) {
    console.error(orgs.length ? `Choose a company with --org <slug>: ${orgs.map((o) => o.slug).join(", ")}` : "This database has no company yet. Run npm run db:seed first.");
    return 1;
  }
  const ctx: Ctx = { orgId: org.id, actor: { kind: "system", job: "rates-import" } };
  const input = { text: readFileSync(file, "utf8"), map: value("--map") ? JSON.parse(readFileSync(value("--map")!, "utf8")) : undefined };

  const plan = await planPriceListImport(ctx, input);
  console.log(`${org.name}\n${describePlan(plan)}\n`);
  const c = planCounts(plan);
  if (!flag("--confirm")) {
    console.log(`Nothing was written. To apply these ${c.toWrite} changes, run the same command with --confirm.`);
    return 0;
  }
  if (flag("--save-map") && input.map) await savePriceListMap(ctx, { map: input.map });
  if (!c.toWrite) {
    console.log("Nothing to write.");
    return 0;
  }
  const { counts } = await applyPriceListImport(ctx, input);
  console.log(`Written: ${counts.ratesWritten} rates, ${counts.productsCreated} new products, ${counts.gradesCreated} new grades, ${counts.gradesRenamed} grades renamed. Skipped: ${counts.skipped}.`);
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error(publicMessage(e).message);
} finally {
  await closeDb();
}
process.exit(code);
