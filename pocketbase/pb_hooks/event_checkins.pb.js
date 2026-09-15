// PocketBase hook — verifica el token de check-in antes de crear el registro
// Archivo: pocketbase/pb_hooks/event_checkins.pb.js
// Coloca este archivo en <pocketbase_dir>/pb_hooks/ para activar la validación

onRecordBeforeCreateRequest((e) => {
    const provided = e.record.get('checkin_token');
    if (!provided) {
        throw new BadRequestError('Token de check-in requerido.');
    }

    let event;
    try {
        event = $app.dao().findRecordById('events', e.record.get('event_id'));
    } catch (_) {
        throw new BadRequestError('Evento no encontrado.');
    }

    if (event.get('status') !== 'open') {
        throw new BadRequestError('El check-in de este evento no está abierto.');
    }

    // Ventana de check-in
    const now = new Date();
    const from  = event.get('checkin_open_from');
    const until = event.get('checkin_open_until');
    if (from  && now < new Date(from))  throw new BadRequestError('El check-in aún no ha comenzado.');
    if (until && now > new Date(until)) throw new BadRequestError('El check-in ya cerró.');

    // Verificar token
    if (event.get('checkin_token') !== provided) {
        throw new BadRequestError('Token de check-in inválido.');
    }

    // Evitar check-in duplicado
    const existing = $app.dao().findFirstRecordByFilter(
        'event_checkins',
        `event_id = '${e.record.get("event_id")}' && user_pubkey = '${e.record.get("user_pubkey")}'`
    );
    if (existing) {
        throw new BadRequestError('Ya registraste check-in en este evento.');
    }

    // Limpiar el token del registro (no se almacena)
    e.record.set('checkin_token', '');
    e.next();
}, 'event_checkins');
