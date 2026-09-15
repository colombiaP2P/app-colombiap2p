# ColombiaP2P

**La plataforma digital de la comunidad Bitcoin colombiana.**

ColombiaP2P es una comunidad abierta de bitcoiners colombianos que promueve la educación, adopción y uso de Bitcoin y sus tecnologías asociadas — Lightning Network, Nostr y P2P — sin intermediarios, sin custodios, sin permisos.

> *"No tus llaves, no tus bitcoins."*

---

## ¿Qué es esta plataforma?

Una SPA (Single-Page Application) construida sobre Nostr + Bitcoin Lightning que sirve como punto de encuentro digital de los miembros de ColombiaP2P. Combina identidad soberana (Nostr), economía libre (Lightning), gobernanza comunitaria (méritos C2PM) y participación presencial (eventos + check-in QR).

### Funcionalidades principales

| Módulo | Descripción |
|--------|-------------|
| 🪪 **Pasaporte** | Identidad Nostr — sin usuario/contraseña, clave privada cifrada localmente |
| 📅 **Eventos** | Calendario de meetups con check-in QR presencial |
| 🎯 **Misiones** | Tareas educativas para ganar XP |
| ⭐ **Méritos C2PM** | Sistema de reputación en 4 categorías + ciudadanía en 6 niveles |
| 💬 **Comunidad** | Chat descentralizado vía Nostr (NIP-01/04/44) |
| ⚡ **Lightning** | Donaciones y aportaciones económicas vía LNURL (`colombiap2p@colsats.com`) |
| 🔍 **Tesorería** | Transparencia de fondos comunitarios (colsats.com / LNbits) |
| 🏛️ **Gobernanza** | Propuestas y votaciones con peso por méritos |
| 🗺️ **Mapa** | Red de nodos físicos y miembros |
| 📊 **Estadísticas** | Métricas comunitarias en tiempo real (PocketBase) |
| 🆔 **NIP-05** | Identidad verificable `usuario@colombiap2p.com` para miembros |
| 🔥 **Rachas** | Actividad diaria consecutiva con XP acumulado |
| 👥 **Referidos** | Links de invitación con recompensa en XP |

---

## Sistema de XP

| Nivel | XP requerido |
|-------|-------------|
| 🥉 Fiatelo | 0 |
| 🪙 Plebeyo | 20 |
| 💎 Hodler | 50 |
| ⚡ Noder | 100 |
| 🟠 Bitcoiner | 200 |
| 🔥 Maximalist | 500 |
| 👑 Satoshi | 1.000+ |

El XP se obtiene participando en eventos (+puntos por check-in), completando misiones, manteniendo rachas diarias (+5/día, +35 cada 7 consecutivos) y refiriendo nuevos miembros.

---

## Sistema de ciudadanía (Méritos C2PM)

| Nivel | Méritos C2PM |
|-------|-------------|
| 👋 Amigo | 0 |
| 🪪 E-Residency | 100+ |
| 🤝 Colaborador | 500+ |
| 🛂 Ciudadano Senior | 1.000+ |
| 🌍 Custodio | 2.000+ |
| 👑 Génesis | 3.000+ |

Los méritos se acumulan en 4 categorías:

- **Económica** (peso 1.0) — aportaciones económicas al ecosistema
- **Productiva** (peso 1.0) — contribuciones de trabajo y producción
- **Responsabilidad** (peso 1.2) — requiere 1.000+ méritos en otras categorías
- **Financiada** (peso 0.6) — actividad financiada por la comunidad

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | Vanilla JavaScript SPA (sin build, sin bundler) |
| Identidad | Nostr — NIP-01, NIP-07, NIP-19, NIP-49, NIP-65 |
| Mensajería | NIP-44 (XChaCha20-Poly1305) + NIP-04 (fallback) |
| Wallet | Lightning Address + WebLN + NIP-47 (Nostr Wallet Connect) |
| Lightning | `colombiap2p@colsats.com` — LNURL-pay proxiado en Vercel |
| NIP-05 | `usuario@colombiap2p.com` — resolución dinámica vía PocketBase |
| Backend | PocketBase (`api.colombiap2p.com`) — 12 colecciones |
| Relays | Privado: `relay.colombiap2p.com` (pendiente); públicos: `relay.damus.io`, `nos.lol` |
| Despliegue | Vercel (`colombiap2p.com`) — auto-deploy en push a `main` |

---

## Colecciones PocketBase

| Colección | Propósito |
|-----------|-----------|
| `stamps` | Definición de sellos (NFT simbólicos de eventos) |
| `user_stamps` | Sellos obtenidos por usuario |
| `badges` | Definición de badges/logros |
| `user_badges` | Badges otorgados |
| `missions` | Misiones educativas |
| `merit_contributions` | Contribuciones de méritos C2PM |
| `events` | Eventos de la comunidad |
| `event_checkins` | Check-ins presenciales con token QR |
| `xp_transactions` | Historial de XP (fuente, razón, cantidad) |
| `nip05_identities` | Identidades `usuario@colombiap2p.com` activas |
| `user_streaks` | Rachas diarias de actividad |
| `referrals` | Registro de referidos y recompensas |

---

## Arquitectura

```
┌──────────────────────────────────────────────────────┐
│          Cliente (Vanilla JS SPA — Vercel)           │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  UI      │  │  LBW_*   │  │  C2P_* modules     │  │
│  │  scripts │  │  modules │  │  (Eventos, Rachas,  │  │
│  │          │  │          │  │   Treasury, Stats)  │  │
│  └────┬─────┘  └─────┬────┘  └────────────────────┘  │
└───────┼──────────────┼────────────────────────────────┘
        │              │
        │              ├──► Relays Nostr (privado + públicos según kind)
        │              │         ↑ identidad, gobernanza, méritos, DMs
        │              │
        │              └──► Vercel /api/* (serverless)
        │                        ├─► PocketBase (api.colombiap2p.com)
        │                        ├─► LNURL proxy → colsats.com
        │                        └─► NIP-05 → PocketBase query
        │
        └─────────────────► Wallets Lightning (WebLN, NWC, LNURL)
```

- **Nostr** es la fuente de verdad para identidad, mensajes cifrados, gobernanza y méritos.
- **PocketBase** almacena eventos, check-ins, XP, rachas, referidos y NIP-05.
- **Las claves privadas** (nsec, NWC) viven cifradas con contraseña (NIP-49) en `localStorage` o en extensión NIP-07 — nunca en texto plano.

---

## Cache busting (Service Worker)

El SW usa cache-first para JS. **Cada cambio en un archivo `.js` debe subir su parámetro `?v=` en `index.html`** para que el SW descargue la versión nueva. Al hacer refactorizaciones grandes, subir también `CACHE_NAME` en `sw.js`.

---

## Variables de entorno (Vercel)

| Variable | Uso |
|----------|-----|
| `LNBITS_URL` | URL de la instancia LNbits (ej. `https://colsats.com`) |
| `LNBITS_READ_KEY` | Invoice/read key para consultar balance y pagos |
| `LNBITS_WALLET_ID` | (Opcional) Wallet ID para filtrar pagos |

---

## Entorno local

```bash
git clone https://github.com/colombiap2p/colombiap2p-app.git
cd colombiap2p-app
npx serve .
```

Requiere navegador moderno con extensión Nostr (ej. [Alby](https://getalby.com), [nos2x](https://github.com/fiatjaf/nos2x)) para el flujo NIP-07.

Las serverless functions (`/api/*`) solo funcionan en Vercel. Localmente las llamadas LNURL devolverán 404 — esperable.

---

## Cómo contribuir

1. Fork del repositorio
2. Rama: `git checkout -b feat/mi-mejora`
3. Commit: `git commit -m "feat: descripción"`
4. Pull Request describiendo qué hace y por qué

Convenciones de commit: [Conventional Commits](https://www.conventionalcommits.org/).

---

## Contacto y comunidad

- Web: [colombiap2p.com](https://www.colombiap2p.com)
- Lightning: `colombiap2p@colsats.com`
- Nostr NIP-05: `_@colombiap2p.com`
- Relay: `wss://relay.colombiap2p.com`

---

## Licencia

MIT — consulta el archivo [LICENSE](./LICENSE) para más detalles.
