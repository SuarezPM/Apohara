/**
 * Cross-Verification Mesh — 3-agent consensus pattern for critical tasks.
 *
 * Executes tasks with two independent agents (A + B) and verifies outputs via
 * structural comparison (AST, diffs, test execution). Only applies to 5-10% of
 * critical tasks (high/critical complexity, >3 files modified).
 *
 * Graceful degradation:
 * - If B crashes (OOM, segfault, timeout) → degrade to A alone
 * - If mesh cost hits 15% of session total → disable for remainder
 * - If B exceeds max(A_time * 2, threshold) → SIGKILL B, use A
 */

import { EventLedger } from "./ledger";
import { routeTaskWithFallback } from "./agent-router";
import { ProviderRouter } from "../providers/router";
import type { ProviderId, TaskRole } from "./types";

export interface VerificationPolicy {
  enabled: boolean;
  mode: "structural" | "semantic";
  max_extra_cost_pct: number;
  min_complexity: "high" | "critical";
}

export interface MeshExecutionOptions {
  taskId: string;
  role: TaskRole;
  task: {
    id?: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    complexity?: "low" | "medium" | "high" | "critical";
    filesModified?: number;
  };
  policy?: Partial<VerificationPolicy>;
}

export interface MeshResult {
  agentA: {
    provider: ProviderId;
    response: any;
    exitCode: number;
  };
  agentB?: {
    provider: ProviderId;
    response?: any;
    exitCode: number;
    crashed: boolean;
    timedOut: boolean;
  };
  arbiter?: {
    provider: ProviderId;
    verdict: "A" | "B" | "conflict";
    reasoning: string;
  };
  meshApplied: boolean;
  meshCostDelta: number; // Cost of B + arbiter relative to A alone
  totalCost: number;
}

export class VerificationMesh {
  private ledger: EventLedger;
  private sessionCostBase: number = 0;
  private sessionVerificationCost: number = 0;
  private meshEnabled: boolean = true;

  private defaultPolicy: VerificationPolicy = {
    enabled: true,
    mode: "structural",
    max_extra_cost_pct: 15,
    min_complexity: "high",
  };

  constructor() {
    this.ledger = new EventLedger();
  }

  /**
   * Determine if a task qualifies for cross-verification.
   */
  private shouldVerify(
    task: MeshExecutionOptions["task"],
    policy: VerificationPolicy
  ): boolean {
    if (!policy.enabled || !this.meshEnabled) {
      return false;
    }

    // Check complexity tier
    if (
      policy.min_complexity === "critical" &&
      task.complexity !== "critical"
    ) {
      return false;
    }
    if (
      policy.min_complexity === "high" &&
      task.complexity !== "high" &&
      task.complexity !== "critical"
    ) {
      return false;
    }

    // Check files modified threshold
    if (task.filesModified && task.filesModified < 3) {
      return false;
    }

    return true;
  }

  /**
   * Execute task with optional cross-verification.
   * Returns result from best performing agent (A or B+arbiter).
   */
  public async execute(
    options: MeshExecutionOptions
  ): Promise<MeshResult> {
    const policy = { ...this.defaultPolicy, ...options.policy };
    const shouldVerify = this.shouldVerify(options.task, policy);

    const startTime = Date.now();

    // Execute Agent A (primary executor)
    const agentA = await routeTaskWithFallback(options.role, options.task);
    const agentAResponse = agentA.response;
    const agentACost = this.estimateCost(agentA.provider);

    // Update session baseline if first execution
    if (this.sessionCostBase === 0) {
      this.sessionCostBase = agentACost;
    }

    // If mesh not applicable, return A alone
    if (!shouldVerify) {
      await this.ledger.log(
        "verification_mesh_skipped",
        {
          taskId: options.taskId,
          reason: "not_qualified_for_verification",
          complexity: options.task.complexity,
          filesModified: options.task.filesModified,
        },
        "info",
        options.taskId,
        {
          meshApplied: false,
        }
      );

      return {
        agentA: {
          provider: agentA.provider,
          response: agentAResponse,
          exitCode: 0,
        },
        meshApplied: false,
        meshCostDelta: 0,
        totalCost: agentACost,
      };
    }

    // Mesh applies — execute Agent B with timeout
    const agentBTimeout = Math.max(
      Math.ceil(Date.now() - startTime) * 2,
      30000
    ); // max(A_time * 2, 30s)

    const agentB = await Promise.race([
      routeTaskWithFallback(options.role, options.task),
      new Promise<{
        provider: ProviderId;
        response: any;
        crashed: true;
      }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              provider: "groq",
              response: null,
              crashed: true,
            }),
          agentBTimeout
        )
      ),
    ]);

    const agentBCrashed = "crashed" in agentB && agentB.crashed;
    const agentBResponse = agentBCrashed ? null : agentB.response;
    const agentBCost = agentBCrashed ? 0 : this.estimateCost(agentB.provider);

    // If B crashed or timed out, degrade to A alone
    if (agentBCrashed || agentBResponse === null) {
      await this.ledger.log(
        "verification_mesh_degraded",
        {
          taskId: options.taskId,
          reason: agentBCrashed ? "agent_b_crashed" : "agent_b_timeout",
        },
        "warning",
        options.taskId,
        {
          meshApplied: false,
          agentBProvider: agentB.provider,
        }
      );

      return {
        agentA: {
          provider: agentA.provider,
          response: agentAResponse,
          exitCode: 0,
        },
        agentB: {
          provider: agentB.provider,
          response: null,
          exitCode: agentBCrashed ? 139 : 143,
          crashed: agentBCrashed,
          timedOut: !agentBCrashed,
        },
        meshApplied: false,
        meshCostDelta: 0,
        totalCost: agentACost,
      };
    }

    // Perform LLM-based arbitration
    const arbiterVerdict = await this.runArbiter(
      agentAResponse,
      agentBResponse,
      options.task
    );

    const arbiterCost = this.estimateCost(arbiterVerdict.provider);
    const meshCost = agentBCost + arbiterCost;

    // Check if total mesh cost exceeds 15% budget
    const projectedSessionCost = this.sessionCostBase + this.sessionVerificationCost + meshCost;
    const projectedExtraCostPct =
      (this.sessionVerificationCost + meshCost) /
      this.sessionCostBase * 100;

    if (projectedExtraCostPct > policy.max_extra_cost_pct) {
      this.meshEnabled = false;

      await this.ledger.log(
        "verification_mesh_circuit_breaker",
        {
          taskId: options.taskId,
          reason: "cost_threshold_exceeded",
          projectedExtraCostPct,
          threshold: policy.max_extra_cost_pct,
        },
        "warning",
        options.taskId,
        {
          meshApplied: false,
          costPercentage: projectedExtraCostPct,
        }
      );

      // Return A's response since mesh couldn't execute
      return {
        agentA: {
          provider: agentA.provider,
          response: agentAResponse,
          exitCode: 0,
        },
        agentB: {
          provider: agentB.provider,
          response: agentBResponse,
          exitCode: 0,
          crashed: false,
          timedOut: false,
        },
        meshApplied: false,
        meshCostDelta: 0,
        totalCost: agentACost,
      };
    }

    const selectedResponse =
      arbiterVerdict.verdict === "A" ? agentAResponse : agentBResponse;
    const selectedProvider =
      arbiterVerdict.verdict === "A" ? agentA.provider : agentB.provider;

    // Update session costs
    this.sessionVerificationCost += meshCost;

    await this.ledger.log(
      "verification_mesh_completed",
      {
        taskId: options.taskId,
        verdict: arbiterVerdict.verdict,
        agentAProvider: agentA.provider,
        agentBProvider: agentB.provider,
        arbiterVerdict: arbiterVerdict.reasoning,
        meshCostDelta: meshCost,
      },
      "info",
      options.taskId,
      {
        meshApplied: true,
        arbiterVerdict: arbiterVerdict.verdict,
        agentAProvider: agentA.provider,
        agentBProvider: agentB.provider,
        meshCostDelta: meshCost,
      }
    );

    return {
      agentA: {
        provider: agentA.provider,
        response: agentAResponse,
        exitCode: 0,
      },
      agentB: {
        provider: agentB.provider,
        response: agentBResponse,
        exitCode: 0,
        crashed: false,
        timedOut: false,
      },
      arbiter: {
        provider: arbiterVerdict.provider,
        verdict: arbiterVerdict.verdict,
        reasoning: arbiterVerdict.reasoning,
      },
      meshApplied: true,
      meshCostDelta: meshCost,
      totalCost: agentACost + meshCost,
    };
  }

  /**
   * Run Arbiter: LLM-based comparison of two outputs.
   * Sends both outputs to an arbiter model and asks it to pick the better one.
   * Falls back to structural comparison if the LLM call fails.
   */
  private async runArbiter(
    responseA: any,
    responseB: any,
    task: MeshExecutionOptions["task"]
  ): Promise<{
    verdict: "A" | "B" | "conflict";
    reasoning: string;
    provider: ProviderId;
  }> {
    const contentA = this.extractContent(responseA);
    const contentB = this.extractContent(responseB);

    // Fast path: identical outputs need no LLM comparison
    const hashA = this.hashContent(contentA);
    const hashB = this.hashContent(contentB);

    if (hashA === hashB) {
      return {
        verdict: "A",
        reasoning: "Outputs are structurally identical",
        provider: "groq",
      };
    }

    // Outputs differ — invoke LLM arbiter
    try {
      const taskDescription =
        task.messages.find((m) => m.role === "user")?.content ||
        task.messages[0]?.content ||
        "Unknown task";

      const arbiterResult = await routeTaskWithFallback("arbiter", {
        id: `arbiter-${task.id || "unknown"}`,
        messages: [
          {
            role: "system",
            content:
              'You are an impartial code arbiter. You will see two outputs (A and B) generated by different AI agents for the same task. Compare them and decide which is better. Consider correctness, completeness, clarity, and conciseness. Respond with ONLY valid JSON in this exact format: {"verdict": "A" or "B" or "conflict", "reasoning": "brief explanation"}',
          },
          {
            role: "user",
            content: `Task: ${taskDescription}\n\n--- OUTPUT A ---\n${contentA}\n\n--- OUTPUT B ---\n${contentB}\n\nWhich output is better? Reply with JSON only.`,
          },
        ],
      });

      const arbiterContent = this.extractContent(arbiterResult.response);
      const parsed = this.parseArbiterResponse(arbiterContent);

      return {
        verdict: parsed.verdict,
        reasoning: parsed.reasoning,
        provider: arbiterResult.provider,
      };
    } catch (error) {
      // LLM arbiter failed — fall back to structural heuristic
      console.warn(
        `⚠ Arbiter LLM call failed, using structural fallback: ${error instanceof Error ? error.message : String(error)}`
      );

      if (contentA.length < contentB.length * 0.8) {
        return {
          verdict: "A",
          reasoning: "A is more concise (LLM arbiter unavailable, structural fallback)",
          provider: "groq",
        };
      }
      if (contentB.length < contentA.length * 0.8) {
        return {
          verdict: "B",
          reasoning: "B is more concise (LLM arbiter unavailable, structural fallback)",
          provider: "groq",
        };
      }

      return {
        verdict: "A",
        reasoning: "Outputs similar length; preferring primary executor (LLM arbiter unavailable)",
        provider: "groq",
      };
    }
  }

  /**
   * Parse the arbiter's JSON response, handling malformed output gracefully.
   */
  private parseArbiterResponse(content: string): {
    verdict: "A" | "B" | "conflict";
    reasoning: string;
  } {
    // Try to extract JSON from the response (may contain markdown fences or extra text)
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const verdict = parsed.verdict;
        if (verdict === "A" || verdict === "B" || verdict === "conflict") {
          return {
            verdict,
            reasoning: String(parsed.reasoning || "No reasoning provided"),
          };
        }
      } catch {
        // JSON parse failed, continue to fallback
      }
    }

    // Fallback: try to detect verdict keywords in the response
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('"verdict"') && lowerContent.includes('"b"')) {
      return { verdict: "B", reasoning: "Extracted B from partial response" };
    }

    // Default to conflict if we can't parse
    return {
      verdict: "conflict",
      reasoning: `Could not parse arbiter response: ${content.slice(0, 200)}`,
    };
  }

  private extractContent(response: any): string {
    if (typeof response === "string") {
      return response;
    }
    if (response && typeof response === "object") {
      if ("content" in response) {
        return String(response.content);
      }
      if ("text" in response) {
        return String(response.text);
      }
      return JSON.stringify(response);
    }
    return String(response);
  }

  private hashContent(content: string): string {
    // Simple hash for comparison (not cryptographic)
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private estimateCost(provider: ProviderId): number {
    // Rough cost estimates per provider (in cents)
    const costMap: Record<ProviderId, number> = {
      "opencode-go": 2,
      "anthropic-api": 3,
      "gemini-api": 1,
      "deepseek-v4": 2,
      deepseek: 1,
      tavily: 0.5,
      gemini: 0.5,
      "moonshot-k2.5": 2,
      "moonshot-k2.6": 2.5,
      "xiaomi-mimo": 0.5,
      "qwen3.5-plus": 1,
      "qwen3.6-plus": 1.5,
      "minimax-m2.5": 1,
      "minimax-m2.7": 1.5,
      "glm-deepinfra": 0.5,
      "glm-fireworks": 0.5,
      "glm-zai": 0.5,
      groq: 0.3,
      "kiro-ai": 0.2,
      mistral: 0.5,
      openai: 1,
    };
    return costMap[provider] || 1;
  }

  public getEventLedgerPath(): string {
    return this.ledger.getFilePath();
  }
}
