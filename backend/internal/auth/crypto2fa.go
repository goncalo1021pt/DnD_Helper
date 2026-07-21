package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
)

// TOTP secrets must be reversible (we recompute codes from them), so they are
// encrypted at rest with AES-256-GCM under a key derived from SESSION_KEY. A
// leaked users table alone therefore can't generate anyone's codes.

// deriveTOTPKey turns the app's SESSION_KEY into a stable 32-byte AES key.
func deriveTOTPKey(sessionKey string) [32]byte {
	return sha256.Sum256([]byte("questboard-totp:" + sessionKey))
}

// encryptSecret seals plain with AES-256-GCM; output is base64(nonce||cipher).
func encryptSecret(key [32]byte, plain string) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

// decryptSecret reverses encryptSecret.
func decryptSecret(key [32]byte, enc string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func newGCM(key [32]byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// newRecoveryCodes returns n human-friendly single-use codes ("3f9a-1c7e") plus
// their SHA-256 hashes for storage. The raw codes are shown to the user once;
// only the hashes are persisted.
func newRecoveryCodes(n int) (raw, hashes []string) {
	for i := 0; i < n; i++ {
		b := make([]byte, 4)
		_, _ = rand.Read(b)
		code := fmt.Sprintf("%02x%02x-%02x%02x", b[0], b[1], b[2], b[3])
		raw = append(raw, code)
		hashes = append(hashes, hashToken(code))
	}
	return raw, hashes
}
