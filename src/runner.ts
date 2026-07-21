import { exec } from "child_process";
import { promisify } from "util";

const run = promisify(exec);

const TIMEOUTS: Record<string, number> = {
  system_integrity_check: 600_000,
  energy_report: 120_000,
  large_folders: 120_000,
};

const DEFAULT_TIMEOUT = 60_000;

export async function execCommand(cmd: string, toolName?: string): Promise<string> {
  try {
    const timeout = (toolName && TIMEOUTS[toolName]) || DEFAULT_TIMEOUT;
    const { stdout, stderr } = await run(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 });
    return stdout || stderr || "(no output)";
  } catch (e: unknown) {
    const err = e as { message?: string; stderr?: string; killed?: boolean };
    if (err.killed) return JSON.stringify({ error: "Command timed out" });
    return JSON.stringify({ error: err.message, stderr: err.stderr });
  }
}
