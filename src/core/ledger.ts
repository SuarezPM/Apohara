import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EventLog, EventSeverity } from "./types";

export class EventLedger {
	private filePath: string;
	private initialized = false;

	constructor(runId?: string) {
		const id = runId || new Date().toISOString().replace(/[:.]/g, "-");
		this.filePath = join(process.cwd(), ".events", `run-${id}.jsonl`);
	}

	/**
	 * Initializes the ledger directory.
	 */
	private async init(): Promise<void> {
		if (this.initialized) return;
		await mkdir(dirname(this.filePath), { recursive: true });
		this.initialized = true;
	}

	/**
	 * Appends an event to the ledger synchronously-ish via promises.
	 */
	public async log(
		type: string,
		payload: Record<string, unknown>,
		severity: EventSeverity = "info",
		taskId?: string,
		metadata?: EventLog["metadata"],
	): Promise<void> {
		await this.init();

		const event: EventLog = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			type,
			severity,
			taskId,
			payload,
			metadata,
		};

		const line = `${JSON.stringify(event)}\n`;
		await appendFile(this.filePath, line, "utf-8");
	}

	/**
	 * Gets the path to the current ledger file.
	 */
	public getFilePath(): string {
		return this.filePath;
	}
}
