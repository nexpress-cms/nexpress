/** Synthetic transport fixture; server correlation is verified in route tests. */
export function errorDiagnosticsHeaders(
  status: number,
  code: string,
  recovery: "retry-read" | "reauthenticate" | "reconcile" | "check-outcome" | "none",
) {
  return {
    "x-np-error-diagnostics": JSON.stringify({
      version: 1,
      status,
      code,
      supportReference: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recovery,
    }),
  };
}
