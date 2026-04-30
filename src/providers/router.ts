import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../core/config";
import type { EventLog, EventSeverity } from "../core/types";

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LLMRequest {
	messages: LLMMessage[];
	provider?: "opencode-go" | "deepseek"; // Defaults to opencode-go
}

export interface LLMResponse {
	content: string;
	provider: "opencode-go" | "deepseek";
	model: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

export interface RouterConfig {
	opencodeApiKey?: string;
	deepseekApiKey?: string;
	cooldownMinutes?: number;
	maxFailuresBeforeCooldown?: number;
}

export type ProviderId = "opencode-go" | "deepseek";

interface ProviderHealth {
	failureCount: number;
	lastFailureTime: number | null;
	isOnCooldown: boolean;
}

/**
 * Routes requests to LLM providers with automatic fallback on failures.
 * Tracks provider health and implements cooldown mechanism after consecutive failures.
 */
export class ProviderRouter {
	private readonly OPENCODE_API_URL =
		"https://api.opencode.com/v1/chat/completions";
	private readonly DEEPSEEK_API_URL =
		"https://api.deepseek.com/v1/chat/completions";

	private opencodeApiKey: string;
	private deepseekApiKey: string;

	// Health tracking per provider
	private providerHealth: Map<ProviderId, ProviderHealth> = new Map();

	// Configuration
	private readonly cooldownMinutes: number;
	private readonly maxFailuresBeforeCooldown: number;

	// Event ledger for fallback events
	private ledgerPath: string;
	private ledgerInitialized = false;

	constructor(cfg?: RouterConfig) {
		this.opencodeApiKey = cfg?.opencodeApiKey || config.OPENCODE_API_KEY;
		this.deepseekApiKey = cfg?.deepseekApiKey || config.DEEPSEEK_API_KEY;
		this.cooldownMinutes = cfg?.cooldownMinutes ?? 5; // Default 5 minutes
		this.maxFailuresBeforeCooldown = cfg?.maxFailuresBeforeCooldown ?? 3; // Default 3 failures

		// Initialize health tracking for each provider
		this.providerHealth.set("opencode-go", {
			failureCount: 0,
			lastFailureTime: null,
			isOnCooldown: false,
		});
		this.providerHealth.set("deepseek", {
			failureCount: 0,
			lastFailureTime: null,
			isOnCooldown: false,
		});

		// Initialize ledger path
		const runId = new Date().toISOString().replace(/[:.]/g, "-");
		this.ledgerPath = join(process.cwd(), ".events", `run-${runId}.jsonl`);
	}

	/**
	 * Initializes the ledger directory.
	 */
	private async initLedger(): Promise<void> {
		if (this.ledgerInitialized) return;
		await mkdir(dirname(this.ledgerPath), { recursive: true });
		this.ledgerInitialized = true;
	}

	/**
	 * Logs an event to the ledger for fallback notifications.
	 */
	private async logEvent(
		type: string,
		payload: Record<string, unknown>,
		severity: EventSeverity = "info",
		metadata?: EventLog["metadata"],
	): Promise<void> {
		await this.initLedger();

		const event: EventLog = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			type,
			severity,
			payload,
			metadata,
		};

		const line = `${JSON.stringify(event)}\n`;
		await appendFile(this.ledgerPath, line, "utf-8");

		// Also log to console for real-time visibility
		const consoleMsg = `[${type.toUpperCase()}] ${payload.message || JSON.stringify(payload)}`;
		if (severity === "warning") {
			console.warn(consoleMsg);
		} else if (severity === "error") {
			console.error(consoleMsg);
		} else {
			console.log(consoleMsg);
		}
	}

	/**
	 * Records a failure for a provider and applies cooldown if threshold reached.
	 */
	private async recordProviderFailure(provider: ProviderId): Promise<void> {
		const health = this.providerHealth.get(provider);
		if (!health) return;

		health.failureCount++;
		health.lastFailureTime = Date.now();

		if (health.failureCount >= this.maxFailuresBeforeCooldown) {
			health.isOnCooldown = true;
			await this.logEvent(
				"fallback_cooldown",
				{
					provider,
					failureCount: health.failureCount,
					cooldownMinutes: this.cooldownMinutes,
				},
				"warning",
				{ provider },
			);

			// Schedule cooldown removal
			setTimeout(() => {
				const h = this.providerHealth.get(provider);
				if (h) {
					h.isOnCooldown = false;
					h.failureCount = 0;
					this.logEvent(
						"cooldown_expired",
						{ provider, message: `Provider ${provider} cooldown expired, ready for requests` },
						"info",
						{ provider },
					);
				}
			}, this.cooldownMinutes * 60 * 1000);
		}
	}

	/**
	 * Records a success for a provider (resets failure count).
	 */
	private recordProviderSuccess(provider: ProviderId): void {
		const health = this.providerHealth.get(provider);
		if (health) {
			health.failureCount = 0;
			health.isOnCooldown = false;
		}
	}

	/**
	 * Gets the next available provider using round-robin fallback.
	 * Skips providers on cooldown.
	 */
	public fallback(fromProvider?: ProviderId): ProviderId {
		const providers: ProviderId[] = ["opencode-go", "deepseek"];

		// Try the other provider first (round-robin)
		const startIdx = fromProvider
			? providers.indexOf(fromProvider) + 1
			: Math.floor(Math.random() * providers.length);

		for (let i = 0; i < providers.length; i++) {
			const idx = (startIdx + i) % providers.length;
			const provider = providers[idx];
			const health = this.providerHealth.get(provider);

			if (health && !health.isOnCooldown) {
				return provider;
			}
		}

		// If all providers are on cooldown, return the first one anyway
		// (fail-fast is better than infinite wait)
		return providers[0];
	}

	/**
	 * Checks if a provider is currently on cooldown.
	 */
	public isOnCooldown(provider: ProviderId): boolean {
		const health = this.providerHealth.get(provider);
		return health?.isOnCooldown ?? false;
	}

	/**
	 * Gets the failure count for a provider.
	 */
	public getFailureCount(provider: ProviderId): number {
		return this.providerHealth.get(provider)?.failureCount ?? 0;
	}

	/**
	 * Determines if an error is retryable (429, timeout, network error).
	 */
	private isRetryableError(error: Error | unknown): boolean {
		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			// Check for rate limit (429)
			if (message.includes("429") || message.includes("rate limit")) {
				return true;
			}
			// Check for timeout
			if (
				message.includes("timeout") ||
				message.includes("etimedout") ||
				message.includes("econnaborted")
			) {
				return true;
			}
			// Check for network errors
			if (
				message.includes("network") ||
				message.includes("fetch") ||
				message.includes("ECONNREFUSED") ||
				message.includes("ENOTFOUND")
			) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Routes the request to the specified provider with automatic fallback.
	 * If the request fails due to 429 or timeout, tries another provider.
	 */
	public async completion(req: LLMRequest): Promise<LLMResponse> {
		const preferredProvider = req.provider || "opencode-go";
		let currentProvider = preferredProvider;
		let lastError: Error | unknown = null;

		// Try up to 2 providers (original + fallback)
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const response = await this.callProvider(currentProvider, req.messages);
				
				// Success - record and return
				this.recordProviderSuccess(currentProvider);
				return response;
			} catch (error) {
				lastError = error;
				const isRetryable = this.isRetryableError(error);

				// Always record the failure for health tracking
				await this.recordProviderFailure(currentProvider);

				// Only try fallback on attempt 0 if error is retryable (429, timeout, network)
				// For non-retryable errors (500, 401), we record but don't fallback
				if (isRetryable && attempt === 0) {
					// Log the fallback event
					await this.logEvent(
						"provider_fallback",
						{
							message: `Provider ${currentProvider} failed with retryable error, trying next provider`,
							fromProvider: currentProvider,
							error: error instanceof Error ? error.message : String(error),
						},
						"warning",
						{ provider: currentProvider },
					);

					// Get next available provider
					const nextProvider = this.fallback(currentProvider);

					// Check if we've exhausted all providers
					if (nextProvider === currentProvider) {
						await this.logEvent(
							"task_exhausted",
							{
								message: "All providers failed or unavailable",
								providers: Array.from(this.providerHealth.keys()),
							},
							"error",
						);
						throw error;
					}

					currentProvider = nextProvider;
				} else {
					// Non-retryable error, or retry on attempt 1, or no fallback available
					throw error;
				}
			}
		}

		// Should not reach here, but just in case
		throw lastError || new Error("Provider routing exhausted");
	}

	/**
	 * Calls a specific provider with the given messages.
	 */
	private async callProvider(
		provider: ProviderId,
		messages: LLMMessage[],
	): Promise<LLMResponse> {
		if (provider === "opencode-go") {
			return this.callOpenCode(messages);
		}
		return this.callDeepSeek(messages);
	}

	private async callOpenCode(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(this.OPENCODE_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.opencodeApiKey}`,
			},
			body: JSON.stringify({
				model: "opencode-go/kimi-k2.5",
				messages,
			}),
			signal: AbortSignal.timeout(30000), // 30 second timeout
		});

		if (!response.ok) {
			throw new Error(
				`OpenCode Go API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "opencode-go",
			model: "opencode-go/kimi-k2.5",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callDeepSeek(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(this.DEEPSEEK_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.deepseekApiKey}`,
			},
			body: JSON.stringify({
				model: "deepseek-coder",
				messages,
			}),
			signal: AbortSignal.timeout(30000), // 30 second timeout
		});

		if (!response.ok) {
			throw new Error(
				`DeepSeek API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "deepseek",
			model: "deepseek-coder",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}
}