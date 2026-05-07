/**
 * Auth command - OAuth authentication for Claude.ai and other providers
 */

import { Command } from "commander";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { generateCodeVerifier, generateCodeChallenge, calculateExpiresAt } from "../lib/oauth-pkce.js";
import { password } from "@inquirer/prompts";
import { PROVIDER_TO_ENV_MAP } from "../core/credentials.js";

// Claude.ai OAuth configuration
const CLAUDE_OAUTH_CONFIG = {
	authorizationEndpoint: "https://claude.ai/api/oauth/authorize",
	tokenEndpoint: "https://claude.ai/api/oauth/token",
	clientId: "", // Will be loaded from credentials
	scope: "api",
};

// Default redirect URI for local callback
const DEFAULT_REDIRECT_URI = "http://localhost:28563/callback";

/**
 * Get credentials path for storing OAuth tokens
 */
function getOAuthCredentialsPath(provider: string): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	if (xdgConfig) {
		return path.join(xdgConfig, "apohara", `oauth-${provider}.json`);
	}
	return path.join(os.homedir(), ".apohara", `oauth-${provider}.json`);
}

/**
 * Load client ID from credentials file
 */
async function loadClientId(): Promise<string> {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	const credPath = xdgConfig
		? path.join(xdgConfig, "apohara", "credentials.json")
		: path.join(os.homedir(), ".apohara", "credentials.json");

	try {
		const content = await fs.readFile(credPath, "utf-8");
		const parsed = JSON.parse(content);
		return parsed["claude-oauth-client-id"] || "";
	} catch {
		return "";
	}
}

/**
 * Start a local HTTP server to receive OAuth callback
 */
function startCallbackServer(port: number): Promise<{ server: ReturnType<typeof import("http").createServer>; code: Promise<string> }> {
	return new Promise((resolve, reject) => {
		const http = require("http");

		let resolveCode: (code: string) => void;
		const codePromise = new Promise<string>((res) => {
			resolveCode = res;
		});

		const server = http.createServer((req: ReturnType<typeof import("http").IncomingMessage>, res: ReturnType<typeof import("http").ServerResponse>) => {
			const url = new URL(req.url || "/", `http://localhost:${port}`);

			if (url.pathname === "/callback") {
				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end("<html><body><h1>Authentication Failed</h1><p>Error: " + error + "</p></body></html>");
					resolveCode(null as unknown as string);
					server.close();
					return;
				}

				if (code) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end("<html><body><h1>Authentication Successful!</h1><p>You may close this window.</p></body></html>");
					resolveCode(code);
					server.close();
					return;
				}

				res.writeHead(400, { "Content-Type": "text/html" });
				res.end("<html><body><h1>Error</h1><p>No authorization code received.</p></body></html>");
				server.close();
			} else {
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not found");
			}
		});

		server.listen(port, () => {
			console.log(`[Auth] Callback server listening on http://localhost:${port}`);
		});

		server.on("error", (err: any) => {
			if (err.code === 'EADDRINUSE') {
				reject(new Error(`OAuth callback port ${port} is already in use. Please free the port (e.g., 'killall node') and try again.`));
			} else {
				reject(err);
			}
		});

		// Timeout after 5 minutes
		setTimeout(() => {
			server.close();
			reject(new Error("OAuth callback timed out"));
		}, 5 * 60 * 1000);

		resolve({ server, code: codePromise });
	});
}

/**
 * Open URL in default browser
 */
async function openBrowser(url: string): Promise<void> {
	const { exec } = require("child_process");
	const platform = process.platform;

	let command: string;
	if (platform === "darwin") {
		command = `open "${url}"`;
	} else if (platform === "win32") {
		command = `start "" "${url}"`;
	} else {
		command = `xdg-open "${url}"`;
	}

	return new Promise((resolve, reject) => {
		exec(command, (error: Error | null) => {
			if (error) {
				console.error("[Auth] Failed to open browser:", error.message);
				reject(error);
			} else {
				resolve();
			}
		});
	});
}

/**
 * Perform OAuth login flow for Claude.ai
 */
async function loginClaude(): Promise<void> {
	console.log("[Auth] Starting Claude.ai OAuth login...");

	// Load client ID from credentials
	const clientId = await loadClientId();
	if (!clientId) {
		console.error("❌ No client ID configured. Please add 'claude-oauth-client-id' to credentials.json");
		console.log("   Run: apohara config --set claude-oauth-client-id=YOUR_CLIENT_ID");
		process.exit(1);
	}

	// Generate PKCE verifier and challenge
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);

	console.log("[Auth] Generated PKCE code_verifier and code_challenge");

	// Use exactly port 28563 for callback
	const callbackPort = 28563;
	const redirectUri = `http://localhost:${callbackPort}/callback`;

	console.log(`[Auth] Starting callback server on port ${callbackPort}...`);

	// Start callback server
	const { server, code: codePromise } = await startCallbackServer(callbackPort);

	try {
		// Build authorization URL
		const authUrl = new URL(CLAUDE_OAUTH_CONFIG.authorizationEndpoint);
		authUrl.searchParams.set("client_id", clientId);
		authUrl.searchParams.set("redirect_uri", redirectUri);
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("scope", CLAUDE_OAUTH_CONFIG.scope);
		authUrl.searchParams.set("code_challenge", codeChallenge);
		authUrl.searchParams.set("code_challenge_method", "S256");

		console.log("[Auth] Opening browser for authentication...");
		console.log(`[Auth] Authorization URL: ${authUrl.toString().replace(clientId, "***")}`);

		// Open browser
		await openBrowser(authUrl.toString());

		console.log("[Auth] Waiting for authorization code...");

		// Wait for authorization code
		const authCode = await codePromise;

		if (!authCode) {
			console.error("❌ No authorization code received");
			process.exit(1);
		}

		console.log("[Auth] Received authorization code, exchanging for tokens...");

		// Exchange code for tokens
		const tokenResponse = await fetch(CLAUDE_OAUTH_CONFIG.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: authCode,
				redirect_uri: redirectUri,
				client_id: clientId,
				code_verifier: codeVerifier,
			}),
		});

		if (!tokenResponse.ok) {
			const errorText = await tokenResponse.text();
			console.error("❌ Token exchange failed:", tokenResponse.status, errorText);
			process.exit(1);
		}

		const tokenData = await tokenResponse.json() as {
			access_token: string;
			refresh_token?: string;
			token_type: string;
			expires_in: number;
			scope?: string;
		};

		// Calculate expiration
		const expiresAt = calculateExpiresAt(tokenData.expires_in);

		// Save tokens
		const tokenPath = getOAuthCredentialsPath("claude");
		const token = {
			access_token: tokenData.access_token,
			refresh_token: tokenData.refresh_token,
			token_type: tokenData.token_type,
			expires_at: expiresAt,
			scope: tokenData.scope,
		};

		// Ensure directory exists
		await fs.mkdir(path.dirname(tokenPath), { recursive: true });
		await fs.writeFile(tokenPath, JSON.stringify(token, null, 2), "utf-8");
		await fs.chmod(tokenPath, 0o600);

		console.log(`✅ Authentication successful!`);
		console.log(`   Token saved to: ${tokenPath}`);
		console.log(`   Expires at: ${new Date(expiresAt).toLocaleString()}`);

	} finally {
		server.close();
	}
}

// Export auth command
export const authCommand = new Command("auth")
	.description("Manage authentication for providers (API Keys and OAuth)");

// Key subcommand
authCommand
	.command("key <provider>")
	.description("Configure an API key for a provider")
	.action(async (provider: string) => {
		const envKey = PROVIDER_TO_ENV_MAP[provider];
		if (!envKey) {
			console.error(`❌ Unknown provider: ${provider}`);
			console.log(`   Supported providers: ${Object.keys(PROVIDER_TO_ENV_MAP).join(", ")}`);
			process.exit(1);
		}

		const apiKey = await password({
			message: `Enter API key for ${provider}:`,
			mask: "*"
		});

		if (!apiKey) {
			console.error("❌ No API key provided.");
			process.exit(1);
		}

		console.log(`[Auth] Validating key...`);
		try {
			const baseUrl = provider === "anthropic" || provider === "claude-ai" 
				? "https://api.anthropic.com/v1/models" 
				: "https://api.openai.com/v1/models";
			const headers: Record<string, string> = {
				"Authorization": `Bearer ${apiKey}`,
			};
			if (provider === "anthropic" || provider === "claude-ai") {
				headers["x-api-key"] = apiKey;
				headers["anthropic-version"] = "2023-06-01";
			}
			const response = await fetch(baseUrl, { headers, method: "GET" }).catch(() => ({ ok: false }));
			if (!response.ok) {
				console.warn(`⚠️  Warning: API key validation failed or timed out. Saving anyway.`);
			} else {
				console.log(`✅ API key validation successful.`);
			}
		} catch (e) {
			console.warn(`⚠️  Warning: API key validation failed or timed out. Saving anyway.`);
		}

		const xdgConfig = process.env.XDG_CONFIG_HOME;
		const credPath = xdgConfig
			? path.join(xdgConfig, "apohara", "credentials.json")
			: path.join(os.homedir(), ".apohara", "credentials.json");

		let credentials: Record<string, any> = {};
		try {
			const content = await fs.readFile(credPath, "utf-8");
			credentials = JSON.parse(content);
		} catch {
			// Ignore if file doesn't exist
		}

		credentials[envKey] = apiKey;

		await fs.mkdir(path.dirname(credPath), { recursive: true });
		await fs.writeFile(credPath, JSON.stringify(credentials, null, 2), "utf-8");
		await fs.chmod(credPath, 0o600);

		console.log(`✅ API key saved for ${provider} in ~/.apohara/credentials.json`);
	});

// Login subcommand
authCommand
	.command("login <provider>")
	.description("Login to an OAuth provider (e.g., claude, gemini)")
	.action(async (provider: string) => {
		console.log(`[Auth] Login command invoked for provider: ${provider}`);

		if (provider === "claude") {
			try {
				await loginClaude();
			} catch (error: any) {
				console.error(error.message);
				process.exit(1);
			}
		} else if (provider === "gemini") {
			const { loginWithGoogleOAuth, saveApoharaToken, loadClientId } = await import("../lib/oauth/gemini.js");
			console.log("[Auth] Starting Gemini OAuth login...");
			
			const credPath = process.env.XDG_CONFIG_HOME
				? path.join(process.env.XDG_CONFIG_HOME, "apohara", "credentials.json")
				: path.join(os.homedir(), ".apohara", "credentials.json");
			
			let clientId = "";
			try {
				const content = await fs.readFile(credPath, "utf-8");
				const parsed = JSON.parse(content);
				clientId = parsed["gemini-oauth-client-id"] || "";
			} catch {
				// No credentials file
			}
			
			if (!clientId) {
				console.error("❌ No client ID configured. Please add 'gemini-oauth-client-id' to credentials.json");
				console.log("   Run: apohara config --set gemini-oauth-client-id=YOUR_CLIENT_ID");
				process.exit(1);
			}

			try {
				const token = await loginWithGoogleOAuth(clientId);
				await saveApoharaToken(token);
				console.log(`✅ Gemini authentication successful!`);
				console.log(`   Expires at: ${new Date(token.expires_at).toLocaleString()}`);
			} catch (error: any) {
				console.error(error.message);
				process.exit(1);
			}
		} else {
			console.error(`❌ Unknown provider: ${provider}`);
			console.log("   Supported providers: claude, gemini");
			process.exit(1);
		}
	});

// Status subcommand
authCommand
	.command("status")
	.description("Show authentication status across all providers")
	.option("--json", "Output raw JSON")
	.action(async (options: { json?: boolean }) => {
		const providersStatus: Record<string, any> = {};
		const xdgConfig = process.env.XDG_CONFIG_HOME;
		const credPath = xdgConfig
			? path.join(xdgConfig, "apohara", "credentials.json")
			: path.join(os.homedir(), ".apohara", "credentials.json");

		let credentials: Record<string, any> = {};
		try {
			const content = await fs.readFile(credPath, "utf-8");
			credentials = JSON.parse(content);
		} catch {
			// Ignored
		}

		for (const [provider, envKey] of Object.entries(PROVIDER_TO_ENV_MAP)) {
			if (credentials[envKey] || credentials[provider]) {
				providersStatus[provider] = { type: "API Key", status: "✅ Configured" };
			}
		}

		const oauthProviders = ["claude", "gemini"];
		for (const provider of oauthProviders) {
			const tokenPath = getOAuthCredentialsPath(provider);
			try {
				const content = await fs.readFile(tokenPath, "utf-8");
				const token = JSON.parse(content);
				const expiresAt = new Date(token.expires_at);
				const isExpired = expiresAt < new Date();
				providersStatus[provider] = { type: "OAuth", status: isExpired ? "❌ Expired" : "✅ Valid", expires_at: token.expires_at };
			} catch {
				// Don't add to list if no file exists and we didn't add it as an API key either
				if (!providersStatus[provider]) {
					providersStatus[provider] = { type: "OAuth", status: "❌ Not authenticated" };
				}
			}
		}

		if (options.json) {
			console.log(JSON.stringify(providersStatus, null, 2));
		} else {
			console.log(`\n📋 Authentication Status:`);
			console.log(`-------------------------------------------------`);
			console.log(`Provider`.padEnd(20) + `Type`.padEnd(15) + `Status`);
			console.log(`-------------------------------------------------`);
			for (const [provider, info] of Object.entries(providersStatus)) {
				console.log(`${provider.padEnd(20)}${info.type.padEnd(15)}${info.status}`);
			}
			console.log(`-------------------------------------------------\n`);
		}
	});

// Refresh subcommand
authCommand
	.command("refresh <provider>")
	.description("Refresh OAuth token for a provider")
	.action(async (provider: string) => {
		if (provider === "claude" || provider === "gemini") {
			console.log(`[Auth] Attempting to refresh OAuth token for ${provider}...`);
			const { resolveOAuthToken } = await import("../core/credentials.js");
			const providerMap: Record<string, string> = { "claude": "claude-ai", "gemini": "gemini-ai" };
			const actualProvider = providerMap[provider] || provider;
			const token = await resolveOAuthToken(actualProvider);
			if (token) {
				console.log(`✅ Successfully refreshed token for ${provider}.`);
			} else {
				console.error(`❌ Failed to refresh token for ${provider}. Are you logged in?`);
			}
		} else if (PROVIDER_TO_ENV_MAP[provider]) {
			console.log(`[Auth] ${provider} uses an API key. API keys do not need manual refresh.`);
		} else {
			console.error(`❌ Unknown provider: ${provider}`);
			process.exit(1);
		}
	});

// Revoke subcommand
authCommand
	.command("revoke <provider>")
	.description("Revoke authentication for a provider locally")
	.action(async (provider: string) => {
		let removed = false;

		const tokenPath = getOAuthCredentialsPath(provider);
		try {
			await fs.unlink(tokenPath);
			console.log(`[Auth] Deleted OAuth token for ${provider}`);
			removed = true;
		} catch {
			// Ignored
		}

		const xdgConfig = process.env.XDG_CONFIG_HOME;
		const credPath = xdgConfig
			? path.join(xdgConfig, "apohara", "credentials.json")
			: path.join(os.homedir(), ".apohara", "credentials.json");

		try {
			const content = await fs.readFile(credPath, "utf-8");
			const credentials = JSON.parse(content);
			let changed = false;

			if (credentials[provider]) {
				delete credentials[provider];
				changed = true;
			}
			
			const envKey = PROVIDER_TO_ENV_MAP[provider];
			if (envKey && credentials[envKey]) {
				delete credentials[envKey];
				changed = true;
			}

			if (changed) {
				await fs.writeFile(credPath, JSON.stringify(credentials, null, 2), "utf-8");
				console.log(`[Auth] Removed API key for ${provider} from credentials.json`);
				removed = true;
			}
		} catch {
			// Ignored
		}

		if (removed) {
			console.log(`✅ Successfully revoked access for ${provider} locally.`);
		} else {
			console.log(`[Auth] No local credentials found for ${provider}.`);
		}
	});