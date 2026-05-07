# CLARITY WARP: TECHNICAL ARCHITECTURE MANIFESTO
## Unified Agentic Development Environment — Machine-Optimized Technical Specification

**Version:** 0.2.0-draft  
**Date:** 2026-05-01  
**Classification:** Architecture Design Document — Multi-AI Consensus Input  
**Authoring Context:** Chain-of-Thought + Mixture-of-Experts synthesis across 6 upstream projects, 4 architectural perspectives, and empirical analysis of Clarity Code v0.1.0 codebase.

---

## 1. EXECUTIVE THESIS

Clarity Warp is not a terminal emulator. It is not a CLI wrapper. It is the **operating system of vibecoding**: a unified, open-source agentic development environment where a single natural language objective decomposes into a coordinated swarm of specialized agents, each executing in isolated git worktrees, managed by a deterministic state machine, rendered through a terminal-integrated UI, and routed across 40+ LLM providers with automatic tier-based fallback.

**Core invariant:** The user never types a shell command unless they choose to. The primary interface is intent-driven (`"Add biometric auth to UserService"`), not command-driven (`$ ls -la`). The terminal is a secondary tool, permanently available but not the entry point.

---

## 2. ARCHITECTURAL DECISION RECORD (ADR)

### ADR-001: Terminal-As-Framework, Not Terminal-As-Product

**Status:** Accepted  
**Context:** Warp (AGPL/MIT dual-license) is a GPU-accelerated terminal written in Rust. It exposes custom blocks, agent mode, MCP support, and a plugin API. Claude Code Desktop exists as a separate application but has lower adoption than its CLI. OpenCode Desktop is in beta with terminal/IDE/desktop triple mode.

**Decision:** Use Warp as a rendering framework and plugin host. Do NOT fork Warp. Build Clarity Warp as a Warp plugin (TypeScript/Rust hybrid) + standalone daemon (Bun/TypeScript) that communicates via IPC/WebSocket. Maintain a standalone CLI mode (`clarity auto`) for terminal-only environments.

**Consequences:**
- (+) Avoids AGPL contamination of proprietary orchestrator logic
- (+) Leverages Warp's GPU-accelerated block rendering without rewriting
- (+) Plugin architecture allows Warp users to opt-in without switching tools
- (-) Dependency on Warp's plugin API stability
- (-) Requires two processes: Warp (UI) + Clarity Core (daemon)

**Mitigation:** TerminalAdapter pattern. Implementations: `WarpAdapter`, `InkAdapter` (current), `VSCodeAdapter` (future). If Warp API changes, swap adapter. Core logic never touches Warp internals.

---

### ADR-002: No Forks, Native Ports

**Status:** Accepted  
**Context:** Three upstream projects identified as functionally relevant: Claw Code (permission sandboxing), GSD2 (state machine / orchestration), Warp (terminal framework).

**Decision:**
- **GSD2:** Adopt as architectural blueprint. Clarity Code v0.1.0 already implements a subset. Enhance, do not replace.
- **Claw Code:** Port permission system concepts (3-tier access: read-only / workspace-write / danger-full-access) to Rust module. Do NOT port Python runtime.
- **Warp:** Plugin integration only. No code fork.

**Legal rationale:** Claw Code internals may derive from leaked Claude Code source. Clean-room reimplementation required. Warp AGPL requires open-sourcing derivative works; plugin boundary avoids this.

---

### ADR-003: All Subsystems Native, Zero MCP Dependencies

**Status:** Accepted  
**Context:** GitNexus (knowledge graph), cocoindex-code (incremental indexing), LeanCTX (context compression), 9Router (provider taxonomy) were identified as MCP servers or external tools.

**Decision:** Integrate all subsystems as native Rust modules compiled into the Clarity Core binary. No external MCP server processes. No network latency. No process spawning overhead.

**Module mapping:**
| External Tool | Native Module | Language | Interface |
|---------------|---------------|----------|-----------|
| GitNexus | `code-indexer` | Rust | Internal API: `find_dependencies()`, `semantic_search()`, `blast_radius()` |
| cocoindex-code | `incremental-indexer` | Rust | Event-driven reindex on file changes |
| LeanCTX | `context-compressor` | Rust | Pre-processor before `ProviderRouter.routeTask()` |
| 9Router taxonomy | `provider-registry` | TypeScript | JSON-configurable provider definitions |

**Rationale:** MCP adds 50-100ms per call. A swarm executing 200 tasks/day incurs 10-20s of pure latency. Native modules share memory space with the orchestrator.

---

### ADR-004: Three-Tier Provider Authentication

**Status:** Accepted  
**Context:** Clarity Code v0.1.0 reads credentials exclusively from `process.env`. The `clarity config` wizard persists to `~/.clarity/credentials.json` with `fs.chmod(0o600)`. The two systems never converge.

**Decision:** Implement unified `CredentialResolver` with deterministic precedence:

```
1. ~/.clarity/credentials.json (highest priority — user-configured persistent)
2. Environment variables (fallback — CI/CD, ephemeral)
3. OAuth token cache (if provider supports OAuth2 device flow)
4. Free-tier anonymous endpoints (no auth required — Kiro AI, iFlow AI)
```

**Bug fix required (P0):** `src/core/config.ts` Zod schema currently reads `process.env.OPENCODE_API_KEY` only. Must inject `CredentialResolver.resolve('opencode')` before schema validation.

**Provider taxonomy (40+ providers across 3 tiers):**

**Tier 1 — OAuth Providers (persistent token, refreshable):**
- Anthropic (Claude Code OAuth)
- Google (Gemini OAuth 2.0)
- Antigravity (if applicable)

**Tier 2 — Free & Free-Tier Providers (zero cost, rate-limited):**
- Kiro AI (Claude Sonnet/Haiku, DeepSeek, Qwen, GLM — no auth required)
- Qwen Code (Qwen3 Coder Next — free tier)
- iFlow AI (8 models, unlimited, no auth)
- OpenRouter (400+ models, free tier available)
- Groq (Llama 4, Qwen3 — generous free tier)

**Tier 3 — API Key Providers (pay-per-use, highest quality):**
- OpenCode Go (primary)
- DeepSeek (fallback)
- Mistral
- Fireworks AI
- Together AI
- Cohere
- AI21
- Replicate
- Perplexity
- And 20+ others following 9Router taxonomy

---

## 3. SYSTEM ARCHITECTURE

### 3.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLARITY WARP v0.2                                    │
│                    Unified Agentic Development Environment                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         PRESENTATION LAYER                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │   │
│  │  │ Warp Plugin │  │ Ink TUI     │  │ VS Code Ext │  │ Web UI     │ │   │
│  │  │ (Primary)   │  │ (Fallback)  │  │ (Future)    │  │ (Future)   │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘ │   │
│  │         │                │                │               │        │   │
│  │         └────────────────┴────────────────┴───────────────┘        │   │
│  │                              │                                      │   │
│  │                    TerminalAdapter (interface)                      │   │
│  │                    - renderBlock(type, content)                     │   │
│  │                    - createWorktreePane(id)                         │   │
│  │                    - streamOutput(agentId, chunk)                   │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────┼──────────────────────────────────────┐   │
│  │                         ORCHESTRATION LAYER                          │   │
│  │  ┌─────────────────────────────┐  ┌─────────────────────────────┐   │   │
│  │  │      CLARITY CORE           │  │       CLARITY SHELL         │   │   │
│  │  │      (Bun/TypeScript)       │  │       (Input Parser)        │   │   │
│  │  │                             │  │                             │   │   │
│  │  │  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │   │   │
│  │  │  │   AuthManager       │   │  │  │  IntentParser       │   │   │   │
│  │  │  │   - CredentialResolver│  │  │  │  - isShellCommand() │   │   │   │
│  │  │  │   - OAuthFlow       │   │  │  │  - isObjective()    │   │   │   │
│  │  │  │   - TokenRefresh    │   │  │  │  - isClarityCmd()   │   │   │   │
│  │  │  └─────────────────────┘   │  │  └─────────────────────┘   │   │   │
│  │  │                             │  │                             │   │   │
│  │  │  ┌─────────────────────┐   │  │  ┌─────────────────────┐   │   │   │
│  │  │  │   ProviderRegistry  │   │  │  │  SwarmDashboard     │   │   │   │
│  │  │  │   - 40+ providers   │   │  │  │  - Real-time progress│  │   │   │
│  │  │  │   - 3-tier fallback │   │  │  │  - Agent status      │   │   │   │
│  │  │  │   - Cost tracking   │   │  │  │  - Cost aggregation  │   │   │   │
│  │  │  └─────────────────────┘   │  │  └─────────────────────┘   │   │   │
│  │  │                             │  │                             │   │   │
│  │  │  ┌─────────────────────┐   │  └─────────────────────────────┘   │   │
│  │  │  │   AgentRouter       │   │                                     │   │
│  │  │  │   - research role   │   │                                     │   │
│  │  │  │   - plan role       │   │                                     │   │
│  │  │  │   - execution role  │   │                                     │   │
│  │  │  │   - verify role     │   │                                     │   │
│  │  │  └─────────────────────┘   │                                     │   │
│  │  │                             │                                     │   │
│  │  │  ┌─────────────────────┐   │                                     │   │
│  │  │  │   TaskDecomposer    │   │                                     │   │
│  │  │  │   - LLM→DAG         │   │                                     │   │
│  │  │  │   - Schema validation│  │                                     │   │
│  │  │  │   - Dependency check│   │                                     │   │
│  │  │  └─────────────────────┘   │                                     │   │
│  │  │                             │                                     │   │
│  │  │  ┌─────────────────────┐   │                                     │   │
│  │  │  │   SubagentManager   │   │                                     │   │
│  │  │  │   - 5 concurrent    │   │                                     │   │
│  │  │  │   - Worktree pool   │   │                                     │   │
│  │  │  │   - EventLedger     │   │                                     │   │
│  │  │  └─────────────────────┘   │                                     │   │
│  │  │                             │                                     │   │
│  │  │  ┌─────────────────────┐   │                                     │   │
│  │  │  │   StateMachine      │   │                                     │   │
│  │  │  │   - idle|running|   │   │                                     │   │
│  │  │  │     paused|error    │   │                                     │   │
│  │  │  │   - Atomic writes   │   │                                     │   │
│  │  │  │   - Checkpoint/resume│  │                                     │   │
│  │  │  └─────────────────────┘   │                                     │   │
│  │  │                             │                                     │   │
│  │  │  ┌─────────────────────┐   │                                     │   │
│  │  │  │   ParallelScheduler │   │                                     │   │
│  │  │  │   - Worktree pool=3 │   │                                     │   │
│  │  │  │   - Priority queue  │   │                                     │   │
│  │  │  │   - Backpressure    │   │                                     │   │
│  │  │  └─────────────────────┘   │                                     │   │
│  │  └─────────────────────────────┘                                     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         EXECUTION LAYER                              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │   │
│  │  │ TavilyAgent  │  │ GeminiAgent  │  │ OpenCodeAgent│  │ DeepSeek │ │   │
│  │  │ (research)   │  │ (planning)   │  │ (execution)  │  │ (verify) │ │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │   │
│  │         │                 │                 │               │       │   │
│  │         └─────────────────┴─────────────────┴───────────────┘       │   │
│  │                              │                                      │   │
│  │                    IsolationEngine (Rust)                           │   │
│  │                    - git worktree create/destroy                    │   │
│  │                    - namespace sandbox (future)                     │   │
│  │                    - cgroup limits (future)                         │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────┼──────────────────────────────────────┐   │
│  │                         NATIVE MODULES (Rust)                        │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │ isolation-  │ │ permission- │ │ context-    │ │ code-       │   │   │
│  │  │ engine      │ │ engine      │ │ compressor  │ │ indexer     │   │   │
│  │  │ (.so/.dll)  │ │ (.so/.dll)  │ │ (.so/.dll)  │ │ (.so/.dll)  │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  │                                                                     │   │
│  │  Cross-platform binaries distributed via optionalDependencies      │   │
│  │  with os/cpu constraints + postinstall script (pattern: esbuild)   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow: Objective → Swarm → Result

```
User Input: "Add biometric auth to NeuroClaridad"
         │
         ▼
┌─────────────────┐
│ IntentParser    │
│ - Not shell cmd │
│ - Not clarity cmd│
│ → Type: OBJECTIVE│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ TaskDecomposer  │
│ LLM prompt:     │
│ "Decompose into │
│  atomic tasks"  │
│ → JSON DAG:     │
│   [             │
│     {"id":1,    │
│      "desc":"Research biometric APIs",│
│      "complexity":"low",              │
│      "dependencies":[],               │
│      "role":"research"},              │
│     {"id":2,                           │
│      "desc":"Design auth schema",     │
│      "complexity":"medium",           │
│      "dependencies":[1],              │
│      "role":"plan"},                  │
│     {"id":3,                           │
│      "desc":"Implement /api/auth/verify",│
│      "complexity":"high",             │
│      "dependencies":[2],              │
│      "role":"execution"},             │
│     {"id":4,                           │
│      "desc":"Write integration tests",│
│      "complexity":"medium",           │
│      "dependencies":[3],              │
│      "role":"verify"}                 │
│   ]             │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ code-indexer    │
│ (GitNexus port) │
│ - blast_radius(files)│
│ - semantic_search(query)│
│ → Assigns file│
│   context to  │
│   each task   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ context-        │
│ compressor      │
│ (LeanCTX port)  │
│ - Removes system│
│   prompt redundancy│
│ - AST signatures│
│   instead of raw│
│   code when     │
│   possible      │
│ → 40% token     │
│   reduction     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AgentRouter     │
│ - Role-based    │
│   routing:      │
│   research→Tavily│
│   plan→Gemini   │
│   execution→    │
│     OpenCode Go │
│   verify→DeepSeek│
│ - Fallback:     │
│   Tier3→Tier2→  │
│   Tier1→Local   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ SubagentManager │
│ - Spawns 5      │
│   agents max    │
│ - Worktree pool │
│   size=3        │
│ - Priority queue│
│   (deps first)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ IsolationEngine │
│ - git worktree  │
│   add per agent │
│ - PTY per agent │
│   (Warp pane)   │
│ - EventLedger   │
│   writes        │
│   .events/run-*.jsonl│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ParallelScheduler│
│ - Executes DAG  │
│   topologically │
│ - Backpressure  │
│   if worktree   │
│   pool full     │
│ - StateMachine  │
│   checkpoints   │
│   every task    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Result:         │
│ - Branch: gsd/  │
│   M007/feature- │
│   biometric-auth│
│ - 4 tasks, 100% │
│   success       │
│ - Cost: $0.87   │
│ - Tokens: 39,400│
│ - Ledger:       │
│   .events/run-  │
│   2026-04-30... │
│   .jsonl        │
└─────────────────┘
```

---

## 4. COMPONENT SPECIFICATIONS

### 4.1 CredentialResolver (Unified Authentication)

**Current bug (P0):** `src/core/config.ts` line 15 reads `process.env.OPENCODE_API_KEY` exclusively. `src/commands/config.ts` line 193 writes to `~/.clarity/credentials.json` via `saveCredentials()`. The two never meet.

**Required implementation:**

```typescript
// src/core/credentials.ts
interface CredentialEntry {
  provider: string;
  apiKey?: string;
  oauthToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tier: 'oauth' | 'api_key' | 'free';
}

class CredentialResolver {
  private cache: Map<string, CredentialEntry> = new Map();
  
  async resolve(provider: string): Promise<string | null> {
    // 1. Memory cache
    if (this.cache.has(provider)) {
      return this.cache.get(provider)!.apiKey || null;
    }
    
    // 2. ~/.clarity/credentials.json
    const filePath = getCredentialsPath();
    if (await Bun.file(filePath).exists()) {
      const content = await Bun.file(filePath).json();
      if (content[provider]?.apiKey) {
        this.cache.set(provider, content[provider]);
        return content[provider].apiKey;
      }
    }
    
    // 3. Environment variable
    const envKey = `\${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    if (process.env[envKey]) {
      return process.env[envKey];
    }
    
    // 4. OAuth token cache
    const oauthCache = await this.getOAuthCache(provider);
    if (oauthCache?.accessToken) {
      return oauthCache.accessToken;
    }
    
    // 5. Free tier — no auth
    if (isFreeProvider(provider)) {
      return 'anonymous';
    }
    
    return null;
  }
}
```

**Integration point:** `ProviderRouter` constructor must receive `CredentialResolver` instance, not read `process.env` directly.

---

### 4.2 ProviderRegistry (40+ Providers, 3 Tiers)

**Configuration format** (JSON, hot-reloadable):

```json
{
  "providers": [
    {
      "id": "opencode-go",
      "name": "OpenCode Go",
      "tier": "api_key",
      "baseUrl": "https://api.opencode.ai/v1",
      "models": ["opencode-go", "opencode-go-mini"],
      "defaultModel": "opencode-go",
      "costPer1K": { "input": 0.001, "output": 0.002 },
      "rateLimit": { "rpm": 60, "tpm": 100000 },
      "authType": "api_key",
      "envKey": "OPENCODE_API_KEY"
    },
    {
      "id": "kiro-ai",
      "name": "Kiro AI",
      "tier": "free",
      "baseUrl": "https://api.kiro.ai/v1",
      "models": ["claude-sonnet", "deepseek-chat", "qwen-72b", "glm-4"],
      "defaultModel": "claude-sonnet",
      "costPer1K": { "input": 0, "output": 0 },
      "rateLimit": { "rpm": 30, "tpm": 50000 },
      "authType": "none"
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "tier": "oauth",
      "baseUrl": "https://api.anthropic.com/v1",
      "models": ["claude-sonnet-4", "claude-haiku-4"],
      "defaultModel": "claude-sonnet-4",
      "costPer1K": { "input": 0.003, "output": 0.015 },
      "rateLimit": { "rpm": 4000, "tpm": 400000 },
      "authType": "oauth2",
      "oauthConfig": {
        "authorizeUrl": "https://auth.anthropic.com/oauth/authorize",
        "tokenUrl": "https://auth.anthropic.com/oauth/token",
        "deviceCodeUrl": "https://auth.anthropic.com/oauth/device/code",
        "scopes": ["claude_api"]
      }
    }
  ],
  "fallbackChain": {
    "research": ["anthropic", "opencode-go", "kiro-ai"],
    "plan": ["anthropic", "gemini", "qwen-code"],
    "execution": ["opencode-go", "deepseek", "groq"],
    "verify": ["deepseek", "mistral", "iflow-ai"]
  }
}
```

**Auto-fallback logic:**

```typescript
class ProviderRouter {
  async routeTask(task: Task): Promise<AgentResult> {
    const role = task.role; // 'research' | 'plan' | 'execution' | 'verify'
    const chain = this.config.fallbackChain[role];
    
    for (const providerId of chain) {
      const provider = this.registry.get(providerId);
      const credentials = await this.credentialResolver.resolve(providerId);
      
      if (!credentials && provider.tier !== 'free') {
        this.emit('provider_skipped', { provider: providerId, reason: 'no_credentials' });
        continue;
      }
      
      if (provider.rateLimit && await this.isRateLimited(providerId)) {
        this.emit('provider_skipped', { provider: providerId, reason: 'rate_limited' });
        continue;
      }
      
      try {
        const result = await this.executeWithProvider(task, provider, credentials);
        this.emit('provider_used', { provider: providerId, cost: result.cost });
        return result;
      } catch (error) {
        this.emit('provider_failed', { provider: providerId, error: error.message });
        continue;
      }
    }
    
    throw new Error(`All providers exhausted for role: \${role}`);
  }
}
```

---

### 4.3 EventLedger (Deterministic Replay)

**Current state:** `src/core/ledger.ts` writes `.events/run-*.jsonl` but is treated as debug log.

**Required enhancement:** Promote ledger to first-class reproducibility asset.

```typescript
// src/core/ledger.ts
interface LedgerEntry {
  timestamp: string;      // ISO 8601
  runId: string;          // UUID
  taskId: string;
  agentId: string;
  provider: string;
  model: string;
  action: 'start' | 'complete' | 'error' | 'fallback';
  input: {
    prompt: string;
    files: string[];
    contextTokens: number;
  };
  output?: {
    result: string;
    filesModified: string[];
    tokensUsed: number;
    cost: number;
    durationMs: number;
  };
  error?: {
    message: string;
    stack: string;
    recoverable: boolean;
  };
  worktree: string;
  gitCommit: string;
}

class EventLedger {
  async replay(runId: string, options: ReplayOptions): Promise<ReplayResult> {
    const entries = await this.loadRun(runId);
    const results: ReplayResult = { tasks: [], totalCost: 0, diffs: [] };
    
    for (const entry of entries) {
      if (options.providerOverride) {
        entry.provider = options.providerOverride;
      }
      
      const task = this.reconstructTask(entry);
      const result = await this.agentRouter.routeTask(task);
      
      results.tasks.push({
        taskId: entry.taskId,
        originalProvider: entry.provider,
        replayProvider: options.providerOverride || entry.provider,
        originalOutput: entry.output?.result,
        replayOutput: result.output,
        diff: this.computeDiff(entry.output?.result, result.output)
      });
      
      results.totalCost += result.cost;
    }
    
    return results;
  }
}
```

**CLI interface:**
```bash
# Replay a historical run against a different provider
clarity replay run-2026-04-30T15-51-29.jsonl --provider groq-llama4

# Replay with cost comparison
clarity replay run-2026-04-30T15-51-29.jsonl --provider deepseek-v4 --compare

# CI integration: run 10 historical runs against new provider
clarity replay --suite regression --provider kiro-ai --threshold 0.95
```

---

### 4.4 Native Rust Modules

#### 4.4.1 isolation-engine

**Current:** `isolation-engine/src/main.rs` implements `git worktree add` only.

**Required enhancement:**

```rust
// isolation-engine/src/lib.rs
pub struct IsolationEngine {
    repo_path: PathBuf,
    worktree_pool: Vec<Worktree>,
}

impl IsolationEngine {
    pub fn create_worktree(&self, task_id: &str) -> Result<Worktree, Error> {
        let path = self.repo_path.join(".clarity").join("worktrees").join(task_id);
        
        // Current: git worktree add
        Command::new("git")
            .args(["worktree", "add", "-b", &format!("clarity/\${task_id}"), path.to_str().unwrap()])
            .current_dir(&self.repo_path)
            .output()?;
        
        // Future: namespace sandboxing (port from Claw Code)
        // Future: cgroup limits for CPU/memory
        
        Ok(Worktree { id: task_id.to_string(), path })
    }
    
    pub fn destroy_worktree(&self, worktree: &Worktree) -> Result<(), Error> {
        Command::new("git")
            .args(["worktree", "remove", "--force", &worktree.path.to_string_lossy()])
            .output()?;
        Ok(())
    }
}
```

**Distribution:** Compiled to `isolation-engine-{target}.node` via napi-rs. Distributed via `optionalDependencies` in `package.json`:

```json
{
  "optionalDependencies": {
    "@clarity-warp/isolation-engine-darwin-arm64": "0.2.0",
    "@clarity-warp/isolation-engine-linux-x64": "0.2.0",
    "@clarity-warp/isolation-engine-win32-x64": "0.2.0"
  }
}
```

#### 4.4.2 permission-engine (Port from Claw Code)

**3-tier permission model:**

```rust
pub enum PermissionLevel {
    ReadOnly,        // Can read files, cannot modify
    WorkspaceWrite,  // Can modify files in worktree, cannot access system
    DangerFullAccess, // Can execute arbitrary commands, access network
}

pub struct PermissionPolicy {
    pub level: PermissionLevel,
    pub allowedCommands: Vec<String>,     // e.g., ["git", "bun", "node"]
    pub blockedPaths: Vec<PathBuf>,       // e.g., ["~/.ssh", "~/.aws"]
    pub networkAllowed: bool,
    pub maxFileSize: usize,
    pub maxExecutionTime: Duration,
}

impl PermissionEngine {
    pub fn enforce(&self, action: &Action) -> Result<(), PermissionError> {
        match action {
            Action::ReadFile(path) => self.check_read(path),
            Action::WriteFile(path) => self.check_write(path),
            Action::ExecuteCommand(cmd) => self.check_execute(cmd),
            Action::NetworkRequest(url) => self.check_network(url),
        }
    }
}
```

#### 4.4.3 context-compressor (Port from LeanCTX)

**Compression pipeline:**

```rust
pub struct ContextCompressor;

impl ContextCompressor {
    pub fn compress(prompt: &str, context: &CodeContext) -> CompressedContext {
        // 1. Deduplicate system prompt
        let deduped = self.deduplicate_system_prompt(prompt);
        
        // 2. Convert raw code to AST signatures where possible
        let ast_signatures = self.extract_ast_signatures(&context.files);
        
        // 3. Delta compression (only send changes vs last context)
        let delta = self.compute_delta(&context.previous, &context.current);
        
        CompressedContext {
            tokens_saved: self.estimate_tokens_saved(),
            compressed_prompt: deduped,
            signatures: ast_signatures,
            delta,
        }
    }
}
```

**Expected impact:** 20-40% token reduction. Makes free-tier providers (30 RPM) viable for simple tasks.

#### 4.4.4 code-indexer (Port from GitNexus + cocoindex-code)

**API surface:**

```rust
pub struct CodeIndexer;

impl CodeIndexer {
    pub fn index_repository(&self, repo_path: &Path) -> Result<Index, Error> {
        // tree-sitter AST parsing
        // Dependency graph construction
        // Embedding generation (local, no API calls)
        Ok(Index::new())
    }
    
    pub fn find_dependencies(&self, file: &Path) -> Vec<PathBuf> {
        // Return all files that import or are imported by `file`
    }
    
    pub fn semantic_search(&self, query: &str) -> Vec<SearchResult> {
        // Vector similarity search over code embeddings
    }
    
    pub fn blast_radius(&self, files: &[PathBuf]) -> Vec<PathBuf> {
        // Transitive closure of dependencies
        // Used by TaskDecomposer to assign `files` to tasks
    }
}
```

---

## 5. FIRST-SCREEN UI SPECIFICATION

### 5.1 Clarity Warp Shell (Hybrid Input)

**Mode detection algorithm:**

```typescript
function detectMode(input: string): 'shell' | 'clarity' | 'objective' {
  // Shell commands: start with known binaries or file paths
  const shellPattern = /^(ls|cd|git|npm|bun|node|cat|mkdir|rm|cp|mv|docker|kubectl)\s/;
  if (shellPattern.test(input)) return 'shell';
  
  // Clarity commands: start with "clarity "
  if (input.startsWith('clarity ')) return 'clarity';
  
  // Everything else is an objective
  return 'objective';
}
```

### 5.2 Layout Specification

```
Viewport: 100% width, 100% height
┌─────────────────────────────────────────────────────────────────────────────┐
│ Header (48px)                                                               │
│ [Clarity Warp v0.2]  [🐝 Swarm]  [💻 Terminal]  [📊 Dashboard]  [⚙️ ]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ Main Content Area (flex: 1)                                                 │
│ ┌─────────────────────────────────────────────────────────────────────┐    │
│ │                                                                     │    │
│ │  Mode: SWARM (active objective)                                     │    │
│ │                                                                     │    │
│ │  ┌─ Objective Card ─────────────────────────────────────────────┐  │    │
│ │  │ 🎯 "Add biometric auth to NeuroClaridad"                      │  │    │
│ │  │ ⏱️ 3m 12s · 💰 $0.43 · 📊 2/4 tasks · 🔀 gsd/M007/...        │  │    │
│ │  │ [⏸ Pause] [⏹ Stop] [🔍 Details]                              │  │    │
│ │  └────────────────────────────────────────────────────────────────┘  │    │
│ │                                                                     │    │
│ │  ┌─ Agent Grid (responsive: 2 cols mobile, 4 cols desktop) ────┐  │    │
│ │  │                                                            │  │    │
│ │  │  ┌─ Tavily ─────────────────────────────────────────────┐  │  │    │
│ │  │  │ 🔍 Researching biometric APIs...                    │  │  │    │
│ │  │  │ [████████░░░░░░░░░░] 47%                           │  │  │    │
│ │  │  │ 5,200 tokens · $0.08 · 1m 30s                       │  │  │    │
│ │  │  └──────────────────────────────────────────────────────┘  │  │    │
│ │  │                                                            │  │    │
│ │  │  ┌─ Gemini ──────────────────────────────────────────────┐  │  │    │
│ │  │  │ 🏗️  Designing auth schema...                         │  │  │    │
│ │  │  │ [████░░░░░░░░░░░░░░] 20%                             │  │  │    │
│ │  │  │ 2,100 tokens · $0.07 · 45s                          │  │  │    │
│ │  │  └──────────────────────────────────────────────────────┘  │  │    │
│ │  │                                                            │  │    │
│ │  │  ┌─ OpenCode Go ─────────────────────────────────────────┐  │  │    │
│ │  │  │ 💻 Waiting for design completion...                   │  │  │    │
│ │  │  │ [░░░░░░░░░░░░░░░░░░] 0%                              │  │  │    │
│ │  │  │ — tokens · — cost · — time                            │  │  │    │
│ │  │  └──────────────────────────────────────────────────────┘  │  │    │
│ │  │                                                            │  │    │
│ │  │  ┌─ DeepSeek ────────────────────────────────────────────┐  │  │    │
│ │  │  │ ✅ Writing integration tests...                        │  │  │    │
│ │  │  │ [████████████████░░] 80%                             │  │  │    │
│ │  │  │ 8,400 tokens · $0.12 · 2m 15s                        │  │  │    │
│ │  │  └──────────────────────────────────────────────────────┘  │  │    │
│ │  │                                                            │  │    │
│ │  └────────────────────────────────────────────────────────────┘  │    │
│ │                                                                     │    │
│ └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ Bottom Panel (200px, resizable, collapsible)                                │
│ ┌─ Agent Terminals (tabs) ─────────────────────────────────────────────────┐│
│ │ [Tavily] [Gemini] [OpenCode Go] [DeepSeek] [+ New Terminal]            ││
│ ├──────────────────────────────────────────────────────────────────────────┤│
│ │ $ git worktree add .clarity/worktrees/task-3                            ││
│ │ $ bun test --testPathPattern="auth"                                      ││
│ │ ✅ 3 passed, 0 failed                                                    ││
│ │                                                                          ││
│ └──────────────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────────────┤
│ Input Bar (64px)                                                            │
│ ┌─ Universal Input ────────────────────────────────────────────────────────┐│
│ │ $ clarity warp> [______________________________________________] [→]   ││
│ │ Mode: [🐝 SWARM]  [💻 SHELL]  [💬 CHAT]                                 ││
│ └──────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Responsive Behavior

| Viewport | Layout | Agent Grid | Bottom Panel |
|----------|--------|------------|--------------|
| < 768px | Single column | 1 agent visible at a time, swipe | Collapsed by default, swipe up |
| 768-1200px | Two column | 2x2 grid | Collapsed by default |
| > 1200px | Three column | 4x1 or 2x2 grid | Expanded by default |

---

## 6. IMPLEMENTATION ROADMAP

### Phase 1: Stabilization (Week 1)

**Day 1: Credential Bug Fix**
- File: `src/core/credentials.ts` (new)
- File: `src/core/config.ts` (modify line 15)
- File: `src/commands/auto.ts` (modify line 35)
- Test: `tests/credentials.test.ts` (new)

**Day 2-3: OAuth Implementation**
- File: `src/core/oauth.ts` (new)
- Implements: Device Authorization Grant (RFC 8628)
- Providers: Anthropic, Google
- Test: `tests/oauth.test.ts` (new)

**Day 4-5: Config Wizard Enhancement**
- File: `src/lib/config-wizard.tsx` (modify)
- Adds: Tier selection, OAuth flow, provider testing

### Phase 2: Provider Expansion (Week 2)

**Day 1-2: Free Provider Integration**
- Kiro AI, Qwen Code, iFlow AI, OpenRouter, Groq
- File: `src/providers/free/` (new directory)
- Each provider: `index.ts`, `types.ts`, `test.ts`

**Day 3-4: Auto-Fallback Chain**
- File: `src/core/fallback-chain.ts` (new)
- Implements: 4-tier fallback with cost optimization
- Config: `config/fallback-chain.json`

**Day 5: Cost Dashboard**
- File: `src/tui/components/CostDashboard.tsx` (new)
- Real-time cost tracking per provider/agent

### Phase 3: Native Modules (Week 3)

**Day 1-2: code-indexer (Rust)**
- Port GitNexus core AST parsing
- tree-sitter bindings for TypeScript, Rust, Python
- File: `native/code-indexer/src/lib.rs`

**Day 3-4: context-compressor (Rust)**
- Port LeanCTX token compression
- AST signature extraction
- Delta compression

**Day 5: integration**
- Bun FFI bindings
- File: `src/lib/native.ts`

### Phase 4: Security (Week 4)

**Day 1-2: permission-engine (Rust)**
- 3-tier permission model
- Command allow-listing
- Path blocking

**Day 3-4: isolation-engine enhancement**
- Namespace sandboxing (Linux)
- cgroup limits (CPU, memory, network)

**Day 5: E2E Security Test**
- Test: `tests/e2e/security-escape.test.ts`
- Malicious agent attempts file escape → must fail
- Malicious agent attempts network access → must fail

### Phase 5: Warp Integration (Week 5-6)

**Week 5:**
- Warp Plugin API research
- SwarmBlock custom block implementation
- IPC bridge (WebSocket)

**Week 6:**
- AgentTerminal pane integration
- Input hook for intent detection
- Beta release

---

## 7. COMPETITIVE POSITIONING

| Dimension | Clarity Warp | Claude Code | OpenCode | Warp Agent | Cursor |
|-----------|-------------|-------------|----------|------------|--------|
| **Primary Interface** | Intent-driven swarm | Terminal chat | Terminal chat | Terminal with AI | Editor + chat |
| **Multi-Agent** | Yes (5 concurrent) | No (single) | No (single) | No (single) | No (single) |
| **Provider Count** | 40+ (3 tiers) | 1 (Anthropic) | 10+ | 5+ | 5+ |
| **Free Tier Strategy** | First-class (8 providers) | None | Limited | Limited | Limited |
| **Auto-Fallback** | 4-tier with cost opt | None | None | None | None |
| **Worktree Isolation** | Yes (git + sandbox) | No | No | No | No |
| **Deterministic Replay** | Yes (EventLedger) | No | No | No | No |
| **Context Compression** | Yes (LeanCTX port) | No | No | No | No |
| **Code Knowledge Graph** | Yes (GitNexus port) | No | No | No | No |
| **Cost Transparency** | Real-time per task | Opaque | Opaque | Opaque | Opaque |
| **Open Source** | Yes (MIT) | No | Yes (MIT) | Yes (MIT/AGPL) | No |
| **Terminal Integration** | Native (Warp plugin) | CLI only | CLI only | Native | Integrated |

---

## 8. BUG REPORT TO GSD2

```
BUG-001: clarity auto no lee credenciales de ~/.clarity/credentials.json
SEVERIDAD: P0 (bloquea uso básico)
ESTADO: Confirmado, fix en progreso

DESCRIPCIÓN:
El wizard `clarity config` persiste correctamente en ~/.clarity/credentials.json
con permisos 0o600. Sin embargo, `clarity auto` nunca carga este archivo. Solo
lee variables de entorno.

EVIDENCIA:
- src/commands/config.ts:193 → saveCredentials() escribe a getCredentialsPath()
- src/core/config.ts:15 → Zod schema lee de process.env únicamente:
  
  export const ConfigSchema = z.object({
    opencodeApiKey: z.string(),  // ← solo process.env.OPENCODE_API_KEY
    // ...
  });
  
- src/commands/auto.ts:35 → new ProviderRouter() sin pasar credenciales cargadas

IMPACTO:
Usuario ejecuta `clarity config`, completa wizard, luego `clarity auto` y
falla con:
  OPENCODE_API_KEY: expected string, received undefined

FIX APLICADO:
1. Crear src/core/credentials.ts: CredentialResolver con orden:
   a) ~/.clarity/credentials.json
   b) process.env
   c) OAuth token cache
   d) Free-tier anonymous
2. Modificar src/core/config.ts: inyectar CredentialResolver antes de Zod validation
3. Modificar src/commands/auto.ts: pasar resolved credentials a ProviderRouter
4. Añadir tests/credentials.test.ts: "dado credentials.json sin env vars, auto funciona"

PR: #TBD
ASIGNADO A: Executor-01
```

---

## 9. RISK ANALYSIS

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Warp plugin API unstable | Medium | High | TerminalAdapter pattern, Ink fallback |
| Free providers shut down | Medium | Medium | 8 free providers, not 1; auto-fallback to paid |
| Rust module compilation fails on Windows | Low | High | CI matrix: macOS/Linux/Windows; precompiled binaries |
| AGPL contamination from Warp | Low | Critical | Plugin boundary, no code fork, MIT license for core |
| Token compression degrades quality | Low | Medium | A/B testing in EventLedger replay; rollback if <95% accuracy |
| Multi-agent coordination deadlocks | Medium | High | Priority queue + timeout; StateMachine checkpointing |

---

## 10. SUCCESS METRICS

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to first swarm | < 30s | From `clarity warp` to first agent running |
| Provider fallback latency | < 2s | Time to switch from failed provider to backup |
| Token cost reduction | 20-40% | vs uncompressed prompts, measured by EventLedger |
| Free tier task completion | > 80% | % of tasks completed using only free providers |
| Worktree isolation escape | 0 | Security E2E test must pass 100% |
| Deterministic replay accuracy | > 95% | Same input → same output across providers |
| Swarm success rate | > 90% | % of objectives completed without human intervention |

---

## 11. GLOSSARY

| Term | Definition |
|------|------------|
| **Swarm** | A coordinated group of specialized agents executing a decomposed objective |
| **Worktree** | Git worktree: isolated checkout of a branch for parallel development |
| **EventLedger** | Append-only JSONL log of all agent actions, enabling deterministic replay |
| **IntentParser** | Algorithm that classifies user input as shell command, clarity command, or objective |
| **ContextCompressor** | Native Rust module that reduces token count before LLM calls |
| **CodeIndexer** | Native Rust module that builds AST + embedding index of the repository |
| **Provider Tier** | Authentication class: OAuth (persistent), API Key (pay-per-use), Free (no auth) |
| **TerminalAdapter** | Interface abstracting terminal rendering: Warp, Ink, VS Code, Web |
| **Deterministic Replay** | Re-executing a historical swarm run against different providers for comparison |
| **Vibecoding** | Development paradigm where intent → code without manual command typing |

---

## 12. APPENDIX: FILE-LEVEL CHANGES

### New Files (v0.1.0 → v0.2.0)

```
src/core/credentials.ts           # Unified credential resolution
src/core/oauth.ts                 # OAuth2 device flow
src/core/fallback-chain.ts        # 4-tier provider fallback
src/providers/free/               # Free-tier provider implementations
  ├── kiro-ai.ts
  ├── qwen-code.ts
  ├── iflow-ai.ts
  ├── openrouter.ts
  └── groq.ts
src/tui/components/CostDashboard.tsx   # Real-time cost tracking
src/tui/components/SwarmBlock.tsx      # Warp custom block (plugin)
src/tui/components/AgentTerminal.tsx   # Per-agent terminal pane
src/lib/native.ts                 # Bun FFI bindings for Rust modules
native/
  ├── code-indexer/
  │   ├── Cargo.toml
  │   └── src/lib.rs
  ├── context-compressor/
  │   ├── Cargo.toml
  │   └── src/lib.rs
  ├── permission-engine/
  │   ├── Cargo.toml
  │   └── src/lib.rs
  └── isolation-engine/
      ├── Cargo.toml
      └── src/lib.rs
config/
  ├── providers.json                # 40+ provider definitions
  └── fallback-chain.json           # Role-based fallback chains
tests/
  ├── credentials.test.ts
  ├── oauth.test.ts
  ├── fallback-chain.test.ts
  ├── free-providers.test.ts
  ├── security-escape.test.ts
  └── e2e/
      └── warp-plugin.test.ts
```

### Modified Files

```
src/core/config.ts                # Inject CredentialResolver before Zod validation
src/core/agent-router.ts          # Add provider registry + fallback logic
src/commands/auto.ts              # Pass resolved credentials to ProviderRouter
src/commands/config.ts            # Add tier selection + OAuth flow
src/core/ledger.ts                # Add replay() method
src/core/state.ts                 # Add checkpoint/resume
src/core/isolation.ts             # Integrate Rust isolation-engine
src/core/scheduler.ts             # Add backpressure + priority queue
src/core/subagent-manager.ts      # Add cost tracking per agent
src/tui/app.tsx                   # Add Swarm mode + AgentTerminal panel
src/tui/cli.tsx                   # Add intent detection
src/providers/router.ts           # Add registry + tier logic
```

---

## 13. CONCLUSION

Clarity Warp v0.2.0 is not an incremental improvement. It is a **paradigm shift** from "terminal with AI assistance" to "intent-driven swarm orchestrator with terminal as secondary tool." The architecture is designed for extensibility (40+ providers, pluggable terminal adapters, native Rust modules), determinism (EventLedger replay), and cost optimization (context compression, free-tier fallback, real-time cost tracking).

**The invariant remains:** One binary. One command (`clarity warp`). Zero intervention.

**Next action:** Execute Phase 1 (Week 1) stabilization: fix credential bug, implement OAuth, enhance config wizard.
