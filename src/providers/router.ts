import { config } from "../core/config";

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
}

export class ProviderRouter {
	private readonly OPENCODE_API_URL =
		"https://api.opencode.com/v1/chat/completions";
	private readonly DEEPSEEK_API_URL =
		"https://api.deepseek.com/v1/chat/completions";

	private opencodeApiKey: string;
	private deepseekApiKey: string;

	constructor(cfg?: RouterConfig) {
		this.opencodeApiKey = cfg?.opencodeApiKey || config.OPENCODE_API_KEY;
		this.deepseekApiKey = cfg?.deepseekApiKey || config.DEEPSEEK_API_KEY;
	}

	/**
	 * Routes the request to the specified provider.
	 * If the request fails due to 429 or timeout, we could handle fallbacks here
	 * or let the orchestrator handle it (planned for S05).
	 */
	public async completion(req: LLMRequest): Promise<LLMResponse> {
		const provider = req.provider || "opencode-go";

		if (provider === "opencode-go") {
			return this.callOpenCode(req.messages);
		}
		return this.callDeepSeek(req.messages);
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
