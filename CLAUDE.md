# laptop-care

Cross-platform laptop maintenance agent, distributed as an MCP server.

## Architecture

- `src/index.ts` is the MCP server entry point. Registers tools, prompts, the consent interlock, sequencing gates, and the report card.
- `src/tools.ts` has tool definitions (name, description, safety tier, Zod schema). Add new tools here.
- `src/commands.ts` has platform command strings keyed by `darwin` | `win32`. Add new OS commands here.
- `src/runner.ts` is the `child_process.exec` wrapper with per-tool timeouts.
- `src/cli.ts` is the CLI entry point: `setup` auto-configs Claude Desktop, `help` shows usage, default starts the server.
- `prompts/` holds the agent playbook, split by lifecycle stage so nobody loads instructions they cannot use:
  - `prompts/kernel.md` is pushed on every connect. Identity and non-negotiable safety rules.
  - `prompts/first-run.md` is the onboarding workflow. Loaded only for new users.
  - `prompts/returning-run.md` is the follow-up workflow. Loaded only for returning users.
  - `prompts/shared.md` is judgment rules, escalation thresholds, tone, and report format.

  `start_maintenance` decides first-run vs returning in code (by whether `health.csv` exists) and sends only the workflow that applies.

## Commands

```bash
npm run build          # compile TypeScript to dist/
npm run dev            # watch mode
node dist/cli.js       # start MCP server
node dist/cli.js setup # add to Claude Desktop config
node dist/cli.js help  # show help
```

## Adding a new tool

1. Add the command strings to `commands.ts` (both `darwin` and `win32`)
2. Add the tool definition to `tools.ts` (name, description with safety tag, schema)
3. If the tool needs custom logic (not just running a shell command), add a handler in `index.ts` and register it in `CUSTOM_HANDLERS`
4. Update the relevant file in `prompts/` if the tool changes the maintenance workflow
5. If the tool must run only after another one, add it to `REQUIRES` in `index.ts`
6. `npm run build` and test

## Safety tiers

- `[AUTO-SAFE]` is read-only, runs without asking
- `[ASK-FIRST]` modifies the system, LLM must confirm with user first
- `[ADMIN]` needs elevated privileges, LLM must warn about time and risk

## Data storage

All user data lives in `~/.laptop-care/`:

- `health.csv` is the trend log (one row per maintenance run)
- `reports/` has saved markdown reports
- `issues.json` is the issue tracker (open/fixed/skipped status)
- `persistence.json` is the startup-agent snapshot used for change detection
- `disabled-startup/` holds quarantined launch agents, restorable via `re_enable_startup_item`

## Testing

```bash
# Test server starts
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/cli.js

# Test in Claude Desktop: add MCP config, restart, say "run my laptop maintenance"
```
