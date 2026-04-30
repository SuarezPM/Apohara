import { Command } from "commander";
import { spawn } from "bun";

const RUN_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function validateRunId(runId: string): boolean {
	return RUN_ID_REGEX.test(runId);
}

export const dashboardCommand = new Command("dashboard")
	.description("Launch the interactive TUI dashboard")
	.option("-r, --run <id>", "Load a specific run by ID (alphanumeric, hyphen, underscore only)")
	.action(async (options: { run?: string }) => {
		if (options.run && !validateRunId(options.run)) {
			console.error(
				"❌ Invalid run ID. Only alphanumeric characters, hyphens, and underscores are allowed.",
			);
			process.exit(1);
		}

		const env = { ...process.env };
		if (options.run) {
			env.CLARITY_RUN_ID = options.run;
		}

		const proc = spawn(["bun", "run", "src/tui/app.tsx"], {
			stdio: ["inherit", "inherit", "inherit"],
			env,
		});

		await proc.exited;
	});
