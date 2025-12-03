import { useState } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import './ConversationList.css';

interface ConversationSummary {
  id: number;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

interface ConversationListProps {
  conversations: ConversationSummary[];
  currentConversationId: number | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onConversationSelect: (id: number) => void;
  onConversationDelete: (id: number) => void;
  onConversationTitleUpdate: (id: number, title: string) => void;
  onNewConversation: () => void;
  isDarkMode: boolean;
  onThemeToggle: () => void;
  onBackupComplete: (success: boolean, message: string) => void;
}

export function ConversationList({
  conversations,
  currentConversationId,
  searchQuery,
  onSearchChange,
  onConversationSelect,
  onConversationDelete,
  onConversationTitleUpdate,
  onNewConversation,
  isDarkMode,
  onThemeToggle,
  onBackupComplete,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleTitleEdit = (conv: ConversationSummary) => {
    setEditingId(conv.id);
    setEditingTitle(conv.title);
  };

  const handleTitleSave = async (id: number, originalTitle: string) => {
    if (editingTitle.trim() && editingTitle !== originalTitle) {
      onConversationTitleUpdate(id, editingTitle);
    }
    setEditingId(null);
  };

  const handleTitleCancel = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const handleBackup = async () => {
    try {
      const defaultFileName = `enklayve_backup_${new Date().toISOString().split('T')[0]}.zip`;
      const savePath = await save({
        defaultPath: defaultFileName,
        filters: [{
          name: 'Enklayve Backup',
          extensions: ['zip']
        }]
      });

      if (!savePath) return;

      setIsBackingUp(true);
      await invoke('create_backup', { destinationPath: savePath });
      onBackupComplete(true, 'Backup created successfully');
    } catch (error) {
      console.error('Backup failed:', error);
      onBackupComplete(false, `Backup failed: ${error}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Enklayve Backup',
          extensions: ['zip']
        }]
      });

      if (!selected || typeof selected !== 'string') return;

      const confirmed = window.confirm(
        'Restoring from backup will overwrite all existing data. This cannot be undone. Continue?'
      );

      if (!confirmed) return;

      setIsRestoring(true);
      await invoke('restore_backup', { backupFilePath: selected });
      onBackupComplete(true, 'Backup restored successfully. Please restart the application.');
    } catch (error) {
      console.error('Restore failed:', error);
      onBackupComplete(false, `Restore failed: ${error}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="conversation-list-container">
      <div className="conversation-list-header">
        <input
          type="text"
          className="search-input"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="header-buttons">
        <button
          className="text-button"
          onClick={handleBackup}
          disabled={isBackingUp}
          title="Create Backup"
        >
          {isBackingUp ? 'Exporting...' : 'Export'}
        </button>
        <button
          className="text-button"
          onClick={handleRestore}
          disabled={isRestoring}
          title="Restore from Backup"
        >
          {isRestoring ? 'Importing...' : 'Import'}
        </button>
        <button
          className="text-button"
          onClick={onThemeToggle}
          title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {isDarkMode ? "Light" : "Dark"}
        </button>
      </div>

      <div className="conversation-list-section">
        <div className="section-header">
          <h3>Conversations ({conversations.length})</h3>
          <button className="new-conversation-button" onClick={onNewConversation}>
            + New
          </button>
        </div>

        <div className="conversation-list">
          {conversations.length === 0 ? (
            <div className="empty-conversations">
              <p>No conversations yet</p>
              <p className="empty-hint">Start a new conversation to begin</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${currentConversationId === conv.id ? 'active' : ''}`}
                onClick={() => onConversationSelect(conv.id)}
              >
                <div className="conversation-content">
                  {editingId === conv.id ? (
                    <input
                      type="text"
                      className="title-edit-input"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => handleTitleSave(conv.id, conv.title)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleTitleSave(conv.id, conv.title);
                        } else if (e.key === 'Escape') {
                          handleTitleCancel();
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
                        handleTitleEdit(conv);
                      }}
                      title="Click to edit title"
                    >
                      {conv.title}
                    </div>
                  )}
                  <div className="conversation-metadata">
                    <span className="message-count">{conv.message_count} messages</span>
                    <span className="timestamp">{formatTimestamp(conv.updated_at)}</span>
                  </div>
                </div>
                <button
                  className="delete-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConversationDelete(conv.id);
                  }}
                  title="Delete conversation"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
