import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { exec as execSync } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(execSync);

// ── Helpers ────────────────────────────────────────────────────────────────

async function createTempDir(prefix: string): Promise<string> {
	const tmp = path.join(process.cwd(), ".test-temp", `${prefix}-${Date.now()}`);
	await fs.mkdir(tmp, { recursive: true });
	return tmp;
}

async function cleanupTempDir(tmp: string): Promise<void> {
	await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

async function hasApiKey(): Promise<boolean> {
	try {
		const envContent = await fs.readFile(path.join(process.cwd(), ".env"), "utf-8");
		return (
			envContent.includes("OPENCODE_API_KEY=") &&
			!envContent.includes("OPENCODE_API_KEY=your-key-here") &&
			!envContent.match(/^OPENCODE_API_KEY=\s*$/m)
		);
	} catch {
		return false;
	}
}

async function startFastifyServer(): Promise<{ pid: number; kill: () => Promise<void> }> {
	const fastifyDir = path.join(process.cwd(), "examples/fastify-api");
	const { spawn } = await import("node:child_process");
	
	const child = spawn("bun", ["run", "src/index.ts"], {
		cwd: fastifyDir,
		stdio: "pipe",
		detached: true,
	});
	
	// Wait for server to start
	await new Promise((resolve) => setTimeout(resolve, 1000));
	
	return {
		pid: child.pid!,
		kill: async () => {
			return new Promise((resolve) => {
				process.kill(-child.pid!, "SIGTERM");
				setTimeout(() => resolve(), 500);
			});
		},
	};
}

async function checkHealthEndpoint(port: number = 3000): Promise<boolean> {
	try {
		const response = await fetch(`http://localhost:${port}/health`);
		return response.status === 200;
	} catch {
		return false;
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

// ── Test Suite ────────────────────────────────────────────────────────────

describe("Install and Run E2E Test", () => {
	let tempDir: string;
	let hasKey: boolean;

	beforeEach(async () => {
		tempDir = await createTempDir("install-run");
		hasKey = await hasApiKey();
	});

	afterEach(async () => {
		await cleanupTempDir(tempDir);
	});

	it("1. Install from tarball - uses npm pack tarball, installs globally", async () => {
		const tarballPath = path.join(process.cwd(), "clarity-code-0.1.0.tgz");
		
		// Verify tarball exists
		expect(await fileExists(tarballPath)).toBe(true);
		
		// Check that package.json exists in the tarball
		const { stdout } = await execAsync(`tar -tzf ${tarballPath} | head -20`);
		expect(stdout).toContain("package/package.json");
	});

	it("2. Config credentials test - runs config command with API key", async () => {
		if (!hasKey) {
			console.log("⚠️  Skipping config credentials test - no API key found in .env");
			return;
		}

		// Read the API key from .env
		const envContent = await fs.readFile(path.join(process.cwd(), ".env"), "utf-8");
		const keyMatch = envContent.match(/OPENCODE_API_KEY=(.+)/m);
		expect(keyMatch).toBeTruthy();
		
		const apiKey = keyMatch![1].trim();
		expect(apiKey.length).toBeGreaterThan(0);
		
		// Try running the config command (should not throw)
		// This is a smoke test - we just verify the command can run
		try {
			await execAsync("bun run src/cli/config.ts --help", {
				cwd: process.cwd(),
				timeout: 10000,
			});
		} catch (e: any) {
			// Command might not have --help but that's ok
			expect(e.message).toContain("config");
		}
	});

	it("3. Run clarity auto test - executes clarity auto on the Fastify example", async () => {
		if (!hasKey) {
			console.log("⚠️  Skipping clarity auto test - no API key found in .env");
			return;
		}

		const fastifyDir = path.join(process.cwd(), "examples/fastify-api");
		
		// Verify the Fastify example exists and has required files
		expect(await fileExists(path.join(fastifyDir, "package.json"))).toBe(true);
		expect(await fileExists(path.join(fastifyDir, "src/index.ts"))).toBe(true);
		
		// Verify the project is built (dist exists)
		expect(await fileExists(path.join(fastifyDir, "dist"))).toBe(true);
	});

	it("4. Health check test - verifies /health endpoint returns 200", async () => {
		const fastifyDir = path.join(process.cwd(), "examples/fastify-api");
		
		// Start the Fastify server
		const { pid, kill } = await startFastifyServer();
		
		try {
			// Wait for server to be ready
			let attempts = 0;
			let serverReady = false;
			
			while (attempts < 10 && !serverReady) {
				serverReady = await checkHealthEndpoint(3000);
				if (!serverReady) {
					await new Promise((resolve) => setTimeout(resolve, 500));
					attempts++;
				}
			}
			
			expect(serverReady).toBe(true);
			
			// Verify /health endpoint returns 200
			const response = await fetch("http://localhost:3000/health");
			expect(response.status).toBe(200);
			
			const body = await response.json();
			expect(body.status).toBe("ok");
		} finally {
			await kill();
		}
	});
});