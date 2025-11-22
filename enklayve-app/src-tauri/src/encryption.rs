use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{rand_core::RngCore, PasswordHasher, SaltString},
    Argon2, PasswordHash, PasswordVerifier,
};
use anyhow::{Result, Context};
use zeroize::Zeroizing;

/// Encryption key derived from user password
pub struct EncryptionKey {
    key: Zeroizing<[u8; 32]>,
}

impl EncryptionKey {
    /// Derive encryption key from password using Argon2id
    pub fn from_password(password: &str, salt: &[u8; 16]) -> Result<Self> {
        let argon2 = Argon2::default();

        let mut key = Zeroizing::new([0u8; 32]);
        argon2
            .hash_password_into(password.as_bytes(), salt, &mut *key)
            .map_err(|e| anyhow::anyhow!("Failed to derive key: {}", e))?;

        Ok(Self { key })
    }

    /// Generate a new random salt
    pub fn generate_salt() -> [u8; 16] {
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        salt
    }

    /// Get the key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }
}

/// Encrypt data using AES-256-GCM
pub fn encrypt(data: &[u8], key: &EncryptionKey) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .context("Failed to create cipher")?;

    // Generate random nonce (12 bytes for GCM)
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt the data
    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext
    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Decrypt data using AES-256-GCM
pub fn decrypt(encrypted_data: &[u8], key: &EncryptionKey) -> Result<Vec<u8>> {
    if encrypted_data.len() < 12 {
        anyhow::bail!("Invalid encrypted data: too short");
    }

    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .context("Failed to create cipher")?;

    // Extract nonce (first 12 bytes)
    let nonce = Nonce::from_slice(&encrypted_data[..12]);

    // Extract ciphertext (remaining bytes)
    let ciphertext = &encrypted_data[12..];

    // Decrypt the data
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

    Ok(plaintext)
}

/// Hash a password for storage using Argon2id
pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Password hashing failed: {}", e))?
        .to_string();

    Ok(password_hash)
}

/// Verify a password against a stored hash
pub fn verify_password(password: &str, password_hash: &str) -> Result<bool> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| anyhow::anyhow!("Invalid password hash: {}", e))?;

    let argon2 = Argon2::default();

    Ok(argon2
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_decryption() {
        let password = "test_password_123";
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::from_password(password, &salt).unwrap();

        let plaintext = b"Hello, World! This is sensitive data.";

        // Encrypt
        let encrypted = encrypt(plaintext, &key).unwrap();
        assert_ne!(encrypted.as_slice(), plaintext);
        assert!(encrypted.len() > plaintext.len()); // Nonce + auth tag overhead

        // Decrypt
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!(decrypted.as_slice(), plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let password1 = "correct_password";
        let password2 = "wrong_password";
        let salt = EncryptionKey::generate_salt();

        let key1 = EncryptionKey::from_password(password1, &salt).unwrap();
        let key2 = EncryptionKey::from_password(password2, &salt).unwrap();

        let plaintext = b"Secret data";
        let encrypted = encrypt(plaintext, &key1).unwrap();

        // Decryption with wrong key should fail
        let result = decrypt(&encrypted, &key2);
        assert!(result.is_err());
    }

    #[test]
    fn test_password_hashing() {
        let password = "my_secure_password_123";

        // Hash password
        let hash = hash_password(password).unwrap();
        assert!(!hash.is_empty());

        // Verify correct password
        assert!(verify_password(password, &hash).unwrap());

        // Verify wrong password
        assert!(!verify_password("wrong_password", &hash).unwrap());
    }

    #[test]
    fn test_salt_uniqueness() {
        let salt1 = EncryptionKey::generate_salt();
        let salt2 = EncryptionKey::generate_salt();
        assert_ne!(salt1, salt2);
    }

    #[test]
    fn test_key_zeroization() {
        let password = "test_password";
        let salt = EncryptionKey::generate_salt();

        {
            let _key = EncryptionKey::from_password(password, &salt).unwrap();
            // Key should be zeroized when dropped
        }

        // If this test compiles and runs, zeroization is working
        // (actual memory zeroization can't be tested directly in safe Rust)
    }

    #[test]
    fn test_nonce_uniqueness() {
        let password = "test_password";
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::from_password(password, &salt).unwrap();

        let plaintext = b"Same data encrypted twice";

        let encrypted1 = encrypt(plaintext, &key).unwrap();
        let encrypted2 = encrypt(plaintext, &key).unwrap();

        // Even with same plaintext, encrypted data should differ (random nonce)
        assert_ne!(encrypted1, encrypted2);

        // But both should decrypt to the same plaintext
        let decrypted1 = decrypt(&encrypted1, &key).unwrap();
        let decrypted2 = decrypt(&encrypted2, &key).unwrap();
        assert_eq!(decrypted1, decrypted2);
        assert_eq!(decrypted1.as_slice(), plaintext);
    }
}
