import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { resolveCredential, resolveCredentialSync, injectCredentials } from "../src/core/credentials";
import { getProviderKey } from "../src/core/config";

describe("credentials", () => {
	const testDir = path.join(os.tmpdir(), "apohara-test-credentials-" + Date.now());
	const originalXdgConfig = process.env.XDG_CONFIG_HOME;
	const originalOpencodeKey = process.env.OPENCODE_API_KEY;
	const originalHome = process.env.HOME;
	const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;
	const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
	const originalGoogleAIKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
	const originalKiroKey = process.env.KIRO_AI_API_KEY;

	beforeEach(async () => {
		process.env.XDG_CONFIG_HOME = testDir;
		process.env.HOME = testDir;
		delete process.env.OPENCODE_GO_API_KEY;
		delete process.env.OPENCODE_API_KEY;
		delete process.env.DEEPSEEK_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.GOOGLE_AI_STUDIO_API_KEY;
		delete process.env.KIRO_AI_API_KEY;
		await fs.mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		process.env.XDG_CONFIG_HOME = originalXdgConfig;
		process.env.HOME = originalHome;
		process.env.OPENCODE_API_KEY = originalOpencodeKey;
		process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
		process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
		process.env.GOOGLE_AI_STUDIO_API_KEY = originalGoogleAIKey;
		process.env.KIRO_AI_API_KEY = originalKiroKey;
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it("reads credential from credentials.json file", async () => {
		const apoharaDir = path.join(testDir, "apohara");
		await fs.mkdir(apoharaDir, { recursive: true });
		const credPath = path.join(apoharaDir, "credentials.json");
		await fs.writeFile(credPath, JSON.stringify({ "opencode-go": { apiKey: "file-key-123" } }), "utf-8");

		const result = await resolveCredential("opencode-go");
		expect(result).toBe("file-key-123");
	});

	it("falls back to environment variable when file missing", async () => {
		process.env.OPENCODE_GO_API_KEY = "env-key-456";

		const result = await resolveCredential("opencode-go");
		expect(result).toBe("env-key-456");
	});

	it("returns anonymous for free-tier providers without auth", async () => {
		const result = await resolveCredential("kiro-ai");
		expect(result).toBe("anonymous");
	});

	it("returns null when no credentials found", async () => {
		const result = await resolveCredential("opencode-go");
		expect(result).toBeNull();
	});

	it("resolveCredentialSync checks env vars and free-tier", () => {
		process.env.DEEPSEEK_API_KEY = "sync-key-789";
		expect(resolveCredentialSync("deepseek")).toBe("sync-key-789");
		expect(resolveCredentialSync("iflow-ai")).toBe("anonymous");
		expect(resolveCredentialSync("unknown-provider")).toBeNull();
	});

	// ── Task 1: injectCredentials() tests ──────────────────────────────

	describe("injectCredentials", () => {
		beforeEach(async () => {
			const apoharaDir = path.join(testDir, "apohara");
			await fs.mkdir(apoharaDir, { recursive: true });
		});

		it("loads keys from credentials.json into process.env", async () => {
			const credPath = path.join(testDir, "apohara", "credentials.json");
			await fs.writeFile(credPath, JSON.stringify({ DEEPSEEK_API_KEY: "sk-test-inject" }), "utf-8");

			const result = injectCredentials();

			expect(process.env.DEEPSEEK_API_KEY).toBe("sk-test-inject");
			expect(result.injected).toBeGreaterThanOrEqual(1);
		});

		it("does NOT overwrite existing env vars", async () => {
			const credPath = path.join(testDir, "apohara", "credentials.json");
			await fs.writeFile(credPath, JSON.stringify({ DEEPSEEK_API_KEY: "sk-from-json" }), "utf-8");
			process.env.DEEPSEEK_API_KEY = "sk-from-env";

			const result = injectCredentials();

			expect(process.env.DEEPSEEK_API_KEY).toBe("sk-from-env");
			expect(result.skipped).toBeGreaterThanOrEqual(1);
		});

		it("handles missing file gracefully", () => {
			const result = injectCredentials();
			expect(result).toEqual({ injected: 0, skipped: 0, providers: [] });
		});

		it("handles empty/invalid values", async () => {
			const credPath = path.join(testDir, "apohara", "credentials.json");
			await fs.writeFile(
				credPath,
				JSON.stringify({ DEEPSEEK_API_KEY: "", OPENCODE_API_KEY: "oc-valid" }),
				"utf-8",
			);

			injectCredentials();

			expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
			expect(process.env.OPENCODE_API_KEY).toBe("oc-valid");
		});
	});

	// ── Task 2: resolveCredentialSync ENV_VAR-style key tests ──────────

	describe("resolveCredentialSync ENV_VAR-style keys", () => {
		beforeEach(async () => {
			const apoharaDir = path.join(testDir, "apohara");
			await fs.mkdir(apoharaDir, { recursive: true });
		});

		it("reads ENV_VAR-style keys from credentials.json", async () => {
			const credPath = path.join(testDir, "apohara", "credentials.json");
			await fs.writeFile(credPath, JSON.stringify({ ANTHROPIC_API_KEY: "sk-ant-api03-test" }), "utf-8");

			const result = resolveCredentialSync("anthropic-api");
			expect(result).toBe("sk-ant-api03-test");
		});

		it("reads GOOGLE_AI_STUDIO_API_KEY for gemini-api", async () => {
			const credPath = path.join(testDir, "apohara", "credentials.json");
			await fs.writeFile(
				credPath,
				JSON.stringify({ GOOGLE_AI_STUDIO_API_KEY: "AIzaTestKey12345678901234567890123456" }),
				"utf-8",
			);

			const result = resolveCredentialSync("gemini-api");
			expect(result).toBe("AIzaTestKey12345678901234567890123456");
		});

		it("prefers provider-ID key over ENV_VAR key in JSON", async () => {
			const credPath = path.join(testDir, "apohara", "credentials.json");
			await fs.writeFile(
				credPath,
				JSON.stringify({ "opencode-go": "provider-id-key", OPENCODE_API_KEY: "env-var-key" }),
				"utf-8",
			);

			const result = resolveCredentialSync("opencode-go");
			expect(result).toBe("provider-id-key");
		});
	});

	// ── Task 3: 4-tier precedence integration test ─────────────────────

	describe("4-tier precedence", () => {
		beforeEach(async () => {
			const apoharaDir = path.join(testDir, "apohara");
			await fs.mkdir(apoharaDir, { recursive: true });
		});

		it("resolves env var > credentials.json > free-tier > null", async () => {
			const credPath = path.join(testDir, "apohara", "credentials.json");
			await fs.writeFile(credPath, JSON.stringify({ DEEPSEEK_API_KEY: "from-json" }), "utf-8");

			// Tier 1: env var wins over credentials.json
			process.env.DEEPSEEK_API_KEY = "from-env";
			expect(getProviderKey("deepseek")).toBe("from-env");

			// Tier 2: credentials.json fallback when env is missing
			delete process.env.DEEPSEEK_API_KEY;
			expect(getProviderKey("deepseek")).toBe("from-json");

			// Tier 3: free-tier provider returns "anonymous"
			expect(getProviderKey("kiro-ai")).toBe("anonymous");

			// Tier 4: unknown provider returns null
			expect(getProviderKey("nonexistent-provider")).toBeNull();
		});
	});
});
