---
source_type: docs
source_url: https://code.claude.com/docs/en/agent-sdk/typescript
source_title: Claude Agent SDK — TypeScript reference
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 4)
cycle_id: pass-a-bootstrap
---

# Claude Agent SDK (TypeScript) — Core surface

## query() — primary entry point

```ts
import { query, startup } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({ prompt: "your prompt" })) {
  console.log(message);
}

// Multi-turn streaming
const q = query({
  prompt: async function* () {
    yield { type: "user", message: { content: [{ type: "text", text: "first" }] } };
  },
  options: { /* see below */ }
});

// Pre-warm subprocess for lower latency
const warm = await startup({ options: { maxTurns: 3 } });
for await (const msg of warm.query("prompt")) { /* ... */ }
```

## Key options

```ts
{
  model: "claude-3-5-sonnet-20241022",
  thinking: { type: "adaptive" },
  effort: "high",                            // 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  tools: { type: "preset", preset: "claude_code" },
  allowedTools: ["Read", "Write", "Bash"],
  disallowedTools: ["dangerous_tool"],
  permissionMode: "default",                 // | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
  canUseTool: async (toolName, input, { signal, blockedPath }) => ({ behavior: "allow" }),
  systemPrompt: { type: "preset", preset: "claude_code", append: "...", excludeDynamicSections: true },
  mcpServers: { "my-server": { type: "stdio", command: "node", args: ["server.js"] } },
  cwd: "/path/to/project",
  persistSession: true,
  resume: "session-uuid",
  enableFileCheckpointing: true,
  maxTurns: 10,
  maxBudgetUsd: 1.00,
  abortController: new AbortController(),
}
```

## Subagents

```ts
const options = {
  agents: {
    "code-review": {
      description: "Reviews code changes",
      prompt: "You are a code reviewer...",
      tools: ["Read", "Grep"],
      model: "sonnet",
      maxTurns: 5,
      permissionMode: "default"
    },
    "researcher": {
      description: "Researches and summarizes topics",
      tools: ["WebSearch", "WebFetch"],
      maxTurns: 10,
      background: true               // non-blocking
    }
  }
};
```

## Hooks

Lifecycle: `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`. Each hook callback returns `{ continue, hookSpecificOutput }` to permit / block / inject context.

## Message types

```ts
for await (const msg of query({ prompt: "..." })) {
  if (msg.type === "system" && msg.subtype === "init") { /* tools, models, agents available */ }
  else if (msg.type === "assistant") { /* msg.message.content, msg.message.stop_reason */ }
  else if (msg.type === "result") {
    if (msg.subtype === "success") { console.log(msg.num_turns, msg.total_cost_usd, msg.structured_output); }
  }
}
```

## Sessions

`listSessions`, `getSessionMessages`, `getSessionInfo`, `renameSession`, `tagSession`. Resume via `options: { resume: sessionId }`.

## MCP custom tools

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const dbTool = tool("query_db", "Query the database", { query: z.string() }, async ({ query }) => ({
  content: [{ type: "text", text: JSON.stringify(await db.query(query)) }]
}), { annotations: { readOnlyHint: true } });

const server = createSdkMcpServer({ name: "my-tools", version: "1.0", tools: [dbTool] });
```

## Structured output

`outputFormat: { type: "json_schema", schema: {...} }` → result message has `structured_output`.

## File checkpointing

`enableFileCheckpointing: true` lets you `q.rewindFiles(messageId, { dryRun: true })` to undo changes since a given turn.

## Differences from CLI

- Programmatic — full TypeScript API.
- Streaming messages (real-time hooks).
- Multi-turn natively.
- Session control from code.
- Subagents inline.
- Deep hook integration (inspect/modify tool calls, augment prompts).
- MCP custom tools wired into options.
- `canUseTool` callback replaces CLI prompts.
- Structured message types instead of parsing stdout.
