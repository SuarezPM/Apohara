import { describe, it, expect } from 'vitest';
import { exec as execSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';

const execAsync = promisify(execSync);

describe('Build Distribution', () => {
	const distPath = path.resolve(process.cwd(), 'dist/cli.js');

	it('should produce dist/cli.js', () => {
		expect(fs.existsSync(distPath), `dist/cli.js should exist at ${distPath}`).toBe(true);
	});

	it('should run under node and show help', async () => {
		const { stdout } = await execAsync('node dist/cli.js --help');
		expect(stdout).toContain('Apohara CLI');
		expect(stdout).toContain('config');
		expect(stdout).toContain('auto');
		expect(stdout).toContain('dashboard');
	});

	it('should show correct version under node', async () => {
		const { stdout } = await execAsync('node dist/cli.js --version');
		expect(stdout).toContain('0.1.0');
	});
});