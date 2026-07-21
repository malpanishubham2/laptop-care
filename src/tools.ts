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
    description: "[AUTO-SAFE] Scan temporary file directories and caches — report sizes only, does NOT delete anything.",
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
    description: "[ADMIN] Run system file integrity check — SFC on Windows, Disk Utility verify on Mac. Takes 5-10 minutes. Requires admin/elevated privileges on Windows. Warn the user about the time commitment before running.",
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
];
