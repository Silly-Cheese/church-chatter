const CACHE = "church-chatter-shell-v13";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./community.css",
  "./phase3.css",
  "./danger.css",
  "./mobile-nav.css",
  "./mobile-polish.css",
  "./connect.css",
  "./connect-enhancements.css",
  "./governance.css",
  "./auth-action.html",
  "./auth-action.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./src/firebase.js",
  "./src/services.js",
  "./src/app.js",
  "./src/mail-service.js",
  "./src/mail-bridge.js",
  "./src/community-data.js",
  "./src/community.js",
  "./src/phase2-bridge.js",
  "./src/phase3-data.js",
  "./src/phase3.js",
  "./src/phase3-bridge.js",
  "./src/congregation-delete.js",
  "./src/congregation-danger.js",
  "./src/mobile-navigation.js",
  "./src/connect-data.js",
  "./src/connect.js",
  "./src/connect-sync.js",
  "./src/connect-bridge.js",
  "./src/connect-mobile.js",
  "./src/connect-enhancements.js",
  "./src/governance-data.js",
  "./src/membership-governance.js",
  "./src/auth-action.js",
  "./src/pwa.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Firebase SDKs, authentication traffic, Firestore APIs, Apps Script, and QR library stay network-managed.
  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseapp.com") ||
    url.hostname.includes("gstatic.com") ||
    url.hostname.includes("script.google.com") ||
    url.hostname.includes("script.googleusercontent.com") ||
    url.hostname.includes("cdn.jsdelivr.net")
  ) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
