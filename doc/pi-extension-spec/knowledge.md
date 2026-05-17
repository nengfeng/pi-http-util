# How to Write a Pi Extension

## Overview

Pi extensions are TypeScript modules that extend pi's behavior. They can subscribe to lifecycle events, register custom tools callable by the LLM, add commands, and more. Extensions are loaded via [jiti](https://github.com/unjs/jiti), so TypeScript works without compilation.

> **Placement for /reload:** Put extensions in `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local) for auto-discovery. Use `pi -e ./path.ts` only for quick tests. Extensions in auto-discovered locations can be hot-reloaded with `/reload`.

> **Security:** Extensions run with your full system permissions and can execute arbitrary code. Only install from sources you trust.

**Key capabilities:**
- **Custom tools** — Register tools the LLM can call via `pi.registerTool()`
- **Event interception** — Block or modify tool calls, inject context, customize compaction
- **User interaction** — Prompt users via `ctx.ui` (select, confirm, input, notify)
- **Custom UI components** — Full TUI components with keyboard input via `ctx.ui.custom()`
- **Custom commands** — Register commands like `/mycommand` via `pi.registerCommand()`
- **Session persistence** — Store state that survives restarts via `pi.appendEntry()`
- **Custom rendering** — Control how tool calls/results and messages appear in TUI

**Example use cases:**
- Permission gates (confirm before `rm -rf`, `sudo`, etc.)
- Git checkpointing (stash at each turn, restore on branch)
- Path protection (block writes to `.env`, `node_modules/`)
- Custom compaction (summarize conversation your way)
- Interactive tools (questions, wizards, custom dialogs)
- Stateful tools (todo lists, connection pools)
- External integrations (file watchers, webhooks, CI triggers)
- Games while you wait (see `snake.ts` example)

See [examples/extensions/](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions) for working implementations.

---

## Quick Start

Create `~/.pi/agent/extensions/my-extension.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // React to events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Register a custom tool
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  // Register a command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

Test with `pi -e ./my-extension.ts`.

---

## Extension Locations

Extensions are auto-discovered from:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/*.ts` | Global (all projects) |
| `~/.pi/agent/extensions/*/index.ts` | Global (subdirectory) |
| `.pi/extensions/*.ts` | Project-local |
| `.pi/extensions/*/index.ts` | Project-local (subdirectory) |

Additional paths via `settings.json`:

```json
{
  "extensions": [
    "/path/to/local/extension.ts",
    "/path/to/local/extension/dir"
  ]
}
```

---

## Available Imports

| Package | Purpose |
|---------|---------|
| `@earendil-works/pi-coding-agent` | Extension types (`ExtensionAPI`, `ExtensionContext`, events) |
| `typebox` | Schema definitions for tool parameters |
| `@earendil-works/pi-ai` | AI utilities (`StringEnum` for Google-compatible enums) |
| `@earendil-works/pi-tui` | TUI components for custom rendering |

npm dependencies work too — add a `package.json` next to your extension, run `npm install`, and imports from `node_modules/` are resolved automatically. For distributed pi packages, runtime deps must be in `dependencies` (not `devDependencies`). Node.js built-ins (`node:fs`, `node:path`, etc.) are also available.

---

## Writing an Extension

An extension exports a default factory function that receives `ExtensionAPI`. The factory can be synchronous or asynchronous:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("event_name", async (event, ctx) => {
    const ok = await ctx.ui.confirm("Title", "Are you sure?");
    ctx.ui.notify("Done!", "success");
    ctx.ui.setStatus("my-ext", "Processing...");  // Footer status
    ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]);  // Widget above editor
  });

  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("my-flag", { ... });
}
```

If the factory returns a `Promise`, pi awaits it before continuing startup — async initialization completes before `session_start`, `resources_discover`, and provider registrations queued via `pi.registerProvider()`.

### Async Factory Functions

Use an async factory for one-time startup work such as fetching remote configuration or dynamically discovering models:

```typescript
export default async function (pi: ExtensionAPI) {
  const response = await fetch("http://localhost:1234/v1/models");
  const payload = (await response.json()) as {
    data: Array<{ id: string; name?: string; context_window?: number; max_tokens?: number }>;
  };

  pi.registerProvider("local-openai", {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "LOCAL_OPENAI_API_KEY",
    api: "openai-completions",
    models: payload.data.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_window ?? 128000,
      maxTokens: model.max_tokens ?? 4096,
    })),
  });
}
```

This makes fetched models available during normal startup and to `pi --list-models`.

### Extension Styles

**Single file** — simplest, for small extensions:
```
~/.pi/agent/extensions/my-extension.ts
```

**Directory with index.ts** — for multi-file extensions:
```
~/.pi/agent/extensions/my-extension/
├── index.ts    # Entry point (exports default function)
├── tools.ts    # Helper module
└── utils.ts    # Helper module
```

**Package with dependencies** — for extensions needing npm packages:
```
~/.pi/agent/extensions/my-extension/
├── package.json
├── package-lock.json
├── node_modules/
└── src/
    └── index.ts
```

```json
{
  "name": "my-extension",
  "dependencies": { "zod": "^3.0.0", "chalk": "^5.0.0" },
  "pi": { "extensions": ["./src/index.ts"] }
}
```

---

## Events

### Lifecycle Overview

```
pi starts
  │
  ├─► session_start { reason: "startup" }
  └─► resources_discover { reason: "startup" }
      │
      ▼
user sends prompt ─────────────────────────────────────────┐
  │                                                        │
  ├─► (extension commands checked first, bypass if found)  │
  ├─► input (can intercept, transform, or handle)          │
  ├─► (skill/template expansion if not handled)            │
  ├─► before_agent_start (can inject message, modify system prompt)
  ├─► agent_start                                          │
  ├─► message_start / message_update / message_end         │
  │                                                        │
  │   ┌─── turn (repeats while LLM calls tools) ───┐       │
  │   │                                            │       │
  │   ├─► turn_start                               │       │
  │   ├─► context (can modify messages)            │       │
  │   ├─► before_provider_request                  │       │
  │   ├─► after_provider_response                  │       │
  │   │                                            │       │
  │   │   LLM responds, may call tools:            │       │
  │   │     ├─► tool_execution_start               │       │
  │   │     ├─► tool_call (can block)              │       │
  │   │     ├─► tool_execution_update              │       │
  │   │     ├─► tool_result (can modify)           │       │
  │   │     └─► tool_execution_end                 │       │
  │   │                                            │       │
  │   └─► turn_end                                 │       │
  │                                                        │
  └─► agent_end                                            │
                                                           │
user sends another prompt ◄────────────────────────────────┘

/new or /resume  →  session_before_switch → session_shutdown → session_start
/fork or /clone  →  session_before_fork → session_shutdown → session_start
/compact         →  session_before_compact → session_compact
/tree            →  session_before_tree → session_tree
/model or Ctrl+P →  thinking_level_select → model_select
exit             →  session_shutdown
```

### Resource Events

#### resources_discover

Fired after `session_start` so extensions can contribute skill, prompt, and theme paths.

```typescript
pi.on("resources_discover", async (event, _ctx) => {
  // event.cwd, event.reason ("startup" | "reload")
  return {
    skillPaths: ["/path/to/skills"],
    promptPaths: ["/path/to/prompts"],
    themePaths: ["/path/to/themes"],
  };
});
```

### Session Events

#### session_start

Fired when a session is started, loaded, or reloaded. `event.reason` is `"startup" | "reload" | "new" | "resume" | "fork"`.

```typescript
pi.on("session_start", async (event, ctx) => {
  ctx.ui.notify(`Session: ${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`, "info");
});
```

#### session_before_switch

Fired before `/new` or `/resume`. Can cancel with `{ cancel: true }`.

```typescript
pi.on("session_before_switch", async (event, ctx) => {
  if (event.reason === "new") {
    const ok = await ctx.ui.confirm("Clear?", "Delete all messages?");
    if (!ok) return { cancel: true };
  }
});
```

After a successful switch, pi emits `session_shutdown` for the old instance, reloads extensions, then emits `session_start` with `reason: "new" | "resume"`.

#### session_before_fork

Fired before `/fork` or `/clone`. Can cancel with `{ cancel: true }`.

```typescript
pi.on("session_before_fork", async (event, ctx) => {
  // event.entryId, event.position ("before" for /fork, "at" for /clone)
  return { cancel: true };
});
```

#### session_before_compact / session_compact

Fired on compaction. Can cancel or provide a custom summary.

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;
  return { cancel: true };
  // OR custom summary:
  return {
    compaction: {
      summary: "...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }
  };
});
```

#### session_before_tree / session_tree

Fired on `/tree` navigation. Can cancel or provide a custom summary.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  return { cancel: true };
  // OR:
  return { summary: { summary: "...", details: {} } };
});
```

#### session_shutdown

Fired before an extension runtime is torn down. `event.reason` is `"quit" | "reload" | "new" | "resume" | "fork"`. Do cleanup here, then reestablish state in `session_start`.

```typescript
pi.on("session_shutdown", async (event, ctx) => {
  // Cleanup, save state, etc.
});
```

### Agent Events

#### before_agent_start

Fired after user submits prompt, before agent loop. Can inject messages and/or modify the system prompt.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt, event.images, event.systemPrompt
  // event.systemPromptOptions — structured data Pi uses to build the system prompt
  //   .customPrompt, .selectedTools, .toolSnippets, .promptGuidelines,
  //   .appendSystemPrompt, .cwd, .contextFiles, .skills

  return {
    message: {
      customType: "my-extension",
      content: "Additional context for the LLM",
      display: true,
    },
    systemPrompt: event.systemPrompt + "\n\nExtra instructions...",
  };
});
```

#### agent_start / agent_end

Fired once per user prompt. `agent_end` provides `event.messages`.

#### turn_start / turn_end

Fired for each turn (one LLM response + tool calls). Provides `turnIndex`, `timestamp`, `message`, `toolResults`.

#### message_start / message_update / message_end

Fired for message lifecycle updates. `message_end` handlers can return `{ message }` to replace the finalized message (must keep same `role`).

#### tool_execution_start / tool_execution_update / tool_execution_end

Fired for tool execution lifecycle. In parallel tool mode, `tool_execution_start` is emitted in assistant source order during preflight, updates may interleave, and `tool_execution_end` is emitted in completion order.

#### context

Fired before each LLM call. Modify messages non-destructively. `event.messages` is a deep copy, safe to modify.

```typescript
pi.on("context", async (event, ctx) => {
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});
```

#### before_provider_request

Fired after the provider-specific payload is built, right before the request is sent. Returning `undefined` keeps the payload unchanged; returning any other value replaces it.

```typescript
pi.on("before_provider_request", (event, ctx) => {
  console.log(JSON.stringify(event.payload, null, 2));
  // return { ...event.payload, temperature: 0 };
});
```

#### after_provider_response

Fired after an HTTP response is received and before its stream body is consumed. Provides `event.status` and `event.headers`.

### Model Events

#### model_select

Fired when the model changes via `/model`, `Ctrl+P`, or session restore. `event.source` is `"set" | "cycle" | "restore"`.

```typescript
pi.on("model_select", async (event, ctx) => {
  const prev = event.previousModel ? `${event.previousModel.provider}/${event.previousModel.id}` : "none";
  const next = `${event.model.provider}/${event.model.id}`;
  ctx.ui.notify(`Model changed (${event.source}): ${prev} -> ${next}`, "info");
});
```

#### thinking_level_select

Fired when the thinking level changes (notification-only; return values are ignored).

```typescript
pi.on("thinking_level_select", async (event, ctx) => {
  ctx.ui.setStatus("thinking", `thinking: ${event.level}`);
});
```

### Tool Events

#### tool_call

Fired after `tool_execution_start`, before the tool executes. **Can block.** `event.input` is mutable — mutate it in place to patch arguments before execution.

```typescript
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    // event.input is { command: string; timeout?: number }
    event.input.command = `source ~/.profile\n${event.input.command}`;
    if (event.input.command.includes("rm -rf")) {
      return { block: true, reason: "Dangerous command" };
    }
  }
});
```

**Typing custom tool input:** Export your tool's input type and use `isToolCallEventType<"tool_name", InputType>()` for typed narrowing.

#### tool_result

Fired after tool execution finishes. **Can modify result.** Handlers chain like middleware — each handler sees the latest result after previous handler changes. Can return partial patches (`content`, `details`, or `isError`).

```typescript
import { isBashToolResult } from "@earendil-works/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  if (isBashToolResult(event)) {
    // event.details is typed as BashToolDetails
  }
  return { content: [...], details: {...}, isError: false };
});
```

### User Bash Events

#### user_bash

Fired when user executes `!` or `!!` commands. **Can intercept.**

```typescript
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

pi.on("user_bash", (event, ctx) => {
  // event.command, event.excludeFromContext, event.cwd

  // Wrap local bash backend
  const local = createLocalBashOperations();
  return {
    operations: {
      exec(command, cwd, options) {
        return local.exec(`source ~/.profile\n${command}`, cwd, options);
      }
    }
  };

  // Or full replacement:
  return { result: { output: "...", exitCode: 0, cancelled: false, truncated: false } };
});
```

### Input Events

#### input

Fired when user input is received, after extension commands are checked but before skill/template expansion.

**Processing order:**
1. Extension commands (`/cmd`) checked first
2. `input` event fires — can intercept, transform, or handle
3. Skill commands (`/skill:name`) expanded
4. Prompt templates (`/template`) expanded
5. Agent processing begins

```typescript
pi.on("input", async (event, ctx) => {
  // event.text, event.images, event.source ("interactive" | "rpc" | "extension")

  if (event.text.startsWith("?quick "))
    return { action: "transform", text: `Respond briefly: ${event.text.slice(7)}` };

  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }

  return { action: "continue" };  // Default: pass through
});
```

**Results:** `continue` (pass through), `transform` (modify then continue), `handled` (skip agent entirely).

---

## ExtensionContext

All handlers receive `ctx: ExtensionContext`.

| Property/Method | Description |
|-----------------|-------------|
| `ctx.ui` | UI methods (select, confirm, input, notify, setStatus, setWidget, etc.) |
| `ctx.hasUI` | `false` in print/JSON mode, `true` in interactive/RPC mode |
| `ctx.cwd` | Current working directory |
| `ctx.sessionManager` | Read-only session state access (`getEntries()`, `getBranch()`, `getLeafId()`) |
| `ctx.modelRegistry` / `ctx.model` | Access to models and API keys |
| `ctx.signal` | Abort signal for nested async work (defined during active turns) |
| `ctx.isIdle()` / `ctx.abort()` / `ctx.hasPendingMessages()` | Control flow helpers |
| `ctx.shutdown()` | Request graceful shutdown (deferred until idle in interactive/RPC mode) |
| `ctx.getContextUsage()` | Current context token usage |
| `ctx.compact(options)` | Trigger compaction with `onComplete`/`onError` callbacks |
| `ctx.getSystemPrompt()` | Current system prompt string |

### ctx.signal

The current agent abort signal, or `undefined` when no agent turn is active. Use for abort-aware nested work:

```typescript
pi.on("tool_result", async (event, ctx) => {
  const response = await fetch("https://example.com/api", {
    method: "POST",
    body: JSON.stringify(event),
    signal: ctx.signal,
  });
  return { details: await response.json() };
});
```

### ctx.shutdown()

Request a graceful shutdown. Interactive mode: deferred until idle. RPC mode: deferred until next idle. Print mode: no-op. Emits `session_shutdown` before exiting.

---

## ExtensionCommandContext

Command handlers receive `ExtensionCommandContext`, which extends `ExtensionContext` with session control methods. These are only available in commands because they can deadlock from event handlers.

### ctx.waitForIdle()

Wait for the agent to finish streaming.

```typescript
pi.registerCommand("my-cmd", {
  handler: async (args, ctx) => {
    await ctx.waitForIdle();
    // Agent is now idle, safe to modify session
  },
});
```

### ctx.newSession(options?)

Create a new session. Options: `parentSession`, `setup` (mutate new SessionManager), `withSession` (post-switch work).

```typescript
const result = await ctx.newSession({
  setup: async (sm) => {
    sm.appendMessage({ role: "user", content: [{ type: "text", text: "Context..." }], timestamp: Date.now() });
  },
  withSession: async (ctx) => {
    await ctx.sendUserMessage("Continue in new session");
  },
});
if (result.cancelled) { /* An extension cancelled */ }
```

### ctx.fork(entryId, options?)

Fork from a specific entry. Options: `position` (`"before"` default, `"at"` for clone), `withSession`.

```typescript
const result = await ctx.fork("entry-id-123", {
  withSession: async (ctx) => { ctx.ui.notify("Now in the forked session", "info"); },
});
```

### ctx.navigateTree(targetId, options?)

Navigate to a different point in the session tree. Options: `summarize`, `customInstructions`, `replaceInstructions`, `label`.

### ctx.switchSession(sessionPath, options?)

Switch to a different session file. Use `SessionManager.list(ctx.cwd)` to discover sessions.

### Session Replacement Lifecycle and Footguns

`withSession` receives a fresh `ReplacedSessionContext` bound to the replacement session.

**Key rules:**
- `withSession` runs only after old session shutdown and new session start
- Captured old `pi` / old command `ctx` session-bound objects are stale — use only the `ctx` passed to `withSession`
- Only capture plain data (strings, ids, serialized config) that survives shutdown cleanly

**Safe pattern:**
```typescript
pi.registerCommand("handoff", {
  handler: async (_args, ctx) => {
    const kickoff = "Continue from the replacement session";
    await ctx.newSession({
      withSession: async (ctx) => { await ctx.sendUserMessage(kickoff); },
    });
  },
});
```

**Unsafe pattern (don't do this):**
```typescript
// Capturing old sessionManager before replacement — stale after withSession runs
const oldSessionManager = ctx.sessionManager;
await ctx.newSession({
  withSession: async (_ctx) => {
    oldSessionManager.getSessionFile();  // STALE — throws
  },
});
```

### ctx.reload()

Run the same reload flow as `/reload`. Treat as terminal for that handler (`await ctx.reload(); return;`). Code after reload still runs from the pre-reload version.

Tools run with `ExtensionContext`, so they cannot call `ctx.reload()` directly. Use a command as the reload entrypoint, then expose a tool that queues that command as a follow-up user message:

```typescript
pi.registerCommand("reload-runtime", {
  description: "Reload extensions, skills, prompts, and themes",
  handler: async (_args, ctx) => { await ctx.reload(); return; },
});

pi.registerTool({
  name: "reload_runtime",
  label: "Reload Runtime",
  description: "Reload extensions, skills, prompts, and themes",
  parameters: Type.Object({}),
  async execute() {
    pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
    return { content: [{ type: "text", text: "Queued /reload-runtime." }] };
  },
});
```

---

## ExtensionAPI Methods

### pi.on(event, handler)

Subscribe to events. See [Events](#events) for types and return values.

### pi.registerTool(definition)

Register a custom tool callable by the LLM. Works both during extension load and after startup (inside `session_start`, command handlers, etc.). New tools are refreshed immediately without `/reload`.

Use `promptSnippet` for a one-line entry in `Available tools`, and `promptGuidelines` for tool-specific bullets in `Guidelines` (included only while the tool is active).

**Important:** `promptGuidelines` bullets are appended flat with no tool name prefix. Write "Use my_tool when..." not "Use this tool when...".

```typescript
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does",
  promptSnippet: "Summarize or transform text according to action",
  promptGuidelines: ["Use my_tool when the user asks to summarize previously generated text."],
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),
    text: Type.Optional(Type.String()),
  }),
  prepareArguments(args) {
    // Optional compatibility shim — runs before schema validation
    return args;
  },
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
    return { content: [{ type: "text", text: "Done" }], details: { result: "..." } };
  },
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

### pi.sendMessage(message, options?)

Inject a custom message into the session.

```typescript
pi.sendMessage({
  customType: "my-extension",
  content: "Message text",
  display: true,
  details: { ... },
}, { triggerTurn: true, deliverAs: "steer" });
```

**Delivery modes:** `"steer"` (default — after current turn's tool calls), `"followUp"` (after agent finishes), `"nextTurn"` (queued for next user prompt). `triggerTurn: true` triggers LLM response if idle.

### pi.sendUserMessage(content, options?)

Send a user message (appears as if typed by the user). Always triggers a turn. During streaming, `deliverAs` is required (`"steer"` or `"followUp"`).

```typescript
pi.sendUserMessage("What is 2+2?");
pi.sendUserMessage("Focus on error handling", { deliverAs: "steer" });
```

### pi.appendEntry(customType, data?)

Persist extension state (does NOT participate in LLM context).

```typescript
pi.appendEntry("my-state", { count: 42 });

// Restore on reload
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      // Reconstruct from entry.data
    }
  }
});
```

### pi.setSessionName(name) / pi.getSessionName()

Set or get the session display name (shown in session selector).

### pi.setLabel(entryId, label)

Set or clear a label on an entry. Labels are bookmarks for `/tree` navigation. Persist in session and survive restarts.

```typescript
pi.setLabel(entryId, "checkpoint-before-refactor");
pi.setLabel(entryId, undefined);  // Clear
const label = ctx.sessionManager.getLabel(entryId);
```

### pi.registerCommand(name, options)

Register a `/command`. If multiple extensions register the same name, pi keeps them all with numeric suffixes (`/review:1`, `/review:2`).

```typescript
pi.registerCommand("deploy", {
  description: "Deploy to an environment",
  getArgumentCompletions: (prefix: string) => {
    const envs = ["dev", "staging", "prod"];
    const items = envs.filter(e => e.startsWith(prefix)).map(e => ({ value: e, label: e }));
    return items.length > 0 ? items : null;
  },
  handler: async (args, ctx) => { ctx.ui.notify(`Deploying: ${args}`, "info"); },
});
```

### pi.getCommands()

Get slash commands available for invocation. Includes extension commands, prompt templates, and skill commands. Returns `name`, `description`, `source` (`"extension" | "prompt" | "skill"`), and `sourceInfo`.

```typescript
const commands = pi.getCommands();
const bySource = commands.filter((c) => c.source === "extension");
```

### pi.registerMessageRenderer(customType, renderer)

Register a custom TUI renderer for messages with your `customType`.

### pi.registerShortcut(shortcut, options)

Register a keyboard shortcut. See [keybindings.md](https://pi.dev/docs/latest/keybindings) for format and built-in keybindings.

```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "Toggle plan mode",
  handler: async (ctx) => { ctx.ui.notify("Toggled!"); },
});
```

### pi.registerFlag(name, options)

Register a CLI flag.

```typescript
pi.registerFlag("plan", { description: "Start in plan mode", type: "boolean", default: false });
if (pi.getFlag("plan")) { /* Plan mode enabled */ }
```

### pi.exec(command, args, options?)

Execute a shell command.

```typescript
const result = await pi.exec("git", ["status"], { signal, timeout: 5000 });
// result.stdout, result.stderr, result.code, result.killed
```

### pi.getActiveTools() / pi.getAllTools() / pi.setActiveTools(names)

Manage active tools (built-in and extension tools).

```typescript
const all = pi.getAllTools();
const builtinTools = all.filter((t) => t.sourceInfo.source === "builtin");
const extensionTools = all.filter((t) => t.sourceInfo.source !== "builtin" && t.sourceInfo.source !== "sdk");
pi.setActiveTools(["read", "bash"]);
```

### pi.setModel(model)

Set the current model. Returns `false` if no API key is available.

```typescript
const model = ctx.modelRegistry.find("anthropic", "claude-sonnet-4-5");
if (model) {
  const success = await pi.setModel(model);
  if (!success) ctx.ui.notify("No API key for this model", "error");
}
```

### pi.getThinkingLevel() / pi.setThinkingLevel(level)

Get or set the thinking level (`"off" | "minimal" | "low" | "medium" | "high" | "xhigh"`). Changes emit `thinking_level_select`.

### pi.events

Shared event bus for communication between extensions:

```typescript
pi.events.on("my:event", (data) => { ... });
pi.events.emit("my:event", { ... });
```

### pi.registerProvider(name, config)

Register or override a model provider dynamically. Calls during the factory are queued; calls after take effect immediately.

```typescript
// Register a new provider
pi.registerProvider("my-proxy", {
  name: "My Proxy",
  baseUrl: "https://proxy.example.com",
  apiKey: "PROXY_API_KEY",
  api: "anthropic-messages",
  models: [{ id: "claude-sonnet-4-20250514", name: "Claude 4 Sonnet (proxy)", reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 16384 }],
});

// Override baseUrl for an existing provider (keeps all models)
pi.registerProvider("anthropic", { baseUrl: "https://proxy.example.com" });

// With OAuth support for /login
pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",
    async login(callbacks) {
      callbacks.onAuth({ url: "https://sso.corp.com/..." });
      const code = await callbacks.onPrompt({ message: "Enter code:" });
      return { refresh: code, access: code, expires: Date.now() + 3600000 };
    },
    async refreshToken(credentials) { return credentials; },
    getApiKey(credentials) { return credentials.access; },
  }
});
```

**Config options:** `name`, `baseUrl`, `apiKey`, `api`, `headers`, `authHeader`, `models`, `oauth`, `streamSimple`.

### pi.unregisterProvider(name)

Remove a previously registered provider. Built-in models that were overridden are restored. Takes effect immediately without `/reload`.

---

## State Management

Extensions with state should store it in tool result `details` for proper branching support:

```typescript
export default function (pi: ExtensionAPI) {
  let items: string[] = [];

  pi.on("session_start", async (_event, ctx) => {
    items = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult") {
        if (entry.message.toolName === "my_tool") {
          items = entry.message.details?.items ?? [];
        }
      }
    }
  });

  pi.registerTool({
    name: "my_tool",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      items.push("new item");
      return {
        content: [{ type: "text", text: "Added" }],
        details: { items: [...items] },  // Store for reconstruction
      };
    },
  });
}
```

---

## Custom Tools

### Tool Definition

```typescript
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does (shown to LLM)",
  promptSnippet: "List or add items in the project todo list",
  promptGuidelines: ["Use my_tool for todo planning instead of direct file edits."],
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),  // Use StringEnum for Google compatibility
    text: Type.Optional(Type.String()),
  }),
  prepareArguments(args) {
    // Optional: compatibility shim for older session data
    if (!args || typeof args !== "object") return args;
    const input = args as { action?: string; oldAction?: string };
    if (typeof input.oldAction === "string" && input.action === undefined) {
      return { ...input, action: input.oldAction };
    }
    return args;
  },

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };

    onUpdate?.({ content: [{ type: "text", text: "Working..." }], details: { progress: 50 } });

    const result = await pi.exec("some-command", [], { signal });

    return {
      content: [{ type: "text", text: "Done" }],
      details: { data: result },
      terminate: true,  // Optional: hint to skip follow-up LLM call
    };
  },
});
```

**Important points:**
- Use `StringEnum` from `@earendil-works/pi-ai` for string enums (`Type.Union`/`Type.Literal` doesn't work with Google's API)
- Throw errors from `execute` to signal failures (sets `isError: true`)
- Return `terminate: true` to hint that the agent should stop after this tool batch (only takes effect when every finalized tool result in the batch is terminating)
- Use `withFileMutationQueue()` for tools that mutate files to avoid race conditions
- `prepareArguments(args)` — optional compatibility shim before schema validation
- Some models include `@` prefix in path arguments — normalize it away

### withFileMutationQueue()

If your custom tool mutates files, use `withFileMutationQueue()` so it participates in the same per-file queue as built-in `edit` and `write`. Tool calls run in parallel by default, so without the queue, two tools can read the same old file contents and one write overwrites the other.

```typescript
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
  const absolutePath = resolve(ctx.cwd, params.path);

  return withFileMutationQueue(absolutePath, async () => {
    await mkdir(dirname(absolutePath), { recursive: true });
    const current = await readFile(absolutePath, "utf8");
    const next = current.replace(params.oldText, params.newText);
    await writeFile(absolutePath, next, "utf8");
    return { content: [{ type: "text", text: `Updated ${params.path}` }], details: {} };
  });
}
```

### Overriding Built-in Tools

Extensions can override built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) by registering a tool with the same name. Rendering is inherited per slot — omit `renderCall`/`renderResult` to use the built-in renderer. `promptSnippet` and `promptGuidelines` are NOT inherited.

```typescript
import { createReadTool } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const readTool = createReadTool(process.cwd());
  pi.registerTool({
    ...readTool,
    async execute(id, params, signal, onUpdate, ctx) {
      console.log(`Reading: ${params.path}`);
      return readTool.execute(id, params, signal, onUpdate);
    },
  });
}
```

### Remote Execution

Built-in tools support pluggable operations for delegating to remote systems:

```typescript
import { createReadTool, createBashTool } from "@earendil-works/pi-coding-agent";

const remoteRead = createReadTool(cwd, {
  operations: {
    readFile: (path) => sshExec(remote, `cat ${path}`),
    access: (path) => sshExec(remote, `test -r ${path}`).then(() => {}),
  }
});
```

**Operations interfaces:** `ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`, `LsOperations`, `GrepOperations`, `FindOperations`

The bash tool also supports a `spawnHook`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: ({ command, cwd, env }) => ({
    command: `source ~/.profile\n${command}`,
    cwd: `/mnt/sandbox${cwd}`,
    env: { ...env, CI: "1" },
  }),
});
```

### Output Truncation

**Tools MUST truncate output** to avoid overwhelming the LLM context (default: 50KB / 2000 lines):

```typescript
import { truncateHead, truncateTail, truncateLine, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });

if (truncation.truncated) {
  result += `\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
}
```

- Use `truncateHead` for content where the beginning matters (search results, file reads)
- Use `truncateTail` for content where the end matters (logs, command output)
- Always inform the LLM when output is truncated and where to find the full version

### Multiple Tools

One extension can register multiple tools with shared state:

```typescript
export default function (pi: ExtensionAPI) {
  let connection = null;
  pi.registerTool({ name: "db_connect", ... });
  pi.registerTool({ name: "db_query", ... });
  pi.registerTool({ name: "db_close", ... });
  pi.on("session_shutdown", async () => { connection?.close(); });
}
```

### Custom Rendering

Tools can provide `renderCall` and `renderResult` for custom TUI display. By default, tool output is wrapped in a `Box`. Set `renderShell: "self"` for complete control over framing.

```typescript
pi.registerTool({
  name: "my_tool",
  parameters: Type.Object({}),
  renderShell: "self",
  async execute() { return { content: [{ type: "text", text: "ok" }], details: undefined }; },
  renderCall(args, theme, context) {
    return new Text(theme.fg("accent", "my custom shell"), 0, 0);
  },
});
```

`renderCall` and `renderResult` receive a `context` object with: `args`, `state`, `lastComponent`, `invalidate()`, `toolCallId`, `cwd`, `executionStarted`, `argsComplete`, `isPartial`, `expanded`, `showImages`, `isError`.

#### Keybinding Hints

```typescript
import { keyHint } from "@earendil-works/pi-coding-agent";

renderResult(result, { expanded }, theme, context) {
  let text = theme.fg("success", "✓ Done");
  if (!expanded) text += ` (${keyHint("app.tools.expand", "to expand")})`;
  return new Text(text, 0, 0);
}
```

Available: `keyHint(id, description)`, `keyText(id)`, `rawKeyHint(key, description)`.

Namespaced keybinding ids: `app.*` (coding-agent), `tui.*` (shared TUI).

#### Best Practices

- Use `Text` with padding `(0, 0)` — the default Box handles padding
- Use `\n` for multi-line content
- Handle `isPartial` for streaming progress
- Support `expanded` for detail on demand
- Keep default view compact
- Read `context.args` in `renderResult` instead of copying into `context.state`
- Use `context.state` only for cross-slot shared data
- Reuse `context.lastComponent` when the same component can be updated in place
- Use `renderShell: "self"` only when the default boxed shell gets in the way

#### Fallback

If a slot renderer is not defined or throws: `renderCall` shows the tool name, `renderResult` shows raw text from `content`.

---

## Custom UI

Extensions can interact with users via `ctx.ui` methods and customize how messages/tools render.

**For custom components, see [tui.md](https://pi.dev/docs/latest/tui)** for copy-paste patterns (SelectList, BorderedLoader, SettingsList, etc.).

### Dialogs

```typescript
const choice = await ctx.ui.select("Pick one:", ["A", "B", "C"]);
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");
const name = await ctx.ui.input("Name:", "placeholder");
const text = await ctx.ui.editor("Edit:", "prefilled text");
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"
```

#### Timed Dialogs with Countdown

Dialogs support a `timeout` option that auto-dismisses with a live countdown:

```typescript
const confirmed = await ctx.ui.confirm("Timed Confirmation", "Auto-cancel in 5 seconds?", { timeout: 5000 });
// On timeout: select() → undefined, confirm() → false, input() → undefined
```

#### Manual Dismissal with AbortSignal

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

const confirmed = await ctx.ui.confirm("Timed", "Auto-cancel?", { signal: controller.signal });
clearTimeout(timeoutId);

if (confirmed) { /* confirmed */ }
else if (controller.signal.aborted) { /* timed out */ }
else { /* user cancelled */ }
```

### Widgets, Status, and Footer

```typescript
// Footer status
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined);  // Clear

// Working loader (shown during streaming)
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setWorkingMessage();  // Restore default
ctx.ui.setWorkingVisible(false);  // Hide entirely
ctx.ui.setWorkingVisible(true);

// Working indicator
ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg("accent", "●")] });  // Static dot
ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg("dim", "·"), ctx.ui.theme.fg("accent", "●")], intervalMs: 120 });
ctx.ui.setWorkingIndicator({ frames: [] });  // Hide
ctx.ui.setWorkingIndicator();  // Restore default spinner

// Widget above editor (default)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
// Widget below editor
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"], { placement: "belowEditor" });
ctx.ui.setWidget("my-widget", (tui, theme) => new Text(theme.fg("accent", "Custom"), 0, 0));
ctx.ui.setWidget("my-widget", undefined);  // Clear

// Custom footer
ctx.ui.setFooter((tui, theme) => ({
  render(width) { return [theme.fg("dim", "Custom footer")]; },
  invalidate() {},
}));
ctx.ui.setFooter(undefined);  // Restore built-in footer

// Terminal title
ctx.ui.setTitle("pi - my-project");

// Editor text
ctx.ui.setEditorText("Prefill text");
const current = ctx.ui.getEditorText();
ctx.ui.pasteToEditor("pasted content");

// Tool output expansion
ctx.ui.setToolsExpanded(true);

// Custom editor
ctx.ui.setEditorComponent((tui, theme, keybindings) => new VimEditor(tui, theme, keybindings));
ctx.ui.setEditorComponent(undefined);  // Restore default

// Theme management
const themes = ctx.ui.getAllThemes();  // [{ name: "dark", path: "/..." | undefined }, ...]
const lightTheme = ctx.ui.getTheme("light");  // Load without switching
const result = ctx.ui.setTheme("light");  // Switch by name
ctx.ui.setTheme(lightTheme!);  // Or switch by Theme object
ctx.ui.theme.fg("accent", "styled text");  // Access current theme
```

### Autocomplete Providers

Use `ctx.ui.addAutocompleteProvider()` to stack custom autocomplete logic on top of the built-in provider:

```typescript
pi.on("session_start", (_event, ctx) => {
  ctx.ui.addAutocompleteProvider((current) => ({
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const match = beforeCursor.match(/(?:^|[ \t])#([^\s#]*)$/);
      if (!match) return current.getSuggestions(lines, cursorLine, cursorCol, options);

      return {
        prefix: `#${match[1] ?? ""}`,
        items: [{ value: "#2983", label: "#2983", description: "Extension API for autocomplete" }],
      };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  }));
});
```

### Custom Components

For complex UI, use `ctx.ui.custom()`. This temporarily replaces the editor until `done()` is called:

```typescript
import { Text } from "@earendil-works/pi-tui";

const result = await ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
  const text = new Text("Press Enter to confirm, Escape to cancel", 1, 1);
  text.onKey = (key) => {
    if (key === "return") done(true);
    if (key === "escape") done(false);
    return true;
  };
  return text;
});
```

Callback receives: `tui` (screen dimensions, focus), `theme` (styling), `keybindings` (shortcut manager), `done(value)` (close and return).

#### Overlay Mode (Experimental)

Pass `{ overlay: true }` to render as a floating modal without clearing the screen:

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => new MyOverlayComponent({ onClose: done }),
  { overlay: true, overlayOptions: { anchor: "top-right", width: "50%", margin: 2 } }
);
```

### Custom Editor

Replace the main input editor with a custom implementation:

```typescript
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

class VimEditor extends CustomEditor {
  private mode: "normal" | "insert" = "insert";

  handleInput(data: string): void {
    if (matchesKey(data, "escape") && this.mode === "insert") { this.mode = "normal"; return; }
    if (this.mode === "normal" && data === "i") { this.mode = "insert"; return; }
    super.handleInput(data);  // App keybindings + text editing
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((_tui, theme, keybindings) => new VimEditor(theme, keybindings));
  });
}
```

**Key points:**
- Extend `CustomEditor` (not base `Editor`) to get app keybindings
- Call `super.handleInput(data)` for keys you don't handle
- Use `ctx.ui.getEditorComponent()` before `setEditorComponent()` to wrap the previous editor
- Pass `undefined` to restore default

### Message Rendering

Register a custom renderer for messages with your `customType`:

```typescript
import { Text } from "@earendil-works/pi-tui";

pi.registerMessageRenderer("my-extension", (message, options, theme) => {
  const { expanded } = options;
  let text = theme.fg("accent", `[${message.customType}] `) + message.content;
  if (expanded && message.details) text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
  return new Text(text, 0, 0);
});

pi.sendMessage({ customType: "my-extension", content: "Status update", display: true, details: { ... } });
```

### Theme Colors

```typescript
theme.fg("toolTitle", text)   // Tool names
theme.fg("accent", text)      // Highlights
theme.fg("success", text)     // Green
theme.fg("error", text)       // Red
theme.fg("warning", text)     // Yellow
theme.fg("muted", text)       // Secondary
theme.fg("dim", text)         // Tertiary
theme.bold(text)
theme.italic(text)
theme.strikethrough(text)
```

Syntax highlighting:

```typescript
import { highlightCode, getLanguageFromPath } from "@earendil-works/pi-coding-agent";

const highlighted = highlightCode("const x = 1;", "typescript", theme);
const lang = getLanguageFromPath("/path/to/file.rs");  // "rust"
```

---

## Error Handling

- Extension errors are logged, agent continues
- `tool_call` errors block the tool (fail-safe)
- Tool `execute` errors must be signaled by throwing (caught, reported with `isError: true`, execution continues)

---

## Mode Behavior

| Mode | UI Methods | Notes |
|------|-----------|-------|
| Interactive | Full TUI | Normal operation |
| RPC (`--mode rpc`) | JSON protocol | Host handles UI, see [rpc.md](https://pi.dev/docs/latest/rpc) |
| JSON (`--mode json`) | No-op | Event stream to stdout |
| Print (`-p`) | No-op | Extensions run but can't prompt |

In non-interactive modes, check `ctx.hasUI` before using UI methods.

---

## Running and Testing

```bash
pi -e ./my-extension.ts                    # Quick test
# Place in ~/.pi/agent/extensions/         # Global auto-discovery
# Place in .pi/extensions/                 # Project-local auto-discovery
# Type /reload in interactive mode         # Hot-reload after edits
pi --no-extensions                          # Disable all extensions
pi --no-extensions -e ./my-extension.ts    # Explicit loading only
```

---

## Examples Reference

All examples in [examples/extensions/](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions).

| Category | Examples | Key APIs |
|----------|----------|----------|
| **Tools** | `hello.ts`, `question.ts`, `todo.ts`, `dynamic-tools.ts`, `structured-output.ts`, `truncated-tool.ts`, `tool-override.ts` | `registerTool`, `appendEntry`, `renderResult`, `truncateHead` |
| **Commands** | `pirate.ts`, `summarize.ts`, `handoff.ts`, `qna.ts`, `send-user-message.ts`, `reload-runtime.ts`, `shutdown-command.ts` | `registerCommand`, `before_agent_start`, `ui.custom`, `sendUserMessage` |
| **Events & Gates** | `permission-gate.ts`, `protected-paths.ts`, `confirm-destructive.ts`, `dirty-repo-guard.ts`, `input-transform.ts`, `model-status.ts`, `provider-payload.ts`, `system-prompt-header.ts`, `claude-rules.ts`, `prompt-customizer.ts`, `file-trigger.ts` | `on("tool_call")`, `on("input")`, `on("session_before_*")`, `exec` |
| **Compaction & Sessions** | `custom-compaction.ts`, `trigger-compact.ts`, `git-checkpoint.ts`, `auto-commit-on-exit.ts` | `on("session_before_compact")`, `compact()`, `on("turn_start")` |
| **UI Components** | `status-line.ts`, `working-indicator.ts`, `github-issue-autocomplete.ts`, `custom-footer.ts`, `custom-header.ts`, `modal-editor.ts`, `rainbow-editor.ts`, `widget-placement.ts`, `overlay-test.ts`, `overlay-qa-tests.ts`, `notify.ts`, `timed-confirm.ts`, `mac-system-theme.ts` | `setStatus`, `setWorkingIndicator`, `addAutocompleteProvider`, `setFooter`, `setEditorComponent`, `setWidget`, `ui.custom`, `setTheme` |
| **Complex** | `plan-mode/`, `preset.ts`, `tools.ts` | All event types, `registerCommand`, `registerShortcut`, `registerFlag`, `setActiveTools` |
| **Remote & Sandbox** | `ssh.ts`, `interactive-shell.ts`, `sandbox/`, `subagent/` | `on("user_bash")`, tool operations, `exec` |
| **Games** | `snake.ts`, `space-invaders.ts`, `doom-overlay/` | `registerCommand`, `ui.custom` |
| **Providers** | `custom-provider-anthropic/`, `custom-provider-gitlab-duo/` | `registerProvider` with OAuth |
| **Messages & Communication** | `message-renderer.ts`, `event-bus.ts` | `registerMessageRenderer`, `sendMessage`, `pi.events` |
| **Session Metadata** | `session-name.ts`, `bookmark.ts` | `setSessionName`, `getSessionName`, `setLabel` |
| **Misc** | `inline-bash.ts`, `bash-spawn-hook.ts`, `with-deps/` | `on("tool_call")`, `createBashTool`, `spawnHook` |
