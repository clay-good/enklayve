import { useEffect } from 'react';
import './Toast.css';

interface ToastProps {
  message: string;
  type: 'error' | 'success' | 'info';
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type, onClose, duration = 5000 }: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  return (
    <div className={`toast toast-${type}`}>
      <div className="toast-content">
        <span className="toast-icon">
          {type === 'error' && '⚠️'}
          {type === 'success' && '✓'}
          {type === 'info' && 'ℹ'}
        </span>
        <span className="toast-message">{message}</span>
        <button className="toast-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
    </div>
  );
}
