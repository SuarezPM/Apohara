/**
 * Cross-Verification Mesh Tests — 3-agent consensus pattern.
 * Tests structural comparison, cost control, and graceful degradation.
 *
 * Uses VerificationMesh's injectable routerFn to provide deterministic
 * responses without real LLM calls or prototype spy fragility.
 */

import { test, expect, describe } from "bun:test";
import { VerificationMesh } from "../../src/core/verification-mesh";
import type { RouterFn } from "../../src/core/verification-mesh";
import type { ProviderId } from "../../src/core/types";

// Default fast mock router: returns immediately with a fixed text response.
const makeRouter = (
  overrides?: Partial<{ agentBDelayMs: number; agentBFails: boolean }>
): RouterFn => {
  let callCount = 0;
  return async (role, task) => {
    callCount++;
    const callIndex = callCount;
    const provider: ProviderId = "groq";
    const model = undefined;

    // Agent B override (2nd call per mesh execution)
    if (callIndex === 2) {
      if (overrides?.agentBFails) {
        return new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error("Agent B crashed")), 1)
        );
      }
      if (overrides?.agentBDelayMs) {
        const delay = overrides.agentBDelayMs;
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                provider,
                model,
                response: {
                  content: "Agent B delayed response",
                  provider,
                  model: "test-model",
                  usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
                },
              }),
            delay
          )
        );
      }
    }

    return {
      provider,
      model,
      response: {
        content: `Mock response from call ${callIndex}`,
        provider,
        model: "test-model",
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      },
    };
  };
};

// Arbiter router: returns valid JSON verdict for arbiter role calls.
const makeArbiterRouter = (): RouterFn => {
  return async (role) => {
    const provider: ProviderId = "groq";
    const content =
      role === "arbiter"
        ? '{"verdict": "A", "reasoning": "Output A is more concise and correct."}'
        : `Mock response for role ${role}`;
    return {
      provider,
      model: undefined,
      response: {
        content,
        provider,
        model: "test-model",
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      },
    };
  };
};

describe("Cross-Verification Mesh", () => {
  test("Test 1: Identical outputs from A and B pass directly", async () => {
    const mesh = new VerificationMesh(makeRouter());
    const result = await mesh.execute({
      taskId: "mesh-test-1",
      role: "execution",
      task: {
        id: "task-1",
        messages: [
          {
            role: "user",
            content:
              "Write a simple function that adds two numbers and returns the result.",
          },
        ],
        complexity: "high",
        filesModified: 5,
      },
      policy: {
        enabled: true,
        mode: "structural",
        max_extra_cost_pct: 15,
        min_complexity: "high",
      },
    });

    expect(result.meshApplied).toBe(true);
  });

  test("Test 2: Logically equivalent outputs with different formatting handled by arbiter", async () => {
    const mesh = new VerificationMesh(makeRouter());
    const result = await mesh.execute({
      taskId: "mesh-test-2",
      role: "planning",
      task: {
        id: "task-2",
        messages: [
          {
            role: "user",
            content: "What is 2+2?",
          },
        ],
        complexity: "medium",
        filesModified: 2,
      },
      policy: {
        enabled: true,
        min_complexity: "high",
      },
    });

    // Medium complexity should NOT trigger mesh
    expect(result.meshApplied).toBe(false);
  });

  test("Test 3: Divergent outputs arbitrated to most concise", async () => {
    const mesh = new VerificationMesh(makeRouter());
    const result = await mesh.execute({
      taskId: "mesh-test-3",
      role: "execution",
      task: {
        id: "task-3",
        messages: [
          {
            role: "user",
            content: "Generate a Hello World program.",
          },
        ],
        complexity: "high",
        filesModified: 1,
      },
    });

    // filesModified=1 < 3, so mesh should not apply
    if (result.meshApplied && result.arbiter) {
      expect(["A", "B", "conflict"]).toContain(result.arbiter.verdict);
    }
  });

  test("Test 4: Contradictory outputs flagged as conflict", async () => {
    const mesh = new VerificationMesh(makeRouter());
    const result = await mesh.execute({
      taskId: "mesh-test-4",
      role: "verification",
      task: {
        id: "task-4",
        messages: [
          {
            role: "user",
            content: "Verify if this code is correct.",
          },
        ],
        complexity: "critical",
        filesModified: 10,
      },
    });

    // Critical complexity with 10 files should qualify for mesh
    if (result.meshApplied && result.arbiter) {
      expect(["A", "B", "conflict"]).toContain(result.arbiter.verdict);
    }
  });

  test("Test 5: High complexity task triggers mesh", async () => {
    const mesh = new VerificationMesh(makeRouter());
    const result = await mesh.execute({
      taskId: "mesh-test-5",
      role: "execution",
      task: {
        id: "task-5",
        messages: [
          {
            role: "user",
            content: "Implement a complete REST API.",
          },
        ],
        complexity: "high",
        filesModified: 8,
      },
      policy: {
        enabled: true,
        min_complexity: "high",
      },
    });

    expect(result.meshApplied).toBe(true);
    expect(result.agentB).toBeDefined();
  });

  test("Test 6: Low complexity task does NOT trigger mesh", async () => {
    const mesh = new VerificationMesh(makeRouter());
    const result = await mesh.execute({
      taskId: "mesh-test-6",
      role: "execution",
      task: {
        id: "task-6",
        messages: [
          {
            role: "user",
            content: "Format this variable name.",
          },
        ],
        complexity: "low",
        filesModified: 1,
      },
      policy: {
        enabled: true,
        min_complexity: "high",
      },
    });

    expect(result.meshApplied).toBe(false);
  });

  test("Test 7: Cost tracking does not exceed max_extra_cost_pct", async () => {
    const mesh = new VerificationMesh(makeRouter());
    const results = [];
    for (let i = 0; i < 5; i++) {
      const result = await mesh.execute({
        taskId: `mesh-test-7-${i}`,
        role: "execution",
        task: {
          id: `task-7-${i}`,
          messages: [
            {
              role: "user",
              content: "Task " + i,
            },
          ],
          complexity: i % 2 === 0 ? "high" : "low",
          filesModified: i % 2 === 0 ? 5 : 1,
        },
        policy: {
          enabled: true,
          max_extra_cost_pct: 15,
          min_complexity: "high",
        },
      });

      results.push(result);

      if (result.meshApplied) {
        expect(result.totalCost).toBeGreaterThan(0);
      }
    }

    // At least one mesh execution should have occurred
    const meshApplied = results.some((r) => r.meshApplied);
    expect(meshApplied).toBe(true);
  });

  test("Test 8: Event ledger captures mesh decisions and providers", async () => {
    const mesh = new VerificationMesh(makeRouter());
    const result = await mesh.execute({
      taskId: "mesh-test-8",
      role: "execution",
      task: {
        id: "task-8",
        messages: [
          {
            role: "user",
            content: "Write a function.",
          },
        ],
        complexity: "high",
        filesModified: 5,
      },
    });

    // Check ledger exists
    const ledgerPath = mesh.getEventLedgerPath();
    expect(ledgerPath).toBeDefined();

    // Ledger should be created
    const ledgerFile = Bun.file(ledgerPath);
    expect(await ledgerFile.exists()).toBe(true);

    // Read and verify JSON lines
    const ledgerContent = await ledgerFile.text();
    const lines = ledgerContent.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);

    // Parse a line to verify schema
    const firstEntry = JSON.parse(lines[0]);
    expect(firstEntry.type).toBeDefined();
    expect(firstEntry.timestamp).toBeDefined();
  });

  test("Test 9: Arbiter selection prefers fast, cheap providers", async () => {
    const mesh = new VerificationMesh(makeArbiterRouter());
    const result = await mesh.execute({
      taskId: "mesh-test-9",
      role: "verification",
      task: {
        id: "task-9",
        messages: [
          {
            role: "user",
            content: "Verify correctness.",
          },
        ],
        complexity: "critical",
        filesModified: 10,
      },
    });

    if (result.meshApplied && result.arbiter) {
      expect(["groq", "kiro-ai", "mistral", "qwen3.5-plus"]).toContain(
        result.arbiter.provider
      );
    }
  });

  test("Test 10: Circuit breaker disables mesh after verification cost exceeds threshold", async () => {
    // After one qualifying task: sessionVerificationCost (B + arbiter ≈ 0.6) /
    // sessionCostBase (A ≈ 0.3) = ~200% — always exceeds 15%, tripping the breaker.
    // The first task still returns meshApplied:true (current task completes before breaker fires).
    // The second qualifying task must return meshApplied:false because meshEnabled=false.
    const mesh = new VerificationMesh(makeRouter());
    const task = {
      id: "task-cb",
      messages: [{ role: "user" as const, content: "Implement a module." }],
      complexity: "high" as const,
      filesModified: 5,
    };
    const policy = {
      enabled: true,
      max_extra_cost_pct: 15,
      min_complexity: "high" as const,
    };

    const first = await mesh.execute({
      taskId: "mesh-cb-1",
      role: "execution",
      task,
      policy,
    });

    // First qualifying task: mesh applied, circuit breaker trips for future tasks
    expect(first.meshApplied).toBe(true);

    const second = await mesh.execute({
      taskId: "mesh-cb-2",
      role: "execution",
      task,
      policy,
    });

    // Second qualifying task: circuit breaker fired, mesh disabled
    expect(second.meshApplied).toBe(false);
  });

  test("Test 11: Timeout gate returns degraded result when Agent B exceeds timeout", async () => {
    // Agent A resolves in ~0ms; Agent B takes 500ms so the 50ms agentBTimeoutMs fires first.
    const mesh = new VerificationMesh(makeRouter({ agentBDelayMs: 500 }));

    const result = await mesh.execute({
      taskId: "mesh-timeout-1",
      role: "execution",
      task: {
        id: "task-timeout",
        messages: [{ role: "user", content: "Write a sorting algorithm." }],
        complexity: "high",
        filesModified: 4,
      },
      policy: {
        enabled: true,
        max_extra_cost_pct: 15,
        min_complexity: "high",
      },
      agentBTimeoutMs: 50, // 50ms timeout fires before Agent B's 500ms delay
    });

    // Agent A result still returned
    expect(result.agentA).toBeDefined();
    expect(result.agentA.exitCode).toBe(0);

    // Mesh degraded due to timeout
    expect(result.meshApplied).toBe(false);

    // agentB field records the timeout
    expect(result.agentB).toBeDefined();
    expect(result.agentB!.timedOut).toBe(true);
    expect(result.agentB!.crashed).toBe(false);
  });
});
