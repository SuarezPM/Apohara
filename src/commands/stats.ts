/**
 * `apohara stats` — print per-role provider rankings from CapabilityStats.
 *
 * M013.5 verify gate: "human-readable table". This command reads the
 * `.apohara/capability-stats.json` store, computes one Thompson-Sampling
 * draw per (provider, role), and prints a tier-1 ASCII table grouped by
 * task type.
 */

import { Command } from "commander";
import {
	CAPABILITY_MANIFEST,
	type TaskType,
} from "../core/capability-manifest.js";
import { CapabilityStats } from "../core/capability-stats.js";
import type { ProviderId } from "../core/types.js";

const TASK_TYPES: TaskType[] = [
	"research",
	"planning",
	"codegen",
	"debugging",
	"verification",
];

function padRight(s: string, width: number): string {
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}
function padLeft(s: string, width: number): string {
	return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function formatPct(n: number): string {
	return `${(n * 100).toFixed(1)}%`;
}

async function runStats(opts: {
	role?: string;
	json?: boolean;
	file?: string;
}): Promise<void> {
	const stats = new CapabilityStats(opts.file);
	const allEntries = await stats.all();
	const knownProviders: ProviderId[] = CAPABILITY_MANIFEST.map(
		(c) => c.provider,
	);
	const seenProviders = new Set(allEntries.map((e) => e.provider));
	const allProviders: ProviderId[] = [
		...new Set<ProviderId>([...knownProviders, ...seenProviders]),
	];

	const roles: TaskType[] = opts.role
		? [opts.role as TaskType]
		: TASK_TYPES;

	if (opts.json) {
		const result: Record<
			string,
			{ provider: ProviderId; score: number; rate: number; n: number }[]
		> = {};
		for (const role of roles) {
			const ranked = await stats.rank(allProviders, role);
			result[role] = await Promise.all(
				ranked.map(async (r) => {
					const c = await stats.get(r.provider, role);
					return {
						provider: r.provider,
						score: r.score,
						rate: r.rate,
						n: (c?.successes ?? 0) + (c?.failures ?? 0),
					};
				}),
			);
		}
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	for (const role of roles) {
		const ranked = await stats.rank(allProviders, role);
		console.log(`\n# ${role}`);
		console.log(
			padRight("rank", 5) +
				padRight("provider", 22) +
				padLeft("score", 8) +
				padLeft("succ_rate", 12) +
				padLeft("trials", 8),
		);
		console.log("-".repeat(55));
		let rank = 1;
		for (const r of ranked) {
			const c = await stats.get(r.provider, role);
			const n = (c?.successes ?? 0) + (c?.failures ?? 0);
			console.log(
				padRight(String(rank), 5) +
					padRight(r.provider, 22) +
					padLeft(r.score.toFixed(3), 8) +
					padLeft(formatPct(r.rate), 12) +
					padLeft(String(n), 8),
			);
			rank += 1;
		}
	}
	if (allEntries.length === 0) {
		console.log(
			"\nNo observations recorded yet — every score is sampled from the prior.",
		);
		console.log(
			"Counts populate once the router starts emitting `provider_outcome` " +
				"events (M013.3, in flight).",
		);
	}
}

export const statsCommand = new Command("stats")
	.description("Print per-role provider rankings via Thompson Sampling")
	.option(
		"-r, --role <role>",
		"limit to a single role (research|planning|codegen|debugging|verification)",
	)
	.option("--json", "emit JSON instead of an ASCII table")
	.option(
		"-f, --file <path>",
		"path to capability-stats.json (default: .apohara/capability-stats.json under cwd)",
	)
	.action(async (opts: { role?: string; json?: boolean; file?: string }) => {
		await runStats(opts);
	});
