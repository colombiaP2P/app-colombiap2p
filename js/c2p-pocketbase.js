// ColombiaP2P — PocketBase client
// Cambia C2P_PB_URL cuando configures tu instancia PocketBase.
const C2P_PB_URL = 'https://api.colombiap2p.com';

const C2P_PB = (function () {
    let _pb = null;

    function _init() {
        if (_pb) return _pb;
        if (typeof PocketBase === 'undefined') {
            console.warn('[C2P] PocketBase SDK no cargado');
            return null;
        }
        _pb = new PocketBase(C2P_PB_URL);
        return _pb;
    }

    async function getStamps(nostrPubkey) {
        const pb = _init();
        if (!pb || !nostrPubkey) return [];
        try {
            const records = await pb.collection('user_stamps').getFullList({
                filter: `user_pubkey = "${nostrPubkey}"`,
                expand: 'stamp_id',
                sort: '-obtained_at',
            });
            return records
                .map(r => ({ id: r.id, stamp: r.expand?.stamp_id, obtained_at: r.obtained_at }))
                .filter(r => r.stamp);
        } catch (e) {
            console.warn('[C2P] Sellos no disponibles:', e.message);
            return [];
        }
    }

    async function getBadges(nostrPubkey) {
        const pb = _init();
        if (!pb || !nostrPubkey) return [];
        try {
            const records = await pb.collection('user_badges').getFullList({
                filter: `user_pubkey = "${nostrPubkey}"`,
                expand: 'badge_id',
                sort: '-obtained_at',
            });
            return records
                .map(r => ({ id: r.id, badge: r.expand?.badge_id, obtained_at: r.obtained_at }))
                .filter(r => r.badge);
        } catch (e) {
            console.warn('[C2P] Badges no disponibles:', e.message);
            return [];
        }
    }

    return { getStamps, getBadges, getClient: _init };
})();
