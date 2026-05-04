/// Database persistence layer using redb (embedded key-value store).
/// 
/// Provides durable storage for the vector index metadata and serialized index state.
/// The database file is stored at ~/.apohara/index.redb

use anyhow::{Context, Result};
use redb::{Database, ReadableTable, ReadableTableMetadata, TableDefinition};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Table definitions for redb database
const NODES_TABLE: TableDefinition<u64, &[u8]> = TableDefinition::new("nodes");
const INDEX_STATE_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("index_state");

/// Metadata stored for each indexed function
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeMetadata {
    /// File path where the function was found
    pub file_path: String,
    /// Function name
    pub function_name: String,
    /// Parameters as JSON string
    pub parameters: String,
    /// Return type (if any)
    pub return_type: Option<String>,
    /// Line number in source file
    pub line: usize,
    /// Column number in source file  
    pub column: usize,
}

/// Database handle for persistent storage
pub struct Db {
    db: Database,
    path: PathBuf,
}

impl Db {
    /// Open or create the database at the default location (~/.apohara/index.redb)
    pub fn new() -> Result<Self> {
        let path = Self::default_path()?;
        
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .context(format!("Failed to create directory: {:?}", parent))?;
        }

        // Open database - creates if doesn't exist
        let db = Database::create(&path)
            .context(format!("Failed to open database at {:?}", path))?;

        tracing::info!("Opened database at {:?}", path);
        
        Ok(Self { db, path })
    }

    /// Get the default database path
    fn default_path() -> Result<PathBuf> {
        let mut path = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push(".apohara");
        path.push("index.redb");
        Ok(path)
    }

    /// Get the database file path
    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Store node metadata in the database
    pub fn put_node(&self, id: u64, metadata: &NodeMetadata) -> Result<()> {
        let write_txn = self.db.begin_write()
            .context("Failed to begin write transaction")?;
        
        {
            let mut table = write_txn.open_table(NODES_TABLE)
                .context("Failed to open nodes table")?;
            
            let serialized = bincode::serialize(metadata)
                .context("Failed to serialize metadata")?;
            
            table.insert(id, serialized.as_slice())
                .context("Failed to insert node")?;
        }
        
        write_txn.commit()
            .context("Failed to commit node insert")?;

        tracing::debug!("Stored node metadata for id={}", id);
        Ok(())
    }

    /// Retrieve node metadata by ID
    pub fn get_node(&self, id: u64) -> Result<Option<NodeMetadata>> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;
        
        // Try to open the table - if it doesn't exist, return None
        let table = match read_txn.open_table(NODES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                // Table doesn't exist - return empty result
                tracing::debug!("Nodes table doesn't exist yet: {}", e);
                return Ok(None);
            }
        };
        
        let result = table.get(id)
            .context("Failed to get node")?;
        
        match result {
            Some(value) => {
                let bytes = value.value();
                let metadata: NodeMetadata = bincode::deserialize(bytes)
                    .context("Failed to deserialize metadata")?;
                Ok(Some(metadata))
            }
            None => Ok(None),
        }
    }

    /// Get all node IDs in the database
    pub fn get_all_node_ids(&self) -> Result<Vec<u64>> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;
        
        // Handle missing table gracefully - return empty vec if tables don't exist yet
        let table = match read_txn.open_table(NODES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Nodes table doesn't exist yet: {}", e);
                return Ok(Vec::new());
            }
        };
        
        let mut ids = Vec::new();
        for entry in table.iter()? {
            let (id, _) = entry?;
            ids.push(id.value());
        }
        
        Ok(ids)
    }

    /// Remove a node by ID
    pub fn delete_node(&self, id: u64) -> Result<()> {
        let write_txn = self.db.begin_write()
            .context("Failed to begin write transaction")?;
        
        {
            let mut table = write_txn.open_table(NODES_TABLE)
                .context("Failed to open nodes table")?;
            
            table.remove(id)
                .context("Failed to delete node")?;
        }
        
        write_txn.commit()
            .context("Failed to commit node delete")?;

        tracing::debug!("Deleted node with id={}", id);
        Ok(())
    }

    /// Store the serialized index state
    pub fn put_index_state(&self, data: &[u8]) -> Result<()> {
        let write_txn = self.db.begin_write()
            .context("Failed to begin write transaction")?;
        
        {
            let mut table = write_txn.open_table(INDEX_STATE_TABLE)
                .context("Failed to open index_state table")?;
            
            table.insert("graph", data)
                .context("Failed to insert index state")?;
        }
        
        write_txn.commit()
            .context("Failed to commit index state insert")?;

        tracing::debug!("Stored index state ({} bytes)", data.len());
        Ok(())
    }

    /// Retrieve the serialized index state
    pub fn get_index_state(&self) -> Result<Option<Vec<u8>>> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;
        
        // Try to open the table - if it doesn't exist, return None
        let table = match read_txn.open_table(INDEX_STATE_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Index state table doesn't exist yet: {}", e);
                return Ok(None);
            }
        };
        
        let result = table.get("graph")
            .context("Failed to get index state")?;
        
        match result {
            Some(value) => {
                let bytes = value.value().to_vec();
                Ok(Some(bytes))
            }
            None => Ok(None),
        }
    }

    /// Get the number of nodes in the database
    pub fn node_count(&self) -> Result<usize> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;
        
        // Try to open the table - if it doesn't exist, return 0
        let table = match read_txn.open_table(NODES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Nodes table doesn't exist yet: {}", e);
                return Ok(0);
            }
        };
        
        Ok(table.len()? as usize)
    }

    /// Check if the database file exists
    pub fn exists() -> bool {
        Self::default_path().map(|p| p.exists()).unwrap_or(false)
    }

    /// Get the database file size in bytes
    pub fn file_size(&self) -> Result<u64> {
        let metadata = std::fs::metadata(&self.path)
            .context("Failed to get file metadata")?;
        Ok(metadata.len())
    }
}

impl std::fmt::Debug for Db {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Db")
            .field("path", &self.path)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_db() -> (Db, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("test.redb");
        
        let db = Database::create(&path).unwrap();
        let db = Db { db, path };
        
        (db, temp_dir)
    }

    #[test]
    fn test_put_and_get_node() {
        let (db, _temp) = create_test_db();
        
        let metadata = NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "test_fn".to_string(),
            parameters: "a: i32, b: String".to_string(),
            return_type: Some("bool".to_string()),
            line: 10,
            column: 5,
        };
        
        db.put_node(1, &metadata).unwrap();
        
        let retrieved = db.get_node(1).unwrap();
        assert!(retrieved.is_some());
        
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.function_name, "test_fn");
        assert_eq!(retrieved.file_path, "/test/file.rs");
        assert_eq!(retrieved.line, 10);
    }

    #[test]
    fn test_get_nonexistent_node() {
        let (db, _temp) = create_test_db();
        
        let result = db.get_node(999).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_get_all_node_ids() {
        let (db, _temp) = create_test_db();
        
        db.put_node(1, &NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "fn1".to_string(),
            parameters: "".to_string(),
            return_type: None,
            line: 1,
            column: 1,
        }).unwrap();
        
        db.put_node(5, &NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "fn2".to_string(),
            parameters: "".to_string(),
            return_type: None,
            line: 2,
            column: 1,
        }).unwrap();
        
        let ids = db.get_all_node_ids().unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&1));
        assert!(ids.contains(&5));
    }

    #[test]
    fn test_delete_node() {
        let (db, _temp) = create_test_db();
        
        db.put_node(1, &NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "fn1".to_string(),
            parameters: "".to_string(),
            return_type: None,
            line: 1,
            column: 1,
        }).unwrap();
        
        db.delete_node(1).unwrap();
        
        let result = db.get_node(1).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_index_state_persistence() {
        let (db, _temp) = create_test_db();
        
        let data = vec![1, 2, 3, 4, 5];
        db.put_index_state(&data).unwrap();
        
        let retrieved = db.get_index_state().unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap(), data);
    }

    #[test]
    fn test_node_count() {
        let (db, _temp) = create_test_db();
        
        assert_eq!(db.node_count().unwrap(), 0);
        
        db.put_node(1, &NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "fn1".to_string(),
            parameters: "".to_string(),
            return_type: None,
            line: 1,
            column: 1,
        }).unwrap();
        
        assert_eq!(db.node_count().unwrap(), 1);
    }
}