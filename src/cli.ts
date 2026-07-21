#!/usr/bin/env node

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { startServer } from "./index.js";

const CLAUDE_CONFIG_PATHS: Record<string, string> = {
  darwin: join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  win32: join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json"),
};

async function setup() {
  const configPath = CLAUDE_CONFIG_PATHS[process.platform];
  if (!configPath) {
    console.log(`Unsupported platform: ${process.platform}. Manually add laptop-care to your MCP client config.`);
    process.exit(1);
  }

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(await readFile(configPath, "utf-8"));
    } catch {
      console.log(`Could not parse existing config at ${configPath}. Creating new one.`);
    }
  }

  const servers = (config.mcpServers || {}) as Record<string, unknown>;
  if (servers["laptop-care"]) {
    console.log("laptop-care is already configured in Claude Desktop.");
    console.log("Restart Claude Desktop if you haven't already, then say: run my laptop maintenance");
    return;
  }

  servers["laptop-care"] = {
    command: "npx",
    args: ["-y", "laptop-care"],
  };
  config.mcpServers = servers;

  await writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(`Added laptop-care to ${configPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Restart Claude Desktop");
  console.log('  2. Say: "run my laptop maintenance"');
  console.log("");
  console.log("That's it. laptop-care will introduce itself and run your first health check.");
}

const command = process.argv[2];

switch (command) {
  case "setup":
    setup().catch((e) => {
      console.error("Setup failed:", e.message);
      process.exit(1);
    });
    break;
  case "help":
    console.log("laptop-care: cross-platform laptop maintenance agent");
    console.log("");
    console.log("Commands:");
    console.log("  npx laptop-care setup     Add to Claude Desktop config automatically");
    console.log("  npx laptop-care help      Show this help");
    console.log("  npx laptop-care           Start MCP server (called by Claude Desktop)");
    console.log("");
    console.log('After setup, open Claude Desktop and say: "run my laptop maintenance"');
    break;
  default:
    startServer().catch((e) => {
      console.error("Server failed to start:", e.message);
      process.exit(1);
    });
}
