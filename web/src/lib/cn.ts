/** Minimal class join (the Aqua components only need falsy-filtering, no Tailwind merge). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
