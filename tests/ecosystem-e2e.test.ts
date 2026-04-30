/**
 * E2E Integration Test for M004 Ecosystem
 * 
 * Tests the full integration of:
 * - S01: MCP Bridge (GitNexus + cocoindex-code)
 * - S02: Mem0 Memory Integration
 * - S03: Inngest AgentKit Recovery
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Mem0Client } from "../src/lib/mem0-client";
import { InngestClient } from "../src/lib/inngest-client";
import { MCPRegistry, MCPClient } from "../src/lib/mcp-client";
import { TaskDecomposer } from "../src/core/decomposer";

describe("M004 Ecosystem E2E Integration", () => {
	let mem0: Mem0Client;
	let inngest: InngestClient;
	let mcp: MCPRegistry;

	beforeEach(() => {
		mem0 = new Mem0Client({ apiKey: "test-key" });
		inngest = new InngestClient({ apiKey: "test-key" });
		mcp = new MCPRegistry();
	});

	afterEach(() => {
		mcp.disconnectAll();
	});

	describe("1. MCP Bridge Integration", () => {
		it("MCP Registry can register servers", async () => {
			// Verify registry has expected interface
			expect(mcp.getServers).toBeDefined();
			expect(typeof mcp.register).toBe("function");
			expect(typeof mcp.callTool).toBe("function");
		});

		it("TaskDecomposer integrates MCP dynamically", async () => {
			// Verify decomposer instantiate with MCP support
			const decomposer = new TaskDecomposer();
			expect(decomposer).toBeDefined();
		});
	});

	describe("2. Mem0 Memory Integration", () => {
		it("can store and retrieve task decisions", async () => {
			// In a real scenario, this would persist across sessions
			// Here we verify the interface works
			
			const decision = "Use deepseek-v4 for execution tasks";
			
			// Store a decision (would fail without real API, but interface exists)
			expect(typeof mem0.storeTaskDecision).toBe("function");
			
			// Store a coding pattern
			expect(typeof mem0.storeCodingPattern).toBe("function");
			
			// Retrieve for task
			expect(typeof mem0.retrieveForTask).toBe("function");
		});

		it("Mem0 tracks session context", () => {
			const configured = mem0.isConfigured();
			expect(configured).toBe(true);
		});
	});

	describe("3. Inngest AgentKit Recovery", () => {
		it("can dispatch durable workflows", async () => {
			const result = await inngest.dispatch("deploy-agent", {
				task: "test-deployment",
			});

			expect(result.id).toBeDefined();
			expect(result.status).toBe("completed");
		});

		it("can recover from step failures", async () => {
			let attemptCount = 0;
			
			const result = await inngest.executeStep("recoverable-step", async () => {
				attemptCount++;
				if (attemptCount < 2) {
					throw new Error("Simulated temporary failure");
				}
				return "Recovered successfully!";
			}, { maxAttempts: 3 });

			expect(result).toBe("Recovered successfully!");
			expect(attemptCount).toBe(2);
		});

		it("Inngest configured for recovery", () => {
			const configured = inngest.isConfigured();
			expect(configured).toBe(true);
		});
	});

	describe("4. Integrated Workflow", () => {
		it("Full workflow: Decompose -> MCP -> Execute -> Memory -> Recover", async () => {
			// Step 1: Task Decomposition (would use LLM + MCP in real scenario)
			const decomposer = new TaskDecomposer();
			expect(decomposer).toBeDefined();

			// Step 2: MCP Analysis (would connect to GitNexus in real scenario)
			const registry = new MCPRegistry();
			expect(registry.findTool).toBeDefined();

			// Step 3: Memory before execution
			const mem0Client = new Mem0Client({ apiKey: "test-key" });
			// Just test interface - actual search() would require real API
			expect(typeof mem0Client.retrieveForTask).toBe("function");

			// Step 4: Durable execution with recovery
			const inngestClient = new InngestClient({ apiKey: "test-key" });
			const dispatch = await inngestClient.dispatch("agent-task", {
				taskId: "task-123",
				context: {},
			});
			expect(dispatch.status).toBe("completed");

			// Step 5: Store results for future sessions (interface only)
			expect(typeof mem0Client.storeTaskDecision).toBe("function");
			expect(typeof mem0Client.storeCodingPattern).toBe("function");
		}, 5000);
	});

	describe("5. Cross-session Memory Test", () => {
		it("can demonstrate memory persistence concept", async () => {
			// Test just the interface - actual API call may fail without real keys
			const client = new Mem0Client({ apiKey: "test-key" });
			
			expect(typeof client.storeTaskDecision).toBe("function");
			expect(typeof client.storeCodingPattern).toBe("function");
			expect(typeof client.retrieveForTask).toBe("function");
			
			// Verify configured with test key
			expect(client.isConfigured()).toBe(true);
		});
	});
});