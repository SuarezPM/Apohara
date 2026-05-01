/**
 * Node.js spawn utility that mimics the Bun.spawn API.
 * This allows the codebase to run on Node.js while maintaining
 * the same interface as Bun's spawn.
 */
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

export interface SpawnOptions {
	stdout?: "pipe" | "inherit" | "ignore";
	stderr?: "pipe" | "inherit" | "ignore";
	stdio?: "pipe" | "inherit" | "ignore";
	cwd?: string;
	env?: Record<string, string>;
}

export interface SpawnResult {
	exited: Promise<number>;
	stdout: {
		read(): Promise<Buffer>;
		text(): Promise<string>;
	};
	stderr: {
		read(): Promise<Buffer>;
		text(): Promise<string>;
	};
}

/**
 * Mimics Bun.spawn API using Node.js child_process.
 * Usage: spawn(["git", "status"], { stdout: "pipe", stderr: "pipe" })
 */
export function spawn(
	args: string[],
	options: SpawnOptions = {},
): SpawnResult {
	const spawnOptions: {
		stdio: ("ignore" | "pipe" | "inherit")[];
		cwd?: string;
		env?: Record<string, string>;
	} = {
		stdio: [
			"ignore", // stdin
			options.stdout ?? "pipe",
			options.stderr ?? "pipe",
		],
	};

	if (options.cwd) {
		spawnOptions.cwd = options.cwd;
	}

	if (options.env) {
		spawnOptions.env = { ...process.env, ...options.env };
	}

	const child = nodeSpawn(args[0], args.slice(1), spawnOptions);

	// Create a promise that resolves when the process exits
	const exitedPromise = new Promise<number>((resolve, reject) => {
		child.on("exit", (code) => {
			resolve(code ?? 0);
		});
		child.on("error", (err) => {
			reject(err);
		});
	});

	return {
		exited: exitedPromise,
		stdout: {
			read: () => {
				return new Promise<Buffer>((resolve, reject) => {
					const chunks: Buffer[] = [];
					child.stdout?.on("data", (chunk) => {
						chunks.push(Buffer.from(chunk));
					});
					child.stdout?.on("end", () => {
						resolve(Buffer.concat(chunks));
					});
					child.stdout?.on("error", reject);
				});
			},
			text: async (): Promise<string> => {
				const buffer = await new Promise<Buffer>((resolve, reject) => {
					const chunks: Buffer[] = [];
					child.stdout?.on("data", (chunk) => {
						chunks.push(Buffer.from(chunk));
					});
					child.stdout?.on("end", () => {
						resolve(Buffer.concat(chunks));
					});
					child.stdout?.on("error", reject);
				});
				return buffer.toString("utf-8");
			},
		},
		stderr: {
			read: () => {
				return new Promise<Buffer>((resolve, reject) => {
					const chunks: Buffer[] = [];
					child.stderr?.on("data", (chunk) => {
						chunks.push(Buffer.from(chunk));
					});
					child.stderr?.on("end", () => {
						resolve(Buffer.concat(chunks));
					});
					child.stderr?.on("error", reject);
				});
			},
			text: async (): Promise<string> => {
				const buffer = await new Promise<Buffer>((resolve, reject) => {
					const chunks: Buffer[] = [];
					child.stderr?.on("data", (chunk) => {
						chunks.push(Buffer.from(chunk));
					});
					child.stderr?.on("end", () => {
						resolve(Buffer.concat(chunks));
					});
					child.stderr?.on("error", reject);
				});
				return buffer.toString("utf-8");
			},
		},
	};
}