import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, message } from "@tauri-apps/plugin-dialog";
import "./App.css";

interface DocumentMetadata {
  id: number;
  file_name: string;
  file_path: string;
  file_type: string;
  upload_date: number;
  size_bytes: number;
  chunks_count: number;
}

// Removed unused interfaces: ModelInfo, HardwareProfile, ModelRecommendation
// These are only needed internally for auto-download logic

interface ConversationSummary {
  id: number;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

interface DownloadProgress {
  downloaded_bytes: number;
  total_bytes: number;
  percentage: number;
  speed_mbps: number;
}

function App() {
  const [question, setQuestion] = useState<string>("");
  const [messages, setMessages] = useState<{role: string; content: string}[]>([]);
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentMetadata | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Model download state
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [activeDownloads, setActiveDownloads] = useState<Set<string>>(new Set());

  // OCR progress state
  const [ocrProgress, setOcrProgress] = useState<{stage: string; message: string; progress: number} | null>(null);

  // Conversation title editing state
  const [editingConversationId, setEditingConversationId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");

  useEffect(() => {
    checkAndDownloadModel();
    loadDocuments();
    loadConversations();

    // Listen for download progress
    const unlistenDownload = listen<DownloadProgress>('download-progress', (event) => {
      setDownloadProgress(event.payload);
    });

    // Listen for OCR progress
    const unlistenOcr = listen<{stage: string; message: string; progress: number}>('ocr-progress', (event) => {
      setOcrProgress(event.payload);

      // Clear progress when complete
      if (event.payload.stage === 'complete') {
        setTimeout(() => setOcrProgress(null), 3000);
      }
    });

    return () => {
      unlistenDownload.then(fn => fn());
      unlistenOcr.then(fn => fn());
    };
  }, []);

  async function checkAndDownloadModel() {
    try {
      const models = await invoke<any[]>("list_downloaded_models");

      if (models.length === 0) {
        setIsDownloading(true);

        const hardware = await invoke<any>("detect_hardware");
        const recommendations = await invoke<any[]>("get_model_recommendations", {
          hardware
        });

        if (recommendations.length > 0) {
          const bestModel = recommendations[0].model;
          setActiveDownloads(new Set([bestModel.name]));

          await invoke("download_model", {
            modelName: bestModel.name,
            modelUrl: bestModel.repo_url,
            fileName: bestModel.file_name,
          });

          setActiveDownloads(new Set());
        }

        setIsDownloading(false);
      }
    } catch (error) {
      console.error("Failed to check/download model:", error);
      setIsDownloading(false);
    }
  }

  async function loadDocuments() {
    try {
      const docs = await invoke<DocumentMetadata[]>("list_documents");
      setDocuments(docs);
    } catch (error) {
      console.error("Failed to load documents:", error);
    }
  }

  async function loadConversations() {
    try {
      const convs = await invoke<ConversationSummary[]>("list_conversations", { limit: 50 });
      setConversations(convs);
      setFilteredConversations(convs);
    } catch (error) {
      console.error("Failed to load conversations:", error);
    }
  }

  async function searchConversations(query: string) {
    try {
      if (!query.trim()) {
        // If search is empty, show all conversations
        setFilteredConversations(conversations);
        return;
      }

      // Use backend search that searches both titles and message content
      const results = await invoke<ConversationSummary[]>("search_conversations", {
        query: query,
        limit: 50
      });
      setFilteredConversations(results);
    } catch (error) {
      console.error("Failed to search conversations:", error);
      // Fallback to showing all conversations
      setFilteredConversations(conversations);
    }
  }

  async function updateConversationTitle(conversationId: number, newTitle: string) {
    try {
      await invoke("update_conversation_title", {
        conversationId: conversationId,
        title: newTitle
      });
      await loadConversations();
    } catch (error) {
      console.error("Failed to update conversation title:", error);
    }
  }

  // Helper function to log to both console and application logs
  async function log(msg: string) {
    console.log(msg);
    try {
      await invoke("log_from_frontend", { message: msg });
    } catch (e) {
      console.error("Failed to log to backend:", e);
    }
  }

  // Helper function to show password input dialog
  function showPasswordDialog(promptText: string): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

      const dialog = document.createElement('div');
      dialog.style.cssText = 'background: #2b2b2b; padding: 30px; border-radius: 8px; min-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);';

      const title = document.createElement('h3');
      title.textContent = 'Database Encryption';
      title.style.cssText = 'color: #fff; margin: 0 0 10px 0;';

      const msg = document.createElement('p');
      msg.textContent = promptText;
      msg.style.cssText = 'color: #ccc; margin: 0 0 20px 0;';

      const input = document.createElement('input');
      input.type = 'password';
      input.style.cssText = 'width: 100%; padding: 10px; font-size: 16px; border: 1px solid #555; background: #1a1a1a; color: #fff; border-radius: 4px; box-sizing: border-box;';

      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'padding: 10px 20px; background: #555; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;';
      cancelBtn.onclick = () => {
        document.body.removeChild(overlay);
        resolve(null);
      };

      const okBtn = document.createElement('button');
      okBtn.textContent = 'OK';
      okBtn.style.cssText = 'padding: 10px 20px; background: #007bff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;';
      okBtn.onclick = () => {
        const value = input.value;
        document.body.removeChild(overlay);
        resolve(value);
      };

      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const value = input.value;
          document.body.removeChild(overlay);
          resolve(value);
        }
      });

      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(okBtn);

      dialog.appendChild(title);
      dialog.appendChild(msg);
      dialog.appendChild(input);
      dialog.appendChild(buttonContainer);

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      setTimeout(() => input.focus(), 100);
    });
  }

  async function setupEncryption() {
    await log("=== ENCRYPTION BUTTON CLICKED ===");
    await log("setupEncryption() function started");

    try {
      await log("Showing password prompt to user");

      const password = await showPasswordDialog("Enter a password to encrypt your database:");
      await log(`Password provided: ${password ? "YES" : "NO"}`);

      if (!password) {
        await log("User cancelled encryption setup or provided empty password");
        return;
      }

      const confirmPassword = await showPasswordDialog("Confirm your password:");
      await log(`Confirmation completed. Match: ${password === confirmPassword ? "YES" : "NO"}`);

      if (password !== confirmPassword) {
        await log("Passwords don't match - showing alert");
        await message("Passwords don't match! Please try again.", {
          title: "Error",
          kind: "error"
        });
        return;
      }

      await log("Passwords match - proceeding with encryption");

      await log("Calling enable_database_encryption Tauri command...");
      const encryptedCount = await invoke<number>("enable_database_encryption", {
        password
      });
      await log(`Tauri command returned. Encrypted ${encryptedCount} messages`);
      await log("Encryption setup completed successfully");

    } catch (error) {
      await log("=== ENCRYPTION ERROR ===");
      await log(`Error: ${error}`);
      console.error("Error object:", error);
      await message(`❌ Failed to setup encryption:\n\n${error}\n\nPlease check the logs for more details.`, {
        title: "Encryption Failed",
        kind: "error"
      });
    }
    await log("=== ENCRYPTION FUNCTION ENDED ===");
  }

  async function createNewConversation() {
    try {
      const convId = await invoke<number>("create_conversation", {
        title: `Conversation ${conversations.length + 1}`
      });
      setMessages([]);
      setCurrentConversationId(convId);
      await loadConversations();
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
  }

  async function switchConversation(convId: number) {
    try {
      const msgs = await invoke<{role: string; content: string}[]>("get_conversation_messages", {
        conversationId: convId
      });
      setMessages(msgs);
      setCurrentConversationId(convId);
    } catch (error) {
      console.error("Failed to switch conversation:", error);
    }
  }


  async function handleAskQuestion() {
    if (!question.trim()) return;

    const currentQuestion = question;
    setQuestion("");

    const userMessage = {
      role: "user",
      content: currentQuestion,
    };
    setMessages(prevMessages => [...prevMessages, userMessage]);

    setLoading(true);

    try {
      let convId = currentConversationId;
      if (!convId) {
        convId = await invoke<number>("create_conversation", {
          title: currentQuestion.slice(0, 50)
        });
        setCurrentConversationId(convId);
        await loadConversations();
      }

      const models = await invoke<any[]>("list_downloaded_models");
      const modelPath = models.length > 0 ? models[0].path : undefined;

      let response: string;

      // Query using local LLM only - no web search, 100% private!
      response = await invoke<string>("query_documents", {
        question: currentQuestion,
        modelPath,
        conversationId: convId,
      });

      const assistantMessage = {
        role: "assistant",
        content: response,
      };
      setMessages(prevMessages => [...prevMessages, assistantMessage]);

      if (convId) {
        try {
          await invoke("add_message", {
            conversationId: convId,
            role: "user",
            content: currentQuestion
          });
          await invoke("add_message", {
            conversationId: convId,
            role: "assistant",
            content: response
          });
          await loadConversations();
        } catch (error) {
          console.error("Failed to save messages to conversation:", error);
        }
      }
    } catch (error) {
      console.error("Failed to query documents:", error);
      const errorMessage = {
        role: "assistant",
        content: `Error: ${error}`,
      };
      setMessages(prevMessages => [...prevMessages, errorMessage]);
    } finally {
      setLoading(false);
    }
  }

  function toggleTheme() {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('light-mode');
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <input
            type="text"
            className="search-bar"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              searchConversations(e.target.value);
            }}
          />
          <div className="header-actions">
            <button className="theme-toggle" onClick={toggleTheme}>
              {isDarkMode ? "Light" : "Dark"}
            </button>
            <button className="settings-button" onClick={setupEncryption}>
              Encrypt
            </button>
            <button className="export-button" onClick={async () => {
              try {
                const allConversations = [];
                for (const conv of conversations) {
                  const messages = await invoke<any[]>("get_conversation_messages", {
                    conversationId: conv.id
                  });
                  allConversations.push({
                    ...conv,
                    messages
                  });
                }
                const exportData = JSON.stringify(allConversations, null, 2);
                const blob = new Blob([exportData], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `enklayve-conversations-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                console.error("Export failed:", error);
              }
            }}>
              Export
            </button>
          </div>
        </div>

        {/* Conversation History */}
        <div className="conversations-section">
          <h3>Conversations</h3>
          <button className="new-conversation-btn" onClick={createNewConversation}>
            + New Conversation
          </button>
          <div className="conversations-list">
            {filteredConversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${currentConversationId === conv.id ? 'active' : ''}`}
                onClick={() => switchConversation(conv.id)}
              >
                <div className="conversation-info">
                  {editingConversationId === conv.id ? (
                    <input
                      type="text"
                      className="conversation-title-input"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={async () => {
                        if (editingTitle.trim() && editingTitle !== conv.title) {
                          await updateConversationTitle(conv.id, editingTitle);
                        }
                        setEditingConversationId(null);
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          if (editingTitle.trim() && editingTitle !== conv.title) {
                            await updateConversationTitle(conv.id, editingTitle);
                          }
                          setEditingConversationId(null);
                        } else if (e.key === 'Escape') {
                          setEditingConversationId(null);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <div
                      className="conversation-title"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingConversationId(conv.id);
                        setEditingTitle(conv.title);
                      }}
                    >
                      {conv.title}
                    </div>
                  )}
                  <div className="conversation-meta">
                    {conv.message_count} messages
                  </div>
                </div>
                <button
                  className="delete-btn"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await invoke("delete_conversation", { conversationId: conv.id });
                      if (currentConversationId === conv.id) {
                        setCurrentConversationId(null);
                        setMessages([]);
                      }
                      await loadConversations();
                    } catch (error) {
                      console.error("Failed to delete conversation:", error);
                    }
                  }}
                  title="Delete conversation"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Documents Section */}
        <div className="documents-section">
          <h3>Documents</h3>
          <button
            className="upload-btn"
            onClick={async () => {
              const selected = await open({
                multiple: false,
                filters: [
                  {
                    name: "Documents & Images",
                    extensions: ["pdf", "txt", "docx", "md", "jpg", "jpeg", "png"],
                  },
                ],
              });

              if (selected && typeof selected === "string") {
                setLoading(true);
                await invoke<DocumentMetadata>("upload_document", {
                  filePath: selected,
                });
                await loadDocuments();
                setLoading(false);
              }
            }}
          >
            + New Document
          </button>
          <div className="document-list">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`document-item ${selectedDocument?.id === doc.id ? 'selected' : ''}`}
                onClick={() => setSelectedDocument(doc)}
              >
                <div className="document-info">
                  <div className="document-name">{doc.file_name}</div>
                  <div className="document-meta">
                    {doc.chunks_count} chunks
                  </div>
                </div>
                <button
                  className="delete-btn"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await invoke("delete_document", { documentId: doc.id });
                      if (selectedDocument?.id === doc.id) {
                        setSelectedDocument(null);
                      }
                      await loadDocuments();
                    } catch (error) {
                      console.error("Failed to delete document:", error);
                    }
                  }}
                  title="Delete document"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

      </aside>

      <main className="main-content">
        {isDownloading ? (
          <div className="loading-overlay">
            <div className="loading-content">
              <div className="loading-spinner-large"></div>
              <h2>Preparing Enklayve...</h2>
              <p className="status-text">Detecting your hardware and selecting the best AI model</p>
              <p className="loading-hint">This may take a few minutes depending on your internet connection</p>
            </div>
          </div>
        ) : activeDownloads.size > 0 ? (
          <div className="loading-overlay">
            <div className="loading-content">
              <div className="loading-spinner-large"></div>
              <h2>
                {downloadProgress && downloadProgress.percentage < 100
                  ? `Downloading... ${downloadProgress.percentage.toFixed(0)}%`
                  : downloadProgress && downloadProgress.percentage >= 100
                  ? "Installing & Configuring..."
                  : "Downloading AI Model"}
              </h2>
              {downloadProgress ? (
                <>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.min(downloadProgress.percentage, 100)}%` }}
                    ></div>
                  </div>
                  <p className="status-text">
                    {(downloadProgress.downloaded_bytes / 1_073_741_824).toFixed(2)} GB / {(downloadProgress.total_bytes / 1_073_741_824).toFixed(2)} GB
                    {downloadProgress.percentage < 100 && ` • ${downloadProgress.speed_mbps.toFixed(1)} MB/s`}
                  </p>
                  <p className="loading-hint privacy-message">
                    Enklayve is downloading the best open-source LLM model for your computer so this remains fully secure and private. Nothing is logged to any server - your data stays on your device.
                  </p>
                  {downloadProgress.percentage >= 100 && (
                    <p className="loading-hint">Finalizing model setup, please wait...</p>
                  )}
                </>
              ) : (
                <>
                  <p className="status-text">Starting download...</p>
                  <p className="loading-hint privacy-message">
                    Enklayve is downloading the best open-source LLM model for your computer so this remains fully secure and private. Nothing is logged to any server - your data stays on your device.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="chat-area">
          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty-chat">
                <h2>Welcome to Enklayve</h2>
                <p>Your local, private, and secure AI assistant.</p>
                <ul className="feature-list">
                  <li>Chat freely - no documents required</li>
                  <li>Upload documents (PDF, DOCX, TXT, MD) for intelligent Q&A</li>
                  <li>100% local processing - your data NEVER leaves your device</li>
                  <li>No internet required - works completely offline</li>
                  <li>No telemetry, no tracking, no API keys - fully private & free forever</li>
                </ul>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.role}`}>
                    <div className="message-content">
                      {msg.content.split('\n').map((line, i) => (
                        <span key={i}>
                          {line}
                          <br />
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="message assistant">
                    <div className="message-content loading">
                      Processing locally...
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="input-area">
            <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%" }}>
              <input
                type="text"
                placeholder="Ask a question..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAskQuestion()}
                disabled={loading}
              />
              <button onClick={handleAskQuestion} disabled={loading}>
                Ask
              </button>
            </div>
          </div>
          </div>
        )}
      </main>

      {/* OCR Progress Modal */}
      {ocrProgress && (
        <div className="modal-overlay">
          <div className="modal-content ocr-progress-modal">
            <h3>Processing Image</h3>
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${ocrProgress.progress}%` }}
              />
            </div>
            <p className="progress-message">{ocrProgress.message}</p>
            <p className="progress-percentage">{ocrProgress.progress}%</p>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
