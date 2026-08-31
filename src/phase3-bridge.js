import { auth } from "./firebase.js";
import { PERMISSIONS, getChurchContext, getMemberships, getUserProfile } from "./services.js";
import {
  decorateReportActions,
  destroyPhase3Bindings,
  isPhase3Route,
  mountPhase3Route,
  mountSundayHome,
  phase3RouteShell
} from "./phase3.js";

let scheduled = false;
let mountingKey = "";
let phaseState = null;

function hashRoute() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
}

function navigate(route) {
  window.location.hash = `#/${route}`;
}

async function loadState() {
  const user = auth.currentUser;
  if (!user) return null;
  const profile = await getUserProfile(user.uid);
  const memberships = await getMemberships(user.uid);
  if (!memberships.length) return null;
  const activeChurchId = memberships.some((item) => item.churchId === profile?.activeChurchId) ? profile.activeChurchId : memberships[0].churchId;
  const context = await getChurchContext(activeChurchId, user.uid);
  return { user, profile, memberships, activeChurchId, context, route: hashRoute() };
}

function hasPermission(permission) {
  return Boolean(phaseState?.context?.member?.effectivePermissions?.includes(permission));
}

function toast(title, message = "", type = "") {
  const root = document.querySelector("#toast-root");
  if (!root) return;
  const node = document.createElement("div");
  node.className = `toast ${type}`.trim();
  const strong = document.createElement("strong");
  strong.textContent = title;
  node.appendChild(strong);
  if (message) {
    const span = document.createElement("span");
    span.textContent = message;
    node.appendChild(span);
  }
  root.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function options() {
  return { state: phaseState, permissions: PERMISSIONS, hasPermission, toast, navigate };
}

function adminAccess() {
  return [
    PERMISSIONS.MANAGE_CHURCH,
    PERMISSIONS.MANAGE_MEMBERS,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.MANAGE_INVITES,
    PERMISSIONS.MODERATE_CONTENT,
    PERMISSIONS.CREATE_ANNOUNCEMENTS,
    PERMISSIONS.MANAGE_EVENTS,
    PERMISSIONS.MANAGE_GROUPS
  ].some(hasPermission);
}

function navButton(route, icon, label) {
  const button = document.createElement("button");
  button.className = `nav-item phase3-nav ${hashRoute() === route ? "active" : ""}`;
  button.dataset.route = route;
  button.innerHTML = `<span class="nav-icon">${icon}</span><span>${label}</span>`;
  return button;
}

function injectNavigation() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || !phaseState) return;

  const navs = sidebar.querySelectorAll("nav.nav");
  const communityNav = navs[0];
  const churchNav = navs[1];
  if (communityNav && !communityNav.querySelector('[data-route="serve"]')) communityNav.appendChild(navButton("serve", "🤝", "Serve"));
  if (churchNav && !churchNav.querySelector('[data-route="resources"]')) churchNav.appendChild(navButton("resources", "□", "Resources"));
  if (churchNav && adminAccess() && !churchNav.querySelector('[data-route="admin"]')) churchNav.appendChild(navButton("admin", "⌘", "Church Admin"));

  sidebar.querySelectorAll(".phase3-nav").forEach((button) => button.classList.toggle("active", button.dataset.route === hashRoute()));

  const phaseCard = sidebar.querySelector(".sidebar-card");
  if (phaseCard && (phaseCard.textContent.includes("Phase 2") || phaseCard.textContent.includes("Phase 1"))) {
    phaseCard.innerHTML = `<strong>Church Chatter is connected.</strong><p>Community, prayer, gatherings, serving, resources, and church administration now live together.</p>`;
  }
}

function injectMobileNavigation() {
  const mobile = document.querySelector(".mobile-nav");
  if (!mobile || mobile.querySelector('[data-route="serve"]')) return;
  const buttons = mobile.querySelectorAll("button");
  if (buttons.length >= 5) {
    const serve = document.createElement("button");
    serve.dataset.route = "serve";
    serve.innerHTML = `<span>🤝</span>Serve`;
    buttons[3]?.replaceWith(serve);
  }
  mobile.querySelectorAll("button[data-route]").forEach((button) => button.classList.toggle("active", button.dataset.route === hashRoute()));
}

async function mountRoute() {
  if (!auth.currentUser) return;
  const route = hashRoute();
  const view = document.querySelector("#route-view");

  if (isPhase3Route(route) && view?.dataset.phase3Route === route && mountingKey) return;
  if (route === "home" && document.querySelector("#sunday-hub-home")?.dataset.ready === "true") {
    if (!phaseState) phaseState = await loadState();
    if (phaseState) { injectNavigation(); injectMobileNavigation(); }
    return;
  }

  phaseState = await loadState();
  if (!phaseState?.context?.church) return;
  phaseState.route = route;
  injectNavigation();
  injectMobileNavigation();

  if (isPhase3Route(route)) {
    if (!view) return;
    if (view.dataset.phase3Route !== route) {
      destroyPhase3Bindings();
      view.dataset.phase3Route = route;
      view.dataset.phase3Mount = String(Date.now());
      view.innerHTML = phase3RouteShell(route);
    }
    const key = `${phaseState.activeChurchId}:${route}:${view.dataset.phase3Mount}`;
    if (mountingKey !== key) {
      mountingKey = key;
      await mountPhase3Route(options());
    }
    return;
  }

  mountingKey = "";
  destroyPhase3Bindings();
  view?.removeAttribute("data-phase3-route");

  if (route === "home") await mountSundayHome(options());
  if (["chatter", "prayer"].includes(route)) decorateReportActions(options());
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(async () => {
    scheduled = false;
    try { await mountRoute(); } catch (error) { console.error("Church Chatter Phase 3", error); }
  });
}

window.addEventListener("hashchange", () => {
  mountingKey = "";
  document.querySelector("#sunday-hub-home")?.removeAttribute("data-ready");
  schedule();
});

const observer = new MutationObserver(schedule);
observer.observe(document.querySelector("#app"), { childList: true, subtree: true });

window.addEventListener("church-chatter-phase3-refresh", () => {
  mountingKey = "";
  phaseState = null;
  schedule();
});

schedule();
