export function stripCodeFences(input: string): string {
  if (!input) return "";
  const s = String(input).trim();
  const fenceRe = /```[ \t]*([a-z0-9_-]+)?\s*\n?([\s\S]*?)\n?```/i;
  const m = fenceRe.exec(s);
  if (m) return (m[2] ?? "").trim();
  return s
    .replace(/^```[^\n]*\n?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}
