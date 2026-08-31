import { auth } from "./firebase.js";
import { PERMISSIONS, getChurchContext, getMemberships, getUserProfile } from "./services.js";
import { communityRouteShell, destroyCommunityBindings, isCommunityRoute, mountCommunityHome, mountCommunityRoute } from "./community.js";

let scheduled = false;
let mountingKey = "";
let phaseState = null;

function hashRoute() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
}

function navigate(route) {
  window.location.hash = `#/${route}`;
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function toast(title, message = "", type = "") {
  const root = document.querySelector("#toast-root");
  if (!root) return;
  const node = document.createElement("div");
  node.className = `toast ${type}`.trim();
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}`;
  root.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
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

function options() {
  return {
    state: phaseState,
    permissions: PERMISSIONS,
    hasPermission,
    toast,
    navigate
  };
}

function unlockNavigation() {
  document.querySelectorAll('[data-route="chatter"],[data-route="prayer"],[data-route="gather"],[data-route="groups"]').forEach((button) => {
    button.classList.remove("locked");
    button.querySelector(".badge")?.remove();
  });
  document.querySelectorAll(".sidebar-card").forEach((card) => {
    if (card.textContent.includes("Phase 1")) card.innerHTML = `<strong>Phase 2 is live.</strong><p>Chatter, Prayer, Gather, Groups, announcements, and church activity are now connected.</p>`;
  });
  const topActions = document.querySelector(".topbar-actions");
  if (topActions && !topActions.querySelector("#activity-center")) {
    const button = document.createElement("button");
    button.className = "icon-btn activity-button";
    button.id = "activity-center";
    button.title = "Activity";
    button.setAttribute("aria-label", "Open activity center");
    button.textContent = "✦";
    topActions.prepend(button);
    button.addEventListener("click", () => navigate("activity"));
  }
}

function removePhaseOnePlaceholders() {
  document.querySelectorAll("#route-view .card").forEach((card) => {
    if (card.textContent.includes("Open Church Chatter") && card.textContent.includes("reserved for Phase 2")) card.remove();
  });
  document.querySelectorAll("#route-view .stat-card").forEach((card) => {
    if (card.textContent.includes("Community features") && card.textContent.includes("Next")) card.remove();
  });
}

async function enhanceHome() {
  const routeView = document.querySelector("#route-view");
  if (!routeView || !phaseState) return;
  removePhaseOnePlaceholders();
  let host = document.querySelector("#home-community");
  if (!host) {
    host = document.createElement("section");
    host.id = "home-community";
    host.className = "phase2-home mt-28";
    const hero = routeView.querySelector(".hero-card");
    if (hero) hero.insertAdjacentElement("afterend", host);
    else routeView.querySelector(".page")?.prepend(host);
  }
  const hero = routeView.querySelector(".hero-card");
  if (hero) {
    const paragraph = hero.querySelector("p");
    if (paragraph?.textContent.includes("membership, church identity")) paragraph.textContent = "Your church community is alive here all week — conversations, prayer, gatherings, groups, and the updates that keep everyone connected.";
  }
  await mountCommunityHome(options());
  host.dataset.phase2Ready = "true";
}

async function mountRoute() {
  const rawRoute = hashRoute();
  unlockNavigation();
  if (!auth.currentUser) return;

  const existingView = document.querySelector("#route-view");
  if (isCommunityRoute(rawRoute) && existingView?.dataset.phase2Route === rawRoute && mountingKey) return;
  if (rawRoute === "home" && document.querySelector("#home-community")?.dataset.phase2Ready === "true") return;

  phaseState = await loadState();
  if (!phaseState?.context?.church) return;
  phaseState.route = rawRoute;

  if (isCommunityRoute(rawRoute)) {
    const view = document.querySelector("#route-view");
    if (!view) return;
    if (view.dataset.phase2Route !== rawRoute) {
      destroyCommunityBindings();
      view.dataset.phase2Route = rawRoute;
      view.dataset.phase2Mount = String(Date.now());
      view.innerHTML = communityRouteShell(rawRoute);
    }
    const currentKey = `${phaseState.activeChurchId}:${rawRoute}:${view.dataset.phase2Mount}`;
    if (mountingKey !== currentKey) {
      mountingKey = currentKey;
      await mountCommunityRoute(options());
    }
    return;
  }

  mountingKey = "";
  destroyCommunityBindings();
  document.querySelector("#route-view")?.removeAttribute("data-phase2-route");
  if (rawRoute === "home") await enhanceHome();
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(async () => {
    scheduled = false;
    try { await mountRoute(); } catch (error) { console.error("Church Chatter Phase 2", error); }
  });
}

document.addEventListener("click", (event) => {
  const routeButton = event.target.closest("[data-route]");
  const route = routeButton?.dataset.route;
  if (route && ["chatter", "prayer", "gather", "groups"].includes(route)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate(route);
  }
}, true);

window.addEventListener("hashchange", () => {
  mountingKey = "";
  scheduleEnhance();
});

const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.querySelector("#app"), { childList: true, subtree: true });

window.addEventListener("church-chatter-phase2-refresh", () => {
  mountingKey = "";
  document.querySelector("#home-community")?.removeAttribute("data-phase2-ready");
  scheduleEnhance();
});

scheduleEnhance();
