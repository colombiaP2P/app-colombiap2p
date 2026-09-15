# Arquitectura ColombiaP2P — Documento de Análisis

> **FASE 0 — Solo lectura. Ningún archivo fue modificado.**
>
> Fecha de análisis: 2026-09-14  
> Basado en: repositorio `app-LiberBit-World` (LiberBit World v2.1)

---

## 1. RESUMEN DEL PROYECTO ACTUAL

**LiberBit World** es una SPA (Single-Page Application) en Vanilla JS sin build step ni bundler.
Desplegada en Vercel con auto-deploy desde `main`. No hay backend propio: toda la persistencia
se hace mediante eventos Nostr firmados criptográficamente en relays privados/públicos.
Supabase actúa como índice secundario para búsquedas y métricas, accedido exclusivamente vía
un proxy serverless en Vercel (`/api/db`) para que las credenciales nunca lleguen al cliente.

**Pilares técnicos actuales:**
- Identidad soberana vía Nostr (NIP-07/49/46)
- Méritos descentralizados en relays privados (kinds 31002/31003/31005)
- Gobernanza por méritos con delegación líquida (kinds 31000/31001/31004)
- Lightning Network para donaciones y zaps (LNURL + NIP-57)
- PWA instalable (manifest + service worker)
- Supabase para misiones, búsqueda e índices

---

## 2. MAPA DE ARCHIVOS

### Tamaño total del JS (~1.5MB sin minificar)

| Archivo | Tamaño | Descripción |
|---------|--------|-------------|
| `js/nostr-bridge.js` | 126KB | Orquestador principal: login/logout, suscripciones, DM rendering |
| `js/auth.js` | 109KB | Autenticación + bech32 + **base64 logo embebido (~80KB)** |
| `js/nostr.js` | 74KB | Core Nostr: SimplePool, crypto, relay routing, NIPs |
| `js/nostr-governance.js` | 95KB | Propuestas (31000) + votos (31001) + delegación + NIP-72 |
| `js/nostr-merits.js` | 67KB | Sistema LBWM: categorías, niveles ciudadanía, snapshots |
| `js/merits.js` | 88KB | UI de méritos: formularios, leaderboard, migración legacy |
| `js/missions.js` | 52KB | Sistema de misiones (bounty board) vía Supabase |
| `js/transparency.js` | 80KB | Panel de transparencia de tesorería |
| `js/governance.js` | 59KB | UI de gobernanza: propuestas, votación, resultados |
| `js/nostr-stalls.js` | 44KB | NIP-15 marketplace (stalls/products) |
| `js/nostr-nip46.js` | 38KB | Remote signer (bunker://) |
| `js/p2p-exchange.js` | 38KB | Agregador P2P exchange (Mostro/lnp2pbot/RoboSats) |
| `js/profile.js` | 43KB | Perfil de usuario + gauge de ciudadanía (Canvas) |
| `js/chat.js` | 42KB | Chat rooms + DMs |
| `js/nostr-store.js` | 25KB | IndexedDB cache (5 stores) |
| `js/lbw-passlock.js` | 28KB | NIP-49: nsec cifrada con contraseña |
| `js/map.js` | 37KB | Mapa Leaflet de ciudades físicas LiberBit |
| `js/wallet.js` | 22KB | Billetera Lightning + NWC |
| `js/notifications.js` | 22KB | Sistema de notificaciones in-app |
| `js/nostr-dm.js` | 5.7KB | DM abstraction NIP-04/44 |
| `js/nostr-delegations.js` | 18KB | Delegación de voto (kind 31004) |
| `js/delegations-ui.js` | 13KB | UI de delegaciones |
| `js/nostr-marketplace-pay.js` | 30KB | Pagos marketplace Lightning |
| `js/nostr-media.js` | 14KB | Upload de imágenes multi-provider |
| `js/nostr-reviews.js` | 22KB | NIP-85 reviews (marketplace) |
| `js/supabase-merits-sync.js` | 18KB | Sync Nostr merits → Supabase |
| `js/supabase-governance-sync.js` | 14KB | Sync Nostr governance → Supabase |
| `js/lightning.js` | 13KB | LNURL-pay + NIP-57 Zaps |
| `js/nwc.js` | 17KB | NIP-47 Wallet Connect |
| `js/escape-utils.js` | 4.1KB | XSS protection (LBW.escapeHtml) |
| `js/ui.js` | 26KB | UI helpers y navegación |
| `js/verification.js` | 15KB | Verificación de identidad |
| `js/chat-attachments.js` | 11KB | Adjuntos en chat |
| `js/avatar-fix.js` | 7.4KB | Monkey-patch de avatares |
| `js/debate.js` | 6.1KB | Debate NIP-72 por propuesta |
| `js/city-prompt.js` | 12KB | Prompts de LiberBit City |
| `js/lbw-mute.js` | 3.0KB | Sistema de mute |
| `js/lbw-professions.js` | 4.0KB | Catálogo profesiones LiberBit |
| `js/config.js` | 11KB | Supabase proxy client |
| `js/posts.js` | 13KB | Feed de posts Nostr (kind 1) |
| `js/marketplace.js` | 14KB | UI marketplace |

### Serverless API (Vercel)

| Archivo | Descripción |
|---------|-------------|
| `api/lnurlp/callback.js` | Proxy LNURL-pay → coinos.io |
| `api/lnurlp/resolve.js` | Resolver SSRF-locked para marketplace |
| `api/well-known/lnurlp/aportaciones.js` | Endpoint LNURL-pay público |
| `api/transparency/wallet.js` | Datos públicos coinos.io (sin auth aún) |

### Estructura de secciones del menú actual

| Sección | `openApp()` | Descripción real |
|---------|-------------|-----------------|
| Networking | `networking` | Feed Nostr (kind 1) + perfiles |
| Chat | `chat` | DMs NIP-44 + chat rooms |
| Merits y Gobernanza | `gobernanza` | Propuestas + votos + méritos + delegación |
| **Justicia** | (externo) | **Solo abre `https://www.deius.io` en nueva pestaña** |
| Mi Perfil | `perfil` | Perfil con gauge ciudadanía (Canvas) |
| **Mapa P2P** | `mapa` | **Leaflet de ciudades físicas LiberBit** |
| Billetera | `billetera` | Lightning + NWC |
| **SOS** | `sos` | **Alertas de emergencia para residentes físicos** |
| Transparencia | `transparencia` | Panel tesorería coinos.io |

---

## 3. NOSTR — IMPLEMENTACIÓN ACTUAL

### Capa de conexión (`nostr.js` — `LBW_Nostr`)

- **SimplePool** de nostr-tools v2.7 maneja el pool de WebSockets
- **Routing por kind**: eventos privados → solo `relay.liberbitworld.org`; eventos públicos → privados + `relay.damus.io`, `nos.lol`, `relay.nostr.band`, `purplepag.es`
- **Privacy Strict mode**: toggle que fuerza todo a relays privados
- Validación de URLs: solo `wss://` en producción (`ws://` solo en localhost)
- Rate limiting por relay y por pubkey
- Tamaño máximo de contenido enforced

### NIPs implementados

| NIP | Módulo | Uso |
|-----|--------|-----|
| NIP-01 | `nostr.js` | Eventos base, validación, firma |
| NIP-04 | `nostr-dm.js` | DMs legacy (AES-256-CBC) |
| NIP-07 | `auth.js` | Login con extensión (Alby, nos2x) |
| NIP-15 | `nostr-stalls.js` | Marketplace stalls/products |
| NIP-19 | `auth.js` | npub/nsec encoding bech32 |
| NIP-26 | `nostr-delegations.js` | Delegación de voto |
| NIP-33 | `nostr-governance.js`, `nostr-merits.js` | Eventos replaceable |
| NIP-44 | `nostr-dm.js` | DMs modernos (XChaCha20-Poly1305) |
| NIP-46 | `nostr-nip46.js` | Remote signer (bunker://) |
| NIP-47 | `nwc.js` | Wallet Connect |
| NIP-49 | `lbw-passlock.js` | nsec cifrada con contraseña |
| NIP-57 | `lightning.js` | Zaps (kind 9734/9735) |
| NIP-65 | `nostr.js` | Relay list del usuario |
| NIP-72 | `nostr-governance.js` | Communities per propuesta |
| NIP-85 | `nostr-reviews.js` | Reviews marketplace |
| NIP-99 | `nostr-stalls.js` | Classified listings |

### Custom kinds (LiberBit-specific)

| Kind | Uso | Relay |
|------|-----|-------|
| 31000 | Propuesta de gobernanza | Privado |
| 31001 | Voto (temático o admisión) | Privado |
| 31002 | Merit award | Privado |
| 31003 | Contribución (auto-declarada) | Privado |
| 31004 | Delegación de voto | Privado |
| 31005 | Snapshot leaderboard | Privado |
| 31010 | Resultado de propuesta | Privado |
| 31011 | Reporte de ejecución | Privado |
| 31012 | Verificación de ejecución | Privado |
| 34550 | NIP-72 Community (por propuesta + paraguas) | Privado + Público |

### Identidad

Tres métodos de login:
1. **NIP-07** (extensión): nsec en Alby/nos2x, nunca toca el navegador
2. **NIP-49** (passlock): nsec cifrada con contraseña en `localStorage.lbw_ncryptsec`
3. **NIP-46** (bunker): nsec en nsec.app/Amber, firma delegada por WebSocket

### Sincronización

- `LBW_Store` (IndexedDB): 5 stores — events, profiles, cursors, replaceables, relayLists
- `LBW_Sync` (SyncEngine): cache-first hydration, luego incremental desde relays (since=cursor)
- `supabase-merits-sync.js`: sincroniza merit events Nostr → Supabase para leaderboard
- `supabase-governance-sync.js`: sincroniza propuestas → Supabase para búsqueda

---

## 4. LIGHTNING — IMPLEMENTACIÓN ACTUAL

### Flujos implementados

**A — Lightning genérico** (`lightning.js`):
- Abre `lightning:<LN_ADDRESS>` en la wallet del usuario
- Sin atribución de donante
- La LN Address es `liberbitworld@coinos.io`

**B — Zap NIP-57** (`lightning.js`):
- Usuario logueado firma kind 9734 con su nsec
- GET LNURLP callback con `&nostr=<event-json>`
- coinos.io publica kind 9735 (zap receipt)
- Aparece en panel de transparencia con badge `⚡ zap`

**C — NWC** (`nwc.js`, `wallet.js`):
- NIP-47 Wallet Connect con URI cifrado vía NIP-49
- Permite pagar invoices desde wallet externa

### Serverless API

- `api/lnurlp/callback.js`: proxy a `coinos.io/lnurlp/Liberbitworld/callback`
- `api/well-known/lnurlp/aportaciones.js`: endpoint `/.well-known/lnurlp/aportaciones`
- `api/transparency/wallet.js`: datos públicos de coinos.io (perfil, LNURLP). Balance y movimientos requieren NIP-98 auth — **no implementado todavía** (bug con `@noble/*` en lambda Vercel)

### Estado actual de la tesorería

- Wallet: `liberbitworld@coinos.io`
- Saldo y movimientos: solo visibles manualmente en `coinos.io/Liberbitworld`
- Panel de transparencia muestra: dirección LN, QR, link directo a coinos.io
- **Pendiente**: auth NIP-98 para mostrar saldo + movimientos desde la app

---

## 5. GOBERNANZA — IMPLEMENTACIÓN ACTUAL

### Sistema de 3 bloques de votación

| Bloque | % mínimo | Quién | Voto |
|--------|----------|-------|------|
| Gobernanza (Génesis) | 51% floor | ≥3000 méritos | 1 voto/persona |
| Ciudadanía | ≤29% | 1000-2999 méritos | Proporcional a méritos |
| Comunidad | ≤20% | 0-999 méritos | 1 persona = 1 voto |

### Ciclo de vida de una propuesta

```
Cualquier usuario crea  →  pending_admission
Génesis votan admisión (kind 31001 + vote_type=admission)
  ≥2 Génesis + >50% sí → active
  30 días sin quorum → admission_expired
  Rechazo → admission_rejected
active → votación temática (kind 31001)
         debate NIP-72 (kind 1 + a-tag community)
       → expired (por timestamp)
       → closed (manual)
       → in_execution → executed
       → quorum_failed
```

### Democracia líquida (v2.1)

- `kind 31004`: delega tu voto a otro ciudadano
- No transitiva (no cadenas de delegación)
- Voto directo siempre sobreride la delegación
- Génesis delegados cuentan para quorum

### Méritos automáticos por participar en gobernanza

- Votar (nivel Senior+): +5 Responsabilidad (×1.2)
- Votar (otros): +3 Productiva
- Propuesta aprobada: +50 Productiva al autor
- Propuesta rechazada: +10 Productiva al autor
- Ejecución verificada: +50 Productiva

### Todo en relays privados

Excepción: `kind 34550` (NIP-72 community) se publica también en relays públicos para descubrimiento externo. Propuestas, votos, resultados y ejecuciones: **exclusivamente privados**.

---

## 6. MÉRITOS — IMPLEMENTACIÓN ACTUAL

### Fórmula

```
merit_points = contribution_amount × category_weight
```

### Categorías

| Categoría | Peso | Descripción | Requisito |
|-----------|------|-------------|-----------|
| Económica definitiva | 1.0 | Aportaciones económicas al ecosistema | Ninguno |
| Productiva | 1.0 | Trabajo, desarrollo, servicios | Ninguno |
| Responsabilidad | 1.2 | Gobernanza, moderación, confianza | 1000+ méritos previos |
| Financiada | 0.6 | Aportaciones con pago aplazado | Ninguno |
| Fundacional | 1.0 | Bootstrap fundadores | Solo bootstrap |

### Niveles de ciudadanía

| Nivel | Nombre | Méritos mínimos | Bloque |
|-------|--------|-----------------|--------|
| 1 | Amigo | 0 | Comunidad |
| 2 | E-Residency | 100 | Comunidad |
| 3 | Colaborador | 500 | Comunidad |
| 4 | Ciudadano Senior | 1.000 | Ciudadanía |
| 5 | Custodio | 2.000 | Ciudadanía |
| 6 | Génesis | 3.000 | Gobernanza |

**Cap de votación Génesis**: `min(total_merits, 3000)` — nadie puede acumular poder ilimitado.

### Protecciones anti-plutocráticas actuales

1. Cap de 3000 méritos para votación Génesis
2. 3 bloques de voto — ningún grupo domina solo
3. Categoría Responsabilidad requiere 1000+ méritos previos
4. Transparencia total: eventos verificables criptográficamente
5. Snapshots firmados por Génesis para consenso de leaderboard

### Almacenamiento

- Fuente de verdad: relays Nostr privados (kinds 31002/31003/31005)
- Índice: Supabase (via `supabase-merits-sync.js`)
- Cache local: IndexedDB (`LBW_Store`)

---

## 7. CLASIFICACIÓN DE COMPONENTES

### 🟢 REUTILIZAR (sin modificar, solo actualizar strings de branding)

| Componente | Motivo |
|-----------|--------|
| `js/nostr.js` | Core Nostr bien estructurado, relay routing, crypto robusto |
| `js/nostr-store.js` | IndexedDB cache, sin dependencias LiberBit |
| `js/nostr-sync.js` | SyncEngine eficiente, cache-first |
| `js/nostr-dm.js` | Abstracción DM NIP-04/44, limpia |
| `js/nostr-governance.js` | Motor de propuestas/votos sólido — adaptar solo constants |
| `js/nostr-merits.js` | Motor de méritos — adaptar categorías y niveles |
| `js/nostr-delegations.js` | Delegación líquida — mantener |
| `js/nostr-nip46.js` | Bunker login — mantener |
| `js/lbw-passlock.js` | NIP-49 nsec encryption — crítico, mantener |
| `js/escape-utils.js` | XSS protection — mantener |
| `js/nostr-media.js` | Upload imágenes — mantener |
| `js/supabase-governance-sync.js` | Sync Nostr→Supabase para índices |
| `js/supabase-merits-sync.js` | Sync Nostr→Supabase méritos |
| `api/lnurlp/callback.js` | Proxy LNURL (cambiar solo username) |
| `api/transparency/wallet.js` | Transparencia tesorería (cambiar username) |
| `sw.js` | Service Worker PWA |
| `manifest.json` | PWA manifest (actualizar nombre/colores) |

### 🟡 ADAPTAR (funcionalidad útil, interfaz o concepto cambia)

| Componente | Qué cambiar |
|-----------|-------------|
| `js/missions.js` | De "bounty board" → misiones educativas con pasos, badges, XP |
| `js/governance.js` | Textos, nombres de bloques, tipos de propuesta ColombiaP2P |
| `js/merits.js` | Categorías → trabajo en comunidad, educación, infraestructura; UI |
| `js/profile.js` | Transformar en **Pasaporte Bitcoiner** con XP + méritos separados |
| `js/lightning.js` | Cambiar LN Address y treasury pubkey a wallet ColombiaP2P |
| `js/transparency.js` | Adaptar para wallet ColombiaP2P + mostrar saldo cuando se implemente auth |
| `js/notifications.js` | Actualizar tipos de notificación para ColombiaP2P |
| `js/wallet.js` | Actualizar para NWC y dirección ColombiaP2P |
| `js/delegations-ui.js` | UI adaptada al lenguaje ColombiaP2P |
| `js/config.js` | Credenciales Supabase ColombiaP2P |
| `js/nostr-bridge.js` | Actualizar relay config, strings de branding, feature subscriptions |
| `js/debate.js` | Adaptar lenguaje de debate |
| `js/lbw-mute.js` | Renombrar `LBW_Mute` → `C2P_Mute` |
| `api/well-known/lnurlp/aportaciones.js` | Cambiar a Lightning Address ColombiaP2P |
| `vercel.json` | Actualizar CSP para nuevos dominios |
| `css/main.css` | **Rediseño visual completo** — naranja Bitcoin, identidad ColombiaP2P |
| `index.html` | Rediseño estructura + secciones nuevas (sellos, badges, checkin, eventos) |

### 🟠 REFACTORIZAR (funciona pero dificulta mantenimiento)

| Componente | Problema | Solución |
|-----------|----------|---------|
| `js/auth.js` (109KB) | ~80KB de base64 logo embebido; lógica mezclada con assets | Extraer logo a archivo separado; dividir auth logic |
| `js/nostr-bridge.js` (126KB) | Monolito: login + suscripciones + DM rendering + UI | Dividir en bridge-core, bridge-dm, bridge-feed |
| `index.html` (3912 líneas) | Todo el HTML en un solo archivo | Considerar web components o templates JS para cada sección |

### 🔴 ELIMINAR (solo pertenece al concepto LiberBit, sin valor para ColombiaP2P)

| Componente | Motivo |
|-----------|--------|
| `js/map.js` (37KB) | Mapa de ciudades físicas LiberBit City — no relevante |
| `js/city-prompt.js` (12KB) | Prompts de LiberBit City |
| `js/nostr-stalls.js` (44KB) | Marketplace NIP-15 — fuera de scope ColombiaP2P inicial |
| `js/nostr-marketplace-pay.js` (30KB) | Pagos marketplace — fuera de scope |
| `js/marketplace.js` (14KB) | UI marketplace |
| `js/nostr-reviews.js` (22KB) | Reviews NIP-85 del marketplace |
| `js/p2p-exchange.js` (38KB) | Aggregador Mostro/lnp2pbot — puede reintegrarse luego como módulo P2P ColombiaP2P |
| `js/lbw-professions.js` (4KB) | Catálogo profesiones LiberBit |
| `js/posts.js` (13KB) | Feed Nostr genérico — ColombiaP2P prioriza comunidad local |
| `js/chat-attachments.js` (11KB) | Adjuntos chat — eliminar en fase inicial |
| `js/avatar-fix.js` (7.4KB) | Monkey-patch — incorporar fix limpio donde se necesite |
| `amanecer_LiberBit_*.jpg` | Imágenes branding LiberBit |
| `zapstore.yaml` | Específico LiberBit |
| **Sección "Justicia"** | Solo un link externo a deius.io — irrelevante |
| **Sección "SOS"** | Alertas de emergencia físicas para residentes LiberBit City |
| **Sección "Networking"** | Feed Nostr genérico — reemplazar por comunidad ColombiaP2P |

---

## 8. NUEVA ARQUITECTURA COLOMBIAP2P

### Filosofía

```
participar → aprender → contribuir → ganar reputación → participar en decisiones
```

La app es infraestructura digital de la comunidad. La gamificación (XP, sellos, rachas)
fomenta retención. Los méritos dan peso real en decisiones. Nostr asegura soberanía
de identidad y gobernanza. Lightning habilita economía circular.

### Stack propuesto (sin cambios de stack)

| Capa | Tecnología | Cambios |
|------|-----------|---------|
| Frontend | Vanilla JS SPA | Solo adaptación — no cambiar stack |
| Identidad | Nostr NIPs existentes | Mantener |
| Gobernanza | Nostr kinds 31000-31012 | Adaptar constants y UI |
| Méritos | Nostr kinds 31002-31005 | Adaptar categorías |
| Gamificación (XP, sellos, rachas) | **Supabase** | Nuevo — más simple que Nostr para esto |
| Eventos y check-in | **Supabase** | Nuevo — necesita gestión admin |
| Badges | **Supabase** | Nuevo — condiciones configurables |
| Misiones | Supabase (ya existe) | Adaptar para ColombiaP2P |
| Lightning | coinos.io proxy | Cambiar cuenta |
| Deploy | Vercel | Sin cambios |
| Cache local | IndexedDB | Sin cambios |

### Navegación propuesta

```
🏠 Inicio          → Landing/onboarding
🪪 Pasaporte       → Mi perfil completo (XP + méritos + sellos + badges + rachas)
🟠 Sellos          → Colección de sellos de eventos
🏆 Badges          → Logros y habilidades
🎯 Misiones        → Desafíos educativos
⭐ Méritos         → Historial, contribuciones, leaderboard
🗳️ Gobernanza      → Propuestas y votaciones
⚡ Lightning        → Billetera + donaciones + tesorería
🟣 Nostr           → Identidad, relays, DMs, feed comunidad
📅 Eventos         → Próximos eventos + check-in
👥 Comunidad       → Stats, referidos, ranking
⚙️ Admin           → Solo admins: gestión completa
```

### Diagrama de flujo principal

```
Usuario llega
    │
    ├─ Primer acceso
    │       └─ Login Nostr (NIP-07 / NIP-49 / NIP-46)
    │               └─ Crear Pasaporte ColombiaP2P (registro en Supabase)
    │
    ├─ Evento presencial
    │       └─ Escanea QR firmado (HMAC + TTL)
    │               ├─ +XP
    │               ├─ Nuevo sello
    │               ├─ Actualiza racha
    │               └─ Evalúa badges + misiones
    │
    ├─ Completa misión
    │       └─ Marca paso completado
    │               ├─ +XP por completar
    │               └─ Desbloquea badge (si aplica)
    │
    ├─ Contribución (admin aprueba)
    │       └─ +Méritos (categoría específica)
    │               └─ Actualiza nivel de ciudadanía
    │
    └─ Gobernanza
            └─ Si elegible (méritos suficientes)
                    ├─ Propone iniciativa
                    └─ Vota en propuestas activas
```

---

## 9. MODELO DE DATOS PROPUESTO

### Capa Nostr (relays privados — fuente de verdad para identidad y gobernanza)

```
kind 31000  →  Propuestas ColombiaP2P
kind 31001  →  Votos
kind 31002  →  Merit awards
kind 31003  →  Contribuciones
kind 31004  →  Delegaciones de voto
kind 31005  →  Snapshots leaderboard
kind 31010  →  Resultados
kind 31011  →  Reportes de ejecución
```

**Cambios de constants en nostr-governance.js / nostr-merits.js:**
- Renombrar tags `lbw-` → `c2p-`
- Actualizar relay privado: `wss://relay.colombiap2p.com` (pendiente)
- Actualizar UMBRELLA community: `colombiap2p-community`

### Capa Supabase (gamificación, eventos, datos de app)

```sql
-- Usuarios (espejo de identidad Nostr)
users (
  id          uuid PRIMARY KEY,
  npub        text UNIQUE,     -- identidad Nostr
  username    text,
  display_name text,
  member_number int UNIQUE,    -- Individuo Soberano No.XXXX
  role        text,            -- member | moderator | admin | superadmin
  referral_code text UNIQUE,   -- para link /invite/CODE
  referred_by uuid → users,
  telegram_id bigint,          -- si vienen de Telegram
  is_active   boolean,
  created_at  timestamptz
)

-- XP (gamificación — separado de méritos)
xp_transactions (
  id          uuid PRIMARY KEY,
  user_id     uuid → users,
  amount      int,
  reason      text,            -- 'checkin' | 'mission' | 'streak_bonus' | 'referral' | 'badge'
  reference_id text,           -- ID del evento/misión/badge que generó el XP
  awarded_by  uuid → users,    -- null si es automático
  created_at  timestamptz
)

-- Niveles (derivados de XP)
-- Se computan on-demand: no necesitan tabla propia
-- Nivel 1: 0 XP | 2: 20 | 3: 50 | 4: 100 | 5: 200

-- Eventos presenciales
events (
  id          uuid PRIMARY KEY,
  number      int UNIQUE,      -- #01, #02, etc.
  name        text,
  description text,
  location    text,
  city        text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  xp_reward   int DEFAULT 10,
  stamp_id    uuid → stamps,   -- sello que otorga
  qr_secret   text,            -- HMAC secret para QR firmado
  qr_expires_at timestamptz,   -- TTL del QR
  is_active   boolean,
  created_at  timestamptz
)

-- Check-ins
event_checkins (
  id          uuid PRIMARY KEY,
  user_id     uuid → users,
  event_id    uuid → events,
  checked_in_at timestamptz,
  UNIQUE(user_id, event_id)    -- anti-doble-checkin
)

-- Sellos (coleccionables por evento/actividad)
stamps (
  id          uuid PRIMARY KEY,
  slug        text UNIQUE,     -- 'pola-bitcoiner-01'
  name        text,            -- 'Pola Bitcoiner #01'
  emoji       text,            -- '🟠'
  number      int,             -- número secuencial
  description text,
  event_id    uuid → events,   -- si está asociado a evento
  is_active   boolean,
  created_at  timestamptz
)

user_stamps (
  id          uuid PRIMARY KEY,
  user_id     uuid → users,
  stamp_id    uuid → stamps,
  awarded_at  timestamptz,
  event_id    uuid → events,   -- contexto del sello
  UNIQUE(user_id, stamp_id)
)

-- Badges (logros/habilidades)
badges (
  id          uuid PRIMARY KEY,
  slug        text UNIQUE,
  name        text,
  emoji       text,
  description text,
  category    text,            -- 'habilidad' | 'logro' | 'contribucion' | 'especial'
  conditions  jsonb,           -- reglas para obtenerlo (flexible)
  is_active   boolean,
  created_at  timestamptz
)

user_badges (
  id          uuid PRIMARY KEY,
  user_id     uuid → users,
  badge_id    uuid → badges,
  awarded_at  timestamptz,
  awarded_by  uuid → users,    -- admin que lo otorgó
  reason      text,
  UNIQUE(user_id, badge_id)
)

-- Misiones
missions (
  id          uuid PRIMARY KEY,
  title       text,
  description text,
  type        text,            -- 'educativa' | 'presencial' | 'tecnica' | 'comunitaria'
  category    text,            -- 'lightning' | 'nostr' | 'privacy' | 'bitcoin' | 'community'
  xp_reward   int,
  badge_slug  text → badges,
  target_count int,            -- pasos totales
  ends_at     timestamptz,
  is_active   boolean,
  created_at  timestamptz
)

mission_steps (
  id          uuid PRIMARY KEY,
  mission_id  uuid → missions,
  step_number int,
  description text,
  verification_type text       -- 'manual' | 'auto_nostr' | 'auto_checkin'
)

user_missions (
  id            uuid PRIMARY KEY,
  user_id       uuid → users,
  mission_id    uuid → missions,
  progress      int DEFAULT 0,
  completed_at  timestamptz,   -- null si incompleta
  UNIQUE(user_id, mission_id)
)

-- Rachas
streaks (
  user_id       uuid PRIMARY KEY → users,
  current_streak int DEFAULT 0,
  max_streak    int DEFAULT 0,
  last_checkin_at timestamptz
)

-- Referidos
-- La relación referido→referidor ya está en users.referred_by
-- El bono se activa en primer check-in del referido
referral_bonuses (
  id            uuid PRIMARY KEY,
  referrer_id   uuid → users,
  referred_id   uuid → users,
  activated_at  timestamptz,   -- cuando hizo primer check-in
  xp_awarded    int,
  UNIQUE(referred_id)
)

-- Méritos (log de trazabilidad — Nostr es fuente de verdad)
merit_transactions (
  id            uuid PRIMARY KEY,
  user_id       uuid → users,
  amount        int,
  category      text,          -- 'trabajo' | 'educacion' | 'infraestructura' | 'contribucion_economica' | 'responsabilidad'
  weight        decimal(3,1),  -- peso aplicado
  final_points  decimal(8,2),  -- amount × weight
  reason        text,
  nostr_event_id text,         -- referencia al evento Nostr
  awarded_by    uuid → users,
  created_at    timestamptz
)

-- Tesorería (preparación conceptual — no custodia BTC todavía)
treasury_records (
  id            uuid PRIMARY KEY,
  type          text,          -- 'ingreso' | 'egreso'
  amount_sats   bigint,
  concept       text,
  proposal_id   uuid,          -- referencia a propuesta Nostr (d-tag)
  lightning_tx  text,          -- payment hash si aplica
  responsible   uuid → users,
  evidence_url  text,
  status        text,          -- 'pendiente' | 'confirmado' | 'rechazado'
  created_at    timestamptz
)

-- Audit log (todas las acciones administrativas)
audit_log (
  id            uuid PRIMARY KEY,
  actor_id      uuid → users,
  action        text,          -- 'award_badge' | 'award_merit' | 'deactivate_user' | etc.
  target_id     uuid,          -- usuario o entidad afectada
  target_type   text,
  metadata      jsonb,
  created_at    timestamptz
)
```

### Supabase — tablas que ya existen en LiberBit

La tabla `missions` ya existe en Supabase (usada por `missions.js`). Se adaptará su schema.

---

## 10. ROADMAP — FASES DE IMPLEMENTACIÓN

### FASE 0 — Auditoría ✅ (este documento)
**Entregable:** `COLOMBIAP2P_ARCHITECTURE.md`
**Duración estimada:** 1 sesión

---

### FASE 1 — Identidad visual (sin tocar funcionalidad)
**Archivos principales:** `index.html`, `css/main.css`, `manifest.json`, `sw.js`

- [ ] Cambiar nombre: "LiberBit World" → "ColombiaP2P"
- [ ] Cambiar colores: paleta naranja Bitcoin (`#F7931A`) como acento principal
- [ ] Nuevo logo/favicon
- [ ] Actualizar metadata SEO + OG tags
- [ ] Actualizar PWA manifest
- [ ] Cambiar textos hero y secciones
- [ ] Actualizar links Telegram/X → ColombiaP2P
- [ ] Eliminar secciones: Justicia, SOS, Networking genérico, Mapa P2P
- [ ] Bump `CACHE_NAME` en `sw.js` para invalidar todo

**Riesgo:** bajo. Solo HTML/CSS/strings.

---

### FASE 2 — Pasaporte Bitcoiner
**Archivos:** `js/profile.js`, `index.html`, nuevo `js/passport.js`

- [ ] Rediseñar perfil → "Pasaporte Bitcoiner #XXXX"
- [ ] Mostrar: nivel, XP, méritos, sellos, badges, racha, eventos, referidos
- [ ] Gauge de ciudadanía adaptado (niveles ColombiaP2P)
- [ ] Separación visual clara XP vs Méritos
- [ ] Página pública `/u/CODIGO` (sin auth)
- [ ] Link de referido en pasaporte

---

### FASE 3 — Sellos
**Archivos:** nuevo `js/stamps.js`, `index.html`, tablas `stamps` + `user_stamps`

- [ ] Migrar schema Supabase: tabla `stamps` + `user_stamps`
- [ ] UI colección de sellos
- [ ] Admin: crear sellos
- [ ] Vincular sello a evento
- [ ] Mostrar sellos en pasaporte

---

### FASE 4 — Badges
**Archivos:** nuevo `js/badges.js`, tablas `badges` + `user_badges`

- [ ] Schema Supabase: `badges` + `user_badges`
- [ ] UI galería de badges
- [ ] Admin: crear badges + definir condiciones
- [ ] Otorgar manualmente desde admin
- [ ] Evaluación automática por condiciones
- [ ] Mostrar badges en pasaporte

---

### FASE 5 — Misiones
**Archivos:** `js/missions.js` (adaptar), `mission_steps`, `user_missions`

- [ ] Rediseñar concepto: de "bounty" → misión educativa con pasos
- [ ] Agregar tabla `mission_steps`
- [ ] Categorías: Lightning, Nostr, Privacidad, Bitcoin, Comunidad
- [ ] Recompensa: XP + badge
- [ ] Admin: crear/editar/activar/desactivar misiones
- [ ] Progreso visual en UI

---

### FASE 6 — Eventos + Check-in
**Archivos:** nuevo `js/events.js`, tablas `events` + `event_checkins`

- [ ] Schema Supabase: `events` + `event_checkins`
- [ ] UI próximos eventos
- [ ] Admin: crear evento, generar QR firmado (HMAC + TTL)
- [ ] Escáner QR: leer, validar firma, registrar check-in
- [ ] Anti-doble-checkin (UNIQUE constraint)
- [ ] Otorgar automáticamente: XP + sello + actualizar racha
- [ ] Evaluar badges + misiones tras check-in

---

### FASE 7 — Rachas + Referidos
**Archivos:** nuevo `js/streaks.js`, nuevo `js/referrals.js`

- [ ] Lógica de racha: ventana configurable entre eventos
- [ ] Milestones de racha: bonus XP en hitos
- [ ] Link de referido: `/invite/CODE` → registro vinculado
- [ ] Bono de referido: se activa en primer check-in del referido
- [ ] Historial de referidos en pasaporte

---

### FASE 8 — Gobernanza ColombiaP2P
**Archivos:** `js/nostr-governance.js`, `js/governance.js`, `js/nostr-bridge.js`

- [ ] Cambiar constants: `lbw-` → `c2p-`, relay propio
- [ ] Adaptar tipos de propuesta: Actividad, Presupuesto, Política, Emergencia
- [ ] Adaptar niveles de ciudadanía a méritos ColombiaP2P
- [ ] UI adaptada: lenguaje, colores, nombres de bloques
- [ ] **NO implementar todavía**: reglas rígidas `sats → méritos → votos`
- [ ] Relay privado ColombiaP2P (configurar)

---

### FASE 9 — Lightning
**Archivos:** `js/lightning.js`, `js/wallet.js`, `js/nwc.js`, `api/*`

- [ ] Cambiar LN Address → wallet ColombiaP2P
- [ ] Actualizar API proxy a cuenta ColombiaP2P
- [ ] Panel de transparencia: mostrar saldo + movimientos (cuando auth disponible)
- [ ] Vincular donaciones con registro en `treasury_records`
- [ ] Lightning Address en perfil: vincular con usuario

---

### FASE 10 — Nostr
**Archivos:** `js/nostr.js`, `js/nostr-bridge.js`, `js/auth.js`

- [ ] Configurar relay privado ColombiaP2P
- [ ] NIP-05 para miembros: `usuario@colombiap2p.com`
- [ ] Publicar logros/credenciales como eventos Nostr
- [ ] Feed de comunidad (posts de miembros verificados)
- [ ] Identidad Nostr vinculada al pasaporte

---

### FASE 11 — Tesorería
**Archivos:** nuevo `js/treasury.js`, tabla `treasury_records`

- [ ] Schema + UI de registros de tesorería
- [ ] Vincular movimientos a propuestas de gobernanza
- [ ] Vista pública de ingresos/egresos
- [ ] Integrar con panel Lightning cuando auth sea posible

---

### FASE 12 — Estadísticas y analítica
**Archivos:** nuevo `js/stats.js`

- [ ] Usuarios registrados, activos, nuevos
- [ ] Asistentes por evento
- [ ] **Métrica clave — Retención presencial**: % de asistentes del evento N que regresaron en N+1
- [ ] XP distribuido, méritos distribuidos
- [ ] Misiones completadas, referidos, participación en gobernanza
- [ ] Dashboard admin

---

## 11. RIESGOS

### Técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| `index.html` 3912 líneas dificulta mantenimiento | Alta | Medio | Modularizar secciones con templates JS |
| `auth.js` 109KB con base64 logo — carga lenta | Media | Bajo | Extraer imagen en Fase 1 |
| Nostr relay propio ColombiaP2P no existe aún | Alta | Alto | Usar relays públicos mientras se configura; o usar relay existente |
| `@noble/*` bug en Vercel lambda — sin balance Lightning | Alta | Medio | Documentar limitación; workaround: link a coinos.io |
| Service Worker cache stale después de cambios | Alta | Medio | Bump `CACHE_NAME` + `?v=` params obligatorio en cada deploy |
| nostr-tools CDN via `unpkg.com` — no está en allowlist CSP | Media | Alto | CSP actual es Report-Only; migrar a cdnjs o cdn.jsdelivr.net |

### Seguridad

| Riesgo | Descripción | Mitigación |
|--------|-------------|-----------|
| QR de check-in reutilizable | QR estático puede compartirse | HMAC firmado con TTL corto + código visual físico adicional |
| Doble check-in | Misma persona, múltiples intentos | UNIQUE constraint en BD + check previo antes de insertar |
| Sybil attack en gobernanza | Múltiples cuentas Nostr del mismo usuario | Méritos son difíciles de acumular; relay privado controla acceso |
| Compra masiva de méritos económicos | Alguien con mucho dinero compra influencia | **NO implementar conversión directa sats→méritos→votos**; méritos económicos con cap y peso reducido en votación |
| nsec expuesta | Bug en passlock o extensión comprometida | NIP-49 bien implementado en `lbw-passlock.js`; educar sobre NIP-07 |
| Admin de Supabase sin RLS | Datos de usuarios accesibles | Activar Row Level Security en Supabase; acceso solo vía proxy |

### Gobernanza

| Riesgo | Descripción | Mitigación |
|--------|-------------|-----------|
| Comunidad pequeña = pocos Génesis | Gate de admisión de propuestas depende de ≥2 Génesis | Threshold dinámico o admin-gate como bootstrap |
| Sin relay privado propio | Datos de gobernanza en relays públicos hasta tener relay | Temporal: usar relay de confianza; comunicar claramente |
| Participación baja en votaciones | Decisiones sin quórum | Quórum bajo inicial (5-10 votos); aumentar progresivamente |

### Privacidad

| Riesgo | Descripción | Mitigación |
|--------|-------------|-----------|
| Datos de check-in en Supabase centralizado | Historial de asistencia presencial | Minimizar datos; no almacenar ubicación; solo evento + timestamp |
| npub pública vinculada a identidad real | Correlación entre Nostr y persona física | Documentar opciones (sin foto, pseudónimo, npub dedicada) |

---

## 12. DECISIONES PENDIENTES

Estas decisiones deben tomarse **antes** de implementar las fases indicadas:

### Antes de Fase 2 — Pasaporte

- [ ] **Tabla de niveles XP**: ¿cuántos XP se necesitan por nivel? (propuesta: 0/20/50/100/200)
- [ ] **Nombres de niveles**: ¿mantener los del Pasaporte anterior o redefinir para ColombiaP2P?
- [ ] **Identidad primaria**: ¿Nostr + Supabase, o se puede entrar solo con Telegram (como antes)?

### Antes de Fase 3 — Sellos

- [ ] **¿Quién puede otorgar sellos?** ¿Solo admins, o también automáticamente via check-in?
- [ ] **¿Límite de sellos por evento?** ¿Uno por persona o varios?

### Antes de Fase 6 — Check-in

- [ ] **Mecanismo QR**: ¿QR dinámico (rota cada X minutos) o QR estático con código adicional físico (pin verbal)?
- [ ] **TTL del QR**: ¿cuánto tiempo es válido? (sugerencia: 4 horas)
- [ ] **¿Quién puede generar QR?** ¿Solo superadmin o también moderadores/organizadores de evento?

### Antes de Fase 8 — Gobernanza

- [ ] **¿Relay privado propio?** ColombiaP2P necesita `wss://relay.colombiap2p.com` o similar
- [ ] **Niveles de ciudadanía y méritos mínimos**: ¿adaptamos los de LiberBit o redefinimos para ColombiaP2P?
- [ ] **Bloque de votación mínimo**: ¿cuántos Ciudadanos Senior necesita la comunidad para activar gobernanza real?

### Antes de Fase 9 — Lightning

- [ ] **¿Qué wallet usa ColombiaP2P como tesorería?** ¿coinos.io, LNbits propio, otra?
- [ ] **Lightning Address ColombiaP2P**: definir dirección de donaciones
- [ ] **¿Los miembros pueden recibir recompensas en Lightning?** (ej. premios de propuestas aprobadas)

### Decisión estratégica: Méritos económicos

Esta es la decisión más importante de gobernanza:

> **¿Cómo se relacionan los aportes económicos en Lightning con los méritos de gobernanza?**

Las opciones discutidas:

| Opción | Pro | Contra |
|--------|-----|--------|
| A — Rendimientos decrecientes (cuadrático) | Nadie compra poder indefinidamente | Compleja de explicar |
| B — Separar financiamiento de poder | Limpio, anti-plutocrático | Puede desincentivar donaciones |
| C — Cap mensual por persona | Simple y justo | Límite arbitrario |
| D — Peso reducido (0.4x en gobernanza) | Simple, combina ambas cosas | Sigue siendo comprable |
| **Recomendado: B + D** | Donaciones van a tesorería; en gobernanza, méritos económicos pesan 0.4x vs 1.0x de trabajo | Requiere explicación clara |

**NO implementar conversión automática `sats → méritos → votos` hasta que ColombiaP2P defina la política exacta.**

---

## RESUMEN EJECUTIVO

| Aspecto | Estado actual | Para ColombiaP2P |
|---------|--------------|-----------------|
| Identidad | NIP-07/49/46 ✅ | Mantener + agregar Telegram |
| Gobernanza | Sólida, compleja ✅ | Adaptar constants y UI |
| Méritos | Nostr + Supabase ✅ | Adaptar categorías |
| Gamificación (XP) | No existe | Nuevo — Supabase |
| Sellos | No existe | Nuevo — Supabase |
| Badges | No existe | Nuevo — Supabase |
| Eventos/Check-in | No existe | Nuevo — Supabase |
| Rachas | No existe | Nuevo — Supabase |
| Referidos | No existe | Nuevo — Supabase |
| Misiones | ✅ (Supabase) | Adaptar concepto |
| Lightning | ✅ (coinos.io) | Cambiar cuenta |
| Tesorería | Básica (solo link) | Preparar + mejorar |
| UI/UX | LiberBit — saturada | Rediseño completo |
| PWA | ✅ | Actualizar |

**Código reutilizable estimado:** ~60-65% del total
**Código nuevo requerido:** ~35-40%
**Código eliminado:** ~30% (marketplace, mapa, SOS, Justicia, p2p-exchange)

El proyecto LiberBit es una base sólida. La arquitectura Nostr + Supabase + Vercel es exactamente
lo que ColombiaP2P necesita. El trabajo principal es: rediseño visual, eliminación de módulos
no relevantes, y construcción de la capa de gamificación (XP, sellos, badges, eventos, check-in)
que LiberBit no tiene.
