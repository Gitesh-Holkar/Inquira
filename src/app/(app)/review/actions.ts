"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { createClassificationRule, submitEmailClassification } from "@/modules/email/service";
import { can } from "@/modules/core/permissions";

type Fields = { contactName?: string; companyName?: string; phone?: string; email?: string; city?: string; state?: string; country?: string; productText?: string; quantityText?: string };

export async function classifyAction(input: { emailId: string; classification: "inquiry" | "international" | "ignored" | "conversation"; lead?: Fields; ignoreRule?: { matchType: "sender_domain" | "sender_email"; pattern: string } | null; leadId?: string }) {
  const s = await requireSession("emails.classify");
  const r = await runAction(async () => {
    const lead = input.lead ? Object.fromEntries(Object.entries(input.lead).filter(([, v]) => v)) : undefined;
    const res = await submitEmailClassification(s.ctx, {
      emailId: input.emailId, classification: input.classification, confidence: "high", reason: "Reviewed by a team member", lead, leadId: input.leadId,
    });
    let rule = null;
    if (input.ignoreRule && input.classification === "ignored" && can(s.ctx, "rules.write")) {
      const r = input.ignoreRule;
      rule = await createClassificationRule(s.ctx, { name: `Ignore ${r.pattern}`, matchType: r.matchType, pattern: r.pattern, action: "ignore", priority: 100, enabled: true, applyToReviewQueue: true });
    }
    return { leadId: res.leadId, applied: rule?.applied ?? 0 };
  });
  revalidatePath("/review");
  revalidatePath("/leads");
  revalidatePath("/");
  return r;
}
