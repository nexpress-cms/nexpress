export interface ForbiddenBuildWarning {
  id: "turbopack-nft-root-trace";
  needle: string;
  summary: string;
}

export const FORBIDDEN_BUILD_WARNINGS: ForbiddenBuildWarning[] = [
  {
    id: "turbopack-nft-root-trace",
    needle: "Encountered unexpected file in NFT list",
    summary:
      "Next/Turbopack traced the project root while building standalone output. Scope or hide runtime file access before shipping.",
  },
];

export function findForbiddenBuildWarnings(output: string): ForbiddenBuildWarning[] {
  return FORBIDDEN_BUILD_WARNINGS.filter((warning) => output.includes(warning.needle));
}

export function renderForbiddenBuildWarnings(warnings: ForbiddenBuildWarning[]): string {
  const lines = [
    "NexPress build guard blocked a successful `next build` because forbidden warnings were emitted.",
    "",
    ...warnings.flatMap((warning) => [
      `- ${warning.id}: ${warning.needle}`,
      `  ${warning.summary}`,
    ]),
  ];
  return lines.join("\n");
}
