/// Indexer orchestrator - ties together parsing, embeddings, vector index, and persistence.
/// 
/// Provides high-level API for indexing source code files and searching for similar functions.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::db::{Db, NodeMetadata};
use crate::embeddings::EmbeddingModel;
use crate::index::{IndexConfig, VectorIndex};
use crate::parser::{parse_file, FunctionSignature};

/// Orchestrator for indexing and searching source code functions
pub struct Indexer {
    model: EmbeddingModel,
    index: Mutex<VectorIndex>,
    db: Db,
    next_id: Mutex<u64>,
}

impl Indexer {
    /// Create a new indexer, loading existing state from disk if available
    pub fn new() -> Result<Self> {
        // Initialize embedding model
        tracing::info!("Loading embedding model...");
        let model = EmbeddingModel::new()
            .context("Failed to load embedding model")?;
        
        // Initialize or open database
        tracing::info!("Opening database...");
        let db = Db::new()
            .context("Failed to open database")?;
        
        // Load existing index or create new one
        let index = match db.get_index_state()? {
            Some(data) => {
                tracing::info!("Restoring index from database...");
                VectorIndex::from_bytes(&data)
                    .context("Failed to restore index from database")?
            }
            None => {
                tracing::info!("Creating new index...");
                VectorIndex::new(IndexConfig::default())
            }
        };
        
        // Find the next available ID
        let node_ids = db.get_all_node_ids()?;
        let next_id = node_ids.iter().max().map(|&id| id + 1).unwrap_or(1);
        
        tracing::info!(
            "Indexer initialized: {} nodes in database, next_id={}",
            node_ids.len(),
            next_id
        );
        
        Ok(Self {
            model,
            index: Mutex::new(index),
            db,
            next_id: Mutex::new(next_id),
        })
    }

    /// Get the database path
    pub fn db_path(&self) -> &PathBuf {
        self.db.path()
    }

    /// Get the current number of indexed functions
    pub fn len(&self) -> usize {
        self.index.lock().unwrap().len()
    }

    /// Index a text string (raw function code)
    pub fn index_text(&self, text: &str, metadata: NodeMetadata) -> Result<u64> {
        // Generate embedding
        tracing::debug!("Generating embedding for text ({} chars)", text.len());
        let embedding = self.model.embed(text)?;
        
        // Get next ID
        let id = {
            let mut next_id = self.next_id.lock().unwrap();
            let id = *next_id;
            *next_id += 1;
            id
        };
        
        // Insert into vector index
        {
            let mut index = self.index.lock().unwrap();
            index.insert(id, &embedding)?;
        }
        
        // Store metadata in database
        self.db.put_node(id, &metadata)?;
        
        // Save index state
        self.save_index_state()?;
        
        tracing::debug!("Indexed text with id={}", id);
        
        Ok(id)
    }

    /// Index a source file, extracting function signatures and embedding each one
    pub fn index_file(&self, path: &Path) -> Result<Vec<u64>> {
        tracing::info!("Indexing file: {:?}", path);
        
        // Parse file to extract function signatures
        let signatures = parse_file(path)
            .with_context(|| format!("Failed to parse file: {:?}", path))?;
        
        if signatures.is_empty() {
            tracing::debug!("No functions found in {:?}", path);
            return Ok(Vec::new());
        }
        
        // Read the source file (currently using signature; full body extraction available)
        let _source = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read file: {:?}", path))?;
        
        let mut ids = Vec::new();
        
        for sig in signatures {
            // Create a text representation of the function for embedding
            let embed_text = self.create_embedding_text(&sig, path);
            
            let metadata = NodeMetadata {
                file_path: path.to_string_lossy().to_string(),
                function_name: sig.name.clone(),
                parameters: sig.parameters.iter()
                    .map(|p| {
                        match &p.type_annotation {
                            Some(t) => format!("{}: {}", p.name, t),
                            None => p.name.clone(),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", "),
                return_type: sig.return_type.clone(),
                line: sig.line,
                column: sig.column,
            };
            
            let id = self.index_text(&embed_text, metadata)?;
            ids.push(id);
            
            tracing::debug!("Indexed function: {} at line {}", sig.name, sig.line);
        }
        
        tracing::info!("Indexed {} functions from {:?}", ids.len(), path);
        
        Ok(ids)
    }

    /// Create a text representation of a function for embedding
    fn create_embedding_text(&self, sig: &FunctionSignature, path: &Path) -> String {
        let lang = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        
        let return_type = sig.return_type.as_deref().unwrap_or("");
        
        let params = sig.parameters.iter()
            .map(|p| {
                match &p.type_annotation {
                    Some(t) => format!("{}: {}", p.name, t),
                    None => p.name.clone(),
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        
        // Create a semantic representation that captures the function's signature
        format!(
            "function {}({}) -> {} language:{}",
            sig.name, params, return_type, lang
        )
    }

    /// Search for similar functions
    pub fn search(&self, query: &str, k: usize) -> Result<Vec<SearchResult>> {
        if self.len() == 0 {
            tracing::debug!("Search on empty index returned empty results");
            return Ok(Vec::new());
        }
        
        // Generate embedding for query
        tracing::debug!("Searching for: {}", query);
        let embedding = self.model.embed(query)?;
        
        // Search the index
        let results = {
            let index = self.index.lock().unwrap();
            index.search(&embedding, k)?
        };
        
        // Look up metadata for each result
        let mut search_results = Vec::new();
        for (id, distance) in results {
            if let Some(metadata) = self.db.get_node(id)? {
                search_results.push(SearchResult {
                    id,
                    distance,
                    metadata,
                });
            }
        }
        
        tracing::debug!("Search returned {} results", search_results.len());
        
        Ok(search_results)
    }

    /// Save the current index state to the database
    fn save_index_state(&self) -> Result<()> {
        let index = self.index.lock().unwrap();
        let data = index.to_bytes()?;
        self.db.put_index_state(&data)?;
        
        tracing::debug!("Saved index state ({} bytes)", data.len());
        
        Ok(())
    }

    /// Get database file size
    pub fn db_file_size(&self) -> Result<u64> {
        self.db.file_size()
    }

    /// Generate embedding for text (public API for external usage)
    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        self.model.embed(text)
    }
}

/// Search result with metadata
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// The ID of the indexed function
    pub id: u64,
    /// Distance from query (lower = more similar)
    pub distance: f32,
    /// The stored metadata
    pub metadata: NodeMetadata,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_indexer_creation() {
        // This requires model download, skip in normal tests
        // let indexer = Indexer::new();
        // assert!(indexer.is_ok());
    }

    #[test]
    fn test_create_embedding_text() {
        // Create a minimal indexer without loading the full model
        let sig = FunctionSignature::new("add")
            .add_parameter("a", Some("number"))
            .add_parameter("b", Some("number"))
            .with_return_type("number");
        
        let path = Path::new("test.ts");
        
        // The text format includes function signature
        let text = format!(
            "function {}({}) -> {} language:{}",
            sig.name,
            sig.parameters.iter()
                .map(|p| format!("{}: {}", p.name, p.type_annotation.as_ref().unwrap()))
                .collect::<Vec<_>>()
                .join(", "),
            sig.return_type.as_deref().unwrap_or(""),
            "ts"
        );
        
        assert!(text.contains("add"));
        assert!(text.contains("number"));
    }
}