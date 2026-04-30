#!/usr/bin/env bun
import { Command } from "commander";
import { configCommand } from "./commands/config.js";

const program = new Command();

program
	.name("clarity")
	.description("Clarity CLI")
	.version("1.0.0");

program.addCommand(configCommand);

program.parse(process.argv);
