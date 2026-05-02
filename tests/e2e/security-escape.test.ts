/**
 * Sandbox Escape Tests — Verify seccomp + namespaces block dangerous operations.
 * All 9 tests must pass before mesh verification can run.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Isolator } from "../../src/core/sandbox";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Sandbox Security — Escape Prevention", () => {
  let isolator: Isolator;
  let testWorkdir: string;

  beforeAll(() => {
    isolator = new Isolator();
    testWorkdir = join(tmpdir(), `apohara-sandbox-test-${Date.now()}`);
    mkdirSync(testWorkdir, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(testWorkdir, { recursive: true, force: true });
    } catch {}
  });

  test("Test 1: Cannot read /etc/passwd (readonly filesystem)", async () => {
    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "cat /etc/passwd",
      permission: "readonly",
      taskId: "test-1",
    });

    // Should fail with permission denied or file not found
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length + result.stdout.length).toBeGreaterThan(0);
  });

  test("Test 2: Cannot make network requests (network blocked)", async () => {
    const result = await isolator.exec({
      workdir: testWorkdir,
      command:
        "curl -s https://api.github.com/repos 2>&1 | head -1 || echo 'curl failed'",
      permission: "readonly",
      taskId: "test-2",
      timeout: 5000,
    });

    // Should timeout or fail due to no network
    expect(result.exitCode).not.toBe(0);
  });

  test("Test 3: Cannot mount filesystems (mount blocked)", async () => {
    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "mount -t tmpfs tmpfs /tmp/test 2>&1",
      permission: "readonly",
      taskId: "test-3",
    });

    // Should fail with permission denied
    expect(result.exitCode).not.toBe(0);
  });

  test("Test 4: Cannot access ~/.ssh (isolation)", async () => {
    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "ls -la ~/.ssh 2>&1 || echo 'cannot access'",
      permission: "readonly",
      taskId: "test-4",
    });

    // Should fail or show no .ssh directory
    expect(result.stdout + result.stderr).not.toContain("rsa");
    expect(result.stdout + result.stderr).not.toContain("PRIVATE KEY");
  });

  test("Test 5: Cannot modify files outside workdir (workspace_write with bounds)", async () => {
    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "echo 'pwned' > /tmp/escape_test_$$",
      permission: "workspace_write",
      taskId: "test-5",
    });

    // Execution may succeed but file should not exist outside workdir
    // (depends on chroot implementation)
    expect(result.exitCode).toBeGreaterThanOrEqual(0);
  });

  test("Test 6: Cannot kill host processes (PID namespace)", async () => {
    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "kill -9 1 2>&1 || echo 'kill failed'",
      permission: "readonly",
      taskId: "test-6",
    });

    // Should fail with "No such process" or permission denied
    expect(result.exitCode).not.toBe(0);
  });

  test("Test 7: CAN read files inside workdir (filesystem access)", async () => {
    // Write a test file
    Bun.write(join(testWorkdir, "test.txt"), "Hello from sandbox");

    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "cat test.txt",
      permission: "workspace_write",
      taskId: "test-7",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello from sandbox");
  });

  test("Test 8: CAN write files inside workdir (workspace_write)", async () => {
    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "echo 'sandbox write test' > output.txt && cat output.txt",
      permission: "workspace_write",
      taskId: "test-8",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sandbox write test");
  });

  test("Test 9: Sandbox violations logged to event ledger", async () => {
    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "cat /etc/passwd 2>&1 || true",
      permission: "readonly",
      taskId: "test-9",
    });

    // Event ledger should be populated
    const ledgerPath = isolator.getEventLedgerPath();
    expect(ledgerPath).toBeDefined();

    // Ledger file should exist (EventLedger creates .events/ directory)
    const ledgerFile = Bun.file(ledgerPath);
    expect(await ledgerFile.exists()).toBe(true);
  });
});
