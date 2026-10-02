// [C2P] Rachas diarias — calculadas en el servidor + méritos del Emisor
//
// POST /api/merits/streak
// Header: Authorization: Nostr <NIP-98 del usuario> con tag ['action', 'streak']
//
// Antes la app calculaba la racha con su propia fecha y escribía el XP en
// PocketBase. Ahora el servidor, con la fecha de Bogotá:
//   - registra la actividad del día en user_streaks (una vez por día)
//   - racha +1 si la última actividad fue ayer; si no, vuelve a 1
//   - mérito: 1 por día, 5 en cada múltiplo de 7 (mismas reglas de antes)
//   - TOPE de por vida: 21 méritos por rachas por persona, contando los
//     migrados de PocketBase (merit:racha:historico). La racha la idea es que
//     dé los primeros méritos sin esfuerzo; para avanzar en ciudadanía hay que
//     aportar (asistencia, trabajo, económico). Superado el tope, el contador
//     de días sigue pero ya no se emiten méritos.
//
// Para no crear un evento Nostr por usuario y día, el Emisor mantiene UN
// mérito acumulado por usuario (d merit:racha:total:<pk16>) y lo reemplaza
// con el nuevo total cada día.
//
// Env: C2P_ISSUER_NSEC, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD.

import { withRelay, verifyNip98, pbFetch, getIssuerMerit, publishMerit, meritDTag } from '../_lib/c2p-issuer.js';

const ENDPOINT_PATH = '/api/merits/streak';
const PER_DAY = 1;        // XP_PER_STREAK_DAY de js/c2p-rachas.js
const WEEKLY_BONUS = 5;   // cada 7 días de racha
export const STREAK_MERIT_CAP = 21;   // tope de por vida (debe coincidir con ORIGIN_CAPS.racha)
const TZ = 'America/Bogota';

const q = s => encodeURIComponent(s);
const dayInTz = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    let pubkey;
    try {
        pubkey = verifyNip98(req, { path: ENDPOINT_PATH, bind: { action: 'streak' } });
    } catch (e) {
        return res.status(401).json({ error: e.message });
    }

    try {
        const today = dayInTz();
        const list = await pbFetch(`/api/collections/user_streaks/records?perPage=1&filter=${q(`user_pubkey = "${pubkey}"`)}`);
        const rec = (list.items || [])[0] || null;
        const last = rec?.last_activity_date ? rec.last_activity_date.slice(0, 10) : '';

        const state = r => ({
            current: r?.current_streak || 0,
            max: r?.max_streak || 0,
            last: r?.last_activity_date ? r.last_activity_date.slice(0, 10) : '',
            firstDate: r?.first_activity_date ? r.first_activity_date.slice(0, 10) : ''
        });

        // Ya registrado hoy
        if (last === today) return res.status(200).json({ ...state(rec), today, earned: 0 });

        const current = (last && dayDiff(last, today) === 1) ? (rec.current_streak || 0) + 1 : 1;
        const max = Math.max(current, rec?.max_streak || 0);
        const payload = { user_pubkey: pubkey, current_streak: current, max_streak: max, last_activity_date: today };
        if (!rec?.first_activity_date) payload.first_activity_date = today;

        const saved = rec
            ? await pbFetch(`/api/collections/user_streaks/records/${rec.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
            : await pbFetch('/api/collections/user_streaks/records', { method: 'POST', body: JSON.stringify(payload) });

        // Mérito del día (con tope), salvo que la app antigua ya escribiera el XP de hoy
        const dayReward = current % 7 === 0 ? WEEKLY_BONUS : PER_DAY;
        const legacyToday = await pbFetch(`/api/collections/xp_transactions/records?perPage=1&filter=${q(`user_pubkey = "${pubkey}" && source = "racha" && ref_id = "${today}"`)}`);
        let earned = 0, streakMerits = null, capReached = false;
        if ((legacyToday.totalItems || 0) === 0) {
            ({ earned, streakMerits, capReached } = await withRelay(async relay => {
                const amountOf = ev => ev ? (parseFloat((ev.tags.find(t => t[0] === 'amount') || [])[1]) || 0) : 0;
                const prevTotal = amountOf(await getIssuerMerit(relay, meritDTag(pubkey, 'racha:total')));
                const historic = amountOf(await getIssuerMerit(relay, meritDTag(pubkey, 'racha:historico')));
                const room = Math.max(0, STREAK_MERIT_CAP - historic - prevTotal);
                const add = Math.min(dayReward, room);
                if (add <= 0) return { earned: 0, streakMerits: historic + prevTotal, capReached: true };
                await publishMerit(relay, {
                    recipient: pubkey, amount: prevTotal + add, category: 'productiva', ref: 'racha:total',
                    reason: `🔥 Rachas diarias (acumulado, última: día ${current})`
                });
                const now = historic + prevTotal + add;
                return { earned: add, streakMerits: now, capReached: now >= STREAK_MERIT_CAP };
            }));
        }

        return res.status(200).json({
            ...state(saved), today, earned, streakMerits, capReached, streakMeritCap: STREAK_MERIT_CAP
        });
    } catch (err) {
        console.error('[merits/streak]', err);
        return res.status(500).json({ error: 'Error registrando la racha: ' + err.message });
    }
}
