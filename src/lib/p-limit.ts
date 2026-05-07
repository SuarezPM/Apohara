/**
 * A minimal, dependency-free implementation of p-limit for concurrency control.
 * Used as a fallback when external package installation is restricted.
 */
export default function pLimit(concurrency: number) {
	if (!((Number.isInteger(concurrency) || concurrency === Infinity) && concurrency > 0)) {
		throw new TypeError("Expected `concurrency` to be a number from 1 and up");
	}

	const queue: Array<() => Promise<void>> = [];
	let activeCount = 0;

	const next = () => {
		activeCount--;
		if (queue.length > 0) {
			const fn = queue.shift();
			if (fn) fn();
		}
	};

	const run = async (
		fn: (...args: any[]) => any,
		resolve: (value: any) => void,
		reject: (reason?: any) => void,
		args: any[],
	) => {
		activeCount++;

		try {
			const result = fn(...args);
			resolve(result);
			await result;
		} catch (error) {
			reject(error);
		}

		next();
	};

	const enqueue = (
		fn: (...args: any[]) => any,
		resolve: (value: any) => void,
		reject: (reason?: any) => void,
		args: any[],
	) => {
		queue.push(run.bind(null, fn, resolve, reject, args));

		(async () => {
			await Promise.resolve();
			if (activeCount < concurrency && queue.length > 0) {
				const nextFn = queue.shift();
				if (nextFn) nextFn();
			}
		})();
	};

	const generator = (fn: (...args: any[]) => any, ...args: any[]) =>
		new Promise((resolve, reject) => {
			enqueue(fn, resolve, reject, args);
		});

	Object.defineProperties(generator, {
		activeCount: {
			get: () => activeCount,
		},
		pendingCount: {
			get: () => queue.length,
		},
		clearQueue: {
			value: () => {
				queue.length = 0;
			},
		},
	});

	return generator as any;
}
