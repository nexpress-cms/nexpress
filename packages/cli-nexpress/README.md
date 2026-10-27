# @nexpress/cli

Project-side `nexpress` CLI for plugins, themes, local feedback reports,
deployment planning, operations, release handoffs, runbooks, and extension
scaffolding.

Projects created by `create-nexpress` install this package automatically.
Custom hosts can add it directly:

```bash
pnpm add -D @nexpress/cli
pnpm exec nexpress --help
```

## Main command groups

- `nexpress plugin add|remove`
- `nexpress theme add|remove`
- `nexpress deploy plan`
- `nexpress feedback [--json]`
- `nexpress agent connect --client <codex|claude> --transport <stdio|http>`
- `nexpress site brief init|validate`, `site proposal validate`, `site catalog inspect`, `site directions validate`, `site skill install`
- `nexpress site renderer prepare`, `site direction render|validate`, `site fixture inspect`, `site seed source`, `site codegen source`, `site plan validate`, `site generate`, `site handoff export`
- `nexpress ops status|contracts|doctor|preflight|health`
- `nexpress ops backup|jobs|migrate|storage|plugins`
- `nexpress release check|plan|apply|verify`
- `nexpress runbook <name>`
- `nexpress create block-plugin|hook-plugin|route-plugin|page-plugin|admin-plugin|scheduled-plugin|theme`

Mutation commands expose dry-run or explicit approval gates where applicable.
Machine-facing workflows support stable `--json` and compact `--brief` output.

`nexpress agent connect` renders a secret-free Codex or Claude Code MCP plan.
With `--apply`, it writes only project-scoped client configuration and the
official NexPress Agent Skill. Stdio forwards `NP_AGENT_SERVICE_TOKEN` from the
client process environment without storing its value. Remote HTTP setup first
prints the exact loopback redirect URI for Agent Studio public-client
registration, then accepts the returned `--client-id` in a second run. The
command does not start clients, approve trust, or grant OAuth consent.

The experimental `nexpress site` namespace starts the local repository Build
workflow. It needs no Gateway connection or provider key:

```bash
pnpm exec nexpress site brief init --out .nexpress/site/brief.template.json
# Fill a separate brief.json, preserving unresolved product questions.
pnpm exec nexpress site brief validate --file .nexpress/site/brief.json --out .nexpress/site/brief.canonical.json
pnpm exec nexpress site proposal validate --brief .nexpress/site/brief.canonical.json --blueprint .nexpress/site/blueprint.json --out .nexpress/site/blueprint.proposal.json
pnpm exec nexpress site skill install --client codex       # read-only installation plan
pnpm exec nexpress site skill install --client codex --apply
```

Use `--client claude` for `.claude/skills/`; Codex uses `.agents/skills/`.
The installer preserves an existing custom skill. Artifact outputs are local,
create-only or byte-identical; revised content needs a new output filename.
Input files must be bounded, stable regular UTF-8 JSON, with no links. Paths
use a portable project-relative subset; artifact outputs stay below
`.nexpress/site/`, outside the reserved review/tmp/audit trees. Results are
JSON and contain a digest, validation scope and unresolved count where relevant.
Errors use fixed messages without repeating input prose or raw arguments.

`brief validate` and `proposal validate` establish proposal format and exact brief binding only. It does
not establish installed collection/block/pattern validity, privacy review,
render provenance, filesystem execution preconditions or approval. The template
deliberately contains unresolved questions, which block blueprint validation.
Brief/proposal/skill commands invoke no model, project script, database, worker,
Runtime or deployment. The rendering and generation operations below use their
own installed-owner, isolation and actual execution checks.

`nexpress site catalog inspect --config src/nexpress.config.ts --out
.nexpress/site/catalog.json` inspects the standard installed scaffold on macOS.
It copies observed application modules and installed dependency payloads into
an isolated worker with synthetic bindings, no inherited credentials, read-only
sources, no network and denied subprocesses. It returns configured declarations
for collections, themes, blocks, patterns, templates, plugins and locales with
a fresh installed-file fingerprint. It never boots services or runs plugin
setup. Unsupported hosts/layouts/component owners fail closed. This catalog
is not proof of live activation, render verification or an executable plan.

`site directions validate --brief .nexpress/site/brief.canonical.json --drafts
.nexpress/site/drafts.json --config src/nexpress.config.ts --out
.nexpress/site/drafts.validated.json` resolves three drafts against a fresh
installed catalog in the same isolated worker. It validates real block props,
complete pattern overrides, selected-theme templates and configured locales.
Use `npBuildInstalledBlockDefinitionFingerprintsV1` from the installed Core
agent-contract entry for the comparison's exact declared-theme definition
inventory. The result has `validationScope:"installed-directions"`,
`executable:false`, and `renderedImages:0`; trusted render/seal and generation
remain separate steps.

`site renderer prepare` builds a private Linux copy of the ordinary scaffold
with Docker. `site direction render` renders three drafts using fresh synthetic
PostgreSQL databases and Chromium, then seals their desktop/mobile previews.
`site direction validate` independently rerenders the sealed comparison.
`site plan validate` checks the selected blueprint against that live context.
Use `site --help` for the exact required artifact paths.

`site seed source` reads the provisional blueprint and actual native configured
seed owner, then returns the two fixed continuation sources as base64url bytes
with their hashes, intended paths and suggested staged paths. Review and stage
those bytes and add their observed create/update preconditions to the final file
plan. The source envelope does not stage files, run seeds or approve the plan.

For a collection change, `site codegen source` runs only the provisional
blueprint's fixed schema/migration commands in a disposable Linux copy. It
returns the actual changed generated files, modes, old/new hashes and bounded
source bytes. Review the SQL and add those exact command-owned paths and hashes
to the final file plan. The normal executor uses the same generation drivers
and reruns them independently. The probe retains its actual command audit,
cleans up the copy and publishes no repository source or database migration.

`site generate --brief <brief.json> --directions <sealed-set.json> --blueprint
<blueprint.json> --runtime <runtime.json> --out
.nexpress/site/review/final/generation.json` runs the reviewed commands and final
preview against a private candidate by default. It requires an existing ordinary
generated schema/migration baseline; it does not invent one from an incomplete
repository. The candidate uses synthetic data and a private database. Doctor
inspects the actual synthetic environment and preserves its full check results.
Failed commands retain bounded actual audit evidence before private cleanup.

Prepare the project's reviewed formatter, linter and test tools/configuration
before render preparation; generation never installs tools or treats a missing
test suite as a pass. Render/validate/fixture results expose the freshly observed
`commandRegistryFingerprint` needed to bind the blueprint. Native commands keep
a 15-minute limit; observer commands use the reviewed total budget up to one
hour, while every browser job retains its shorter fixed limit.

After reviewing the exact plan, add `--execute --acknowledge-plan <blueprint-hash>`
to publish the verified source delta. Interactive terminals also request that
exact hash; noninteractive callers provide both explicit arguments. The command
rechecks the comparison, source and installed owners for each run. Environment
changes require a new reviewed plan and fresh run. It preserves dirty files,
reports conflicts and possible partial publication, and performs no Git operation,
production migration, model/provider call, deployment or Runtime activation.
Before runtime observation, generation reports planned source precondition
conflicts with relative paths, expected/current/planned hashes and
`already-matches-plan`, `modified` or `missing` states. Matching final bytes do
not grant a no-op success or new verification. Review the files and prepare a
new reviewed comparison/plan before another generation; changing only the
output filename does not resolve a source conflict.

Generation outputs and retained evidence use the reserved review/audit trees.
Staged media with no allocated-ID upload owner is rejected before seed writes;
reference-only assets are retained without fetching or uploading.

`site handoff export` produces a reviewable local artifact with normal repository
continuation and deployment ownership. The local workflow remains experimental
until its complete R8 acceptance gate has passed; helper/unit results do not
establish that gate.

`nexpress feedback` runs the existing read-only Doctor locally and emits only
installed public NexPress package names/versions, bounded runtime identifiers,
and Doctor check IDs/states. Raw environment-variable values, filesystem paths,
database URLs, labels, details, hints, and logs are discarded. The report is
never uploaded; review the Markdown or `np.feedback-report.v1` JSON before
sharing it through the printed issue-form URL.

## Links

- [Agent-operated ops](https://github.com/nexpress-cms/nexpress/blob/main/docs/agent-operated-ops.md)
- [Agent Gateway](https://github.com/nexpress-cms/nexpress/blob/main/docs/agent-gateway.md)
- [Plugin quickstart](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-quickstart.md)
- [Deployment](https://github.com/nexpress-cms/nexpress/blob/main/docs/deployment.md)

## License

MIT
