import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, appendFile, mkdir, writeFile, readdir } from "fs/promises";
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
const REPORTS_DIR = join(DATA_DIR, "reports");
const ISSUES_PATH = join(DATA_DIR, "issues.json");
const CSV_HEADER = "date,platform,disk_free_gb,disk_total_gb,battery_wear_pct,battery_cycles,ssd_health,firewall_on,encryption_on,pending_updates,uptime_days,is_deep_check";

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(REPORTS_DIR)) await mkdir(REPORTS_DIR, { recursive: true });
}

// --- Handlers for custom tools ---

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

async function handleSaveReport(params: Record<string, unknown>): Promise<string> {
  await ensureDataDir();
  const filename = (params.filename as string) || `${new Date().toISOString().split("T")[0]}.md`;
  const filepath = join(REPORTS_DIR, filename);
  await writeFile(filepath, params.content as string);
  return JSON.stringify({ status: "saved", path: filepath, filename });
}

async function handleListReports(): Promise<string> {
  await ensureDataDir();
  if (!existsSync(REPORTS_DIR)) return JSON.stringify({ reports: [] });
  const files = await readdir(REPORTS_DIR);
  const reports = files.filter(f => f.endsWith(".md")).sort().reverse();
  return JSON.stringify({ reports, directory: REPORTS_DIR });
}

async function handleGetReport(params: Record<string, unknown>): Promise<string> {
  const filepath = join(REPORTS_DIR, params.filename as string);
  if (!existsSync(filepath)) return JSON.stringify({ error: `Report not found: ${params.filename}` });
  return await readFile(filepath, "utf-8");
}

async function handleSaveIssues(params: Record<string, unknown>): Promise<string> {
  await ensureDataDir();
  const data = {
    last_updated: new Date().toISOString(),
    issues: params.issues,
  };
  await writeFile(ISSUES_PATH, JSON.stringify(data, null, 2));
  return JSON.stringify({ status: "saved", path: ISSUES_PATH, count: (params.issues as unknown[]).length });
}

async function handleGetPendingIssues(): Promise<string> {
  await ensureDataDir();
  if (!existsSync(ISSUES_PATH)) return JSON.stringify({ status: "no_issues", message: "No prior issues tracked. This may be the first run." });
  const data = JSON.parse(await readFile(ISSUES_PATH, "utf-8"));
  const pending = (data.issues as Array<{ status: string }>).filter(
    (i) => i.status === "open" || i.status === "user-action-needed"
  );
  return JSON.stringify({ last_updated: data.last_updated, pending, total: data.issues.length });
}

async function handleSetupSchedule(params: { frequency: string }): Promise<string> {
  const { frequency } = params;
  const platform = process.platform;

  if (platform === "darwin") {
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

// --- Tool dispatch map ---

const CUSTOM_HANDLERS: Record<string, (params: Record<string, unknown>) => Promise<string>> = {
  record_health: handleRecordHealth,
  read_health_history: () => handleReadHistory(),
  save_report: handleSaveReport,
  list_reports: () => handleListReports(),
  get_report: handleGetReport,
  save_issues: handleSaveIssues,
  get_pending_issues: () => handleGetPendingIssues(),
  setup_schedule: (p) => handleSetupSchedule(p as { frequency: string }),
};

export async function startServer() {
  const server = new McpServer({
    name: "laptop-care",
    version: "0.2.0",
  });

  for (const tool of TOOLS) {
    const handler = CUSTOM_HANDLERS[tool.name];
    const hasParams = Object.keys(tool.schema).length > 0;

    if (handler) {
      if (hasParams) {
        server.tool(tool.name, tool.description, tool.schema, async (params: Record<string, unknown>) => ({
          content: [{ type: "text" as const, text: await handler(params) }],
        }));
      } else {
        server.tool(tool.name, tool.description, async () => ({
          content: [{ type: "text" as const, text: await handler({}) }],
        }));
      }
    } else {
      server.tool(tool.name, tool.description, async () => {
        const cmd = getCommand(tool.name);
        if (!cmd) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Not supported on ${process.platform}` }) }] };
        }
        return { content: [{ type: "text" as const, text: await execCommand(cmd, tool.name) }] };
      });
    }
  }

  // Expose AGENT.md as a resource
  const agentMdPath = join(__dirname, "..", "AGENT.md");
  server.resource("agent-prompt", "laptop-care://agent-prompt", async (uri) => {
    const content = await readFile(agentMdPath, "utf-8");
    return { contents: [{ uri: uri.href, text: content, mimeType: "text/markdown" }] };
  });

  // Register MCP prompts for Claude Desktop prompt picker
  server.prompt("run-maintenance", "Run a full laptop health check. Scans disk, battery, SSD, security, and more, then recommends fixes", async () => ({
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text: "Run my full laptop maintenance check. Start by reading the laptop-care agent prompt resource for instructions, then check for any pending issues from last time, and run all the health checks. Give me a detailed report with your recommendations and save everything." },
    }],
  }));

  server.prompt("quick-check", "Quick 2-minute laptop health snapshot, just the essentials", async () => ({
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text: "Do a quick laptop health check, just disk space, battery, and security status. Keep it brief, flag anything that needs attention." },
    }],
  }));

  server.prompt("show-trends", "Show health trends over time from past maintenance runs", async () => ({
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text: "Show me my laptop health trends over time. Read the health history and any pending issues, then give me a summary of how things are trending, what's improving, what's getting worse, and what needs attention." },
    }],
  }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
