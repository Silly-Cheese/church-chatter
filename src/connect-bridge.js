import { auth } from "./firebase.js";
import { getChurchContext, getMemberships, getUserProfile, observeAuth, PERMISSIONS } from "./services.js";
import {
  connectRouteShell,
  decorateOnboardingDiscovery,
  isConnectRoute,
  mountConnectRoute,
  showQrJoinConfirmation
} from "./connect.js";

let scheduled = false;
let mountingKey = "";
let connectState = null;
let qrHandled = false;

function hashRoute() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
}

function navigate(route) {
  window.location.hash = `#/${route}`;
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
  window.setTimeout(() => node.remove(), 4300);
}

async function loadState() {
  const user = auth.currentUser;
  if (!user) return null;
  const [profile, memberships] = await Promise.all([
    getUserProfile(user.uid),
    getMemberships(user.uid)
  ]);

  let activeChurchId = null;
  let context = null;
  if (memberships.length) {
    activeChurchId = memberships.some((item) => item.churchId === profile?.activeChurchId)
      ? profile.activeChurchId
      : memberships[0].churchId;
    context = await getChurchContext(activeChurchId, user.uid);
  }

  return { user, profile, memberships, activeChurchId, context, route: hashRoute() };
}

function hasPermission(permission) {
  return Boolean(connectState?.context?.member?.effectivePermissions?.includes(permission));
}

function canNetwork() {
  return hasPermission(PERMISSIONS.MANAGE_CHURCH) || hasPermission(PERMISSIONS.COMMUNICATE_CHURCH_NETWORK);
}

function options() {
  return { state: connectState, permissions: PERMISSIONS, hasPermission, toast, navigate };
}

function navButton(route, icon, label) {
  const button = document.createElement("button");
  button.className = `nav-item connect-nav ${hashRoute() === route ? "active" : ""}`;
  button.dataset.route = route;
  button.innerHTML = `<span class="nav-icon">${icon}</span><span>${label}</span>`;
  button.addEventListener("click", (event) => { event.preventDefault(); navigate(route); });
  return button;
}

function injectNavigation() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || !connectState?.memberships?.length) return;
  const navs = sidebar.querySelectorAll("nav.nav");
  const communityNav = navs[0];
  const churchNav = navs[1];

  if (communityNav && !communityNav.querySelector('[data-route="discover"]')) {
    communityNav.appendChild(navButton("discover", "⌕", "Find a Church"));
  }
  if (churchNav && canNetwork() && !churchNav.querySelector('[data-route="network"]')) {
    churchNav.appendChild(navButton("network", "↔", "Church Network"));
  }

  sidebar.querySelectorAll(".connect-nav").forEach((button) => {
    button.classList.toggle("active", button.dataset.route === hashRoute());
  });
}

function clearJoinParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("join")) return;
  url.searchParams.delete("join");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function processQrJoin() {
  if (qrHandled || !auth.currentUser || !connectState) return;
  const url = new URL(window.location.href);
  const code = String(url.searchParams.get("join") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
  if (!code) return;
  qrHandled = true;

  try {
    const joined = await showQrJoinConfirmation(code, options());
    clearJoinParam();
    if (joined) {
      toast("Congregation joined", "Church Chatter is refreshing your church list.", "success");
      window.setTimeout(() => window.location.reload(), 500);
    }
  } catch (error) {
    clearJoinParam();
    toast("QR invitation could not be used", error?.message || "Ask the congregation for a new QR code.", "error");
  }
}

async function mount() {
  if (!auth.currentUser) return;
  connectState = await loadState();
  if (!connectState) return;

  injectNavigation();
  decorateOnboardingDiscovery(options());
  await processQrJoin();

  const route = hashRoute();
  if (!isConnectRoute(route)) {
    mountingKey = "";
    return;
  }

  if (!connectState.memberships.length) return;

  if (route === "network" && !canNetwork()) {
    toast("Church Network is restricted", "Your role cannot communicate on behalf of this congregation.", "error");
    navigate("home");
    return;
  }

  const view = document.querySelector("#route-view");
  if (!view) return;
  const key = `${connectState.activeChurchId}:${route}`;
  if (mountingKey === key && view.dataset.connectRoute === route) return;

  mountingKey = key;
  connectState.route = route;
  view.dataset.connectRoute = route;
  view.innerHTML = connectRouteShell(route);
  await mountConnectRoute(options());
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(async () => {
    scheduled = false;
    try { await mount(); } catch (error) { console.error("Church Chatter Connect", error); }
  });
}

window.addEventListener("hashchange", () => {
  mountingKey = "";
  schedule();
});

window.addEventListener("church-chatter-phase3-refresh", () => {
  mountingKey = "";
  connectState = null;
  schedule();
});

const observer = new MutationObserver(schedule);
observer.observe(document.querySelector("#app"), { childList: true, subtree: true });

observeAuth(() => {
  connectState = null;
  qrHandled = false;
  mountingKey = "";
  schedule();
});

schedule();
