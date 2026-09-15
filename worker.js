// Cloudflare Worker — cross-device sync for the Europe trip app.
// Binding expected: TRIP_SYNC (KV namespace)
//
// GET  /state?key=<sha256 hex>      -> returns stored JSON state or 404
// POST /state  { key, checklist, daysDone, updatedAt }  -> stores state
//
// The "key" is a client-computed SHA-256 hash of the user's PIN (never the
// raw PIN), so the Worker never sees the PIN itself.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isValidKey(key) {
  return typeof key === "string" && /^[a-f0-9]{64}$/.test(key);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname !== "/state") {
      return json({ error: "not found" }, 404);
    }

    if (request.method === "GET") {
      const key = url.searchParams.get("key");
      if (!isValidKey(key)) return json({ error: "invalid key" }, 400);
      const stored = await env.TRIP_SYNC.get(key);
      if (!stored) return json({ error: "not found" }, 404);
      return json(JSON.parse(stored));
    }

    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: "invalid json" }, 400);
      }
      const { key, checklist, daysDone, updatedAt } = body || {};
      if (!isValidKey(key)) return json({ error: "invalid key" }, 400);
      const payload = JSON.stringify({
        checklist: checklist || {},
        daysDone: daysDone || {},
        updatedAt: updatedAt || Date.now(),
      });
      await env.TRIP_SYNC.put(key, payload);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  },
};
