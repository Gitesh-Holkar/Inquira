"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound, PlugZap, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui/primitives";
import { formatDateTime, formatRelative } from "@/lib/format";
import { removeAiKeyAction, saveAiTierAction, testAiTierAction } from "@/app/(app)/settings/actions";

export type AiTierView = {
  tier: "basic" | "advanced"; enabled: boolean; hasKey: boolean; provider: string; model: string; baseUrl: string; threshold: number;
  dailyLimit: number; status: string; lastError: string | null; lastErrorAt: string | null; lastSuccessAt: string | null; backoffUntil: string | null; usedToday: number;
};
export type AiProviderView = { id: string; label: string; needsBaseUrl: boolean };

const ABOUT = {
  basic: {
    title: "Basic AI",
    what: "Finds the product when the name in the enquiry matches no alias, and fills what the buyer wants and the quantity in kg.",
    privacy: "Before every call Inquira removes email addresses, phone numbers, links, the buyer's name, company and city. Only the product and requirement text and your product names are sent, so a free-tier key (for example Gemini from Google AI Studio) is fine.",
  },
  advanced: {
    title: "Advanced AI",
    what: "Does what Basic could not settle, and sorts emails that are waiting in Emails → Review (enquiry, conversation, not a buyer).",
    privacy: "Sees the text of review emails, including the sender's details. Use a paid API key whose terms keep your data private (for example a Claude API key).",
  },
} as const;

export function AiTierCard({ t, providers, canManage }: { t: AiTierView; providers: AiProviderView[]; canManage: boolean }) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [provider, setProvider] = useState(t.provider);
  const [pending, start] = useTransition();
  const about = ABOUT[t.tier];
  const needsBase = providers.find((p) => p.id === provider)?.needsBaseUrl ?? false;
  const state = !t.hasKey ? { label: "No key", tone: "neutral" as const }
    : !t.enabled ? { label: "Off", tone: "neutral" as const }
    : t.backoffUntil ? { label: "Paused after an error", tone: "warning" as const }
    : t.status === "error" || t.status === "reauth_required" ? { label: "Error", tone: "danger" as const }
    : t.status === "connected" ? { label: "On", tone: "success" as const }
    : { label: "On, not tested yet", tone: "warning" as const };

  return (
    <Card>
      <CardHeader><CardTitle>{about.title}</CardTitle><Badge tone={state.tone}>{state.label}</Badge></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1 text-sm">
          <p>{about.what}</p>
          <p className="text-muted">{about.privacy}</p>
          <p className="text-muted">Used today: {t.usedToday} of {t.dailyLimit} calls.{t.lastSuccessAt ? ` Last answer ${formatRelative(t.lastSuccessAt)}.` : ""}</p>
          {t.backoffUntil ? <p className="text-warning">Waiting until {formatDateTime(t.backoffUntil)} before trying again. Until then its work goes to the next step.</p> : null}
          {t.lastError ? <p className="break-words text-danger">Last error{t.lastErrorAt ? ` (${formatRelative(t.lastErrorAt)})` : ""}: {t.lastError}</p> : null}
        </div>
        {canManage ? (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const get = (k: string) => String(fd.get(k) ?? "").trim();
            start(async () => {
              const r = await saveAiTierAction({
                tier: t.tier, enabled: fd.get("enabled") === "on", provider: get("provider") as "gemini", model: get("model"),
                baseUrl: get("baseUrl"), threshold: Number(get("threshold")), dailyLimit: Number(get("dailyLimit")), apiKey: get("apiKey") || undefined,
              });
              if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
              setErrors({});
              (e.target as HTMLFormElement).querySelector<HTMLInputElement>("input[name=apiKey]")!.value = "";
              toast.success("Saved. Click Test connection to check the key and model.");
            });
          }}>
            <Field label="Provider" htmlFor={`ai-${t.tier}-provider`} error={errors.provider}>
              <Select id={`ai-${t.tier}-provider`} name="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Model name" htmlFor={`ai-${t.tier}-model`} error={errors.model} hint="Exactly as the provider lists it. Changing it needs no update to Inquira.">
              <Input id={`ai-${t.tier}-model`} name="model" defaultValue={t.model} required autoComplete="off" maxLength={100} />
            </Field>
            {needsBase ? (
              <Field label="Provider address" htmlFor={`ai-${t.tier}-base`} error={errors.baseUrl} hint="For example https://api.openai.com/v1" className="sm:col-span-2">
                <Input id={`ai-${t.tier}-base`} name="baseUrl" type="url" defaultValue={t.baseUrl} required autoComplete="off" />
              </Field>
            ) : <input type="hidden" name="baseUrl" value="" />}
            <Field label="API key" htmlFor={`ai-${t.tier}-key`} error={errors.apiKey} hint={t.hasKey ? "Saved (hidden). Paste a new one to replace it." : "Paste the key from the provider's website."} className="sm:col-span-2">
              <Input id={`ai-${t.tier}-key`} name="apiKey" type="password" autoComplete="off" maxLength={500} />
            </Field>
            <Field label="Confidence needed (0.5 to 1)" htmlFor={`ai-${t.tier}-threshold`} error={errors.threshold} hint="Below this, the AI's answer is only a suggestion. 0.8 is a careful start.">
              <Input id={`ai-${t.tier}-threshold`} name="threshold" type="number" min="0.5" max="1" step="0.05" defaultValue={t.threshold} required />
            </Field>
            <Field label="Calls per day" htmlFor={`ai-${t.tier}-limit`} error={errors.dailyLimit} hint="Inquira stops at this number, whatever the provider allows.">
              <Input id={`ai-${t.tier}-limit`} name="dailyLimit" type="number" min="0" max="100000" step="1" defaultValue={t.dailyLimit} required />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="enabled" defaultChecked={t.enabled} className="size-4" /> Use {about.title} on new leads{t.tier === "advanced" ? " and review emails" : ""}
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={pending}><KeyRound />{pending ? "Saving…" : "Save"}</Button>
              <Button type="button" variant="outline" disabled={pending || !t.hasKey} onClick={() => start(async () => {
                const r = await testAiTierAction(t.tier);
                if (!r.ok) return void toast.error(r.error);
                if (r.data.ok && r.data.followedFormat) toast.success(r.data.message);
                else if (r.data.ok) toast.warning(r.data.message);
                else toast.error(r.data.message);
              })}><PlugZap />Test connection</Button>
              {t.hasKey ? (
                <ConfirmDialog danger title={`Remove the ${about.title} key?`} confirmLabel="Remove key"
                  description="The tier turns off. New leads go straight to the next step (the other tier, or Leads → Needs details)."
                  trigger={<Button type="button" variant="outline" disabled={pending}><Trash2 />Remove key</Button>}
                  onConfirm={() => start(async () => {
                    const r = await removeAiKeyAction(t.tier);
                    if (r.ok) toast.success("Key removed"); else toast.error(r.error);
                  })} />
              ) : null}
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AiIntro({ waitingLeads, anyOn }: { waitingLeads: number; anyOn: boolean }) {
  return (
    <Alert tone="info" title="How AI is used">
      Rules go first (product names and aliases, wording, units). What they cannot settle goes to Basic, then to Advanced, then to
      Leads → Needs details, where a person or Claude finishes it. AI only fills empty fields, never sends anything and never sets a price.
      {anyOn ? (waitingLeads ? ` ${waitingLeads} lead${waitingLeads === 1 ? " is" : "s are"} waiting for the next run (every 10 minutes).` : "") : " With both tiers off, Inquira works on rules alone."}
    </Alert>
  );
}
