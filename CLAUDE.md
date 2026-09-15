# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ColombiaP2P es la plataforma digital de la comunidad Bitcoin colombiana, construida sobre Nostr + Bitcoin Lightning Network. Es una **static Single-Page Application** (sin build, sin bundler) desplegada en **Vercel** (`colombiap2p.com`). La persistencia combina eventos Nostr firmados criptográficamente y **PocketBase** (`api.colombiap2p.com`) para datos estructurados (eventos, check-ins, XP, rachas, referidos, NIP-05). El idioma principal es español.

## Development

- **Sin comandos de build/test/lint** — Vanilla HTML/CSS/JS con dependencias CDN (nostr-tools, Tailwind CSS, DaisyUI, Leaflet, qrcodejs, PocketBase JS SDK).
- **Desarrollo local:** servir `index.html` con cualquier servidor estático (ej. `npx serve .`). Las serverless functions de `/api/*` devuelven 404 local — esperado, solo existen en Vercel.
- **Deploy:** push a rama `main`; Vercel despliega automáticamente.
- El directorio `api/` contiene Vercel serverless functions (proxy LNURL, NIP-05, transparencia).

### Cache busting

El service worker (`/sw.js`) usa cache-first para JS. **Cada cambio en un archivo `.js` debe subir su parámetro `?v=` en `index.html`** para que el SW descargue la versión nueva. En refactorizaciones grandes, subir también `CACHE_NAME` en `/sw.js`.

## Architecture

### Script Load Order (`index.html`)

El HTML carga ~40 scripts en dos bloques. El orden importa para algunas dependencias; la mayoría de módulos se exponen en `window` y se resuelven en `DOMContentLoaded`. Posiciones críticas:

```
escape-utils.js       → primero: define LBW.escapeHtml/safeUrl usado por toda la UI
lbw-passlock.js       → antes de auth.js: NIP-49 cifrado de nsec con contraseña;
                        expone LBW_Passlock y window.LBW_persistKeys
config.js             → proxy Supabase (legado) + silenciador de console.log en prod
                        (reactivar con localStorage.lbw_debug=1 o ?debug=1)
auth.js               → bech32 encoding, session persistence
c2p-pocketbase.js     → cliente PocketBase (C2P_PB) — debe cargarse antes de c2p-*.js
ui.js, posts.js, marketplace.js, p2p-exchange.js,
notifications.js, chat.js, lightning.js, governance.js,
profile.js, nwc.js, wallet.js  → UI handlers (funciones plain en window)

nostr-store.js        → IndexedDB cache (sin deps)
nostr-media.js        → subida de imágenes multi-proveedor
chat-attachments.js   → helpers de adjuntos en chat
nostr.js              → Core: SimplePool, crypto, relay routing, NIPs
nostr-nip46.js        → Remote signer client (bunker://)
nostr-dm.js           → DM abstraction NIP-04/44
nostr-sync.js         → SyncEngine: cache-first + sync incremental
nostr-governance.js   → Propuestas + votos
nostr-delegations.js, delegations-ui.js
nostr-merits.js       → Sistema de méritos C2PM
merits.js
supabase-merits-sync.js, supabase-governance-sync.js
nostr-reviews.js      → NIP-85 reviews
nostr-marketplace-pay.js
nostr-stalls.js       → NIP-15 stalls
nostr-bridge.js       → UI <-> Nostr bridge: login, feeds, lifecycle
debate.js, avatar-fix.js, missions.js, map.js, city-prompt.js
c2p-eventos.js        → Módulo eventos + check-in QR (C2P_Eventos)
c2p-rachas.js         → Módulo rachas diarias + referidos (C2P_Rachas)
transparency.js, c2p-treasury.js  → Transparencia + tab XP (C2P_Treasury)
c2p-stats.js          → Estadísticas comunitarias (C2P_Stats)
```

### Dos capas JS

**LBW_\* modules** — IIFE retornando API pública, expuestos en `window` (nombres heredados del fork, no renombrar sin refactor completo):

- `LBW_Passlock` — NIP-49 cifrado de nsec con contraseña; caché en memoria durante la sesión.
- `LBW_Nostr` — core relay pool, event publish/subscribe, NIP crypto.
- `LBW_Store` — IndexedDB: eventos, profiles, cursors, replaceables, relayLists.
- `LBW_Sync` — cache-first hydration + sync incremental desde relays.
- `LBW_Media` — subida de imágenes multi-proveedor + fallback URLs.
- `LBW_DM` — mensajes directos cifrados (NIP-04/44).
- `LBW_Governance` — propuestas (kind 31000) y votos (kind 31001).
- `LBW_Merits` — méritos C2PM (kinds 31002-31005); SEC-22 valida emisor.
- `LBW_Delegations` — delegación de voto (NIP-26-style). **Oculta en UI** (`display:none`) — código preservado para reactivación futura.
- `LBW_Reviews` — NIP-85 reviews.
- `LBW_MarketPay` — flujo de pago Lightning en marketplace.
- `LBW_Stalls` — NIP-15 marketplace stalls/products.
- `LBW_NWC` — NIP-47 wallet connect (URI cifrado con NIP-49).
- `LBW_NostrBridge` — orquesta login/logout, suscripciones, DM rendering.
- `LBW_Debate`, `LBW_Missions`, `LBW_Transparency`.

**C2P_\* modules** — módulos nuevos de ColombiaP2P, mismo patrón IIFE + `window`:

- `C2P_PB` — cliente PocketBase; `C2P_PB.getClient()` devuelve la instancia.
- `C2P_Eventos` — eventos comunitarios + check-in QR. `init()` al abrir la sección.
- `C2P_Rachas` — rachas diarias de actividad + sistema de referidos. `init()` desde `loadUserProfile()`.
- `C2P_Treasury` — tab XP en Transparencia; historial de `xp_transactions` por usuario.
- `C2P_Stats` — estadísticas comunitarias (eventos, check-ins, XP, rachas, referidos, NIP-05). `load()` al abrir la sección.

**UI scripts** son funciones plain en `window` (sin module wrapper): `auth.js`, `chat.js`, `posts.js`, `lightning.js`, `notifications.js`, `marketplace.js`, `merits.js`, `governance.js`.

### Identidad y Crypto

- **NIP-07 (extensión)**: más seguro — nsec en Alby/nos2x.
- **NIP-49 (passlock)**: nsec cifrada en `localStorage.lbw_ncryptsec` con scrypt+XChaCha20-Poly1305. La nsec descifrada solo vive en memoria. `LBW_Passlock.unlockWithPasswordPrompt` la abre al cargar.
- **NIP-46 (bunker remoto, opt-in)**: nsec en bunker externo (nsec.app, Amber). Session-only — al recargar el usuario reconecta con el `bunker://`. Ver `docs/security.md`.

### Relay Routing

Implementado en `nostr.js:_getRelaysForKind`:

| Kinds | Routing |
|-------|---------|
| **PRIVATE_KINDS**: DMs (4), gobernanza (31000-31006) | Solo relay privado (`wss://relay.colombiap2p.com` — descomentar en `nostr.js` cuando esté activo). [SEC-A7] sin fallback público. |
| **PUBLIC_KINDS**: metadata (0), chat (1), reactions (7), marketplace, reviews, stalls, relay-list | Privado + públicos (`relay.damus.io`, `nos.lol`). |
| **Privacy Strict mode** | Cero eventos a públicos. Toggle en perfil. |

> **Nota**: `relay.colombiap2p.com` está comentado en `SYSTEM_PRIVATE_RELAYS` de `nostr.js`. Descomentar cuando el relay esté activo y bumpar `?v=` del script.

### Colecciones PocketBase (`api.colombiap2p.com`)

| Colección | Propósito |
|-----------|-----------|
| `stamps` / `user_stamps` | Sellos coleccionables de eventos |
| `badges` / `user_badges` | Badges/logros de habilidad |
| `missions` | Misiones educativas |
| `merit_contributions` | Contribuciones de méritos C2PM |
| `events` | Eventos comunitarios (con `checkin_token` para QR) |
| `event_checkins` | Check-ins presenciales |
| `xp_transactions` | Historial XP (source, reason, amount, user_pubkey) |
| `nip05_identities` | Identidades `usuario@colombiap2p.com` activas |
| `user_streaks` | Rachas diarias (current, max, last_activity_date) |
| `referrals` | Referidos (referrer_pubkey_short, referred_pubkey) |

### Vercel Serverless Functions

- `api/lnurlp/callback.js` — proxy de callback LNURL → `colsats.com`.
- `api/lnurlp/resolve.js` — resolutor LNURLP con SSRF lock.
- `api/well-known/lnurlp/aportaciones.js` — LNURL well-known; sobreescribe `callback` al proxy propio.
- `api/well-known/nostr/json.js` — NIP-05 dinámico; consulta `nip05_identities` en PocketBase.
- `api/transparency/wallet.js` — datos de tesorería: LNURL público + LNbits API opcional.

### Variables de entorno Vercel

| Variable | Uso |
|----------|-----|
| `LNBITS_URL` | URL instancia LNbits (ej. `https://colsats.com`) |
| `LNBITS_READ_KEY` | Invoice/read key para balance y pagos |
| `LNBITS_WALLET_ID` | (Opcional) filtrar pagos por wallet |

### Lightning

- Lightning address: `colombiap2p@colsats.com`
- LNURL endpoint: `https://colombiap2p.com/.well-known/lnurlp/aportaciones`
- Montos sugeridos: 21 / 210 / 2.100 / 21.000 sats

### Key Patterns

- **Cache-first sync**: IndexedDB hidrata UI al instante vía `LBW_Sync.syncedSubscribe`; SyncEngine obtiene solo eventos nuevos (since=cursor) desde relays.
- **Custom Nostr kinds 31000-31006**: gobernanza, votos, méritos C2PM, contribuciones, delegaciones, snapshots.
- **`index.html` is a monolithic SPA** (~4000+ líneas) con todas las secciones inline.
- **`auth.js`** tiene el logo en base64 (~108KB, 314 líneas). Leer con offset/limit para no agotar tokens.
- **`avatar-fix.js`** es un monkey-patch que inyecta avatares en mensajes de chat.
- **IDs internos `lbwm_*`** (`user_lbwm_activos`, `user_lbwm_aportaciones`, etc.) no se renombraron — cambiarlos requiere refactor de `merits.js`.

### CI/CD

- Vercel auto-deploya `main` y crea preview URLs por PR.
- Preview URLs protegidas por Vercel Deployment Protection — usar `?x-vercel-protection-bypass=<token>&x-vercel-set-bypass-cookie=true` para acceso externo.

## Security audit reference

`docs/security.md` documenta el modelo de amenazas. Auditoría 2026-05-07 cerró 1 Critical y 8 High; los Mediums se atacan en PRs incrementales etiquetados `M-N`.
