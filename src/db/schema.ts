// Aggregates every module's tables for Drizzle (queries + drizzle-kit). Modules must not
// import each other's tables directly (brief §6.1); only src/db and the owning module do.
export * from "@/modules/core/schema";
export * from "@/modules/contacts/schema";
export * from "@/modules/leads/schema";
export * from "@/modules/email/schema";
export * from "@/modules/catalog/schema";
export * from "@/modules/templates/schema";
export * from "@/modules/quotes/schema";
export * from "@/modules/mcp/schema";
export * from "@/modules/buyleads/schema";
