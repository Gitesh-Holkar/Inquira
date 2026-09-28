import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, withUserTx } from "@/db/client";
import { leads } from "@/modules/leads/schema";
import { contacts } from "@/modules/contacts/schema";
import { integrations, integrationSecrets, organizations } from "@/modules/core/schema";
import { mcpTokens } from "@/modules/mcp/schema";
import { priceEntries, productGrades, products } from "@/modules/catalog/schema";
import { addMember, createOrg, createUser, expectDbError, resetDb } from "./helpers/db";

async function seedLead(orgId: string, ref: string) {
  const [l] = await getDb()
    .insert(leads)
    .values({ orgId, source: "manual", sourceRef: ref, createdBy: "system:test", contactName: `Lead ${ref}` })
    .returning();
  return l!;
}

describe("Row Level Security: org isolation", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user in org A cannot read or modify org B's data", async () => {
    const orgA = await createOrg("Org A");
    const orgB = await createOrg("Org B");
    const alice = await createUser("alice@example.com");
    const bob = await createUser("bob@example.com");
    await addMember(orgA.id, alice, "sales");
    await addMember(orgB.id, bob, "sales");
    const leadA = await seedLead(orgA.id, "a-1");
    const leadB = await seedLead(orgB.id, "b-1");
    await getDb().insert(contacts).values({ orgId: orgB.id, name: "Secret B contact", createdBy: "system:test" });

    await withUserTx(alice.id, async (tx) => {
      const visible = await tx.select().from(leads);
      expect(visible.map((l) => l.id)).toEqual([leadA.id]);
      expect(await tx.select().from(contacts)).toHaveLength(0);
      const orgs = await tx.select().from(organizations);
      expect(orgs.map((o) => o.id)).toEqual([orgA.id]);

      // Updating B's lead silently matches zero rows under RLS.
      const upd = await tx.update(leads).set({ contactName: "hacked" }).where(eq(leads.id, leadB.id)).returning();
      expect(upd).toHaveLength(0);
    });

    // Inserting into org B is rejected by the WITH CHECK policy.
    await expectDbError(withUserTx(alice.id, (tx) =>
        tx.insert(leads).values({ orgId: orgB.id, source: "manual", sourceRef: "evil", createdBy: "human:x" }),
      ), /row-level security/i);

    const [still] = await getDb().select().from(leads).where(eq(leads.id, leadB.id));
    expect(still!.contactName).toBe("Lead b-1");
  });

  it("a user with no membership sees nothing", async () => {
    const org = await createOrg();
    await seedLead(org.id, "x");
    const stranger = await createUser();
    const rows = await withUserTx(stranger.id, (tx) => tx.select().from(leads));
    expect(rows).toHaveLength(0);
  });

  it("viewers cannot write; sales cannot manage MCP tokens", async () => {
    const org = await createOrg();
    const viewer = await createUser();
    const sales = await createUser();
    await addMember(org.id, viewer, "viewer");
    await addMember(org.id, sales, "sales");
    await expectDbError(withUserTx(viewer.id, (tx) => tx.insert(leads).values({ orgId: org.id, source: "manual", sourceRef: "v", createdBy: "human:v" })), /row-level security/i);
    await expectDbError(withUserTx(sales.id, (tx) =>
        tx.insert(mcpTokens).values({ orgId: org.id, name: "t", tokenHash: "h", tokenPrefix: "p", createdBy: "human:s" }),
      ), /row-level security/i);
  });

  it("integration secrets are never readable by signed-in users", async () => {
    const org = await createOrg();
    const owner = await createUser();
    await addMember(org.id, owner, "owner");
    const [integ] = await getDb().insert(integrations).values({ orgId: org.id, provider: "gmail", createdBy: "system:test" }).returning();
    await getDb().insert(integrationSecrets).values({ orgId: org.id, integrationId: integ!.id, ciphertext: "x", createdBy: "system:test" });
    await expectDbError(withUserTx(owner.id, (tx) => tx.select().from(integrationSecrets)), /permission denied/i);
    // ...but the owner can read the non-secret integration status.
    expect(await withUserTx(owner.id, (tx) => tx.select().from(integrations))).toHaveLength(1);
  });

  it("price entries are append-only, even for the owner connection", async () => {
    const org = await createOrg();
    const db = getDb();
    const [p] = await db.insert(products).values({ orgId: org.id, name: "Pea Protein Isolate", createdBy: "system:test" }).returning();
    const [g] = await db.insert(productGrades).values({ orgId: org.id, productId: p!.id, name: "Standard", createdBy: "system:test" }).returning();
    const [pe] = await db
      .insert(priceEntries)
      .values({ orgId: org.id, gradeId: g!.id, pricePerKgInr: "350", priceBasis: "Ex-factory", gstPercent: "18", validFrom: "2026-09-29", createdBy: "system:test" })
      .returning();
    await expectDbError(db.update(priceEntries).set({ pricePerKgInr: "1" }).where(eq(priceEntries.id, pe!.id)), /append-only/);
    await expectDbError(db.delete(priceEntries).where(eq(priceEntries.id, pe!.id)), /append-only/);
  });

  it("every app table has RLS enabled", async () => {
    const rows = await getDb().execute<{ tablename: string; rowsecurity: boolean }>(
      sql`select tablename, rowsecurity from pg_tables where schemaname = 'app'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(26);
    expect(rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)).toEqual([]);
  });
});
