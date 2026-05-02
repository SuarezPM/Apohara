/**
 * Auth command - Manage authentication for Apohara providers
 */

import { Command } from "commander";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

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
 * Show generic authentication status for a provider
 */
async function showStatus(provider: string): Promise<void> {
	const tokenPath = getOAuthCredentialsPath(provider);

	try {
		const content = await fs.readFile(tokenPath, "utf-8");
		const token = JSON.parse(content);

		const expiresAt = new Date(token.expires_at);
		const now = new Date();
		const isExpired = expiresAt < now;
		const expiresIn = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60); // minutes

		console.log(`\n📋 ${provider} Authentication Status:`);
		console.log(`   Token type: ${token.token_type}`);
		console.log(`   Expires at: ${expiresAt.toLocaleString()}`);
		console.log(`   Status: ${isExpired ? "❌ Expired" : "✅ Valid"}`);

		if (!isExpired && expiresIn < 60) {
			console.log(`   Expires in: ${expiresIn} minutes`);
		} else if (!isExpired) {
			const hours = Math.round(expiresIn / 60);
			console.log(`   Expires in: ${hours} hours`);
		}

		if (token.refresh_token) {
			console.log(`   Refresh token: ✅ Available`);
		} else {
			console.log(`   Refresh token: ❌ Not available`);
		}

		if (token.scope) {
			console.log(`   Scope: ${token.scope}`);
		}

		console.log("");

	} catch {
		console.log(`\n📋 ${provider} Authentication Status:`);
		console.log(`   Status: ❌ Not authenticated`);
		console.log(`   Run: apohara auth login ${provider}`);
		console.log("");
	}
}

// Export auth command
export const authCommand = new Command("auth")
	.description("Manage OAuth authentication for Claude.ai and other providers");

// Login subcommand
authCommand
	.command("login <provider>")
	.description("Login to an OAuth provider (e.g., gemini-cli, antigravity)")
	.action(async (provider: string) => {
		console.log(`[Auth] Login command invoked for provider: ${provider}`);

		if (provider === "claude") {
			console.error("\n❌ Claude OAuth was blocked by Anthropic (February 2026) for third-party tools per TOS compliance. GSD2 removed Anthropic OAuth entirely. 9Router uses its own backend server (not local proxy). For Apohara, use: apohara auth key anthropic with an API key from https://console.anthropic.com/\n");
			process.exit(1);
		} else if (provider === "gemini-cli") {
			const { loginWithGoogleOAuth, saveApoharaToken } = await import("../lib/oauth/gemini.js");
			
			console.log("[Auth] Starting Gemini CLI OAuth login...");
			
			const token = await loginWithGoogleOAuth();
			await saveApoharaToken(token);
			
			console.log(`✅ Gemini CLI authentication successful!`);
			console.log(`   Expires at: ${new Date(token.expires_at).toLocaleString()}`);
			process.exit(0);
		} else if (provider === "antigravity") {
			const { loginWithGoogleOAuth, saveApoharaToken } = await import("../lib/oauth/antigravity.js");
			
			console.log("[Auth] Starting Antigravity OAuth login...");
			
			const token = await loginWithGoogleOAuth();
			await saveApoharaToken(token);
			
			console.log(`✅ Antigravity authentication successful!`);
			console.log(`   Expires at: ${new Date(token.expires_at).toLocaleString()}`);
			process.exit(0);
		} else {
			console.error(`❌ Unknown provider: ${provider}`);
			console.log("   Supported providers: gemini-cli, antigravity");
			process.exit(1);
		}
	});

// Key subcommand
authCommand
	.command("key <provider> [key]")
	.description("Register API key for a provider")
	.action(async (provider: string, key?: string) => {
		if (!key) {
			const readline = require("readline");
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout
			});
			key = await new Promise<string>((resolve) => {
				rl.question(`Enter API key for ${provider}: `, (answer: string) => {
					rl.close();
					resolve(answer.trim());
				});
			});
		}
		
		if (!key) {
			console.error("❌ No key provided");
			process.exit(1);
		}
		
		const credPath = process.env.XDG_CONFIG_HOME
			? path.join(process.env.XDG_CONFIG_HOME, "apohara", "credentials.json")
			: path.join(os.homedir(), ".apohara", "credentials.json");
			
		let creds: Record<string, any> = {};
		try {
			const content = await fs.readFile(credPath, "utf-8");
			creds = JSON.parse(content);
		} catch {
			// File doesn't exist or is invalid
		}
		
		// Map provider to its expected key name
		let keyName = provider;
		if (!keyName.endsWith("_API_KEY")) {
			// Convert "groq" to "GROQ_API_KEY", "anthropic" to "ANTHROPIC_API_KEY"
			const base = provider.replace("-api", "").replace("-cli", "").toUpperCase().replace(/-/g, "_");
			keyName = `${base}_API_KEY`;
		}
		
		creds[keyName] = key;
		
		await fs.mkdir(path.dirname(credPath), { recursive: true });
		await fs.writeFile(credPath, JSON.stringify(creds, null, 2), "utf-8");
		await fs.chmod(credPath, 0o600);
		
		console.log(`✅ Registered API key for ${provider}`);
	});

// Free subcommand
authCommand
	.command("free <provider>")
	.description("Register free-tier for a provider")
	.action(async (provider: string) => {
		console.log(`[Auth] Register free-tier for ${provider}`);
	});

// Refresh subcommand
authCommand
	.command("refresh <provider>")
	.description("Force refresh OAuth tokens for a provider")
	.action(async (provider: string) => {
		console.log(`[Auth] Force refresh OAuth for ${provider}`);
	});

// Revoke subcommand
authCommand
	.command("revoke <provider>")
	.description("Delete credentials for a provider")
	.action(async (provider: string) => {
		console.log(`[Auth] Revoke credentials for ${provider}`);
	});

// Status subcommand
authCommand
	.command("status [provider]")
	.description("Show authentication status for a provider or list all providers")
	.action(async (provider?: string) => {
		if (!provider) {
			// Show table of all providers
			const { CAPABILITY_MANIFEST } = await import("../core/capability-manifest.js");
			console.log("\n📋 Authentication Status (All Providers):");
			console.log("--------------------------------------------------");
			console.log("Provider".padEnd(25) + "| Status");
			console.log("--------------------------------------------------");
			
			// Custom tracking for specific OAuth providers
			const knownOAuth: Record<string, string> = {};
			try {
				const geminiInfo = await (await import("../lib/oauth/gemini.js")).getGeminiTokenInfo();
				if (geminiInfo.present) knownOAuth["gemini-cli"] = geminiInfo.is_expired ? "❌ Expired" : "✅ Valid (OAuth)";
			} catch {}
			
			try {
				const antigravityInfo = await (await import("../lib/oauth/antigravity.js")).getAntigravityTokenInfo();
				if (antigravityInfo.present) knownOAuth["antigravity"] = antigravityInfo.is_expired ? "❌ Expired" : "✅ Valid (OAuth)";
			} catch {}

			for (const cap of CAPABILITY_MANIFEST) {
				const providerName = cap.provider;
				let displayStatus = "Unknown";
				
				if (providerName === "claude" || providerName === "anthropic") {
					displayStatus = "API Key Required";
				} else if (knownOAuth[providerName]) {
					displayStatus = knownOAuth[providerName];
				}

				console.log(providerName.padEnd(25) + "| " + displayStatus);
			}
			
			// Always show gemini-cli and antigravity if they aren't in capability manifest yet
			if (!CAPABILITY_MANIFEST.some(c => c.provider === "gemini-cli")) {
				console.log("gemini-cli".padEnd(25) + "| " + (knownOAuth["gemini-cli"] || "Unknown"));
			}
			if (!CAPABILITY_MANIFEST.some(c => c.provider === "antigravity")) {
				console.log("antigravity".padEnd(25) + "| " + (knownOAuth["antigravity"] || "Unknown"));
			}

			console.log("--------------------------------------------------");
			return;
		}

		const targetProvider = provider;
		
		if (targetProvider === "gemini-cli") {
			const { getGeminiTokenInfo } = await import("../lib/oauth/gemini.js");
			
			try {
				const info = await getGeminiTokenInfo();
				
				console.log("\n📋 Gemini CLI Authentication Status:");
				console.log(`   Source: ${info.source || "none"}`);
				
				if (info.present) {
					console.log(`   Token type: ${info.token_type}`);
					console.log(`   Expires at: ${info.expires_at}`);
					console.log(`   Status: ${info.is_expired ? "❌ Expired" : "✅ Valid"}`);
					console.log(`   Refresh token: ${info.has_refresh_token ? "✅ Available" : "❌ Not available"}`);
				} else {
					console.log(`   Status: ❌ Not authenticated`);
					console.log(`   Run: apohara auth login gemini-cli`);
				}
				console.log("");
			} catch (error) {
				console.error("[Auth] Failed to get Gemini CLI status:", error);
			}
			return;
		} else if (targetProvider === "antigravity") {
			const { getAntigravityTokenInfo } = await import("../lib/oauth/antigravity.js");
			
			try {
				const info = await getAntigravityTokenInfo();
				
				console.log("\n📋 Antigravity Authentication Status:");
				console.log(`   Source: ${info.source || "none"}`);
				
				if (info.present) {
					console.log(`   Token type: ${info.token_type}`);
					console.log(`   Expires at: ${info.expires_at}`);
					console.log(`   Status: ${info.is_expired ? "❌ Expired" : "✅ Valid"}`);
					console.log(`   Refresh token: ${info.has_refresh_token ? "✅ Available" : "❌ Not available"}`);
				} else {
					console.log(`   Status: ❌ Not authenticated`);
					console.log(`   Run: apohara auth login antigravity`);
				}
				console.log("");
			} catch (error) {
				console.error("[Auth] Failed to get Antigravity status:", error);
			}
			return;
		} else if (targetProvider === "claude") {
			console.error("\n❌ Claude OAuth was blocked by Anthropic (February 2026). Use API keys instead via 'apohara auth key anthropic'.\n");
			return;
		}
		
		await showStatus(targetProvider);
	});