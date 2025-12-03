use anyhow::Result;
use crate::vector_search::SearchResult;
use crate::model_cache::ModelCache;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct RerankerConfig {
    pub top_n: usize,
    pub min_score: f32,
    pub enabled: bool,
    pub cache_ttl_seconds: u64,
}

impl Default for RerankerConfig {
    fn default() -> Self {
        Self {
            top_n: 5,
            min_score: 2.0,
            enabled: false,  // Disabled - LLM reranking is unreliable and slows down responses
            cache_ttl_seconds: 300,
        }
    }
}

#[derive(Clone)]
struct CachedScore {
    score: f32,
    timestamp: Instant,
}

pub struct Reranker {
    config: RerankerConfig,
    cache: Mutex<HashMap<String, CachedScore>>,
}

impl Reranker {
    pub fn new(config: RerankerConfig) -> Self {
        Self {
            config,
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn with_defaults() -> Self {
        Self::new(RerankerConfig::default())
    }

    pub fn rerank(
        &self,
        query: &str,
        chunks: Vec<SearchResult>,
        model_cache: &ModelCache,
    ) -> Result<Vec<SearchResult>> {
        if !self.config.enabled || chunks.is_empty() {
            return Ok(chunks);
        }

        let mut scored_chunks = Vec::new();

        for chunk in chunks {
            let cache_key = format!("{}:{}", query, chunk.chunk_id);

            let score = if let Some(cached) = self.get_cached_score(&cache_key) {
                crate::logger::log_info(&format!(
                    "Reranker: chunk {} cached score = {:.1}",
                    chunk.chunk_id, cached
                ));
                cached
            } else {
                let computed_score = self.score_chunk(query, &chunk.chunk_text, model_cache)?;
                crate::logger::log_info(&format!(
                    "Reranker: chunk {} (file: {}) scored {:.1} (min: {:.1})",
                    chunk.chunk_id, chunk.file_name, computed_score, self.config.min_score
                ));
                self.cache_score(&cache_key, computed_score);
                computed_score
            };

            if score >= self.config.min_score {
                let mut reranked_chunk = chunk;
                reranked_chunk.similarity = score / 10.0;
                scored_chunks.push(reranked_chunk);
            } else {
                crate::logger::log_warn(&format!(
                    "Reranker: chunk {} filtered out (score {:.1} < min {:.1})",
                    chunk.chunk_id, score, self.config.min_score
                ));
            }
        }

        scored_chunks.sort_by(|a, b| {
            b.similarity.partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored_chunks.truncate(self.config.top_n);

        Ok(scored_chunks)
    }

    pub fn optimize_context_window(
        &self,
        chunks: Vec<SearchResult>,
        conversation_context: &str,
        system_prompt: &str,
        max_context_tokens: usize,
    ) -> Vec<SearchResult> {
        let avg_chars_per_token = 4;
        let max_context_chars = max_context_tokens * avg_chars_per_token;

        let conversation_chars = conversation_context.len();
        let system_prompt_chars = system_prompt.len();

        let reserved_chars = conversation_chars + system_prompt_chars;

        if reserved_chars >= max_context_chars {
            crate::logger::log_warn(&format!(
                "Conversation and system prompt exceed context window ({} chars >= {} chars)",
                reserved_chars, max_context_chars
            ));
            return vec![];
        }

        let available_chars = max_context_chars - reserved_chars;

        let mut fitted_chunks = Vec::new();
        let mut used_chars = 0;

        for chunk in chunks {
            let chunk_chars = chunk.chunk_text.len();

            if used_chars + chunk_chars <= available_chars {
                fitted_chunks.push(chunk);
                used_chars += chunk_chars;
            } else {
                let remaining_chars = available_chars - used_chars;

                if remaining_chars > 200 {
                    let truncated_text = chunk.chunk_text
                        .chars()
                        .take(remaining_chars)
                        .collect::<String>();

                    let mut truncated_chunk = chunk;
                    truncated_chunk.chunk_text = truncated_text;
                    fitted_chunks.push(truncated_chunk);
                }

                break;
            }
        }

        crate::logger::log_info(&format!(
            "Context window optimization: fitted {} chunks using {} chars of {} available",
            fitted_chunks.len(), used_chars, available_chars
        ));

        fitted_chunks
    }

    fn get_cached_score(&self, key: &str) -> Option<f32> {
        let mut cache = match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                crate::logger::log_warn("Reranker cache mutex poisoned, recovering");
                poisoned.into_inner()
            }
        };

        if let Some(cached) = cache.get(key) {
            let ttl = Duration::from_secs(self.config.cache_ttl_seconds);
            if cached.timestamp.elapsed() < ttl {
                return Some(cached.score);
            }
            cache.remove(key);
        }

        None
    }

    fn cache_score(&self, key: &str, score: f32) {
        let mut cache = match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                crate::logger::log_warn("Reranker cache mutex poisoned, recovering");
                poisoned.into_inner()
            }
        };
        cache.insert(
            key.to_string(),
            CachedScore {
                score,
                timestamp: Instant::now(),
            },
        );
    }

    fn score_chunk(
        &self,
        query: &str,
        chunk_text: &str,
        model_cache: &ModelCache,
    ) -> Result<f32> {
        // Truncate chunk text for scoring prompt to avoid context overflow
        let truncated_chunk: String = chunk_text.chars().take(500).collect();
        let prompt = format!(
            "Rate 0-10 how relevant this text is to the query: {}\n\nText: {}\n\nRelevance score (just the number):",
            query, truncated_chunk
        );

        let response = model_cache.generate(&prompt, 10)?;  // Increased from 5 to 10 tokens

        crate::logger::log_info(&format!(
            "Reranker LLM response for query '{}': '{}'",
            query, response.trim()
        ));

        let score = self.parse_score(&response)?;

        Ok(score)
    }

    fn parse_score(&self, response: &str) -> Result<f32> {
        let trimmed = response.trim();

        for word in trimmed.split_whitespace() {
            let cleaned = word.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');

            if let Ok(score) = cleaned.parse::<f32>() {
                if score >= 0.0 && score <= 10.0 {
                    return Ok(score);
                }
            }
        }

        if trimmed.to_lowercase().contains("not relevant") ||
           trimmed.to_lowercase().contains("irrelevant") {
            return Ok(0.0);
        }

        if trimmed.to_lowercase().contains("very relevant") ||
           trimmed.to_lowercase().contains("highly relevant") {
            return Ok(9.0);
        }

        if trimmed.to_lowercase().contains("relevant") {
            return Ok(7.0);
        }

        Ok(5.0)
    }

    pub fn clear_cache(&self) {
        let mut cache = match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                crate::logger::log_warn("Reranker cache mutex poisoned during clear, recovering");
                poisoned.into_inner()
            }
        };
        cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_score_valid() {
        let reranker = Reranker::with_defaults();

        assert_eq!(reranker.parse_score("8").unwrap(), 8.0);
        assert_eq!(reranker.parse_score("8.5").unwrap(), 8.5);
        assert_eq!(reranker.parse_score("The score is 7").unwrap(), 7.0);
        assert_eq!(reranker.parse_score("Score: 9.2").unwrap(), 9.2);
    }

    #[test]
    fn test_parse_score_invalid() {
        let reranker = Reranker::with_defaults();

        assert_eq!(reranker.parse_score("not relevant").unwrap(), 0.0);
        assert_eq!(reranker.parse_score("very relevant").unwrap(), 9.0);
        assert_eq!(reranker.parse_score("relevant").unwrap(), 7.0);
        assert_eq!(reranker.parse_score("unclear response").unwrap(), 5.0);
    }
}
