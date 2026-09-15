// [C2P FASE 9] Proxy LNURLP — tesorería ColombiaP2P → colsats.com
// Sirve el well-known LNURLP de colombiap2p@colsats.com.
// El callback se sobreescribe para pasar por /api/lnurlp/callback
// y evitar problemas de CORS en el navegador.

const C2P_LN_UPSTREAM = 'https://colsats.com/.well-known/lnurlp/colombiap2p';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const response = await fetch(C2P_LN_UPSTREAM, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'upstream error ' + response.status });
    }

    const data = await response.json();

    // Guardar el callback original y redirigirlo por nuestro proxy CORS
    if (data.callback) {
      data._upstream_callback = data.callback;
      data.callback = 'https://colombiap2p.com/api/lnurlp/callback';
    }

    if (!data.maxSendable || data.maxSendable === 0) {
      data.maxSendable = 100000000000; // 100,000 sats máx por defecto
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[C2P LNURLP] Error:', error.message);
    return res.status(500).json({ error: 'No se pudo conectar con el proveedor Lightning' });
  }
}
