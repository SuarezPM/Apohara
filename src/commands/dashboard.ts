import { Command } from "commander";
import { spawn } from "../lib/spawn";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RUN_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function validateRunId(runId: string): boolean {
	return RUN_ID_REGEX.test(runId);
}

/**
 * Resolves the TUI entry point path relative to the project root.
 * Works both when running from source (bun run) and from compiled bundle (node).
 */
function getTuiPath(): string {
	// Get the directory of this file (src/commands/)
	const currentFile = fileURLToPath(import.meta.url);
	const currentDir = dirname(currentFile);

	// Detect if we're in dist/ or src/ based on the path
	const isCompiled = currentDir.includes("/dist/");

	if (isCompiled) {
		// When compiled: dist/commands/dashboard.js -> go up to project root -> tui/cli.tsx
		const projectRoot = dirname(dirname(dirname(currentDir)));
		return join(projectRoot, "tui", "cli.tsx");
	} else {
		// When running from source: src/commands/dashboard.ts -> go up to project root -> src/tui/cli.tsx
		const projectRoot = dirname(dirname(currentDir));
		return join(projectRoot, "src", "tui", "cli.tsx");
	}
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
			env.APOHARA_RUN_ID = options.run;
		}

		const tuiPath = getTuiPath();
		const proc = spawn(["bun", "run", tuiPath], {
			stdio: ["inherit", "inherit", "inherit"],
			env,
		});

		await proc.exited;
	});
