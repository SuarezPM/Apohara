import * as fs from "node:fs/promises";
import { Command } from "commander";
import {
	ensureDir,
	getConfigDir,
	getCredentialsPath,
	showPaths,
} from "../lib/paths.js";

const CREDENTIALS_TEMPLATE = {
	OPENCODE_API_KEY: "",
	DEEPSEEK_API_KEY: "",
	ANTHROPIC_API_KEY: "",
	OPENAI_API_KEY: "",
};

/**
 * Sanitizes API key for safe logging (shows only last 4 chars).
 */
function sanitizeKey(key: string | undefined): string {
	if (!key || key.length < 4) return "****";
	return `****${key.slice(-4)}`;
}

/**
 * Prompts user for input using readline.
 */
async function prompt(label: string, defaultValue?: string): Promise<string> {
	const readline = await import("node:readline/promises");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const promptText = defaultValue
		? `${label} [${sanitizeKey(defaultValue)}]: `
		: `${label}: `;

	try {
		const answer = await rl.question(promptText);
		return answer.trim() || defaultValue || "";
	} finally {
		rl.close();
	}
}

/**
 * Prompts for confirmation.
 */
async function confirm(label: string, defaultYes = true): Promise<boolean> {
	const readline = await import("node:readline/promises");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const suffix = defaultYes ? " [Y/n]" : " [y/N]";
	try {
		const answer = await rl.question(`${label}${suffix}: `);
		const normalized = answer.trim().toLowerCase();
		if (!normalized) return defaultYes;
		return normalized === "y" || normalized === "yes";
	} finally {
		rl.close();
	}
}

/**
 * Loads existing credentials.
 */
async function loadCredentials(): Promise<typeof CREDENTIALS_TEMPLATE> {
	try {
		const credPath = getCredentialsPath();
		await fs.access(credPath);
		const content = await fs.readFile(credPath, "utf-8");
		const parsed = JSON.parse(content);
		// Merge with template to ensure all fields exist
		return { ...CREDENTIALS_TEMPLATE, ...parsed };
	} catch {
		return { ...CREDENTIALS_TEMPLATE };
	}
}

/**
 * Saves credentials with secure permissions (600).
 */
async function saveCredentials(
	credentials: typeof CREDENTIALS_TEMPLATE,
): Promise<boolean> {
	try {
		const configDir = getConfigDir();
		if (!ensureDir(configDir)) {
			console.error("❌ Failed to create config directory");
			return false;
		}

		const credPath = getCredentialsPath();
		await fs.writeFile(credPath, JSON.stringify(credentials, null, 2), "utf-8");
		await fs.chmod(credPath, 0o600);
		console.log(`✅ Saved credentials to ${credPath} (600 permissions)`);
		return true;
	} catch (err) {
		console.error("❌ Failed to save credentials:", err);
		return false;
	}
}

/**
 * Runs interactive config wizard.
 */
async function runWizard(): Promise<void> {
	console.log("\n🔧 Clarity Configuration Wizard");
	console.log("Press Ctrl+C to cancel at any time\n");

	const existing = await loadCredentials();
	const fields = [
		{ key: "OPENCODE_API_KEY", label: "OpenCode API Key" },
		{ key: "DEEPSEEK_API_KEY", label: "DeepSeek API Key" },
		{ key: "ANTHROPIC_API_KEY", label: "Anthropic API Key" },
		{ key: "OPENAI_API_KEY", label: "OpenAI API Key" },
	];

	const credentials = { ...existing };

	for (const field of fields) {
		const value = await prompt(
			field.label,
			existing[field.key as keyof typeof CREDENTIALS_TEMPLATE],
		);
		credentials[field.key as keyof typeof CREDENTIALS_TEMPLATE] = value;
	}

	// Show summary
	console.log("\n📋 Summary:");
	for (const field of fields) {
		const value = credentials[field.key as keyof typeof CREDENTIALS_TEMPLATE];
		console.log(
			`  ${field.label}: ${value ? sanitizeKey(value) : "(not set)"}`,
		);
	}

	const save = await confirm("\nSave credentials?", true);
	if (save) {
		await saveCredentials(credentials);
		console.log("\n✅ Configuration complete!");
	} else {
		console.log("\n❌ Configuration not saved.");
	}
}

export const configCommand = new Command("config")
	.description("Configure API keys and settings")
	.option("--show-paths", "Show resolved config paths", false)
	.option(
		"--set <key=value>",
		"Set a config value (e.g., --set OPENCODE_API_KEY=xxx)",
	)
	.action(async (options: { showPaths?: boolean; set?: string }) => {
		if (options.showPaths) {
			showPaths();
			return;
		}

		if (options.set) {
			// Handle --set key=value
			const [key, ...valueParts] = options.set.split("=");
			const value = valueParts.join("=");

			if (!key || !Object.hasOwn(CREDENTIALS_TEMPLATE, key)) {
				console.error(`❌ Unknown key: ${key}`);
				console.log(
					`Valid keys: ${Object.keys(CREDENTIALS_TEMPLATE).join(", ")}`,
				);
				process.exit(1);
			}

			const credentials = await loadCredentials();
			credentials[key as keyof typeof CREDENTIALS_TEMPLATE] = value;
			await saveCredentials(credentials);
			console.log(`✅ Set ${key}=${sanitizeKey(value)}`);
			return;
		}

		// Run interactive wizard
		await runWizard();
	});
