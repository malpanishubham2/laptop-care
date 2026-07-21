# laptop-care

Cross-platform laptop maintenance agent that runs inside Claude Desktop. Checks disk, battery, SSD, security, and more. Cleans up junk. Tracks trends over time.

Works on macOS and Windows. No API key needed, uses your Claude Desktop subscription.

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

## Install

```bash
npx laptop-care setup
```

This adds laptop-care to your Claude Desktop config automatically. Then:

1. Restart Claude Desktop
2. Say: "run my laptop maintenance"

laptop-care introduces itself, runs a health check, and walks you through what it finds.

## How it works

laptop-care is an [MCP server](https://modelcontextprotocol.io/). It gives Claude a set of system maintenance tools (disk check, battery check, cleanup, etc.). Claude does the thinking: reads the results, compares with past runs, decides what to recommend.

- Safe checks (disk, battery, SSD, security) run automatically. They're read-only.
- Cleanup actions (temp files, trash) ask before running.
- Deep checks (system integrity) warn you about the time commitment and need admin.

Health data goes to `~/.laptop-care/health.csv` so Claude can compare across runs.

## Manual setup

If auto-setup doesn't work, add this to your Claude Desktop config (`claude_desktop_config.json`):

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
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## For Claude Code users

```bash
claude mcp add laptop-care -- npx -y laptop-care
```

## Scheduling

On your first run, laptop-care offers to set up automatic recurring checks (weekly, monthly, or quarterly). You can also set this up anytime by saying "schedule my maintenance checks" in Claude Desktop.

## Requirements

- Node.js 18+
- Claude Desktop (or any MCP-compatible client)
- macOS or Windows

## License

MIT
