use serde::{Deserialize, Serialize};
use crate::hardware::HardwareProfile;
use crate::models::ModelInfo;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BestModelSelection {
    pub model: ModelInfo,
    pub explanation: String,
}

pub fn get_best_model_for_hardware(hardware: &HardwareProfile) -> BestModelSelection {
    let ram_gb = hardware.ram_total_gb;

    let (model_name, explanation_reason) = if ram_gb >= 64.0 {
        (
            "Qwen 2.5 32B Instruct (Q4)",
            "maximum intelligence for your high-end system"
        )
    } else if ram_gb >= 32.0 {
        (
            "Qwen 2.5 14B Instruct (Q4)",
            "very smart model for your system"
        )
    } else if ram_gb >= 16.0 {
        (
            "Qwen 2.5 7B Instruct (Q3)",
            "balanced intelligence and speed - recommended for most users"
        )
    } else if ram_gb >= 8.0 {
        (
            "Qwen 2.5 3B Instruct (Q4)",
            "fast and efficient for your system"
        )
    } else {
        (
            "Qwen 2.5 1.5B Instruct (Q4)",
            "lightweight model for minimal hardware"
        )
    };

    let model = find_model_by_name(model_name)
        .unwrap_or_else(|| get_fallback_model());

    let hardware_summary = hardware.get_hardware_summary();
    let explanation = format!("Best {} for your {}", explanation_reason, hardware_summary);

    BestModelSelection {
        model,
        explanation,
    }
}

fn find_model_by_name(name: &str) -> Option<ModelInfo> {
    let all_models = crate::models::get_available_models();
    all_models.into_iter().find(|m| m.name == name)
}

fn get_fallback_model() -> ModelInfo {
    ModelInfo {
        name: "Qwen 2.5 7B Instruct (Q3)".to_string(),
        description: "Balanced intelligence and speed - recommended for most users".to_string(),
        size_gb: 3.5,
        min_ram_gb: 8,
        recommended_ram_gb: 16,
        repo_url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF".to_string(),
        file_name: "qwen2.5-7b-instruct-q3_k_m.gguf".to_string(),
        checksum: "".to_string(),
        recommended_use: "Complex reasoning, technical docs, code analysis, mathematics, research".to_string(),
        performance_tier: "Balanced".to_string(),
        estimated_speed_tokens_per_sec: 45,
        context_length: 32768,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::{PerformanceTier, CpuVendor, Platform};

    fn create_test_hardware(ram_gb: f64) -> HardwareProfile {
        HardwareProfile {
            cpu_vendor: CpuVendor::AppleSilicon,
            cpu_brand: "Apple M2".to_string(),
            cpu_cores: 8,
            cpu_threads: 8,
            ram_total_gb: ram_gb,
            ram_available_gb: ram_gb * 0.7,
            has_gpu: true,
            gpu_vendor: Some("Apple".to_string()),
            gpu_name: Some("Apple GPU".to_string()),
            platform: Platform::MacOS,
            is_apple_silicon: true,
            storage_available_gb: 200.0,
            performance_tier: PerformanceTier::Good,
        }
    }

    #[test]
    fn test_ultra_high_end_selection() {
        let hardware = create_test_hardware(64.0);
        let selection = get_best_model_for_hardware(&hardware);
        assert!(selection.model.name.contains("32B"));
        assert!(!selection.explanation.is_empty());
    }

    #[test]
    fn test_high_end_selection() {
        let hardware = create_test_hardware(32.0);
        let selection = get_best_model_for_hardware(&hardware);
        assert!(selection.model.name.contains("14B"));
    }

    #[test]
    fn test_mid_range_selection() {
        let hardware = create_test_hardware(16.0);
        let selection = get_best_model_for_hardware(&hardware);
        assert!(selection.model.name.contains("7B"));
    }

    #[test]
    fn test_low_end_selection() {
        let hardware = create_test_hardware(8.0);
        let selection = get_best_model_for_hardware(&hardware);
        assert!(selection.model.name.contains("3B"));
        assert!(selection.model.size_gb <= 2.5);
    }

    #[test]
    fn test_minimal_selection() {
        let hardware = create_test_hardware(4.0);
        let selection = get_best_model_for_hardware(&hardware);
        assert!(selection.model.name.contains("1.5B"));
        assert!(selection.model.size_gb <= 1.5);
    }
}
