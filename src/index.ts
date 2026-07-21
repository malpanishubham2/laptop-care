import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, appendFile, mkdir, readdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { TOOLS } from "./tools.js";
import { getCommand } from "./commands.js";
import { execCommand } from "./runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(homedir(), ".laptop-care");
const CSV_PATH = join(DATA_DIR, "health.csv");
const CSV_HEADER = "date,platform,disk_free_gb,disk_total_gb,battery_wear_pct,battery_cycles,ssd_health,firewall_on,encryption_on,pending_updates,uptime_days,is_deep_check";

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

async function handleRecordHealth(params: Record<string, unknown>): Promise<string> {
  await ensureDataDir();
  const needsHeader = !existsSync(CSV_PATH);
  const row = [
    new Date().toISOString().split("T")[0],
    process.platform,
    params.disk_free_gb,
    params.disk_total_gb,
    params.battery_wear_pct ?? "",
    params.battery_cycles ?? "",
    params.ssd_health,
    params.firewall_on,
    params.encryption_on,
    params.pending_updates,
    params.uptime_days,
    params.is_deep_check,
  ].join(",");

  const content = needsHeader ? CSV_HEADER + "\n" + row + "\n" : row + "\n";
  await appendFile(CSV_PATH, content);
  return JSON.stringify({ status: "recorded", path: CSV_PATH, row });
}

async function handleReadHistory(): Promise<string> {
  await ensureDataDir();
  if (!existsSync(CSV_PATH)) return JSON.stringify({ status: "no_history", message: "No health checks recorded yet. This appears to be the first run." });
  return await readFile(CSV_PATH, "utf-8");
}

async function handleSetupSchedule(params: { frequency: string }): Promise<string> {
  const { frequency } = params;
  const platform = process.platform;

  if (platform === "darwin") {
    const cronMap: Record<string, string> = {
      weekly: "0 10 * * 1",     // Monday 10am
      monthly: "0 10 1 * *",    // 1st of month 10am
      quarterly: "0 10 1 1,4,7,10 *", // Jan/Apr/Jul/Oct 1st 10am
    };
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.laptop-care.maintenance</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>Claude</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    ${frequency === "weekly" ? "<key>Weekday</key><integer>1</integer>" : "<key>Day</key><integer>1</integer>"}
    <key>Hour</key><integer>10</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
</dict>
</plist>`;

    const plistPath = join(homedir(), "Library", "LaunchAgents", "com.laptop-care.maintenance.plist");
    await writeFile(plistPath, plist);
    await execCommand(`launchctl load "${plistPath}"`, "setup_schedule");
    return JSON.stringify({
      status: "scheduled",
      frequency,
      method: "launchd",
      path: plistPath,
      note: `Scheduled ${frequency} maintenance. Claude will open at 10am on the scheduled day. Say 'run my laptop maintenance' when it opens.`,
    });
  }

  if (platform === "win32") {
    const scheduleMap: Record<string, string> = {
      weekly: "/sc weekly /d MON /st 10:00",
      monthly: "/sc monthly /d 1 /st 10:00",
      quarterly: "/sc monthly /mo 3 /d 1 /st 10:00",
    };
    const cmd = `schtasks /create /tn "LaptopCare-Maintenance" /tr "cmd /c start claude:" ${scheduleMap[frequency]} /f`;
    const result = await execCommand(`powershell -NoProfile -Command "${cmd}"`, "setup_schedule");
    return JSON.stringify({
      status: "scheduled",
      frequency,
      method: "task_scheduler",
      note: `Scheduled ${frequency} maintenance via Windows Task Scheduler.`,
      result,
    });
  }

  return JSON.stringify({ error: `Unsupported platform: ${platform}` });
}

export async function startServer() {
  const server = new McpServer({
    name: "laptop-care",
    version: "0.1.0",
  });

  for (const tool of TOOLS) {
    const hasParams = Object.keys(tool.schema).length > 0;

    if (tool.name === "record_health") {
      server.tool(tool.name, tool.description, tool.schema, async (params: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: await handleRecordHealth(params) }],
      }));
    } else if (tool.name === "read_health_history") {
      server.tool(tool.name, tool.description, async () => ({
        content: [{ type: "text" as const, text: await handleReadHistory() }],
      }));
    } else if (tool.name === "setup_schedule") {
      server.tool(tool.name, tool.description, tool.schema, async (params: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: await handleSetupSchedule(params as { frequency: string }) }],
      }));
    } else {
      server.tool(tool.name, tool.description, async () => {
        const cmd = getCommand(tool.name);
        if (!cmd) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Not supported on ${process.platform}. This tool only works on macOS and Windows.` }) }],
          };
        }
        return {
          content: [{ type: "text" as const, text: await execCommand(cmd, tool.name) }],
        };
      });
    }
  }

  // Expose AGENT.md as a resource
  const agentMdPath = join(__dirname, "..", "AGENT.md");
  server.resource("agent-prompt", "laptop-care://agent-prompt", async (uri) => {
    const content = await readFile(agentMdPath, "utf-8");
    return { contents: [{ uri: uri.href, text: content, mimeType: "text/markdown" }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
