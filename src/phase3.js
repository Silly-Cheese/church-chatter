import {
  createReport,
  createResource,
  createServeOpportunity,
  deleteResource,
  getAdminSnapshot,
  getServeSignupState,
  getSundayHub,
  listenReports,
  listenResources,
  listenServeOpportunities,
  resolveReport,
  saveSundayHub,
  signUpToServe,
  updateResource,
  updateServeOpportunity,
  withdrawFromServe
} from "./phase3-data.js";

const PHASE3_ROUTES = new Set(["serve", "resources", "admin"]);
let cleanups = [];
let adminTab = "dashboard";

export function isPhase3Route(route) {
  return PHASE3_ROUTES.has(route);
}

export function phase3RouteShell(route) {
  const labels = { serve: "Serve", resources: "Resources", admin: "Church Admin" };
  return `<div class="page"><div id="phase3-route-root"><section class="card"><div class="skeleton" style="height:180px"></div><p class="muted mt-18">Opening ${labels[route] || "Church Chatter"}…</p></section></div></div>`;
}

function esc(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function asDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventTime(value) {
  const date = asDate(value);
  if (!date) return "Time not set";
  return date.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function relativeTime(value) {
  const date = asDate(value);
  if (!date) return "just now";
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ${minutes >= 0 ? "ago" : "from now"}`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ${hours >= 0 ? "ago" : "from now"}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function modal(content, wide = false) {
  document.querySelector(".phase3-modal-backdrop")?.remove();
  const node = document.createElement("div");
  node.className = "modal-backdrop phase3-modal-backdrop";
  node.innerHTML = `<section class="modal ${wide ? "modal-lg" : ""}" role="dialog" aria-modal="true">${content}</section>`;
  node.addEventListener("click", (event) => {
    if (event.target === node || event.target.closest("[data-phase3-close]")) node.remove();
  });
  document.body.appendChild(node);
  node.querySelector("input,textarea,select")?.focus();
  return node;
}

function closeModal() {
  document.querySelector(".phase3-modal-backdrop")?.remove();
}

function busy(button, active, text = "Working…") {
  if (!button) return;
  if (active) {
    button.dataset.old = button.innerHTML;
    button.innerHTML = text;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.old || button.innerHTML;
    button.disabled = false;
  }
}

function stopListeners() {
  cleanups.forEach((fn) => { try { fn?.(); } catch (_) {} });
  cleanups = [];
}

export function destroyPhase3Bindings() {
  stopListeners();
  document.querySelector(".phase3-modal-backdrop")?.remove();
}

function context(options) {
  return {
    churchId: options.state.activeChurchId,
    church: options.state.context.church,
    member: options.state.context.member,
    user: options.state.user,
    members: options.state.context.members || [],
    hasPermission: options.hasPermission,
    permissions: options.permissions
  };
}

function pageHead(eyebrow, title, body, action = "") {
  return `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(body)}</p></div>${action}</div>`;
}

function empty(icon, title, body, action = "") {
  return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
}

export async function mountPhase3Route(options) {
  stopListeners();
  const root = document.querySelector("#phase3-route-root");
  if (!root) return;
  if (options.state.route === "serve") return mountServe(root, options);
  if (options.state.route === "resources") return mountResources(root, options);
  if (options.state.route === "admin") return mountAdmin(root, options);
}

async function mountServe(root, options) {
  const c = context(options);
  const canManage = c.hasPermission(c.permissions.MANAGE_GROUPS);
  let opportunities = [];
  root.innerHTML = `${pageHead("Put faith into action", "Serve", "See where your church needs a hand and step into meaningful ways to help.", canManage ? `<button class="btn btn-primary" id="new-serve">＋ Add opportunity</button>` : "")}<div id="serve-list" class="serve-grid"></div>`;

  async function render() {
    const target = root.querySelector("#serve-list");
    if (!target) return;
    const current = opportunities.filter((item) => item.status !== "cancelled" && (!asDate(item.startAt) || asDate(item.startAt).getTime() > Date.now() - 12 * 60 * 60 * 1000));
    if (!current.length) {
      target.innerHTML = empty("🤝", "No serving opportunities yet", "When your church needs volunteers, opportunities will appear here.", canManage ? `<button class="btn btn-primary" id="empty-new-serve">Add an opportunity</button>` : "");
      target.querySelector("#empty-new-serve")?.addEventListener("click", openCreate);
      return;
    }
    target.innerHTML = current.map((item) => `<article class="card serve-card" data-serve-card="${esc(item.id)}"><div class="serve-top"><div class="serve-icon">${esc((item.team || "Serve").slice(0, 1).toUpperCase())}</div><div class="grow"><span class="group-category">${esc(item.team || "Serve")}</span><h3>${esc(item.title)}</h3><p>${esc(item.description || "Your church could use a hand here.")}</p></div><span class="pill ${item.status === "open" ? "success" : ""}">${item.status === "open" ? "Open" : "Closed"}</span></div><div class="serve-meta"><span>◇ ${esc(eventTime(item.startAt))}</span><span>⌖ ${esc(item.location || "Location not added")}</span><span data-serve-count="${esc(item.id)}">Checking volunteers…</span></div><div class="serve-actions" data-serve-actions="${esc(item.id)}"><button class="btn btn-secondary" disabled>Loading…</button></div></article>`).join("");
    await Promise.all(current.map(hydrateCard));
  }

  async function hydrateCard(item) {
    const card = root.querySelector(`[data-serve-card="${CSS.escape(item.id)}"]`);
    if (!card) return;
    try {
      const state = await getServeSignupState(c.churchId, item.id, c.user.uid);
      const count = card.querySelector(`[data-serve-count="${CSS.escape(item.id)}"]`);
      if (count) count.textContent = `${state.count} of ${item.slots || 1} spots filled`;
      const actions = card.querySelector(`[data-serve-actions="${CSS.escape(item.id)}"]`);
      if (!actions) return;
      const full = state.count >= Number(item.slots || 1);
      actions.innerHTML = `${item.status === "open" ? (state.signedUp ? `<button class="btn btn-secondary" data-withdraw-serve="${esc(item.id)}">Withdraw</button><span class="serve-confirmed">✓ You're serving</span>` : `<button class="btn btn-primary" data-signup-serve="${esc(item.id)}" ${full ? "disabled" : ""}>${full ? "Team full" : "I can help"}</button>`) : `<span class="muted">Signups closed</span>`}${canManage ? `<button class="btn btn-secondary" data-view-volunteers="${esc(item.id)}">Volunteers</button>${item.status === "open" ? `<button class="btn-link danger-link" data-close-serve="${esc(item.id)}">Close</button>` : `<button class="btn-link" data-open-serve="${esc(item.id)}">Reopen</button>`}` : ""}`;
      actions.querySelector("[data-signup-serve]")?.addEventListener("click", async (event) => { busy(event.currentTarget, true, "Joining…"); try { await signUpToServe(c.churchId, item.id, c.user, c.member); options.toast("You're on the team", "Thanks for stepping in to serve.", "success"); await hydrateCard(item); } catch (error) { options.toast("Could not sign up", error.message, "error"); busy(event.currentTarget, false); } });
      actions.querySelector("[data-withdraw-serve]")?.addEventListener("click", async (event) => { busy(event.currentTarget, true, "Withdrawing…"); try { await withdrawFromServe(c.churchId, item.id, c.user.uid); options.toast("Signup removed", "Your spot is open again.", "success"); await hydrateCard(item); } catch (error) { options.toast("Could not withdraw", error.message, "error"); busy(event.currentTarget, false); } });
      actions.querySelector("[data-close-serve]")?.addEventListener("click", async () => { try { await updateServeOpportunity(c.churchId, item.id, { status: "closed" }); } catch (error) { options.toast("Could not close opportunity", error.message, "error"); } });
      actions.querySelector("[data-open-serve]")?.addEventListener("click", async () => { try { await updateServeOpportunity(c.churchId, item.id, { status: "open" }); } catch (error) { options.toast("Could not reopen opportunity", error.message, "error"); } });
      actions.querySelector("[data-view-volunteers]")?.addEventListener("click", () => openVolunteers(item, state));
    } catch (_) {
      const actions = card.querySelector(`[data-serve-actions="${CSS.escape(item.id)}"]`);
      if (actions) actions.innerHTML = `<span class="muted">Volunteer details unavailable.</span>`;
    }
  }

  function openVolunteers(item, state) {
    modal(`<div class="modal-head"><div><div class="eyebrow">Serve team</div><h2>${esc(item.title)}</h2><p>${state.count} volunteer${state.count === 1 ? "" : "s"} signed up.</p></div><button class="icon-btn" data-phase3-close>×</button></div><div class="modal-body">${state.signups.length ? `<div class="list">${state.signups.map((person) => `<div class="list-row"><div class="avatar">${esc((person.displayName || "M").slice(0, 1).toUpperCase())}</div><div><strong>${esc(person.displayName || "Member")}</strong><small>Volunteer</small></div></div>`).join("")}</div>` : `<p class="muted">No volunteers yet.</p>`}</div><div class="modal-actions"><button class="btn btn-secondary" data-phase3-close>Done</button></div>`);
  }

  function openCreate() {
    const node = modal(`<div class="modal-head"><div><div class="eyebrow">Invite people to serve</div><h2>New serving opportunity</h2><p>Post a clear need and let members volunteer themselves.</p></div><button class="icon-btn" data-phase3-close>×</button></div><form id="serve-form"><div class="modal-body"><div class="field"><label>Opportunity</label><input class="input" name="title" maxlength="120" required placeholder="Children's check-in"></div><div class="grid grid-2"><div class="field"><label>Team / ministry</label><input class="input" name="team" maxlength="80" placeholder="Children's Ministry"></div><div class="field"><label>Spots needed</label><input class="input" name="slots" type="number" min="1" max="500" value="2" required></div></div><div class="grid grid-2"><div class="field"><label>Date & time</label><input class="input" type="datetime-local" name="start" required></div><div class="field"><label>Location</label><input class="input" name="location" maxlength="180"></div></div><div class="field"><label>Description</label><textarea class="textarea" name="description" maxlength="1600" placeholder="What will volunteers do?"></textarea></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-phase3-close>Cancel</button><button class="btn btn-primary" type="submit">Post opportunity</button></div></form>`);
    node.querySelector("#serve-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); const form = new FormData(event.currentTarget); busy(button, true, "Posting…"); try { await createServeOpportunity(c.churchId, c.user, { title: form.get("title"), team: form.get("team"), slots: form.get("slots"), startAt: new Date(form.get("start")), location: form.get("location"), description: form.get("description") }); closeModal(); options.toast("Opportunity posted", "Members can now volunteer from Serve.", "success"); } catch (error) { options.toast("Could not post opportunity", error.message, "error"); busy(button, false); } });
  }

  root.querySelector("#new-serve")?.addEventListener("click", openCreate);
  cleanups.push(listenServeOpportunities(c.churchId, (items, error) => { opportunities = items; if (error) options.toast("Serve unavailable", "Volunteer opportunities could not be loaded.", "error"); render(); }));
}

async function mountResources(root, options) {
  const c = context(options);
  const canManage = c.hasPermission(c.permissions.MANAGE_CHURCH);
  let resources = [];
  let category = "all";
  root.innerHTML = `${pageHead("Keep what matters close", "Resources", "Sermons, studies, forms, documents, and useful links from your church in one dependable place.", canManage ? `<button class="btn btn-primary" id="new-resource">＋ Add resource</button>` : "")}<div id="resource-filters" class="room-bar"></div><div id="resource-grid" class="resource-grid"></div>`;

  function render() {
    const filters = root.querySelector("#resource-filters");
    const grid = root.querySelector("#resource-grid");
    if (!filters || !grid) return;
    const categories = Array.from(new Set(resources.filter((r) => r.active !== false).map((r) => r.category || "Other"))).sort();
    filters.innerHTML = `<button class="room-chip ${category === "all" ? "active" : ""}" data-resource-category="all">All</button>${categories.map((name) => `<button class="room-chip ${category === name ? "active" : ""}" data-resource-category="${esc(name)}">${esc(name)}</button>`).join("")}`;
    filters.querySelectorAll("[data-resource-category]").forEach((button) => button.addEventListener("click", () => { category = button.dataset.resourceCategory; render(); }));
    const visible = resources.filter((item) => (canManage || item.active !== false) && (category === "all" || item.category === category));
    grid.innerHTML = visible.length ? visible.map((item) => `<article class="card resource-card ${item.active === false ? "resource-archived" : ""}"><div class="resource-kind">${item.kind === "sermon" ? "▤" : item.kind === "study" ? "✦" : item.kind === "form" ? "✓" : item.kind === "document" ? "□" : "↗"}</div><div class="grow"><div class="flex gap-8 wrap"><span class="pill">${esc(item.category || "Other")}</span>${item.active === false ? `<span class="pill">Archived</span>` : ""}</div><h3>${esc(item.title)}</h3><p>${esc(item.description || "")}</p><a class="btn btn-secondary resource-open" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open resource ↗</a></div>${canManage ? `<div class="resource-admin"><button class="icon-btn" data-resource-menu="${esc(item.id)}">⋯</button></div>` : ""}</article>`).join("") : empty("□", "No resources here yet", "Your church can keep its most useful links and materials here.", canManage ? `<button class="btn btn-primary" id="empty-new-resource">Add the first resource</button>` : "");
    grid.querySelector("#empty-new-resource")?.addEventListener("click", openCreate);
    grid.querySelectorAll("[data-resource-menu]").forEach((button) => button.addEventListener("click", () => openMenu(resources.find((item) => item.id === button.dataset.resourceMenu))));
  }

  function resourceForm(item = null) {
    return `<div class="modal-head"><div><div class="eyebrow">Church library</div><h2>${item ? "Edit resource" : "Add a resource"}</h2><p>Church Chatter stores the link and information—not the file itself.</p></div><button class="icon-btn" data-phase3-close>×</button></div><form id="resource-form"><div class="modal-body"><div class="field"><label>Title</label><input class="input" name="title" maxlength="120" required value="${esc(item?.title || "")}"></div><div class="grid grid-2"><div class="field"><label>Type</label><select class="input" name="kind"><option value="link" ${item?.kind === "link" ? "selected" : ""}>Link</option><option value="sermon" ${item?.kind === "sermon" ? "selected" : ""}>Sermon</option><option value="study" ${item?.kind === "study" ? "selected" : ""}>Bible study</option><option value="document" ${item?.kind === "document" ? "selected" : ""}>Document</option><option value="form" ${item?.kind === "form" ? "selected" : ""}>Form</option></select></div><div class="field"><label>Category</label><input class="input" name="category" maxlength="60" value="${esc(item?.category || "")}" placeholder="Sermons, Youth, Forms…"></div></div><div class="field"><label>Link</label><input class="input" name="url" maxlength="500" required value="${esc(item?.url || "")}" placeholder="https://…"></div><div class="field"><label>Description</label><textarea class="textarea" name="description" maxlength="800">${esc(item?.description || "")}</textarea></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-phase3-close>Cancel</button><button class="btn btn-primary" type="submit">${item ? "Save changes" : "Add resource"}</button></div></form>`;
  }

  function bindResourceForm(node, item = null) {
    node.querySelector("#resource-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); const data = Object.fromEntries(new FormData(event.currentTarget)); busy(button, true, "Saving…"); try { if (item) await updateResource(c.churchId, item.id, data); else await createResource(c.churchId, c.user, data); closeModal(); options.toast(item ? "Resource updated" : "Resource added", "Your church library is current.", "success"); } catch (error) { options.toast("Could not save resource", error.message, "error"); busy(button, false); } });
  }

  function openCreate() { const node = modal(resourceForm(), true); bindResourceForm(node); }
  function openEdit(item) { const node = modal(resourceForm(item), true); bindResourceForm(node, item); }
  function openMenu(item) {
    if (!item) return;
    const node = modal(`<div class="modal-head"><div><h2>${esc(item.title)}</h2><p>Manage this church resource.</p></div><button class="icon-btn" data-phase3-close>×</button></div><div class="modal-body"><div class="list"><button class="list-row community-list-button" id="edit-resource"><div class="avatar">✎</div><div><strong>Edit resource</strong><small>Change the title, category, link, or description.</small></div></button><button class="list-row community-list-button" id="toggle-resource"><div class="avatar">${item.active === false ? "↻" : "−"}</div><div><strong>${item.active === false ? "Restore resource" : "Archive resource"}</strong><small>${item.active === false ? "Make it visible to members again." : "Hide it without deleting it."}</small></div></button><button class="list-row community-list-button danger-row" id="delete-resource"><div class="avatar">×</div><div><strong>Delete resource</strong><small>Permanently remove this link.</small></div></button></div></div>`);
    node.querySelector("#edit-resource")?.addEventListener("click", () => { closeModal(); openEdit(item); });
    node.querySelector("#toggle-resource")?.addEventListener("click", async () => { try { await updateResource(c.churchId, item.id, { active: item.active === false }); closeModal(); } catch (error) { options.toast("Could not update resource", error.message, "error"); } });
    node.querySelector("#delete-resource")?.addEventListener("click", async () => { try { await deleteResource(c.churchId, item.id); closeModal(); options.toast("Resource deleted", "It has been removed from Church Chatter.", "success"); } catch (error) { options.toast("Could not delete resource", error.message, "error"); } });
  }

  root.querySelector("#new-resource")?.addEventListener("click", openCreate);
  cleanups.push(listenResources(c.churchId, (items, error) => { resources = items; if (error) options.toast("Resources unavailable", "Church resources could not be loaded.", "error"); render(); }));
}

async function mountAdmin(root, options) {
  const c = context(options);
  const admin = c.hasPermission(c.permissions.MANAGE_CHURCH) || c.hasPermission(c.permissions.MANAGE_MEMBERS) || c.hasPermission(c.permissions.MANAGE_ROLES) || c.hasPermission(c.permissions.MANAGE_INVITES) || c.hasPermission(c.permissions.MANAGE_EVENTS) || c.hasPermission(c.permissions.MANAGE_GROUPS) || c.hasPermission(c.permissions.MODERATE_CONTENT) || c.hasPermission(c.permissions.CREATE_ANNOUNCEMENTS);
  if (!admin) {
    root.innerHTML = empty("⌁", "Church Admin is restricted", "Your church role does not include administrative access.", `<button class="btn btn-secondary" data-go-home>Return home</button>`);
    root.querySelector("[data-go-home]")?.addEventListener("click", () => options.navigate("home"));
    return;
  }
  const tabs = [
    ["dashboard", "Overview", true],
    ["moderation", "Moderation", c.hasPermission(c.permissions.MODERATE_CONTENT)],
    ["sunday", "Sunday Hub", c.hasPermission(c.permissions.MANAGE_CHURCH)]
  ].filter((item) => item[2]);
  if (!tabs.some(([id]) => id === adminTab)) adminTab = "dashboard";
  root.innerHTML = `${pageHead("Church leadership", "Church Admin", `Manage the operational side of ${c.church.name} without changing how your church defines itself.`)}<div class="admin-tabs">${tabs.map(([id, label]) => `<button class="${adminTab === id ? "active" : ""}" data-admin-tab="${id}">${label}</button>`).join("")}</div><div id="admin-content"></div>`;
  root.querySelectorAll("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => { adminTab = button.dataset.adminTab; mountAdmin(root, options); }));
  if (adminTab === "moderation") return mountModeration(root.querySelector("#admin-content"), options);
  if (adminTab === "sunday") return mountSundaySettings(root.querySelector("#admin-content"), options);
  return mountAdminDashboard(root.querySelector("#admin-content"), options);
}

async function mountAdminDashboard(root, options) {
  const c = context(options);
  root.innerHTML = `<section class="card"><div class="skeleton" style="height:220px"></div></section>`;
  try {
    const stats = await getAdminSnapshot(c.churchId);
    root.innerHTML = `<div class="grid grid-3 admin-stat-grid"><div class="card stat-card"><div class="stat-icon">♙</div><strong>${c.members.length}</strong><span>Members</span></div><div class="card stat-card"><div class="stat-icon">◎</div><strong>${stats.groups}</strong><span>Groups</span></div><div class="card stat-card"><div class="stat-icon">◇</div><strong>${stats.upcomingEvents}</strong><span>Upcoming gatherings</span></div><div class="card stat-card"><div class="stat-icon">🤝</div><strong>${stats.serveOpen}</strong><span>Open serve needs</span></div><div class="card stat-card"><div class="stat-icon">□</div><strong>${stats.resources}</strong><span>Resources</span></div><div class="card stat-card ${stats.openReports ? "attention-stat" : ""}"><div class="stat-icon">!</div><strong>${stats.openReports}</strong><span>Open reports</span></div></div><div class="grid grid-2 mt-28"><section class="card"><div class="card-head"><div><h3>Manage your church</h3><p>Go directly to the tools your role allows.</p></div></div><div class="admin-action-grid">${c.hasPermission(c.permissions.MANAGE_MEMBERS) || c.hasPermission(c.permissions.MANAGE_ROLES) ? `<button data-admin-route="people"><span>♙</span><strong>People</strong><small>Members and church access</small></button>` : ""}${c.hasPermission(c.permissions.MANAGE_ROLES) || c.hasPermission(c.permissions.MANAGE_INVITES) ? `<button data-admin-route="roles"><span>⚙</span><strong>Access & roles</strong><small>Roles and invitations</small></button>` : ""}${c.hasPermission(c.permissions.MANAGE_EVENTS) ? `<button data-admin-route="gather"><span>◇</span><strong>Gather</strong><small>Church calendar</small></button>` : ""}${c.hasPermission(c.permissions.MANAGE_GROUPS) ? `<button data-admin-route="groups"><span>◎</span><strong>Groups</strong><small>Ministries and teams</small></button><button data-admin-route="serve"><span>🤝</span><strong>Serve</strong><small>Volunteer needs</small></button>` : ""}${c.hasPermission(c.permissions.MANAGE_CHURCH) ? `<button data-admin-route="resources"><span>□</span><strong>Resources</strong><small>Church library</small></button>` : ""}</div></section><section class="card"><div class="card-head"><div><h3>Administration principles</h3><p>Power stays explicit and church-scoped.</p></div></div><div class="list"><div class="list-row"><div class="avatar">✓</div><div><strong>Permission based</strong><small>Titles never automatically grant authority.</small></div></div><div class="list-row"><div class="avatar">✓</div><div><strong>Congregation isolated</strong><small>Every administrative collection is scoped to one church.</small></div></div><div class="list-row"><div class="avatar">✓</div><div><strong>No hidden backend</strong><small>Authentication and Firestore rules remain the security boundary.</small></div></div></div></section></div>`;
    root.querySelectorAll("[data-admin-route]").forEach((button) => button.addEventListener("click", () => options.navigate(button.dataset.adminRoute)));
  } catch (error) {
    root.innerHTML = empty("!", "Admin overview could not load", "Your individual administration tools are still available from the navigation.");
  }
}

function mountModeration(root, options) {
  const c = context(options);
  root.innerHTML = `<section class="card"><div class="card-head"><div><h3>Community reports</h3><p>Review concerns raised by members and close the loop deliberately.</p></div></div><div id="report-list"><div class="skeleton" style="height:160px"></div></div></section>`;
  cleanups.push(listenReports(c.churchId, (reports, error) => {
    const list = root.querySelector("#report-list");
    if (!list) return;
    if (error) { list.innerHTML = `<p class="muted">Reports could not be loaded.</p>`; return; }
    list.innerHTML = reports.length ? `<div class="report-list">${reports.map((report) => `<article class="report-row ${report.status !== "open" ? "resolved" : ""}"><div class="report-icon">!</div><div class="grow"><div class="flex gap-8 wrap"><span class="pill">${esc(report.targetType)}</span><span class="pill ${report.status === "open" ? "owner" : "success"}">${esc(report.status)}</span></div><h3>${esc(report.reason || "Report")}</h3><p>${esc(report.excerpt || "No excerpt available.")}</p>${report.details ? `<small>${esc(report.details)}</small>` : ""}<small>Submitted ${relativeTime(report.createdAt)}</small></div>${report.status === "open" ? `<div class="report-actions"><button class="btn btn-primary" data-resolve-report="${esc(report.id)}">Resolve</button><button class="btn btn-secondary" data-dismiss-report="${esc(report.id)}">Dismiss</button></div>` : `<button class="btn-link" data-reopen-report="${esc(report.id)}">Reopen</button>`}</article>`).join("")}</div>` : empty("✓", "No moderation reports", "Your community has no reported content waiting for review.");
    list.querySelectorAll("[data-resolve-report]").forEach((button) => button.addEventListener("click", () => changeReport(button.dataset.resolveReport, "resolved")));
    list.querySelectorAll("[data-dismiss-report]").forEach((button) => button.addEventListener("click", () => changeReport(button.dataset.dismissReport, "dismissed")));
    list.querySelectorAll("[data-reopen-report]").forEach((button) => button.addEventListener("click", () => changeReport(button.dataset.reopenReport, "open")));
  }));
  async function changeReport(id, status) {
    try { await resolveReport(c.churchId, id, c.user, status); options.toast("Report updated", `The report is now ${status}.`, "success"); } catch (error) { options.toast("Could not update report", error.message, "error"); }
  }
}

async function mountSundaySettings(root, options) {
  const c = context(options);
  const settings = await getSundayHub(c.churchId).catch(() => null);
  root.innerHTML = `<div class="grid grid-2"><section class="card"><div class="card-head"><div><h3>Sunday Hub settings</h3><p>On Sundays, Home can surface the information members are most likely looking for.</p></div></div><form id="sunday-form"><label class="check compact-check"><input type="checkbox" name="enabled" value="yes" ${settings?.enabled ? "checked" : ""}><span><strong>Enable Sunday Hub</strong><small>The Hub appears automatically on Sundays in the member's local time.</small></span></label><div class="field mt-18"><label>Welcome message</label><input class="input" name="welcome" maxlength="160" value="${esc(settings?.welcome || "Welcome to church.")}"></div><div class="grid grid-2"><div class="field"><label>First gathering</label><input class="input" name="service1Name" maxlength="80" value="${esc(settings?.service1Name || "Bible Study")}"></div><div class="field"><label>Time</label><input class="input" name="service1Time" maxlength="30" value="${esc(settings?.service1Time || "9:00 AM")}"></div></div><div class="grid grid-2"><div class="field"><label>Second gathering</label><input class="input" name="service2Name" maxlength="80" value="${esc(settings?.service2Name || "Worship")}"></div><div class="field"><label>Time</label><input class="input" name="service2Time" maxlength="30" value="${esc(settings?.service2Time || "10:15 AM")}"></div></div><div class="field"><label>Today's message</label><input class="input" name="sermonTitle" maxlength="160" value="${esc(settings?.sermonTitle || "")}" placeholder="Sermon title"></div><div class="field"><label>Scripture</label><input class="input" name="sermonScripture" maxlength="120" value="${esc(settings?.sermonScripture || "")}" placeholder="e.g. Colossians 3:1–17"></div><div class="field"><label>Bulletin link <span class="muted">(optional)</span></label><input class="input" name="bulletinUrl" maxlength="500" value="${esc(settings?.bulletinUrl || "")}"></div><div class="field"><label>Sermon notes link <span class="muted">(optional)</span></label><input class="input" name="notesUrl" maxlength="500" value="${esc(settings?.notesUrl || "")}"></div><div class="field"><label>Connect / visitor link <span class="muted">(optional)</span></label><input class="input" name="connectUrl" maxlength="500" value="${esc(settings?.connectUrl || "")}"></div><button class="btn btn-primary" type="submit">Save Sunday Hub</button></form></section><section class="card sunday-preview-card"><div class="card-head"><div><h3>Preview</h3><p>This is how the Sunday Hub will feel on Home.</p></div></div>${sundayCard(settings || { enabled: true, welcome: "Welcome to church.", service1Name: "Bible Study", service1Time: "9:00 AM", service2Name: "Worship", service2Time: "10:15 AM" }, c.church.name, true)}</section></div>`;
  root.querySelector("#sunday-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); const form = new FormData(event.currentTarget); busy(button, true, "Saving…"); try { await saveSundayHub(c.churchId, c.user, { ...Object.fromEntries(form), enabled: form.get("enabled") === "yes" }); options.toast("Sunday Hub saved", "The Sunday experience is ready.", "success"); await mountSundaySettings(root, options); } catch (error) { options.toast("Could not save Sunday Hub", error.message, "error"); busy(button, false); } });
}

function sundayCard(settings, churchName, preview = false) {
  const link = (url, label) => url ? `<a class="btn btn-secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : "";
  return `<div class="sunday-hub-card ${preview ? "preview" : ""}"><div class="sunday-glow"></div><div class="eyebrow">Sunday at ${esc(churchName)}</div><h2>${esc(settings.welcome || "Welcome to church.")}</h2><div class="sunday-services">${settings.service1Name ? `<div><strong>${esc(settings.service1Name)}</strong><span>${esc(settings.service1Time || "")}</span></div>` : ""}${settings.service2Name ? `<div><strong>${esc(settings.service2Name)}</strong><span>${esc(settings.service2Time || "")}</span></div>` : ""}</div>${settings.sermonTitle ? `<div class="sunday-message"><small>Today's message</small><strong>${esc(settings.sermonTitle)}</strong>${settings.sermonScripture ? `<span>${esc(settings.sermonScripture)}</span>` : ""}</div>` : ""}<div class="sunday-actions">${link(settings.bulletinUrl, "Bulletin")}${link(settings.notesUrl, "Sermon notes")}${link(settings.connectUrl, "Connect")}</div></div>`;
}

export async function mountSundayHome(options) {
  const existing = document.querySelector("#sunday-hub-home");
  if (existing?.dataset.ready === "true") return;
  const settings = await getSundayHub(options.state.activeChurchId).catch(() => null);
  if (!settings?.enabled || new Date().getDay() !== 0) {
    existing?.remove();
    return;
  }
  let host = existing;
  if (!host) {
    host = document.createElement("section");
    host.id = "sunday-hub-home";
    host.className = "sunday-home mt-28";
    const community = document.querySelector("#home-community");
    const hero = document.querySelector("#route-view .hero-card");
    if (community) community.insertAdjacentElement("beforebegin", host);
    else if (hero) hero.insertAdjacentElement("afterend", host);
  }
  if (!host) return;
  host.innerHTML = sundayCard(settings, options.state.context.church.name);
  host.dataset.ready = "true";
}

export function decorateReportActions(options) {
  const c = context(options);
  document.querySelectorAll("[data-post-card]").forEach((card) => {
    if (card.querySelector("[data-phase3-report]")) return;
    const actions = card.querySelector(".post-actions");
    if (!actions) return;
    const button = document.createElement("button");
    button.className = "post-action report-action";
    button.dataset.phase3Report = "chatter";
    button.dataset.targetId = card.dataset.postCard;
    button.textContent = "! Report";
    button.addEventListener("click", () => openReport(c, options, "chatter", card.dataset.postCard, card.querySelector(".post-body")?.textContent || ""));
    actions.appendChild(button);
  });
  document.querySelectorAll(".prayer-card").forEach((card) => {
    if (card.querySelector("[data-phase3-report]")) return;
    const prayed = card.querySelector("[data-prayed]");
    const actions = card.querySelector(".post-actions");
    if (!prayed || !actions) return;
    const button = document.createElement("button");
    button.className = "post-action report-action";
    button.dataset.phase3Report = "prayer";
    button.textContent = "! Report";
    button.addEventListener("click", () => openReport(c, options, "prayer", prayed.dataset.prayed, card.querySelector(".prayer-body")?.textContent || ""));
    actions.appendChild(button);
  });
}

function openReport(c, options, targetType, targetId, excerpt) {
  const node = modal(`<div class="modal-head"><div><div class="eyebrow">Community safety</div><h2>Report content</h2><p>This report goes only to authorized church moderators.</p></div><button class="icon-btn" data-phase3-close>×</button></div><form id="report-form"><div class="modal-body"><div class="field"><label>Reason</label><select class="input" name="reason"><option value="inappropriate">Inappropriate content</option><option value="harassment">Harassment or harmful behavior</option><option value="privacy">Privacy concern</option><option value="spam">Spam</option><option value="other">Other</option></select></div><div class="field"><label>Anything moderators should know? <span class="muted">(optional)</span></label><textarea class="textarea" name="details" maxlength="1200"></textarea></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-phase3-close>Cancel</button><button class="btn btn-primary" type="submit">Send report</button></div></form>`);
  node.querySelector("#report-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); const form = new FormData(event.currentTarget); busy(button, true, "Sending…"); try { await createReport(c.churchId, c.user, { targetType, targetId, excerpt, reason: form.get("reason"), details: form.get("details") }); closeModal(); options.toast("Report sent", "Authorized church moderators can review it now.", "success"); } catch (error) { options.toast("Could not send report", error.message, "error"); busy(button, false); } });
}
