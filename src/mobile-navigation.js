const PRIMARY_ROUTES = [
  { route: "home", label: "Home", icon: "home" },
  { route: "chatter", label: "Chatter", icon: "chatter" },
  { route: "prayer", label: "Prayer", icon: "heart" },
  { route: "gather", label: "Gather", icon: "calendar" }
];

const MORE_ROUTES = new Set(["groups", "serve", "activity", "church", "resources", "people", "roles", "admin", "profile"]);
let sheetOpen = false;
let scheduled = false;
let lastRoute = "";

function route() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function go(nextRoute) {
  closeSheet();
  window.location.hash = `#/${nextRoute}`;
}

function svg(name) {
  const paths = {
    home: '<path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.6V21h13V9.6"/><path d="M9.5 21v-6h5v6"/>',
    chatter: '<path d="M20 14a4 4 0 0 1-4 4H9l-5 3v-7a7 7 0 0 1 7-7h5a4 4 0 0 1 4 4Z"/><path d="M9 11h7M9 14h4"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    groups: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M14 15.5a4.5 4.5 0 0 1 6.5 4"/>',
    serve: '<path d="M12 21s-7-4.4-7-10.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 16.6 12 21 12 21Z"/><path d="M8.5 12.5 11 15l4.5-5"/>',
    activity: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/>',
    church: '<path d="M12 2v5M9.5 4.5h5"/><path d="M5 22V10l7-4 7 4v12"/><path d="M9 22v-5h6v5M3 22h18"/>',
    resource: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h8"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 7.5a2.5 2.5 0 0 1 0 5M17 15a4 4 0 0 1 4 4"/>',
    access: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    admin: '<path d="M4 20V9l8-5 8 5v11"/><path d="M8 20v-6h8v6M2 20h20"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.more}</svg>`;
}

function primaryButton(item, current) {
  return `<button type="button" data-mobile-primary="${item.route}" class="${current === item.route ? "active" : ""}" aria-label="${item.label}"><span class="mobile-nav-icon">${svg(item.icon)}</span><span class="mobile-nav-label">${item.label}</span></button>`;
}

function routeExists(name) {
  if (["groups", "church", "people", "profile", "activity"].includes(name)) return true;
  return Boolean(document.querySelector(`.sidebar [data-route="${CSS.escape(name)}"], .topbar [data-route="${CSS.escape(name)}"]`));
}

function churchName() {
  const text = document.querySelector("#church-switcher-button strong")?.textContent || "Your church";
  return text.replace(/⌄/g, "").trim() || "Your church";
}

function accountInfo() {
  const profile = document.querySelector(".sidebar-profile");
  return {
    name: profile?.querySelector("strong")?.textContent?.trim() || "Church Chatter Member",
    email: profile?.querySelector(".meta span")?.textContent?.trim() || "",
    initials: document.querySelector('.topbar-actions [data-route="profile"]')?.textContent?.trim() || "CC"
  };
}

function item(routeName, label, detail, icon, current) {
  return `<button type="button" class="mobile-more-item ${current === routeName ? "active" : ""}" data-mobile-sheet-route="${routeName}"><span class="mobile-more-item-icon">${svg(icon)}</span><span class="mobile-more-item-copy"><strong>${label}</strong><small>${detail}</small></span></button>`;
}

function ensureSheet() {
  let backdrop = document.querySelector("#mobile-more-backdrop");
  let sheet = document.querySelector("#mobile-more-sheet");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "mobile-more-backdrop";
    backdrop.className = "mobile-more-backdrop";
    backdrop.addEventListener("click", closeSheet);
    document.body.appendChild(backdrop);
  }
  if (!sheet) {
    sheet = document.createElement("aside");
    sheet.id = "mobile-more-sheet";
    sheet.className = "mobile-more-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "More Church Chatter navigation");
    document.body.appendChild(sheet);
  }
  return { backdrop, sheet };
}

function renderSheet() {
  const { sheet } = ensureSheet();
  const current = route();
  const account = accountInfo();
  const communityItems = [
    item("groups", "Groups", "Ministries & smaller communities", "groups", current),
    routeExists("serve") ? item("serve", "Serve", "Volunteer & help your church", "serve", current) : "",
    item("activity", "Activity", "Recent updates around church", "activity", current)
  ].join("");

  const churchItems = [
    item("church", "Church", "Profile, beliefs & information", "church", current),
    routeExists("resources") ? item("resources", "Resources", "Sermons, studies & useful links", "resource", current) : "",
    item("people", "People", "Your congregation directory", "people", current),
    routeExists("roles") ? item("roles", "Access & roles", "Church permissions", "access", current) : "",
    routeExists("admin") ? item("admin", "Church Admin", "Leadership tools & settings", "admin", current) : ""
  ].join("");

  sheet.innerHTML = `<div class="mobile-more-handle"></div><div class="mobile-more-head"><div><small>More from</small><strong>${esc(churchName())}</strong></div><button type="button" class="mobile-more-close" data-mobile-close aria-label="Close navigation">×</button></div><section class="mobile-more-section"><div class="mobile-more-label">Community</div><div class="mobile-more-grid">${communityItems}</div></section><section class="mobile-more-section"><div class="mobile-more-label">Your church</div><div class="mobile-more-grid">${churchItems}</div></section><div class="mobile-more-account"><div class="avatar">${esc(account.initials)}</div><div class="mobile-more-account-copy"><strong>${esc(account.name)}</strong><small>${esc(account.email)}</small></div><button type="button" data-mobile-profile>Profile</button></div>`;

  sheet.querySelector("[data-mobile-close]")?.addEventListener("click", closeSheet);
  sheet.querySelector("[data-mobile-profile]")?.addEventListener("click", () => go("profile"));
  sheet.querySelectorAll("[data-mobile-sheet-route]").forEach((button) => button.addEventListener("click", () => go(button.dataset.mobileSheetRoute)));
}

function openSheet() {
  renderSheet();
  const { backdrop, sheet } = ensureSheet();
  sheetOpen = true;
  document.body.classList.add("mobile-sheet-open");
  backdrop.classList.add("open");
  sheet.classList.add("open");
  document.querySelector(".mobile-nav [data-mobile-more]")?.classList.add("active");
  window.setTimeout(() => sheet.querySelector("[data-mobile-close]")?.focus(), 80);
}

function closeSheet() {
  sheetOpen = false;
  document.body.classList.remove("mobile-sheet-open");
  document.querySelector("#mobile-more-backdrop")?.classList.remove("open");
  document.querySelector("#mobile-more-sheet")?.classList.remove("open");
  updateActive();
}

function toggleSheet() {
  if (sheetOpen) closeSheet();
  else openSheet();
}

function renderNav() {
  const nav = document.querySelector(".mobile-nav");
  if (!nav) return;
  const current = route();
  nav.dataset.mobileNavEnhanced = "true";
  nav.innerHTML = `${PRIMARY_ROUTES.map((entry) => primaryButton(entry, current)).join("")}<button type="button" data-mobile-more class="${MORE_ROUTES.has(current) || sheetOpen ? "active" : ""}" aria-label="More"><span class="mobile-nav-icon">${svg("more")}</span><span class="mobile-nav-label">More</span></button><span hidden data-route="serve" aria-hidden="true"></span>`;
  nav.querySelectorAll("[data-mobile-primary]").forEach((button) => button.addEventListener("click", () => go(button.dataset.mobilePrimary)));
  nav.querySelector("[data-mobile-more]")?.addEventListener("click", toggleSheet);
}

function updateActive() {
  const current = route();
  const nav = document.querySelector(".mobile-nav");
  if (!nav) return;
  nav.querySelectorAll("[data-mobile-primary]").forEach((button) => button.classList.toggle("active", button.dataset.mobilePrimary === current));
  nav.querySelector("[data-mobile-more]")?.classList.toggle("active", sheetOpen || MORE_ROUTES.has(current));
  if (sheetOpen) renderSheet();
}

function enhanceSidebarMobile() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || window.innerWidth > 980) return;
  let close = sidebar.querySelector("[data-mobile-sidebar-close]");
  if (!close) {
    close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn mobile-sidebar-close";
    close.dataset.mobileSidebarClose = "true";
    close.setAttribute("aria-label", "Close navigation");
    close.textContent = "×";
    close.addEventListener("click", () => sidebar.classList.remove("open"));
    sidebar.prepend(close);
  }
}

function sync() {
  const nav = document.querySelector(".mobile-nav");
  if (!nav) return;
  if (nav.dataset.mobileNavEnhanced !== "true" || !nav.querySelector("[data-mobile-more]")) renderNav();
  else updateActive();
  enhanceSidebarMobile();

  const current = route();
  if (lastRoute && current !== lastRoute) {
    document.querySelector(".sidebar")?.classList.remove("open");
    closeSheet();
  }
  lastRoute = current;
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    sync();
  });
}

window.addEventListener("hashchange", schedule);
window.addEventListener("resize", () => {
  if (window.innerWidth > 700) closeSheet();
  schedule();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sheetOpen) closeSheet();
});

const observer = new MutationObserver(schedule);
observer.observe(document.querySelector("#app"), { childList: true, subtree: true });

schedule();
