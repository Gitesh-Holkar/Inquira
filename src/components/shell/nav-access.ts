import type { Permission } from "@/modules/core/permissions";

/** The permission each main page needs; the layout uses it to show only pages a person may open. */
export const PAGE_PERMISSION: Record<string, Permission> = {
  "/": "dashboard.read", "/leads": "leads.read", "/review": "emails.read", "/rates": "catalog.read",
  "/documents": "documents.read", "/templates": "templates.read", "/indiamart": "buylead.decisions.read", "/settings": "settings.read",
};
