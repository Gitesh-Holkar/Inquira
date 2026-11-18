/** Plain words for who filled a lead field (`filled_by` on the lead): alias, rule:…, ai:…, mcp:…, human:…. */
export function filledByLabel(by: string | undefined): string | null {
  if (!by) return null;
  if (by === "alias") return "matched by name";
  if (by.startsWith("rule:")) return "by rule";
  if (by === "ai:basic") return "by AI (Basic), check it";
  if (by === "ai:advanced") return "by AI (Advanced), check it";
  if (by.startsWith("mcp:")) return "by Claude";
  if (by.startsWith("human:")) return "by a team member";
  return null;
}
