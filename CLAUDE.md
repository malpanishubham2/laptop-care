# laptop-care

Cross-platform laptop maintenance AI agent, distributed as an MCP server.

## Architecture
- `src/index.ts` — MCP server entry. Registers tools, prompts, and the AGENT.md resource.
- `src/tools.ts` — Tool definitions (name, description, safety tier, Zod schema). Add new tools here.
- `src/commands.ts` — Platform command strings keyed by `darwin` | `win32`. Add new OS commands here.
- `src/runner.ts` — `child_process.exec` wrapper with per-tool timeouts.
- `src/cli.ts` — CLI entry point: `setup` (auto-config Claude Desktop), `help`, default (start server).
- `AGENT.md` — Agent personality: safety rules, onboarding flow, report format, escalation triggers. This is what tells the LLM how to behave.

## Commands
```bash
npm run build          # compile TypeScript → dist/
npm run dev            # watch mode
node dist/cli.js       # start MCP server
node dist/cli.js setup # add to Claude Desktop config
node dist/cli.js help  # show help
```

## Adding a new tool
1. Add the command strings to `commands.ts` (both `darwin` and `win32`)
2. Add the tool definition to `tools.ts` (name, description with safety tag, schema)
3. If the tool needs custom logic (not just running a shell command), add a handler in `index.ts` and register it in `CUSTOM_HANDLERS`
4. Update `AGENT.md` if the tool changes the maintenance workflow
5. `npm run build` and test

## Safety tiers
- `[AUTO-SAFE]` — read-only, runs without asking
- `[ASK-FIRST]` — modifies system, LLM must confirm with user first
- `[ADMIN]` — needs elevated privileges, LLM must warn about time/risk

## Data storage
All user data lives in `~/.laptop-care/`:
- `health.csv` — trend log (one row per maintenance run)
- `reports/` — saved markdown reports
- `issues.json` — issue tracker (open/fixed/skipped status)

## Testing
```bash
# Test server starts
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/cli.js

# Test in Claude Desktop: add MCP config, restart, say "run my laptop maintenance"
```
