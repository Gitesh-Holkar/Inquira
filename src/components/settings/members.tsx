"use client";
import { useState, useTransition } from "react";
import { Copy, KeyRound, Link2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert, Badge, Field, Input, Select } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { changeMemberRoleAction, createSignInLinkAction, inviteMemberAction, removeMemberAction, setMemberAccessAction } from "@/app/(app)/settings/actions";
import { ABILITIES, abilitiesFor, withRequirements, type AbilityId } from "@/modules/core/permissions";
import type { Role } from "@/modules/core/types";

export type MemberView = { id: string; userId: string; email: string; role: Role; granted: string[]; revoked: string[]; createdAt: string };

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", sales: "Sales", qa: "QA", accounts: "Accounts", viewer: "Viewer" };
const ROLE_ORDER: Role[] = ["owner", "admin", "sales", "qa", "accounts", "viewer"];
const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including members and owners",
  admin: "Everything except managing owners and admins",
  sales: "Leads, quotations, review queue",
  qa: "Product documents (COA, TDS, MSDS); sees everything else",
  accounts: "Sees leads, quotations, prices and documents; no settings",
  viewer: "Can look, cannot change anything",
};
const privileged = (r: Role) => r === "owner" || r === "admin";

/**
 * Settings → Members. `accountKind` says how a new person signs in (null: this deployment cannot create
 * sign-in accounts, so adding is hidden and the reason shown). The same rules are enforced by the service.
 */
export function Members({ members, me, myRole, canManage, accountKind, loginUrl }: {
  members: MemberView[]; me: string; myRole: Role; canManage: boolean; accountKind: "supabase" | "local" | "dev" | null; loginUrl: string;
}) {
  const [pending, start] = useTransition();
  const [added, setAdded] = useState<{ email: string; kind: "supabase" | "local" | "dev"; link: string | null } | null>(null);
  const assignable = ROLE_ORDER.filter((r) => myRole === "owner" || !privileged(r));
  const mayTouch = (m: MemberView) => canManage && m.userId !== me && (myRole === "owner" || !privileged(m.role));

  return (
    <div className="grid gap-4">
      {canManage && accountKind ? (
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const email = String(f.get("email") ?? "");
          start(async () => {
            const r = await inviteMemberAction({ email, role: String(f.get("role")) as Role });
            if (!r.ok) return void toast.error(r.error);
            toast.success(`${email} added`);
            setAdded({ email: email.trim().toLowerCase(), kind: r.data.accountKind, link: r.data.setupLink });
            form.reset();
          });
        }}>
          <Field label="Email address" htmlFor="m-email"><Input id="m-email" name="email" type="email" required autoComplete="off" placeholder="name@company.com" /></Field>
          <Field label="Role" htmlFor="m-role">
            <Select id="m-role" name="role" defaultValue="sales">{assignable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
          </Field>
          <Button type="submit" disabled={pending}><UserPlus />Add member</Button>
        </form>
      ) : null}
      {canManage && !accountKind ? (
        <Alert tone="warning" title="Adding people is not set up on this site">Add SUPABASE_SERVICE_ROLE_KEY to the hosting settings (docs/SETUP.md section 2), then redeploy.</Alert>
      ) : null}
      {added ? (
        <Alert tone="success" title={`Next step for ${added.email}`}>
          {added.kind === "supabase"
            ? <>Send them this: open {loginUrl}, click “Forgot password? / First time here?”, enter {added.email}, and set a password from the email that arrives.</>
            : added.kind === "local" && added.link
              ? <SignInLink url={added.link} text={`Send ${added.email} this link. It lets them set a password once and works for 7 days:`} />
              : <>They can sign in now on this computer with the development sign-in.</>}
        </Alert>
      ) : null}

      <ul className="grid gap-2" aria-label="Members">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{m.email}{m.userId === me ? <span className="font-normal text-muted"> (you)</span> : null}</p>
              <p className="text-xs text-muted">Added {formatDate(m.createdAt)} · {ROLE_HELP[m.role]}</p>
              {m.role !== "owner" && m.granted.length + m.revoked.length ? <Badge tone="info" className="mt-1">Custom access</Badge> : null}
            </div>
            {mayTouch(m) ? (
              <>
                <Select aria-label={`Role of ${m.email}`} className="w-36" value={m.role} disabled={pending} onChange={(e) => {
                  const role = e.target.value as Role;
                  start(async () => {
                    const r = await changeMemberRoleAction(m.id, role);
                    if (r.ok) toast.success(`${m.email} is now ${ROLE_LABEL[role]}${m.granted.length + m.revoked.length ? "; custom access was reset to the role's defaults" : ""}`); else toast.error(r.error);
                  });
                }}>
                  {ROLE_ORDER.filter((r) => r === m.role || assignable.includes(r)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
                {m.role !== "owner" ? <AccessButton member={m} /> : null}
                {accountKind === "local" ? <NewLinkButton member={m} /> : null}
                <ConfirmDialog danger title={`Remove ${m.email}?`} confirmLabel="Remove member"
                  description="They lose access at their next click. Everything they did stays in the history. You can add them again later."
                  trigger={<Button variant="outline" size="sm" disabled={pending} aria-label={`Remove ${m.email}`}><UserMinus />Remove</Button>}
                  onConfirm={() => start(async () => {
                    const r = await removeMemberAction(m.id);
                    if (r.ok) toast.success(`${m.email} removed`); else toast.error(r.error);
                  })} />
              </>
            ) : <Badge>{ROLE_LABEL[m.role]}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Settings → Members → Access: the abilities this member has, switchable one by one on top of their role.
 * Ticking an ability that needs another (for example "See settings") ticks that one too; the server
 * applies the same rule and refuses abilities the person editing does not have.
 */
function AccessButton({ member }: { member: MemberView }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const defaults = abilitiesFor(member.role);
  const current = abilitiesFor(member.role, member.granted, member.revoked);
  const [on, setOn] = useState<Set<AbilityId>>(current);
  const groups = [...new Set(ABILITIES.map((a) => a.group))];
  const toggle = (id: AbilityId, checked: boolean) => setOn((prev) => {
    const next = new Set(prev);
    if (checked) return withRequirements([...next, id]);
    next.delete(id);
    for (const a of ABILITIES) if ("requires" in a && a.requires === id) next.delete(a.id); // nothing that needs it stays on
    return next;
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setOn(current); }}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Access of ${member.email}`}><KeyRound />Access</Button>
      <DialogContent title={`Access for ${member.email}`} description={`Starts from the ${ROLE_LABEL[member.role]} role. Everyone can always open the dashboard, leads, quotations, rates, documents and templates.`}>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
          {groups.map((g) => (
            <fieldset key={g} className="grid gap-1">
              <legend className="mb-1 text-sm font-semibold">{g}</legend>
              {ABILITIES.filter((a) => a.group === g).map((a) => (
                <label key={a.id} className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <input type="checkbox" className="size-4" checked={on.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
                  <span className="min-w-0 flex-1">{a.label}</span>
                  {on.has(a.id) !== defaults.has(a.id) ? <Badge tone="info">{on.has(a.id) ? "Added" : "Taken away"}</Badge> : null}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setOn(new Set(defaults))}>Back to role defaults</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending} onClick={() => start(async () => {
              const r = await setMemberAccessAction(member.id, [...on]);
              if (r.ok) { toast.success(`Access saved for ${member.email}`); setOpen(false); } else toast.error(r.error);
            })}>{pending ? "Saving…" : "Save access"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignInLink({ url, text }: { url: string; text: string }) {
  return (
    <span className="mt-1 grid gap-2">
      <span>{text}</span>
      <span className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 text-xs">{url}</code>
        <Button type="button" variant="outline" size="sm" onClick={async () => {
          try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Couldn't copy. Select the link and copy it."); }
        }}><Copy />Copy link</Button>
      </span>
    </span>
  );
}

/** Local sign-in: a fresh one-time link for this member (new member who lost the first link, or a forgotten password). */
function NewLinkButton({ member }: { member: MemberView }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  return (
    <Dialog open={!!link} onOpenChange={(o) => { if (!o) setLink(null); }}>
      <Button variant="outline" size="sm" disabled={pending} aria-label={`New sign-in link for ${member.email}`} onClick={() => start(async () => {
        const r = await createSignInLinkAction(member.id);
        if (r.ok) setLink(r.data.url); else toast.error(r.error);
      })}><Link2 />Sign-in link</Button>
      <DialogContent title={`Sign-in link for ${member.email}`} description="Use it once to set a new password. It works for 7 days and replaces any earlier link. Their current password keeps working until they use it.">
        {link ? <SignInLink url={link} text="Send this link to them:" /> : null}
      </DialogContent>
    </Dialog>
  );
}

