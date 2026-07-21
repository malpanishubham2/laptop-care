import { z } from "zod";

type ZodShape = Record<string, z.ZodType>;

export interface ToolDef {
  name: string;
  description: string;
  schema: ZodShape;
}

const EMPTY = {} as ZodShape;

export const TOOLS: ToolDef[] = [
  {
    name: "grant_consent",
    description: "[ASK-FIRST] Unlock the diagnostic tools for a first-time user. On a brand new install every scanning tool is locked and will refuse to run until this is called. Call it ONLY after you have introduced laptop-care to the user, told them what it reads and what it never touches, and they have explicitly agreed. Never call this preemptively or to get around a lock error. Returning users are unlocked automatically and do not need this.",
    schema: {
      user_agreed: z.boolean().describe("Set true only when the user has explicitly said yes to the scan in this conversation"),
    },
  },
  {
    name: "build_report_card",
    description: "[AUTO-SAFE] Generate the inspection report scaffold after finishing a diagnostic. Returns one row per check with a server-verified record of whether that check actually ran, plus the accurate tally. Call this before presenting results. You fill in the status and detail for rows that ran; you may not add rows, delete rows, or overwrite rows already marked 'Not checked'. Coverage comes from this tool, not from your own recollection of what you called.",
    schema: EMPTY,
  },
  {
    name: "analyze_trends",
    description: "[AUTO-SAFE] Compare the latest health check against this machine's own history and flag values that moved abnormally FOR THIS USER, rather than against generic thresholds. Use this on every returning run. It reports each metric's change since last check, the typical change for this machine, and marks anything moving faster than usual.",
    schema: EMPTY,
  },
  {
    name: "check_persistence_changes",
    description: "[AUTO-SAFE] Security check. Compares the current set of launch agents and daemons against the snapshot from the last run and reports what was ADDED or REMOVED since. New background agents are the primary way malware and unwanted software persist on macOS, so anything added that the user does not recognize deserves attention. On first run this records a baseline. Run this on every check.",
    schema: EMPTY,
  },
  {
    name: "cache_breakdown",
    description: "[AUTO-SAFE] Break down the cache directory by which application owns each chunk, largest first. Use this to explain WHY junk keeps coming back and name the specific culprits (Docker, Xcode, npm, browsers) instead of just reporting a total. Pair it with advice on capping the biggest offender permanently.",
    schema: EMPTY,
  },
  {
    name: "system_info",
    description: "[AUTO-SAFE] Get basic system identification: model, OS, CPU, RAM. Always run this first to identify the machine.",
    schema: EMPTY,
  },
  {
    name: "disk_space",
    description: "[AUTO-SAFE] Check disk space usage on all volumes. Returns free/total space per volume.",
    schema: EMPTY,
  },
  {
    name: "large_folders",
    description: "[AUTO-SAFE] Find the largest folders in the user's home directory. Helps identify what's consuming disk space.",
    schema: EMPTY,
  },
  {
    name: "temp_files_scan",
    description: "[AUTO-SAFE] Scan temporary file directories and caches. Reports sizes only, does NOT delete anything.",
    schema: EMPTY,
  },
  {
    name: "temp_files_clean",
    description: "[ASK-FIRST] Delete temporary files and caches. ALWAYS run temp_files_scan first and show the user what will be deleted before calling this.",
    schema: EMPTY,
  },
  {
    name: "os_update_check",
    description: "[AUTO-SAFE] Check for pending operating system updates.",
    schema: EMPTY,
  },
  {
    name: "battery_health",
    description: "[AUTO-SAFE] Check battery health: wear percentage, cycle count, design vs current capacity. Skip on desktops with no battery.",
    schema: EMPTY,
  },
  {
    name: "ssd_health",
    description: "[AUTO-SAFE] Check SSD/disk health via SMART data. Reports health status, wear level, error counts.",
    schema: EMPTY,
  },
  {
    name: "sleep_wake_log",
    description: "[AUTO-SAFE] Show recent sleep/wake events. Useful for diagnosing unexpected wake-ups or sleep failures.",
    schema: EMPTY,
  },
  {
    name: "security_status",
    description: "[AUTO-SAFE] Check security posture: firewall, antivirus/Defender, Gatekeeper/SIP status.",
    schema: EMPTY,
  },
  {
    name: "encryption_status",
    description: "[AUTO-SAFE] Check disk encryption status (FileVault on Mac, BitLocker on Windows).",
    schema: EMPTY,
  },
  {
    name: "startup_items",
    description: "[AUTO-SAFE] List programs that run at login/startup. Useful for identifying boot slowdowns.",
    schema: EMPTY,
  },
  {
    name: "boot_time",
    description: "[AUTO-SAFE] Show last boot time and current uptime.",
    schema: EMPTY,
  },
  {
    name: "firmware_check",
    description: "[AUTO-SAFE] Check BIOS/firmware/Boot ROM version.",
    schema: EMPTY,
  },
  {
    name: "backup_status",
    description: "[AUTO-SAFE] Check backup status (Time Machine on Mac, Windows Backup/Restore Points on Windows).",
    schema: EMPTY,
  },
  {
    name: "energy_report",
    description: "[ASK-FIRST] Run a power efficiency trace (30-60 seconds). Reports energy errors and warnings. May require admin on Windows.",
    schema: EMPTY,
  },
  {
    name: "system_integrity_check",
    description: "[ADMIN] Run system file integrity check. SFC on Windows, Disk Utility verify on Mac. Takes 5-10 minutes. Requires admin/elevated privileges on Windows. Warn the user about the time commitment before running.",
    schema: EMPTY,
  },
  {
    name: "record_health",
    description: "[AUTO-SAFE] Save current health metrics to the trend log (~/.laptop-care/health.csv). Call this after completing a health check to track changes over time.",
    schema: {
      disk_free_gb: z.number().describe("Free disk space in GB"),
      disk_total_gb: z.number().describe("Total disk space in GB"),
      battery_wear_pct: z.number().optional().describe("Battery wear percentage (omit if no battery)"),
      battery_cycles: z.number().optional().describe("Battery cycle count (omit if no battery)"),
      ssd_health: z.string().describe("SSD health status string"),
      firewall_on: z.boolean().describe("Whether firewall is enabled"),
      encryption_on: z.boolean().describe("Whether disk encryption is enabled"),
      pending_updates: z.number().describe("Number of pending OS updates"),
      uptime_days: z.number().describe("Current uptime in days"),
      is_deep_check: z.boolean().describe("Whether this was a quarterly deep check"),
    },
  },
  {
    name: "read_health_history",
    description: "[AUTO-SAFE] Read the health trend log. Returns all past health snapshots as CSV text. Use this to compare current state with previous checks, spot degradation trends, and determine if a deep check is due.",
    schema: EMPTY,
  },
  {
    name: "setup_schedule",
    description: "[ASK-FIRST] Set up automatic recurring maintenance checks. Creates a system-level scheduled task (launchd on Mac, Task Scheduler on Windows). Always ask the user which frequency they prefer before calling.",
    schema: {
      frequency: z.enum(["weekly", "monthly", "quarterly"]).describe("How often to run maintenance"),
    },
  },
  {
    name: "save_report",
    description: "[AUTO-SAFE] Save a maintenance report to ~/.laptop-care/reports/. Call this at the end of every maintenance run with the full markdown report. Returns the file path.",
    schema: {
      content: z.string().describe("Full markdown report content"),
      filename: z.string().optional().describe("Custom filename (default: YYYY-MM-DD.md)"),
    },
  },
  {
    name: "list_reports",
    description: "[AUTO-SAFE] List all saved maintenance reports with dates. Useful for reviewing past reports or finding a specific one.",
    schema: EMPTY,
  },
  {
    name: "get_report",
    description: "[AUTO-SAFE] Read a previously saved maintenance report by filename.",
    schema: {
      filename: z.string().describe("Report filename (e.g. 2026-07-21.md)"),
    },
  },
  {
    name: "save_issues",
    description: "[AUTO-SAFE] Save the list of issues found during a maintenance run. Tracks which issues are new, fixed, or still pending. Call after presenting findings to the user.",
    schema: {
      issues: z.array(z.object({
        id: z.string().describe("Short unique ID like 'disk-low' or 'battery-wear'"),
        severity: z.enum(["critical", "warning", "info"]),
        title: z.string().describe("Short title like 'Disk space low'"),
        detail: z.string().describe("What was found"),
        recommendation: z.string().describe("What Claude recommends"),
        fixable: z.boolean().describe("Whether laptop-care can fix this automatically"),
        status: z.enum(["open", "fixed", "skipped", "user-action-needed"]),
      })).describe("Array of issues found"),
    },
  },
  {
    name: "get_pending_issues",
    description: "[AUTO-SAFE] Get unresolved issues from the last maintenance run. Shows what was skipped or still needs attention. Use at the start of a new run to follow up.",
    schema: EMPTY,
  },
  {
    name: "empty_trash",
    description: "[ASK-FIRST] Empty the Trash (Mac) or Recycle Bin (Windows). Show the user the trash size first and confirm before running.",
    schema: EMPTY,
  },
  {
    name: "flush_dns",
    description: "[ASK-FIRST] Clear the DNS resolver cache. Safe but may briefly slow DNS lookups. Useful if the user reports connectivity issues.",
    schema: EMPTY,
  },
];
