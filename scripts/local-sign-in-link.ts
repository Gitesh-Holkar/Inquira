/**
 * Local sign-in: prints a one-time link to set a new password, for an owner who cannot sign in.
 * Run on the computer that runs Inquira:
 *   npm run local:sign-in-link -- you@example.com
 *   docker compose exec app npm run local:sign-in-link -- you@example.com
 * Only for members of the company. The link works once, for 7 days; the old password works until it is used.
 */
import { closeDb, withSystemTx } from "@/db/client";
import { appUrl } from "@/lib/env";
import { createSetupLink, findLocalUserByEmail } from "@/lib/local-auth";
import { audit } from "@/modules/core/audit";
import { membershipsForUserInternal } from "@/modules/core/service";

const email = (process.argv[2] ?? "").trim().toLowerCase();
let code = 1;
try {
  const user = email ? await findLocalUserByEmail(email) : null;
  const ms = user ? await withSystemTx((tx) => membershipsForUserInternal(tx, user.id)) : [];
  if (!email) console.error("Usage: npm run local:sign-in-link -- you@example.com");
  else if (!user || !ms.length) console.error(`${email} is not a member of this Inquira.`);
  else {
    const link = await createSetupLink(user.id, appUrl());
    await withSystemTx((tx) => audit(tx, { orgId: ms[0]!.orgId, actor: { kind: "system", job: "cli" } }, { action: "member.sign_in_link", entityType: "user", entityId: user.id, changes: { email, expires: link.expires.toISOString() } }));
    console.log(`Open this link to set a new password (works once, until ${link.expires.toISOString().slice(0, 10)}):\n${link.url}`);
    code = 0;
  }
} finally {
  await closeDb();
}
process.exit(code);
