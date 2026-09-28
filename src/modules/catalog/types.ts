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
});

export const updateRatesInput = z.object({
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items: z.array(rateUpdateItem).min(1).max(500),
});

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
  updatedBy: string | null;
  updatedAt: Date | null;
};
