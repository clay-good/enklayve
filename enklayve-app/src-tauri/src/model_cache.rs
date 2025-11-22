use anyhow::{Context, Result};
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{AddBos, LlamaModel, Special, params::LlamaModelParams},
    sampling::LlamaSampler,
};
use std::sync::{Arc, Mutex};
use std::num::NonZeroU32;

/// A cached model with its context
pub struct CachedModel {
    backend: LlamaBackend,
    model: LlamaModel,
    _path: String,
}

impl CachedModel {
    /// Load a model from disk with GPU acceleration
    pub fn load(path: &str) -> Result<Self> {
        crate::logger::log_info(&format!("Loading model into cache from: {}", path));

        // Initialize backend
        let backend = LlamaBackend::init()?;

        // Log GPU support
        #[cfg(target_os = "macos")]
        crate::logger::log_info("🚀 Metal GPU support enabled for Apple Silicon");

        #[cfg(target_os = "windows")]
        crate::logger::log_info("🚀 CUDA GPU support enabled for NVIDIA GPUs");

        #[cfg(target_os = "linux")]
        crate::logger::log_info("⚙️  CPU inference mode (enable CUDA for GPU acceleration)");

        // Detect hardware and calculate optimal GPU layers
        let hardware = crate::hardware::HardwareProfile::detect()
            .unwrap_or_else(|_| {
                crate::logger::log_warn("Failed to detect hardware, using CPU-only");
                // Create minimal default profile
                crate::hardware::HardwareProfile {
                    cpu_vendor: crate::hardware::CpuVendor::Unknown,
                    cpu_brand: "Unknown".to_string(),
                    cpu_cores: 1,
                    cpu_threads: 1,
                    ram_total_gb: 8.0,
                    ram_available_gb: 4.0,
                    has_gpu: false,
                    gpu_vendor: None,
                    gpu_name: None,
                    platform: crate::hardware::Platform::Unknown,
                    is_apple_silicon: false,
                    storage_available_gb: 100.0,
                    performance_tier: crate::hardware::PerformanceTier::Fair,
                }
            });

        let gpu_layers = hardware.get_optimal_gpu_layers(Some(path));
        crate::logger::log_info(&format!(
            "Hardware detected: {:.1} GB RAM, {} - Using {} GPU layers for this model",
            hardware.ram_total_gb,
            if hardware.is_apple_silicon { "Apple Silicon" } else { "x86" },
            gpu_layers
        ));

        let model_params = LlamaModelParams::default()
            .with_n_gpu_layers(gpu_layers)
            .with_use_mlock(false);  // Don't lock memory pages (allows system to manage RAM efficiently)

        let model = LlamaModel::load_from_file(&backend, path, &model_params)
            .context("Failed to load model")?;

        crate::logger::log_info(&format!(
            "Model loaded into cache successfully with {} GPU layers",
            gpu_layers
        ));

        Ok(CachedModel {
            backend,
            model,
            _path: path.to_string(),
        })
    }

    /// Generate a response using the cached model
    pub fn generate(&self, prompt: &str, max_tokens: u32) -> Result<String> {
        crate::logger::log_info("Generating using cached model...");

        // Create context for this generation
        // Larger context window to handle RAG with 4 document chunks
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(NonZeroU32::new(8192).unwrap()))
            .with_n_batch(2048);  // Large batch size for fast prompt processing

        let mut context = self.model.new_context(&self.backend, ctx_params)
            .context("Failed to create context")?;

        // Tokenize the prompt
        let tokens = self.model.str_to_token(prompt, AddBos::Always)
            .context("Failed to tokenize prompt")?;

        crate::logger::log_info(&format!("Tokenized into {} tokens", tokens.len()));

        // Check if prompt is too large for context window
        if tokens.len() > 7000 {
            crate::logger::log_error(&format!("Prompt too large: {} tokens exceeds safe limit of 7000 tokens", tokens.len()));
            anyhow::bail!("Prompt is too large ({} tokens). Try asking a shorter question or removing some documents.", tokens.len());
        }

        // Create batch and process prompt tokens in chunks if needed
        // Use larger batch for prompt processing (many tokens at once)
        // But smaller batch for generation (one token at a time)
        let prompt_batch_size = 2048;  // Large batches for prompt
        let mut batch = LlamaBatch::new(prompt_batch_size, 1);
        let batch_size = prompt_batch_size;

        // Process tokens in batches
        for chunk_start in (0..tokens.len()).step_by(batch_size) {
            batch.clear();
            let chunk_end = std::cmp::min(chunk_start + batch_size, tokens.len());
            let is_final_batch = chunk_end == tokens.len();

            for (i, token) in tokens[chunk_start..chunk_end].iter().enumerate() {
                let global_pos = chunk_start + i;
                let is_last = is_final_batch && (i == chunk_end - chunk_start - 1);
                batch.add(*token, global_pos as i32, &[0], is_last)
                    .context("Failed to add token to batch")?;
            }

            // Decode this batch
            context.decode(&mut batch)
                .context("Failed to decode prompt batch")?;
        }

        batch.clear();

        // Set up sampler chain (heavily optimized for speed while maintaining quality)
        let mut sampler = LlamaSampler::chain_simple(vec![
            LlamaSampler::temp(0.2),   // Very low temp for faster, deterministic responses
            LlamaSampler::top_k(10),    // Reduced from 20 for faster sampling
            LlamaSampler::top_p(0.9, 1), // Slightly increased for quality
            LlamaSampler::dist(42),
        ]);

        // Generate tokens
        let mut response = String::new();
        let mut n_cur = tokens.len();

        for i in 0..max_tokens {
            let new_token = sampler.sample(&context, -1);

            if self.model.is_eog_token(new_token) {
                crate::logger::log_info(&format!("Hit end-of-generation token at iteration {}", i));
                break;
            }

            sampler.accept(new_token);

            let piece = self.model.token_to_str(new_token, Special::Tokenize)
                .unwrap_or_else(|_| String::new());
            response.push_str(&piece);

            if i % 50 == 0 && i > 0 {
                crate::logger::log_info(&format!("Generated {} tokens so far...", i));
            }

            // Add token to batch for next iteration
            batch.add(new_token, n_cur as i32, &[0], true)
                .context("Failed to add generated token to batch")?;

            // Decode the batch
            context.decode(&mut batch)
                .context("Failed to decode generated token")?;

            batch.clear();
            n_cur += 1;
        }

        crate::logger::log_info(&format!("Generated {} tokens total", response.split_whitespace().count()));
        Ok(response)
    }
}

/// Global model cache manager
pub struct ModelCache {
    current_model: Arc<Mutex<Option<CachedModel>>>,
    current_path: Arc<Mutex<Option<String>>>,
}

impl ModelCache {
    pub fn new() -> Self {
        ModelCache {
            current_model: Arc::new(Mutex::new(None)),
            current_path: Arc::new(Mutex::new(None)),
        }
    }

    /// Get or load a model, caching it for future use
    pub fn get_or_load(&self, path: &str) -> Result<String> {
        let current_path = self.current_path.lock().unwrap();

        // Check if we already have this model loaded
        if let Some(cached_path) = current_path.as_ref() {
            if cached_path == path {
                crate::logger::log_info("Using already-loaded model from cache");
                drop(current_path);
                return Ok("cached".to_string());
            }
        }
        drop(current_path);

        // Need to load new model
        crate::logger::log_info(&format!("Loading new model: {}", path));
        let model = CachedModel::load(path)?;

        // Store in cache
        *self.current_model.lock().unwrap() = Some(model);
        *self.current_path.lock().unwrap() = Some(path.to_string());

        Ok("loaded".to_string())
    }

    /// Generate using the cached model
    pub fn generate(&self, prompt: &str, max_tokens: u32) -> Result<String> {
        let model_guard = self.current_model.lock().unwrap();

        match model_guard.as_ref() {
            Some(model) => model.generate(prompt, max_tokens),
            None => Err(anyhow::anyhow!("No model loaded in cache")),
        }
    }

    /// Clear the cache
    pub fn clear(&self) {
        crate::logger::log_info("Clearing model cache");
        *self.current_model.lock().unwrap() = None;
        *self.current_path.lock().unwrap() = None;
    }
}
