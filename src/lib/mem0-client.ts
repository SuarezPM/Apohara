/**
 * Mem0 Client - Persistent memory layer for AI agents
 * Provides semantic memory storage and retrieval across sessions
 * 
 * Docs: https://github.com/mem0ai/mem0
 */

import { config } from "../core/config";

export interface MemoryEntry {
	id?: string;
	role: "user" | "assistant" | "system";
	content: string;
	metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
	id: string;
	content: string;
	score: number;
	metadata?: Record<string, unknown>;
}

export interface Mem0Config {
	apiKey?: string;
	baseUrl?: string;
	userId?: string;
}

/**
 * Mem0 Client for persistent agent memory
 */
export class Mem0Client {
	private apiKey: string;
	private baseUrl: string;
	private userId: string;

	constructor(config?: Mem0Config) {
		this.apiKey = config?.apiKey || "";
		this.baseUrl = config?.baseUrl || "https://api.mem0.ai/v1";
		this.userId = config?.userId || "apohara";
	}

	/**
	 * Add memories to the memory store
	 */
	async add(messages: MemoryEntry | MemoryEntry[]): Promise<{ id: string }[]> {
		const messagesArr = Array.isArray(messages) ? messages : [messages];
		
		const response = await fetch(`${this.baseUrl}/memories`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Token ${this.apiKey}`,
			},
			body: JSON.stringify({
				messages: messagesArr,
				user_id: this.userId,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Mem0 add failed: ${response.status} ${error}`);
		}

		const data = await response.json();
		return data.results || [{ id: data.id }];
	}

	/**
	 * Search memories by query
	 */
	async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
		const response = await fetch(`${this.baseUrl}/search`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Token ${this.apiKey}`,
			},
			body: JSON.stringify({
				query,
				user_id: this.userId,
				limit,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Mem0 search failed: ${response.status} ${error}`);
		}

		const data = await response.json();
		return data.results || [];
	}

	/**
	 * Get all memories for a user
	 */
	async getAll(limit = 100): Promise<MemorySearchResult[]> {
		const response = await fetch(
			`${this.baseUrl}/memories?user_id=${this.userId}&limit=${limit}`,
			{
				method: "GET",
				headers: {
					"Authorization": `Token ${this.apiKey}`,
				},
			}
		);

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Mem0 getAll failed: ${response.status} ${error}`);
		}

		const data = await response.json();
		return data.results || [];
	}

	/**
	 * Delete a memory by ID
	 */
	async delete(memoryId: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/memories/${memoryId}`, {
			method: "DELETE",
			headers: {
				"Authorization": `Token ${this.apiKey}`,
			},
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Mem0 delete failed: ${response.status} ${error}`);
		}
	}

	/**
	 * Check if Mem0 is configured and available
	 */
	isConfigured(): boolean {
		// Simple flag - checks if API key is set (not empty)
		// This doesn't check actual connectivity, just configuration
		return !!this.apiKey || !!process.env.MEM0_API_KEY;
	}

	/**
	 * Store task decision in memory
	 */
	async storeTaskDecision(
		taskId: string,
		decision: string,
		taskType: string
	): Promise<void> {
		await this.add({
			role: "assistant",
			content: `Task ${taskId} (${taskType}): ${decision}`,
			metadata: {
				taskId,
				taskType,
				timestamp: new Date().toISOString(),
			},
		});
	}

	/**
	 * Store coding pattern learned from session
	 */
	async storeCodingPattern(
		pattern: string,
		context: string
	): Promise<void> {
		await this.add({
			role: "assistant",
			content: `Coding pattern: ${pattern} - used in: ${context}`,
			metadata: {
				type: "coding-pattern",
				timestamp: new Date().toISOString(),
			},
		});
	}

	/**
	 * Retrieve relevant memories for a task
	 */
	async retrieveForTask(taskDescription: string): Promise<MemorySearchResult[]> {
		// Search for memories relevant to current task
		return this.search(taskDescription, 10);
	}
}

// Global instance
export const mem0Client = new Mem0Client({
	apiKey: process.env.MEM0_API_KEY,
	userId: "apohara-agent",
});