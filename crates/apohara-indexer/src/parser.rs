use std::fs;
use std::path::Path;
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, PartialEq)]
pub enum Language {
    TypeScript,
    Rust,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FunctionSignature {
    pub name: String,
    pub parameters: Vec<Parameter>,
    pub return_type: Option<String>,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Parameter {
    pub name: String,
    pub type_annotation: Option<String>,
}

impl FunctionSignature {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            parameters: Vec::new(),
            return_type: None,
            line: 0,
            column: 0,
        }
    }

    pub fn with_position(mut self, line: usize, column: usize) -> Self {
        self.line = line;
        self.column = column;
        self
    }

    pub fn with_return_type(mut self, return_type: impl Into<String>) -> Self {
        self.return_type = Some(return_type.into());
        self
    }

    pub fn add_parameter(mut self, name: impl Into<String>, type_annotation: Option<impl Into<String>>) -> Self {
        self.parameters.push(Parameter {
            name: name.into(),
            type_annotation: type_annotation.map(Into::into),
        });
        self
    }
}

/// Detect language based on file extension
pub fn detect_language(path: &Path) -> Option<Language> {
    match path.extension().and_then(|e| e.to_str()) {
        Some("ts") | Some("tsx") | Some("mts") | Some("cts") => Some(Language::TypeScript),
        Some("rs") => Some(Language::Rust),
        _ => None,
    }
}

/// Parse a file and extract function signatures
pub fn parse_file(path: &Path) -> Result<Vec<FunctionSignature>, ParseError> {
    let language = detect_language(path)
        .ok_or_else(|| ParseError::UnsupportedLanguage(path.to_path_buf()))?;

    let content = fs::read_to_string(path)
        .map_err(|e| ParseError::ReadError(path.to_path_buf(), e))?;

    parse_source(&content, language)
}

/// Parse source code directly
pub fn parse_source(source: &str, language: Language) -> Result<Vec<FunctionSignature>, ParseError> {
    let mut parser = Parser::new();

    match language {
        Language::TypeScript => {
            parser
                .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
                .map_err(|e| ParseError::ParserInit(format!("TypeScript: {:?}", e)))?;
        }
        Language::Rust => {
            parser
                .set_language(&tree_sitter_rust::LANGUAGE.into())
                .map_err(|e| ParseError::ParserInit(format!("Rust: {:?}", e)))?;
        }
    }

    let tree = parser
        .parse(source, None)
        .ok_or(ParseError::ParseFailed)?;

    let root = tree.root_node();
    let mut signatures = Vec::new();

    match language {
        Language::TypeScript => extract_typescript_functions(&root, source, &mut signatures),
        Language::Rust => extract_rust_functions(&root, source, &mut signatures),
    }

    Ok(signatures)
}

#[derive(Debug)]
pub enum ParseError {
    UnsupportedLanguage(std::path::PathBuf),
    ReadError(std::path::PathBuf, std::io::Error),
    ParserInit(String),
    ParseFailed,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnsupportedLanguage(p) => write!(f, "Unsupported file type: {:?}", p),
            ParseError::ReadError(p, e) => write!(f, "Failed to read {:?}: {}", p, e),
            ParseError::ParserInit(e) => write!(f, "Parser initialization failed: {}", e),
            ParseError::ParseFailed => write!(f, "Failed to parse source code"),
        }
    }
}

impl std::error::Error for ParseError {}

fn extract_typescript_functions(node: &Node, source: &str, signatures: &mut Vec<FunctionSignature>) {
    let cursor = &mut node.walk();

    for child in node.children(cursor) {
        match child.kind() {
            "function_declaration" | "function_signature" => {
                if let Some(sig) = parse_typescript_function(&child, source) {
                    signatures.push(sig);
                }
            }
            "export_statement" => {
                // Check for exported functions
                if let Some(declaration) = child.child_by_field_name("declaration") {
                    if declaration.kind() == "function_declaration" {
                        if let Some(sig) = parse_typescript_function(&declaration, source) {
                            signatures.push(sig);
                        }
                    }
                }
            }
            "class_declaration" | "interface_declaration" | "type_alias_declaration" => {
                // Extract methods from classes and interfaces
                if let Some(body) = child.child_by_field_name("body") {
                    extract_typescript_functions(&body, source, signatures);
                }
            }
            "method_definition" | "method_signature" => {
                if let Some(sig) = parse_typescript_method(&child, source) {
                    signatures.push(sig);
                }
            }
            "abstract_method_signature" | "call_signature" | "construct_signature" => {
                if let Some(sig) = parse_typescript_signature(&child, source) {
                    signatures.push(sig);
                }
            }
            _ => {
                // Recursively search in other nodes
                extract_typescript_functions(&child, source, signatures);
            }
        }
    }
}

fn parse_typescript_function(node: &Node, source: &str) -> Option<FunctionSignature> {
    let name = node
        .child_by_field_name("name")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .map(|s| s.to_string())?;

    let start_position = node.start_position();
    let mut sig = FunctionSignature::new(name)
        .with_position(start_position.row + 1, start_position.column);

    // Extract parameters
    if let Some(params) = node.child_by_field_name("parameters") {
        let cursor = &mut params.walk();
        for param in params.children(cursor) {
            if param.kind() == "formal_parameters" || param.kind() == "required_parameter" || param.kind() == "optional_parameter" {
                // For formal_parameters node, recurse into children
                if param.kind() == "formal_parameters" {
                    let inner_cursor = &mut param.walk();
                    for inner_param in param.children(inner_cursor) {
                        if let Some((name, type_ann)) = extract_typescript_param(&inner_param, source) {
                            sig = sig.add_parameter(name, type_ann);
                        }
                    }
                } else if let Some((name, type_ann)) = extract_typescript_param(&param, source) {
                    sig = sig.add_parameter(name, type_ann);
                }
            }
        }
    }

    // Extract return type
    if let Some(type_node) = node.child_by_field_name("return_type") {
        if let Ok(type_text) = type_node.utf8_text(source.as_bytes()) {
            sig = sig.with_return_type(type_text.to_string());
        }
    }

    Some(sig)
}

fn parse_typescript_method(node: &Node, source: &str) -> Option<FunctionSignature> {
    let name = node
        .child_by_field_name("name")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .map(|s| s.to_string())?;

    let start_position = node.start_position();
    let mut sig = FunctionSignature::new(name)
        .with_position(start_position.row + 1, start_position.column);

    // Extract parameters
    if let Some(params) = node.child_by_field_name("parameters") {
        let cursor = &mut params.walk();
        for param in params.children(cursor) {
            if let Some((name, type_ann)) = extract_typescript_param(&param, source) {
                sig = sig.add_parameter(name, type_ann);
            }
        }
    }

    // Extract return type
    if let Some(type_node) = node.child_by_field_name("return_type") {
        if let Ok(type_text) = type_node.utf8_text(source.as_bytes()) {
            sig = sig.with_return_type(type_text.to_string());
        }
    }

    Some(sig)
}

fn parse_typescript_signature(node: &Node, source: &str) -> Option<FunctionSignature> {
    // For call signatures and method signatures in interfaces
    let name = if node.kind() == "call_signature" {
        "__call".to_string()
    } else {
        node.child_by_field_name("name")
            .and_then(|n| n.utf8_text(source.as_bytes()).ok())
            .unwrap_or_default()
            .to_string()
    };

    if name.is_empty() && node.kind() != "call_signature" {
        return None;
    }

    let start_position = node.start_position();
    let mut sig = FunctionSignature::new(name)
        .with_position(start_position.row + 1, start_position.column);

    // Extract parameters
    if let Some(params) = node.child_by_field_name("parameters") {
        let cursor = &mut params.walk();
        for param in params.children(cursor) {
            if let Some((name, type_ann)) = extract_typescript_param(&param, source) {
                sig = sig.add_parameter(name, type_ann);
            }
        }
    }

    // Extract return type
    if let Some(type_node) = node.child_by_field_name("return_type") {
        if let Ok(type_text) = type_node.utf8_text(source.as_bytes()) {
            sig = sig.with_return_type(type_text.to_string());
        }
    }

    Some(sig)
}

fn extract_typescript_param(node: &Node, source: &str) -> Option<(String, Option<String>)> {
    match node.kind() {
        "required_parameter" | "optional_parameter" => {
            let name = node
                .child_by_field_name("pattern")
                .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                .map(|s| s.to_string())?;

            let type_ann = node
                .child_by_field_name("type")
                .and_then(|t| t.utf8_text(source.as_bytes()).ok())
                .map(|s| s.to_string());

            Some((name, type_ann))
        }
        "identifier" => {
            let name = node.utf8_text(source.as_bytes()).ok()?.to_string();
            Some((name, None))
        }
        _ => None,
    }
}

fn extract_rust_functions(node: &Node, source: &str, signatures: &mut Vec<FunctionSignature>) {
    let cursor = &mut node.walk();

    for child in node.children(cursor) {
        match child.kind() {
            "function_item" => {
                if let Some(sig) = parse_rust_function(&child, source) {
                    signatures.push(sig);
                }
            }
            "impl_item" => {
                // Extract methods from impl blocks
                if let Some(body) = child.child_by_field_name("body") {
                    extract_rust_functions(&body, source, signatures);
                }
            }
            "trait_item" => {
                // Extract methods from trait definitions
                if let Some(body) = child.child_by_field_name("body") {
                    extract_rust_trait_methods(&body, source, signatures);
                }
            }
            "declaration_list" | "field_declaration_list" => {
                // Recursively search in declaration lists
                extract_rust_functions(&child, source, signatures);
            }
            "associated_function" => {
                if let Some(sig) = parse_rust_function(&child, source) {
                    signatures.push(sig);
                }
            }
            _ => {
                // Recursively search in other nodes
                extract_rust_functions(&child, source, signatures);
            }
        }
    }
}

/// Extract function signatures from trait bodies
/// Trait methods use "function_signature_item" instead of "function_item"
fn extract_rust_trait_methods(node: &Node, source: &str, signatures: &mut Vec<FunctionSignature>) {
    let cursor = &mut node.walk();

    for child in node.children(cursor) {
        match child.kind() {
            "function_signature_item" | "function_item" | "associated_function" => {
                if let Some(sig) = parse_rust_function(&child, source) {
                    signatures.push(sig);
                }
            }
            _ => {
                // Recursively search in other nodes
                extract_rust_trait_methods(&child, source, signatures);
            }
        }
    }
}

fn parse_rust_function(node: &Node, source: &str) -> Option<FunctionSignature> {
    let name = node
        .child_by_field_name("name")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .map(|s| s.to_string())?;

    let start_position = node.start_position();
    let mut sig = FunctionSignature::new(name)
        .with_position(start_position.row + 1, start_position.column);

    // Extract parameters
    if let Some(params) = node.child_by_field_name("parameters") {
        let cursor = &mut params.walk();
        for param in params.children(cursor) {
            if let Some((name, type_ann)) = extract_rust_param(&param, source) {
                sig = sig.add_parameter(name, type_ann);
            }
        }
    }

    // Extract return type
    if let Some(ret_type) = node.child_by_field_name("return_type") {
        if let Ok(type_text) = ret_type.utf8_text(source.as_bytes()) {
            sig = sig.with_return_type(type_text.to_string());
        }
    }

    Some(sig)
}

fn extract_rust_param(node: &Node, source: &str) -> Option<(String, Option<String>)> {
    match node.kind() {
        "parameter" => {
            // Try to get pattern (name) and type
            let pattern = node.child_by_field_name("pattern");
            let type_node = node.child_by_field_name("type");

            let name = pattern
                .and_then(|p| extract_pattern_name(&p, source))
                .unwrap_or_else(|| "_".to_string());

            let type_ann = type_node
                .and_then(|t| t.utf8_text(source.as_bytes()).ok())
                .map(|s| s.to_string());

            Some((name, type_ann))
        }
        "self_parameter" => {
            let self_text = node.utf8_text(source.as_bytes()).ok()?.to_string();
            Some(("self".to_string(), Some(self_text)))
        }
        "identifier" => {
            let name = node.utf8_text(source.as_bytes()).ok()?.to_string();
            Some((name, None))
        }
        _ => None,
    }
}

fn extract_pattern_name(node: &Node, source: &str) -> Option<String> {
    match node.kind() {
        "identifier" | "field_identifier" => {
            node.utf8_text(source.as_bytes()).ok().map(|s| s.to_string())
        }
        "ref_pattern" | "mut_pattern" => {
            // Get the inner pattern
            node.child(0)
                .and_then(|c| extract_pattern_name(&c, source))
        }
        "tuple_pattern" | "struct_pattern" | "slice_pattern" => {
            // For complex patterns, return a placeholder
            Some("_".to_string())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_language() {
        assert_eq!(
            detect_language(Path::new("test.ts")),
            Some(Language::TypeScript)
        );
        assert_eq!(
            detect_language(Path::new("test.tsx")),
            Some(Language::TypeScript)
        );
        assert_eq!(
            detect_language(Path::new("test.rs")),
            Some(Language::Rust)
        );
        assert_eq!(detect_language(Path::new("test.js")), None);
        assert_eq!(detect_language(Path::new("test.py")), None);
    }

    #[test]
    fn test_parse_typescript_simple_function() {
        let source = r#"
function add(a: number, b: number): number {
    return a + b;
}
"#;

        let sigs = parse_source(source, Language::TypeScript).unwrap();
        assert_eq!(sigs.len(), 1);

        let add = &sigs[0];
        assert_eq!(add.name, "add");
        assert_eq!(add.line, 2);
        assert_eq!(add.return_type, Some(": number".to_string()));
    }

    #[test]
    fn test_parse_rust_simple_function() {
        let source = r#"
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
"#;

        let sigs = parse_source(source, Language::Rust).unwrap();
        assert_eq!(sigs.len(), 1);

        let add = &sigs[0];
        assert_eq!(add.name, "add");
        assert_eq!(add.line, 2);
        assert_eq!(add.return_type, Some("i32".to_string()));
    }

    #[test]
    fn test_parse_typescript_exported_function() {
        let source = r#"
export function greet(name: string): void {
    console.log(`Hello, ${name}!`);
}
"#;

        let sigs = parse_source(source, Language::TypeScript).unwrap();
        assert_eq!(sigs.len(), 1);
        assert_eq!(sigs[0].name, "greet");
    }

    #[test]
    fn test_parse_rust_impl_methods() {
        let source = r#"
impl MyStruct {
    pub fn new() -> Self {
        MyStruct {}
    }

    fn private_method(&self) -> i32 {
        42
    }
}
"#;

        let sigs = parse_source(source, Language::Rust).unwrap();
        assert_eq!(sigs.len(), 2);

        let names: Vec<_> = sigs.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"new"));
        assert!(names.contains(&"private_method"));
    }

    #[test]
    fn test_parse_typescript_interface_methods() {
        let source = r#"
interface Calculator {
    add(a: number, b: number): number;
    subtract(a: number, b: number): number;
}
"#;

        let sigs = parse_source(source, Language::TypeScript).unwrap();
        assert_eq!(sigs.len(), 2);

        let names: Vec<_> = sigs.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"add"));
        assert!(names.contains(&"subtract"));
    }

    #[test]
    fn test_parse_rust_trait_methods() {
        let source = r#"
trait Drawable {
    fn draw(&self);
    fn get_bounds(&self) -> Rect;
}
"#;

        let sigs = parse_source(source, Language::Rust).unwrap();
        assert_eq!(sigs.len(), 2);

        let names: Vec<_> = sigs.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"draw"));
        assert!(names.contains(&"get_bounds"));
    }
}
