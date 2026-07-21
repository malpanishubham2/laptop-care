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

// --- Execution log ---
// Records what actually ran this session so coverage claims come from real
// execution rather than the model's recollection.

const ran = new Map<string, { ok: boolean; at: number }>();

function didRun(tool: string): boolean {
  return ran.get(tool)?.ok === true;
}

// --- Sequencing gates ---
// Turns "never clean without scanning first" from an instruction into a
// precondition. The model cannot skip the scan even if it ignores the playbook.

const REQUIRES: Record<string, { needs: string[]; why: string }> = {
  temp_files_clean: {
    needs: ["temp_files_scan"],
    why: "Run temp_files_scan first and show the user what will be deleted. Deleting before showing them is not allowed.",
  },
  empty_trash: {
    needs: ["temp_files_scan"],
    why: "Run temp_files_scan first so you can tell the user how large the Trash is before emptying it.",
  },
  save_report: {
    needs: ["disk_space"],
    why: "Run the diagnostic before saving a report. A report with no scan behind it is fabricated.",
  },
  record_health: {
    needs: ["disk_space"],
    why: "Run the diagnostic before recording health metrics, otherwise the trend log gets values that were never measured.",
  },
};

function unmetPrereq(tool: string): string | null {
  const rule = REQUIRES[tool];
  if (!rule) return null;
  const missing = rule.needs.filter((n) => !didRun(n));
  if (!missing.length) return null;
  return JSON.stringify({
    error: "PREREQUISITE_NOT_MET",
    missing,
    message: rule.why,
  });
}

// --- Report card ---
// The server owns which rows exist and whether each was genuinely checked.
// The model supplies status and detail only for rows that actually ran, so it
// cannot claim coverage it does not have or pad the tally.

const CARD_ROWS: Array<{ category: string; label: string; tool: string }> = [
  { category: "STORAGE", label: "Disk space", tool: "disk_space" },
  { category: "STORAGE", label: "Largest folders", tool: "large_folders" },
  { category: "STORAGE", label: "Cache and temp files", tool: "temp_files_scan" },
  { category: "STORAGE", label: "Cache composition", tool: "cache_breakdown" },
  { category: "POWER", label: "Battery health", tool: "battery_health" },
  { category: "POWER", label: "Sleep and wake", tool: "sleep_wake_log" },
  { category: "POWER", label: "Uptime", tool: "boot_time" },
  { category: "HARDWARE", label: "SSD health", tool: "ssd_health" },
  { category: "HARDWARE", label: "Firmware", tool: "firmware_check" },
  { category: "SECURITY", label: "Firewall and Gatekeeper", tool: "security_status" },
  { category: "SECURITY", label: "Disk encryption", tool: "encryption_status" },
  { category: "SECURITY", label: "Startup agents", tool: "startup_items" },
  { category: "SECURITY", label: "Persistence changes", tool: "check_persistence_changes" },
  { category: "MAINTENANCE", label: "OS updates", tool: "os_update_check" },
  { category: "MAINTENANCE", label: "Backup", tool: "backup_status" },
];

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

// Builds the inspection card from the execution log rather than from the
// model's memory of what it did. Coverage is a fact here, not a claim.
async function handleBuildReportCard(): Promise<string> {
  const rows = CARD_ROWS.map((r) => {
    const rec = ran.get(r.tool);
    if (rec?.ok) {
      return { category: r.category, label: r.label, checked: true, status: null, detail: null };
    }
    return {
      category: r.category,
      label: r.label,
      checked: false,
      status: "Not checked",
      detail: rec ? "The check ran but failed." : "This check was not run.",
    };
  });

  const completed = rows.filter((r) => r.checked).length;
  const isFirstRun = !existsSync(CSV_PATH);

  return JSON.stringify({
    total_points: CARD_ROWS.length,
    checks_completed: completed,
    checks_missing: CARD_ROWS.length - completed,
    first_run: isFirstRun,
    rows,
    how_to_use: [
      "These rows are generated from what actually executed this session. Do not add rows, remove rows, or change any row where checked is false.",
      "For each row where checked is true, fill in status and detail yourself. Status must be exactly one of: Good, Watch, Action, Ask, Baseline.",
      "Rows already marked 'Not checked' stay that way. Show them. A missing check is information the user is entitled to.",
      "Render as a MARKDOWN TABLE with columns: Area, Check, Status, Detail. Do not use a code block and do not hand-align with spaces, the alignment will come out crooked. Put the area name on the first row of each group and leave it blank on the rest. Put the tally in a sentence under the table.",
      isFirstRun
        ? "This is a first run, so show the full card."
        : "This is a returning user. Prefer the compact three section summary and lead with what changed, unless they ask for the full card.",
    ],
  }, null, 2);
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
  build_report_card: () => handleBuildReportCard(),
};

export async function startServer() {
  // The playbook is split by lifecycle stage rather than by topic, because a
  // returning user never needs the onboarding workflow and vice versa. Only the
  // kernel is pushed on connect. start_maintenance decides in code which
  // workflow to hand over, so nobody loads instructions they cannot use.
  const promptDir = join(__dirname, "..", "prompts");
  const [kernel, shared, firstRun, returningRun] = await Promise.all([
    readFile(join(promptDir, "kernel.md"), "utf-8"),
    readFile(join(promptDir, "shared.md"), "utf-8"),
    readFile(join(promptDir, "first-run.md"), "utf-8"),
    readFile(join(promptDir, "returning-run.md"), "utf-8"),
  ]);

  const server = new McpServer(
    { name: "laptop-care", version: "0.9.1" },
    { instructions: kernel }
  );

  server.tool(
    "start_maintenance",
    "[AUTO-SAFE] ALWAYS CALL THIS FIRST when the user mentions laptop maintenance, a health check, a checkup, cleaning up their machine, or anything about how their laptop is doing. Returns the workflow for this specific user, either first-time onboarding or a returning follow-up, plus the judgment and formatting rules. Do not call any other laptop-care tool before this one. For first-time users the workflow requires you to introduce yourself and get permission BEFORE running any diagnostic, so do not start scanning after calling this.",
    async () => {
      const isFirstRun = !existsSync(CSV_PATH);
      const workflow = isFirstRun ? firstRun : returningRun;
      const closing = isFirstRun
        ? "This is a FIRST RUN. This person has never used laptop-care. Follow the first-run workflow above exactly, including the stop after your introduction. Do not scan before they agree, and the scanning tools are locked until you call grant_consent, so attempting it will simply fail."
        : "This is a RETURNING user, so skip the introduction and consent step, they have already been through it. Start with get_pending_issues to pick up anything left open last time, then run the diagnostic and lead with what changed.";

      return {
        content: [{
          type: "text" as const,
          text: `${workflow}\n\n---\n\n${shared}\n\n---\n\n${closing}`,
        }],
      };
    }
  );

  for (const tool of TOOLS) {
    const handler = CUSTOM_HANDLERS[tool.name];
    const hasParams = Object.keys(tool.schema).length > 0;

    // Every tool routes through the consent interlock, then the sequencing
    // gates, then gets recorded in the execution log.
    const guard = async (run: () => Promise<string>): Promise<string> => {
      if (isLocked(tool.name)) return LOCKED_RESPONSE;

      const blocked = unmetPrereq(tool.name);
      if (blocked) return blocked;

      try {
        const out = await run();
        // A command that returned a JSON error object did not really succeed,
        // so the report card must not count it as a completed check.
        const failed = out.trimStart().startsWith("{") && out.includes('"error"');
        ran.set(tool.name, { ok: !failed, at: Date.now() });
        return out;
      } catch (e) {
        ran.set(tool.name, { ok: false, at: Date.now() });
        throw e;
      }
    };

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

  // The full playbook stays readable as a resource for inspection, assembled
  // from the same files the server uses. No second copy to drift.
  server.resource("agent-prompt", "laptop-care://agent-prompt", async (uri) => ({
    contents: [{
      uri: uri.href,
      text: [kernel, firstRun, returningRun, shared].join("\n\n---\n\n"),
      mimeType: "text/markdown",
    }],
  }));

  // The prompt points at start_maintenance rather than inlining the playbook,
  // so it picks up the right workflow for whoever runs it.
  server.prompt("run-maintenance", "Run a full laptop health check. Scans disk, battery, SSD, security, and more, then recommends fixes", async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "Run my full laptop maintenance check. Call start_maintenance first to load the workflow, then follow it exactly: run the diagnostic, build the inspection report, give me your recommendations, act on what I approve, and save the report at the end.",
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
