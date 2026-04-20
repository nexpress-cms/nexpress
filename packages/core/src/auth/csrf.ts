const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function verifyCsrf(
  method: string,
  cookieToken: string | undefined,
  headerToken: string | undefined,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) {
    return true;
  }

  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}
