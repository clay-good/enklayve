use anyhow::{Result, Context as AnyhowContext};
use std::path::Path;
use llama_cpp_2::{
    llama_backend::LlamaBackend,
    model::{LlamaModel, params::LlamaModelParams, AddBos, Special},
    context::params::LlamaContextParams,
    llama_batch::LlamaBatch,
    sampling::LlamaSampler,
};

/// Inference engine using llama.cpp
pub struct InferenceEngine {
    backend: LlamaBackend,
}

impl InferenceEngine {
    /// Create a new inference engine
    /// Initializes the llama.cpp backend
    pub fn new() -> Result<Self> {
        let backend = LlamaBackend::init()
            .context("Failed to initialize llama.cpp backend")?;

        Ok(Self { backend })
    }

    /// Generate text using a loaded model
    ///
    /// # Arguments
    /// * `model_path` - Path to the GGUF model file
    /// * `prompt` - Text prompt to generate from
    /// * `max_tokens` - Maximum number of tokens to generate
    ///
    /// # Returns
    /// Generated text response
    pub fn generate_simple(
        &self,
        model_path: &Path,
        prompt: &str,
        max_tokens: usize,
    ) -> Result<String> {
        crate::logger::log_info(&format!("Loading model from: {}", model_path.display()));

        // Check if file exists and get size
        if let Ok(metadata) = std::fs::metadata(model_path) {
            crate::logger::log_info(&format!("Model file size: {} MB", metadata.len() / 1_000_000));
        } else {
            crate::logger::log_error(&format!("Model file not found: {}", model_path.display()));
            return Err(anyhow::anyhow!("Model file not found"));
        }

        // Try to load model with detailed error handling
        crate::logger::log_info("Initializing llama.cpp model...");
        let model_params = LlamaModelParams::default();
        crate::logger::log_info("Model params: n_gpu_layers=0");

        // Load model
        let model = LlamaModel::load_from_file(
            &self.backend,
            model_path,
            &model_params
        ).map_err(|e| {
            crate::logger::log_error(&format!("Failed to load model file: {:?}", e));
            e
        }).context("Failed to load model")?;

        crate::logger::log_info("Model loaded successfully, starting inference...");

        // Create context with reasonable defaults
        crate::logger::log_info("Creating inference context...");
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(std::num::NonZeroU32::new(2048).unwrap()))
            .with_n_batch(512);

        let mut context = model.new_context(&self.backend, ctx_params)
            .map_err(|e| {
                crate::logger::log_error(&format!("Failed to create context: {:?}", e));
                e
            })
            .context("Failed to create context")?;

        crate::logger::log_info("Context created successfully");

        // Tokenize the prompt
        crate::logger::log_info(&format!("Tokenizing prompt ({} chars)...", prompt.len()));
        let tokens = model.str_to_token(prompt, AddBos::Always)
            .map_err(|e| {
                crate::logger::log_error(&format!("Failed to tokenize prompt: {:?}", e));
                e
            })
            .context("Failed to tokenize prompt")?;

        crate::logger::log_info(&format!("Tokenized into {} tokens", tokens.len()));

        // Create batch
        crate::logger::log_info("Creating batch for prompt tokens...");
        let mut batch = LlamaBatch::new(512, 1);

        // Add prompt tokens to batch
        crate::logger::log_info("Adding tokens to batch...");
        let last_index = tokens.len() - 1;
        for (i, token) in tokens.iter().enumerate() {
            // Only the last token should generate logits
            let is_last = i == last_index;
            batch.add(*token, i as i32, &[0], is_last)
                .map_err(|e| {
                    crate::logger::log_error(&format!("Failed to add token {} to batch: {:?}", i, e));
                    e
                })
                .context("Failed to add token to batch")?;
        }

        crate::logger::log_info("All tokens added to batch, decoding prompt...");

        // Decode the prompt
        context.decode(&mut batch)
            .map_err(|e| {
                crate::logger::log_error(&format!("Failed to decode prompt: {:?}", e));
                e
            })
            .context("Failed to decode prompt")?;

        crate::logger::log_info("Prompt decoded successfully");

        // Clear batch for generation
        batch.clear();

        // Set up sampler chain
        crate::logger::log_info("Setting up sampler chain...");
        let mut sampler = LlamaSampler::chain_simple(vec![
            LlamaSampler::temp(0.7),       // Temperature for creativity
            LlamaSampler::top_k(40),       // Top-K sampling
            LlamaSampler::top_p(0.9, 1),   // Nucleus sampling (min_keep=1)
            LlamaSampler::dist(42),        // Random sampling with seed
        ]);

        // Generate tokens
        crate::logger::log_info(&format!("Starting token generation (max {} tokens)...", max_tokens));
        let mut response = String::new();
        let mut n_cur = tokens.len();

        for i in 0..max_tokens {
            // Sample the next token
            let new_token = sampler.sample(&context, -1);

            // Check if we hit end of stream
            if model.is_eog_token(new_token) {
                crate::logger::log_info(&format!("Hit end-of-generation token at iteration {}", i));
                break;
            }

            // Accept the token (update sampler state)
            sampler.accept(new_token);

            // Convert token to string
            let piece = model.token_to_str(new_token, Special::Tokenize)
                .unwrap_or_else(|e| {
                    crate::logger::log_warn(&format!("Failed to convert token to string: {:?}", e));
                    String::new()
                });
            response.push_str(&piece);

            // Log progress every 50 tokens
            if i % 50 == 0 {
                crate::logger::log_info(&format!("Generated {} tokens so far...", i));
            }

            // Add token to batch for next iteration
            batch.add(new_token, n_cur as i32, &[0], true)
                .map_err(|e| {
                    crate::logger::log_error(&format!("Failed to add generated token to batch at iteration {}: {:?}", i, e));
                    e
                })
                .context("Failed to add generated token to batch")?;

            // Decode the new token
            context.decode(&mut batch)
                .map_err(|e| {
                    crate::logger::log_error(&format!("Failed to decode generated token at iteration {}: {:?}", i, e));
                    e
                })
                .context("Failed to decode generated token")?;

            // Clear batch for next iteration
            batch.clear();

            n_cur += 1;
        }

        crate::logger::log_info(&format!("Inference completed, generated {} tokens", n_cur - tokens.len()));

        Ok(response.trim().to_string())
    }

    /// Generate text with streaming output (token-by-token)
    ///
    /// # Arguments
    /// * `model_path` - Path to the GGUF model file
    /// * `prompt` - Text prompt to generate from
    /// * `max_tokens` - Maximum number of tokens to generate
    /// * `on_token` - Callback function called for each generated token
    ///
    /// # Returns
    /// Complete generated text response
    pub fn generate_streaming<F>(
        &self,
        model_path: &Path,
        prompt: &str,
        max_tokens: usize,
        mut on_token: F,
    ) -> Result<String>
    where
        F: FnMut(&str) -> Result<()>,
    {
        crate::logger::log_info(&format!("Loading model for streaming inference from: {}", model_path.display()));

        // Check if file exists and get size
        if let Ok(metadata) = std::fs::metadata(model_path) {
            crate::logger::log_info(&format!("Model file size: {} MB", metadata.len() / 1_000_000));
        } else {
            crate::logger::log_error(&format!("Model file not found: {}", model_path.display()));
            return Err(anyhow::anyhow!("Model file not found"));
        }

        // Try to load model with detailed error handling
        crate::logger::log_info("Initializing llama.cpp model for streaming...");
        let model_params = LlamaModelParams::default();
        crate::logger::log_info("Model params: n_gpu_layers=0");

        // Load model
        let model = LlamaModel::load_from_file(
            &self.backend,
            model_path,
            &model_params
        ).map_err(|e| {
            crate::logger::log_error(&format!("Failed to load model file: {:?}", e));
            e
        }).context("Failed to load model")?;

        crate::logger::log_info("Model loaded successfully, starting streaming inference...");

        // Create context with reasonable defaults
        crate::logger::log_info("Creating inference context for streaming...");
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(std::num::NonZeroU32::new(2048).unwrap()))
            .with_n_batch(512);

        let mut context = model.new_context(&self.backend, ctx_params)
            .map_err(|e| {
                crate::logger::log_error(&format!("Failed to create streaming context: {:?}", e));
                e
            })
            .context("Failed to create context")?;

        crate::logger::log_info("Streaming context created successfully");

        // Tokenize the prompt
        crate::logger::log_info(&format!("Tokenizing prompt for streaming ({} chars)...", prompt.len()));
        let tokens = model.str_to_token(prompt, AddBos::Always)
            .map_err(|e| {
                crate::logger::log_error(&format!("Failed to tokenize streaming prompt: {:?}", e));
                e
            })
            .context("Failed to tokenize prompt")?;

        crate::logger::log_info(&format!("Tokenized into {} tokens for streaming", tokens.len()));

        // Create batch
        crate::logger::log_info("Creating batch for streaming prompt tokens...");
        let mut batch = LlamaBatch::new(512, 1);

        // Add prompt tokens to batch
        crate::logger::log_info("Adding tokens to streaming batch...");
        let last_index = tokens.len() - 1;
        for (i, token) in tokens.iter().enumerate() {
            let is_last = i == last_index;
            batch.add(*token, i as i32, &[0], is_last)
                .map_err(|e| {
                    crate::logger::log_error(&format!("Failed to add streaming token {} to batch: {:?}", i, e));
                    e
                })
                .context("Failed to add token to batch")?;
        }

        crate::logger::log_info("All tokens added to streaming batch, decoding prompt...");

        // Decode the prompt
        context.decode(&mut batch)
            .map_err(|e| {
                crate::logger::log_error(&format!("Failed to decode streaming prompt: {:?}", e));
                e
            })
            .context("Failed to decode prompt")?;

        crate::logger::log_info("Streaming prompt decoded successfully");

        // Clear batch for generation
        batch.clear();

        // Set up sampler chain
        crate::logger::log_info("Setting up streaming sampler chain...");
        let mut sampler = LlamaSampler::chain_simple(vec![
            LlamaSampler::temp(0.7),
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.9, 1),
            LlamaSampler::dist(42),
        ]);

        // Generate tokens
        crate::logger::log_info(&format!("Starting streaming token generation (max {} tokens)...", max_tokens));
        let mut response = String::new();
        let mut n_cur = tokens.len();

        for i in 0..max_tokens {
            // Sample the next token
            let new_token = sampler.sample(&context, -1);

            // Check if we hit end of stream
            if model.is_eog_token(new_token) {
                crate::logger::log_info(&format!("Hit end-of-generation token at streaming iteration {}", i));
                break;
            }

            // Accept the token (update sampler state)
            sampler.accept(new_token);

            // Convert token to string
            let piece = model.token_to_str(new_token, Special::Tokenize)
                .unwrap_or_else(|e| {
                    crate::logger::log_warn(&format!("Failed to convert streaming token to string: {:?}", e));
                    String::new()
                });

            // Stream the token to callback
            on_token(&piece)?;

            response.push_str(&piece);

            // Log progress every 50 tokens
            if i % 50 == 0 && i > 0 {
                crate::logger::log_info(&format!("Streamed {} tokens so far...", i));
            }

            // Add token to batch for next iteration
            batch.add(new_token, n_cur as i32, &[0], true)
                .map_err(|e| {
                    crate::logger::log_error(&format!("Failed to add streaming generated token to batch at iteration {}: {:?}", i, e));
                    e
                })
                .context("Failed to add generated token to batch")?;

            // Decode the new token
            context.decode(&mut batch)
                .map_err(|e| {
                    crate::logger::log_error(&format!("Failed to decode streaming generated token at iteration {}: {:?}", i, e));
                    e
                })
                .context("Failed to decode generated token")?;

            // Clear batch for next iteration
            batch.clear();

            n_cur += 1;
        }

        crate::logger::log_info(&format!("Streaming inference completed, generated {} tokens", n_cur - tokens.len()));

        Ok(response.trim().to_string())
    }
}

/// Create a RAG prompt from question and context chunks
///
/// Formats the prompt to instruct the model to answer based only on provided context
pub fn create_rag_prompt(question: &str, context_chunks: &[String]) -> String {
    let mut prompt = String::from("You are a helpful assistant that answers questions based on the provided context. Answer the question based only on the information given. If the answer is not in the context, say so.\n\n");

    prompt.push_str("Context:\n");
    for (i, chunk) in context_chunks.iter().enumerate() {
        prompt.push_str(&format!("[{}] {}\n\n", i + 1, chunk));
    }

    prompt.push_str(&format!("Question: {}\n\nAnswer:", question));
    prompt
}
