# External Integrations

> Last mapped: 2026-05-07

## LLM Providers

Apohara integrates with **20+ LLM providers** via a unified `ProviderRouter` (`src/providers/router.ts`). Each provider has a dedicated `callXxx()` method.

### Provider Registry

| Provider ID | Name | API Format | Auth | Tier |
|-------------|------|------------|------|------|
| `anthropic-api` | Anthropic Claude | Anthropic Messages API | `sk-ant-api03-*` | premium |
| `gemini-api` | Google AI Studio | Gemini generateContent | `x-goog-api-key` | premium |
| `opencode-go` | OpenCode Go | Anthropic Messages API | API key | premium |
| `deepseek-v4` | DeepSeek V4 Pro/Flash | OpenAI-compatible | API key | premium |
| `deepseek` | DeepSeek Coder | OpenAI-compatible | API key | premium |
| `groq` | Groq | OpenAI-compatible | API key | premium |
| `moonshot-k2.5` | Kimi K2.5 | OpenAI-compatible | API key | premium |
| `moonshot-k2.6` | Kimi K2.6 | OpenAI-compatible | API key | premium |
| `qwen3.5-plus` | Qwen 3.5 Plus | OpenAI-compatible | API key | premium |
| `qwen3.6-plus` | Qwen 3.6 Plus | OpenAI-compatible | API key | premium |
| `minimax-m2.5` | MiniMax M2.5 | OpenAI-compatible | API key | premium |
| `minimax-m2.7` | MiniMax M2.7 | OpenAI-compatible | API key | premium |
| `xiaomi-mimo` | Xiaomi MiMo V2 | OpenAI-compatible | API key | premium |
| `glm-deepinfra` | GLM-5 via DeepInfra | OpenAI-compatible | API key | premium |
| `glm-fireworks` | GLM-5 via Fireworks | OpenAI-compatible | API key | premium |
| `glm-zai` | GLM-5 via Z.ai | OpenAI-compatible | API key | premium |
| `kiro-ai` | Kiro AI | OpenAI-compatible | **None** (free) | free |
| `mistral` | Mistral AI | OpenAI-compatible | API key | free |
| `openai` | OpenAI GPT-4o Mini | OpenAI-compatible | API key | premium |
| `tavily` | Tavily Search | REST API | API key | research |
| `gemini` | Gemini 2.0 Flash | Gemini generateContent | API key | legacy |

### Authentication

- **API Keys**: Resolved via `src/core/credentials.ts` → `resolveCredential(provider)`
  - Checks env vars first, then `~/.apohara/credentials.json`
- **OAuth (PKCE)**: `src/lib/oauth-pkce.ts` — used for Gemini OAuth flow
  - Token storage: `src/lib/oauth-token-store.ts`
  - Google OAuth: `src/lib/oauth/gemini.ts`
- **Config wizard**: `src/commands/config.ts` — interactive CLI for setting API keys

### Provider Configuration

Static provider config in `config/providers.json`:
- Base URLs, models, cost per 1K tokens
- Rate limits (RPM/TPM)
- Capability scores per task type (0.0–1.0)
- Fallback chains per role

## Web Search

| Service | Client | Purpose |
|---------|--------|---------|
| **Tavily** | `ProviderRouter.callTavily()` | Real-time web search for AI research tasks |

Tavily replaces Perplexity as the research provider. Dedicated `research` role in `ROLE_TO_PROVIDER`.

## Memory / Knowledge Systems

| Service | Client | File |
|---------|--------|------|
| **Mem0** | `Mem0Client` | `src/lib/mem0-client.ts` |
| **Indexer (local)** | `IndexerClient` | `src/core/indexer-client.ts` |

### Mem0 Integration
- Stores task decisions, coding patterns
- Retrieves relevant memories for task context
- Optional (`isConfigured()` check)

### Apohara Indexer (local daemon)
- Runs as Unix socket server (`/tmp/apohara-indexer.sock`)
- JSON-RPC protocol over Unix socket
- Provides: `embed`, `search`, `indexFile`, `getBlastRadius`, `getFileSignatures`, `storeMemory`, `searchMemory`
- Auto-spawns daemon if not running
- Auto-shutdown after inactivity (configurable, default 55s)

## Workflow Orchestration

| Service | Client | File |
|---------|--------|------|
| **Inngest** | `InngestClient` | `src/lib/inngest-client.ts` |

- Event dispatch for durable workflow steps
- Step function retry with configurable attempts
- Optional integration (`isConfigured()` check)

## GitHub Integration

| Feature | Client | File |
|---------|--------|------|
| **GitHub API** | `GitHubClient` | `src/providers/github.ts` |

- Repository detection from git remote
- PR creation after task completion
- User authentication
- Event logging for all API calls

## MCP (Model Context Protocol)

| Feature | Client | File |
|---------|--------|------|
| **MCP Bridge** | `MCPClient` / `MCPRegistry` | `src/lib/mcp-client.ts` |

- JSON-RPC over stdio to MCP servers
- Tool discovery (`listTools`) and invocation (`callTool`)
- Multi-server registry with tool routing
- Used in decomposer to enhance tasks with MCP context

## Database (Local)

| System | Library | Purpose |
|--------|---------|---------|
| **redb** | `redb 2.2` | Embedded KV store for indexer (nodes, index state, memories) |

- Path: `~/.apohara/indexer.redb` (default)
- Tables: `NODES_TABLE`, `INDEX_STATE_TABLE`, `MEMORIES_TABLE`
- Cosine similarity search on embeddings

## ML Models (Local)

| Model | Framework | Purpose |
|-------|-----------|---------|
| **nomic-embed-text-v1.5** | Candle (Rust) | Local text embeddings |

- Downloaded via `hf-hub` from HuggingFace
- Inference via `candle-transformers`
- 768-dimension vectors
- No external API calls — fully local
