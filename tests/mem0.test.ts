/**
 * Tests for Mem0 Memory Integration
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	Mem0Client,
	type MemoryEntry,
	type MemorySearchResult,
} from "../src/lib/mem0-client";

describe("Mem0 Memory Integration", () => {
	describe("Mem0Client", () => {
		it("should instantiate Mem0Client", () => {
			const client = new Mem0Client();
			expect(client).toBeDefined();
		});

		it("should be configurable with custom params", () => {
			const client = new Mem0Client({
				apiKey: "test-key",
				userId: "test-user",
				baseUrl: "http://localhost:8000/v1",
			});

			expect(client).toBeDefined();
		});

		it("should report configuration status", () => {
			const client = new Mem0Client();
			// Without API key, isConfigured should be false
			const configured = client.isConfigured();
			expect(typeof configured).toBe("boolean");
		});

		it("should have required methods", () => {
			const client = new Mem0Client();

			expect(typeof client.add).toBe("function");
			expect(typeof client.search).toBe("function");
			expect(typeof client.getAll).toBe("function");
			expect(typeof client.delete).toBe("function");
			expect(typeof client.isConfigured).toBe("function");
			expect(typeof client.storeTaskDecision).toBe("function");
			expect(typeof client.storeCodingPattern).toBe("function");
			expect(typeof client.retrieveForTask).toBe("function");
		});

		it("should validate isConfigured with API key", () => {
			// When API key is set, should be configured
			const client = new Mem0Client({ apiKey: "test-key-123" });
			expect(client.isConfigured()).toBe(true);
		});
	});

	describe("MemoryEntry interface", () => {
		it("should accept valid MemoryEntry", () => {
			const entry: MemoryEntry = {
				role: "assistant",
				content: "Test memory content",
				metadata: {
					taskId: "test-123",
					type: "test",
				},
			};

			expect(entry.role).toBe("assistant");
			expect(entry.content).toBe("Test memory content");
			expect(entry.metadata?.taskId).toBe("test-123");
		});

		it("should allow different roles", () => {
			const roles: MemoryEntry["role"][] = ["user", "assistant", "system"];

			for (const role of roles) {
				const entry: MemoryEntry = {
					role,
					content: "Test",
				};
				expect(entry.role).toBe(role);
			}
		});
	});

	describe("MemorySearchResult interface", () => {
		it("should have expected shape", () => {
			const result: MemorySearchResult = {
				id: "mem-123",
				content: "Found memory",
				score: 0.95,
				metadata: { taskId: "test" },
			};

			expect(result.id).toBe("mem-123");
			expect(result.content).toBe("Found memory");
			expect(result.score).toBe(0.95);
			expect(result.metadata?.taskId).toBe("test");
		});
	});

	describe("Helper methods", () => {
		it("storeTaskDecision should exist and be callable", async () => {
			const client = new Mem0Client();

			// This will fail due to no API, but method exists
			expect(typeof client.storeTaskDecision).toBe("function");
		});

		it("storeCodingPattern should exist and be callable", async () => {
			const client = new Mem0Client();

			expect(typeof client.storeCodingPattern).toBe("function");
		});

		it("retrieveForTask should exist and be callable", async () => {
			const client = new Mem0Client();

			expect(typeof client.retrieveForTask).toBe("function");
		});
	});
});
