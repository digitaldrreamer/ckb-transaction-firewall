import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  proposerName?: string;
}

export function getConfigPath(): string {
  return join(homedir(), ".ckb-firewall", "config.json");
}

export function loadConfig(): CliConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const config: CliConfig = {};
    if (typeof (raw as Record<string, unknown>).proposerName === "string") {
      config.proposerName = (raw as Record<string, unknown>).proposerName as string;
    }
    return config;
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  const path = getConfigPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch (err) {
    throw new Error(`Failed to write config file at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
