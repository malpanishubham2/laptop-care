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
  // AGENT.md is the single source of truth for agent behavior. It is delivered
  // three ways so the model always has it: server instructions (pushed on
  // connect), the start_maintenance tool, and a readable resource.
  const agentMdPath = join(__dirname, "..", "AGENT.md");
  const agentMd = await readFile(agentMdPath, "utf-8");

  const server = new McpServer(
    { name: "laptop-care", version: "0.3.0" },
    { instructions: agentMd }
  );

  // Safety net: if the client ignores server instructions, this tool hands the
  // model the full playbook. Its description steers the model here first.
  server.tool(
    "start_maintenance",
    "[AUTO-SAFE] ALWAYS CALL THIS FIRST when the user mentions laptop maintenance, a health check, a checkup, cleaning up their machine, or anything about how their laptop is doing. Returns the maintenance playbook you must follow: the onboarding flow for new users, the report format, escalation thresholds, and safety rules. Do not call any other laptop-care tool before this one.",
    async () => ({
      content: [{
        type: "text" as const,
        text: agentMd + "\n\n---\n\nYou have just loaded the laptop-care playbook. Follow it exactly. Begin now by calling read_health_history and get_pending_issues to determine whether this is a first run or a returning user, then proceed with the matching workflow above.",
      }],
    })
  );

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

  // Expose AGENT.md as a readable resource too
  server.resource("agent-prompt", "laptop-care://agent-prompt", async (uri) => ({
    contents: [{ uri: uri.href, text: agentMd, mimeType: "text/markdown" }],
  }));

  // Prompts carry the playbook inline so they work even if the client never
  // surfaces server instructions or reads the resource.
  server.prompt("run-maintenance", "Run a full laptop health check. Scans disk, battery, SSD, security, and more, then recommends fixes", async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: `Run my full laptop maintenance check, following this playbook exactly:\n\n${agentMd}\n\n---\n\nStart now. Call read_health_history and get_pending_issues first to figure out if this is my first run or a follow-up, then run the matching workflow. Present the dashboard and your recommendations, act on what I approve, and save the report and issues at the end.`,
      },
    }],
  }));

  server.prompt("quick-check", "Quick 2-minute laptop health snapshot, just the essentials", async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "Do a quick laptop health check using the laptop-care tools: disk space, battery, and security status only. Present it as a short status list, not raw command output. Flag anything that crosses these lines: disk under 20% free, battery wear over 40%, firewall off, or encryption off. Keep the whole thing under 10 lines. Skip saving a report.",
      },
    }],
  }));

  server.prompt("show-trends", "Show health trends over time from past maintenance runs", async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "Show me my laptop health trends. Call read_health_history and get_pending_issues, then give me a table comparing my most recent check against earlier ones, with the change for each metric. Call out what is getting worse, what is stable, and what still needs my attention. If there is only one recorded check, say so and tell me what you will be able to compare next time.",
      },
    }],
  }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
