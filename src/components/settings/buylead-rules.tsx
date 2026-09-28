"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Textarea } from "@/components/ui/primitives";
import { saveBuyleadRulesAction } from "@/app/(app)/settings/actions";

export type BuyleadRulesView = {
  productTerms: { productId: string | null; productName: string; terms: string[] }[];
  excludedTerms: string[];
  allowedCountries: string[];
  allowedStates: string[];
  excludedStates: string[];
  minQuantityKg: string | null;
  maxQuantityKg: string | null;
  dailyCap: number;
  testMode: boolean;
};

const list = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Products + match terms as editable text: one product per line, "Product: term, term". */
export function BuyleadRulesEditor({ rules, canEdit }: { rules: BuyleadRulesView; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const byName = new Map(rules.productTerms.map((p) => [p.productName, p.productId]));
  const productsText = rules.productTerms.map((p) => `${p.productName}: ${p.terms.join(", ")}`).join("\n");
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const productTerms = String(f.get("products") ?? "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const idx = l.indexOf(":");
            const productName = (idx >= 0 ? l.slice(0, idx) : l).trim();
            const terms = idx >= 0 ? l.slice(idx + 1) : "";
            return { productId: byName.get(productName) ?? null, productName, terms: list(terms.toLowerCase()) };
          });
        const num = (k: string) => (String(f.get(k) ?? "").trim() ? Number(f.get(k)) : null);
        start(async () => {
          const r = await saveBuyleadRulesAction({
            productTerms,
            excludedTerms: list(String(f.get("excluded") ?? "").toLowerCase()),
            allowedCountries: list(String(f.get("countries") ?? "")),
            allowedStates: list(String(f.get("allowedStates") ?? "")),
            excludedStates: list(String(f.get("excludedStates") ?? "")),
            minQuantityKg: num("minQty"),
            maxQuantityKg: num("maxQty"),
            dailyCap: Number(f.get("dailyCap") ?? 0),
            testMode: f.get("testMode") === "on",
          });
          if (r.ok) {
            setErrors({});
            toast.success("Buy-lead rules saved");
          } else {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
          }
        });
      }}
    >
      <Alert
        tone={rules.testMode ? "info" : "warning"}
        title={
          rules.testMode
            ? "Test mode is ON — the Cowork task only logs “would contact” and never clicks."
            : "Live mode — the Cowork task clicks “Contact Buyer Now” (uses IndiaMART credits)."
        }
      >
        The ready-to-paste Cowork prompt is in docs/COWORK_INDIAMART_TASK.md. It reads these rules through MCP (get_buylead_rules).
      </Alert>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="testMode" defaultChecked={rules.testMode} disabled={!canEdit} className="size-4" /> Test mode (read-only, no clicking)
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Daily click cap" htmlFor="bl-cap" error={errors.dailyCap} hint="Each click uses IndiaMART credits">
          <Input id="bl-cap" name="dailyCap" type="number" min={0} max={200} defaultValue={rules.dailyCap} disabled={!canEdit} />
        </Field>
        <Field label="Min quantity (kg)" htmlFor="bl-min" error={errors.minQuantityKg}>
          <Input id="bl-min" name="minQty" type="number" min={0} step="any" defaultValue={rules.minQuantityKg ?? ""} disabled={!canEdit} />
        </Field>
        <Field label="Max quantity (kg)" htmlFor="bl-max" error={errors.maxQuantityKg}>
          <Input id="bl-max" name="maxQty" type="number" min={0} step="any" defaultValue={rules.maxQuantityKg ?? ""} disabled={!canEdit} />
        </Field>
      </div>
      <Field
        label="Products and match terms (one product per line: “Product: term, term”)"
        htmlFor="bl-products"
        hint="Terms are matched case-insensitively against the Buy Lead title, e.g. “pea isolate protein” = “pea protein isolate”."
      >
        <Textarea id="bl-products" name="products" rows={10} defaultValue={productsText} disabled={!canEdit} className="font-mono text-xs" />
      </Field>
      <Field label="Exclude leads containing (comma separated)" htmlFor="bl-ex">
        <Textarea id="bl-ex" name="excluded" rows={2} defaultValue={rules.excludedTerms.join(", ")} disabled={!canEdit} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Allowed countries" htmlFor="bl-c" hint="India only for now">
          <Input id="bl-c" name="countries" defaultValue={rules.allowedCountries.join(", ")} disabled={!canEdit} />
        </Field>
        <Field label="Only these states (empty = all)" htmlFor="bl-as">
          <Input id="bl-as" name="allowedStates" defaultValue={rules.allowedStates.join(", ")} disabled={!canEdit} />
        </Field>
        <Field label="Never these states" htmlFor="bl-xs">
          <Input id="bl-xs" name="excludedStates" defaultValue={rules.excludedStates.join(", ")} disabled={!canEdit} />
        </Field>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save rules"}</Button>
        </div>
      ) : null}
    </form>
  );
}
