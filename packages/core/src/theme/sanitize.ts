export function sanitizeTokenValue(value: string): string {
  const withoutControlCharacters = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("");

  return withoutControlCharacters
    .replace(/[;{}]/g, "")
    .replace(/\\|\/\*|\*\//g, "")
    .replace(/(?:url|image-set|src)\s*\(/gi, "")
    .replace(/expression\s*\(/gi, "")
    .replace(/@import/gi, "")
    .slice(0, 200);
}
