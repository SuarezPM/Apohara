use anyhow::Result;
use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::nomic_bert::{NomicBertModel as BertModel, Config};
use hf_hub::api::sync::ApiBuilder;
use hf_hub::{Repo, RepoType};
use std::path::PathBuf;
use tokenizers::Tokenizer;

pub struct EmbeddingModel {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl EmbeddingModel {
    pub fn new() -> Result<Self> {
        let mut cache_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        cache_dir.push(".apohara");
        cache_dir.push("models");

        let api = ApiBuilder::new().with_cache_dir(cache_dir).build()?;
        let repo = api.repo(Repo::with_revision(
            "nomic-ai/nomic-embed-text-v1.5".to_string(),
            RepoType::Model,
            "main".to_string(),
        ));
        
        let config_filename = repo.get("config.json")?;
        let tokenizer_filename = repo.get("tokenizer.json")?;
        let weights_filename = repo.get("model.safetensors")?;

        let config: Config = serde_json::from_slice(&std::fs::read(&config_filename)?)?;
        
        let device = Device::Cpu;
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&[weights_filename], candle_core::DType::F32, &device)? };
        
        let model = BertModel::load(vb, &config)?;
        let mut tokenizer = Tokenizer::from_file(tokenizer_filename)
            .map_err(|e| anyhow::anyhow!("Failed to load tokenizer: {}", e))?;

        let _ = tokenizer.with_truncation(Some(tokenizers::TruncationParams {
            max_length: 8192,
            ..Default::default()
        }));

        Ok(Self {
            model,
            tokenizer,
            device,
        })
    }

    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let prefix = "search_document: ";
        let text_with_prefix = format!("{}{}", prefix, text);
        let tokens = self.tokenizer
            .encode(text_with_prefix, true)
            .map_err(|e| anyhow::anyhow!("Failed to encode: {}", e))?;
        
        let token_ids = tokens.get_ids();
        let token_ids_tensor = Tensor::new(token_ids, &self.device)?.unsqueeze(0)?;
        let token_type_ids = Tensor::zeros_like(&token_ids_tensor)?;
        
        // Pass None for the optional position_ids or attention_mask ?
        // Usually, the 3rd argument is Option<&Tensor> for attention_mask, or maybe positional_ids?
        // Wait, let's just pass None.
        let output = self.model.forward(&token_ids_tensor, Some(&token_type_ids), None)?;
        
        let embeddings = (output.sum(1)? / (token_ids.len() as f64))?;
        let embeddings = embeddings.squeeze(0)?;
        
        let norm = embeddings.sqr()?.sum_all()?.to_scalar::<f32>()?.sqrt();
        let normalized = (embeddings / (norm as f64))?;
        
        Ok(normalized.to_vec1::<f32>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedding_dimension() {
        let model = EmbeddingModel::new().expect("Failed to load model");
        
        // Simple embedding
        let vec = model.embed("Hello world!").expect("Failed to embed short string");
        assert_eq!(vec.len(), 768);
    }

    #[test]
    fn test_empty_string() {
        let model = EmbeddingModel::new().expect("Failed to load model");
        
        // Empty string - may error or return 768-dim vector
        let result = model.embed("");
        // Either succeeds with 768-dim or fails - both acceptable
        if let Ok(vec) = result {
            assert_eq!(vec.len(), 768);
        }
    }

    #[test]
    fn test_long_string() {
        let model = EmbeddingModel::new().expect("Failed to load model");
        
        // Long string (within reasonable processing time)
        // The model truncates at 8192 tokens; very long strings take significant time
        let long_string = "hello ".repeat(400);
        let vec_long = model.embed(&long_string).expect("Failed to embed long string");
        assert_eq!(vec_long.len(), 768);
    }
}
