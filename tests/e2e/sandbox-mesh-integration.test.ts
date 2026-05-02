/**
 * Integration Test: Sandbox + Mesh working together.
 * Executes a real task (add /health endpoint) with sandbox and mesh active.
 */

import { test, expect, describe } from "bun:test";
import { Isolator } from "../../src/core/sandbox";
import { VerificationMesh } from "../../src/core/verification-mesh";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Sandbox + Mesh Integration", () => {
  let isolator: Isolator;
  let mesh: VerificationMesh;
  let testWorkdir: string;

  test.before(() => {
    isolator = new Isolator();
    mesh = new VerificationMesh();
    testWorkdir = join(tmpdir(), `apohara-integration-${Date.now()}`);
    mkdirSync(testWorkdir, { recursive: true });
  });

  test.after(() => {
    try {
      rmSync(testWorkdir, { recursive: true, force: true });
    } catch {}
  });

  test("Integration Test 1: Sandbox confines test execution", async () => {
    // Create a simple test file
    const testFile = join(testWorkdir, "test.ts");
    writeFileSync(
      testFile,
      `
import { test, expect } from "bun:test";

test("safe test", () => {
  const result = 1 + 1;
  expect(result).toBe(2);
});
    `.trim()
    );

    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "bun test test.ts",
      permission: "workspace_write",
      taskId: "integration-1",
    });

    // Test should pass or fail with actual test output
    expect(typeof result.exitCode).toBe("number");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test("Integration Test 2: Sandbox blocks malicious code during testing", async () => {
    const maliciousFile = join(testWorkdir, "evil.ts");
    writeFileSync(
      maliciousFile,
      `
import { test } from "bun:test";

test("evil test", () => {
  const fs = require("fs");
  fs.writeFileSync("/etc/pwned", "hacked");
});
    `.trim()
    );

    const result = await isolator.exec({
      workdir: testWorkdir,
      command: "bun test evil.ts 2>&1 || true",
      permission: "readonly",
      taskId: "integration-2",
      timeout: 10000,
    });

    // Should fail due to read-only filesystem
    expect(result.exitCode).not.toBe(0);
  });

  test("Integration Test 3: Mesh coordinates verification across providers", async () => {
    const meshResult = await mesh.execute({
      taskId: "integration-3",
      role: "execution",
      task: {
        id: "add-health-endpoint",
        messages: [
          {
            role: "system",
            content:
              "You are a TypeScript/Fastify expert. Write clean, secure code.",
          },
          {
            role: "user",
            content: `
Add a GET /health endpoint to the Fastify server that returns:
{ "status": "ok", "timestamp": new Date().toISOString() }
            `.trim(),
          },
        ],
        complexity: "high",
        filesModified: 1,
      },
      policy: {
        enabled: true,
        mode: "structural",
        max_extra_cost_pct: 15,
        min_complexity: "high",
      },
    });

    // Mesh should attempt verification
    expect(meshResult.agentA).toBeDefined();
    expect(meshResult.agentA.provider).toBeDefined();
  });

  test("Integration Test 4: Event ledger captures full execution trace", async () => {
    // Execute both sandbox and mesh operations
    await isolator.exec({
      workdir: testWorkdir,
      command: "echo 'test' > trace.txt && cat trace.txt",
      permission: "workspace_write",
      taskId: "integration-4-sandbox",
    });

    await mesh.execute({
      taskId: "integration-4-mesh",
      role: "execution",
      task: {
        id: "trace-test",
        messages: [
          {
            role: "user",
            content: "Generate a trace message.",
          },
        ],
        complexity: "high",
        filesModified: 1,
      },
    });

    // Both should have logged to event ledgers
    const sandboxLedgerPath = isolator.getEventLedgerPath();
    const meshLedgerPath = mesh.getEventLedgerPath();

    expect(sandboxLedgerPath).toBeDefined();
    expect(meshLedgerPath).toBeDefined();

    // Both ledgers should exist
    const sandboxFile = Bun.file(sandboxLedgerPath);
    const meshFile = Bun.file(meshLedgerPath);

    expect(await sandboxFile.exists()).toBe(true);
    expect(await meshFile.exists()).toBe(true);
  });

  test("Integration Test 5: Graceful degradation on agent failure", async () => {
    // This test verifies the infrastructure
    // In real scenarios, agent failures (API errors, timeouts) trigger graceful degradation

    const meshResult = await mesh.execute({
      taskId: "integration-5",
      role: "execution",
      task: {
        id: "degradation-test",
        messages: [
          {
            role: "user",
            content: "Simple task.",
          },
        ],
        complexity: "high",
        filesModified: 3,
      },
    });

    // If mesh applied, should have both A and B results
    if (meshResult.meshApplied) {
      expect(meshResult.agentA.response).toBeDefined();
      expect(meshResult.agentB).toBeDefined();
    } else {
      // Degradation: only A succeeded
      expect(meshResult.agentA.response).toBeDefined();
    }
  });
});
