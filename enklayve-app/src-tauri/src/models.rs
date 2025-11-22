use serde::{Deserialize, Serialize};
use crate::hardware::{HardwareProfile, PerformanceTier};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub description: String,
    pub size_gb: f32,
    pub min_ram_gb: u32,
    pub recommended_ram_gb: u32,
    pub repo_url: String,
    pub file_name: String,
    pub checksum: String,
    pub recommended_use: String,
    pub performance_tier: String,
    pub estimated_speed_tokens_per_sec: u32,
    pub context_length: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CompatibilityLevel {
    Excellent,      // Perfect match, will run great
    Good,           // Will run well
    Acceptable,     // Will run but may be slow
    Poor,           // Will run but very slow
    Incompatible,   // Not enough RAM
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRecommendation {
    pub model: ModelInfo,
    pub compatibility: CompatibilityLevel,
    pub is_recommended: bool,
    pub estimated_speed: String,
    pub warnings: Vec<String>,
    pub benefits: Vec<String>,
}

/// Get the comprehensive list of available models suitable for RAG
pub fn get_available_models() -> Vec<ModelInfo> {
    vec![
        // Ultra High-end models (64GB+ RAM)
        ModelInfo {
            name: "Llama 3.1 70B Instruct (Q4)".to_string(),
            description: "Flagship model with exceptional reasoning and knowledge - best for complex RAG".to_string(),
            size_gb: 40.0,
            min_ram_gb: 48,
            recommended_ram_gb: 64,
            repo_url: "https://huggingface.co/bartowski/Meta-Llama-3.1-70B-Instruct-GGUF".to_string(),
            file_name: "Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Complex reasoning, research, professional writing, detailed analysis".to_string(),
            performance_tier: "Excellent".to_string(),
            estimated_speed_tokens_per_sec: 10,
            context_length: 128000,
        },
        ModelInfo {
            name: "Qwen2.5 72B Instruct (Q4)".to_string(),
            description: "State-of-the-art model for technical content and reasoning".to_string(),
            size_gb: 42.0,
            min_ram_gb: 50,
            recommended_ram_gb: 64,
            repo_url: "https://huggingface.co/Qwen/Qwen2.5-72B-Instruct-GGUF".to_string(),
            file_name: "qwen2.5-72b-instruct-q4_k_m.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Advanced technical docs, complex coding, mathematics, multilingual RAG".to_string(),
            performance_tier: "Excellent".to_string(),
            estimated_speed_tokens_per_sec: 10,
            context_length: 131072,
        },

        // High-end models (32GB+ RAM)
        ModelInfo {
            name: "Qwen2.5 32B Instruct (Q4)".to_string(),
            description: "Powerful model for technical and coding tasks with excellent RAG performance".to_string(),
            size_gb: 19.0,
            min_ram_gb: 24,
            recommended_ram_gb: 32,
            repo_url: "https://huggingface.co/Qwen/Qwen2.5-32B-Instruct-GGUF".to_string(),
            file_name: "qwen2.5-32b-instruct-q4_k_m.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Advanced coding, technical writing, mathematics, document analysis".to_string(),
            performance_tier: "Excellent".to_string(),
            estimated_speed_tokens_per_sec: 15,
            context_length: 32768,
        },
        ModelInfo {
            name: "Mixtral 8x7B Instruct (Q4)".to_string(),
            description: "Mixture of Experts model with excellent general performance".to_string(),
            size_gb: 26.0,
            min_ram_gb: 32,
            recommended_ram_gb: 48,
            repo_url: "https://huggingface.co/TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF".to_string(),
            file_name: "mixtral-8x7b-instruct-v0.1.Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "General RAG, multilingual support, balanced performance".to_string(),
            performance_tier: "Excellent".to_string(),
            estimated_speed_tokens_per_sec: 20,
            context_length: 32768,
        },
        ModelInfo {
            name: "Llama 3.1 45B Instruct (Q4)".to_string(),
            description: "Large instruction-following model with strong RAG capabilities".to_string(),
            size_gb: 26.0,
            min_ram_gb: 32,
            recommended_ram_gb: 40,
            repo_url: "https://huggingface.co/bartowski/Meta-Llama-3.1-45B-Instruct-GGUF".to_string(),
            file_name: "Meta-Llama-3.1-45B-Instruct-Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Professional writing, detailed analysis, complex reasoning".to_string(),
            performance_tier: "Excellent".to_string(),
            estimated_speed_tokens_per_sec: 12,
            context_length: 128000,
        },

        // Mid-high range models (16-24GB RAM)
        ModelInfo {
            name: "Llama 3.1 8B Instruct (Q4)".to_string(),
            description: "Meta's latest Llama model, great for general documents".to_string(),
            size_gb: 4.9,
            min_ram_gb: 8,
            recommended_ram_gb: 12,
            repo_url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF".to_string(),
            file_name: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "General document Q&A, summarization, analysis".to_string(),
            performance_tier: "Good".to_string(),
            estimated_speed_tokens_per_sec: 40,
            context_length: 131072,
        },
        ModelInfo {
            name: "Mistral Nemo 12B Instruct (Q4)".to_string(),
            description: "Fast and capable model with strong instruction following".to_string(),
            size_gb: 7.2,
            min_ram_gb: 10,
            recommended_ram_gb: 16,
            repo_url: "https://huggingface.co/bartowski/Mistral-Nemo-Instruct-2407-GGUF".to_string(),
            file_name: "Mistral-Nemo-Instruct-2407-Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "General RAG, document Q&A, chat with context".to_string(),
            performance_tier: "Good".to_string(),
            estimated_speed_tokens_per_sec: 30,
            context_length: 128000,
        },

        // Mid-range models (8-16GB RAM) - Sweet spot for RAG
        ModelInfo {
            name: "Llama 3.1 8B Instruct (Q4)".to_string(),
            description: "Excellent general-purpose model with strong RAG performance".to_string(),
            size_gb: 4.7,
            min_ram_gb: 6,
            recommended_ram_gb: 8,
            repo_url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF".to_string(),
            file_name: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "General RAG, document Q&A, reasoning, code generation".to_string(),
            performance_tier: "Good".to_string(),
            estimated_speed_tokens_per_sec: 40,
            context_length: 128000,
        },
        ModelInfo {
            name: "Qwen2.5 7B Instruct (Q4)".to_string(),
            description: "Excellent for technical content and multilingual RAG".to_string(),
            size_gb: 4.4,
            min_ram_gb: 6,
            recommended_ram_gb: 8,
            repo_url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF".to_string(),
            file_name: "qwen2.5-7b-instruct-q4_k_m.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Technical docs, code analysis, math, multilingual documents".to_string(),
            performance_tier: "Good".to_string(),
            estimated_speed_tokens_per_sec: 45,
            context_length: 32768,
        },
        ModelInfo {
            name: "Mistral 7B Instruct v0.3 (Q4)".to_string(),
            description: "Fast and efficient model for general RAG use".to_string(),
            size_gb: 4.1,
            min_ram_gb: 6,
            recommended_ram_gb: 8,
            repo_url: "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.3-GGUF".to_string(),
            file_name: "mistral-7b-instruct-v0.3.Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Document chat, creative writing with context, general assistance".to_string(),
            performance_tier: "Good".to_string(),
            estimated_speed_tokens_per_sec: 50,
            context_length: 32768,
        },
        ModelInfo {
            name: "Llama 3.2 11B Vision Instruct (Q4)".to_string(),
            description: "Multimodal model for text and image RAG tasks".to_string(),
            size_gb: 6.8,
            min_ram_gb: 10,
            recommended_ram_gb: 12,
            repo_url: "https://huggingface.co/bartowski/Llama-3.2-11B-Vision-Instruct-GGUF".to_string(),
            file_name: "Llama-3.2-11B-Vision-Instruct-Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Document analysis with images, multimodal RAG, visual Q&A".to_string(),
            performance_tier: "Good".to_string(),
            estimated_speed_tokens_per_sec: 35,
            context_length: 128000,
        },

        ModelInfo {
            name: "Gemma 2 9B Instruct (Q4)".to_string(),
            description: "Google's efficient model with good RAG capabilities".to_string(),
            size_gb: 5.4,
            min_ram_gb: 8,
            recommended_ram_gb: 10,
            repo_url: "https://huggingface.co/bartowski/gemma-2-9b-it-GGUF".to_string(),
            file_name: "gemma-2-9b-it-Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "General document analysis, balanced performance".to_string(),
            performance_tier: "Good".to_string(),
            estimated_speed_tokens_per_sec: 40,
            context_length: 8192,
        },
        ModelInfo {
            name: "DeepSeek Coder 33B Instruct (Q4)".to_string(),
            description: "Specialized for technical documentation and code-related RAG".to_string(),
            size_gb: 19.5,
            min_ram_gb: 24,
            recommended_ram_gb: 32,
            repo_url: "https://huggingface.co/TheBloke/deepseek-coder-33b-instruct-GGUF".to_string(),
            file_name: "deepseek-coder-33b-instruct.Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Code analysis, technical documentation, API docs, software manuals".to_string(),
            performance_tier: "Excellent".to_string(),
            estimated_speed_tokens_per_sec: 15,
            context_length: 16384,
        },
        ModelInfo {
            name: "CodeLlama 34B Instruct (Q4)".to_string(),
            description: "Meta's code-specialized model excellent for technical RAG".to_string(),
            size_gb: 19.0,
            min_ram_gb: 24,
            recommended_ram_gb: 32,
            repo_url: "https://huggingface.co/TheBloke/CodeLlama-34B-Instruct-GGUF".to_string(),
            file_name: "codellama-34b-instruct.Q4_K_M.gguf".to_string(),
            checksum: "".to_string(),
            recommended_use: "Programming books, technical specs, architecture docs, code repositories".to_string(),
            performance_tier: "Excellent".to_string(),
            estimated_speed_tokens_per_sec: 15,
            context_length: 16384,
        },
    ]
}

/// Get models recommended for specific hardware
pub fn get_recommended_models(hardware: &HardwareProfile) -> Vec<ModelRecommendation> {
    let all_models = get_available_models();
    let mut recommendations: Vec<ModelRecommendation> = all_models
        .into_iter()
        .map(|model| evaluate_model_compatibility(&model, hardware))
        .collect();

    // Sort by compatibility level and then by size (larger is generally better if compatible)
    recommendations.sort_by(|a, b| {
        let compat_order = |c: &CompatibilityLevel| -> i32 {
            match c {
                CompatibilityLevel::Excellent => 0,
                CompatibilityLevel::Good => 1,
                CompatibilityLevel::Acceptable => 2,
                CompatibilityLevel::Poor => 3,
                CompatibilityLevel::Incompatible => 4,
            }
        };

        let a_order = compat_order(&a.compatibility);
        let b_order = compat_order(&b.compatibility);

        if a_order != b_order {
            a_order.cmp(&b_order)
        } else {
            // Within same compatibility, prefer larger models
            b.model.size_gb.partial_cmp(&a.model.size_gb).unwrap()
        }
    });

    recommendations
}

/// Evaluate how well a model matches the hardware
fn evaluate_model_compatibility(
    model: &ModelInfo,
    hardware: &HardwareProfile,
) -> ModelRecommendation {
    let available_ram = hardware.ram_total_gb;
    let mut warnings = Vec::new();
    let mut benefits = Vec::new();

    // Determine compatibility level
    let compatibility = if available_ram < model.min_ram_gb as f64 {
        warnings.push(format!(
            "Requires {} GB RAM but only {:.1} GB available",
            model.min_ram_gb, available_ram
        ));
        CompatibilityLevel::Incompatible
    } else if available_ram >= model.recommended_ram_gb as f64 {
        benefits.push("Plenty of RAM for smooth performance".to_string());
        if hardware.is_apple_silicon {
            benefits.push("Optimized for Apple Silicon unified memory".to_string());
        }
        CompatibilityLevel::Excellent
    } else if available_ram >= (model.min_ram_gb as f64 + 2.0) {
        benefits.push("Sufficient RAM for good performance".to_string());
        CompatibilityLevel::Good
    } else if available_ram >= model.min_ram_gb as f64 {
        warnings.push("Meets minimum RAM but may be slower".to_string());
        warnings.push("Consider closing other applications".to_string());
        CompatibilityLevel::Acceptable
    } else {
        warnings.push("Below recommended specifications".to_string());
        CompatibilityLevel::Poor
    };

    // Check storage space
    if hardware.storage_available_gb < (model.size_gb as f64 + 5.0) {
        warnings.push(format!(
            "Needs {:.1} GB storage, only {:.1} GB available",
            model.size_gb + 5.0,
            hardware.storage_available_gb
        ));
    }

    // Performance tier matching
    let is_recommended = match (&hardware.performance_tier, model.performance_tier.as_str()) {
        (PerformanceTier::Excellent, "Excellent") => {
            benefits.push("Perfect match for your high-end hardware".to_string());
            true
        }
        (PerformanceTier::Good, "Good") => {
            benefits.push("Ideal for your system".to_string());
            true
        }
        (PerformanceTier::Fair, "Fair") => {
            benefits.push("Well-matched to your hardware".to_string());
            true
        }
        (PerformanceTier::Poor, "Poor") => {
            benefits.push("Best option for your system".to_string());
            true
        }
        (PerformanceTier::Excellent, "Good" | "Fair") => {
            benefits.push("Will run very fast on your hardware".to_string());
            false
        }
        (PerformanceTier::Good, "Fair" | "Poor") => {
            benefits.push("Fast performance expected".to_string());
            false
        }
        (PerformanceTier::Fair | PerformanceTier::Good, "Excellent") => {
            warnings.push("May be slower than optimal".to_string());
            false
        }
        _ => false,
    };

    // Estimate speed category
    let estimated_speed = if hardware.is_apple_silicon {
        match &hardware.performance_tier {
            PerformanceTier::Excellent => "Very Fast (50-100+ tokens/sec)".to_string(),
            PerformanceTier::Good => "Fast (30-50 tokens/sec)".to_string(),
            PerformanceTier::Fair => "Moderate (15-30 tokens/sec)".to_string(),
            PerformanceTier::Poor => "Slow (5-15 tokens/sec)".to_string(),
            PerformanceTier::Minimal => "Very Slow (<5 tokens/sec)".to_string(),
        }
    } else {
        match &hardware.performance_tier {
            PerformanceTier::Excellent => "Fast (30-60 tokens/sec)".to_string(),
            PerformanceTier::Good => "Moderate (20-40 tokens/sec)".to_string(),
            PerformanceTier::Fair => "Slow (10-20 tokens/sec)".to_string(),
            PerformanceTier::Poor => "Very Slow (3-10 tokens/sec)".to_string(),
            PerformanceTier::Minimal => "Extremely Slow (<3 tokens/sec)".to_string(),
        }
    };

    // Add Apple Silicon specific benefits
    if hardware.is_apple_silicon && hardware.cpu_cores >= 8 {
        benefits.push("High-performance cores will accelerate inference".to_string());
    }

    // Add context length benefit if large
    if model.context_length >= 100000 {
        benefits.push(format!(
            "Large context window ({} tokens) for extensive documents",
            model.context_length
        ));
    }

    ModelRecommendation {
        model: model.clone(),
        compatibility,
        is_recommended,
        estimated_speed,
        warnings,
        benefits,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::{HardwareProfile, PerformanceTier, CpuVendor, Platform};

    fn create_test_hardware(ram_gb: f64, tier: PerformanceTier) -> HardwareProfile {
        HardwareProfile {
            cpu_vendor: CpuVendor::AppleSilicon,
            cpu_brand: "Apple M2 Pro".to_string(),
            cpu_cores: 10,
            cpu_threads: 10,
            ram_total_gb: ram_gb,
            ram_available_gb: ram_gb * 0.7,
            has_gpu: true,
            gpu_vendor: Some("Apple".to_string()),
            gpu_name: Some("Apple GPU".to_string()),
            platform: Platform::MacOS,
            is_apple_silicon: true,
            storage_available_gb: 200.0,
            performance_tier: tier,
        }
    }

    #[test]
    fn test_model_count() {
        let models = get_available_models();
        assert!(models.len() >= 15, "Should have at least 15 RAG-capable models");
        println!("Total RAG-capable models available: {}", models.len());

        // Verify we have no tiny models (< 3B)
        let tiny_models: Vec<_> = models.iter().filter(|m| m.size_gb < 1.5).collect();
        assert_eq!(tiny_models.len(), 0, "Should have no models smaller than 3B");
    }

    #[test]
    fn test_recommendation_for_excellent_hardware() {
        let hardware = create_test_hardware(64.0, PerformanceTier::Excellent);
        let recommendations = get_recommended_models(&hardware);

        println!("\nRecommendations for Excellent tier (64GB RAM):");
        for (i, rec) in recommendations.iter().take(3).enumerate() {
            println!(
                "{}. {} - {:?} ({})",
                i + 1,
                rec.model.name,
                rec.compatibility,
                rec.estimated_speed
            );
        }

        // Should have at least one recommended model
        let has_recommended = recommendations.iter().any(|r| r.is_recommended);
        assert!(has_recommended, "Should have at least one recommended model");

        // Top recommendation should be compatible
        assert!(
            !matches!(recommendations[0].compatibility, CompatibilityLevel::Incompatible),
            "Top recommendation should be compatible"
        );
    }

    #[test]
    fn test_recommendation_for_good_hardware() {
        let hardware = create_test_hardware(16.0, PerformanceTier::Good);
        let recommendations = get_recommended_models(&hardware);

        println!("\nRecommendations for Good tier (16GB RAM):");
        for (i, rec) in recommendations.iter().take(3).enumerate() {
            println!(
                "{}. {} - {:?}",
                i + 1, rec.model.name, rec.compatibility
            );
        }

        // Should have multiple compatible models
        let compatible_count = recommendations
            .iter()
            .filter(|r| !matches!(r.compatibility, CompatibilityLevel::Incompatible))
            .count();

        assert!(compatible_count >= 5, "Should have at least 5 compatible models");
    }

    #[test]
    fn test_recommendation_for_fair_hardware() {
        let hardware = create_test_hardware(8.0, PerformanceTier::Fair);
        let recommendations = get_recommended_models(&hardware);

        println!("\nRecommendations for Fair tier (8GB RAM):");
        for (i, rec) in recommendations.iter().take(3).enumerate() {
            println!(
                "{}. {} - {:?}",
                i + 1, rec.model.name, rec.compatibility
            );
        }

        // Should have some compatible models
        let compatible_count = recommendations
            .iter()
            .filter(|r| !matches!(r.compatibility, CompatibilityLevel::Incompatible))
            .count();

        assert!(compatible_count >= 3, "Should have at least 3 compatible models");
    }

    #[test]
    fn test_incompatible_model_detection() {
        let hardware = create_test_hardware(4.0, PerformanceTier::Poor);
        let recommendations = get_recommended_models(&hardware);

        println!("\nRecommendations for Poor tier (4GB RAM):");
        for (i, rec) in recommendations.iter().take(5).enumerate() {
            println!(
                "{}. {} - {:?} - Warnings: {:?}",
                i + 1,
                rec.model.name,
                rec.compatibility,
                rec.warnings
            );
        }

        // Large models (70B+) should be incompatible with 4GB RAM
        let large_models: Vec<_> = recommendations
            .iter()
            .filter(|r| r.model.size_gb > 30.0)
            .collect();

        for model in large_models {
            assert!(
                matches!(model.compatibility, CompatibilityLevel::Incompatible),
                "Large models ({}GB) should be incompatible with 4GB RAM",
                model.model.size_gb
            );
            assert!(!model.warnings.is_empty(), "Should have warnings for large models");
        }

        // Should have at least some compatible models even with 4GB
        let compatible_count = recommendations
            .iter()
            .filter(|r| !matches!(r.compatibility, CompatibilityLevel::Incompatible))
            .count();

        assert!(compatible_count >= 2, "Should have at least 2 compatible models for 4GB RAM");
    }
}
