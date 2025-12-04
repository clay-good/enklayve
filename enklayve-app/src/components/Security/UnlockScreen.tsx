import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './UnlockScreen.css';

interface SecurityConfig {
  security_enabled: boolean;
  biometric_enabled: boolean;
  biometric_available: boolean;
}

interface UnlockScreenProps {
  onUnlock: () => void;
}

export function UnlockScreen({ onUnlock }: UnlockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig | null>(null);
  const [attemptingBiometric, setAttemptingBiometric] = useState(false);

  useEffect(() => {
    const loadSecurityConfig = async () => {
      try {
        const config = await invoke<SecurityConfig>('get_security_config');
        setSecurityConfig(config);

        // Auto-attempt biometric if available and enabled
        if (config.biometric_enabled && config.biometric_available) {
          handleBiometricUnlock();
        }
      } catch (err) {
        console.error('Failed to load security config:', err);
      }
    };

    loadSecurityConfig();
  }, []);

  const handlePasswordUnlock = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setError('');
    setIsUnlocking(true);

    try {
      const isValid = await invoke<boolean>('verify_unlock_password', { password });

      if (isValid) {
        // Clear password from memory
        setPassword('');
        onUnlock();
      } else {
        setError('Incorrect password');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleBiometricUnlock = async () => {
    setAttemptingBiometric(true);
    setError('');

    try {
      const success = await invoke<boolean>('unlock_with_biometric');

      if (success) {
        onUnlock();
      } else {
        // Biometric failed - user can try password
        setError('Biometric authentication failed. Please use your password.');
      }
    } catch (err) {
      // Don't show error for user cancellation
      const errorStr = String(err);
      if (!errorStr.includes('cancelled') && !errorStr.includes('canceled')) {
        setError('Biometric unavailable. Please use your password.');
      }
    } finally {
      setAttemptingBiometric(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && password) {
      handlePasswordUnlock();
    }
  };

  return (
    <div className="unlock-screen">
      <div className="unlock-content">
        <div className="unlock-logo">
          <svg width="64" height="64" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" fill="url(#gradient)" />
            <path d="M50 25V50L65 65" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <defs>
              <linearGradient id="gradient" x1="0" y1="0" x2="100" y2="100">
                <stop offset="0%" stopColor="#667eea" />
                <stop offset="100%" stopColor="#764ba2" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1>Enklayve</h1>
        <p className="unlock-subtitle">Enter your password to unlock</p>

        <div className="unlock-form">
          <div className="input-wrapper">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Password"
              autoFocus
              autoComplete="current-password"
              disabled={isUnlocking || attemptingBiometric}
            />
          </div>

          {error && <p className="error-message">{error}</p>}

          <button
            className="unlock-button"
            onClick={handlePasswordUnlock}
            disabled={isUnlocking || attemptingBiometric || !password}
          >
            {isUnlocking ? 'Unlocking...' : 'Unlock'}
          </button>

          {securityConfig?.biometric_enabled && securityConfig?.biometric_available && (
            <button
              className="biometric-button"
              onClick={handleBiometricUnlock}
              disabled={isUnlocking || attemptingBiometric}
            >
              {attemptingBiometric ? (
                'Waiting for biometric...'
              ) : (
                <>
                  <BiometricIcon />
                  <span>Use Touch ID / Windows Hello</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BiometricIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04c.918-2.453 1.44-5.149 1.44-7.969a5.997 5.997 0 0 1 11.752-1.524M4.5 12a8.5 8.5 0 0 1 15.65 0" />
      <path d="M12 11a9 9 0 0 1-2.636 6.364M12 11c0 5.053-1.715 9.706-4.59 13.41" />
      <circle cx="12" cy="11" r="1" fill="currentColor" />
    </svg>
  );
}
