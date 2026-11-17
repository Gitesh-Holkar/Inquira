"use client";
import { useState, useTransition } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, Badge, Field, Input, Select } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { changeMemberRoleAction, inviteMemberAction, removeMemberAction } from "@/app/(app)/settings/actions";

type Role = "owner" | "admin" | "sales" | "viewer";
export type MemberView = { id: string; userId: string; email: string; role: Role; createdAt: string };

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", sales: "Sales", viewer: "Viewer" };
const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including members and owners",
  admin: "Everything except owners and admins",
  sales: "Leads, quotations, review queue, documents (view)",
  viewer: "Can look, cannot change anything",
};
const privileged = (r: Role) => r === "owner" || r === "admin";

/**
 * Settings → Members. `accountKind` says how a new person signs in (null: this deployment cannot create
 * sign-in accounts, so adding is hidden and the reason shown). The same rules are enforced by the service.
 */
export function Members({ members, me, myRole, canManage, accountKind, loginUrl }: {
  members: MemberView[]; me: string; myRole: Role; canManage: boolean; accountKind: "supabase" | "local" | null; loginUrl: string;
}) {
  const [pending, start] = useTransition();
  const [added, setAdded] = useState<{ email: string; kind: "supabase" | "local" } | null>(null);
  const assignable = (Object.keys(ROLE_LABEL) as Role[]).filter((r) => myRole === "owner" || !privileged(r));
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
            setAdded({ email: email.trim().toLowerCase(), kind: r.data.accountKind });
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
            : <>They can sign in now on this computer with the development sign-in.</>}
        </Alert>
      ) : null}

      <ul className="grid gap-2" aria-label="Members">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{m.email}{m.userId === me ? <span className="font-normal text-muted"> (you)</span> : null}</p>
              <p className="text-xs text-muted">Added {formatDate(m.createdAt)} · {ROLE_HELP[m.role]}</p>
            </div>
            {mayTouch(m) ? (
              <>
                <Select aria-label={`Role of ${m.email}`} className="w-36" value={m.role} disabled={pending} onChange={(e) => {
                  const role = e.target.value as Role;
                  start(async () => {
                    const r = await changeMemberRoleAction(m.id, role);
                    if (r.ok) toast.success(`${m.email} is now ${ROLE_LABEL[role]}`); else toast.error(r.error);
                  });
                }}>
                  {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => r === m.role || assignable.includes(r)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
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
