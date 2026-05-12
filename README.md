# Apohara

Apohara is a local-first multi-agent LLM orchestration framework. It turns natural-language intent into atomic tasks, executes each task inside an isolated git worktree, and merges the result back into the trunk only after verification passes.

## Quick start

```bash
bun install
bun run index.ts
```

## Architecture

Apohara is a TypeScript/Bun orchestrator coupled to two Rust sidecars:

- **apohara-indexer** — code intelligence backed by `redb` for storage and on-device embeddings for semantic search.
- **apohara-sandbox** — task execution sandbox using `seccomp-bpf` to confine agent processes at the syscall level.

The orchestrator plans, dispatches, and verifies; the sidecars handle the heavy and untrusted work.
## Optional: ContextForge GPU Sidecar (M015 local-first path)

When you have a CUDA or ROCm GPU available, Apohara can route inference
through **[Apohara · ContextForge](https://github.com/SuarezPM/Apohara_Context_Forge)** —
a separate Python service that compresses, deduplicates, and reuses KV
context across multi-agent calls. On the published 5-agent benchmark
(DOI [10.5281/zenodo.20114594](https://doi.org/10.5281/zenodo.20114594))
ContextForge delivers **79.85% token savings** end-to-end and pairs
cleanly with a local LLM server (e.g. llama-cpp-python serving
[`kai-os/Carnice-9b-GGUF`](https://huggingface.co/kai-os/Carnice-9b-GGUF))
so dev runs cost **zero cloud tokens**.

The sidecar is **strictly optional**. Apohara works unchanged when
`CONTEXTFORGE_ENABLED` is unset — every ContextForge call is best-effort
and silently falls back to the original context on any failure.

### Quickstart — NVIDIA, no Docker

The shipped `Dockerfile` targets AMD ROCm. On NVIDIA the fastest path is
the native Python venv with the CUDA wheel of PyTorch:

```bash
# 1. Clone the parallel repo
git clone https://github.com/SuarezPM/Apohara_Context_Forge.git ~/Apohara-ContextForge
cd ~/Apohara-ContextForge

# 2. Create the venv (uv is fastest; falls back to python -m venv)
uv venv .venv --python 3.12
source .venv/bin/activate
uv pip install -e .

# 3. Swap the ROCm torch wheel for CUDA 12.4
uv pip install --reinstall --index-url https://download.pytorch.org/whl/cu124 \
  torch torchvision torchaudio

# 4. Copy env defaults and launch on :8001
cp .env.example .env
python -m apohara_context_forge.main
```

Server is ready when the log prints `Uvicorn running on http://0.0.0.0:8001`.

### Quickstart — AMD ROCm, Docker

```bash
git clone https://github.com/SuarezPM/Apohara_Context_Forge.git ~/Apohara-ContextForge
cd ~/Apohara-ContextForge
cp .env.example .env
docker compose up -d
```

The compose file builds against `rocm/dev-ubuntu-22.04:6.1-complete` and
exposes the same `:8001` endpoint.

### Apohara integration

Apohara talks to two GPU sidecars: the LLM server (Carnice or any
OpenAI-compatible endpoint) and ContextForge. Set both env vars before
launching `apohara`:

```bash
# Local LLM server (M015.1) — defaults to http://localhost:8000
export CARNICE_BASE_URL=http://localhost:8000/v1/chat/completions

# ContextForge sidecar (M015.2) — defaults to http://localhost:8001
export CONTEXTFORGE_ENABLED=1
export CONTEXTFORGE_BASE_URL=http://localhost:8001
export CONTEXTFORGE_TIMEOUT_MS=3000   # optional, default 3000ms

apohara auto "implement X"
```

When `CONTEXTFORGE_ENABLED=1`, the router calls `register_context` on
task spawn and `get_optimized_context` before each LLM dispatch. Three
new event types appear in the ledger: `contextforge_registered`,
`contextforge_optimized` (with `tokens_saved`, `savings_pct`,
`strategy`), and `contextforge_unavailable` (deduped at 60 s when the
sidecar is down). The `arbiter_context_compressed` and
`inv15_gate_decision` events from the verification mesh (M015.4) are
emitted independently.

### Verify

```bash
# Carnice LLM server (M015.1)
curl -s http://localhost:8000/v1/models | jq '.data[0].id'

# ContextForge sidecar (M015.2)
curl -s http://localhost:8001/health
curl -s -X POST http://localhost:8001/tools/register_context \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"smoke","context":"hello"}' | jq

# End-to-end via Apohara router (requires both sidecars up)
CONTEXTFORGE_ENABLED=1 bun run src/cli.ts auto "Reply with PING"
```

### Troubleshooting

- **`libcudart.so.12: cannot open shared object file`** — Install the
  CUDA runtime via pip and add it to `LD_LIBRARY_PATH`:
  ```bash
  uv pip install nvidia-cuda-runtime-cu12 nvidia-cublas-cu12
  CUDA_DIR=$(python -c 'import nvidia.cuda_runtime, os; print(os.path.dirname(nvidia.cuda_runtime.__file__) + "/lib")')
  export LD_LIBRARY_PATH=$CUDA_DIR:$LD_LIBRARY_PATH
  ```
- **VRAM out-of-memory loading Carnice-9b** — Drop to the
  `Q4_K_M` quant (5.63 GB) or `Qwen2.5-Coder-3B-Instruct` as a smaller
  fallback. Always launch under a memory-bounded slice so the OOM
  killer cannot reach your terminal:
  ```bash
  systemd-run --user --scope --slice=apohara.slice -p MemoryMax=7G ...
  ```
- **`Address already in use` on :8000 or :8001** — Another process is
  bound. Find it with `ss -tlnp | grep -E ':8000|:8001'` and either
  stop it or set `CARNICE_BASE_URL` / `CONTEXTFORGE_BASE_URL` to a
  different port.
- **`contextforge_unavailable` floods the ledger** — Won't happen: the
  client deduplicates these events at 60 s. If you still see noise,
  check that you're not running multiple Apohara processes against the
  same ledger file.

