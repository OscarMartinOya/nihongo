/* Service worker: la app funciona sin conexión. Sube VERSION al publicar cambios.
   Los audios van en su propia caché (AUDIO_CACHE): su nombre de archivo depende del texto, así que
   no hace falta volver a descargarlos en cada versión. Súbela solo si se regeneran con otra voz. */
const VERSION = 'nihongo-v5';
const AUDIO_CACHE = 'nihongo-audio-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'data.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/barlow-sc-500.woff2', 'fonts/barlow-sc-700.woff2', 'audio/manifest.json'];

async function cacheAudio() {
  try {
    const m = await (await fetch('audio/manifest.json', { cache: 'no-cache' })).json();
    const c = await caches.open(AUDIO_CACHE);
    const have = new Set((await c.keys()).map((r) => new URL(r.url).pathname.split('/').pop()));
    const missing = Object.keys(m).map((k) => k + '.mp3').filter((f) => !have.has(f));
    for (let i = 0; i < missing.length; i += 20) await c.addAll(missing.slice(i, i + 20).map((f) => 'audio/' + f));
  } catch (e) { /* se completará al usar la app con conexión */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(cacheAudio).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== AUDIO_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  /* Audios: primero la caché; si no está, se descarga y se guarda. */
  if (url.pathname.includes('/audio/') && url.pathname.endsWith('.mp3')) {
    e.respondWith(caches.open(AUDIO_CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  /* Resto: primero la caché (rápido y sin conexión); de fondo se actualiza desde la red. */
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});
