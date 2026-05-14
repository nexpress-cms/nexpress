/**
 * Roman numerals for the magazine's volume / issue chrome.
 * Walks the standard subtractive pairs (M, CM, D, CD, C, XC,
 * L, XL, X, IX, V, IV, I) so anything from 1 to 3999 renders
 * cleanly. `n <= 0` falls back to "I" — the masthead always
 * needs *something*.
 *
 * Lives here (not inline in header / post-list) so the two
 * callers stay in sync on cap and output format.
 */
export function toRoman(n: number): string {
  if (n <= 0) return "I";
  const pairs: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let value = n;
  let out = "";
  for (const [num, sym] of pairs) {
    while (value >= num) {
      out += sym;
      value -= num;
    }
  }
  return out;
}
