import { types } from "node:util";

export interface NpSiteBuildBrowserRequestPolicyV1 {
  documentPaths: string[];
  imagePaths: string[];
  imageWidths: number[];
  imageQualities: number[];
  /** Exact read-only hydration URLs from the installed Forum route projection. */
  readRequests?: string[];
  /** Exact static metadata URLs freshly observed from the compiled Next owner. */
  metadataRequests?: string[];
}

/**
 * Keep this function self-contained: its exact source is installed in the
 * browser as well as called by the host CDP boundary. Policy is a detached DTO
 * from requireSiteBuildBrowserRequestPolicyV1, never an executable callback.
 */
export function isSiteBuildBrowserRequestAllowedV1(
  value: string,
  method: string,
  origin: string,
  allowedPaths: readonly string[],
  policy?: NpSiteBuildBrowserRequestPolicyV1,
): boolean {
  try {
    if (
      typeof value !== "string" ||
      value.length > 8192 ||
      typeof method !== "string" ||
      !["GET", "HEAD"].includes(method.toUpperCase()) ||
      typeof origin !== "string" ||
      !Array.isArray(allowedPaths)
    )
      return false;
    const base = new URL(origin);
    if (
      base.origin !== origin ||
      base.href !== `${origin}/` ||
      base.protocol !== "http:" ||
      base.hostname !== "127.0.0.1" ||
      base.username ||
      base.password
    )
      return false;
    const canonicalPath = (path: string): boolean => {
      if (
        typeof path !== "string" ||
        path.length < 1 ||
        path.length > 2048 ||
        !path.startsWith("/") ||
        path.startsWith("//") ||
        path.includes("\\") ||
        path.includes("?") ||
        path.includes("#")
      )
        return false;
      const parsed = new URL(path, origin);
      if (parsed.href !== origin + path || parsed.search || parsed.hash) return false;
      for (const segment of path.split("/")) {
        const decoded = decodeURIComponent(segment);
        if (
          decoded === "." ||
          decoded === ".." ||
          decoded.includes("/") ||
          decoded.includes("\\") ||
          decoded.includes("%") ||
          Array.from(decoded).some(
            (character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
          )
        )
          return false;
      }
      return true;
    };
    const parsed = new URL(value, origin);
    if (
      (value.startsWith("/") ? parsed.href !== origin + value : parsed.href !== value) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      value.includes("#") ||
      !canonicalPath(parsed.pathname)
    )
      return false;
    if (
      ["GET", "HEAD"].includes(method.toUpperCase()) &&
      policy?.metadataRequests?.includes(parsed.pathname + parsed.search)
    )
      return /^\/icon\.svg\?icon\.[A-Za-z0-9_-]{1,128}\.svg$/u.test(
        parsed.pathname + parsed.search,
      );
    if (
      method.toUpperCase() === "GET" &&
      policy?.readRequests?.includes(parsed.pathname + parsed.search)
    ) {
      const slug = "[a-z][A-Za-z0-9_-]{0,63}";
      const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
      const target = `targetType=${slug}&targetId=${uuid}`;
      return (
        parsed.pathname + parsed.search === "/api/members/me" ||
        parsed.pathname + parsed.search === "/api/notifications?count=1" ||
        new RegExp(
          `^/api/collections/${slug}/${uuid}/comments\\?order=oldest&limit=20&offset=0$`,
          "u",
        ).test(parsed.pathname + parsed.search) ||
        new RegExp(`^/api/reactions\\?${target}&kind=like$`, "u").test(
          parsed.pathname + parsed.search,
        ) ||
        new RegExp(`^/api/(?:follows/check|engagement)\\?${target}$`, "u").test(
          parsed.pathname + parsed.search,
        ) ||
        new RegExp(`^/api/community/events\\?scope=document&${target}$`, "u").test(
          parsed.pathname + parsed.search,
        )
      );
    }
    if (!parsed.search)
      return parsed.href === origin + parsed.pathname && allowedPaths.includes(parsed.pathname);
    if (!policy) return false;
    if (policy.documentPaths.includes(parsed.pathname)) {
      // Next 16 uses a 96-bit SHA256 base64url token, a 1..5 base36
      // legacy token, or an empty bare marker. No other query data survives.
      if (/^\?_rsc(?:=(?:[A-Za-z0-9_-]{16}|[a-z0-9]{1,5}))?$/u.test(parsed.search)) return true;
    }
    if (parsed.pathname !== "/_next/image") return false;
    const pairs = parsed.search.slice(1).split("&");
    if (pairs.length !== 3) return false;
    const parameters: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const pair of pairs) {
      const equals = pair.indexOf("=");
      if (equals < 1) return false;
      const key = pair.slice(0, equals);
      if (!["url", "w", "q"].includes(key) || Object.hasOwn(parameters, key)) return false;
      parameters[key] = pair.slice(equals + 1);
    }
    if (
      Object.keys(parameters).length !== 3 ||
      !/^[1-9][0-9]{0,15}$/u.test(parameters.w) ||
      !/^[1-9][0-9]{0,2}$/u.test(parameters.q)
    )
      return false;
    const image = decodeURIComponent(parameters.url);
    return (
      encodeURIComponent(image) === parameters.url &&
      canonicalPath(image) &&
      policy.imagePaths.includes(image) &&
      policy.imageWidths.includes(Number(parameters.w)) &&
      policy.imageQualities.includes(Number(parameters.q))
    );
  } catch {
    return false;
  }
}

/** Exact host-side transport owner. No getters, proxies, callbacks or shared input objects survive. */
export function requireSiteBuildBrowserRequestPolicyV1(
  value: unknown,
): NpSiteBuildBrowserRequestPolicyV1 {
  const fail = (): never => {
    throw new TypeError("Invalid Build browser request policy");
  };
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value))
    return fail();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const keys = [
    "documentPaths",
    "imagePaths",
    "imageWidths",
    "imageQualities",
    "readRequests",
    "metadataRequests",
  ] as const;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ![4, 5, 6].includes(ownKeys.length) ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key as (typeof keys)[number]))
  )
    return fail();
  const field = (key: (typeof keys)[number], max: number): unknown[] => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return fail();
    const data: unknown = descriptor.value;
    if (
      data === null ||
      typeof data !== "object" ||
      types.isProxy(data) ||
      !Array.isArray(data) ||
      Object.getPrototypeOf(data) !== Array.prototype
    )
      return fail();
    const length = Object.getOwnPropertyDescriptor(data, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > max
    )
      return fail();
    if (Reflect.ownKeys(data).length !== length.value + 1) return fail();
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index++) {
      const entry = Object.getOwnPropertyDescriptor(data, String(index));
      if (!entry || !entry.enumerable || !("value" in entry)) return fail();
      result.push(entry.value);
    }
    return result;
  };
  const paths = (key: "documentPaths" | "imagePaths", max: number): string[] => {
    const result = field(key, max);
    if (
      result.some(
        (path) =>
          typeof path !== "string" ||
          !isSiteBuildBrowserRequestAllowedV1(path, "GET", "http://127.0.0.1:18080", [path]),
      )
    )
      return fail();
    if (new Set(result).size !== result.length) return fail();
    return result as string[];
  };
  const numbers = (
    key: "imageWidths" | "imageQualities",
    max: number,
    ceiling: number,
  ): number[] => {
    const result = field(key, max);
    if (
      result.some(
        (number) =>
          typeof number !== "number" ||
          !Number.isSafeInteger(number) ||
          number < 1 ||
          number > ceiling,
      ) ||
      new Set(result).size !== result.length
    )
      return fail();
    return result as number[];
  };
  const result: NpSiteBuildBrowserRequestPolicyV1 = {
    documentPaths: paths("documentPaths", 200),
    imagePaths: paths("imagePaths", 4096),
    imageWidths: numbers("imageWidths", 64, Number.MAX_SAFE_INTEGER),
    imageQualities: numbers("imageQualities", 100, 100),
  };
  if (Object.hasOwn(value, "readRequests")) {
    const requests = field("readRequests", 1602);
    if (
      new Set(requests).size !== requests.length ||
      requests.some(
        (path) =>
          typeof path !== "string" ||
          !isSiteBuildBrowserRequestAllowedV1(path, "GET", "http://127.0.0.1:18080", [], {
            ...result,
            readRequests: [path],
          }),
      )
    )
      return fail();
    result.readRequests = requests as string[];
  }
  if (Object.hasOwn(value, "metadataRequests")) {
    const requests = field("metadataRequests", 1);
    if (
      requests.some(
        (path) =>
          typeof path !== "string" || !/^\/icon\.svg\?icon\.[A-Za-z0-9_-]{1,128}\.svg$/u.test(path),
      )
    )
      return fail();
    result.metadataRequests = requests as string[];
  }
  return result;
}
