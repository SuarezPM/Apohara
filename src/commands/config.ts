import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";

const ENV_TEMPLATE = `OPENCODE_API_KEY=
DEEPSEEK_API_KEY=
NODE_ENV=development
`;

export const configCommand = new Command("config")
	.description("Generates a base .env template file if it does not exist")
	.action(async () => {
		const envPath = path.resolve(process.cwd(), ".env");

		try {
			await fs.access(envPath);
			console.log("ℹ️ .env file already exists.");
		} catch {
			// File does not exist, so create it
			await fs.writeFile(envPath, ENV_TEMPLATE, "utf-8");
			console.log("✅ Created .env file successfully.");
		}
	});
