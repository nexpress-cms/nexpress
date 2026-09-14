# Agent context and handoffs

AGENTS.md contains startup rules, not a running changelog. Detailed guidance and
historical evidence remain available here without being automatically loaded as
instructions for every task.

## Reading order

1. Root AGENTS.md and the applicable nested AGENTS.md.
2. `current-handoff.md` when continuing pending work; verify its Git state.
3. Only the relevant reference section and feature contract/flow for the task.
4. Historical notes only when investigating an earlier decision or compatibility.

Search headings or keywords and read a bounded section. Do not concatenate all
references, design documents or history into each new thread or subagent brief.
Dated inventory and test counts are evidence of a checkpoint, not live state.

## Preserved history and guidance

The four original files were split at their first operational section on
2026-09-14. Their content was retained, with resolvable Markdown links rebased.
The compact AGENTS.md files provide common rules; applicable detailed rules in
these references still need to be read before modifying their area. Current user
instructions take precedence, and current feature contracts supersede older
implementation-status statements.

| Original                 | Implementation history            | Detailed guidance                     |
| ------------------------ | --------------------------------- | ------------------------------------- |
| Root AGENTS.md           | [Root history](history/root.md)   | [Root reference](reference/root.md)   |
| packages/core/AGENTS.md  | [Core history](history/core.md)   | [Core reference](reference/core.md)   |
| packages/admin/AGENTS.md | [Admin history](history/admin.md) | [Admin reference](reference/admin.md) |
| apps/web/AGENTS.md       | [Web history](history/web.md)     | [Web reference](reference/web.md)     |

## Starting the next task

Finish a coherent bundle, then update the [current handoff](current-handoff.md)
using the [template](handoff-template.md). Keep detailed results in the feature
flow document and link them. Replace stale handoff fields instead of appending a
chronological log. Do not include secrets, raw logs, full diffs or conversation
transcripts.

At the next user-requested task boundary, open a fresh thread with the repository,
handoff path and concrete objective. A fork copies old context and is not the
preferred way to reduce it. Pending uncommitted changes must stay in their actual
checkout; verify them before selecting a worktree or assuming a clean base.
This workflow does not authorize commits, PRs, merges or creation of a new task.

Suggested starting message:

```text
/Users/baesw/development/nexpress에서 작업해줘.
루트와 관련 하위 AGENTS.md, docs/agent-guidance/current-handoff.md를 읽고
실제 Git 상태를 검증해. 미커밋 변경을 보존하고 작업에 필요한 참조 절만 읽어.
이번 목표: <구체적인 작업 또는 승인한 머지 범위>
```

Moving instructions out of AGENTS.md reduces future startup context. It does not
remove messages or instructions already present in an existing conversation.
