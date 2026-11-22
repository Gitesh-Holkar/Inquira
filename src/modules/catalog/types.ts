import { z } from "zod";

export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), "Enter an amount like 350 or 350.50");

export const percentString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 28, "GST % must be between 0 and 28");

export const rateUpdateItem = z.object({
  gradeId: z.string().uuid(),
  pricePerKgInr: moneyString,
  gstPercent: percentString,
  priceBasis: z.string().trim().min(1).max(80),
  moqKg: z.union([moneyString, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  packSize: z.string().trim().max(40).nullish().transform((v) => v || null),
  needsConfirmation: z.boolean().default(false),
  note: z.string().trim().max(500).nullish().transform((v) => v || null),
  /** Negotiation range (G-KB-3). `undefined` keeps the grade's current range; null or "" clears it. */
  floorPerKgInr: z.union([moneyString, z.literal(""), z.null()]).optional().transform((v) => (v === undefined ? undefined : v || null)),
  ceilingPerKgInr: z.union([moneyString, z.literal(""), z.null()]).optional().transform((v) => (v === undefined ? undefined : v || null)),
}).superRefine((i, c) => {
  if (i.floorPerKgInr && Number(i.floorPerKgInr) > Number(i.pricePerKgInr)) c.addIssue({ code: "custom", path: ["floorPerKgInr"], message: "The lowest price can't be above the price" });
  if (i.ceilingPerKgInr && Number(i.ceilingPerKgInr) < Number(i.pricePerKgInr)) c.addIssue({ code: "custom", path: ["ceilingPerKgInr"], message: "The highest price can't be below the price" });
});

export const updateRatesInput = z.object({
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Optional last day these rates apply (G-KB-3). After it, the grade has no current rate and quotes stop. */
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  items: z.array(rateUpdateItem).min(1).max(500),
});

/**
 * Sample policy (GOAL G-KB-5), stored in org_settings.sample_policy. Which products offer samples is
 * `products.sample_available`. Nothing is assumed: an empty size holds every sample reply for a person.
 */
export const samplePolicySchema = z.object({
  /** Free sample size as the company states it, e.g. "250 g" or "1 kg". */
  freeSampleSize: z.string().trim().max(60).nullable().default(null),
  /** What the buyer must send before a sample goes out, e.g. "Company name", "GST number", "Delivery address". */
  requiredDetails: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  /** Who pays for courier, or anything else the reply should say. */
  note: z.string().trim().max(300).nullable().default(null),
});
export type SamplePolicy = z.output<typeof samplePolicySchema>;

export type CurrentRate = {
  productId: string;
  productName: string;
  category: string | null;
  gradeId: string;
  gradeName: string;
  priceEntryId: string | null;
  pricePerKgInr: string | null;
  gstPercent: string | null;
  gstInclusive: boolean;
  priceBasis: string | null;
  moqKg: string | null;
  packSize: string | null;
  validFrom: string | null;
  needsConfirmation: boolean;
  validTo: string | null;
  floorPerKgInr: string | null;
  ceilingPerKgInr: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};
