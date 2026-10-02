// Entrada de js/vendor/nip06.min.js — NIP-06: claves Nostr desde 12 palabras BIP-39.
// Se sirve desde nuestro dominio (no CDN) porque genera claves privadas.
// Reconstruir (desde la raíz del repo, con node_modules instalado):
//   npx esbuild@0.21.5 scripts/vendor/nip06-entry.js --bundle --format=iife --minify \
//     --legal-comments=inline --platform=browser --outfile=js/vendor/nip06.min.js
import { generateSeedWords, privateKeyFromSeedWords, validateWords } from 'nostr-tools/nip06';
window.C2P_NIP06 = Object.freeze({ generateSeedWords, privateKeyFromSeedWords, validateWords });
