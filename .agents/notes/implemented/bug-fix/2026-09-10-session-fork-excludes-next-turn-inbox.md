# Agent Note: Session fork excludes next-turn inbox

Status: implemented

English | [中文](2026-09-10-session-fork-excludes-next-turn-inbox.zh.md)

## Problem

Forking a middle turn copied the next turn's input into the child. A live log stores the next turn's `agent/inbox/spliced` insert between `turn/end` and the next `turn/start`, so the controller cut that advanced to the next `turn/start` included that insert. The child reconstructed it as queued `next-turn` work: forking turns 1-2 of a 3-turn session left turn 3's prompt queued, and sending one new prompt produced two queued messages.

## Decision

`SessionCommandController.fork` stops its trailing scan at the first `turn/start` or `agent/inbox/spliced` event. Trailing metadata after `turn/end` still belongs to the forked prefix and is included; an inbox splice in the same gap belongs to the next turn and is excluded. The seed therefore ends at the forked `turn/end` plus its trailing metadata, matching the `SessionStore.fork` cut.

## Testing

The `sessions.fork` host suite builds a three-turn source with a realistic inbox insert/claim pair per turn, forks the middle `turn/end`, and asserts the child contains only the first two turns plus `session/end-seed` with no `prompt 3` payload. Adjacent `SessionStore.fork`, controller create/fork failure, and client fork suites remain green.

## Alternatives considered

**Cut exactly at `boundary.seq + 1` with no trailing scan.** Rejected: stable log-only events appended after a closed turn (for example request metadata the `SessionStore.fork` suite pins) belong to the forked prefix and would be dropped.

**Strip inbox inserts from the seed after slicing.** Rejected: the cut is the lineage contract (`inheritedEventCount`); filtering after the fact keeps a cut that names events the child does not own.

**Treat only `next-turn` inserts as next-turn owned.** Rejected: every inbox splice in the `turn/end` to `turn/start` gap is queue management for a turn that has not started; singling out one target keeps the same leak for the other target.

## Consequences

Middle-turn forks contain no queued input from later turns; sending in the child starts one new turn. Last-turn forks are unchanged because no later inbox exists. Forks that previously carried a leaked queued message no longer do; already-forked children keep whatever they inherited.
