# Architecture

## Goal

Render Codex work as a room-based "agent office" without depending on private internals. The current pass keeps the official Codex integration surface, but replaces the placeholder boxes with a real PixelOffice-based visual layer.

## Codex hook strategy

1. `codex app-server`

   Official docs describe `thread/start`, `thread/list`, `thread/read`, and a live notification stream for `turn/*`, `item/*`, approvals, command execution, and file changes. That makes it the best local integration surface for CLI, IDE, and app-originated threads.

   Source: [App Server](https://developers.openai.com/codex/app-server)

2. `codex cloud list --json`

   Codex web/cloud tasks are exposed through the CLI cloud surface. That gives us a supported way to surface web tasks next to local sessions.

   Source: [Codex web](https://developers.openai.com/codex/cloud)

3. Per-project room config

   Each project can define its own spatial hierarchy in `.codex-agents/rooms.xml`. Rooms map to directory prefixes so the same session can move between rooms as its working files change.

4. Per-project appearance roster

   New sessions get a deterministic random appearance. Overrides are stored in `.codex-agents/agents.json`, which locks their look until changed.

5. Codex subagent roles

   Codex ships with built-in subagents such as `default`, `worker`, and `explorer`, and custom agents can define `nickname_candidates` for more readable spawned names. The visual layer groups booths by the underlying role, while still showing the friendlier label when available.

   Source: [Subagents](https://developers.openai.com/codex/subagents)

## Why not only tail JSONL files?

Local session JSONL files are still useful as a fallback, and Codex can persist history/session data and export OTel logs. But app-server gives a cleaner normalized thread/item model first, with approvals and file changes already typed.

The live browser path now uses a hybrid approach:

- `thread/list` and `thread/read` stay authoritative for thread state
- watched thread JSONL paths trigger quick re-reads when a local session changes
- periodic discovery still runs so newly created sessions appear without a page refresh

That avoids attaching the visualization directly to a resumable thread connection, which keeps the observer sidecar separate from approval-routing concerns.

Sources:

- [Advanced configuration / telemetry](https://developers.openai.com/codex/config-advanced)
- [Configuration reference / history persistence](https://developers.openai.com/codex/config-reference)

## UI shape

- VS Code tab
  - left: room map
  - right: session inspector
  - actions: refresh, open/scaffold room XML, resume local thread, open cloud task, cycle appearance

- Terminal watcher
  - grouped by room
  - local thread state, last action, resume command
  - cloud task list

- Browser mode
  - fleet view across multiple configured project roots
  - deep-linkable single-project room view through `?project=<abs-path>`
  - live SSE updates for browser clients
  - map and terminal-style views through `?view=map|terminal`
  - current-workload mode by default, with history opt-in through `?history=1`
  - snapshot-only rendering through `?screenshot=1`
  - HTTP endpoints for snapshot refresh, room scaffolding, and appearance cycling
  - PixelOffice art served from `/assets/pixel-office/...`
  - auto-generated booth clusters inside each room based on the currently mapped agent set
  - repeated booth runs for repeated Codex agent roles
  - synthetic boss heartbeat for the server workspace when the live desktop thread is not surfaced by `codex app-server`

## Room XML

```xml
<agentOffice version="1">
  <room id="root" name="Project" path="." x="0" y="0" width="24" height="16">
    <room id="src" name="Source" path="src" x="1" y="1" width="11" height="6" />
    <room id="tests" name="Validation" path="tests" x="13" y="1" width="10" height="6" />
  </room>
</agentOffice>
```

`path` is interpreted as a project-relative directory prefix in this first version. Nested rooms allow local hierarchy without inventing a second config format.

## Pixel-agents takeaways

The closest open-source reference is [pixel-agents](https://github.com/pablodelucca/pixel-agents). The useful ideas to keep are:

- a host-specific adapter layer
- room/layout persistence separate from live activity state
- status driven by tool and transcript activity instead of only terminal focus
- lightweight NPC behavior where active agents stay at their desk while idle or blocked agents visibly break formation

The main change here is swapping transcript-only heuristics for Codex app-server + cloud surfaces first.

## Asset pipeline

- The runtime path uses the provided PNG sheets directly.
- The supplied `.aseprite` files are kept in the repo and can be inspected through `codex-agents-office aseprite inspect <file>`.
- Official Aseprite docs recommend exporting slice metadata into JSON via sprite sheet export or `--data`; that is the planned bridge from authored Aseprite assets into a richer scene manifest.

Sources:

- [Aseprite files](https://www.aseprite.org/docs/files)
- [Aseprite slices export](https://www.aseprite.org/docs/slices/)
