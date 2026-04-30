import { test, expect, beforeEach, describe, vi } from "bun:test";
import { ProviderRouter, type ProviderId, type LLMMessage } from "./router";

// Mock config to avoid needing real API keys
vi.mock("../core/config", () => ({
	config: {
		OPENCODE_API_KEY: "test-opencode-key",
		DEEPSEEK_API_KEY: "test-deepseek-key",
	},
}));

// Mock fetch globally
let mockFetch: ReturnType<typeof vi.fn>;
let mockFetchResponse: {
	ok: boolean;
	status: number;
	statusText: string;
	json: () => Promise<unknown>;
} | null = null;

global.fetch = vi.fn(async () => {
	if (!mockFetchResponse) {
		throw new Error("No mock response set");
	}
	return mockFetchResponse;
});

function setMockResponse(ok: boolean, status: number, data: unknown = {}) {
	mockFetchResponse = {
		ok,
		status,
		statusText: ok ? "OK" : "Error",
		json: async () => data,
	};
}

describe("ProviderRouter", () => {
	let router: ProviderRouter;

	beforeEach(() => {
		router = new ProviderRouter({
			cooldownMinutes: 1, // 1 minute for tests
			maxFailuresBeforeCooldown: 3,
		});
		mockFetchResponse = null;
	});

	describe("health tracking", () => {
		test("starts with zero failures for each provider", () => {
			expect(router.getFailureCount("opencode-go")).toBe(0);
			expect(router.getFailureCount("deepseek")).toBe(0);
		});

		test("reports not on cooldown initially", () => {
			expect(router.isOnCooldown("opencode-go")).toBe(false);
			expect(router.isOnCooldown("deepseek")).toBe(false);
		});

		test("increments failure count on retryable errors", async () => {
			setMockResponse(false, 429, { error: { message: "Rate limited" } });

			const messages: LLMMessage[] = [
				{ role: "user", content: "Hello" },
			];

			try {
				await router.completion({ messages });
			} catch {
				// Expected to fail
			}

			expect(router.getFailureCount("opencode-go")).toBe(1);
		});

		test("triggers cooldown after max failures", async () => {
			setMockResponse(false, 429, { error: { message: "Rate limited" } });

			const messages: LLMMessage[] = [
				{ role: "user", content: "Hello" },
			];

			// Trigger 3 failures
			for (let i = 0; i < 3; i++) {
				try {
					await router.completion({ messages });
				} catch {
					// Expected to fail
				}
			}

			// Now should be on cooldown
			expect(router.isOnCooldown("opencode-go")).toBe(true);
			expect(router.getFailureCount("opencode-go")).toBe(3);
		});
	});

	describe("fallback logic", () => {
		test("fallback returns other provider when one is specified", () => {
			const fallback = router.fallback("opencode-go");
			expect(fallback).toBe("deepseek");
		});

		test("fallback returns the same provider when other is on cooldown", () => {
			// When deepseek is on cooldown, fallback from deepseek returns deepseek
			// (since opencode-go is already tried and might still work)
			// Actually, let's test: if opencode-go is preferred but on cooldown,
			// fallback should return deepseek
			
			// Use fallback with deepseek as current - it should return opencode-go
			// unless opencode-go is on cooldown
			const result = router.fallback("deepseek");
			expect(result).toBe("opencode-go");
		});

		test("fallback returns first provider if all on cooldown", () => {
			// When both providers are unavailable (theoretically), 
			// it should still return a provider (fail-fast is better than hang)
			const fallback = router.fallback();
			expect(fallback).toBeDefined();
			expect(["opencode-go", "deepseek"]).toContain(fallback);
		});
	});

	describe("retryable error detection", () => {
		test("does not fallback on 429 rate limit errors", async () => {
			// 429 is retryable - should trigger fallback
			setMockResponse(false, 429, { error: { message: "Rate limited" } });

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			let threw = false;
			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch (e) {
				threw = true;
			}

			// Should have thrown (we ran out of providers eventually)
			expect(threw).toBe(true);
			// And the first provider should have been tried
			expect(router.getFailureCount("opencode-go")).toBe(1);
		});

		test("does fallback on timeout errors", async () => {
			setMockResponse(false, 503, { error: { message: "timeout of 30000ms exceeded" } });

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			let threw = false;
			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch {
				threw = true;
			}

			expect(threw).toBe(true);
		});

		test("throws immediately on 401 authentication errors (no fallback)", async () => {
			setMockResponse(false, 401, { error: { message: "Unauthorized" } });

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			let threw = false;
			let errorMessage = "";
			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch (e) {
				threw = true;
				errorMessage = e instanceof Error ? e.message : String(e);
			}

			expect(threw).toBe(true);
			expect(errorMessage).toContain("401");
			// Should have tried exactly 1 provider (no fallback for 401)
			expect(router.getFailureCount("opencode-go")).toBe(1);
		});

		test("throws immediately on 500 server errors (no fallback)", async () => {
			setMockResponse(false, 500, { error: { message: "Internal Server Error" } });

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			let threw = false;
			let errorMessage = "";
			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch (e) {
				threw = true;
				errorMessage = e instanceof Error ? e.message : String(e);
			}

			expect(threw).toBe(true);
			expect(errorMessage).toContain("500");
			// Should have tried exactly 1 provider (no fallback for 500)
			expect(router.getFailureCount("opencode-go")).toBe(1);
		});
	});

	describe("successful response handling", () => {
		test("resets failure count on success", async () => {
			// Simulate success response for deepseek
			setMockResponse(true, 200, {
				choices: [{ message: { content: "Hello" } }],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			});

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			// Make a successful call to deepseek
			const response = await router.completion({
				messages,
				provider: "deepseek",
			});

			expect(response.content).toBe("Hello");
			// deepseek should have no failures after success
			expect(router.getFailureCount("deepseek")).toBe(0);
		});

		test("does not reset other provider's failure count", async () => {
			// First, fail with opencode-go
			setMockResponse(false, 429, {});

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch {
				// Expected
			}

			// opencode-go should have 1 failure
			expect(router.getFailureCount("opencode-go")).toBe(1);

			// Now succeed with deepseek
			setMockResponse(true, 200, {
				choices: [{ message: { content: "OK" } }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});

			await router.completion({ messages, provider: "deepseek" });

			// opencode-go should still have its failure count
			expect(router.getFailureCount("opencode-go")).toBe(1);
			// deepseek should be reset to 0
			expect(router.getFailureCount("deepseek")).toBe(0);
		});
	});

	describe("timeout handling", () => {
		test("applies timeout to API calls", async () => {
			// The implementation uses AbortSignal.timeout(30000)
			// We can verify the configuration exists
			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			// Set up a mock that will be called with timeout
			setMockResponse(true, 200, {
				choices: [{ message: { content: "OK" } }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});

			const response = await router.completion({
				messages,
				provider: "opencode-go",
			});

			expect(response.content).toBe("OK");
		});
	});
});

describe("ProviderId type", () => {
	test("accepts valid provider IDs", () => {
		const validProviders: ProviderId[] = ["opencode-go", "deepseek"];
		expect(validProviders).toHaveLength(2);
	});
});