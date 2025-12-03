import './DocumentPanel.css';

interface DocumentMetadata {
  id: number;
  file_name: string;
  file_path: string;
  file_type: string;
  upload_date: number;
  size_bytes: number;
  chunks_count: number;
}

interface OcrProgress {
  stage: string;
  message: string;
  progress: number;
}

interface DocumentPanelProps {
  documents: DocumentMetadata[];
  selectedDocument: DocumentMetadata | null;
  highlightedDocument: string | null;
  ocrProgress: OcrProgress | null;
  onDocumentSelect: (doc: DocumentMetadata) => void;
  onDocumentDelete: (id: number) => void;
  onUpload: () => void;
}

export function DocumentPanel({
  documents,
  selectedDocument,
  highlightedDocument,
  ocrProgress,
  onDocumentSelect,
  onDocumentDelete,
  onUpload,
}: DocumentPanelProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (fileType: string): string => {
    const type = fileType.toLowerCase();
    if (type === 'pdf') return '📄';
    if (type === 'docx' || type === 'doc') return '📝';
    if (type === 'txt' || type === 'md') return '📃';
    if (type === 'jpg' || type === 'jpeg' || type === 'png') return '🖼️';
    return '📎';
  };

  return (
    <div className="document-panel-container">
      <div className="document-panel-header">
        <h3>Documents ({documents.length})</h3>
        <button className="upload-button" onClick={onUpload}>
          + New
        </button>
      </div>

      {ocrProgress && (
        <div className="ocr-progress">
          <div className="ocr-progress-header">
            <span className="ocr-stage">{ocrProgress.stage}</span>
            <span className="ocr-percentage">{ocrProgress.progress}%</span>
          </div>
          <div className="ocr-progress-bar">
            <div
              className="ocr-progress-fill"
              style={{ width: `${ocrProgress.progress}%` }}
            ></div>
          </div>
          <p className="ocr-message">{ocrProgress.message}</p>
        </div>
      )}

      <div className="document-list">
        {documents.length === 0 ? (
          <div className="empty-documents">
            <p>No documents uploaded</p>
            <p className="empty-hint">Upload documents to enable RAG</p>
          </div>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className={`document-item ${selectedDocument?.id === doc.id ? 'selected' : ''} ${highlightedDocument === doc.file_name ? 'highlighted' : ''}`}
              onClick={() => onDocumentSelect(doc)}
            >
              <div className="document-icon">{getFileIcon(doc.file_type)}</div>
              <div className="document-info">
                <div className="document-name" title={doc.file_name}>
                  {doc.file_name}
                </div>
                <div className="document-metadata">
                  <span className="file-size">{formatFileSize(doc.size_bytes)}</span>
                  <span className="chunk-count">{doc.chunks_count} chunks</span>
                </div>
              </div>
              <button
                className="delete-button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDocumentDelete(doc.id);
                }}
                title="Delete document"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
