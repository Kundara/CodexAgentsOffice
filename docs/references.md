# References

## Codex

- [Codex App Server](https://developers.openai.com/codex/app-server)
  Primary local integration surface for threads, turns, items, approvals, and live notifications.
- [Codex Cloud](https://developers.openai.com/codex/cloud)
  Supported surface for Codex web/cloud task listing.
- [Codex IDE](https://developers.openai.com/codex/ide)
  Useful when aligning VS Code behavior with Codex session workflows.
- [Codex App Features](https://developers.openai.com/codex/app/features)
  Background for worktrees, app behavior, and multi-project workflows.
- [Codex Subagents](https://developers.openai.com/codex/subagents)
  Source for built-in roles, custom subagent definitions, and naming behavior.
- [Codex Advanced Configuration](https://developers.openai.com/codex/config-advanced)
  Telemetry and advanced runtime behavior reference.
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference)
  Persistence and history-related reference.

## Claude

- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
  Official session APIs, hook callback contracts, and SDK-managed Claude Code integration surface.
- [Claude Agent SDK TypeScript V2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
  Preview reference for `createSession()` / `resumeSession()` and the newer session lifecycle shape.
- [Claude API client SDKs](https://platform.claude.com/docs/en/api/client-sdks)
  Useful contrast with the Agent SDK: model API wrappers, not Claude Code session observability.
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
  Official hook lifecycle and input schema for `PermissionRequest`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, and related events.
- [Automate workflows with hooks](https://code.claude.com/docs/en/automate-workflows-with-hooks)
  Quickstart examples for wiring command hooks and project-local hook scripts.

## OpenClaw

- [OpenClaw repository](https://github.com/openclaw/openclaw)
  Primary upstream implementation and README for the Gateway, session model, and workspace configuration.
- [OpenClaw ACP bridge](https://github.com/openclaw/openclaw/blob/main/docs.acp.md)
  Clear explanation of Gateway-backed session routing, session keys such as `agent:main:main`, and the relationship between ACP sessions and Gateway sessions.

## Cursor

- [Cursor Background Agents](https://docs.cursor.com/en/background-agents)
  Product-level overview for remote background agents, follow-ups, takeover, and supported model constraints.
- [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent)
  Current product overview for remote cloud agents, follow-ups, takeover, and supported model constraints.
- [Cursor Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints)
  Current API entrypoint for listing agents, reading status, conversations, webhooks, repositories, and model metadata.
- [Cursor List Agents](https://cursor.com/docs/cloud-agent/api/endpoints)
  Primary endpoint for agent id, repo/ref, status, branch, summary, and target URLs.
- [Cursor Agent Conversation](https://cursor.com/docs/cloud-agent/api/endpoints)
  Official conversation-history endpoint for a single background agent.
- [Cursor Webhooks](https://cursor.com/docs/cloud-agent/api/webhooks)
  Status-change webhook contract and signing headers.
- [Cursor List Models](https://cursor.com/docs/cloud-agent/api/endpoints)
  Supported model identifiers for background-agent creation.
- [Cursor CLI](https://cursor.com/docs/cli/using)
  Official local CLI surface for listing and resuming prior Cursor Agent conversations.
- [Cursor API Keys](https://cursor.com/docs/advanced/api-keys)
  BYOK model and account-level API-key behavior.
- [Cursor community forum: recovered vanished chat](https://forum.cursor.com/t/how-i-recovered-my-vanished-cursor-chat-so-you-dont-have-to/151158)
  Useful field report showing the split between workspace sidebar state and the global Cursor conversation database when local chat history goes missing.
- [AgentBase Cursor message history notes](https://github.com/AgentOrchestrator/AgentBase/blob/5c26fc2935d4db34b801267af5994a14170f4f3f/docs/CURSOR_MESSAGE_HISTORY.md)
  Community reverse-engineering notes covering `agent-transcripts`, workspace `ItemTable`, and global `cursorDiskKV` storage layers.

## Visual / asset references

- [PixelOffice asset pack](https://2dpig.itch.io/)
  Source style reference for the office visuals used in this repo.
- Local source assets are intentionally not listed here with machine-specific paths.
  Keep any downloaded PixelOffice source files outside the repo and document them with repo-relative notes only if they become part of the shipped workflow.

## Aseprite

- [Aseprite file format docs](https://www.aseprite.org/docs/files)
- [Aseprite slices docs](https://www.aseprite.org/docs/slices/)

These matter because the long-term renderer should use authored slice/tag metadata where possible instead of ad-hoc coordinate guesses.

## PartyKit

- [PartyKit Quickstart](https://docs.partykit.io/quickstart/)
  Current create, local dev, and first deploy flow.
- [PartyKit CLI](https://docs.partykit.io/reference/partykit-cli/)
  Reference for `init`, `dev`, `deploy`, auth, and environment variable commands.
- [Deploy your PartyKit server](https://docs.partykit.io/guides/deploying-your-partykit-server/)
  Current deploy behavior, GitHub login flow, generated `partykit.dev` hostnames, and live log tailing.

## Adjacent inspiration

- [pixel-agents](https://github.com/pablodelucca/pixel-agents)
  Useful reference for sharper README structure, product framing, and “agent work you can actually see” presentation.
  Also a useful negative control: it stays observational over Claude JSONL transcripts and does not rely on a secret Claude integration surface.
- [Reddit: VS Code office-life extension inspiration](https://www.reddit.com/r/ClaudeCode/comments/1rbs0gx/i_built_a_vs_code_extension_that_turns_your/)
  Useful reference for hover-driven character details and “office life” framing.
