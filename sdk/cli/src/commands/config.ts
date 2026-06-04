import chalk from "chalk";
import inquirer from "inquirer";
import { getConfigPath, loadConfig, saveConfig } from "../lib/config.js";

export async function configCommand(opts: { proposer?: string }): Promise<void> {
  try {
  const config = loadConfig();

  if (opts.proposer !== undefined) {
    const name = opts.proposer.trim();
    if (!name) {
      process.stderr.write(chalk.red("Error: proposer name cannot be empty\n"));
      process.exit(1);
    }
    config.proposerName = name;
    saveConfig(config);
    process.stdout.write(chalk.green(`✓ Default proposer name saved: ${chalk.bold(name)}\n`));
    return;
  }

  // No flag — show current config and offer interactive edit.
  process.stdout.write(`Config: ${chalk.dim(getConfigPath())}\n\n`);
  process.stdout.write(
    `  proposer  ${config.proposerName ? chalk.cyan(config.proposerName) : chalk.dim("(not set)")}\n\n`,
  );

  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "Set proposer name", value: "set" },
        { name: "Clear proposer name", value: "clear" },
        { name: "Exit", value: "exit" },
      ],
    },
  ]);

  if (action === "exit") return;

  if (action === "clear") {
    delete config.proposerName;
    saveConfig(config);
    process.stdout.write(chalk.green("✓ Proposer name cleared\n"));
    return;
  }

  const { name } = await inquirer.prompt<{ name: string }>([
    {
      type: "input",
      name: "name",
      message: "Proposer name / handle:",
      ...(config.proposerName ? { default: config.proposerName } : {}),
      validate: (v: string) => v.trim().length > 0 || "Required.",
    },
  ]);
  config.proposerName = name.trim();
  saveConfig(config);
  process.stdout.write(chalk.green(`✓ Default proposer name saved: ${chalk.bold(config.proposerName)}\n`));
  } catch (err) {
    process.stderr.write(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
}
