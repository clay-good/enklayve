import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './WelcomeFlow.css';

interface BestModelSelection {
  model: {
    name: string;
    description: string;
    size_gb: number;
    file_name: string;
    repo_url: string;
  };
  explanation: string;
}

interface DownloadProgress {
  total_bytes: number;
  downloaded_bytes: number;
  percentage: number;
  speed_mbps: number;
  estimated_seconds_remaining: number;
  speed_mb_per_sec: number;
}

interface WelcomeFlowProps {
  onComplete: () => void;
}

export function WelcomeFlow({ onComplete }: WelcomeFlowProps) {
  const [step, setStep] = useState<'welcome' | 'hardware' | 'downloading' | 'complete'>('welcome');
  const [hardwareSummary, setHardwareSummary] = useState<string>('');
  const [bestModel, setBestModel] = useState<BestModelSelection | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const initOnboarding = async () => {
      try {
        const hardware = await invoke<string>('get_hardware_summary');
        setHardwareSummary(hardware);

        const model = await invoke<BestModelSelection>('get_best_model');
        setBestModel(model);

        setStep('hardware');
      } catch (err) {
        setError(String(err));
      }
    };

    initOnboarding();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupDownloadListener = async () => {
      unlisten = await listen<DownloadProgress>('download-progress', (event) => {
        setDownloadProgress(event.payload);
      });
    };

    if (step === 'downloading') {
      setupDownloadListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [step]);

  const handleStartDownload = async () => {
    if (!bestModel) return;

    try {
      setStep('downloading');
      setError('');

      await invoke('download_model', {
        url: bestModel.model.repo_url,
        modelName: bestModel.model.file_name,
      });

      await invoke('mark_model_downloaded');
      await invoke('complete_onboarding');

      setStep('complete');
    } catch (err) {
      setError(String(err));
    }
  };

  const handleFinish = () => {
    onComplete();
  };

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds === 0) return 'Calculating...';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''} remaining`;
    }
    return `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''} remaining`;
  };

  const formatSize = (sizeGb: number): string => {
    return `${sizeGb.toFixed(1)} GB`;
  };

  if (error) {
    return (
      <div className="welcome-flow">
        <div className="welcome-content error">
          <h1>Error</h1>
          <p>{error}</p>
          <button onClick={() => setError('')}>Try Again</button>
        </div>
      </div>
    );
  }

  if (step === 'welcome') {
    return (
      <div className="welcome-flow">
        <div className="welcome-content">
          <h1>Welcome to Enklayve</h1>
          <p className="tagline">Your Private AI Assistant</p>
          <div className="loading-indicator">
            <div className="spinner"></div>
            <p>Analyzing your hardware...</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'hardware' && bestModel) {
    return (
      <div className="welcome-flow">
        <div className="welcome-content">
          <h1>Welcome to Enklayve</h1>
          <p className="tagline">Your Private AI Assistant</p>

          <div className="hardware-info">
            <h2>System Detected</h2>
            <p className="hardware-summary">{hardwareSummary}</p>
          </div>

          <div className="model-recommendation">
            <h2>Recommended Model</h2>
            <p className="model-name">{bestModel.model.name}</p>
            <p className="model-explanation">{bestModel.explanation}</p>
            <p className="model-size">Download size: {formatSize(bestModel.model.size_gb)}</p>
          </div>

          <div className="action-buttons">
            <button className="primary-button" onClick={handleStartDownload}>
              Download Model
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'downloading') {
    return (
      <div className="welcome-flow">
        <div className="welcome-content">
          <h1>Setting up Enklayve</h1>
          <p className="tagline">Downloading your AI model</p>

          <div className="download-progress">
            {downloadProgress && (
              <>
                <div className="progress-bar-container">
                  <div
                    className="progress-bar"
                    style={{ width: `${downloadProgress.percentage}%` }}
                  ></div>
                </div>

                <div className="progress-details">
                  <p className="progress-percentage">{downloadProgress.percentage.toFixed(1)}%</p>
                  <p className="progress-speed">
                    {downloadProgress.speed_mb_per_sec.toFixed(1)} MB/s
                  </p>
                </div>

                {downloadProgress.estimated_seconds_remaining > 0 && (
                  <p className="time-remaining">
                    {formatTimeRemaining(downloadProgress.estimated_seconds_remaining)}
                  </p>
                )}

                <p className="download-info">
                  {(downloadProgress.downloaded_bytes / (1024 * 1024 * 1024)).toFixed(2)} GB of{' '}
                  {(downloadProgress.total_bytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                </p>
              </>
            )}

            {!downloadProgress && (
              <div className="loading-indicator">
                <div className="spinner"></div>
                <p>Starting download...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === 'complete') {
    return (
      <div className="welcome-flow">
        <div className="welcome-content">
          <h1>All Set!</h1>
          <p className="tagline">Enklayve is ready to use</p>

          <div className="suggestions">
            <h2>Try asking:</h2>
            <ul>
              <li>Summarize this PDF for me</li>
              <li>Help me write an email</li>
              <li>Explain quantum physics</li>
              <li>Analyze this document</li>
            </ul>
          </div>

          <div className="action-buttons">
            <button className="primary-button" onClick={handleFinish}>
              Start Chatting
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
