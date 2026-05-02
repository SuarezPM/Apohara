# CLARITY WARP OS: CLEAN-ROOM REWRITE MANIFESTO
## Technical Architecture & Legal Strategy for Machine-Assisted Consensus

**Version:** 1.0-draft  
**Date:** 2026-05-01  
**Classification:** Architecture + Legal Strategy Document — Multi-AI Consensus Input  
**Scope:** Complete clean-room rewrite of 6 upstream projects into unified single-binary product  
**Legal Basis:** Google LLC v. Oracle America, Inc. (2021); Sega Enterprises Ltd. v. Accolade, Inc. (1992); Sony Computer Entertainment, Inc. v. Connectix Corp. (2000)

---

## 1. EXECUTIVE THESIS

Clarity Warp OS is not a derivative work of any upstream project. It is a **clean-room reimplementation** that extracts unprotected ideas, algorithms, and architectural patterns from 6 upstream codebases and rewrites them from first principles into a unified, single-binary runtime. The result is legally independent, technically superior, and architecturally unified.

**Core invariant:** No line of code is copied. No file is forked. Every module is written from specification, not from source. The license is ours to choose (MIT).

**Product thesis:** A single binary (`clarity-warp`) that accepts a natural language objective, decomposes it into a DAG of atomic tasks, routes each task to the optimal LLM provider across 40+ options with automatic tier-based fallback, executes in isolated sandboxed worktrees with real-time GPU-accelerated terminal UI, and produces deterministic, replayable, auditable results.

---

## 2. LEGAL FRAMEWORK: CLEAN-ROOM REWRITE DOCTRINE

### 2.1 Protectability Matrix

| Subject Matter | Copyright Protection | Patent Protection | Trade Secret | Status for Clarity Warp |
|---------------|---------------------|-------------------|--------------|------------------------|
| Literal source code | YES — 17 U.S.C. § 102(a) | Possible | Possible | **NOT USED** |
| Structure, Sequence, Organization (SSO) | PARTIAL — circuit split | N/A | N/A | **NOT COPIED** |
| Algorithms, mathematical methods | NO — 17 U.S.C. § 102(b) | Possible | Possible | **FREE TO USE** |
| Functional requirements, APIs | NO — *Google v. Oracle*, 593 U.S. ___ (2021) | N/A | N/A | **FREE TO USE** |
| Ideas, concepts, principles | NO — 17 U.S.C. § 102(b) | N/A | N/A | **FREE TO USE** |
| Clean-room reimplementation | NO — *Sony v. Connectix*, 203 F.3d 596 (9th Cir. 2000) | Must be independently developed | N/A | **OUR PATH** |

### 2.2 Clean-Room Process Specification

**Definition:** A development methodology where access to the original codebase is systematically segregated from the implementation team through an impermeable information barrier.

**Required Process:**

```
PHASE 1: EXTRACTION (Dirty Team — may view original code)
├─ Read original codebase
├─ Document functional behavior ONLY (inputs, outputs, edge cases)
├─ Write architectural specification in pseudocode/plain English
├─ DESTROY all notes containing literal code snippets
└─ OUTPUT: Functional Specification Document (FSD)

PHASE 2: VERIFICATION (Legal review)
├─ Attorney reviews FSD for contamination (literal code, comments, variable names)
├─ FSD is sanitized if necessary
└─ OUTPUT: Certified Clean Specification (CCS)

PHASE 3: IMPLEMENTATION (Clean Team — NEVER views original code)
├─ Receives ONLY the CCS
├─ Implements from CCS using standard engineering knowledge
├─ All code is written de novo
├─ Version control timestamps prove independent development
└─ OUTPUT: Original implementation

PHASE 4: BLACK-BOX VERIFICATION
├─ Test suite validates behavioral equivalence
├─ No code comparison between original and rewrite
├─ Only functional outputs are compared
└─ OUTPUT: Certification of independent derivation
```

### 2.3 Upstream Project Risk Analysis

| Project | License | Risk Level | Clean-Room Strategy | Contamination Mitigation |
|---------|---------|-----------|---------------------|-------------------------|
| **Warp** | MIT / AGPLv3 dual | LOW | Study MIT components. Extract: block-based rendering, PTY multiplexing, GPU pipeline architecture. | Never view AGPL-only modules. Document only MIT-licensed behavior. |
| **GSD2** | MIT | LOW | Fork is explicitly permitted, but we rewrite for architectural independence. Extract: milestone/slice/task hierarchy, state machine transitions, worktree pool pattern. | MIT allows derivative works. We choose rewrite to eliminate coupling. |
| **claw-code** | NONE (leaked/unlicensed) | **CRITICAL** | **DO NOT VIEW SOURCE CODE.** Use ONLY: public GitHub issue descriptions, README summary, third-party security analysis papers. | If public docs insufficient, design 3-tier permission system from first principles using seccomp-bpf, Linux namespaces, and Docker capabilities as reference — NOT claw-code source. |
| **GitNexus** | NOASSERTION | HIGH | **DO NOT VIEW SOURCE CODE.** Use ONLY: repository README, feature descriptions, public demos. | Implement knowledge graph using tree-sitter + petgraph (standard Rust crates). No reference to GitNexus implementation details. |
| **9Router** | MIT | LOW | Extract: provider taxonomy (OAuth/Free/API Key), fallback chain logic, load balancing heuristics. | MIT allows study and rewrite. |
| **LeanCTX** | Apache 2.0 | LOW | Extract: token compression patterns, AST signature abstraction, delta encoding concepts. | Apache 2.0 allows derivative works with attribution. We rewrite and attribute in NOTICE file. |
| **cocoindex** | Apache 2.0 | LOW | Extract: incremental indexing triggers, semantic search pipeline, HNSW vector storage concepts. | Apache 2.0 allows derivative works with attribution. We rewrite and attribute in NOTICE file. |

### 2.4 Legal Protection Measures

1. **Repository Segregation:** Clean-team developers' GitHub accounts must not have starred, forked, or cloned upstream repositories during implementation phase.
2. **Development Environment Isolation:** Clean-team uses separate machines/VMs with no access to upstream code directories.
3. **Documentation Trail:** Every FSD is timestamped and signed. Every CCS is attorney-reviewed. Git commit history proves independent timeline.
4. **NOASSERTION/Leak Avoidance:** For claw-code and GitNexus, the clean team receives NO specification derived from source code. They receive only: "Implement a Linux sandbox with 3 permission levels using seccomp-bpf and namespaces" and standard man pages.

---

## 3. SYSTEM ARCHITECTURE: SINGLE BINARY RUNTIME

### 3.1 Monorepo Structure

```
clarity-warp/
├── Cargo.toml                    # Workspace root
├── package.json                  # Bun/TypeScript core (bundled at build)
├── LICENSE                       # MIT
├── NOTICE                        # Apache 2.0 attributions for ideas
├── LEGAL.md                      # Clean-room process documentation
│
├── crates/
│   ├── clarity-tui/              # GPU-accelerated terminal UI
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs           # Entry point
│   │       ├── renderer/         # wgpu-based block renderer
│   │       ├── pty/              # PTY multiplexing (multiple agents)
│   │       ├── input/            # Keyboard/mouse event handling
│   │       ├── blocks/           # SwarmBlock, DiffBlock, LogBlock
│   │       └── ipc.rs            # IPC with clarity-core
│   │
│   ├── clarity-engine/           # Sandbox & isolation
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── sandbox.rs        # Namespace + cgroup sandbox
│   │       ├── seccomp.rs        # seccomp-bpf policy enforcement
│   │       ├── worktree.rs       # git worktree lifecycle
│   │       └── permissions.rs    # 3-tier permission model
│   │
│   ├── clarity-index/            # Code knowledge graph
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── parser.rs         # tree-sitter AST extraction
│   │       ├── graph.rs          # Dependency graph (petgraph)
│   │       ├── embeddings.rs     # Local ONNX embedding generation
│   │       ├── incremental.rs    # File-watcher reindexing
│   │       └── search.rs         # Vector similarity search (HNSW)
│   │
│   ├── clarity-compress/         # Context compression
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── dedup.rs          # System prompt deduplication
│   │       ├── ast_sig.rs        # AST signature extraction
│   │       ├── delta.rs          # Delta compression vs prior context
│   │       └── estimator.rs      # Token savings measurement
│   │
│   └── clarity-providers/        # LLM provider integrations
│       ├── Cargo.toml
│       └── src/
│           ├── registry.rs       # Provider metadata & capabilities
│           ├── router.rs         # Role-based routing + fallback
│           ├── oauth.rs          # OAuth2 device flow
│           ├── http.rs           # Shared HTTP client (reqwest)
│           ├── tier1/            # OAuth providers
│           ├── tier2/            # Free providers
│           └── tier3/            # API Key providers
│
├── core/                         # Bun/TypeScript orchestrator
│   ├── src/
│   │   ├── main.ts               # Entry point
│   │   ├── decomposer.ts         # LLM → DAG decomposition
│   │   ├── state_machine.ts      # Milestone/slice/task states
│   │   ├── scheduler.ts          # Parallel execution with backpressure
│   │   ├── ledger.ts             # Deterministic event log
│   │   ├── credentials.ts        # Unified auth resolution
│   │   └── ipc.rs                # IPC with Rust TUI
│   └── tests/
│
├── config/
│   ├── providers.json            # 40+ provider definitions
│   └── fallback_chains.json      # Role-based provider priority
│
└── scripts/
    ├── build.sh                  # Cross-platform binary compilation
    └── test-ci.sh                # Full test suite
```

### 3.2 Build Pipeline: Single Binary Output

```
Build Stages:
├─ Stage 1: Compile Rust crates (cargo build --release)
│  ├─ clarity-tui → staticlib (.a)
│  ├─ clarity-engine → staticlib (.a)
│  ├─ clarity-index → staticlib (.a)
│  ├─ clarity-compress → staticlib (.a)
│  └─ clarity-providers → staticlib (.a)
│
├─ Stage 2: Bundle TypeScript core (bun build --target=bun)
│  └─ core/src/ → core/dist/index.js
│
├─ Stage 3: Link final binary
│  └─ Rust main (clarity-tui) links all staticlibs
│  └─ Embeds core/dist/index.js as string literal
│  └─ At runtime, spawns embedded JS via Bun runtime (if available)
│     or falls back to Node.js 22+ via spawn wrapper
│
└─ Output: clarity-warp (macOS/Linux), clarity-warp.exe (Windows)
   Size target: < 50 MB (with UPX compression)
```

**Self-contained invariant:** The binary contains its own Bun/Node runtime dependency check. If neither is present, it downloads a pinned Bun version to `~/.clarity-warp/runtime/` on first run.

---

## 4. COMPONENT SPECIFICATIONS

### 4.1 clarity-tui: GPU-Accelerated Terminal UI

**Specification source:** Warp MIT components — block-based rendering, PTY multiplexing, agent mode UI patterns.
**Implementation:** Clean-room from FSD. wgpu for cross-platform GPU acceleration.

**Architecture:**

```rust
// crates/clarity-tui/src/lib.rs

pub struct TerminalApp {
    renderer: BlockRenderer,        // wgpu pipeline
    pty_manager: PtyManager,        // Multi-PTY controller
    event_loop: EventLoop<UserEvent>,
    ipc_client: IpcClient,          // ←→ clarity-core
    layout: LayoutEngine,
}

pub struct BlockRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    glyph_cache: GlyphCache,        // HarfBuzz + FreeType
    block_pipeline: RenderPipeline,
    surface: wgpu::Surface,
}

pub struct PtyManager {
    ptys: HashMap<AgentId, Pty>,
    active_pty: Option<AgentId>,
    scrollback: ScrollbackBuffer,
}

impl TerminalApp {
    pub async fn new(core_socket: PathBuf) -> Result<Self> {
        let ipc = IpcClient::connect(core_socket).await?;
        let renderer = BlockRenderer::init().await?;
        let pty_manager = PtyManager::new()?;
        Ok(Self { renderer, pty_manager, ipc, layout: LayoutEngine::default() })
    }

    pub fn render_swarm_block(&mut self, block: SwarmBlock) {
        // Render block with:
        // - Agent avatar + status
        // - Progress bar (GPU-computed vertices)
        // - Cost/Token counters
        // - Expandable terminal output
        self.renderer.queue_block(block);
    }
}
```

**Block Types:**

```rust
pub enum BlockType {
    Swarm {              // Swarm execution status
        objective: String,
        progress: f32,
        agents: Vec<AgentSummary>,
        cost_usd: f64,
        elapsed_secs: u64,
    },
    Diff {               // File diff visualization
        path: PathBuf,
        hunks: Vec<DiffHunk>,
        agent_id: AgentId,
    },
    Log {                // Agent terminal output
        agent_id: AgentId,
        lines: Vec<LogLine>,
        exit_code: Option<i32>,
    },
    Command {            // User shell command
        command: String,
        output: String,
        exit_code: i32,
    },
}
```

**Key Design Decisions:**
- **No scrollback in traditional sense:** Blocks are discrete, selectable, filterable units. Users jump between blocks, not scroll.
- **Split panes per agent:** Each active agent gets a PTY pane. Layout engine auto-arranges (2x2 grid for 4 agents, tabs for >4).
- **Vim keybindings by default:** Modal editing for block navigation (`j/k` between blocks, `Enter` to expand, `q` to collapse).

### 4.2 clarity-engine: Sandbox & Isolation

**Specification source:** Linux kernel namespaces, seccomp-bpf, cgroup v2. Independent design (NO claw-code reference).
**Implementation:** Rust with `nix` crate for syscalls, `libseccomp` for BPF filters.

**3-Tier Permission Model:**

```rust
pub enum PermissionTier {
    /// Read-only filesystem access. Can read source code, cannot modify.
    /// Network: DENIED. System calls: restricted to read-only set.
    ReadOnly,

    /// Can modify files within assigned worktree. Cannot access system paths.
    /// Network: DENIED. Commands: allow-listed (git, bun, node, npm).
    WorkspaceWrite,

    /// Full access within worktree. Network allowed for specific endpoints.
    /// Commands: expanded allow-list. System paths: still blocked.
    /// Requires explicit user approval for DangerFullAccess tasks.
    DangerFullAccess,
}

pub struct SandboxConfig {
    pub tier: PermissionTier,
    pub worktree: PathBuf,
    pub allowed_commands: Vec<String>,
    pub blocked_paths: Vec<PathBuf>,
    pub network_policy: NetworkPolicy,
    pub resource_limits: ResourceLimits,
}

pub struct NetworkPolicy {
    pub mode: NetworkMode,  // Denied | LoopbackOnly | Whitelist(Vec<String>)
    pub dns_allowed: bool,
}

pub struct ResourceLimits {
    pub max_cpu_percent: f64,
    pub max_memory_mb: u64,
    pub max_file_size_mb: u64,
    pub max_execution_secs: u64,
}
```

**Sandbox Implementation:**

```rust
impl Sandbox {
    pub fn enter(config: &SandboxConfig) -> Result<(), SandboxError> {
        // 1. Unshare namespaces
        unshare(CloneFlags::CLONE_NEWNS | CloneFlags::CLONE_NEWPID |
                CloneFlags::CLONE_NEWNET | CloneFlags::CLONE_NEWUSER)?;

        // 2. Mount worktree as new root (pivot_root or chroot)
        self.setup_rootfs(&config.worktree)?;

        // 3. Apply seccomp-bpf filter
        let mut ctx = SeccompFilterContext::new(ScmpAct::Allow)?;
        self.block_dangerous_syscalls(&mut ctx)?;
        ctx.load()?;

        // 4. Apply cgroup v2 limits
        self.apply_cgroup_limits(&config.resource_limits)?;

        // 5. Drop capabilities
        self.drop_capabilities()?;

        Ok(())
    }

    fn block_dangerous_syscalls(&self, ctx: &mut SeccompFilterContext) {
        // Block: execveat, ptrace, mount, umount2, reboot, open_by_handle_at
        // Allow: read, write, open, close, exit, brk, mmap, clone (limited)
        for syscall in DANGEROUS_SYSCALLS {
            ctx.add_rule(ScmpAct::Errno(EPERM), syscall)?;
        }
    }
}
```

### 4.3 clarity-index: Knowledge Graph

**Specification source:** tree-sitter documentation, graph theory, vector search literature. Independent design (NO GitNexus reference).
**Implementation:** tree-sitter parsers, petgraph for graph structure, ONNX Runtime for local embeddings, HNSW for vector search.

```rust
pub struct CodeIndex {
    graph: Graph<NodeId, EdgeType>,
    embeddings: HnswIndex<Embedding>,
    parser_pool: ParserPool,
    incremental: IncrementalUpdater,
}

pub enum NodeType {
    Function { name: String, signature: String },
    Struct { name: String, fields: Vec<String> },
    Trait { name: String, methods: Vec<String> },
    Module { path: PathBuf },
    Import { source: String, target: String },
}

pub enum EdgeType {
    Calls,
    Implements,
    Imports,
    Contains,
    DependsOn,
}

impl CodeIndex {
    pub fn index_repository(&mut self, repo: &Path) -> Result<IndexStats> {
        let files = self.discover_source_files(repo)?;
        
        for file in files {
            let ast = self.parse_file(&file)?;
            let nodes = self.extract_nodes(&ast, &file)?;
            let edges = self.extract_edges(&ast, &nodes)?;
            
            for node in nodes {
                let embedding = self.embed(&node)?;
                self.graph.add_node(node);
                self.embeddings.add(embedding)?;
            }
            
            for edge in edges {
                self.graph.add_edge(edge.source, edge.target, edge.kind)?;
            }
        }
        
        Ok(IndexStats { files, nodes, edges })
    }

    pub fn blast_radius(&self, files: &[PathBuf]) -> Vec<PathBuf> {
        // BFS from changed files through dependency edges
        // Returns transitive closure of affected files
        let mut visited = HashSet::new();
        let mut queue = VecDeque::from(files.to_vec());
        
        while let Some(file) = queue.pop_front() {
            if visited.insert(file.clone()) {
                let dependents = self.graph.neighbors(file);
                queue.extend(dependents);
            }
        }
        
        visited.into_iter().collect()
    }

    pub fn semantic_search(&self, query: &str, top_k: usize) -> Vec<SearchResult> {
        let query_embedding = self.embed_text(query)?;
        self.embeddings.search(&query_embedding, top_k)
    }
}
```

### 4.4 clarity-compress: Context Compression

**Specification source:** Information theory, delta encoding, AST abstraction. Independent design (NO LeanCTX reference).
**Implementation:** Rust. Deduplication via rolling hash, AST signatures via tree-sitter.

```rust
pub struct ContextCompressor {
    ast_cache: LruCache<PathBuf, AstSignature>,
    system_prompt_hash: u64,
}

pub struct CompressedContext {
    pub system_prompt: Option<String>,  // None if unchanged
    pub file_deltas: Vec<FileDelta>,
    pub ast_signatures: Vec<AstSignature>,
    pub estimated_tokens_saved: usize,
}

impl ContextCompressor {
    pub fn compress(&mut self, request: &LlmRequest) -> CompressedContext {
        // 1. Deduplicate system prompt
        let system = if self.system_prompt_changed(&request.system) {
            self.system_prompt_hash = hash(&request.system);
            Some(request.system.clone())
        } else {
            None
        };

        // 2. Convert files to deltas or AST signatures
        let mut deltas = vec![];
        let mut signatures = vec![];
        
        for file in &request.context_files {
            if let Some(sig) = self.to_ast_signature(file) {
                signatures.push(sig);
            } else {
                deltas.push(self.compute_delta(file));
            }
        }

        CompressedContext {
            system_prompt: system,
            file_deltas: deltas,
            ast_signatures: signatures,
            estimated_tokens_saved: self.estimate_savings(request),
        }
    }

    fn to_ast_signature(&mut self, file: &Path) -> Option<AstSignature> {
        let ast = self.parse(file).ok()?;
        Some(AstSignature {
            path: file.to_path_buf(),
            functions: extract_function_sigs(&ast),
            types: extract_type_sigs(&ast),
            imports: extract_imports(&ast),
        })
    }
}
```

**Expected Performance:**
- Token reduction: 20-40% for typical codebase contexts
- Latency: < 5ms per request (Rust native)
- AST signature extraction: Supports TypeScript, Rust, Python, Go, Java

### 4.5 clarity-providers: 40+ Provider Registry

**Specification source:** HTTP API documentation, OAuth 2.0 RFC 6749, OpenAI API spec. Independent design (NO 9Router reference).
**Implementation:** Rust with `reqwest`, `tokio`, async trait abstractions.

```rust
#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn tier(&self) -> ProviderTier;
    fn models(&self) -> Vec<ModelInfo>;
    fn rate_limits(&self) -> RateLimits;
    
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse>;
    async fn stream(&self, request: CompletionRequest) -> Result<BoxStream<StreamChunk>>;
    async fn health_check(&self) -> Result<HealthStatus>;
}

pub enum ProviderTier {
    OAuth { authorize_url: String, token_url: String, device_code_url: String },
    ApiKey { env_var: String },
    Free { requires_auth: bool },
}

pub struct ProviderRegistry {
    providers: HashMap<String, Box<dyn LlmProvider>>,
    fallback_chains: HashMap<AgentRole, Vec<String>>,
    credentials: CredentialResolver,
}

impl ProviderRegistry {
    pub async fn route(&self, task: &Task) -> Result<Box<dyn LlmProvider>, ProviderError> {
        let chain = self.fallback_chains.get(&task.role)
            .ok_or(ProviderError::NoChainForRole)?;
        
        for provider_id in chain {
            let provider = self.providers.get(provider_id)
                .ok_or(ProviderError::UnknownProvider)?;
            
            // Check credentials
            if let ProviderTier::ApiKey { env_var } | ProviderTier::OAuth { .. } = provider.tier() {
                if !self.credentials.has(provider_id).await {
                    continue;
                }
            }
            
            // Check rate limits
            if self.is_rate_limited(provider_id).await {
                continue;
            }
            
            // Health check
            match provider.health_check().await {
                Ok(HealthStatus::Healthy) => return Ok(provider),
                _ => continue,
            }
        }
        
        Err(ProviderError::Exhausted)
    }
}
```

**Provider List (v0.2.0 MVP):**

| ID | Name | Tier | Models | Rate Limit |
|----|------|------|--------|------------|
| `opencode-go` | OpenCode Go | API Key | opencode-go, opencode-go-mini | 60 RPM |
| `deepseek` | DeepSeek | API Key | deepseek-chat, deepseek-coder | 60 RPM |
| `groq` | Groq | Free Tier | llama4, qwen3 | 30 RPM |
| `kiro-ai` | Kiro AI | Free (no auth) | claude-sonnet, deepseek-chat, qwen-72b | 30 RPM |
| `qwen-code` | Qwen Code | Free Tier | qwen3-coder | 30 RPM |
| `iflow-ai` | iFlow AI | Free (no auth) | 8 models | Unlimited |
| `openrouter` | OpenRouter | Free Tier | 400+ models | 20 RPM |
| `anthropic` | Anthropic | OAuth | claude-sonnet-4, claude-haiku-4 | 4000 RPM |
| `google` | Google | OAuth | gemini-2.5-pro | 360 RPM |

---

## 5. ORCHESTRATOR: TypeScript Core

The TypeScript core (`core/`) remains the orchestration brain, communicating with Rust modules via IPC. It handles: LLM decomposition, state machine, scheduling, ledger, and credential resolution.

### 5.1 Task Decomposition Pipeline

```typescript
// core/src/decomposer.ts

interface Task {
  id: string;
  description: string;
  role: AgentRole;           // 'research' | 'plan' | 'execute' | 'verify'
  complexity: 'low' | 'medium' | 'high';
  dependencies: string[];     // Task IDs that must complete first
  estimated_tokens: number;
  files: string[];            // Assigned by code-indexer blast_radius
}

class TaskDecomposer {
  async decompose(objective: string): Promise<Task[]> {
    // 1. Query code-indexer for relevant files
    const context = await this.indexer.semanticSearch(objective);
    
    // 2. Build prompt with file context
    const prompt = this.buildDecompositionPrompt(objective, context);
    
    // 3. Call planning provider (highest quality tier)
    const response = await this.providers.route('plan', prompt);
    
    // 4. Parse JSON DAG
    const dag = this.parseDag(response);
    
    // 5. Validate dependencies (no cycles, all IDs valid)
    this.validateDag(dag);
    
    // 6. Assign files via blast_radius
    for (const task of dag) {
      task.files = await this.indexer.blastRadius(task.files);
    }
    
    return dag;
  }
}
```

### 5.2 State Machine

```typescript
// core/src/state_machine.ts

type State = 'idle' | 'decomposing' | 'scheduling' | 'executing' 
           | 'verifying' | 'completed' | 'failed' | 'paused';

interface Checkpoint {
  timestamp: string;
  state: State;
  tasks: Map<string, TaskState>;
  ledgerOffset: number;
}

class StateMachine {
  private state: State = 'idle';
  private checkpoints: Checkpoint[] = [];
  
  async transition(to: State): Promise<void> {
    const checkpoint = this.createCheckpoint();
    await this.persist(checkpoint);
    this.state = to;
  }
  
  async resume(): Promise<void> {
    const last = await this.loadLastCheckpoint();
    if (last) {
      this.state = last.state;
      this.tasks = last.tasks;
      this.ledger.seek(last.ledgerOffset);
    }
  }
  
  private async persist(cp: Checkpoint): Promise<void> {
    // Atomic write: tmp file + rename
    const tmp = `.clarity/checkpoints/${cp.timestamp}.tmp`;
    const final = `.clarity/checkpoints/${cp.timestamp}.json`;
    await Bun.write(tmp, JSON.stringify(cp));
    await fs.rename(tmp, final);
  }
}
```

### 5.3 Event Ledger & Deterministic Replay

```typescript
// core/src/ledger.ts

interface LedgerEntry {
  run_id: string;
  timestamp: string;
  sequence: number;
  task_id: string;
  agent_id: string;
  provider: string;
  model: string;
  action: 'start' | 'complete' | 'error' | 'fallback';
  input_hash: string;      // SHA-256 of normalized input
  output_hash?: string;    // SHA-256 of normalized output
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_ms: number;
  worktree: string;
  git_commit: string;
}

class EventLedger {
  private writer: ReturnType<typeof Bun.file().writer>;
  
  async append(entry: LedgerEntry): Promise<void> {
    await this.writer.write(JSON.stringify(entry) + '\n');
    await this.writer.flush();
  }
  
  async replay(
    runId: string, 
    options: { providerOverride?: string; compare?: boolean }
  ): Promise<ReplayReport> {
    const entries = await this.loadRun(runId);
    const report: ReplayReport = { tasks: [], total_cost: 0, regressions: [] };
    
    for (const entry of entries) {
      const provider = options.providerOverride || entry.provider;
      const result = await this.executeReplay(entry, provider);
      
      report.tasks.push({
        task_id: entry.task_id,
        original_provider: entry.provider,
        replay_provider: provider,
        original_output_hash: entry.output_hash,
        replay_output_hash: result.hash,
        diff: result.diff,
        cost: result.cost,
      });
      
      report.total_cost += result.cost;
      
      if (options.compare && result.hash !== entry.output_hash) {
        report.regressions.push(entry.task_id);
      }
    }
    
    return report;
  }
}
```

---

## 6. IMPLEMENTATION ROADMAP

### Phase 1: MVP "Clarity Swarm" (Days 1-14)

**Objective:** Demonstrate multi-agent swarm with automatic provider fallback, rendered in a functional TUI, with cost tracking. No GPU renderer yet (uses Ratatui). No sandbox yet (uses git worktree only).

| Day | Component | Deliverable | Files | LOC |
|-----|-----------|-------------|-------|-----|
| 1 | ProviderRegistry + 5 free providers | `clarity-providers/` crate | `registry.rs`, `router.rs`, `tier2/*.rs` | 800 |
| 2 | OAuth + API Key auth flows | `oauth.rs`, `credentials.rs` | `oauth.rs`, `credentials.rs` | 400 |
| 3 | Auto-fallback chain (4 tiers) | `router.rs` fallback logic | `router.rs`, `fallback.rs` | 300 |
| 4 | TaskDecomposer (Bun/TS) | `core/src/decomposer.ts` | `decomposer.ts`, `prompts/` | 600 |
| 5 | StateMachine + checkpoints | `core/src/state_machine.ts` | `state_machine.ts` | 400 |
| 6 | ParallelScheduler + worktree pool | `core/src/scheduler.ts` | `scheduler.ts`, `pool.ts` | 500 |
| 7 | EventLedger + replay command | `core/src/ledger.ts` | `ledger.ts`, `commands/replay.ts` | 400 |
| 8 | Ratatui dashboard (basic) | `crates/clarity-tui/` | `main.rs`, `ui.rs`, `blocks.rs` | 600 |
| 9 | IPC bridge (Unix socket) | `ipc.rs` (both sides) | `crates/*/src/ipc.rs`, `core/src/ipc.ts` | 500 |
| 10 | Integration: TUI ↔ Core | End-to-end swarm test | `tests/e2e/swarm.rs` | 300 |
| 11 | Cost tracking + dashboard | Real-time cost per agent | `core/src/cost.ts`, `ui/cost.rs` | 400 |
| 12 | Config wizard (enhanced) | Provider setup, tier selection | `core/src/wizard.ts` | 500 |
| 13 | E2E tests (full pipeline) | CI passing | `tests/e2e/*.ts`, `tests/e2e/*.rs` | 600 |
| 14 | Release v0.2.0 | Tagged release, binaries | `scripts/release.sh` | 200 |

**Phase 1 Output:** `clarity-warp` binary. Swarm execution with 5 free providers. Ratatui UI. Deterministic replay. Cost tracking.

### Phase 2: "Clarity Warp OS" (Months 2-6)

**Objective:** Replace Ratatui with custom GPU renderer. Add sandboxing. Add code indexing. Add context compression.

| Month | Component | Deliverable | Stack |
|-------|-----------|-------------|-------|
| 2 | clarity-tui v2 | Custom wgpu block renderer, 60fps, Vim modal | Rust |
| 3 | clarity-engine | Namespace sandbox, seccomp-bpf, cgroup limits | Rust |
| 4 | clarity-index | tree-sitter AST, dependency graph, local embeddings | Rust |
| 5 | clarity-compress | Delta compression, AST signatures, 20-40% savings | Rust |
| 6 | Integration + polish | Single binary < 50MB, cross-platform CI, benchmarks | Rust + TS |

**Phase 2 Output:** `clarity-warp` v1.0. GPU-accelerated. Sandboxed. Indexed. Compressed. Single binary.

---

## 7. FINANCIAL & RESOURCE PLAN

### 7.1 Zero-Capital Path (Current)

| Resource | Cost | Duration | Notes |
|----------|------|----------|-------|
| Claude Code | $20/mo (existing) | Until 2026-05-04 | 3 days remaining |
| OpenCode Go | $10/mo (existing) | Unlimited | Primary engine post-May 4 |
| Gemini 3.1 Pro | $10/mo (existing) | Unlimited | Architecture review |
| Perplexity Pro | $10/mo (existing) | Unlimited | Research |
| **Total** | **~$50/mo** | **Ongoing** | **Sufficient for MVP** |

### 7.2 Accelerated Path (With Capital Injection)

| Investment | Amount | Impact | ROI |
|------------|--------|--------|-----|
| API credits (testing 40+ providers) | $500 | Real E2E provider validation | Prevents shipping broken integrations |
| CI/CD infrastructure (GitHub Actions) | $200/mo | Cross-platform builds (macOS ARM/x86, Linux ARM/x86, Windows) | Distribution readiness |
| Rust senior developer (freelance, 3mo) | $8,000 | GPU renderer + sandboxing (human handles `unsafe` and `wgpu`) | 2x velocity on critical modules |
| Legal review (IP attorney, 2hrs) | $800 | Clean-room process certification | Risk mitigation |
| **Total (6 months)** | **~$10,000** | **v1.0 in 3 months instead of 6** | **First-mover advantage** |

---

## 8. COMPETITIVE POSITIONING MATRIX

| Dimension | Clarity Warp OS | Claude Code | OpenCode | Warp Agent | Cursor |
|-----------|-----------------|-------------|----------|------------|--------|
| **License** | MIT (fully permissive) | Proprietary | MIT | MIT/AGPL | Proprietary |
| **Single Binary** | Yes (< 50MB) | No (requires Node) | No (requires Node) | No (electron) | No (IDE extension) |
| **Multi-Agent Swarm** | Yes (5 concurrent) | No | No | No | No |
| **Provider Count** | 40+ (3 tiers) | 1 (Anthropic) | 10+ | 5+ | 5+ |
| **Auto-Fallback** | 4-tier with cost optimization | None | None | None | None |
| **Free Tier Strategy** | First-class (8 providers) | None | Limited | Limited | Limited |
| **Sandboxing** | seccomp + namespaces + cgroups | None | None | None | None |
| **Deterministic Replay** | Yes (EventLedger) | No | No | No | No |
| **Context Compression** | 20-40% token reduction | No | No | No | No |
| **Code Knowledge Graph** | Local embeddings + HNSW | No | No | No | No |
| **GPU-Accelerated UI** | Yes (wgpu) | No | No | Yes (but not for agents) | No |
| **Cost Transparency** | Real-time per task | Opaque | Opaque | Opaque | Opaque |
| **Clean-Room** | Yes (legally independent) | N/A | N/A | N/A | N/A |

---

## 9. RISK ANALYSIS & MITIGATION

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Clean-room contamination (claw-code/GitNexus) | Medium | **Legal catastrophe** | Strict barrier: dirty team writes FSD, clean team implements from FSD only. Attorney reviews all FSDs. |
| GPU renderer complexity exceeds timeline | High | Delay 2-3 months | MVP uses Ratatui. GPU is Phase 2. Product works without it. |
| Free providers change terms/shut down | Medium | Feature degradation | 8 free providers, not 1. Auto-fallback to paid tier. Hot-reloadable config. |
| Rust module compilation failures (Windows) | Medium | Platform gap | CI matrix from Day 1. Cross-compilation testing. Precompiled binaries. |
| State machine corruption on crash | Low | Data loss | Atomic writes (tmp + rename). Checkpoints every transition. EventLedger append-only. |
| Token compression degrades output quality | Medium | Bad LLM responses | A/B testing via replay. Rollback threshold: 95% accuracy. |
| OAuth provider API changes | Medium | Auth breakage | Abstraction layer isolates provider specifics. Health checks detect breakage. |

---

## 10. SUCCESS METRICS & VALIDATION

| Metric | MVP Target (v0.2.0) | v1.0 Target | Measurement Method |
|--------|---------------------|-------------|-------------------|
| Time to first swarm | < 30s | < 10s | `time clarity-warp "test objective"` |
| Provider fallback latency | < 2s | < 500ms | EventLedger timestamp diff |
| Free-tier task completion | > 70% | > 85% | % of tasks using only Tier 2 providers |
| Token cost reduction | N/A | 20-40% | Replay with/without compression |
| Sandbox escape attempts blocked | N/A | 100% | `tests/e2e/security_escape.rs` |
| Deterministic replay accuracy | > 90% | > 95% | Same input → output hash match |
| Binary size | < 20 MB | < 50 MB | `ls -lh clarity-warp` |
| Cross-platform builds | macOS/Linux | +Windows | CI artifact matrix |
| Swarm success rate (no human) | > 75% | > 90% | E2E test suite pass rate |

---

## 11. GLOSSARY OF TERMS

| Term | Definition |
|------|------------|
| **Clean-Room Rewrite** | Development process where implementation team has no access to original source code, working exclusively from functional specifications. |
| **FSD** | Functional Specification Document — describes WHAT a system does, not HOW it is implemented. |
| **CCS** | Certified Clean Specification — attorney-reviewed FSD with contamination removed. |
| **Swarm** | Coordinated group of specialized LLM agents executing a decomposed objective in parallel. |
| **DAG** | Directed Acyclic Graph — task dependency structure ensuring no circular dependencies. |
| **Worktree** | Git worktree — isolated filesystem checkout for parallel agent execution. |
| **seccomp-bpf** | Linux kernel feature for filtering system calls using Berkeley Packet Filter programs. |
| **Namespace Sandbox** | Linux kernel isolation using PID, mount, network, and user namespaces. |
| **EventLedger** | Append-only JSONL log enabling deterministic replay and audit trails. |
| **Blast Radius** | Transitive closure of file dependencies — all files affected by a change. |
| **HNSW** | Hierarchical Navigable Small World — approximate nearest neighbor search algorithm for vector similarity. |
| **AST Signature** | Abstract Syntax Tree abstraction replacing literal code with structural description (function names, types, signatures). |
| **TerminalAdapter** | Interface pattern abstracting rendering backends (Ratatui, wgpu, VS Code, Web). |
| **Vibecoding** | Development paradigm where natural language intent → working code without manual command authoring. |
| **Tier Fallback** | Automatic provider substitution when primary fails (OAuth → API Key → Free → Local). |

---

## 12. CONCLUSION

Clarity Warp OS is a clean-room reimplementation of the best ideas in agentic development tools, unified into a single binary with MIT licensing. Every module is written from specification, not from source. Every dependency is either standard library, permissively licensed crate, or original code.

**The legal strategy is defensible:** Precedent supports independent reimplementation of functional ideas. The process is documented. The barrier is enforced.

**The technical strategy is sound:** MVP in 14 days proves the swarm model. Phase 2 adds GPU rendering, sandboxing, and indexing. The result is a product, not a prototype.

**The business strategy is differentiated:** First fully open-source, single-binary, multi-agent swarm orchestrator with automatic cost optimization and deterministic replay.

**The invariant remains:** One binary. One command. Zero intervention.

**Next action:** Execute Phase 1, Day 1 — begin clean-room extraction of Warp MIT components into FSD for `clarity-tui` architecture.
