import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function collapseWhitespace(s: string): string {
  return s.replace(/[\t\r ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
