use crate::documents::DocumentMetadata;
use crate::models::{ModelInfo, ModelRecommendation};
use crate::downloads::{DownloadedModelInfo, DownloadInfo, ModelDownloader};
use crate::hardware::HardwareProfile;
use crate::encryption;
use crate::biometric;
use crate::encrypted_database;
use crate::database;
use crate::conversations;
use crate::settings;
use tauri::Emitter;

/// Simple greeting command for testing
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Enklayve.", name)
}

/// Upload and process a document
#[tauri::command]
pub async fn upload_document(
    file_path: String,
    app_handle: tauri::AppHandle,
) -> Result<DocumentMetadata, String> {
    crate::documents::upload_document(file_path, &app_handle)
        .await
        .map_err(|e| e.to_string())
}

/// List all uploaded documents
#[tauri::command]
pub async fn list_documents(app_handle: tauri::AppHandle) -> Result<Vec<DocumentMetadata>, String> {
    crate::documents::list_documents(&app_handle)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a document and its chunks
#[tauri::command]
pub async fn delete_document(
    document_id: i64,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::documents::delete_document(&app_handle, document_id)
        .await
        .map_err(|e| e.to_string())
}

/// Get available models
#[tauri::command]
pub fn get_models() -> Vec<ModelInfo> {
    crate::models::get_available_models()
}

/// List downloaded models
#[tauri::command]
pub async fn list_downloaded_models(
    app_handle: tauri::AppHandle,
) -> Result<Vec<DownloadedModelInfo>, String> {
    crate::downloads::list_downloaded_models(&app_handle)
        .await
        .map_err(|e| e.to_string())
}

/// Get download info for a URL
#[tauri::command]
pub async fn get_download_info(url: String) -> Result<DownloadInfo, String> {
    let downloader = ModelDownloader::new().map_err(|e| e.to_string())?;
    downloader
        .get_download_info(&url)
        .await
        .map_err(|e| e.to_string())
}

/// Download a model
#[tauri::command]
pub async fn download_model(
    url: String,
    model_name: String,
    app_handle: tauri::AppHandle,
    window: tauri::Window,
) -> Result<String, String> {
    let downloader = ModelDownloader::new().map_err(|e| e.to_string())?;

    let path = downloader
        .download_model(&url, &model_name, &app_handle, move |progress| {
            // Emit progress event to frontend
            window.emit("download-progress", progress).ok();
        })
        .await
        .map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

/// Delete a downloaded model
#[tauri::command]
pub async fn delete_model(app_handle: tauri::AppHandle, model_name: String) -> Result<(), String> {
    crate::downloads::delete_model(&app_handle, &model_name)
        .await
        .map_err(|e| e.to_string())
}

/// Query documents using RAG (Retrieval-Augmented Generation)
#[tauri::command]
pub async fn query_documents(
    question: String,
    model_path: Option<String>,
    conversation_id: Option<i64>,
    app_handle: tauri::AppHandle,
    model_cache: tauri::State<'_, crate::model_cache::ModelCache>,
) -> Result<String, String> {
    crate::logger::log_info(&format!("Query received: {}", question));
    crate::logger::log_info(&format!("Model path: {:?}", model_path));
    crate::logger::log_info(&format!("Conversation ID: {:?}", conversation_id));

    // Search for relevant chunks using vector similarity (3-4 chunks for better context)
    let search_results = crate::vector_search::search_similar_chunks(&question, &app_handle, 4)
        .await
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to search chunks: {}", e));
            e.to_string()
        })?;

    crate::logger::log_info(&format!("Found {} relevant chunks", search_results.len()));

    // Extract chunk texts for context (may be empty if no documents)
    // With 4K context window and optimized batching, we can handle full chunks
    let context_chunks: Vec<String> = search_results
        .iter()
        .map(|r| r.chunk_text.clone())
        .collect();

    // Get conversation context if conversation_id provided (last 4 messages for better context)
    let conversation_context = if let Some(conv_id) = conversation_id {
        let conn = crate::database::get_connection(&app_handle)
            .map_err(|e| e.to_string())?;

        // Get last 4 messages for context (2 Q&A pairs)
        crate::conversations::get_conversation_context(&conn, conv_id, 4)
            .unwrap_or_else(|e| {
                crate::logger::log_warn(&format!("Failed to get conversation context: {}", e));
                String::new()
            })
    } else {
        String::new()
    };

    // Get current date and time for context
    let now = chrono::Local::now();
    let current_date = now.format("%B %d, %Y").to_string(); // e.g., "November 21, 2025"
    let current_datetime = now.format("%B %d, %Y at %I:%M %p").to_string();

    // Create system context with date
    let system_context = format!(
        "Current date: {}\nCurrent time: {}\n\nYou are a helpful AI assistant.",
        current_date, current_datetime
    );

    // Create RAG prompt with conversation context
    let prompt = if context_chunks.is_empty() {
        // No documents - use conversation context if available
        if conversation_context.is_empty() {
            format!("{}\n\nAnswer the following question:\n\n{}", system_context, question)
        } else {
            format!(
                "{}\n\nHere is the conversation history:\n\n{}\n\nNow answer the following question:\n\n{}",
                system_context, conversation_context, question
            )
        }
    } else {
        // Documents available - create RAG prompt with optional conversation context
        let mut prompt = format!("{}\n\n", system_context);

        if !conversation_context.is_empty() {
            prompt.push_str("Conversation history:\n");
            prompt.push_str(&conversation_context);
            prompt.push_str("\n\n");
        }

        prompt.push_str("Context from documents:\n");
        for (i, chunk) in context_chunks.iter().enumerate() {
            prompt.push_str(&format!("[{}] {}\n\n", i + 1, chunk));
        }

        prompt.push_str(&format!("Question: {}\n\nInstructions:\n1. Analyze the relevant information from the documents above\n2. Provide a comprehensive, well-structured answer\n3. Include specific details and examples when available\n4. If multiple documents are relevant, synthesize the information coherently\n\nAnswer:", question));
        prompt
    };

    // If model path provided, use actual LLM inference with caching
    if let Some(model_path_str) = model_path {
        let model_path = std::path::Path::new(&model_path_str);

        if !model_path.exists() {
            return Err(format!("Model file not found: {}", model_path_str));
        }

        // Load model into cache if not already loaded
        model_cache.get_or_load(&model_path_str)
            .map_err(|e| format!("Failed to load model: {}", e))?;

        // Generate response using cached model
        let response = model_cache.generate(&prompt, 512)
            .map_err(|e| format!("Failed to generate response: {}", e))?;

        return Ok(response);
    }

    // Fallback: return search results if no model provided
    if search_results.is_empty() {
        return Ok("No AI model is currently loaded. Please wait for the model to download, or check the application logs for errors.".to_string());
    }

    let mut response = format!(
        "Based on your documents, here are the most relevant passages:\n\n"
    );

    for (i, result) in search_results.iter().enumerate() {
        response.push_str(&format!(
            "{}. From \"{}\" (similarity: {:.2}):\n{}\n\n",
            i + 1,
            result.file_name,
            result.similarity,
            result.chunk_text
        ));
    }

    response.push_str(&format!(
        "\nQuestion: {}\n\n",
        question
    ));

    response.push_str(
        "Note: No model selected. Download a model to get AI-generated answers. The above passages are the most relevant sections from your documents.\n"
    );

    Ok(response)
}

/// Detect hardware capabilities
#[tauri::command]
pub fn detect_hardware() -> Result<HardwareProfile, String> {
    HardwareProfile::detect().map_err(|e| e.to_string())
}

/// Get model recommendations based on hardware
#[tauri::command]
pub fn get_model_recommendations() -> Result<Vec<ModelRecommendation>, String> {
    let hardware = HardwareProfile::detect().map_err(|e| e.to_string())?;
    Ok(crate::models::get_recommended_models(&hardware))
}

/// Query documents using RAG with streaming response
#[tauri::command]
pub async fn query_documents_streaming(
    question: String,
    model_path: Option<String>,
    app_handle: tauri::AppHandle,
    window: tauri::Window,
) -> Result<String, String> {
    // Search for relevant chunks using vector similarity
    let search_results = crate::vector_search::search_similar_chunks(&question, &app_handle, 5)
        .await
        .map_err(|e| e.to_string())?;

    // Extract chunk texts for context (may be empty if no documents)
    let context_chunks: Vec<String> = search_results
        .iter()
        .map(|r| r.chunk_text.clone())
        .collect();

    // Get current date and time for context
    let now = chrono::Local::now();
    let current_date = now.format("%B %d, %Y").to_string();
    let current_datetime = now.format("%B %d, %Y at %I:%M %p").to_string();

    // Create RAG prompt (or simple prompt if no documents)
    let prompt = if context_chunks.is_empty() {
        // No documents - just use the question directly with a helpful system prompt
        format!("Current date: {}\nCurrent time: {}\n\nYou are a helpful AI assistant. Answer the following question:\n\n{}",
            current_date, current_datetime, question)
    } else {
        // Documents available - use RAG prompt with date context
        let mut prompt = format!("Current date: {}\nCurrent time: {}\n\nYou are a helpful AI assistant that answers questions based on provided documents.\n\n", current_date, current_datetime);
        prompt.push_str("Context from documents:\n");
        for (i, chunk) in context_chunks.iter().enumerate() {
            prompt.push_str(&format!("[{}] {}\n\n", i + 1, chunk));
        }
        prompt.push_str(&format!("Question: {}\n\nAnswer based on the provided context:", question));
        prompt
    };

    // If model path provided, use actual LLM inference with streaming
    if let Some(model_path_str) = model_path {
        let model_path = std::path::Path::new(&model_path_str);

        if !model_path.exists() {
            return Err(format!("Model file not found: {}", model_path_str));
        }

        // Create inference engine
        let engine = crate::inference::InferenceEngine::new()
            .map_err(|e| format!("Failed to initialize inference engine: {}", e))?;

        // Generate response with streaming
        let response = engine.generate_streaming(model_path, &prompt, 512, |token| {
            // Emit token to frontend
            window.emit("llm-token", token).ok();
            Ok(())
        })
        .map_err(|e| format!("Failed to generate response: {}", e))?;

        // Emit completion event
        window.emit("llm-complete", &response).ok();

        return Ok(response);
    }

    // Fallback: return search results if no model provided
    if search_results.is_empty() {
        return Ok("No AI model is currently loaded. Please wait for the model to download, or check the application logs for errors.".to_string());
    }

    let mut response = format!(
        "Based on your documents, here are the most relevant passages:\n\n"
    );

    for (i, result) in search_results.iter().enumerate() {
        response.push_str(&format!(
            "{}. From \"{}\" (similarity: {:.2}):\n{}\n\n",
            i + 1,
            result.file_name,
            result.similarity,
            result.chunk_text
        ));
    }

    response.push_str(&format!(
        "\nQuestion: {}\n\n",
        question
    ));

    response.push_str(
        "Note: No model selected. Download a model to get AI-generated answers. The above passages are the most relevant sections from your documents.\n"
    );

    Ok(response)
}

/// Hash a password for secure storage
#[tauri::command]
pub fn hash_password(password: String) -> Result<String, String> {
    encryption::hash_password(&password)
        .map_err(|e| e.to_string())
}

/// Verify a password against a stored hash
#[tauri::command]
pub fn verify_password(password: String, password_hash: String) -> Result<bool, String> {
    encryption::verify_password(&password, &password_hash)
        .map_err(|e| e.to_string())
}

/// Encrypt data (for testing/utility purposes)
#[tauri::command]
pub fn encrypt_data(data: String, password: String) -> Result<Vec<u8>, String> {
    let salt = encryption::EncryptionKey::generate_salt();
    let key = encryption::EncryptionKey::from_password(&password, &salt)
        .map_err(|e| e.to_string())?;

    let mut result = salt.to_vec();
    let encrypted = encryption::encrypt(data.as_bytes(), &key)
        .map_err(|e| e.to_string())?;
    result.extend_from_slice(&encrypted);

    Ok(result)
}

/// Decrypt data (for testing/utility purposes)
#[tauri::command]
pub fn decrypt_data(encrypted_data: Vec<u8>, password: String) -> Result<String, String> {
    if encrypted_data.len() < 16 {
        return Err("Invalid encrypted data".to_string());
    }

    let salt: [u8; 16] = encrypted_data[..16].try_into()
        .map_err(|_| "Invalid salt".to_string())?;
    let key = encryption::EncryptionKey::from_password(&password, &salt)
        .map_err(|e| e.to_string())?;

    let decrypted = encryption::decrypt(&encrypted_data[16..], &key)
        .map_err(|e| e.to_string())?;

    String::from_utf8(decrypted)
        .map_err(|e| format!("Invalid UTF-8: {}", e))
}

/// Check if biometric authentication is available
#[tauri::command]
pub fn check_biometric_available() -> Result<biometric::BiometricCapability, String> {
    biometric::is_biometric_available()
        .map_err(|e| e.to_string())
}

/// Authenticate using biometric (Touch ID/Windows Hello)
#[tauri::command]
pub fn authenticate_biometric(reason: String) -> Result<bool, String> {
    crate::logger::log_info(&format!("Attempting biometric authentication: {}", reason));

    let result = biometric::authenticate_biometric(&reason)
        .map_err(|e| {
            crate::logger::log_error(&format!("Biometric authentication failed: {}", e));
            e.to_string()
        })?;

    if result {
        crate::logger::log_info("Biometric authentication successful");
    } else {
        crate::logger::log_info("Biometric authentication failed");
    }

    Ok(result)
}

/// Store data securely with biometric protection
#[tauri::command]
pub fn store_secure_data(key: String, data: Vec<u8>) -> Result<(), String> {
    crate::logger::log_info(&format!("Storing secure data for key: {}", key));

    biometric::store_secure(&key, &data)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to store secure data: {}", e));
            e.to_string()
        })?;

    crate::logger::log_info(&format!("Successfully stored secure data for key: {}", key));
    Ok(())
}

/// Retrieve securely stored data (requires biometric authentication)
#[tauri::command]
pub fn retrieve_secure_data(key: String) -> Result<Vec<u8>, String> {
    crate::logger::log_info(&format!("Retrieving secure data for key: {}", key));

    let data = biometric::retrieve_secure(&key)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to retrieve secure data: {}", e));
            e.to_string()
        })?;

    crate::logger::log_info(&format!("Successfully retrieved secure data for key: {}", key));
    Ok(data)
}

/// Get encryption statistics for database
#[tauri::command]
pub async fn get_encryption_stats(app_handle: tauri::AppHandle) -> Result<(usize, usize), String> {
    let db_path = database::get_database_path(&app_handle)
        .map_err(|e| e.to_string())?;

    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| e.to_string())?;

    encrypted_database::get_encryption_stats(&conn)
        .map_err(|e| e.to_string())
}

/// Enable database encryption (migrate existing data)
#[tauri::command]
pub async fn enable_database_encryption(
    app_handle: tauri::AppHandle,
    password: String,
) -> Result<usize, String> {
    // FIRST LOG - If you don't see this, the command is not being called from frontend
    crate::logger::log_info("🔐🔐🔐 ENABLE_DATABASE_ENCRYPTION COMMAND CALLED FROM FRONTEND 🔐🔐🔐");
    crate::logger::log_info(&format!("Password length: {} characters", password.len()));
    crate::logger::log_info("Starting conversation encryption...");

    let db_path = database::get_database_path(&app_handle)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to get database path: {}", e));
            e.to_string()
        })?;

    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to open database: {}", e));
            e.to_string()
        })?;

    // Initialize encryption support
    crate::logger::log_info("Initializing encryption support...");
    encrypted_database::initialize_encryption_support(&conn)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to initialize encryption support: {}", e));
            e.to_string()
        })?;

    // Create encryption key
    crate::logger::log_info("Generating encryption key from password...");
    let salt = encryption::EncryptionKey::generate_salt();
    let key = encryption::EncryptionKey::from_password(&password, &salt)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to generate encryption key: {}", e));
            e.to_string()
        })?;

    // Store salt securely (with biometric protection if available)
    crate::logger::log_info("Storing encryption salt securely...");
    biometric::store_secure("db_encryption_salt", &salt)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to store salt: {}", e));
            e.to_string()
        })?;

    // Migrate conversation data to encrypted format
    crate::logger::log_info("Encrypting conversation messages...");
    let result = encrypted_database::migrate_to_encrypted(&conn, &key)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to encrypt conversations: {}", e));
            e.to_string()
        })?;

    crate::logger::log_info(&format!("✅ Conversation encryption completed. Encrypted {} messages", result));
    crate::logger::log_info("⚠️  Note: Document chunks are NOT encrypted (planned for future update)");
    Ok(result)
}

/// Disable database encryption (migrate back to unencrypted)
#[tauri::command]
pub async fn disable_database_encryption(
    app_handle: tauri::AppHandle,
    password: String,
) -> Result<usize, String> {
    crate::logger::log_info("Starting database decryption...");

    let db_path = database::get_database_path(&app_handle)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to get database path: {}", e));
            e.to_string()
        })?;

    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to open database: {}", e));
            e.to_string()
        })?;

    // Retrieve salt
    crate::logger::log_info("Retrieving encryption salt...");
    let salt_bytes = biometric::retrieve_secure("db_encryption_salt")
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to retrieve salt: {}", e));
            e.to_string()
        })?;

    let salt: [u8; 16] = salt_bytes.try_into()
        .map_err(|_| {
            crate::logger::log_error("Invalid salt format");
            "Invalid salt".to_string()
        })?;

    // Create encryption key
    crate::logger::log_info("Deriving encryption key from password...");
    let key = encryption::EncryptionKey::from_password(&password, &salt)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to derive key: {}", e));
            e.to_string()
        })?;

    // Migrate data to unencrypted format
    crate::logger::log_info("Migrating database to unencrypted format...");
    let result = encrypted_database::migrate_to_unencrypted(&conn, &key)
        .map_err(|e| {
            crate::logger::log_error(&format!("Failed to migrate to unencrypted format: {}", e));
            e.to_string()
        })?;

    crate::logger::log_info(&format!("Database decryption completed successfully. Decrypted {} chunks", result));
    Ok(result)
}

// ============================================================================
// CONVERSATION HISTORY COMMANDS
// ============================================================================

/// Create a new conversation
#[tauri::command]
pub async fn create_conversation(
    app_handle: tauri::AppHandle,
    title: Option<String>,
) -> Result<i64, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::create_conversation(&conn, title.as_deref())
        .map_err(|e| e.to_string())
}

/// List all conversations
#[tauri::command]
pub async fn list_conversations(
    app_handle: tauri::AppHandle,
    limit: Option<i32>,
) -> Result<Vec<conversations::ConversationSummary>, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::list_conversations(&conn, limit)
        .map_err(|e| e.to_string())
}

/// Get a specific conversation
#[tauri::command]
pub async fn get_conversation(
    app_handle: tauri::AppHandle,
    conversation_id: i64,
) -> Result<conversations::Conversation, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::get_conversation(&conn, conversation_id)
        .map_err(|e| e.to_string())
}

/// Get all messages in a conversation
#[tauri::command]
pub async fn get_conversation_messages(
    app_handle: tauri::AppHandle,
    conversation_id: i64,
) -> Result<Vec<conversations::Message>, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::get_conversation_messages(&conn, conversation_id)
        .map_err(|e| e.to_string())
}

/// Add a message to a conversation
#[tauri::command]
pub async fn add_message(
    app_handle: tauri::AppHandle,
    conversation_id: i64,
    role: String,
    content: String,
    tokens: Option<i32>,
) -> Result<i64, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::add_message(&conn, conversation_id, &role, &content, tokens)
        .map_err(|e| e.to_string())
}

/// Delete a conversation
#[tauri::command]
pub async fn delete_conversation(
    app_handle: tauri::AppHandle,
    conversation_id: i64,
) -> Result<(), String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::delete_conversation(&conn, conversation_id)
        .map_err(|e| e.to_string())
}

/// Delete a message
#[tauri::command]
pub async fn delete_message(
    app_handle: tauri::AppHandle,
    message_id: i64,
) -> Result<(), String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::delete_message(&conn, message_id)
        .map_err(|e| e.to_string())
}

/// Update conversation title
#[tauri::command]
pub async fn update_conversation_title(
    app_handle: tauri::AppHandle,
    conversation_id: i64,
    title: String,
) -> Result<(), String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::update_conversation_title(&conn, conversation_id, &title)
        .map_err(|e| e.to_string())
}

/// Search conversations
#[tauri::command]
pub async fn search_conversations(
    app_handle: tauri::AppHandle,
    query: String,
    limit: i32,
) -> Result<Vec<conversations::ConversationSummary>, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::search_conversations(&conn, &query, limit)
        .map_err(|e| e.to_string())
}

/// Export conversation to Markdown
#[tauri::command]
pub async fn export_conversation_markdown(
    app_handle: tauri::AppHandle,
    conversation_id: i64,
) -> Result<String, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::export_conversation_markdown(&conn, conversation_id)
        .map_err(|e| e.to_string())
}

/// Export conversation to JSON
#[tauri::command]
pub async fn export_conversation_json(
    app_handle: tauri::AppHandle,
    conversation_id: i64,
) -> Result<String, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::export_conversation_json(&conn, conversation_id)
        .map_err(|e| e.to_string())
}

/// Export conversation to plain text
#[tauri::command]
pub async fn export_conversation_text(
    app_handle: tauri::AppHandle,
    conversation_id: i64,
) -> Result<String, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    conversations::export_conversation_text(&conn, conversation_id)
        .map_err(|e| e.to_string())
}

// ============================================================================
// SETTINGS COMMANDS
// ============================================================================

/// Get application settings
#[tauri::command]
pub async fn get_settings(
    app_handle: tauri::AppHandle,
) -> Result<settings::AppSettings, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    settings::load_settings(&conn)
        .map_err(|e| e.to_string())
}

/// Save application settings
#[tauri::command]
pub async fn save_settings(
    app_handle: tauri::AppHandle,
    app_settings: settings::AppSettings,
) -> Result<(), String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    settings::save_settings(&conn, &app_settings)
        .map_err(|e| e.to_string())
}

/// Reset settings to defaults
#[tauri::command]
pub async fn reset_settings(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    settings::reset_settings(&conn)
        .map_err(|e| e.to_string())
}

/// Export settings to JSON
#[tauri::command]
pub async fn export_settings(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    let app_settings = settings::load_settings(&conn)
        .map_err(|e| e.to_string())?;

    settings::export_settings_json(&app_settings)
        .map_err(|e| e.to_string())
}

/// Import settings from JSON
#[tauri::command]
pub async fn import_settings(
    app_handle: tauri::AppHandle,
    json: String,
) -> Result<(), String> {
    let conn = database::get_connection(&app_handle)
        .map_err(|e| e.to_string())?;

    let app_settings = settings::import_settings_json(&json)
        .map_err(|e| e.to_string())?;

    settings::save_settings(&conn, &app_settings)
        .map_err(|e| e.to_string())
}

// ============================================================================
// LOGGING COMMANDS
// ============================================================================

/// Log a message from the frontend to the application logs
#[tauri::command]
pub fn log_from_frontend(message: String) {
    crate::logger::log_info(&format!("[FRONTEND] {}", message));
}

/// Get the log file directory path
#[tauri::command]
pub fn get_log_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    crate::logger::get_log_path(&app_handle)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}
