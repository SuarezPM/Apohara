import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { OAuthTokenStore } from "../lib/oauth-token-store";

// Dynamic imports to avoid circular dependencies
let geminiOAuth: typeof import("../lib/oauth/gemini") | null = null;

async function getGeminiOAuth() {
	if (!geminiOAuth) {
		geminiOAuth = await import("../lib/oauth/gemini");
	}
	return geminiOAuth;
}

const FREE_PROVIDERS = new Set(["kiro-ai", "iflow-ai"]);

// OAuth providers that use token-based auth
const OAUTH_PROVIDERS = new Set(["claude-ai", "anthropic", "gemini-ai"]);

/**
 * Maps provider IDs to their canonical environment variable names.
 * Used by resolveCredential/resolveCredentialSync to resolve credentials
 * saved via the config wizard (which stores ENV_VAR-style keys).
 */
export const PROVIDER_TO_ENV_MAP: Record<string, string> = {
	"opencode-go": "OPENCODE_API_KEY",
	"anthropic-api": "ANTHROPIC_API_KEY",
	"gemini-api": "GOOGLE_AI_STUDIO_API_KEY",
	"deepseek": "DEEPSEEK_API_KEY",
	"deepseek-v4": "DEEPSEEK_API_KEY",
	"gemini": "GEMINI_API_KEY",
	"tavily": "TAVILY_API_KEY",
	"moonshot": "MOONSHOT_API_KEY",
	"xiaomi": "XIAOMI_API_KEY",
	"alibaba": "ALIBABA_API_KEY",
	"minimax": "MINIMAX_API_KEY",
	"deepinfra": "DEEPINFRA_API_KEY",
	"fireworks": "FIREWORKS_API_KEY",
	"zai": "ZAI_API_KEY",
	"groq": "GROQ_API_KEY",
	"kiro-ai": "KIRO_AI_API_KEY",
	"mistral": "MISTRAL_API_KEY",
	"openai": "OPENAI_API_KEY",
};

function getCredentialsPath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	if (xdgConfig) {
		return path.join(xdgConfig, "apohara", "credentials.json");
	}
	return path.join(os.homedir(), ".apohara", "credentials.json");
}

function readCredentialsFileSync(): Record<string, unknown> | null {
	try {
		const content = readFileSync(getCredentialsPath(), "utf-8");
		return JSON.parse(content) as Record<string, unknown>;
	} catch {
		return null;
	}
}

interface CredentialsFile {
	[provider: string]: { apiKey?: string } | string;
}

function extractKey(entry: unknown): string | null {
	if (typeof entry === "string" && entry.length > 0) {
		return entry;
	}
	if (entry && typeof entry === "object" && "apiKey" in entry) {
		const key = (entry as { apiKey?: string }).apiKey;
		if (typeof key === "string" && key.length > 0) {
			return key;
		}
	}
	return null;
}

/**
 * Pre-populates process.env with credentials from ~/.apohara/credentials.json.
 * Called at CLI startup BEFORE ProviderRouter instantiation.
 * Respects precedence: existing env vars are NOT overwritten.
 * Returns the count of injected credentials for logging.
 */
export function injectCredentials(): { injected: number; skipped: number; providers: string[] } {
	const parsed = readCredentialsFileSync();
	if (!parsed) {
		return { injected: 0, skipped: 0, providers: [] };
	}

	let injected = 0;
	let skipped = 0;
	const providers: string[] = [];

	for (const [envKey, rawValue] of Object.entries(parsed)) {
		// Skip non-string values and empty strings
		const value = extractKey(rawValue);
		if (!value) continue;

		// Only inject if the env var is not already set
		if (!process.env[envKey] || process.env[envKey]!.length === 0) {
			process.env[envKey] = value;
			injected++;
			providers.push(envKey);
		} else {
			skipped++;
		}
	}

	return { injected, skipped, providers };
}

/**
 * Resolves the API key for a given provider using the following precedence:
 * 1. ~/.apohara/credentials.json
 * 2. Environment variable (PROVIDER_API_KEY uppercase with underscores)
 * 3. Free-tier anonymous token
 * 4. null if not found
 */
export async function resolveCredential(provider: string): Promise<string | null> {
	// 1. Try credentials file
	try {
		const credPath = getCredentialsPath();
		const content = await fs.readFile(credPath, "utf-8");
		const parsed: CredentialsFile = JSON.parse(content);

		// 1a. Try direct provider-ID lookup first
		const entry = parsed[provider];
		const key = extractKey(entry);
		if (key) return key;

		// 1b. Try ENV_VAR-style key (config wizard format)
		const envStyleKey = PROVIDER_TO_ENV_MAP[provider];
		if (envStyleKey) {
			const envEntry = parsed[envStyleKey];
			const envKey = extractKey(envEntry);
			if (envKey) return envKey;
		}
	} catch {
		// File doesn't exist or is invalid — fall through
	}

	// 2. Try environment variable
	const envKey = provider.toUpperCase().replace(/-/g, "_") + "_API_KEY";
	const envValue = process.env[envKey];
	if (envValue && envValue.length > 0) {
		return envValue;
	}

	// 3. Free-tier providers don't need auth
	if (FREE_PROVIDERS.has(provider)) {
		return "anonymous";
	}

	// 4. Not found
	return null;
}

/**
 * Synchronous version for contexts where async is not available.
 * Checks credentials file, then environment variables, then free-tier.
 */
export function resolveCredentialSync(provider: string): string | null {
	// 1. Try credentials file (sync)
	const parsed = readCredentialsFileSync();
	if (parsed) {
		// 1a. Try direct provider-ID lookup first
		const entry = parsed[provider];
		const key = extractKey(entry);
		if (key) return key;

		// 1b. Try ENV_VAR-style key (config wizard format)
		const envStyleKey = PROVIDER_TO_ENV_MAP[provider];
		if (envStyleKey) {
			const envEntry = parsed[envStyleKey];
			const envKey = extractKey(envEntry);
			if (envKey) return envKey;
		}
	}

	// 2. Try environment variable
	const envKey = provider.toUpperCase().replace(/-/g, "_") + "_API_KEY";
	const envValue = process.env[envKey];
	if (envValue && envValue.length > 0) {
		return envValue;
	}

	// 3. Free-tier providers don't need auth
	if (FREE_PROVIDERS.has(provider)) {
		return "anonymous";
	}

	return null;
}

// OAuth token endpoint for Claude.ai
const CLAUDE_TOKEN_ENDPOINT = "https://claude.ai/api/oauth/token";

// Lazy-loaded OAuth token stores
const tokenStores = new Map<string, OAuthTokenStore>();

/**
 * Get or create an OAuth token store for a provider
 * Uses lazy initialization to avoid circular dependencies
 */
function getTokenStore(provider: string): OAuthTokenStore {
	// Handle gemini-ai specially using the gemini OAuth module
	if (provider === "gemini-ai") {
		let store = tokenStores.get(provider);
		if (!store) {
			const { createGeminiTokenStore } = require("../lib/oauth-token-store");
			
			// Load client ID and secret from credentials
			// For Google OAuth, we need client credentials
			// This will be handled via the gemini OAuth module directly for login
			// For token refresh, we need proper configuration
			store = createGeminiTokenStore("" /* clientId will be loaded on refresh */);
			tokenStores.set(provider, store);
		}
		return store;
	}

	let store = tokenStores.get(provider);
	if (!store) {
		// Import the token store class dynamically
		const { OAuthTokenStore: OAuthStore } = require("../lib/oauth-token-store");
		
		// Create refresh handler for the provider
		const refreshHandler = async (refreshToken: string): Promise<OAuthToken> => {
			// Load client ID from credentials
			const clientId = await loadClientId(provider);
			if (!clientId) {
				throw new Error(`No client ID configured for ${provider}`);
			}
			
			const response = await fetch(CLAUDE_TOKEN_ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: clientId,
				}),
			});

			if (!response.ok) {
				throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
			}

			const data = await response.json() as {
				access_token: string;
				refresh_token?: string;
				token_type: string;
				expires_in: number;
				scope?: string;
			};

			// Calculate new expiration time
			const expires_at = Date.now() + data.expires_in * 1000;

			return {
				access_token: data.access_token,
				refresh_token: data.refresh_token || refreshToken,
				token_type: data.token_type,
				expires_at,
				scope: data.scope,
			};
		};

		store = new OAuthStore({ provider }, refreshHandler);
		tokenStores.set(provider, store);
	}
	return store;
}

/**
 * Load client ID from credentials file for a provider
 */
async function loadClientId(provider: string): Promise<string> {
	try {
		const credPath = getCredentialsPath();
		const content = await fs.readFile(credPath, "utf-8");
		const parsed = JSON.parse(content);
		// Map provider names to credential keys
		const keyMap: Record<string, string> = {
			"claude-ai": "claude-oauth-client-id",
			"anthropic": "claude-oauth-client-id",
		};
		const key = keyMap[provider] || `${provider}-oauth-client-id`;
		return parsed[key] || "";
	} catch {
		return "";
	}
}

/**
 * Resolves an OAuth access token for a given provider
 * Uses the OAuth token store to get valid tokens with auto-refresh
 *
 * @param provider - The OAuth provider (e.g., "claude-ai", "anthropic")
 * @returns The access token string, or null if not available
 */
export async function resolveOAuthToken(provider: string): Promise<string | null> {
	// Only attempt OAuth for known OAuth providers
	if (!OAUTH_PROVIDERS.has(provider)) {
		return null;
	}

	// Handle gemini-ai specially using the gemini OAuth module
	if (provider === "gemini-ai") {
		try {
			const gemini = await getGeminiOAuth();
			return await gemini.getGeminiAccessToken();
		} catch (error) {
			console.error(`[credentials] Failed to resolve OAuth token for ${provider}:`, error);
			return null;
		}
	}

	try {
		const store = getTokenStore(provider);
		const token = await store.getToken();
		return token?.access_token ?? null;
	} catch (error) {
		console.error(`[credentials] Failed to resolve OAuth token for ${provider}:`, error);
		return null;
	}
}

/**
 * Checks if OAuth token is available and valid for a provider
 */
export async function hasOAuthToken(provider: string): Promise<boolean> {
	if (!OAUTH_PROVIDERS.has(provider)) {
		return false;
	}

	// Handle gemini-ai specially
	if (provider === "gemini-ai") {
		try {
			const gemini = await getGeminiOAuth();
			return await gemini.hasValidGeminiCredentials();
		} catch {
			return false;
		}
	}

	try {
		const store = getTokenStore(provider);
		return store.hasToken();
	} catch {
		return false;
	}
}

/**
 * Validates API key format for a given key name.
 * Returns { valid: true } for empty values (user can skip optional keys).
 * Used by config wizard and provider router to reject malformed keys early.
 */
export function validateApiKeyFormat(
	keyName: string,
	value: string,
): { valid: boolean; error?: string } {
	if (!value) return { valid: true };

	switch (keyName) {
		case "ANTHROPIC_API_KEY":
			// sk-ant-oat01-* are OAuth tokens, not API keys — reject explicitly
			if (!value.startsWith("sk-ant-api03-")) {
				return {
					valid: false,
					error: `Invalid Anthropic API key format. Keys must start with 'sk-ant-api03-'. Note: OAuth tokens (sk-ant-oat01-*) are not supported.`,
				};
			}
			if (value.length < 40) {
				return {
					valid: false,
					error: `Invalid Anthropic API key: too short (minimum 40 characters).`,
				};
			}
			break;

		case "OPENCODE_API_KEY":
			if (!value.startsWith("oc-") && !value.startsWith("opencode-")) {
				return {
					valid: false,
					error: `Invalid OpenCode API key format. Keys must start with 'oc-' or 'opencode-'.`,
				};
			}
			if (value.length < 20) {
				return {
					valid: false,
					error: `Invalid OpenCode API key: too short (minimum 20 characters).`,
				};
			}
			break;

		case "GOOGLE_AI_STUDIO_API_KEY":
			// Google AI Studio keys: AIza prefix + 35 chars = 39 total
			if (!value.startsWith("AIza")) {
				return {
					valid: false,
					error: `Invalid Google AI Studio API key format. Keys must start with 'AIza'.`,
				};
			}
			if (value.length !== 39) {
				return {
					valid: false,
					error: `Invalid Google AI Studio API key: must be exactly 39 characters (AIza + 35 chars).`,
				};
			}
			break;

		case "OPENAI_API_KEY":
			if (!value.startsWith("sk-") && !value.startsWith("sk-proj-")) {
				return {
					valid: false,
					error: `Invalid OpenAI API key format. Keys must start with 'sk-' or 'sk-proj-'.`,
				};
			}
			if (value.length < 40) {
				return {
					valid: false,
					error: `Invalid OpenAI API key: too short (minimum 40 characters).`,
				};
			}
			break;

		case "DEEPSEEK_API_KEY":
			if (!value.startsWith("sk-") && !value.startsWith("deepseek-")) {
				return {
					valid: false,
					error: `Invalid DeepSeek API key format. Keys must start with 'sk-' or 'deepseek-'.`,
				};
			}
			if (value.length < 20) {
				return {
					valid: false,
					error: `Invalid DeepSeek API key: too short (minimum 20 characters).`,
				};
			}
			break;

		default:
			if (value.length < 10) {
				return {
					valid: false,
					error: `Invalid API key for ${keyName}: too short (minimum 10 characters).`,
				};
			}
			break;
	}

	return { valid: true };
}

/**
 * Gets sanitized OAuth token info for logging
 */
export async function getOAuthTokenInfo(provider: string): Promise<Record<string, unknown>> {
	if (!OAUTH_PROVIDERS.has(provider)) {
		return { provider, oauth_supported: false };
	}

	// Handle gemini-ai specially
	if (provider === "gemini-ai") {
		try {
			const gemini = await getGeminiOAuth();
			return await gemini.getGeminiTokenInfo();
		} catch {
			return { provider, error: "Failed to get token info" };
		}
	}

	try {
		const store = getTokenStore(provider);
		return store.getSanitizedInfo();
	} catch {
		return { provider, error: "Failed to get token info" };
	}
}
