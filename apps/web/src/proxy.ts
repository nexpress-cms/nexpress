// Next 16 middleware — thin wrapper over the framework-shared
// implementation. The `config` literal stays inline because Next's
// build statically parses the exported `config` and rejects a
// re-export. The proxy function itself is the framework's; apps/web
// and every scaffolded site run byte-identical CSRF / rate-limit /
// security-header / i18n logic.
// Multi-node rate limiting replaces this re-export with npCreateProxy({
// rateLimiter }); see docs/rate-limiting.md.
export { proxy } from "@nexpress/app/proxy";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
