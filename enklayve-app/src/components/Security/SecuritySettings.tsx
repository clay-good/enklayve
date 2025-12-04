import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './SecuritySettings.css';

interface SecurityConfig {
  security_enabled: boolean;
  biometric_enabled: boolean;
  biometric_available: boolean;
}

interface SecuritySettingsProps {
  onClose: () => void;
}

export function SecuritySettings({ onClose }: SecuritySettingsProps) {
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Setup encryption form
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  // Disable encryption form
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [disabling, setDisabling] = useState(false);

  // Change password form
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPasswordChange, setNewPasswordChange] = useState('');
  const [confirmPasswordChange, setConfirmPasswordChange] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Toggle biometric form
  const [showBiometricForm, setShowBiometricForm] = useState(false);
  const [biometricPassword, setBiometricPassword] = useState('');
  const [togglingBiometric, setTogglingBiometric] = useState(false);

  useEffect(() => {
    loadSecurityConfig();
  }, []);

  const loadSecurityConfig = async () => {
    try {
      const config = await invoke<SecurityConfig>('get_security_config');
      setSecurityConfig(config);
      if (config.biometric_available) {
        setEnableBiometric(true);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSetupSecurity = async () => {
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setError('');
    setSettingUp(true);

    try {
      await invoke('setup_security', {
        password: newPassword,
        enableBiometric,
      });

      setNewPassword('');
      setConfirmPassword('');
      setShowSetupForm(false);
      setSuccess('Encryption enabled successfully!');
      await loadSecurityConfig();
    } catch (err) {
      setError(String(err));
    } finally {
      setSettingUp(false);
    }
  };

  const handleDisableSecurity = async () => {
    if (!currentPassword) {
      setError('Please enter your current password');
      return;
    }

    setError('');
    setDisabling(true);

    try {
      await invoke('disable_security', {
        currentPassword,
      });

      setCurrentPassword('');
      setShowDisableForm(false);
      setSuccess('Encryption disabled successfully');
      await loadSecurityConfig();
    } catch (err) {
      setError(String(err));
    } finally {
      setDisabling(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPasswordChange.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPasswordChange !== confirmPasswordChange) {
      setError('New passwords do not match');
      return;
    }

    setError('');
    setChangingPassword(true);

    try {
      await invoke('change_password', {
        currentPassword: oldPassword,
        newPassword: newPasswordChange,
      });

      setOldPassword('');
      setNewPasswordChange('');
      setConfirmPasswordChange('');
      setShowChangePasswordForm(false);
      setSuccess('Password changed successfully!');
    } catch (err) {
      setError(String(err));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleToggleBiometric = async () => {
    if (!biometricPassword) {
      setError('Please enter your password');
      return;
    }

    setError('');
    setTogglingBiometric(true);

    try {
      const newState = !securityConfig?.biometric_enabled;
      await invoke('toggle_biometric', {
        currentPassword: biometricPassword,
        enable: newState,
      });

      setBiometricPassword('');
      setShowBiometricForm(false);
      setSuccess(newState ? 'Touch ID enabled!' : 'Touch ID disabled');
      await loadSecurityConfig();
    } catch (err) {
      setError(String(err));
    } finally {
      setTogglingBiometric(false);
    }
  };

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  if (loading) {
    return (
      <div className="security-settings-overlay" onClick={onClose}>
        <div className="security-settings-modal" onClick={(e) => e.stopPropagation()}>
          <div className="loading-state">Loading security settings...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="security-settings-overlay" onClick={onClose}>
      <div className="security-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Security Settings</h2>
          <button className="close-button" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="modal-content">
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <div className="security-status">
            <div className="status-icon">
              {securityConfig?.security_enabled ? <LockIcon /> : <UnlockIcon />}
            </div>
            <div className="status-text">
              <h3>
                Encryption at Rest:{' '}
                <span className={securityConfig?.security_enabled ? 'enabled' : 'disabled'}>
                  {securityConfig?.security_enabled ? 'Enabled' : 'Disabled'}
                </span>
              </h3>
              <p>
                {securityConfig?.security_enabled
                  ? 'Your documents and conversations are encrypted with AES-256-GCM'
                  : 'Enable encryption to protect your data at rest'}
              </p>
            </div>
          </div>

          {/* Setup Form */}
          {!securityConfig?.security_enabled && !showSetupForm && (
            <button
              className="action-button primary"
              onClick={() => {
                setShowSetupForm(true);
                clearMessages();
              }}
            >
              Enable Encryption
            </button>
          )}

          {showSetupForm && (
            <div className="form-section">
              <h4>Set Up Encryption</h4>
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter password (min 8 characters)"
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                />
              </div>
              {securityConfig?.biometric_available && (
                <div className="checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={enableBiometric}
                      onChange={(e) => setEnableBiometric(e.target.checked)}
                    />
                    <span>Enable Touch ID / Windows Hello</span>
                  </label>
                </div>
              )}
              <div className="button-group">
                <button
                  className="action-button primary"
                  onClick={handleSetupSecurity}
                  disabled={settingUp || !newPassword || !confirmPassword}
                >
                  {settingUp ? 'Setting up...' : 'Enable Encryption'}
                </button>
                <button
                  className="action-button secondary"
                  onClick={() => {
                    setShowSetupForm(false);
                    setNewPassword('');
                    setConfirmPassword('');
                    clearMessages();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Enabled State - Show Options */}
          {securityConfig?.security_enabled && !showDisableForm && !showChangePasswordForm && !showBiometricForm && (
            <div className="enabled-options">
              <div className="option-info">
                <div className="info-row">
                  <span className="info-label">Biometric Unlock:</span>
                  <span className={`info-value ${securityConfig.biometric_enabled ? 'enabled' : 'disabled'}`}>
                    {securityConfig.biometric_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>

              <div className="button-group vertical">
                {securityConfig.biometric_available && (
                  <button
                    className="action-button secondary"
                    onClick={() => {
                      setShowBiometricForm(true);
                      clearMessages();
                    }}
                  >
                    {securityConfig.biometric_enabled ? 'Disable Touch ID' : 'Enable Touch ID'}
                  </button>
                )}
                <button
                  className="action-button secondary"
                  onClick={() => {
                    setShowChangePasswordForm(true);
                    clearMessages();
                  }}
                >
                  Change Password
                </button>
                <button
                  className="action-button danger"
                  onClick={() => {
                    setShowDisableForm(true);
                    clearMessages();
                  }}
                >
                  Disable Encryption
                </button>
              </div>
            </div>
          )}

          {/* Toggle Biometric Form */}
          {showBiometricForm && (
            <div className="form-section">
              <h4>{securityConfig?.biometric_enabled ? 'Disable Touch ID' : 'Enable Touch ID'}</h4>
              <p className="info-text">
                Enter your password to {securityConfig?.biometric_enabled ? 'disable' : 'enable'} Touch ID authentication.
              </p>
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={biometricPassword}
                  onChange={(e) => setBiometricPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </div>
              <div className="button-group">
                <button
                  className="action-button primary"
                  onClick={handleToggleBiometric}
                  disabled={togglingBiometric || !biometricPassword}
                >
                  {togglingBiometric ? 'Processing...' : (securityConfig?.biometric_enabled ? 'Disable' : 'Enable')}
                </button>
                <button
                  className="action-button secondary"
                  onClick={() => {
                    setShowBiometricForm(false);
                    setBiometricPassword('');
                    clearMessages();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Disable Form */}
          {showDisableForm && (
            <div className="form-section">
              <h4>Disable Encryption</h4>
              <p className="warning-text">
                Warning: Disabling encryption will remove password protection from your data.
              </p>
              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  autoComplete="current-password"
                />
              </div>
              <div className="button-group">
                <button
                  className="action-button danger"
                  onClick={handleDisableSecurity}
                  disabled={disabling || !currentPassword}
                >
                  {disabling ? 'Disabling...' : 'Disable Encryption'}
                </button>
                <button
                  className="action-button secondary"
                  onClick={() => {
                    setShowDisableForm(false);
                    setCurrentPassword('');
                    clearMessages();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Change Password Form */}
          {showChangePasswordForm && (
            <div className="form-section">
              <h4>Change Password</h4>
              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                />
              </div>
              <div className="form-group">
                <label>New Password</label>
                <input
                  type="password"
                  value={newPasswordChange}
                  onChange={(e) => setNewPasswordChange(e.target.value)}
                  placeholder="Enter new password (min 8 characters)"
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPasswordChange}
                  onChange={(e) => setConfirmPasswordChange(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                />
              </div>
              <div className="button-group">
                <button
                  className="action-button primary"
                  onClick={handleChangePassword}
                  disabled={changingPassword || !oldPassword || !newPasswordChange || !confirmPasswordChange}
                >
                  {changingPassword ? 'Changing...' : 'Change Password'}
                </button>
                <button
                  className="action-button secondary"
                  onClick={() => {
                    setShowChangePasswordForm(false);
                    setOldPassword('');
                    setNewPasswordChange('');
                    setConfirmPasswordChange('');
                    clearMessages();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}
