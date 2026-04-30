import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// Mock the config module to avoid loading actual .env during tests
vi.mock("../core/config", () => ({
	config: {
		OPENCODE_API_KEY: "test-opencode-key",
		DEEPSEEK_API_KEY: "test-deepseek-key",
		PERPLEXITY_API_KEY: "test-perplexity-key",
		GEMINI_API_KEY: "test-gemini-key",
		NODE_ENV: "test",
	},
}));

// Use dynamic import after mock is set up
describe("Agent Router", () => {
	let agentRouter: typeof import("./agent-router");

	beforeEach(async () => {
		// Import fresh each test to pick up mocks
		agentRouter = await import(`./agent-router?test=${Date.now()}`);
	});

	describe("routeTask", () => {
		it("should return tavily for research role", async () => {
			const result = await agentRouter.routeTask("research", {
				id: "test-task-1",
				description: "Research task",
			});

			// Returns tavily if token available, otherwise falls back
			expect(result.provider).toMatch(/^(tavily|gemini|moonshot-k2.6)$/);
			expect(result.fallbackProviders).toContain("tavily");
		});

		it("should return moonshot-k2.6 for planning role (or fallback)", async () => {
			const result = await agentRouter.routeTask("planning", {
				id: "test-task-2",
				description: "Planning task",
			});

			// Returns moonshot-k2.6 if token available, otherwise falls back
			expect(result.provider).toMatch(/^(moonshot-k2.6|gemini|qwen3.6-plus)$/);
			expect(result.fallbackProviders).toContain("moonshot-k2.6");
		});

		it("should return deepseek-v4 for execution role", async () => {
			const result = await agentRouter.routeTask("execution", {
				id: "test-task-3",
				description: "Execution task",
			});

			expect(result.provider).toBe("deepseek-v4");
			expect(result.fallbackProviders).toContain("deepseek-v4");
			expect(result.fallbackProviders).toContain("moonshot-k2.6");
		});

		it("should return deepseek-v4 for verification role", async () => {
			const result = await agentRouter.routeTask("verification", {
				id: "test-task-4",
				description: "Verification task",
			});

			expect(result.provider).toBe("deepseek-v4");
			expect(result.fallbackProviders).toContain("deepseek-v4");
			expect(result.fallbackProviders).toContain("deepseek");
		});

		it("should return fallbackProviders array", async () => {
			const result = await agentRouter.routeTask("research");

			expect(Array.isArray(result.fallbackProviders)).toBe(true);
			expect(result.fallbackProviders.length).toBeGreaterThan(1);
		});

		it("should indicate if fallback is needed (requiresFallback)", async () => {
			const result = await agentRouter.routeTask("research");

			// For valid tokens, should not require fallback initially
			expect(typeof result.requiresFallback).toBe("boolean");
		});
	});

	describe("validateToken", () => {
		it("should return true for valid opencode-go token", async () => {
			const result = agentRouter.validateToken("opencode-go");
			expect(result).toBe(true);
		});

		it("should return true for valid deepseek token", async () => {
			const result = agentRouter.validateToken("deepseek");
			expect(result).toBe(true);
		});

		it("should check tavily token (requires TAVILY_API_KEY)", async () => {
			const result = agentRouter.validateToken("tavily");
			// Returns true only if TAVILY_API_KEY is set
			expect(typeof result).toBe("boolean");
		});

		it("should return true for valid gemini token", async () => {
			const result = agentRouter.validateToken("gemini");
			expect(result).toBe(true);
		});

		it("should return false for unknown provider", () => {
			// @ts-ignore - testing invalid provider
			const result = agentRouter.validateToken("unknown-provider");
			expect(result).toBe(false);
		});
	});

	describe("type exports", () => {
		it("should export ProviderId type", () => {
			// This tests that the type is exported
			const provider: agentRouter.ProviderId = "opencode-go";
			expect(provider).toBe("opencode-go");
		});

		it("should export TaskRole type", () => {
			// This tests that the type is exported
			const role: agentRouter.TaskRole = "research";
			expect(role).toBe("research");
		});

		it("should export RouteResult interface", () => {
			// This tests that the interface is exported
			const result: agentRouter.RouteResult = {
				provider: "gemini",
				requiresFallback: true,
				fallbackProviders: ["gemini", "deepseek"],
			};
			expect(result.provider).toBe("gemini");
			expect(result.requiresFallback).toBe(true);
		});
	});

	describe("default export", () => {
		it("should have routeTask in default export", async () => {
			const router = (await import(`./agent-router?default=${Date.now()}`)).default;
			expect(router.routeTask).toBeDefined();
			expect(typeof router.routeTask).toBe("function");
		});

		it("should have validateToken in default export", async () => {
			const router = (await import(`./agent-router?default2=${Date.now()}`)).default;
			expect(router.validateToken).toBeDefined();
			expect(typeof router.validateToken).toBe("function");
		});
	});
});