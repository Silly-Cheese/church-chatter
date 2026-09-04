// Church Chatter — Church Discovery & Network finishing pass
// Adds QR download/print support and clearer privacy guidance without changing the core Connect data model.

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeFilename(value = "church-chatter") {
  return String(value || "church-chatter")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "church-chatter";
}

function toast(title, message = "") {
  const root = document.querySelector("#toast-root");
  if (!root) return;
  const node = document.createElement("div");
  node.className = "toast success";
  const strong = document.createElement("strong");
  strong.textContent = title;
  node.appendChild(strong);
  if (message) {
    const span = document.createElement("span");
    span.textContent = message;
    node.appendChild(span);
  }
  root.appendChild(node);
  window.setTimeout(() => node.remove(), 4300);
}

function currentChurchName() {
  return document.querySelector(".church-switcher strong, .topbar-church strong, .church-name")?.textContent?.trim()
    || "Church Chatter congregation";
}

function enhanceQrResult(result) {
  if (!result || result.dataset.qrEnhanced === "true") return;
  const image = result.querySelector(".connect-qr-image");
  const linkInput = result.querySelector("[data-qr-link]");
  if (!image || !linkInput) return;

  result.dataset.qrEnhanced = "true";
  const actions = document.createElement("div");
  actions.className = "connect-qr-actions";
  actions.innerHTML = `
    <button class="btn btn-primary" type="button" data-download-qr>Download QR</button>
    <button class="btn btn-secondary" type="button" data-print-qr>Print sign</button>
    <p class="meta connect-qr-note">This QR is an invitation link. It works even when Church Discovery is turned off, and it can be revoked from Invitations.</p>
  `;
  result.appendChild(actions);

  actions.querySelector("[data-download-qr]")?.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = image.src;
    a.download = `${safeFilename(currentChurchName())}-church-chatter-join-qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("QR downloaded", "You can place it on a bulletin, welcome desk, slide, or printed sign.");
  });

  actions.querySelector("[data-print-qr]")?.addEventListener("click", () => {
    const church = currentChurchName();
    const win = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(church)} Church Chatter QR</title><style>
      body{font-family:Arial,sans-serif;margin:0;background:#f7f8f5;color:#10201c;display:grid;place-items:center;min-height:100vh}
      .sheet{width:min(620px,88vw);background:white;border:1px solid #dfe7e3;border-radius:28px;padding:46px;text-align:center;box-shadow:0 18px 60px rgba(16,32,28,.10)}
      .eyebrow{font-size:12px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#b87a42}.brand{font-size:20px;font-weight:800;color:#16352f;margin-bottom:32px}
      h1{font-family:Georgia,serif;font-size:42px;line-height:1.08;margin:0 0 14px}p{font-size:18px;line-height:1.55;color:#65736e;margin:0 auto 28px;max-width:480px}
      img{width:330px;height:330px;image-rendering:pixelated}.url{font-size:12px;word-break:break-all;color:#6f7d78;margin-top:20px}
      @media print{body{background:white}.sheet{box-shadow:none;border:0;width:100%;padding:20px}}
    </style></head><body><main class="sheet"><div class="brand">Church Chatter</div><div class="eyebrow">Join our congregation</div><h1>${esc(church)}</h1><p>Scan this code to open Church Chatter and join our congregation.</p><img src="${image.src}" alt="Church Chatter join QR"><div class="url">${esc(linkInput.value)}</div></main><script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>`);
    win.document.close();
  });
}

function enhanceSettings() {
  const discoveryPanel = document.querySelector("#discovery-enabled")?.closest(".connect-panel");
  if (discoveryPanel && !discoveryPanel.querySelector("[data-discovery-privacy-note]")) {
    const note = document.createElement("div");
    note.dataset.discoveryPrivacyNote = "true";
    note.className = "connect-privacy-note";
    note.innerHTML = `<strong>Privacy by default</strong><p>Discovery is completely optional. When disabled, this congregation is not shown in member church search. Invitation codes and QR codes can still be used privately.</p>`;
    discoveryPanel.appendChild(note);
  }

  const networkPanel = document.querySelector("#network-enabled")?.closest(".connect-panel");
  if (networkPanel && !networkPanel.querySelector("[data-network-privacy-note]")) {
    const note = document.createElement("div");
    note.dataset.networkPrivacyNote = "true";
    note.className = "connect-privacy-note";
    note.innerHTML = `<strong>Separate from member discovery</strong><p>Church Network only exposes the congregation's public profile to authorized leaders of participating churches. Internal posts, prayers, members, groups, and resources stay private.</p>`;
    networkPanel.appendChild(note);
  }
}

function sync() {
  document.querySelectorAll(".connect-qr-result").forEach(enhanceQrResult);
  enhanceSettings();
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    sync();
  });
}

new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
window.addEventListener("hashchange", schedule);
schedule();
