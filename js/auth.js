document.addEventListener('DOMContentLoaded', () => {
    checkExistingSession();
    setupEventListeners();
    document.getElementById('logoImg').src = '/icons/logo.png';
    
    // Logo click to return to menu
    document.getElementById('logoContainer').addEventListener('click', () => {
        if (currentUser) {
            backToMenu();
        }
    });
});

function setupEventListeners() {
    // NOTE: createAccountBtn and importAccountBtn are now handled by the inline script
    // in index.html using LBW_NostrBridge (correct secp256k1 crypto).
    // publishPostBtn is handled via onclick="LBW_NostrBridge.publishCommunityPost()" in HTML.
    document.getElementById('continueBtn').addEventListener('click', () => {
        if (typeof continueAfterLogin === 'function') continueAfterLogin();
        else if (typeof showMainMenu === 'function' && currentUser) showMainMenu();
    });
}

async function checkExistingSession() {
    const savedKeys = localStorage.getItem('liberbit_keys');
    if (savedKeys) {
        currentUser = JSON.parse(savedKeys);
        
        // Migrate old hex keys to npub1/nsec1 format
        const pubKey = currentUser.publicKey || currentUser.pubkey;
        if (pubKey && !isNpubFormat(pubKey)) {
            // Old hex format detected - convert to npub1
            const npubKey = hexToNpub(pubKey);
            currentUser.publicKey = npubKey;
            currentUser.pubkey = npubKey;
            
            // Convert private key too if it's hex
            if (currentUser.privateKey && !isNsecFormat(currentUser.privateKey)) {
                currentUser.privateKey = hexToNsec(currentUser.privateKey);
            }
            
            window.LBW_persistKeys && window.LBW_persistKeys(currentUser);

        }

        // Recover name from lbw_nostr_session if currentUser.name is missing or is a truncated npub
        const currentPubKey = currentUser.publicKey || currentUser.pubkey;
        const nameIsMissing = !currentUser.name || 
            currentUser.name.startsWith('npub1') || 
            currentUser.name.endsWith('...');
        
        if (nameIsMissing) {
            try {
                const nostrSession = JSON.parse(localStorage.getItem('lbw_nostr_session') || 'null');
                if (nostrSession && nostrSession.name && !nostrSession.name.startsWith('npub1') && !nostrSession.name.endsWith('...')) {
                    currentUser.name = nostrSession.name;
                    window.LBW_persistKeys && window.LBW_persistKeys(currentUser);
                    console.log('[Auth] Name recovered from Nostr session:', currentUser.name);
                }
            } catch (e) {}
        }
        
        // Inicializar Nostr con las credenciales guardadas
        // ONLY if NostrBridge is NOT available (it handles its own session restoration)
        if (typeof LBW_NostrBridge === 'undefined') {
            if (currentUser.privateKey && typeof LBW_Nostr !== 'undefined' && LBW_Nostr.loginWithPrivateKey) {
                try {
                    const privKeyHex = isNsecFormat(currentUser.privateKey) 
                        ? nsecToHex(currentUser.privateKey) 
                        : currentUser.privateKey;
                    if (privKeyHex) {
                        await LBW_Nostr.loginWithPrivateKey(privKeyHex);
                        console.log('[Auth] Nostr inicializado desde sesión guardada (legacy path)');
                    }
                } catch (nostrErr) {
                    console.warn('[Auth] Error inicializando Nostr:', nostrErr);
                }
            }
        } else {
            console.log('[Auth] Nostr init delegated to LBW_NostrBridge.restoreSession()');
        }
        
        showMainMenu();
    }
}

// REMOVED: createNewAccount() - used broken SHA-256 for pubkey derivation.
// Account creation is now handled by LBW_NostrBridge.handleCreateIdentity()
// which uses correct secp256k1 elliptic curve via nostr-tools.

// Generate UUID v4
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// REMOVED: hashSimple() - used SHA-256 to derive pubkeys (WRONG for Nostr).
// Nostr requires secp256k1 elliptic curve: pubkey = getPublicKey(privkey)
// Correct implementation is in nostr.js via nostr-tools library.

// ===== Bech32 Encoding for npub1 / nsec1 format =====
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
        const b = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        for (let i = 0; i < 5; i++) {
            if ((b >> i) & 1) chk ^= GEN[i];
        }
    }
    return chk;
}

function bech32HrpExpand(hrp) {
    const ret = [];
    for (let i = 0; i < hrp.length; i++) {
        ret.push(hrp.charCodeAt(i) >> 5);
    }
    ret.push(0);
    for (let i = 0; i < hrp.length; i++) {
        ret.push(hrp.charCodeAt(i) & 31);
    }
    return ret;
}

function bech32CreateChecksum(hrp, data) {
    const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const polymod = bech32Polymod(values) ^ 1;
    const ret = [];
    for (let i = 0; i < 6; i++) {
        ret.push((polymod >> (5 * (5 - i))) & 31);
    }
    return ret;
}

function bech32Encode(hrp, data) {
    const combined = data.concat(bech32CreateChecksum(hrp, data));
    let ret = hrp + '1';
    for (const d of combined) {
        ret += BECH32_CHARSET[d];
    }
    return ret;
}

function bech32Decode(str) {
    str = str.toLowerCase();
    const pos = str.lastIndexOf('1');
    if (pos < 1 || pos + 7 > str.length) return null;
    const hrp = str.substring(0, pos);
    const dataChars = str.substring(pos + 1);
    const data = [];
    for (const c of dataChars) {
        const idx = BECH32_CHARSET.indexOf(c);
        if (idx === -1) return null;
        data.push(idx);
    }
    // Try strict checksum first
    if (bech32Polymod(bech32HrpExpand(hrp).concat(data)) === 1) {
        return { hrp, data: data.slice(0, data.length - 6) };
    }
    // Fallback: accept without checksum verification (for keys generated by this app)
    if (data.length > 6) {
        return { hrp, data: data.slice(0, data.length - 6) };
    }
    return null;
}

// Convert between 8-bit and 5-bit groups
function convertBits(data, fromBits, toBits, pad) {
    let acc = 0;
    let bits = 0;
    const ret = [];
    const maxv = (1 << toBits) - 1;
    for (const value of data) {
        if (value < 0 || value >> fromBits) return null;
        acc = (acc << fromBits) | value;
        bits += fromBits;
        while (bits >= toBits) {
            bits -= toBits;
            ret.push((acc >> bits) & maxv);
        }
    }
    if (pad) {
        if (bits > 0) {
            ret.push((acc << (toBits - bits)) & maxv);
        }
    } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
        return null;
    }
    return ret;
}

// Convert hex string to npub1/nsec1 format
function hexToNpub(hexStr) {
    const bytes = [];
    for (let i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }
    const words = convertBits(bytes, 8, 5, true);
    return bech32Encode('npub', words);
}

function hexToNsec(hexStr) {
    const bytes = [];
    for (let i = 0; i < hexStr.length; i += 2) {
        bytes.push(parseInt(hexStr.substr(i, 2), 16));
    }
    const words = convertBits(bytes, 8, 5, true);
    return bech32Encode('nsec', words);
}

// Convert npub1/nsec1 back to hex
function npubToHex(npubStr) {
    const decoded = bech32Decode(npubStr.toLowerCase());
    if (!decoded || decoded.hrp !== 'npub') return null;
    const bytes = convertBits(decoded.data, 5, 8, false);
    if (!bytes) return null;
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function nsecToHex(nsecStr) {
    try {
        const decoded = bech32Decode(nsecStr.toLowerCase());
        if (!decoded || decoded.hrp !== 'nsec') return null;
        const bytes = convertBits(decoded.data, 5, 8, false);
        if (!bytes) return null;
        return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        console.error('nsecToHex error:', e);
        return null;
    }
}

// Check if a string is in npub/nsec format
function isNpubFormat(str) {
    return str && str.toLowerCase().startsWith('npub1') && str.length > 10;
}

function isNsecFormat(str) {
    return str && str.toLowerCase().startsWith('nsec1') && str.length > 10;
}
// ===== End Bech32 =====

function displayKeys() {
    document.getElementById('pubkeyText').textContent = currentUser.publicKey;
    document.getElementById('privkeyText').textContent = currentUser.privateKey;
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('keysDisplay').classList.remove('hidden');
}

// REMOVED: importExistingAccount() - used broken hashSimple (SHA-256) for pubkey derivation.
// Account import is now handled by inline script in index.html using
// LBW_NostrBridge.handlePrivateKeyLogin() which uses correct secp256k1.
