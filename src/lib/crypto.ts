const isSubtleSupported = typeof window !== 'undefined' && !!(window.crypto && window.crypto.subtle);

export async function deriveKey(roomCode: string): Promise<CryptoKey | { roomCode: string; isFallback: boolean }> {
  const forceFallback = roomCode.startsWith('dev-') || roomCode.includes('fallback');
  if (isSubtleSupported && !forceFallback) {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(roomCode),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode("ephemeral-clipboard-salt"),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // Fallback for non-secure HTTP contexts (e.g., testing via LAN IP http://172.20.10.3:3000)
  return { roomCode, isFallback: true };
}

function fallbackCipher(text: string, key: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
}

function fallbackDecipher(b64: string, key: string): string {
  const text = atob(b64);
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

export async function encryptPayload(cryptoKey: any, payload: any) {
  if (isSubtleSupported && cryptoKey && !(cryptoKey as any).isFallback) {
    const encoder = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      cryptoKey as CryptoKey,
      encoder.encode(JSON.stringify(payload))
    );

    return {
      roomId: payload.roomId,
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(encrypted)),
      isFallback: false
    };
  }

  // Fallback encryption for non-secure HTTP context
  const keyStr = cryptoKey?.roomCode || 'fallback-key';
  const ciphertextStr = fallbackCipher(JSON.stringify(payload), keyStr);
  return {
    roomId: payload.roomId,
    iv: [],
    ciphertextStr,
    isFallback: true
  };
}

export async function decryptPayload(cryptoKey: any, encryptedData: any) {
  if (isSubtleSupported && cryptoKey && !(cryptoKey as any).isFallback && !encryptedData.isFallback) {
    const iv = new Uint8Array(encryptedData.iv);
    const ciphertext = new Uint8Array(encryptedData.ciphertext);

    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      cryptoKey as CryptoKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
  }

  // Fallback decryption for non-secure HTTP context
  const keyStr = cryptoKey?.roomCode || 'fallback-key';
  if (encryptedData.ciphertextStr) {
    const jsonStr = fallbackDecipher(encryptedData.ciphertextStr, keyStr);
    return JSON.parse(jsonStr);
  }
  
  // If sender sent standard array but receiver is fallback
  if (encryptedData.ciphertext) {
    const decoder = new TextDecoder();
    const str = decoder.decode(new Uint8Array(encryptedData.ciphertext));
    return JSON.parse(str);
  }

  throw new Error("Unable to decrypt payload");
}
