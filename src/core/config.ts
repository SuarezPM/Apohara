import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
	OPENCODE_API_KEY: z.string().min(1, "OPENCODE_API_KEY is required"),
	DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
});

const parseEnv = () => {
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		console.error("❌ Invalid environment variables:", result.error.format());
		throw new Error("Invalid environment variables");
	}
	return result.data;
};

export const config = parseEnv();
