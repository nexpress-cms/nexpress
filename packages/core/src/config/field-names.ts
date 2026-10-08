export function getFlattenedFieldName(prefix: string[], name: string): string {
  if (prefix.length === 0) {
    return toCamelCase(name);
  }

  return `${prefix.map(toPascalCase).join("")}${toPascalCase(name)}`.replace(/^./u, (char) =>
    char.toLowerCase(),
  );
}

export function toCamelCase(value: string): string {
  const parts = splitName(value);
  const [first = "", ...rest] = parts;
  return `${first}${rest.map(capitalize).join("")}`;
}

export function toPascalCase(value: string): string {
  return splitName(value).map(capitalize).join("");
}

function splitName(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
