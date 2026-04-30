import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Config Validation", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("throws if API keys are missing", async () => {
		delete process.env.OPENCODE_API_KEY;
		delete process.env.DEEPSEEK_API_KEY;

		await expect(
			// use dynamic import to avoid cache
			import(`./config?cacheBust=${Date.now()}`),
		).rejects.toThrow("Invalid environment variables");
	});

	it("passes if API keys are provided", async () => {
		process.env.OPENCODE_API_KEY = "test-key";
		process.env.DEEPSEEK_API_KEY = "test-key";

		const module = await import(`./config?cacheBust2=${Date.now()}`);
		expect(module.config.OPENCODE_API_KEY).toBe("test-key");
		expect(module.config.DEEPSEEK_API_KEY).toBe("test-key");
	});
});
