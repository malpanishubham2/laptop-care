# laptop-care

Cross-platform laptop maintenance AI agent. Checks your laptop's health, cleans up junk, tracks trends over time, and recommends actions — all through Claude Desktop.

**Works on macOS and Windows. No API key needed — uses your Claude Desktop subscription.**

## What it checks

| Check | What it does |
|-------|-------------|
| Disk space | Free/total, largest folders |
| Temp files | Scan and clean caches, logs, temp directories |
| OS updates | Pending system updates |
| Battery | Wear %, cycle count, capacity |
| SSD health | SMART data, wear level |
| Security | Firewall, antivirus, disk encryption |
| Sleep/wake | Recent events, wake-up issues |
| Startup items | Programs that slow down boot |
| Boot time | Last restart, uptime |
| Firmware | BIOS/Boot ROM version |
| Backup status | Time Machine / Windows Backup |
| System integrity | SFC/DISM (Windows), Disk Utility (Mac) |

## Install (one command)

```bash
npx laptop-care setup
```

This automatically adds laptop-care to your Claude Desktop config. Then:

1. Restart Claude Desktop
2. Say: **"run my laptop maintenance"**

That's it. laptop-care will introduce itself, run a health check, and walk you through what it finds.

## How it works

laptop-care is an [MCP server](https://modelcontextprotocol.io/) — it provides system maintenance tools that Claude uses to check your laptop. Claude handles the reasoning: interpreting results, comparing with past checks, deciding what to recommend.

- **Safe checks run automatically** (disk, battery, SSD, security — read-only)
- **Cleanup actions ask first** (temp files, cache clearing)
- **Deep checks warn you** (system integrity — takes 5-10 min, needs admin)

Health data is saved to `~/.laptop-care/health.csv` so Claude can track trends across runs.

## Manual setup

If the auto-setup doesn't work, add this to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "laptop-care": {
      "command": "npx",
      "args": ["-y", "laptop-care"]
    }
  }
}
```

Config file location:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

## For Claude Code users

```bash
claude mcp add laptop-care -- npx -y laptop-care
```

## Scheduling

During your first run, laptop-care will offer to set up automatic recurring checks (weekly, monthly, or quarterly). You can also set this up anytime by saying "schedule my maintenance checks" in Claude Desktop.

## Requirements

- Node.js 18+
- Claude Desktop (or any MCP-compatible client)
- macOS or Windows

## License

MIT
