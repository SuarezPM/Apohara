// Role types for task routing (role: research, planning, execution, verification)
export type TaskRole = "research" | "planning" | "execution" | "verification";

// All supported LLM providers and models
// Based on user's model list: GLM-5.1, GLM-5, Kimi K2.5, K2.6, MiMo-V2 series, Qwen3.5/3.6 Plus, MiniMax M2.5/M2.7, DeepSeek V4
export type ProviderId =
	| "opencode-go"           // OpenCode Go - Anthropic Messages API at api.opencode.ai
	| "anthropic-api"        // Anthropic direct API - sk-ant-api03-* keys
	| "gemini-api"           // Google AI Studio - x-goog-api-key header
	| "deepseek-v4"          // DeepSeek V4 Pro/Flash - Reasoning & coding
	| "deepseek"             // DeepSeek Coder (fallback)
	| "tavily"               // Tavily - Web search for AI agents
	| "gemini"               // Gemini 2.0 - Planning (generateContent format)
	| "moonshot-k2.5"        // Kimi K2.5 (Moonshot)
	| "moonshot-k2.6"        // Kimi K2.6 (Moonshot) - Latest & most powerful
	| "xiaomi-mimo"          // Xiaomi MiMo V2 series
	| "qwen3.5-plus"         // Qwen 3.5 Plus (Alibaba)
	| "qwen3.6-plus"         // Qwen 3.6 Plus (Alibaba) - Latest
	| "minimax-m2.5"         // MiniMax M2.5
	| "minimax-m2.7"         // MiniMax M2.7 - Latest from MiniMax
	| "glm-deepinfra"        // GLM via DeepInfra
	| "glm-fireworks"        // GLM via Fireworks AI
	| "glm-zai"              // GLM via Z.ai
	| "groq"                 // Groq - Ultra-fast inference (Llama, Qwen, etc.)
	| "kiro-ai"              // Kiro AI - Free tier, no auth required
	| "mistral"              // Mistral AI - Free tier (mistral-small-latest)
	| "openai";              // OpenAI - gpt-4o-mini

// Model capabilities for intelligent routing
export interface ModelCapability {
	id: ProviderId;
	name: string;
	provider: string; // Company name
	bestFor: TaskRole[]; // Primary roles this model excels at
	strengths: string[];
	contextWindow: number; // Max tokens
	supportsVision: boolean;
}

// All available models with their capabilities
export const MODELS: ModelCapability[] = [
	// DeepSeek V4 - Most powerful for reasoning and coding
	{
		id: "deepseek-v4",
		name: "DeepSeek V4 Pro",
		provider: "DeepSeek",
		bestFor: ["execution", "verification"],
		strengths: ["code generation", "reasoning", "debugging", "low latency"],
		contextWindow: 128000,
		supportsVision: false,
	},
	// Kimi K2.6 - Latest and very powerful
	{
		id: "moonshot-k2.6",
		name: "Kimi K2.6",
		provider: "Moonshot AI",
		bestFor: ["execution", "planning"],
		strengths: ["long context", "code generation", "reasoning"],
		contextWindow: 200000,
		supportsVision: true,
	},
	{
		id: "moonshot-k2.5",
		name: "Kimi K2.5",
		provider: "Moonshot AI",
		bestFor: ["execution", "planning"],
		strengths: ["code generation", "reasoning"],
		contextWindow: 128000,
		supportsVision: true,
	},
	// Qwen 3.6 Plus - Latest from Alibaba
	{
		id: "qwen3.6-plus",
		name: "Qwen 3.6 Plus",
		provider: "Alibaba Cloud",
		bestFor: ["planning", "execution"],
		strengths: ["code generation", "multilingual", "reasoning"],
		contextWindow: 131072,
		supportsVision: true,
	},
	{
		id: "qwen3.5-plus",
		name: "Qwen 3.5 Plus",
		provider: "Alibaba Cloud",
		bestFor: ["planning", "execution"],
		strengths: ["code generation", "cost-effective"],
		contextWindow: 32768,
		supportsVision: false,
	},
	// MiniMax M2.7 - Latest
	{
		id: "minimax-m2.7",
		name: "MiniMax M2.7",
		provider: "MiniMax",
		bestFor: ["execution", "planning"],
		strengths: ["code generation", "reasoning"],
		contextWindow: 100000,
		supportsVision: false,
	},
	{
		id: "minimax-m2.5",
		name: "MiniMax M2.5",
		provider: "MiniMax",
		bestFor: ["execution"],
		strengths: ["code generation"],
		contextWindow: 100000,
		supportsVision: false,
	},
	// Xiaomi MiMo
	{
		id: "xiaomi-mimo",
		name: "Xiaomi MiMo V2",
		provider: "Xiaomi",
		bestFor: ["execution"],
		strengths: ["code generation", "efficient"],
		contextWindow: 32768,
		supportsVision: false,
	},
	// GLM models via different providers
	{
		id: "glm-deepinfra",
		name: "GLM-5 via DeepInfra",
		provider: "DeepInfra",
		bestFor: ["planning"],
		strengths: ["multilingual", "fast"],
		contextWindow: 128000,
		supportsVision: true,
	},
	{
		id: "glm-fireworks",
		name: "GLM-5 via Fireworks",
		provider: "Fireworks AI",
		bestFor: ["planning"],
		strengths: ["multilingual", "fast"],
		contextWindow: 128000,
		supportsVision: true,
	},
	{
		id: "glm-zai",
		name: "GLM-5 via Z.ai",
		provider: "Z.ai",
		bestFor: ["planning"],
		strengths: ["multilingual", "fast"],
		contextWindow: 128000,
		supportsVision: true,
	},
	// Groq - Ultra-fast inference for planning and execution
	{
		id: "groq",
		name: "Groq (Llama 4 Maverick / Qwen 3)",
		provider: "Groq",
		bestFor: ["planning", "execution"],
		strengths: ["ultra-low latency", "high throughput", "cost-effective", "openai-compatible"],
		contextWindow: 131072,
		supportsVision: false,
	},
	// Kiro AI - Free tier, no auth required
	{
		id: "kiro-ai",
		name: "Kiro AI (Claude Sonnet / DeepSeek / Qwen)",
		provider: "Kiro AI",
		bestFor: ["planning", "execution", "verification"],
		strengths: ["free tier", "no auth required", "multiple models", "openai-compatible"],
		contextWindow: 200000,
		supportsVision: false,
	},
	// Mistral - Free tier
	{
		id: "mistral",
		name: "Mistral Small Latest",
		provider: "Mistral AI",
		bestFor: ["execution", "planning"],
		strengths: ["free tier available", "european", "openai-compatible"],
		contextWindow: 32000,
		supportsVision: false,
	},
	// OpenAI - Cost-effective mini model
	{
		id: "openai",
		name: "OpenAI GPT-4o Mini",
		provider: "OpenAI",
		bestFor: ["execution", "verification"],
		strengths: ["reliable", "cost-effective", "fast"],
		contextWindow: 128000,
		supportsVision: false,
	},
	// Tavily - Real-time web search for AI agents (replaces Perplexity)
	{
		id: "tavily",
		name: "Tavily Search API",
		provider: "Tavily",
		bestFor: ["research"],
		strengths: ["real-time web search", "web extraction", "research", "up-to-date info", "AI-optimized"],
		contextWindow: 10000, // Optimizado para resultados de búsqueda
		supportsVision: false,
	},
	// Paid API providers with Anthropic Messages API format
	{
		id: "anthropic-api",
		name: "Anthropic Claude",
		provider: "Anthropic",
		bestFor: ["execution", "planning", "verification"],
		strengths: ["code generation", "reasoning", "long context"],
		contextWindow: 200000,
		supportsVision: true,
	},
	{
		id: "gemini-api",
		name: "Google AI Studio",
		provider: "Google",
		bestFor: ["execution", "planning", "research"],
		strengths: ["long context", "multimodal", "fast"],
		contextWindow: 1000000,
		supportsVision: true,
	},
	// Legacy providers
	{
		id: "opencode-go",
		name: "OpenCode Go",
		provider: "OpenCode",
		bestFor: ["execution"],
		strengths: ["code generation", "Anthropic Messages API compatible"],
		contextWindow: 128000,
		supportsVision: true,
	},
	{
		id: "deepseek",
		name: "DeepSeek Coder",
		provider: "DeepSeek",
		bestFor: ["verification", "execution"],
		strengths: ["code generation", "debugging"],
		contextWindow: 16384,
		supportsVision: false,
	},
	{
		id: "gemini",
		name: "Gemini 2.0 Flash",
		provider: "Google",
		bestFor: ["planning", "research"],
		strengths: ["fast", "multimodal", "grounding"],
		contextWindow: 1000000,
		supportsVision: true,
	},
];

// Get model capability by ID
export function getModelById(id: ProviderId): ModelCapability | undefined {
	return MODELS.find((m) => m.id === id);
}

// Get best models for a specific role (sorted by capability)
export function getBestModelsForRole(role: TaskRole): ModelCapability[] {
	return MODELS.filter((m) => m.bestFor.includes(role))
		.sort((a, b) => b.contextWindow - a.contextWindow);
}

// Role-to-provider mapping with intelligent selection
// Uses Groq as primary (available via GROQ_API_KEY) with fallbacks
export const ROLE_TO_PROVIDER: Record<TaskRole, ProviderId> = {
	research: "tavily",
	planning: "moonshot-k2.6",
	execution: "deepseek-v4",
	verification: "deepseek-v4",
};

// Fallback provider order for each role (primary + fallbacks)
export const ROLE_FALLBACK_ORDER: Record<TaskRole, ProviderId[]> = {
	research: ["tavily", "gemini", "moonshot-k2.6"],
	planning: ["moonshot-k2.6", "qwen3.6-plus", "gemini", "glm-deepinfra"],
	execution: ["deepseek-v4", "moonshot-k2.6", "qwen3.6-plus", "opencode-go", "minimax-m2.7"],
	verification: ["deepseek-v4", "deepseek", "moonshot-k2.5"],
};

export interface Task {
	id: string;
	role?: TaskRole;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	createdAt: Date;
	updatedAt: Date;
	/** Files this task claims ownership of (writes to) */
	targetFiles?: string[];
	/** Dependencies injected by the system (e.g. collision serialization) */
	implicitDependencies?: string[];
}

export type EventSeverity = "info" | "warning" | "error";

export interface EventLog {
	id: string;
	timestamp: string; // ISO string
	type: string;
	severity: EventSeverity;
	taskId?: string;
	payload: Record<string, unknown>;
	metadata?: {
		provider?: ProviderId;
		model?: string;
		modelName?: string;        // Full model name (e.g., "DeepSeek V4 Pro")
		modelProvider?: string;    // Company (e.g., "DeepSeek")
		contextWindow?: number;     // Max context tokens
		tokens?: { prompt: number; completion: number; total: number };
		costUsd?: number;
		durationMs?: number;
		role?: TaskRole;
		fromProvider?: ProviderId;
		toProvider?: ProviderId;
		errorReason?: string;
		fallbackProviders?: ProviderId[]; // List of fallback providers attempted
		capabilityScore?: number;
	};
}

export interface OrchestratorState {
	currentTaskId: string | null;
	tasks: Task[];
	status: "idle" | "running" | "paused" | "error";
	lastError?: string;
	// Provider cooldown tracking for state persistence
	failedProviderTimestamps?: Record<string, number>; // providerId -> timestamp of last failure
}
