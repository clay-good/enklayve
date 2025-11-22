use anyhow::{Result, Context};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMetadata {
    pub id: i64,
    pub file_name: String,
    pub file_path: String,
    pub file_type: String,
    pub upload_date: i64,
    pub size_bytes: i64,
    pub chunks_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub metadata: DocumentMetadata,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentChunk {
    pub id: i64,
    pub document_id: i64,
    pub chunk_text: String,
    pub chunk_index: i64,
    pub page_number: Option<i64>,
}

/// Upload and process a document
pub async fn upload_document(file_path: String, app_handle: &AppHandle) -> Result<DocumentMetadata> {
    crate::logger::log_info(&format!("Starting document upload: {}", file_path));

    let path = Path::new(&file_path);

    if !path.exists() {
        crate::logger::log_error(&format!("File does not exist: {}", file_path));
        anyhow::bail!("File does not exist: {}", file_path);
    }

    // Detect file type
    let file_type = detect_file_type(path)?;

    // Extract text based on file type
    let content = extract_text(path, &file_type, app_handle).await?;

    // Chunk the document
    let chunks = chunk_text(&content, 800, 200)?;

    // Get file metadata
    let metadata = std::fs::metadata(path)?;
    let size_bytes = metadata.len() as i64;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Get current timestamp
    let upload_date = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_secs() as i64;

    // Store in database
    let conn = crate::database::get_connection(app_handle)?;

    conn.execute(
        "INSERT INTO documents (file_name, file_path, file_type, upload_date, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![file_name, file_path, file_type, upload_date, size_bytes],
    )?;

    let document_id = conn.last_insert_rowid();

    // Generate embeddings for chunks
    crate::logger::log_info(&format!("Generating embeddings for {} chunks...", chunks.len()));
    let embedding_generator = crate::embeddings::EmbeddingGenerator::new()?;

    // Store chunks with embeddings
    for (index, chunk) in chunks.iter().enumerate() {
        // Generate embedding for this chunk
        crate::logger::log_info(&format!("Generating embedding for chunk {}/{}", index + 1, chunks.len()));
        let embedding = embedding_generator.generate_embedding(chunk)?;
        let embedding_bytes = embedding.to_bytes();

        conn.execute(
            "INSERT INTO chunks (document_id, chunk_text, chunk_index, page_number, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![document_id, chunk, index as i64, None::<i64>, embedding_bytes],
        )?;
    }
    crate::logger::log_info("All embeddings generated and stored successfully");

    let metadata = DocumentMetadata {
        id: document_id,
        file_name: file_name.clone(),
        file_path,
        file_type,
        upload_date,
        size_bytes,
        chunks_count: chunks.len(),
    };

    crate::logger::log_info(&format!("Document uploaded successfully: {} ({} chunks)", file_name, chunks.len()));

    Ok(metadata)
}

/// List all documents
pub async fn list_documents(app_handle: &AppHandle) -> Result<Vec<DocumentMetadata>> {
    let conn = crate::database::get_connection(app_handle)?;

    let mut stmt = conn.prepare(
        "SELECT d.id, d.file_name, d.file_path, d.file_type, d.upload_date, d.size_bytes,
                COUNT(c.id) as chunks_count
         FROM documents d
         LEFT JOIN chunks c ON d.id = c.document_id
         GROUP BY d.id
         ORDER BY d.upload_date DESC"
    )?;

    let documents = stmt.query_map([], |row| {
        Ok(DocumentMetadata {
            id: row.get(0)?,
            file_name: row.get(1)?,
            file_path: row.get(2)?,
            file_type: row.get(3)?,
            upload_date: row.get(4)?,
            size_bytes: row.get(5)?,
            chunks_count: row.get::<_, i64>(6)? as usize,
        })
    })?;

    let mut result = Vec::new();
    for doc in documents {
        result.push(doc?);
    }

    Ok(result)
}

/// Detect file type from extension
fn detect_file_type(path: &Path) -> Result<String> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .context("Failed to get file extension")?
        .to_lowercase();

    match extension.as_str() {
        "pdf" => Ok("pdf".to_string()),
        "docx" => Ok("docx".to_string()),
        "txt" => Ok("txt".to_string()),
        "md" => Ok("markdown".to_string()),
        "jpg" | "jpeg" => Ok("jpeg".to_string()),
        "png" => Ok("png".to_string()),
        _ => anyhow::bail!("Unsupported file type: {}", extension),
    }
}

/// Extract text from document based on file type
async fn extract_text(path: &Path, file_type: &str, app_handle: &tauri::AppHandle) -> Result<String> {
    match file_type {
        "pdf" => extract_pdf_text(path).await,
        "docx" => extract_docx_text(path),
        "txt" | "markdown" => extract_plain_text(path),
        "jpeg" | "png" => extract_image_text(path, app_handle).await,
        _ => anyhow::bail!("Unsupported file type: {}", file_type),
    }
}

/// Extract text from image using OCR
async fn extract_image_text(path: &Path, app_handle: &tauri::AppHandle) -> Result<String> {
    crate::logger::log_info(&format!("Extracting text from image: {:?}", path));

    // Use OCR to extract text from image
    match crate::ocr::extract_text_from_image(path, Some(app_handle)).await {
        Ok(text) => {
            crate::logger::log_info(&format!("✅ OCR successful! Extracted {} characters from image", text.len()));
            Ok(text)
        }
        Err(ocr_error) => {
            crate::logger::log_error(&format!("OCR failed: {}", ocr_error));
            anyhow::bail!(
                "Failed to extract text from image.\n\n\
                OCR Error: {}\n\n\
                Make sure the image contains readable text and is of good quality.",
                ocr_error
            );
        }
    }
}

/// Extract text from PDF (with automatic OCR fallback for scanned PDFs)
async fn extract_pdf_text(path: &Path) -> Result<String> {
    crate::logger::log_info(&format!("Extracting text from PDF: {:?}", path));

    let bytes = std::fs::read(path)?;
    crate::logger::log_info(&format!("PDF file size: {} bytes", bytes.len()));

    let text = pdf_extract::extract_text_from_mem(&bytes)
        .context("Failed to extract text from PDF")?;

    crate::logger::log_info(&format!("Extracted {} characters from PDF using standard extraction", text.len()));

    // If standard extraction got text, return it
    if !text.trim().is_empty() {
        return Ok(text);
    }

    // Standard extraction failed - this is likely a scanned PDF
    crate::logger::log_warn(&format!("Standard PDF extraction resulted in empty text. Attempting OCR..."));

    // Try OCR extraction
    match crate::ocr::extract_text_from_scanned_pdf(path).await {
        Ok(ocr_text) => {
            crate::logger::log_info(&format!("✅ OCR successful! Extracted {} characters", ocr_text.len()));
            Ok(ocr_text)
        }
        Err(ocr_error) => {
            crate::logger::log_error(&format!("OCR failed: {}", ocr_error));

            // Return helpful error message
            anyhow::bail!(
                "PDF extraction resulted in empty text.\n\n\
                This PDF appears to be scanned/image-based.\n\n\
                OCR Error: {}\n\n\
                File size: {} bytes",
                ocr_error,
                bytes.len()
            );
        }
    }
}

/// Extract text from DOCX
fn extract_docx_text(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path)?;
    let docx = docx_rs::read_docx(&bytes)
        .map_err(|e| anyhow::anyhow!("Failed to read DOCX: {:?}", e))?;

    // Extract text from paragraphs
    let mut text = String::new();
    for child in docx.document.children {
        match child {
            docx_rs::DocumentChild::Paragraph(para) => {
                for para_child in para.children {
                    if let docx_rs::ParagraphChild::Run(run) = para_child {
                        for run_child in run.children {
                            if let docx_rs::RunChild::Text(t) = run_child {
                                text.push_str(&t.text);
                            }
                        }
                    }
                }
                text.push('\n');
            }
            _ => {}
        }
    }

    Ok(text)
}

/// Extract text from plain text file
fn extract_plain_text(path: &Path) -> Result<String> {
    Ok(std::fs::read_to_string(path)?)
}

/// Chunk text into overlapping segments
fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Result<Vec<String>> {
    use unicode_segmentation::UnicodeSegmentation;

    let words: Vec<&str> = text.unicode_words().collect();

    if words.is_empty() {
        return Ok(vec![]);
    }

    let mut chunks = Vec::new();
    let mut start = 0;

    while start < words.len() {
        let end = std::cmp::min(start + chunk_size, words.len());
        let chunk = words[start..end].join(" ");
        chunks.push(chunk);

        if end >= words.len() {
            break;
        }

        start += chunk_size - overlap;
    }

    Ok(chunks)
}

/// Delete a document and its chunks
pub async fn delete_document(app_handle: &AppHandle, document_id: i64) -> Result<()> {
    let conn = crate::database::get_connection(app_handle)?;
    conn.execute("DELETE FROM documents WHERE id = ?", [document_id])?;
    Ok(())
}
