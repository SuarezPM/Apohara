/**
 * Bun.serve dev backend for the Apohara desktop UI (M017.1 scaffold,
 * M017.2 endpoint implementation).
 *
 * Routes:
 *   GET  /                           — serves index.html + React SPA bundle
 *   POST /api/enhance                — rewrites a user prompt via the ProviderRouter
 *   POST /api/run                    — creates a new session ledger, returns sessionId
 *   GET  /api/session/:id/events     — SSE tail of .events/run-<id>.jsonl (replay + live)
 *
 * Tauri loads localhost:7331 as devUrl in dev; the build/ output ships in release.
 */

import { existsSync, watch as fsWatch } from "node:fs";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import index from "../index.html";
import { ProviderRouter } from "../../../src/providers/router";
import type { LLMMessage } from "../../../src/providers/router";

const PORT = Number(process.env.APOHARA_DESKTOP_PORT ?? 7331);
const REPO_ROOT = process.env.APOHARA_REPO_ROOT ?? process.cwd();
const EVENTS_DIR = join(REPO_ROOT, ".events");

// Single shared router for /api/enhance. The ProviderRouter holds long-lived
// state (cooldown timers, ContextForge client) so re-instantiating per request
// would defeat M015.2's connection reuse.
let sharedRouter: ProviderRouter | null = null;
function getRouter(): ProviderRouter {
	if (!sharedRouter) sharedRouter = new ProviderRouter();
	return sharedRouter;
}

/**
 * Read every new byte appended to `filePath` since `offset` and return
 * `{ lines, nextOffset }` where `lines` is the newline-split tail (last
 * partial chunk held back) and `nextOffset` advances by complete-line
 * bytes only. Used by the SSE handler to push only the delta on each
 * fs.watch event.
 */
async function readDelta(
	filePath: string,
	offset: number,
): Promise<{ lines: string[]; nextOffset: number }> {
	const st = await stat(filePath).catch(() => null);
	if (!st || st.size <= offset) return { lines: [], nextOffset: offset };

	const length = st.size - offset;
	const fh = await open(filePath, "r");
	try {
		const buf = Buffer.alloc(length);
		await fh.read(buf, 0, length, offset);
		const chunk = buf.toString("utf-8");
		// Hold back any trailing partial line so we don't emit half a JSON object.
		const lastNL = chunk.lastIndexOf("\n");
		if (lastNL === -1) return { lines: [], nextOffset: offset };
		const complete = chunk.slice(0, lastNL);
		const advance = Buffer.byteLength(complete, "utf-8") + 1; // +1 for '\n'
		const lines = complete.split("\n").filter((l) => l.trim().length > 0);
		return { lines, nextOffset: offset + advance };
	} finally {
		await fh.close();
	}
}

const server = Bun.serve({
	port: PORT,
	development: {
		hmr: true,
		console: true,
	},
	routes: {
		"/": index,

		// POST /api/enhance — rewrite a prompt for clarity using the
		// existing ProviderRouter (M017.2). Response shape stays
		// `{ enhanced: string, ... }` so React Objective pane consumes
		// the same JSON as the M017.1 stub.
		"/api/enhance": {
			POST: async (req) => {
				let prompt = "";
				try {
					const body = (await req.json()) as { prompt?: string };
					prompt = (body.prompt ?? "").trim();
				} catch {
					return new Response("invalid JSON body", { status: 400 });
				}
				if (!prompt) {
					return new Response("prompt is required", { status: 400 });
				}

				const messages: LLMMessage[] = [
					{
						role: "system",
						content:
							"You are a prompt-rewriting assistant for an autonomous coding agent. " +
							"Rewrite the user's request to be unambiguous, specific, and testable. " +
							"Keep it under 200 words. Output ONLY the rewritten prompt, no preamble.",
					},
					{ role: "user", content: prompt },
				];

				// Prefer the local Carnice GPU server (M015.1) for the rewrite —
				// it's free, fast, and always-on when the user has the sidecar
				// running. The override is read once at request time so users
				// without local GPU can set APOHARA_ENHANCE_PROVIDER to any
				// cloud provider configured with an API key.
				const provider = (process.env.APOHARA_ENHANCE_PROVIDER ??
					"carnice-9b-local") as Parameters<
					typeof getRouter
				> extends never[]
					? string
					: string;

				try {
					const result = await getRouter().completion({
						messages,
						agentId: "desktop-enhance",
						// biome-ignore lint/suspicious/noExplicitAny: ProviderId type is internal
						provider: provider as any,
					});
					return Response.json({
						enhanced: result.content,
						provider: result.provider,
						model: result.model,
						usage: result.usage,
					});
				} catch (err) {
					return Response.json(
						{
							enhanced: prompt,
							error: (err as Error).message,
							fallback: true,
						},
						{ status: 502 },
					);
				}
			},
		},

		// POST /api/run — minimal session-start hook (M017.2). The full
		// scheduler spawn lands in M017.3+ when the UI can drive it. For
		// now we create the session's ledger file + write a
		// `session_started` event so the SSE endpoint can tail something
		// the instant the client subscribes.
		"/api/run": {
			POST: async (req) => {
				let prompt = "";
				try {
					const body = (await req.json()) as { prompt?: string };
					prompt = (body.prompt ?? "").trim();
				} catch {
					return new Response("invalid JSON body", { status: 400 });
				}

				const sessionId = `desktop-${Date.now().toString(36)}-${Math.random()
					.toString(36)
					.slice(2, 8)}`;
				await mkdir(EVENTS_DIR, { recursive: true });
				const ledgerPath = join(EVENTS_DIR, `run-${sessionId}.jsonl`);
				const event = {
					id: crypto.randomUUID(),
					timestamp: new Date().toISOString(),
					type: "session_started",
					severity: "info",
					payload: { prompt, source: "desktop" },
				};
				await writeFile(ledgerPath, `${JSON.stringify(event)}\n`, "utf-8");
				return Response.json({ sessionId, ledger: ledgerPath });
			},
		},

		// GET /api/session/:id/events — SSE replay + live tail.
		// Replays the full ledger file once on connect, then streams
		// every appended line as fs.watch reports changes. Heartbeat
		// every 15 s so proxies don't drop the connection.
		"/api/session/:id/events": (req) => {
			const id = req.params.id;
			const filePath = join(EVENTS_DIR, `run-${id}.jsonl`);
			if (!existsSync(filePath)) {
				return new Response("ledger not found", { status: 404 });
			}

			const stream = new ReadableStream({
				async start(controller) {
					const encoder = new TextEncoder();
					let offset = 0;
					let closed = false;

					const send = (data: string) => {
						if (closed) return;
						try {
							controller.enqueue(encoder.encode(data));
						} catch {
							closed = true;
						}
					};

					// 1) Replay historical lines and prime the offset.
					const initial = await readDelta(filePath, 0);
					for (const line of initial.lines) {
						send(`data: ${line}\n\n`);
					}
					offset = initial.nextOffset;

					// 2) Watch the file for new appends.
					const watcher = fsWatch(filePath, async () => {
						const delta = await readDelta(filePath, offset).catch(() => ({
							lines: [],
							nextOffset: offset,
						}));
						for (const line of delta.lines) {
							send(`data: ${line}\n\n`);
						}
						offset = delta.nextOffset;
					});

					// 3) Heartbeat — SSE comment, ignored by clients, keeps the
					//    TCP/HTTP path alive through any intermediate proxy.
					const heartbeat = setInterval(() => {
						send(`: heartbeat ${Date.now()}\n\n`);
					}, 15_000);

					// 4) Clean up on client disconnect.
					req.signal.addEventListener("abort", () => {
						closed = true;
						clearInterval(heartbeat);
						watcher.close();
						try {
							controller.close();
						} catch {
							/* already closed */
						}
					});
				},
			});

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			});
		},
	},
});

console.log(`Apohara desktop dev server: http://localhost:${server.port}`);
console.log(`Events dir: ${EVENTS_DIR}`);
