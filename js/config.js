// ═══════════════════════════════════════════════════════════════
// [bug 17] Silenciador de console.log en producción
// ─────────────────────────────────────────────────────────────
// En producción los ~167 console.log de la app generan ruido y
// pueden filtrar info útil para un atacante (estructura interna,
// IDs de eventos, pubkeys parciales, errores de red...). Los
// silenciamos en prod, conservando warn/error/info para que los
// problemas reales sigan visibles.
//
// Reactivar logs en producción sin redesplegar:
//   localStorage.setItem('lbw_debug', '1'); location.reload();
// O bien añadir ?debug=1 a la URL.
// ═══════════════════════════════════════════════════════════════
(function _installLogSilencer() {
    try {
        const host = window.location.hostname;
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
        const debugParam = new URLSearchParams(window.location.search).get('debug') === '1';
        let debugLS = false;
        try { debugLS = localStorage.getItem('lbw_debug') === '1'; } catch (e) {}
        const verbose = isLocal || debugParam || debugLS;
        if (!verbose) {
            const noop = function () {};
            // Silenciar solo log/debug. Preservar warn/error/info/trace.
            console.log = noop;
            console.debug = noop;
        }
    } catch (e) {
        // Si algo falla, dejamos console intacto.
    }
})();

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : 'https://colombiap2p.com/api';

// Function to display active nodes — valor fijo: 3 nodos conocidos
function updateActiveNodesCounter() {
    const ACTIVE_NODES = 1;
    const counter = document.getElementById('activeNodesCount');
    if (counter) {
        const currentValue = parseInt(counter.textContent) || 0;
        animateCounter(counter, currentValue, ACTIVE_NODES, 1500);
    }
}

// Function to animate counter
function animateCounter(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = Math.round(current);
    }, 16);
}

const IDENTITIES_BASE_OFFSET = 10;

async function updateIdentitiesCounter() {
    const counter = document.getElementById('identitiesCount');
    if (!counter) return;

    try {
        const pb = (typeof C2P_PB !== 'undefined') ? C2P_PB.getClient() : null;
        if (!pb) throw new Error('PocketBase no disponible');

        // user_streaks tiene un registro por usuario activo
        const result = await pb.collection('user_streaks').getList(1, 1);
        const realCount = result.totalItems;
        const displayCount = realCount + IDENTITIES_BASE_OFFSET;
        const currentValue = parseInt(counter.textContent) || 0;
        animateCounter(counter, currentValue, displayCount, 1500);
    } catch (err) {
        if (counter.textContent === '0') {
            counter.textContent = IDENTITIES_BASE_OFFSET;
        }
    }
}

// Load hero background
window.addEventListener('DOMContentLoaded', () => {
    const heroBackground = document.getElementById('heroBackground');
    if (heroBackground) {
        heroBackground.style.background = `
            linear-gradient(135deg, rgba(44, 95, 111, 0.8) 0%, rgba(13, 23, 30, 0.9) 100%),
            url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"%3E%3Crect fill="%232C5F6F" width="1200" height="800"/%3E%3C/svg%3E')
        `;
        heroBackground.style.backgroundSize = 'cover';
        heroBackground.style.backgroundPosition = 'center';
    }
});

let currentUser = null;
let allPosts = [];
let currentFilter = 'todos';
let allDirectMessages = [];
let currentChatWith = null;
let allProposals = [];
let allVotes = [];
let currentProposalFilter = 'all';
let activeNodesInterval = null;
let userProfile = null;
