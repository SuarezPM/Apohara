import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config, getProviderKey } from "../core/config";
import type { EventLog, EventSeverity, ProviderId } from "../core/types";

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LLMRequest {
	messages: LLMMessage[];
	provider?: ProviderId;
	signal?: AbortSignal;
}

export interface LLMResponse {
	content: string;
	provider: ProviderId;
	model: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

export interface RouterConfig {
	// OpenCode
	opencodeApiKey?: string;
	// DeepSeek
	deepseekApiKey?: string;
	// Google
	geminiApiKey?: string;
	// Tavily - Real-time web search (replaces Perplexity for research)
	tavilyApiKey?: string;
	// Moonshot (Kimi)
	moonshotApiKey?: string;
	// Xiaomi (MiMo)
	xiaomiApiKey?: string;
	// Alibaba (Qwen)
	alibabaApiKey?: string;
	// MiniMax
	minimaxApiKey?: string;
	// DeepInfra
	deepinfraApiKey?: string;
	// Fireworks
	fireworksApiKey?: string;
	// Groq - Ultra-fast inference
	groqApiKey?: string;
	// Kiro AI - Free tier, no auth required
	kiroAiApiKey?: string;
	// Mistral
	mistralApiKey?: string;
	// OpenAI
	openaiApiKey?: string;
	
	cooldownMinutes?: number;
	maxFailuresBeforeCooldown?: number;
	simulateFailure?: boolean;
}

// Re-export ProviderId from types for external use
export type { ProviderId } from "../core/types";

/**
 * Provider API endpoints - grouped by provider
 */
const API_ENDPOINTS = {
	// OpenCode
	"opencode-go": "https://api.opencode.com/v1/chat/completions",
	// DeepSeek
	deepseek: "https://api.deepseek.com/v1/chat/completions",
	"deepseek-v4": "https://api.deepseek.com/v1/chat/completions",
	// Google
	gemini: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
	// Tavily - Real-time web search for AI agents
	tavily: "https://api.tavily.com/search",
	// Moonshot (Kimi)
	"moonshot-k2.5": "https://api.moonshot.cn/v1/chat/completions",
	"moonshot-k2.6": "https://api.moonshot.cn/v1/chat/completions",
	// Xiaomi (MiMo)
	"xiaomi-mimo": "https://api.mimi.finance/v1/chat/completions",
	// Alibaba (Qwen)
	"qwen3.5-plus": "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
	"qwen3.6-plus": "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
	// MiniMax
	"minimax-m2.5": "https://api.minimax.chat/v1/text/chatcompletion_v2",
	"minimax-m2.7": "https://api.minimax.chat/v1/text/chatcompletion_v2",
	// DeepInfra
	"glm-deepinfra": "https://api.deepinfra.com/v1/chat/completions",
	// Fireworks
	"glm-fireworks": "https://api.fireworks.ai/v1/chat/completions",
	// Groq - OpenAI-compatible ultra-fast inference
	groq: "https://api.groq.com/openai/v1/chat/completions",
	// Kiro AI - Free tier, no auth required
	"kiro-ai": "https://api.kiro.ai/v1/chat/completions",
	// Mistral
	mistral: "https://api.mistral.ai/v1/chat/completions",
	// OpenAI
	openai: "https://api.openai.com/v1/chat/completions",
};

/**
 * Model names for each provider
 */
const MODEL_NAMES: Record<ProviderId, string> = {
	"opencode-go": "opencode-go/kimi-k2.5",
	deepseek: "deepseek-coder",
	"deepseek-v4": "deepseek-chat",
	gemini: "gemini-2.0-flash",
	tavily: "tavily-search",
	"moonshot-k2.5": "kimi-k2.5",
	"moonshot-k2.6": "kimi-k2.6",
	"xiaomi-mimo": "MiMo-V2-8B",
	"qwen3.5-plus": "qwen-plus",
	"qwen3.6-plus": "qwen-plus",
	"minimax-m2.5": "MiniMax-M2.5",
	"minimax-m2.7": "MiniMax-M2.7",
	"glm-deepinfra": "THUDM/glm-4-9b-chat",
	"glm-fireworks": "THUDM/glm-4-9b-chat",
	"glm-zai": "THUDM/glm-4-9b-chat",
	groq: "llama-3.3-70b-versatile",
	"kiro-ai": "claude-sonnet-4-20250514",
	mistral: "mistral-small-latest",
	openai: "gpt-4o-mini",
};

interface ProviderHealth {
	failureCount: number;
	lastFailureTime: number | null;
	isOnCooldown: boolean;
}

/**
 * Routes requests to LLM providers with automatic fallback on failures.
 * Supports 15+ models including DeepSeek V4, Kimi K2.6, Qwen 3.6, MiniMax, etc.
 * Tracks provider health and implements cooldown mechanism after consecutive failures.
 */
export class ProviderRouter {
	// Provider endpoints
	private readonly API_URLS = API_ENDPOINTS;
	
	// API Keys
	private opencodeApiKey: string;
	private deepseekApiKey: string;
	private geminiApiKey: string;
	private tavilyApiKey: string;
	private moonshotApiKey: string;
	private xiaomiApiKey: string;
	private alibabaApiKey: string;
	private minimaxApiKey: string;
	private deepinfraApiKey: string;
	private fireworksApiKey: string;
	private groqApiKey: string;
	private kiroAiApiKey: string;
	private mistralApiKey: string;
	private openaiApiKey: string;

	// Health tracking per provider
	private providerHealth: Map<ProviderId, ProviderHealth> = new Map();

	// Configuration
	private readonly cooldownMinutes: number;
	private readonly maxFailuresBeforeCooldown: number;

	// Event ledger for fallback events
	private ledgerPath: string;
	private ledgerInitialized = false;

	// Simulate failure flag for demo/testing
	private simulateFailure = false;
	private failureSimulated = false;

	constructor(cfg?: RouterConfig) {
		// Initialize all API keys
		this.opencodeApiKey = cfg?.opencodeApiKey || getProviderKey("opencode-go") || "";
		this.deepseekApiKey = cfg?.deepseekApiKey || getProviderKey("deepseek") || "";
		this.geminiApiKey = cfg?.geminiApiKey || getProviderKey("gemini") || "";
		this.tavilyApiKey = cfg?.tavilyApiKey || getProviderKey("tavily") || "";
		this.moonshotApiKey = cfg?.moonshotApiKey || getProviderKey("moonshot") || "";
		this.xiaomiApiKey = cfg?.xiaomiApiKey || getProviderKey("xiaomi") || "";
		this.alibabaApiKey = cfg?.alibabaApiKey || getProviderKey("alibaba") || "";
		this.minimaxApiKey = cfg?.minimaxApiKey || getProviderKey("minimax") || "";
		this.deepinfraApiKey = cfg?.deepinfraApiKey || getProviderKey("deepinfra") || "";
		this.fireworksApiKey = cfg?.fireworksApiKey || getProviderKey("fireworks") || "";
		this.zaiApiKey = cfg?.zaiApiKey || getProviderKey("zai") || "";
		this.groqApiKey = cfg?.groqApiKey || getProviderKey("groq") || "";
		this.kiroAiApiKey = cfg?.kiroAiApiKey || getProviderKey("kiro-ai") || "anonymous";
		this.mistralApiKey = cfg?.mistralApiKey || getProviderKey("mistral") || "";
		this.openaiApiKey = cfg?.openaiApiKey || getProviderKey("openai") || "";
		
		this.cooldownMinutes = cfg?.cooldownMinutes ?? 5;
		this.maxFailuresBeforeCooldown = cfg?.maxFailuresBeforeCooldown ?? 3;
		this.simulateFailure = cfg?.simulateFailure ?? false;

		// Initialize health tracking for each provider
		const allProviders: ProviderId[] = [
			"opencode-go", "deepseek", "deepseek-v4", "gemini", "tavily",
			"moonshot-k2.5", "moonshot-k2.6", "xiaomi-mimo",
			"qwen3.5-plus", "qwen3.6-plus", "minimax-m2.5", "minimax-m2.7",
			"glm-deepinfra", "glm-fireworks", "glm-zai", "groq",
			"kiro-ai", "mistral", "openai"
		];
		
		for (const provider of allProviders) {
			this.providerHealth.set(provider, {
				failureCount: 0,
				lastFailureTime: null,
				isOnCooldown: false,
			});
		}

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
			setTimeout(
				() => {
					const h = this.providerHealth.get(provider);
					if (h) {
						h.isOnCooldown = false;
						h.failureCount = 0;
						this.logEvent(
							"cooldown_expired",
							{
								provider,
								message: `Provider ${provider} cooldown expired, ready for requests`,
							},
							"info",
							{ provider },
						);
					}
				},
				this.cooldownMinutes * 60 * 1000,
			);
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
	 * Prioritizes more capable models in the fallback chain.
	 */
	public fallback(fromProvider?: ProviderId): ProviderId {
		// Priority order: most capable first, then fallbacks
		const providers: ProviderId[] = [
			// Execution role - most powerful coding models first
			"groq", "deepseek-v4", "kiro-ai", "openai", "moonshot-k2.6", "qwen3.6-plus", "opencode-go", "minimax-m2.7",
			// Planning/Research
			"mistral", "moonshot-k2.5", "gemini", "tavily", "qwen3.5-plus",
			// Legacy fallbacks
			"deepseek", "glm-deepinfra", "glm-fireworks", "glm-zai", "xiaomi-mimo", "minimax-m2.5"
		];

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
		switch (provider) {
			case "opencode-go":
				return this.callOpenCode(messages);
			case "deepseek":
				return this.callDeepSeek(messages);
			case "deepseek-v4":
				return this.callDeepSeekV4(messages);
			case "gemini":
				return this.callGemini(messages);
			case "tavily":
				return this.callTavily(messages);
			case "moonshot-k2.5":
				return this.callMoonshot(messages, "kimi-k2.5");
			case "moonshot-k2.6":
				return this.callMoonshot(messages, "kimi-k2.6");
			case "xiaomi-mimo":
				return this.callXiaomi(messages);
			case "qwen3.5-plus":
				return this.callQwen(messages, "qwen-plus");
			case "qwen3.6-plus":
				return this.callQwen(messages, "qwen-plus");
			case "minimax-m2.5":
				return this.callMiniMax(messages, "MiniMax-M2.5");
			case "minimax-m2.7":
				return this.callMiniMax(messages, "MiniMax-M2.7");
			case "glm-deepinfra":
				return this.callDeepInfra(messages, "THUDM/glm-4-9b-chat");
			case "glm-fireworks":
				return this.callFireworks(messages, "THUDM/glm-4-9b-chat");
			case "glm-zai":
				return this.callZai(messages, "THUDM/glm-4-9b-chat");
			case "groq":
				return this.callGroq(messages);
			case "kiro-ai":
				return this.callKiroAI(messages);
			case "mistral":
				return this.callMistral(messages);
			case "openai":
				return this.callOpenAI(messages);
			default:
				throw new Error(`Unknown provider: ${provider}`);
		}
	}

	private async callOpenCode(messages: LLMMessage[]): Promise<LLMResponse> {
		// Simulate 429 rate limit for demo purposes
		if (this.simulateFailure && !this.failureSimulated) {
			this.failureSimulated = true;
			throw new Error("OpenCode Go API Error: 429 Rate Limit Exceeded");
		}

		const response = await fetch(this.API_URLS["opencode-go"], {
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
		const response = await fetch(this.API_URLS.deepseek, {
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

	private async callGemini(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(`${this.API_URLS.gemini}?key=${this.geminiApiKey}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				contents: messages.map((msg) => ({
					role: msg.role === "assistant" ? "model" : msg.role,
					parts: [{ text: msg.content }],
				})),
			}),
			signal: AbortSignal.timeout(30000), // 30 second timeout
		});

		if (!response.ok) {
			throw new Error(
				`Gemini API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
		return {
			content,
			provider: "gemini",
			model: "gemini-2.0-flash",
			usage: {
				promptTokens: data.usageMetadata?.promptTokenCount || 0,
				completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
				totalTokens: data.usageMetadata?.totalTokenCount || 0,
			},
		};
	}

	/**
	 * Tavily Search - Real-time web search for AI agents
	 * Takes first user message as search query
	 */
	private async callTavily(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.tavilyApiKey) {
			throw new Error("Tavily API key not configured. Get one at https://app.tavily.com/");
		}

		// Extract query from user message
		const userMessage = messages.find(m => m.role === "user");
		const query = userMessage?.content || messages[0]?.content || "";
		
		if (!query) {
			throw new Error("Tavily search requires a query");
		}

		const response = await fetch(this.API_URLS.tavily, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.tavilyApiKey}`,
			},
			body: JSON.stringify({
				query,
				max_results: 10,
				include_answer: true,
				include_raw_content: false,
				include_images: false,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`Tavily API Error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		
		// Format results for LLM consumption
		const results = data.results || [];
		const answer = data.answer || "";
		
		// Format as structured content
		let content = "";
		if (answer) {
			content = `Summary: ${answer}\n\n`;
		}
		content += "Search Results:\n";
		results.forEach((result: any, index: number) => {
			content += `${index + 1}. ${result.title}: ${result.content}\nURL: ${result.url}\n\n`;
		});

		return {
			content,
			provider: "tavily",
			model: "tavily-search",
			usage: {
				promptTokens: query.length,
				completionTokens: content.length,
				totalTokens: query.length + content.length,
			},
		};
	}

	private async callDeepSeekV4(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(this.API_URLS["deepseek-v4"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.deepseekApiKey}`,
			},
			body: JSON.stringify({
				model: "deepseek-chat",
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`DeepSeek V4 API Error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "deepseek-v4",
			model: "deepseek-chat",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callMoonshot(messages: LLMMessage[], model: string): Promise<LLMResponse> {
		if (!this.moonshotApiKey) {
			throw new Error("Moonshot API key not configured");
		}
		
		const response = await fetch(this.API_URLS["moonshot-k2.5"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.moonshotApiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`Moonshot (Kimi) API Error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "moonshot-k2.6",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callXiaomi(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.xiaomiApiKey) {
			throw new Error("Xiaomi API key not configured");
		}
		
		const response = await fetch(this.API_URLS["xiaomi-mimo"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.xiaomiApiKey}`,
			},
			body: JSON.stringify({
				model: "MiMo-V2-8B",
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`Xiaomi MiMo API Error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "xiaomi-mimo",
			model: "MiMo-V2-8B",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callQwen(messages: LLMMessage[], model: string): Promise<LLMResponse> {
		if (!this.alibabaApiKey) {
			throw new Error("Alibaba API key not configured");
		}
		
		const response = await fetch(this.API_URLS["qwen3.6-plus"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.alibabaApiKey}`,
			},
			body: JSON.stringify({
				model,
				input: { messages },
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`Qwen (Alibaba) API Error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return {
			content: data.output?.choices?.[0]?.message?.content || data.output?.text || "",
			provider: "qwen3.6-plus",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callMiniMax(messages: LLMMessage[], model: string): Promise<LLMResponse> {
		if (!this.minimaxApiKey) {
			throw new Error("MiniMax API key not configured");
		}
		
		const response = await fetch(this.API_URLS["minimax-m2.7"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.minimaxApiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`MiniMax API Error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "minimax-m2.7",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callDeepInfra(messages: LLMMessage[], model: string): Promise<LLMResponse> {
		if (!this.deepinfraApiKey) {
			throw new Error("DeepInfra API key not configured");
		}
		
		const response = await fetch(this.API_URLS["glm-deepinfra"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.deepinfraApiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`DeepInfra API Error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "glm-deepinfra",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callFireworks(messages: LLMMessage[], model: string): Promise<LLMResponse> {
		if (!this.fireworksApiKey) {
			throw new Error("Fireworks API key not configured");
		}
		
		const response = await fetch(this.API_URLS["glm-fireworks"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.fireworksApiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(`Fireworks AI API Error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "glm-fireworks",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callGroq(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.groqApiKey) {
			throw new Error("Groq API key not configured. Get one at https://console.groq.com/keys");
		}

		const response = await fetch(this.API_URLS.groq, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.groqApiKey}`,
			},
			body: JSON.stringify({
				model: "llama-3.3-70b-versatile",
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(`Groq API Error: ${response.status} ${response.statusText} ${errorText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "groq",
			model: "llama-4-maverick-17b-128e-instruct",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callKiroAI(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(this.API_URLS["kiro-ai"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// Kiro AI does not require authentication
			},
			body: JSON.stringify({
				model: MODEL_NAMES["kiro-ai"],
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(`Kiro AI API Error: ${response.status} ${response.statusText} ${errorText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "kiro-ai",
			model: MODEL_NAMES["kiro-ai"],
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callMistral(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.mistralApiKey) {
			throw new Error("Mistral API key not configured. Get one at https://console.mistral.ai/");
		}

		const response = await fetch(this.API_URLS.mistral, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.mistralApiKey}`,
			},
			body: JSON.stringify({
				model: MODEL_NAMES.mistral,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(`Mistral API Error: ${response.status} ${response.statusText} ${errorText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "mistral",
			model: MODEL_NAMES.mistral,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callOpenAI(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.openaiApiKey) {
			throw new Error("OpenAI API key not configured. Get one at https://platform.openai.com/");
		}

		const response = await fetch(this.API_URLS.openai, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.openaiApiKey}`,
			},
			body: JSON.stringify({
				model: MODEL_NAMES.openai,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(`OpenAI API Error: ${response.status} ${response.statusText} ${errorText}`);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "openai",
			model: MODEL_NAMES.openai,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}
}
