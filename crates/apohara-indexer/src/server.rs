//! JSON-RPC Unix Domain Socket server for the indexer
//!
//! Provides a JSON-RPC 2.0 interface over Unix Domain Socket with auto-shutdown
//! after 30 minutes of inactivity.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::Mutex;

use crate::dependency::DependencyGraph;
use crate::indexer::Indexer;

/// Default socket path
pub const DEFAULT_SOCKET_PATH: &str = ".apohara/indexer.sock";

/// Default inactivity timeout in seconds (30 minutes)
pub const DEFAULT_INACTIVITY_TIMEOUT_SECS: u64 = 30 * 60;

/// Get inactivity timeout from environment variable or default
pub fn get_inactivity_timeout() -> Duration {
    std::env::var("APOHARA_INACTIVITY_TIMEOUT")
        .ok()
        .and_then(|v| v.parse().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(DEFAULT_INACTIVITY_TIMEOUT_SECS))
}

/// JSON-RPC request
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    method: String,
    params: Option<serde_json::Value>,
    id: serde_json::Value,
}

/// JSON-RPC response
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
    id: serde_json::Value,
}

/// JSON-RPC error
#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    data: Option<serde_json::Value>,
}

impl JsonRpcError {
    fn parse_error() -> Self {
        Self {
            code: -32700,
            message: "Parse error".to_string(),
            data: None,
        }
    }

    fn method_not_found() -> Self {
        Self {
            code: -32601,
            message: "Method not found".to_string(),
            data: None,
        }
    }

    fn invalid_params(msg: &str) -> Self {
        Self {
            code: -32602,
            message: format!("Invalid params: {}", msg),
            data: None,
        }
    }

    fn internal_error(msg: &str) -> Self {
        Self {
            code: -32603,
            message: format!("Internal error: {}", msg),
            data: None,
        }
    }
}

/// Server state
pub struct Server {
    indexer: Arc<Indexer>,
    dependency_graph: Arc<Mutex<DependencyGraph>>,
    socket_path: PathBuf,
    inactivity_timeout: Duration,
    last_activity: Arc<Mutex<Instant>>,
    shutdown_flag: Arc<AtomicBool>,
}

impl Server {
    /// Create a new server with the given indexer
    pub fn new(indexer: Indexer) -> Self {
        Self {
            indexer: Arc::new(indexer),
            dependency_graph: Arc::new(Mutex::new(DependencyGraph::new())),
            socket_path: PathBuf::from(DEFAULT_SOCKET_PATH),
            inactivity_timeout: get_inactivity_timeout(),
            last_activity: Arc::new(Mutex::new(Instant::now())),
            shutdown_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Set the socket path
    pub fn with_socket_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.socket_path = path.into();
        self
    }

    /// Set the inactivity timeout
    pub fn with_inactivity_timeout(mut self, secs: u64) -> Self {
        self.inactivity_timeout = Duration::from_secs(secs);
        self
    }

    /// Run the server
    pub async fn run(&self) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = self.socket_path.parent() {
            std::fs::create_dir_all(parent)
                .context("Failed to create socket directory")?;
        }

        // Remove existing socket file if present
        if self.socket_path.exists() {
            tracing::info!("Removing existing socket file: {:?}", self.socket_path);
            std::fs::remove_file(&self.socket_path)?;
        }

        // Create Unix socket
        let listener = UnixListener::bind(&self.socket_path)
            .context("Failed to bind Unix socket")?;

        tracing::info!("JSON-RPC server listening on {:?}", self.socket_path);

        // Spawn inactivity monitor
        let last_activity = self.last_activity.clone();
        let inactivity_timeout = self.inactivity_timeout;
        let shutdown_flag = self.shutdown_flag.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                let last = *last_activity.lock().await;
                if last.elapsed() > inactivity_timeout {
                    tracing::info!(
                        "No activity for {} seconds, initiating shutdown",
                        inactivity_timeout.as_secs()
                    );
                    shutdown_flag.store(true, Ordering::SeqCst);
                    break;
                }
            }
        });

        // Accept connections in a loop
        loop {
            tokio::select! {
                result = listener.accept() => {
                    if self.shutdown_flag.load(Ordering::SeqCst) {
                        tracing::info!("Server shutting down (inactivity timeout)");
                        break;
                    }

                    match result {
                        Ok((stream, _addr)) => {
                            tracing::debug!("New client connected");
                            let indexer = self.indexer.clone();
                            let dep_graph = self.dependency_graph.clone();
                            let last_activity = self.last_activity.clone();

                            tokio::spawn(async move {
                                if let Err(e) = Self::handle_connection(stream, indexer, dep_graph, last_activity).await {
                                    tracing::error!("Error handling connection: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("Failed to accept connection: {}", e);
                        }
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                    // Periodically check shutdown flag even when not accepting
                    if self.shutdown_flag.load(Ordering::SeqCst) {
                        tracing::info!("Server shutting down (shutdown flag set)");
                        break;
                    }
                }
            }
        }

        // Clean up socket file
        if self.socket_path.exists() {
            std::fs::remove_file(&self.socket_path)?;
            tracing::info!("Removed socket file: {:?}", self.socket_path);
        }

        Ok(())
    }

    /// Handle a single client connection
    async fn handle_connection(
        mut stream: tokio::net::UnixStream,
        indexer: Arc<Indexer>,
        dep_graph: Arc<Mutex<DependencyGraph>>,
        last_activity: Arc<Mutex<Instant>>,
    ) -> Result<()> {
        let (reader, mut writer) = stream.split();
        let mut reader = BufReader::new(reader);
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    // EOF - client disconnected
                    tracing::debug!("Client disconnected");
                    break;
                }
                Ok(_) => {
                    // Update last activity
                    {
                        let mut last = last_activity.lock().await;
                        *last = Instant::now();
                    }

                    // Parse and handle request
                    let response = self::handle_request(&line, &indexer, &dep_graph).await;
                    let response_json = serde_json::to_string(&response)?;
                    writer.write_all(response_json.as_bytes()).await?;
                    writer.write_all(b"\n").await?;
                    writer.flush().await?;
                }
                Err(e) => {
                    tracing::error!("Read error: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    /// Send a shutdown signal to the server
    pub fn shutdown(&self) {
        tracing::info!("Shutdown requested via RPC");
        self.shutdown_flag.store(true, Ordering::SeqCst);
    }
}

/// Handle a single JSON-RPC request
async fn handle_request(
    line: &str,
    indexer: &Arc<Indexer>,
    dep_graph: &Arc<Mutex<DependencyGraph>>,
) -> JsonRpcResponse {
    let request: JsonRpcRequest = match serde_json::from_str(line) {
        Ok(req) => req,
        Err(e) => {
            tracing::warn!("Failed to parse request: {}", e);
            return JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError::parse_error()),
                id: serde_json::Value::Null,
            };
        }
    };

    // Validate JSON-RPC version
    if request.jsonrpc != "2.0" {
        return JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError::invalid_params("Invalid JSON-RPC version")),
            id: request.id,
        };
    }

    tracing::debug!("Handling method: {}", request.method);

    // Route method
    let result = match request.method.as_str() {
        "ping" => handle_ping(&request.params),
        "shutdown" => handle_shutdown(indexer).await,
        "embed" => handle_embed(&request.params, indexer).await,
        "search" => handle_search(&request.params, indexer).await,
        "index_file" => handle_index_file(&request.params, indexer).await,
        "get_blast_radius" => handle_get_blast_radius(&request.params, dep_graph).await,
        _ => {
            return JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError::method_not_found()),
                id: request.id,
            };
        }
    };

    match result {
        Ok(value) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(value),
            error: None,
            id: request.id,
        },
        Err(e) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError::internal_error(&e.to_string())),
            id: request.id,
        },
    }
}

/// Handle ping method
fn handle_ping(params: &Option<serde_json::Value>) -> Result<serde_json::Value> {
    if params.is_some() {
        // Echo back params if provided
        Ok(params.clone().unwrap())
    } else {
        Ok(serde_json::json!({"status": "ok"}))
    }
}

/// Handle shutdown method
async fn handle_shutdown(indexer: &Arc<Indexer>) -> Result<serde_json::Value> {
    tracing::info!("Shutdown requested via RPC");
    // The actual shutdown is handled by the Server's shutdown method
    // This just returns success - the caller should call Server::shutdown()
    Ok(serde_json::json!({"status": "shutdown initiated"}))
}

/// Handle embed method
async fn handle_embed(
    params: &Option<serde_json::Value>,
    indexer: &Arc<Indexer>,
) -> Result<serde_json::Value> {
    let params = params.as_ref().ok_or_else(|| anyhow::anyhow!("Missing params"))?;
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing 'text' parameter"))?;

    let embedding = indexer.embed(text)?;
    Ok(serde_json::json!({ "embedding": embedding }))
}

/// Handle search method
async fn handle_search(
    params: &Option<serde_json::Value>,
    indexer: &Arc<Indexer>,
) -> Result<serde_json::Value> {
    let params = params.as_ref().ok_or_else(|| anyhow::anyhow!("Missing params"))?;
    let query = params
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing 'query' parameter"))?;
    let k = params
        .get("k")
        .and_then(|v| v.as_u64())
        .unwrap_or(10) as usize;

    let results = indexer.search(query, k)?;
    let results_json: Vec<serde_json::Value> = results
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "distance": r.distance,
                "metadata": {
                    "file_path": r.metadata.file_path,
                    "function_name": r.metadata.function_name,
                    "parameters": r.metadata.parameters,
                    "return_type": r.metadata.return_type,
                    "line": r.metadata.line,
                    "column": r.metadata.column,
                }
            })
        })
        .collect();

    Ok(serde_json::json!({ "results": results_json }))
}

/// Handle index_file method
async fn handle_index_file(
    params: &Option<serde_json::Value>,
    indexer: &Arc<Indexer>,
) -> Result<serde_json::Value> {
    let params = params.as_ref().ok_or_else(|| anyhow::anyhow!("Missing params"))?;
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing 'path' parameter"))?;

    let path = std::path::Path::new(path);
    let ids = indexer.index_file(path)?;
    Ok(serde_json::json!({ "ids": ids }))
}

/// Handle get_blast_radius method
async fn handle_get_blast_radius(
    params: &Option<serde_json::Value>,
    dep_graph: &Arc<Mutex<DependencyGraph>>,
) -> Result<serde_json::Value> {
    let params = params.as_ref().ok_or_else(|| anyhow::anyhow!("Missing params"))?;
    let target = params
        .get("target")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing 'target' parameter"))?;

    let graph = dep_graph.lock().await;
    let blast_radius = graph.get_blast_radius(target);
    let paths: Vec<String> = blast_radius
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    Ok(serde_json::json!({ "files": paths }))
}

/// Run the server with a new indexer
pub async fn run_server() -> Result<()> {
    let indexer = Indexer::new()?;
    let server = Server::new(indexer);
    server.run().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_handle_ping_no_params() {
        let result = handle_ping(&None).unwrap();
        assert_eq!(result, serde_json::json!({"status": "ok"}));
    }

    #[tokio::test]
    async fn test_handle_ping_with_params() {
        let params = serde_json::json!({"echo": "test"});
        let result = handle_ping(&Some(params)).unwrap();
        assert_eq!(result, serde_json::json!({"echo": "test"}));
    }

    #[test]
    fn test_json_rpc_error_codes() {
        assert_eq!(JsonRpcError::parse_error().code, -32700);
        assert_eq!(JsonRpcError::method_not_found().code, -32601);
        assert_eq!(JsonRpcError::invalid_params("test").code, -32602);
        assert_eq!(JsonRpcError::internal_error("test").code, -32603);
    }
}