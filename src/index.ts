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
const PERSIST_PATH = join(DATA_DIR, "persistence.json");
const CSV_HEADER = "date,platform,disk_free_gb,disk_total_gb,battery_wear_pct,battery_cycles,ssd_health,firewall_on,encryption_on,pending_updates,uptime_days,is_deep_check";

// --- Consent interlock ---
// On a brand new install the scanning tools are locked in code, not just by
// instructions. The model cannot scan before onboarding the user even if it
// ignores the playbook. Returning users are unlocked automatically, since an
// existing health.csv is proof they consented on a previous run.

let consentGranted = false;

const CONSENT_EXEMPT = new Set([
  "start_maintenance",
  "grant_consent",
  "read_health_history",
  "get_pending_issues",
  "list_reports",
  "get_report",
]);

function isLocked(toolName: string): boolean {
  if (CONSENT_EXEMPT.has(toolName)) return false;
  if (consentGranted) return false;
  return !existsSync(CSV_PATH);
}

const LOCKED_RESPONSE = JSON.stringify({
  error: "CONSENT_REQUIRED",
  message:
    "This tool is locked because this is a first-time user who has not yet agreed to a scan. Do not retry and do not try another tool, they are all locked. Introduce laptop-care first: say what it reads, what it never touches without asking, and that all data stays on this machine. Then ask permission and wait for the user to answer. Once they agree, call grant_consent and continue.",
});

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

  let filename = params.filename as string | undefined;
  if (!filename) {
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    filename = `${date}.md`;
    // A second run on the same day must not silently destroy the first
    // report, so fall back to a time-stamped name once the date is taken.
    if (existsSync(join(REPORTS_DIR, filename))) {
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      filename = `${date}-${hh}${mm}.md`;
    }
  }

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

async function handleGrantConsent(params: Record<string, unknown>): Promise<string> {
  if (params.user_agreed !== true) {
    return JSON.stringify({
      status: "not_granted",
      message: "user_agreed was not true. Ask the user for permission and wait for a clear yes before calling this again.",
    });
  }
  consentGranted = true;
  return JSON.stringify({
    status: "granted",
    message: "Diagnostic tools unlocked. Proceed with the full scan, then present the dashboard and recommendations and stop before changing anything.",
  });
}

// Compares each metric against this machine's own history rather than against
// invented global thresholds. A 7 GB drop is only meaningful next to what this
// machine normally does.
async function handleAnalyzeTrends(): Promise<string> {
  await ensureDataDir();
  if (!existsSync(CSV_PATH)) {
    return JSON.stringify({ status: "no_history", message: "No history yet. Baselines start after the first recorded check." });
  }
  const lines = (await readFile(CSV_PATH, "utf-8")).trim().split("\n");
  if (lines.length < 3) {
    return JSON.stringify({
      status: "insufficient_history",
      checks_recorded: Math.max(0, lines.length - 1),
      message: "Need at least 2 recorded checks to compare, and about 4 before typical movement is meaningful. Report current values plainly and say trends begin next run.",
    });
  }

  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  const numeric = ["disk_free_gb", "battery_wear_pct", "battery_cycles", "pending_updates", "uptime_days"];
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];

  const metrics = numeric.map((name) => {
    const i = header.indexOf(name);
    if (i === -1) return null;
    const cur = parseFloat(latest[i]);
    const prev = parseFloat(previous[i]);
    if (isNaN(cur) || isNaN(prev)) return null;

    const deltas: number[] = [];
    for (let r = 1; r < rows.length; r++) {
      const a = parseFloat(rows[r - 1][i]);
      const b = parseFloat(rows[r][i]);
      if (!isNaN(a) && !isNaN(b)) deltas.push(b - a);
    }
    const change = cur - prev;
    // Baseline must exclude the change being tested. Including it lets a large
    // jump inflate the very number it is compared against, hiding the anomaly.
    const priorMagnitudes = deltas.slice(0, -1).map(Math.abs);
    const typical = priorMagnitudes.length
      ? priorMagnitudes.reduce((s, v) => s + v, 0) / priorMagnitudes.length
      : 0;
    // 2x prior norm, with an absolute floor so tiny counters do not cry wolf.
    const abnormal = typical > 0 && Math.abs(change) > typical * 2 && Math.abs(change) > 1;

    return {
      metric: name,
      current: cur,
      previous: prev,
      change: Number(change.toFixed(2)),
      typical_change_for_this_machine: Number(typical.toFixed(2)),
      abnormal,
      note: abnormal
        ? `Moved ${Math.abs(change).toFixed(1)} versus a typical ${typical.toFixed(1)} for this machine. Worth explaining to the user.`
        : "Within normal range for this machine.",
    };
  }).filter(Boolean);

  return JSON.stringify({
    status: "ok",
    checks_recorded: rows.length,
    comparing: { from: previous[0], to: latest[0] },
    metrics,
    guidance: "Lead with anything marked abnormal. Describe changes relative to this machine's own pattern, not generic limits.",
  }, null, 2);
}

// Change detection on the macOS/Windows persistence layer. What is new since
// last run matters far more than the full inventory.
async function handlePersistenceChanges(): Promise<string> {
  await ensureDataDir();
  const cmd = getCommand("startup_items");
  if (!cmd) return JSON.stringify({ error: `Not supported on ${process.platform}` });

  const raw = await execCommand(cmd, "startup_items");
  const current = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("===") && !l.startsWith("GUI login items") && l !== "(none)");

  if (!existsSync(PERSIST_PATH)) {
    await writeFile(PERSIST_PATH, JSON.stringify({ recorded: new Date().toISOString(), items: current }, null, 2));
    return JSON.stringify({
      status: "baseline_recorded",
      total_items: current.length,
      message: `Recorded ${current.length} startup agents and daemons as the baseline. From the next run onward this reports only what changed, which is the part worth reading.`,
    });
  }

  const prior = JSON.parse(await readFile(PERSIST_PATH, "utf-8"));
  const before: string[] = prior.items || [];
  const added = current.filter((i) => !before.includes(i));
  const removed = before.filter((i) => !current.includes(i));

  await writeFile(PERSIST_PATH, JSON.stringify({ recorded: new Date().toISOString(), items: current }, null, 2));

  return JSON.stringify({
    status: "ok",
    since: prior.recorded,
    total_items: current.length,
    added,
    removed,
    guidance: added.length
      ? "New background agents appeared. Name each one, say which app it likely belongs to, and ask the user whether they installed that app recently. Anything they do not recognize should be treated as worth investigating, since this is how unwanted software persists."
      : "No new startup agents since last check. Say so briefly, it is a genuinely good sign.",
  }, null, 2);
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
  grant_consent: handleGrantConsent,
  analyze_trends: () => handleAnalyzeTrends(),
  check_persistence_changes: () => handlePersistenceChanges(),
};

export async function startServer() {
  // AGENT.md is the single source of truth for agent behavior. It is delivered
  // three ways so the model always has it: server instructions (pushed on
  // connect), the start_maintenance tool, and a readable resource.
  const agentMdPath = join(__dirname, "..", "AGENT.md");
  const agentMd = await readFile(agentMdPath, "utf-8");

  const server = new McpServer(
    { name: "laptop-care", version: "0.5.1" },
    { instructions: agentMd }
  );

  // Safety net: if the client ignores server instructions, this tool hands the
  // model the full playbook. Its description steers the model here first.
  server.tool(
    "start_maintenance",
    "[AUTO-SAFE] ALWAYS CALL THIS FIRST when the user mentions laptop maintenance, a health check, a checkup, cleaning up their machine, or anything about how their laptop is doing. Returns the maintenance playbook you must follow: the onboarding flow for new users, the report format, escalation thresholds, and safety rules. Do not call any other laptop-care tool before this one. Note: for first-time users the playbook requires you to introduce yourself and get permission BEFORE running any diagnostic, so do not start scanning after calling this.",
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

    // Every tool routes through the consent interlock first.
    const guard = async (run: () => Promise<string>): Promise<string> =>
      isLocked(tool.name) ? LOCKED_RESPONSE : await run();

    if (handler) {
      if (hasParams) {
        server.tool(tool.name, tool.description, tool.schema, async (params: Record<string, unknown>) => ({
          content: [{ type: "text" as const, text: await guard(() => handler(params)) }],
        }));
      } else {
        server.tool(tool.name, tool.description, async () => ({
          content: [{ type: "text" as const, text: await guard(() => handler({})) }],
        }));
      }
    } else {
      server.tool(tool.name, tool.description, async () => ({
        content: [{
          type: "text" as const,
          text: await guard(async () => {
            const cmd = getCommand(tool.name);
            if (!cmd) return JSON.stringify({ error: `Not supported on ${process.platform}` });
            return await execCommand(cmd, tool.name);
          }),
        }],
      }));
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
