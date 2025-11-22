use anyhow::Result;
use tauri::AppHandle;
use crate::embeddings::{Embedding, EmbeddingGenerator};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchResult {
    pub chunk_id: i64,
    pub document_id: i64,
    pub chunk_text: String,
    pub chunk_index: i64,
    pub similarity: f32,
    pub file_name: String,
}

/// Search for relevant chunks using vector similarity
pub async fn search_similar_chunks(
    query: &str,
    app_handle: &AppHandle,
    top_k: usize,
) -> Result<Vec<SearchResult>> {
    // Generate embedding for the query
    let generator = EmbeddingGenerator::new()?;
    let query_embedding = generator.generate_embedding(query)?;

    // Get database connection
    let conn = crate::database::get_connection(app_handle)?;

    // Retrieve all chunks with embeddings
    let mut stmt = conn.prepare(
        "SELECT c.id, c.document_id, c.chunk_text, c.chunk_index, c.embedding, d.file_name
         FROM chunks c
         JOIN documents d ON c.document_id = d.id
         WHERE c.embedding IS NOT NULL"
    )?;

    let chunks = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,        // chunk_id
            row.get::<_, i64>(1)?,        // document_id
            row.get::<_, String>(2)?,     // chunk_text
            row.get::<_, i64>(3)?,        // chunk_index
            row.get::<_, Vec<u8>>(4)?,    // embedding
            row.get::<_, String>(5)?,     // file_name
        ))
    })?;

    // Calculate similarities and collect results
    let mut results: Vec<SearchResult> = Vec::new();

    for chunk_result in chunks {
        let (chunk_id, document_id, chunk_text, chunk_index, embedding_bytes, file_name) =
            chunk_result?;

        // Deserialize embedding
        if let Ok(chunk_embedding) = Embedding::from_bytes(&embedding_bytes) {
            // Calculate cosine similarity
            let similarity = query_embedding.cosine_similarity(&chunk_embedding);

            results.push(SearchResult {
                chunk_id,
                document_id,
                chunk_text,
                chunk_index,
                similarity,
                file_name,
            });
        }
    }

    // Sort by similarity (descending) and take top_k
    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap());
    results.truncate(top_k);

    Ok(results)
}

/// Get chunks from a specific document
pub async fn get_document_chunks(
    document_id: i64,
    app_handle: &AppHandle,
) -> Result<Vec<SearchResult>> {
    let conn = crate::database::get_connection(app_handle)?;

    let mut stmt = conn.prepare(
        "SELECT c.id, c.document_id, c.chunk_text, c.chunk_index, d.file_name
         FROM chunks c
         JOIN documents d ON c.document_id = d.id
         WHERE c.document_id = ?1
         ORDER BY c.chunk_index"
    )?;

    let chunks = stmt.query_map([document_id], |row| {
        Ok(SearchResult {
            chunk_id: row.get(0)?,
            document_id: row.get(1)?,
            chunk_text: row.get(2)?,
            chunk_index: row.get(3)?,
            similarity: 1.0, // Not a similarity search
            file_name: row.get(4)?,
        })
    })?;

    chunks.collect::<Result<Vec<_>, _>>().map_err(|e| e.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_result_serialization() {
        let result = SearchResult {
            chunk_id: 1,
            document_id: 1,
            chunk_text: "Test chunk".to_string(),
            chunk_index: 0,
            similarity: 0.95,
            file_name: "test.pdf".to_string(),
        };

        // Should be serializable
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("Test chunk"));
        assert!(json.contains("0.95"));
    }
}
