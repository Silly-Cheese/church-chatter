import { db } from "./firebase.js";
import { createInvite, joinChurch, PERMISSIONS, setActiveChurch } from "./services.js";
import {
  getChurchConnections,
  getChurchNetworkMessages,
  getDiscoverySettings,
  getOwnJoinRequest,
  getPendingJoinRequests,
  joinDiscoveredChurch,
  removeChurchConnection,
  requestChurchConnection,
  requestChurchJoin,
  respondToChurchConnection,
  reviewJoinRequest,
  saveDiscoverySettings,
  saveNetworkSettings,
  searchChurchDirectory,
  searchChurchNetwork,
  sendChurchNetworkMessage
} from "./connect-data.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const CONNECT_ROUTES = new Set(["discover", "network"]);

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function locationText(church) {
  return [church?.city, church?.region].filter(Boolean).join(", ") || "Location not listed";
}

function canNetwork(options) {
  return options.hasPermission(PERMISSIONS.MANAGE_CHURCH)
    || options.hasPermission(PERMISSIONS.COMMUNICATE_CHURCH_NETWORK);
}

function canReviewJoins(options) {
  return options.hasPermission(PERMISSIONS.MANAGE_CHURCH)
    || options.hasPermission(PERMISSIONS.MANAGE_MEMBERS);
}

function buttonLabelForJoinMode(church) {
  return church.joinMode === "open" ? "Join congregation" : "Request to join";
}

function directoryCard(church, options, compact = false) {
  const joined = options.state?.memberships?.some((item) => item.churchId === church.churchId);
  return `
    <article class="connect-church-card ${compact ? "compact" : ""}" data-directory-church="${esc(church.churchId)}">
      <div class="connect-church-mark">${esc((church.name || "C").trim().slice(0, 1).toUpperCase())}</div>
      <div class="connect-church-copy">
        <div class="connect-church-topline">
          <div>
            <h3>${esc(church.name || "Congregation")}</h3>
            <p>${esc(locationText(church))}${church.tradition ? ` · ${esc(church.tradition)}` : ""}</p>
          </div>
          <span class="connect-join-badge">${church.joinMode === "open" ? "Open join" : "Approval required"}</span>
        </div>
        ${church.description ? `<p class="connect-description">${esc(church.description)}</p>` : ""}
        <div class="connect-card-actions">
          ${church.website ? `<a class="btn btn-secondary" href="${esc(church.website)}" target="_blank" rel="noopener noreferrer">Website</a>` : ""}
          ${joined
            ? `<button class="btn btn-soft" type="button" data-switch-church="${esc(church.churchId)}">Already joined · Switch</button>`
            : `<button class="btn btn-primary" type="button" data-directory-join="${esc(church.churchId)}" data-join-mode="${esc(church.joinMode || "request")}">${buttonLabelForJoinMode(church)}</button>`}
        </div>
      </div>
    </article>`;
}

function networkDirectoryCard(church, options) {
  const self = church.churchId === options.state.activeChurchId;
  return `
    <article class="connect-church-card compact">
      <div class="connect-church-mark">${esc((church.name || "C").trim().slice(0, 1).toUpperCase())}</div>
      <div class="connect-church-copy">
        <h3>${esc(church.name || "Congregation")}</h3>
        <p>${esc(locationText(church))}${church.tradition ? ` · ${esc(church.tradition)}` : ""}</p>
        <div class="connect-card-actions">
          ${self ? `<span class="connect-self-badge">Your congregation</span>` : `<button class="btn btn-primary" type="button" data-network-connect="${esc(church.churchId)}">Connect congregations</button>`}
        </div>
      </div>
    </article>`;
}

function emptyState(title, copy) {
  return `<div class="connect-empty"><div class="connect-empty-icon">⌁</div><strong>${esc(title)}</strong><p>${esc(copy)}</p></div>`;
}

export function isConnectRoute(route) {
  return CONNECT_ROUTES.has(route);
}

export function connectRouteShell(route) {
  if (route === "discover") {
    return `
      <section class="connect-page" data-connect-route="discover">
        <div class="connect-hero">
          <div><span class="eyebrow">Church discovery</span><h1>Find your church.</h1><p>Search congregations that have chosen to be discoverable on Church Chatter. Private churches never appear here.</p></div>
          <div class="connect-hero-mark">⌕</div>
        </div>
        <div class="connect-search-card">
          <label for="church-discovery-search">Church name, city, region, or tradition</label>
          <div class="connect-search-row"><input class="input" id="church-discovery-search" placeholder="Try First Baptist, Tulsa, Methodist…" maxlength="80" /><button class="btn btn-primary" id="church-discovery-submit">Search</button></div>
          <p class="meta">Search only includes congregations that explicitly enabled Church Discovery.</p>
        </div>
        <div id="church-discovery-results" class="connect-results"></div>
      </section>`;
  }

  return `
    <section class="connect-page" data-connect-route="network">
      <div class="connect-hero network-hero">
        <div><span class="eyebrow">Church network</span><h1>Congregations can talk, too.</h1><p>Connect your congregation with other churches for coordination, encouragement, ministry partnerships, and shared community work.</p></div>
        <div class="connect-hero-mark">↔</div>
      </div>
      <div id="church-network-root"></div>
    </section>`;
}

async function renderDiscovery(options, root = document.querySelector("#church-discovery-results"), initialTerm = "") {
  if (!root) return;
  root.innerHTML = `<div class="connect-loading">Searching Church Chatter…</div>`;
  try {
    const results = await searchChurchDirectory(initialTerm);
    root.innerHTML = results.length
      ? results.map((church) => directoryCard(church, options)).join("")
      : emptyState("No discoverable congregations found", initialTerm ? "Try a shorter church name, city, or region." : "Congregations only appear here when their leadership enables discovery.");
    bindDirectoryActions(root, options);
  } catch (error) {
    root.innerHTML = emptyState("Could not search right now", error?.message || "Try again in a moment.");
  }
}

function bindDirectoryActions(root, options) {
  root.querySelectorAll("[data-switch-church]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await setActiveChurch(options.state.user.uid, button.dataset.switchChurch);
      window.location.hash = "#/home";
      window.location.reload();
    } catch (error) { options.toast("Could not switch churches", error?.message || "Try again.", "error"); }
  }));

  root.querySelectorAll("[data-directory-join]").forEach((button) => button.addEventListener("click", async () => {
    const churchId = button.dataset.directoryJoin;
    const mode = button.dataset.joinMode;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = mode === "open" ? "Joining…" : "Checking…";
    try {
      if (mode === "open") {
        await joinDiscoveredChurch(churchId, options.state.user);
        options.toast("Welcome to your church", "The congregation has been added to your Church Chatter account.", "success");
        window.location.hash = "#/home";
        window.location.reload();
        return;
      }

      const existing = await getOwnJoinRequest(churchId, options.state.user.uid);
      if (existing?.status === "approved") {
        button.textContent = "Completing join…";
        await joinDiscoveredChurch(churchId, options.state.user);
        options.toast("You're in", "Your approved congregation has been added to your account.", "success");
        window.location.hash = "#/home";
        window.location.reload();
        return;
      }
      if (existing?.status === "pending") {
        options.toast("Request still pending", "Your congregation's leadership has not reviewed it yet.");
        return;
      }
      await requestChurchJoin(churchId, options.state.user);
      options.toast("Join request sent", "Leadership can now approve your request in Church Network.", "success");
      button.textContent = "Request pending";
    } catch (error) {
      options.toast("Could not join", error?.message || "Try again.", "error");
    } finally {
      button.disabled = false;
      if (button.textContent !== "Request pending") button.textContent = original;
    }
  }));
}

function renderQr(code, churchName) {
  const joinUrl = `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(code)}`;
  let qrHtml = "";
  try {
    if (typeof window.qrcode === "function") {
      const qr = window.qrcode(0, "M");
      qr.addData(joinUrl);
      qr.make();
      qrHtml = `<img class="connect-qr-image" src="${qr.createDataURL(7, 8)}" alt="QR code to join ${esc(churchName)}" />`;
    }
  } catch (error) {
    console.warn("QR rendering failed", error);
  }
  return `
    <div class="connect-qr-result">
      ${qrHtml || `<div class="connect-qr-placeholder">QR</div>`}
      <div><strong>Join ${esc(churchName)}</strong><p>Scanning this QR opens Church Chatter and carries the invitation code with it.</p><code>${esc(code)}</code><div class="connect-copy-row"><input class="input" value="${esc(joinUrl)}" readonly data-qr-link /><button class="btn btn-secondary" type="button" data-copy-qr>Copy link</button></div></div>
    </div>`;
}

function connectionOtherName(connection, churchId) {
  return connection.churchAId === churchId ? connection.churchBName : connection.churchAName;
}

function connectionCard(connection, options) {
  const inbound = connection.requestedByChurchId !== options.state.activeChurchId;
  const other = connectionOtherName(connection, options.state.activeChurchId);
  if (connection.status === "accepted") {
    return `<article class="connect-connection-card"><div><span class="connect-status accepted">Connected</span><h3>${esc(other)}</h3><p>Your congregations have a private Church Chatter connection.</p></div><div class="connect-card-actions"><button class="btn btn-primary" data-open-connection="${esc(connection.id)}">Open conversation</button><button class="btn btn-secondary" data-remove-connection="${esc(connection.id)}">Disconnect</button></div></article>`;
  }
  if (connection.status === "pending" && inbound) {
    return `<article class="connect-connection-card"><div><span class="connect-status pending">Connection request</span><h3>${esc(other)}</h3><p>This congregation would like to connect with yours.</p></div><div class="connect-card-actions"><button class="btn btn-primary" data-respond-connection="${esc(connection.id)}" data-response="accepted">Accept</button><button class="btn btn-secondary" data-respond-connection="${esc(connection.id)}" data-response="declined">Decline</button></div></article>`;
  }
  return `<article class="connect-connection-card"><div><span class="connect-status ${esc(connection.status || "pending")}">${connection.status === "declined" ? "Declined" : "Awaiting response"}</span><h3>${esc(other)}</h3><p>${connection.status === "declined" ? "The receiving congregation declined this connection." : "Your connection request is waiting for the other congregation."}</p></div></article>`;
}

async function openConversation(connection, options) {
  const other = connectionOtherName(connection, options.state.activeChurchId);
  const messages = await getChurchNetworkMessages(connection.id);
  const modal = document.createElement("div");
  modal.className = "connect-modal-backdrop";
  modal.innerHTML = `
    <section class="connect-thread-modal" role="dialog" aria-modal="true" aria-label="Conversation with ${esc(other)}">
      <div class="connect-thread-head"><div><span class="eyebrow">Church-to-church</span><h2>${esc(other)}</h2></div><button class="icon-btn" data-close-connect>×</button></div>
      <div class="connect-thread-messages" id="connect-thread-messages">${messages.length ? messages.map((message) => `<div class="connect-message ${message.senderChurchId === options.state.activeChurchId ? "ours" : "theirs"}"><div><strong>${esc(message.senderChurchName || message.senderName || "Church")}</strong><span>${esc(message.senderName || "")}</span></div><p>${esc(message.body)}</p></div>`).join("") : emptyState("Start the conversation", "Send a message from your congregation to theirs.")}</div>
      <form class="connect-thread-compose" id="connect-thread-compose"><textarea class="input" name="body" rows="3" maxlength="3000" placeholder="Write on behalf of ${esc(options.state.context.church.name)}…" required></textarea><button class="btn btn-primary">Send message</button></form>
    </section>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener("click", (event) => { if (event.target === modal || event.target.closest("[data-close-connect]")) close(); });
  modal.querySelector("#connect-thread-compose")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const text = new FormData(form).get("body");
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      await sendChurchNetworkMessage(connection.id, options.state.context.church, options.state.user, text);
      close();
      await openConversation(connection, options);
    } catch (error) {
      options.toast("Could not send message", error?.message || "Try again.", "error");
      button.disabled = false;
      button.textContent = "Send message";
    }
  });
}

async function renderNetwork(options) {
  const root = document.querySelector("#church-network-root");
  if (!root) return;
  if (!canNetwork(options)) {
    root.innerHTML = emptyState("Church Network is a leadership tool", "Your role does not have permission to communicate on behalf of this congregation.");
    return;
  }

  root.innerHTML = `<div class="connect-loading">Loading Church Network…</div>`;
  try {
    const [settings, connections, networkDirectory, joinRequests] = await Promise.all([
      getDiscoverySettings(options.state.activeChurchId),
      getChurchConnections(options.state.activeChurchId),
      searchChurchNetwork(""),
      canReviewJoins(options) ? getPendingJoinRequests(options.state.activeChurchId) : Promise.resolve([])
    ]);

    const manageChurch = options.hasPermission(PERMISSIONS.MANAGE_CHURCH);
    root.innerHTML = `
      ${manageChurch ? `<div class="connect-settings-grid">
        <section class="connect-panel"><span class="eyebrow">Church discovery</span><h2>Let people find you.</h2><p>When discovery is off, your congregation is absent from Church Chatter search.</p><label class="connect-toggle"><input type="checkbox" id="discovery-enabled" ${settings.discoveryEnabled ? "checked" : ""}><span></span><strong>Appear in Church Discovery</strong></label><div class="field"><label for="discovery-join-mode">When someone finds us</label><select class="input" id="discovery-join-mode"><option value="request" ${settings.discoveryJoinMode !== "open" ? "selected" : ""}>Require leadership approval</option><option value="open" ${settings.discoveryJoinMode === "open" ? "selected" : ""}>Allow immediate joining</option></select></div><button class="btn btn-primary" id="save-discovery-settings">Save discovery settings</button></section>
        <section class="connect-panel"><span class="eyebrow">Church network</span><h2>Connect with other churches.</h2><p>This is separate from member discovery. Turning it on makes your congregation available to other participating church leaders.</p><label class="connect-toggle"><input type="checkbox" id="network-enabled" ${settings.networkEnabled ? "checked" : ""}><span></span><strong>Participate in Church Network</strong></label><button class="btn btn-primary" id="save-network-settings">Save network setting</button></section>
        <section class="connect-panel connect-qr-panel"><span class="eyebrow">QR join code</span><h2>Put Church Chatter in the room.</h2><p>Create a scannable invitation for a bulletin, welcome desk, screen, or printed sign. QR joining works even when Church Discovery is disabled.</p><button class="btn btn-primary" id="generate-church-qr">Generate QR join code</button><div id="church-qr-output"></div></section>
      </div>` : ""}

      ${canReviewJoins(options) ? `<section class="connect-section"><div class="connect-section-head"><div><span class="eyebrow">Join requests</span><h2>People asking to join</h2></div><span class="connect-count">${joinRequests.filter((item) => item.status === "pending").length} pending</span></div><div class="connect-request-list">${joinRequests.filter((item) => item.status === "pending").length ? joinRequests.filter((item) => item.status === "pending").map((request) => `<article class="connect-request-card"><div class="connect-avatar">${esc((request.displayName || "M").slice(0,1).toUpperCase())}</div><div><strong>${esc(request.displayName || "Member")}</strong><p>${esc(request.email || "")}</p></div><div class="connect-card-actions"><button class="btn btn-primary" data-review-join="${esc(request.uid)}" data-join-review="approved">Approve</button><button class="btn btn-secondary" data-review-join="${esc(request.uid)}" data-join-review="denied">Deny</button></div></article>`).join("") : emptyState("No pending requests", "New discovery requests will appear here.")}</div></section>` : ""}

      <section class="connect-section"><div class="connect-section-head"><div><span class="eyebrow">Connections</span><h2>Your church connections</h2></div></div><div id="connection-list" class="connect-connection-list">${connections.length ? connections.map((connection) => connectionCard(connection, options)).join("") : emptyState("No church connections yet", "Search the Church Network below to connect with another congregation.")}</div></section>

      <section class="connect-section"><div class="connect-section-head"><div><span class="eyebrow">Find another congregation</span><h2>Church Network directory</h2></div></div><div class="connect-search-card inline"><div class="connect-search-row"><input class="input" id="network-search" placeholder="Search church name or city" maxlength="80"><button class="btn btn-primary" id="network-search-submit">Search</button></div></div><div id="network-search-results" class="connect-results">${settings.networkEnabled ? networkDirectory.map((church) => networkDirectoryCard(church, options)).join("") : emptyState("Church Network is off", "Enable your congregation's Church Network setting before connecting with other churches.")}</div></section>`;

    bindNetwork(options, settings, connections);
  } catch (error) {
    root.innerHTML = emptyState("Could not load Church Network", error?.message || "Try again in a moment.");
  }
}

function bindNetwork(options, settings, connections) {
  document.querySelector("#save-discovery-settings")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await saveDiscoverySettings(options.state.activeChurchId, options.state.user.uid, {
        enabled: document.querySelector("#discovery-enabled")?.checked,
        joinMode: document.querySelector("#discovery-join-mode")?.value
      });
      options.toast("Discovery settings saved", document.querySelector("#discovery-enabled")?.checked ? "Your congregation can now be found in Church Chatter." : "Your congregation is hidden from Church Discovery.", "success");
      await renderNetwork(options);
    } catch (error) { options.toast("Could not save discovery settings", error?.message || "Try again.", "error"); button.disabled = false; }
  });

  document.querySelector("#save-network-settings")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await saveNetworkSettings(options.state.activeChurchId, options.state.user.uid, document.querySelector("#network-enabled")?.checked);
      options.toast("Church Network updated", document.querySelector("#network-enabled")?.checked ? "Other participating church leaders can now find your congregation." : "Your congregation is no longer visible in Church Network search.", "success");
      await renderNetwork(options);
    } catch (error) { options.toast("Could not update Church Network", error?.message || "Try again.", "error"); button.disabled = false; }
  });

  document.querySelector("#generate-church-qr")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Creating QR…";
    try {
      const code = await createInvite(options.state.activeChurchId, options.state.user.uid, { maxUses: 500 });
      const output = document.querySelector("#church-qr-output");
      if (output) output.innerHTML = renderQr(code, options.state.context.church.name);
      output?.querySelector("[data-copy-qr]")?.addEventListener("click", async () => {
        const value = output.querySelector("[data-qr-link]")?.value || "";
        try { await navigator.clipboard.writeText(value); options.toast("Join link copied", "You can paste it into a bulletin, text, email, or social post.", "success"); } catch (_) {}
      });
    } catch (error) { options.toast("Could not create QR code", error?.message || "Try again.", "error"); }
    finally { button.disabled = false; button.textContent = "Generate another QR join code"; }
  });

  document.querySelectorAll("[data-review-join]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await reviewJoinRequest(options.state.activeChurchId, button.dataset.reviewJoin, button.dataset.joinReview, options.state.user.uid);
      options.toast(button.dataset.joinReview === "approved" ? "Join request approved" : "Join request denied", button.dataset.joinReview === "approved" ? "The member can now complete joining from Church Discovery." : "The request has been closed.", "success");
      await renderNetwork(options);
    } catch (error) { options.toast("Could not review request", error?.message || "Try again.", "error"); }
  }));

  const bindNetworkSearchResults = (root) => {
    root?.querySelectorAll("[data-network-connect]").forEach((button) => button.addEventListener("click", async () => {
      const target = button.dataset.networkConnect;
      const result = [...root.querySelectorAll("[data-network-connect]")].find((item) => item.dataset.networkConnect === target);
      const directory = await searchChurchNetwork("");
      const church = directory.find((item) => item.churchId === target);
      if (!church) return options.toast("Church not found", "Try searching again.", "error");
      try {
        await requestChurchConnection(options.state.context.church, church, options.state.user.uid);
        options.toast("Connection request sent", `${church.name} can now accept your request.`, "success");
        await renderNetwork(options);
      } catch (error) { options.toast("Could not connect churches", error?.message || "Try again.", "error"); }
    }));
  };
  bindNetworkSearchResults(document.querySelector("#network-search-results"));

  document.querySelector("#network-search-submit")?.addEventListener("click", async () => {
    const root = document.querySelector("#network-search-results");
    if (!root) return;
    root.innerHTML = `<div class="connect-loading">Searching churches…</div>`;
    try {
      const results = await searchChurchNetwork(document.querySelector("#network-search")?.value || "");
      root.innerHTML = results.length ? results.map((church) => networkDirectoryCard(church, options)).join("") : emptyState("No churches found", "Try another name, city, or region.");
      bindNetworkSearchResults(root);
    } catch (error) { root.innerHTML = emptyState("Search failed", error?.message || "Try again."); }
  });

  document.querySelectorAll("[data-respond-connection]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await respondToChurchConnection(button.dataset.respondConnection, options.state.activeChurchId, options.state.user.uid, button.dataset.response);
      options.toast(button.dataset.response === "accepted" ? "Churches connected" : "Connection declined", "Church Network has been updated.", "success");
      await renderNetwork(options);
    } catch (error) { options.toast("Could not respond", error?.message || "Try again.", "error"); }
  }));

  document.querySelectorAll("[data-open-connection]").forEach((button) => button.addEventListener("click", async () => {
    const connection = connections.find((item) => item.id === button.dataset.openConnection);
    if (connection) await openConversation(connection, options);
  }));

  document.querySelectorAll("[data-remove-connection]").forEach((button) => button.addEventListener("click", async () => {
    const connection = connections.find((item) => item.id === button.dataset.removeConnection);
    if (!connection) return;
    if (!window.confirm(`Disconnect from ${connectionOtherName(connection, options.state.activeChurchId)}? The private church-to-church conversation will be deleted.`)) return;
    try { await removeChurchConnection(connection.id); options.toast("Churches disconnected", "The network conversation was removed.", "success"); await renderNetwork(options); }
    catch (error) { options.toast("Could not disconnect", error?.message || "Try again.", "error"); }
  }));
}

export async function mountConnectRoute(options) {
  if (options.state.route === "discover") {
    const submit = document.querySelector("#church-discovery-submit");
    const input = document.querySelector("#church-discovery-search");
    const run = () => renderDiscovery(options, document.querySelector("#church-discovery-results"), input?.value || "");
    submit?.addEventListener("click", run);
    input?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); run(); } });
    await renderDiscovery(options);
  } else if (options.state.route === "network") {
    await renderNetwork(options);
  }
}

export function decorateOnboardingDiscovery(options) {
  const grid = document.querySelector(".choice-grid");
  if (!grid || grid.querySelector("#discover-church-choice")) return;
  const card = document.createElement("button");
  card.type = "button";
  card.className = "choice-card connect-choice-card";
  card.id = "discover-church-choice";
  card.innerHTML = `<div class="choice-icon">⌕</div><h3>Find my church</h3><p>Search congregations that chose to appear in Church Chatter. No invitation code required.</p><span class="btn btn-soft">Search Church Chatter →</span>`;
  grid.appendChild(card);
  card.addEventListener("click", () => openOnboardingDiscovery(options));
}

async function openOnboardingDiscovery(options) {
  const modal = document.createElement("div");
  modal.className = "connect-modal-backdrop";
  modal.innerHTML = `<section class="connect-discovery-modal" role="dialog" aria-modal="true"><div class="connect-thread-head"><div><span class="eyebrow">Church discovery</span><h2>Find your congregation</h2></div><button class="icon-btn" data-close-connect>×</button></div><div class="connect-search-row"><input class="input" id="onboarding-discovery-search" placeholder="Church name, city, or region" maxlength="80"><button class="btn btn-primary" id="onboarding-discovery-submit">Search</button></div><div id="onboarding-discovery-results" class="connect-results"></div></section>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener("click", (event) => { if (event.target === modal || event.target.closest("[data-close-connect]")) close(); });
  const root = modal.querySelector("#onboarding-discovery-results");
  const input = modal.querySelector("#onboarding-discovery-search");
  const run = () => renderDiscovery(options, root, input?.value || "");
  modal.querySelector("#onboarding-discovery-submit")?.addEventListener("click", run);
  input?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); run(); } });
  await renderDiscovery(options, root, "");
}

export async function showQrJoinConfirmation(code, options) {
  const inviteSnap = await getDoc(doc(db, "inviteCodes", code));
  if (!inviteSnap.exists()) throw new Error("That QR invitation is no longer valid.");
  const invite = inviteSnap.data();
  const churchSnap = await getDoc(doc(db, "churches", invite.churchId));
  if (!churchSnap.exists()) throw new Error("The congregation connected to that QR code no longer exists.");
  const church = churchSnap.data();

  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "connect-modal-backdrop";
    modal.innerHTML = `<section class="connect-confirm-modal" role="dialog" aria-modal="true"><div class="connect-hero-mark small">↗</div><span class="eyebrow">QR invitation</span><h2>Join ${esc(church.name || "this congregation")}?</h2><p>${esc(locationText(church))}</p><p>Church Chatter will add this congregation to your account. You can belong to more than one church.</p><div class="connect-confirm-actions"><button class="btn btn-secondary" data-qr-cancel>Not now</button><button class="btn btn-primary" data-qr-confirm>Join congregation</button></div></section>`;
    document.body.appendChild(modal);
    const finish = (value) => { modal.remove(); resolve(value); };
    modal.querySelector("[data-qr-cancel]")?.addEventListener("click", () => finish(false));
    modal.querySelector("[data-qr-confirm]")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = "Joining…";
      try { await joinChurch(options.state.user, code); finish(true); }
      catch (error) { options.toast("Could not join congregation", error?.message || "Try again.", "error"); event.currentTarget.disabled = false; event.currentTarget.textContent = "Join congregation"; }
    });
  });
}
