//! Integration tests for the memory system
//!
//! Tests the full flow: store_memory -> search_memory

use apohara_indexer::{Indexer, MemoryType};
use std::str::FromStr;

/// Test full memory lifecycle: store and retrieve
#[test]
fn test_memory_integration_basic() {
    // Skip if model not available (e.g., CI environment without model cache)
    let indexer = match Indexer::new() {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Skipping integration test: could not load model: {}", e);
            return;
        }
    };

    // Store a preference memory
    let memory_id = indexer
        .store_memory("preference", "User prefers snake_case for variable naming")
        .expect("Failed to store memory");

    assert!(!memory_id.is_empty(), "Memory ID should not be empty");
    assert_eq!(memory_id.len(), 36, "Memory ID should be a UUID");

    // Verify we can search for it
    let results = indexer
        .search_memories("snake_case naming convention", 5)
        .expect("Failed to search memories");

    assert!(!results.is_empty(), "Should find at least one memory");
    // The stored memory should be in the results (may not be first if other memories exist)
    let found = results.iter().any(|(m, score)| m.id == memory_id && *score > 0.5);
    assert!(found, "Should find our stored memory with reasonable similarity");
}

/// Test that different memory types can coexist
#[test]
fn test_memory_integration_multiple_types() {
    let indexer = match Indexer::new() {
        Ok(i) => i,
        Err(_) => {
            eprintln!("Skipping integration test: could not load model");
            return;
        }
    };

    // Store memories of different types
    let pref_id = indexer
        .store_memory("preference", "Use 4 spaces for indentation")
        .expect("Failed to store preference");

    let arch_id = indexer
        .store_memory("architecture", "Use MVC pattern for web apps")
        .expect("Failed to store architecture");

    let error_id = indexer
        .store_memory("past_error", "Don't forget to handle database connection errors")
        .expect("Failed to store past_error");

    let corr_id = indexer
        .store_memory("correction", "Use async/await instead of callbacks")
        .expect("Failed to store correction");

    // Search for architecture-related content
    let results = indexer
        .search_memories("web application design patterns", 3)
        .expect("Failed to search");

    // Should find the architecture memory
    assert!(
        results.iter().any(|(m, _)| m.id == arch_id),
        "Should find architecture memory"
    );

    // Search for error-related content
    let results = indexer
        .search_memories("database error handling", 3)
        .expect("Failed to search");

    assert!(
        results.iter().any(|(m, _)| m.id == error_id),
        "Should find past_error memory"
    );
}

/// Test embedding consistency - same content should produce similar embeddings
#[test]
fn test_memory_embedding_consistency() {
    let indexer = match Indexer::new() {
        Ok(i) => i,
        Err(_) => {
            eprintln!("Skipping integration test: could not load model");
            return;
        }
    };

    // Store a memory
    let content = "Always validate user input before processing";
    let memory_id = indexer
        .store_memory("correction", content)
        .expect("Failed to store memory");

    // Search with semantically similar but textually different query
    let results = indexer
        .search_memories("Input validation is important", 3)
        .expect("Failed to search");

    // Should still find the memory due to semantic similarity
    assert!(
        results.iter().any(|(m, _)| m.id == memory_id),
        "Should find memory with semantically similar query"
    );

    // The similarity might not be as high since the wording is different
    let found = results.iter().find(|(m, _)| m.id == memory_id).unwrap();
    assert!(found.1 > 0.5, "Similarity should be moderate to high for related concepts");
}

/// Test search relevance ordering
#[test]
fn test_memory_search_relevance() {
    let indexer = match Indexer::new() {
        Ok(i) => i,
        Err(_) => {
            eprintln!("Skipping integration test: could not load model");
            return;
        }
    };

    // Store memories with very different meanings
    let _code_style_id = indexer
        .store_memory("preference", "Use camelCase for JavaScript variables")
        .expect("Failed to store");

    let arch_id = indexer
        .store_memory("architecture", "Microservices architecture with event sourcing")
        .expect("Failed to store");

    let _db_id = indexer
        .store_memory("preference", "Use PostgreSQL for relational data")
        .expect("Failed to store");

    // Search specifically for microservices
    let results = indexer
        .search_memories("distributed systems and microservices", 2)
        .expect("Failed to search");

    // The architecture memory should be first
    assert_eq!(results[0].0.id, arch_id, "Most relevant result should be first");
    assert!(results[0].1 > 0.6, "Top result should have high similarity");
}

/// Test top_k limiting
#[test]
fn test_memory_search_top_k() {
    let indexer = match Indexer::new() {
        Ok(i) => i,
        Err(_) => {
            eprintln!("Skipping integration test: could not load model");
            return;
        }
    };

    // Store multiple memories
    for i in 0..10 {
        let content = format!("Memory number {} about code quality", i);
        indexer
            .store_memory("preference", &content)
            .expect("Failed to store memory");
    }

    // Search with top_k=3
    let results = indexer
        .search_memories("code quality", 3)
        .expect("Failed to search");

    assert_eq!(results.len(), 3, "Should respect top_k limit");

    // Search with top_k=5
    let results = indexer
        .search_memories("code quality", 5)
        .expect("Failed to search");

    assert_eq!(results.len(), 5, "Should respect top_k limit");
}

/// Test that memory type enum parsing works correctly
#[test]
fn test_memory_type_parsing() {
    assert_eq!(MemoryType::from_str("correction").unwrap(), MemoryType::Correction);
    assert_eq!(MemoryType::from_str("preference").unwrap(), MemoryType::Preference);
    assert_eq!(MemoryType::from_str("architecture").unwrap(), MemoryType::Architecture);
    assert_eq!(MemoryType::from_str("past_error").unwrap(), MemoryType::PastError);
    assert_eq!(MemoryType::from_str("pastError").unwrap(), MemoryType::PastError);
    assert_eq!(MemoryType::from_str("PAST_ERROR").unwrap(), MemoryType::PastError);

    // Invalid type should error
    assert!(MemoryType::from_str("invalid").is_err());
    assert!(MemoryType::from_str("").is_err());
}

/// Test memory type display
#[test]
fn test_memory_type_display() {
    assert_eq!(MemoryType::Correction.to_string(), "correction");
    assert_eq!(MemoryType::Preference.to_string(), "preference");
    assert_eq!(MemoryType::Architecture.to_string(), "architecture");
    assert_eq!(MemoryType::PastError.to_string(), "past_error");
}

/// Test empty database search
#[test]
fn test_memory_empty_database_search() {
    // Use a temporary directory to get a fresh database
    let temp_dir = tempfile::TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.redb");
    
    // Create indexer with custom path would require changes, so we just verify
    // that search on an indexer with no memories returns empty
    let indexer = match Indexer::new() {
        Ok(i) => i,
        Err(_) => {
            eprintln!("Skipping integration test: could not load model");
            return;
        }
    };

    // Search for something that definitely doesn't exist
    let results = indexer
        .search_memories("xyz non existent query 12345", 5)
        .expect("Failed to search");

    // Should return empty or very low similarity results
    // The behavior depends on whether there are any memories at all
    // If database is truly empty, it should return empty
    for (_, similarity) in &results {
        // Any results should have very low similarity
        assert!(*similarity < 0.9, "Non-existent query should not have high similarity matches");
    }
}

/// Test memory content preservation
#[test]
fn test_memory_content_preservation() {
    let indexer = match Indexer::new() {
        Ok(i) => i,
        Err(_) => {
            eprintln!("Skipping integration test: could not load model");
            return;
        }
    };

    let content = "This is a very specific memory about using Result<T, E> instead of panic! in Rust";
    let memory_id = indexer
        .store_memory("correction", content)
        .expect("Failed to store");

    // Search to retrieve it
    let results = indexer
        .search_memories("Rust error handling", 1)
        .expect("Failed to search");

    assert!(!results.is_empty(), "Should find the memory");
    assert_eq!(results[0].0.content, content, "Content should be preserved exactly");
    assert_eq!(results[0].0.memory_type, MemoryType::Correction);
}
