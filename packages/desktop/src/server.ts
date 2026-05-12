/**
 * Bun.serve dev backend for Apohara desktop UI.
 *
 * Routes:
 *   GET  /                              — serves index.html + React SPA bundle
 *   POST /api/enhance                   — TODO M017.x: call decomposer prompt enhancer
 *   POST /api/run                       — TODO M017.x: kick off scheduler, return sessionId
 *   GET  /api/session/:id/events        — SSE tail of .events/run-<id>.jsonl
 *
 * Tauri loads localhost:7331 as devUrl in dev; bundles the build/ output for release.
 */

import index from "../index.html";
import { join } from "node:path";
import { existsSync } from "node:fs";

const PORT = Number(process.env.APOHARA_DESKTOP_PORT ?? 7331);
const REPO_ROOT = process.env.APOHARA_REPO_ROOT ?? process.cwd();

const server = Bun.serve({
	port: PORT,
	development: {
		hmr: true,
		console: true,
	},
	routes: {
		"/": index,

		"/api/enhance": {
			POST: async (req) => {
				const body = (await req.json()) as { prompt?: string };
				// TODO M017.x: wire to src/core/decomposer.ts prompt enhancement
				const enhanced = `${body.prompt ?? ""}\n\n(enhancement pending implementation)`;
				return Response.json({ enhanced });
			},
		},

		"/api/run": {
			POST: async (req) => {
				const _body = (await req.json()) as { prompt?: string };
				// TODO M017.x: spawn ParallelScheduler.run() and return sessionId
				const sessionId = `dev-${Date.now()}`;
				return Response.json({ sessionId });
			},
		},

		"/api/session/:id/events": (req) => {
			const id = req.params.id;
			const filePath = join(REPO_ROOT, ".events", `run-${id}.jsonl`);
			if (!existsSync(filePath)) {
				return new Response("ledger not found", { status: 404 });
			}
			// SSE tail. Bun supports ReadableStream + text/event-stream.
			const stream = new ReadableStream({
				async start(controller) {
					const file = Bun.file(filePath);
					const existing = await file.text();
					for (const line of existing.split("\n")) {
						if (!line.trim()) continue;
						controller.enqueue(`data: ${line}\n\n`);
					}
					// TODO M017.x: subscribe to fs.watch and stream new lines as they
					// arrive. For now just send historical contents.
					controller.close();
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
