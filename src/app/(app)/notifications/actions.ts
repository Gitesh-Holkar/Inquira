"use server";
import { requireSession } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { listNotifications, markNotificationsSeen } from "@/modules/core/service";

/** Opens the bell: returns the latest notifications and marks them seen for this person. */
export async function openNotificationsAction() {
  const s = await requireSession("dashboard.read");
  const r = await runAction(() => listNotifications(s.ctx, { limit: 20 }));
  if (!r.ok) return r;
  await markNotificationsSeen(s.ctx, {});
  return { ok: true as const, items: r.data.items.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, at: n.createdAt.toISOString(), unread: !r.data.seenAt || n.createdAt > r.data.seenAt })) };
}
