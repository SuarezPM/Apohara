#!/usr/bin/env node
import { Command } from "commander";
import { autoCommand } from "./commands/auto.js";
import { configCommand } from "./commands/config.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const program = new Command();

program.name("apohara").description("Apohara CLI").version(packageJson.version);

program.addCommand(configCommand);
program.addCommand(autoCommand);
program.addCommand(dashboardCommand);
program.addCommand(uninstallCommand);

program.parse(process.argv);
