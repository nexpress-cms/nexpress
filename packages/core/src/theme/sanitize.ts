export function sanitizeTokenValue(value: string): string {
  return value
    .replace(/[;{}]/g, "")
    .replace(/url\s*\(/gi, "")
    .replace(/expression\s*\(/gi, "")
    .replace(/@import/gi, "")
    .slice(0, 200);
}
