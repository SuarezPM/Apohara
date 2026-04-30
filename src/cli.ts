#!/usr/bin/env bun
import { Command } from "commander";
import { autoCommand } from "./commands/auto.js";
import { configCommand } from "./commands/config.js";
import { dashboardCommand } from "./commands/dashboard.js";

const program = new Command();

program.name("clarity").description("Clarity CLI").version("1.0.0");

program.addCommand(configCommand);
program.addCommand(autoCommand);
program.addCommand(dashboardCommand);

program.parse(process.argv);
