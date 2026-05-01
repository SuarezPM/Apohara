#!/usr/bin/env node
import { Command } from "commander";
import { autoCommand } from "./commands/auto.js";
import { configCommand } from "./commands/config.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const program = new Command();

program.name("clarity").description("Clarity CLI").version(packageJson.version);

program.addCommand(configCommand);
program.addCommand(autoCommand);
program.addCommand(dashboardCommand);

program.parse(process.argv);
