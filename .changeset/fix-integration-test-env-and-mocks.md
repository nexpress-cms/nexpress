---
"@nexpress/web": patch
---

fix(web/tests): apps/web integration tests no longer crash on `next/cache` + missing SITE_URL

CI's `apps/web#test:integration` job has been red on main since
the previous core integration failure unblocked (the core failure
hid these). Two distinct issues, one PR:

1. **`next/cache` outside Next runtime**. Route handlers that call
   `revalidateTag` / `revalidatePath` after a write (sites admin,
   theme settings, plugin config, setup wizard, active theme — 7
   routes total) crashed under vitest with
   `Invariant: static generation store missing`. The cache bust is
   a side-effect the route's own tests aren't trying to exercise.
   New `setup-next-cache-mock.ts` setupFile replaces `next/cache`
   with no-op stubs process-wide.

2. **Missing `SITE_URL` env**. `siteUrlStrict` (#598) refuses to
   build email-deliverable URLs from the request `Host` header,
   so password-reset / email-verify flows crashed when the env
   var was unset. `setup-env.ts` now sets a stable
   `http://localhost:3000` default when the env is absent.

After both fixes: apps/web integration is 645/650 (5 skipped), 0
failures.
