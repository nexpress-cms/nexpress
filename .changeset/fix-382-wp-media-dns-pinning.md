---
"@nexpress/wp-import": patch
---

Close the DNS-rebinding gap in the WordPress media downloader (#382).

`downloadMedia` resolved the source hostname with `dns.lookup` and rejected
private/loopback/link-local addresses, then handed the original hostname to
`fetch`, which re-resolved DNS at connect time. A host whose authoritative
DNS returned a public answer to the preflight check could rebind to a
private address by the time the actual request connected, leaving the
importer reachable to internal services even though literal private IPs
and well-formed private DNS answers were blocked.

The downloader now pins the vetted address on a per-request undici `Agent`
whose `connect.lookup` hook hands out the exact IP the preflight check
approved. Host header / SNI stay set to the original hostname, so HTTPS
cert validation still works. Each redirect hop re-runs the check and
re-pins the connect target. `allowPrivateHosts` skips both the check and
the pinning (unchanged behavior for self-hosted same-network deployments).
