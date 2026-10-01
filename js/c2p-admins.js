// ColombiaP2P — lista ÚNICA de cuentas admin (pubkeys hex).
//
// La usan:
//   - la app (script clásico cargado al principio de index.html): missions,
//     transparency, nostr-merits, nostr-governance
//   - los endpoints api/merits/* (api/_lib/c2p-issuer.js la importa por efecto)
// Sin import/export a propósito, para que valga en ambos contextos.
//
// Para añadir o quitar un admin: editar SOLO este archivo, subir su ?v= en
// index.html y desplegar (los endpoints se actualizan en el mismo deploy).

(function (g) {
    const ADMINS = Object.freeze([
        '2479ef8e78d635cb40054f1e1a3895b13d67b36b2326b2a1d68df7b989b4cac0', // colbitcoin
        '51cfd8f59cd6c8e7699e5b8e3cfed94967c780939877f78e16da995107f432b9', // admin
    ]);
    g.C2P_ADMIN_PUBKEYS = ADMINS;
    g.isC2PAdmin = function (pubkey) {
        return !!pubkey && ADMINS.includes(pubkey);
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
