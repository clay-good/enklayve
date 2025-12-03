import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './MessageBubble.css';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export function MessageBubble({ role, content, isStreaming = false }: MessageBubbleProps) {
  const [displayContent, setDisplayContent] = useState('');

  useEffect(() => {
    setDisplayContent(content);
  }, [content]);

  return (
    <div className={`message-bubble ${role}`}>
      <div className="message-bubble-content">
        {role === 'assistant' ? (
          <ReactMarkdown>{displayContent}</ReactMarkdown>
        ) : (
          <span>{displayContent}</span>
        )}
        {isStreaming && <span className="cursor-blink">|</span>}
      </div>
    </div>
  );
}
