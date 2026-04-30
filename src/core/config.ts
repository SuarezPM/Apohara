import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
	OPENCODE_API_KEY: z.string().min(1, "OPENCODE_API_KEY is required"),
	DEEPSEEK_API_KEY: z.string().optional(),
	PERPLEXITY_API_KEY: z.string().optional(),
	GEMINI_API_KEY: z.string().optional(),
	GITHUB_TOKEN: z.string().optional(),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
});

const parseEnv = () => {
	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		// In test mode, allow missing API keys (tests can inject their own)
		if (process.env.NODE_ENV === "test") {
			return {
				OPENCODE_API_KEY: process.env.OPENCODE_API_KEY || "test-opencode-key",
				DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "test-deepseek-key",
				PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || "test-perplexity-key",
				GEMINI_API_KEY: process.env.GEMINI_API_KEY || "test-gemini-key",
				GITHUB_TOKEN: process.env.GITHUB_TOKEN || undefined,
				NODE_ENV: "test" as const,
			};
		}

		console.error("❌ Invalid environment variables:", result.error.format());
		throw new Error("Invalid environment variables");
	}

	return result.data;
};

export const config = parseEnv();
