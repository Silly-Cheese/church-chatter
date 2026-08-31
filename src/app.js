import {
  PERMISSIONS,
  PERMISSION_LABELS,
  assignRoles,
  createChurch,
  createInvite,
  createRole,
  ensureUserProfile,
  getChurchContext,
  getInvites,
  getMemberships,
  getUserProfile,
  joinChurch,
  normalizeInviteCode,
  observeAuth,
  resetPassword,
  setActiveChurch,
  setInviteActive,
  signInEmail,
  signInGoogle,
  signOutUser,
  signUpEmail,
  updateChurchProfile,
  updateOwnProfile
} from "./services.js";

const app = document.querySelector("#app");
const toastRoot = document.querySelector("#toast-root");

const state = {
  user: null,
  profile: null,
  memberships: [],
  activeChurchId: null,
  context: null,
  route: "home",
  authMode: "signin",
  busy: false,
  switcherOpen: false,
  sidebarOpen: false
};

const futureRoutes = new Set(["chatter", "prayer", "gather", "groups"]);
const validRoutes = new Set(["home", "church", "people", "roles", "profile", ...futureRoutes]);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name = "CC") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "CC";
}

function avatar(person, sizeClass = "") {
  const name = person?.displayName || person?.name || "Member";
  if (person?.photoURL) {
    return `<img class="avatar ${sizeClass}" src="${escapeHtml(person.photoURL)}" alt="${escapeHtml(name)}" referrerpolicy="no-referrer" />`;
  }
  return `<div class="avatar ${sizeClass}" aria-label="${escapeHtml(name)}">${escapeHtml(initials(name))}</div>`;
}

function toast(title, message = "", type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`.trim();
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}`;
  toastRoot.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function friendlyError(error) {
  const code = error?.code || "";
  const known = {
    "auth/popup-closed-by-user": "The Google sign-in window was closed before sign-in finished.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow popups and try again.",
    "auth/invalid-credential": "The email or password you entered is incorrect.",
    "auth/email-already-in-use": "An account already exists with that email address.",
    "auth/weak-password": "Choose a stronger password with at least six characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts were made. Try again later."
  };
  return known[code] || error?.message?.replace(/^Firebase:\s*/i, "") || "Something went wrong. Please try again.";
}

function setBusy(button, busy, label = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = label;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.originalText || button.innerHTML;
    button.disabled = false;
  }
}

function hasPermission(permission) {
  return Boolean(state.context?.member?.effectivePermissions?.includes(permission));
}

function isOwner(member = state.context?.member) {
  return Boolean(member?.roleIds?.includes("owner"));
}

function getRole(roleId) {
  return state.context?.roles?.find((role) => role.id === roleId);
}

function roleNames(member) {
  const roles = (member?.roleIds || []).map((roleId) => getRole(roleId)?.name || roleId);
  return roles.length ? roles : ["Member"];
}

function locationText(church = state.context?.church) {
  return [church?.city, church?.region].filter(Boolean).join(", ") || "Location not added yet";
}

function routeFromHash() {
  const value = window.location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
  return validRoutes.has(value) ? value : "home";
}

function navigate(route) {
  if (futureRoutes.has(route)) {
    toast("Coming in Phase 2", `${route[0].toUpperCase()}${route.slice(1)} is already reserved in the Church Chatter navigation.`);
    return;
  }
  window.location.hash = `#/${route}`;
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
}

function showModal(content, wide = false) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal ${wide ? "modal-lg" : ""}" role="dialog" aria-modal="true">${content}</section>`;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-close-modal]")) closeModal();
  });
  document.body.appendChild(backdrop);
  backdrop.querySelector("input, textarea, select")?.focus();
}

function brandLockup(subtitle = "Connected all week") {
  return `
    <div class="brand-lockup">
      <div class="brand-mark">CC</div>
      <div><strong>Church Chatter</strong><span>${escapeHtml(subtitle)}</span></div>
    </div>`;
}

function renderAuth() {
  const signup = state.authMode === "signup";
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-hero">
        ${brandLockup("Your church. Your community.")}
        <div class="hero-copy">
          <div class="eyebrow">Built for every congregation</div>
          <h1>Your church doesn't end on Sunday.</h1>
          <p>Church Chatter gives your congregation one private place to stay connected, share life, and know what is happening throughout the week.</p>
        </div>
        <div class="hero-proof">
          <span>Denomination-neutral</span><span>Private by church</span><span>Community first</span><span>Made for mobile</span>
        </div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <div class="eyebrow">Welcome ${signup ? "to Church Chatter" : "back"}</div>
          <h2>${signup ? "Create your account" : "Sign in to your church"}</h2>
          <p>${signup ? "One account can connect you with every Church Chatter community you belong to." : "Pick up right where your church community left off."}</p>
          <button class="btn btn-google" id="google-auth"><span class="g">G</span> Continue with Google</button>
          <div class="auth-divider">or use email</div>
          <form id="email-auth-form">
            ${signup ? `<div class="field"><label for="auth-name">Your name</label><input class="input" id="auth-name" name="name" autocomplete="name" maxlength="80" required placeholder="First and last name" /></div>` : ""}
            <div class="field"><label for="auth-email">Email</label><input class="input" id="auth-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" /></div>
            <div class="field"><div class="flex justify-between items-center"><label for="auth-password">Password</label>${!signup ? `<button type="button" class="btn-link" id="reset-password">Forgot password?</button>` : ""}</div><input class="input" id="auth-password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required placeholder="${signup ? "At least 6 characters" : "Your password"}" /></div>
            <button class="btn btn-primary btn-block" type="submit">${signup ? "Create account" : "Sign in"}</button>
          </form>
          <p class="small-print">${signup ? "Already have an account?" : "New to Church Chatter?"} <button class="btn-link" id="toggle-auth">${signup ? "Sign in" : "Create an account"}</button></p>
        </div>
      </section>
    </main>`;

  document.querySelector("#google-auth")?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Opening Google…");
    try { await signInGoogle(); } catch (error) { toast("Could not sign in", friendlyError(error), "error"); setBusy(event.currentTarget, false); }
  });

  document.querySelector("#toggle-auth")?.addEventListener("click", () => {
    state.authMode = signup ? "signin" : "signup";
    renderAuth();
  });

  document.querySelector("#email-auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const data = new FormData(event.currentTarget);
    setBusy(button, true, signup ? "Creating account…" : "Signing in…");
    try {
      if (signup) {
        await signUpEmail({ name: data.get("name"), email: data.get("email"), password: data.get("password") });
      } else {
        await signInEmail(data.get("email"), data.get("password"));
      }
    } catch (error) {
      toast(signup ? "Could not create account" : "Could not sign in", friendlyError(error), "error");
      setBusy(button, false);
    }
  });

  document.querySelector("#reset-password")?.addEventListener("click", async () => {
    const email = document.querySelector("#auth-email")?.value?.trim();
    if (!email) return toast("Enter your email first", "Then choose Forgot password? again.");
    try {
      await resetPassword(email);
      toast("Reset email sent", "Check your inbox for a password reset link.", "success");
    } catch (error) {
      toast("Could not send reset email", friendlyError(error), "error");
    }
  });
}

function renderOnboarding() {
  const name = state.user?.displayName?.split(" ")[0] || "there";
  app.innerHTML = `
    <main class="onboarding">
      <div class="onboarding-top">
        ${brandLockup("Welcome aboard")}
        <button class="btn btn-secondary" id="onboarding-signout">Sign out</button>
      </div>
      <div class="onboarding-main">
        <div>
          <div class="onboarding-copy">
            <div class="eyebrow">Hi, ${escapeHtml(name)}</div>
            <h1>Let's find your church.</h1>
            <p>Church Chatter is organized around real congregations. Create your church's community or enter an invitation code from a church that is already here.</p>
          </div>
          <div class="choice-grid">
            <button class="choice-card" id="create-church-choice">
              <div class="choice-icon">＋</div>
              <h3>Create a church</h3>
              <p>Set up a new private Church Chatter community and become its first administrator.</p>
              <span class="btn btn-soft">Start a church community →</span>
            </button>
            <button class="choice-card" id="join-church-choice">
              <div class="choice-icon">↗</div>
              <h3>Join your church</h3>
              <p>Use a private invitation code from your congregation to connect your account.</p>
              <span class="btn btn-soft">Enter an invitation code →</span>
            </button>
          </div>
        </div>
      </div>
    </main>`;

  document.querySelector("#create-church-choice")?.addEventListener("click", openCreateChurchModal);
  document.querySelector("#join-church-choice")?.addEventListener("click", openJoinChurchModal);
  document.querySelector("#onboarding-signout")?.addEventListener("click", signOutUser);
}

function openCreateChurchModal() {
  showModal(`
    <div class="modal-head">
      <div><div class="eyebrow">New community</div><h2>Create your church</h2><p>You can change these details later. Church Chatter does not require or enforce a denomination.</p></div>
      <button class="icon-btn" data-close-modal aria-label="Close">×</button>
    </div>
    <form id="create-church-form">
      <div class="modal-body">
        <div class="field"><label>Church name</label><input class="input" name="name" maxlength="100" required placeholder="e.g. Riverside Community Church" /></div>
        <div class="grid grid-2">
          <div class="field"><label>City</label><input class="input" name="city" maxlength="80" placeholder="Tulsa" /></div>
          <div class="field"><label>State / region</label><input class="input" name="region" maxlength="80" placeholder="Oklahoma" /></div>
        </div>
        <div class="grid grid-2">
          <div class="field"><label>Tradition or denomination <span class="muted">(optional)</span></label><input class="input" name="tradition" maxlength="80" placeholder="Optional" /><small>Used only as church profile information.</small></div>
          <div class="field"><label>Website <span class="muted">(optional)</span></label><input class="input" name="website" maxlength="250" placeholder="yourchurch.org" /></div>
        </div>
        <div class="field"><label>About your church <span class="muted">(optional)</span></label><textarea class="textarea" name="description" maxlength="800" placeholder="A short welcome or description of your congregation."></textarea></div>
        <div class="form-section">
          <h3>Use your church's language</h3>
          <p>These are labels only. One congregation might use Pastor and Member; another might use Priest and Parishioner.</p>
          <div class="grid grid-2">
            <div class="field"><label>Primary leadership role</label><input class="input" name="leadershipRole" maxlength="60" value="Church Owner" /></div>
            <div class="field"><label>Standard member role</label><input class="input" name="memberRole" maxlength="60" value="Member" /></div>
          </div>
        </div>
      </div>
      <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Create church</button></div>
    </form>`);

  document.querySelector("#create-church-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(button, true, "Creating your church…");
    try {
      const churchId = await createChurch(state.user, data);
      closeModal();
      toast("Your church is ready", "Welcome to your new Church Chatter community.", "success");
      await loadWorkspace(churchId);
      navigate("home");
    } catch (error) {
      toast("Could not create church", friendlyError(error), "error");
      setBusy(button, false);
    }
  });
}

function openJoinChurchModal() {
  showModal(`
    <div class="modal-head">
      <div><div class="eyebrow">Join a community</div><h2>Enter your invitation</h2><p>Church invitation codes are private and are created by that church's leadership.</p></div>
      <button class="icon-btn" data-close-modal aria-label="Close">×</button>
    </div>
    <form id="join-church-form">
      <div class="modal-body">
        <div class="field"><label>Invitation code</label><input class="input" name="code" maxlength="14" autocomplete="off" required placeholder="XXXXXXXXXX" style="text-transform:uppercase;letter-spacing:.12em;font-weight:800" /><small>Codes are not case-sensitive.</small></div>
      </div>
      <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Join church</button></div>
    </form>`);

  const input = document.querySelector("#join-church-form input[name='code']");
  input?.addEventListener("input", () => { input.value = normalizeInviteCode(input.value); });
  document.querySelector("#join-church-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const code = new FormData(event.currentTarget).get("code");
    setBusy(button, true, "Joining church…");
    try {
      const churchId = await joinChurch(state.user, code);
      closeModal();
      toast("You're in", "Your church is now connected to your account.", "success");
      await loadWorkspace(churchId);
      navigate("home");
    } catch (error) {
      toast("Could not join church", friendlyError(error), "error");
      setBusy(button, false);
    }
  });
}

async function loadWorkspace(preferredChurchId = null) {
  if (!state.user) return;
  state.profile = await getUserProfile(state.user.uid);
  state.memberships = await getMemberships(state.user.uid);

  if (!state.memberships.length) {
    state.activeChurchId = null;
    state.context = null;
    renderOnboarding();
    return;
  }

  const requested = preferredChurchId || state.profile?.activeChurchId;
  const membership = state.memberships.find((item) => item.churchId === requested) || state.memberships[0];
  state.activeChurchId = membership.churchId;
  if (state.profile?.activeChurchId !== membership.churchId) await setActiveChurch(state.user.uid, membership.churchId);
  state.context = await getChurchContext(membership.churchId, state.user.uid);
  state.route = routeFromHash();
  renderShell();
}

function navItem(route, icon, label, locked = false) {
  return `<button class="nav-item ${state.route === route ? "active" : ""} ${locked ? "locked" : ""}" data-route="${route}"><span class="nav-icon">${icon}</span><span>${label}</span>${locked ? `<span class="badge">Soon</span>` : ""}</button>`;
}

function renderShell() {
  if (!state.context?.church || !state.context?.member) return renderOnboarding();
  const church = state.context.church;
  const profile = state.profile || state.user;
  const admin = hasPermission(PERMISSIONS.MANAGE_CHURCH) || hasPermission(PERMISSIONS.MANAGE_MEMBERS) || hasPermission(PERMISSIONS.MANAGE_ROLES) || hasPermission(PERMISSIONS.MANAGE_INVITES);

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar ${state.sidebarOpen ? "open" : ""}" id="sidebar">
        ${brandLockup("Connected all week")}
        <div class="nav-label">Community</div>
        <nav class="nav">
          ${navItem("home", "⌂", "Home")}
          ${navItem("chatter", "◌", "Chatter", true)}
          ${navItem("prayer", "♡", "Prayer", true)}
          ${navItem("gather", "◇", "Gather", true)}
          ${navItem("groups", "◎", "Groups", true)}
        </nav>
        <div class="nav-label">Your church</div>
        <nav class="nav">
          ${navItem("church", "⌑", "Church")}
          ${navItem("people", "♙", "People")}
          ${admin ? navItem("roles", "⚙", "Access & roles") : ""}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-card"><strong>Phase 1 is live.</strong><p>The foundation is ready. Chatter, Prayer, Gather, and Groups arrive in Phase 2.</p></div>
        <div class="sidebar-profile">
          ${avatar(profile)}
          <div class="meta"><strong>${escapeHtml(profile.displayName || "Member")}</strong><span>${escapeHtml(profile.email || "")}</span></div>
          <button class="icon-btn" data-route="profile" aria-label="Profile settings">⋯</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="topbar-left">
            <button class="icon-btn mobile-menu" id="mobile-menu" aria-label="Open navigation">☰</button>
            <div class="church-switcher">
              <button id="church-switcher-button"><small>Current church</small><strong>${escapeHtml(church.name)}⌄</strong></button>
              ${state.switcherOpen ? renderChurchSwitcher() : ""}
            </div>
          </div>
          <div class="topbar-actions">
            <button class="btn btn-secondary labelled" id="join-another">＋ Join church</button>
            <button class="icon-btn" data-route="profile" aria-label="Account">${escapeHtml(initials(profile.displayName || "CC"))}</button>
          </div>
        </header>
        <div id="route-view">${renderRoute()}</div>
      </main>
      <nav class="mobile-nav">
        <button data-route="home" class="${state.route === "home" ? "active" : ""}"><span>⌂</span>Home</button>
        <button data-route="chatter"><span>◌</span>Chatter</button>
        <button data-route="prayer"><span>♡</span>Prayer</button>
        <button data-route="gather"><span>◇</span>Gather</button>
        <button data-route="church" class="${state.route === "church" ? "active" : ""}"><span>⌑</span>Church</button>
      </nav>
    </div>`;

  bindShellEvents();
  bindRouteEvents();
}

function renderChurchSwitcher() {
  return `<div class="popover" id="church-switcher-popover">
    ${state.memberships.map((membership) => `
      <button class="popover-item ${membership.churchId === state.activeChurchId ? "active" : ""}" data-switch-church="${escapeHtml(membership.churchId)}">
        <div class="avatar">${escapeHtml(initials(membership.churchName))}</div>
        <div><strong>${escapeHtml(membership.churchName)}</strong><small>${membership.churchId === state.activeChurchId ? "Current church" : "Switch community"}</small></div>
      </button>`).join("")}
    <div class="popover-divider"></div>
    <button class="popover-item" id="switcher-join"><div class="avatar">＋</div><div><strong>Join another church</strong><small>Enter an invitation code</small></div></button>
    <button class="popover-item" id="switcher-create"><div class="avatar">✦</div><div><strong>Create a church</strong><small>Start another community</small></div></button>
  </div>`;
}

function bindShellEvents() {
  document.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.route)));
  document.querySelector("#mobile-menu")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    document.querySelector("#sidebar")?.classList.toggle("open", state.sidebarOpen);
  });
  document.querySelector("#church-switcher-button")?.addEventListener("click", () => {
    state.switcherOpen = !state.switcherOpen;
    renderShell();
  });
  document.querySelector("#join-another")?.addEventListener("click", openJoinChurchModal);
  document.querySelector("#switcher-join")?.addEventListener("click", openJoinChurchModal);
  document.querySelector("#switcher-create")?.addEventListener("click", openCreateChurchModal);
  document.querySelectorAll("[data-switch-church]").forEach((button) => button.addEventListener("click", async () => {
    state.switcherOpen = false;
    await setActiveChurch(state.user.uid, button.dataset.switchChurch);
    await loadWorkspace(button.dataset.switchChurch);
    toast("Church switched", `Now viewing ${state.context.church.name}.`, "success");
  }));
}

function renderRoute() {
  switch (state.route) {
    case "church": return renderChurchPage();
    case "people": return renderPeoplePage();
    case "roles": return renderAccessPage();
    case "profile": return renderProfilePage();
    default: return renderHomePage();
  }
}

function firstName() {
  return (state.profile?.displayName || state.user?.displayName || "friend").split(" ")[0];
}

function renderHomePage() {
  const church = state.context.church;
  const members = state.context.members || [];
  const roles = state.context.roles || [];
  const admin = hasPermission(PERMISSIONS.MANAGE_INVITES);
  return `<div class="page">
    <section class="hero-card">
      <div class="eyebrow">Welcome home, ${escapeHtml(firstName())}</div>
      <h1>${escapeHtml(church.name)} is together here.</h1>
      <p>Church Chatter is ready for your congregation. Your membership, church identity, access system, and private community foundation are now connected.</p>
    </section>

    <div class="grid grid-4 mt-28">
      <div class="card stat-card"><div class="stat-icon">♙</div><strong>${members.length}</strong><span>Active ${members.length === 1 ? "member" : "members"}</span></div>
      <div class="card stat-card"><div class="stat-icon">⌘</div><strong>${roles.length}</strong><span>Church roles</span></div>
      <div class="card stat-card"><div class="stat-icon">⌑</div><strong>1</strong><span>Connected church</span></div>
      <div class="card stat-card"><div class="stat-icon">✦</div><strong>Next</strong><span>Community features</span></div>
    </div>

    <div class="grid grid-2 mt-28">
      <section class="card">
        <div class="card-head"><div><h3>Church snapshot</h3><p>The identity your members will see.</p></div><button class="btn btn-secondary" data-route="church">View church</button></div>
        <div class="list">
          <div class="list-row"><div class="avatar">⌖</div><div class="grow"><strong>${escapeHtml(locationText(church))}</strong><small>Church location</small></div></div>
          <div class="list-row"><div class="avatar">◇</div><div class="grow"><strong>${escapeHtml(church.tradition || "No denomination specified")}</strong><small>Tradition is optional and never changes features</small></div></div>
          <div class="list-row"><div class="avatar">♙</div><div class="grow"><strong>${escapeHtml(roleNames(state.context.member).join(" · "))}</strong><small>Your access in this church</small></div></div>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div><h3>Open Church Chatter</h3><p>Everything below is reserved for Phase 2.</p></div></div>
        <div class="list">
          <div class="list-row"><div class="avatar">◌</div><div class="grow"><strong>Chatter</strong><small>Conversations, rooms, comments, and community updates</small></div><span class="pill">Next</span></div>
          <div class="list-row"><div class="avatar">♡</div><div class="grow"><strong>Prayer</strong><small>Prayer requests, I Prayed, and answered prayer</small></div><span class="pill">Next</span></div>
          <div class="list-row"><div class="avatar">◇</div><div class="grow"><strong>Gather</strong><small>Events, services, and RSVPs</small></div><span class="pill">Next</span></div>
          <div class="list-row"><div class="avatar">◎</div><div class="grow"><strong>Groups</strong><small>Ministries and smaller church communities</small></div><span class="pill">Next</span></div>
        </div>
      </section>
    </div>

    ${admin ? `<section class="card mt-28"><div class="card-head"><div><h3>Bring your church in</h3><p>Create a private code to invite your congregation.</p></div><button class="btn btn-primary" id="quick-invite">Create invitation</button></div><p class="muted mb-0">Invitation codes are high-entropy, can be revoked, and are not publicly listable from Firestore.</p></section>` : ""}
  </div>`;
}

function renderChurchPage() {
  const church = state.context.church;
  const canEdit = hasPermission(PERMISSIONS.MANAGE_CHURCH);
  return `<div class="page">
    <div class="page-head"><div><div class="eyebrow">Your congregation</div><h1>${escapeHtml(church.name)}</h1><p>${escapeHtml(church.description || "Your church has not added an About description yet.")}</p></div>${canEdit ? `<button class="btn btn-primary" id="edit-church">Edit church profile</button>` : ""}</div>
    <div class="grid grid-3">
      <div class="card"><div class="card-head"><div><h3>Location</h3><p>Where your church gathers.</p></div></div><strong>${escapeHtml(locationText(church))}</strong></div>
      <div class="card"><div class="card-head"><div><h3>Tradition</h3><p>Optional church identity.</p></div></div><strong>${escapeHtml(church.tradition || "Not specified")}</strong></div>
      <div class="card"><div class="card-head"><div><h3>Website</h3><p>Your public church site.</p></div></div>${church.website ? `<a href="${escapeHtml(church.website)}" target="_blank" rel="noopener"><strong>${escapeHtml(church.website.replace(/^https?:\/\//, ""))}</strong></a>` : `<strong>Not added</strong>`}</div>
    </div>
    <div class="grid grid-2 mt-28">
      <section class="card"><div class="card-head"><div><h3>Leadership & roles</h3><p>Your church chooses the words that fit.</p></div>${hasPermission(PERMISSIONS.MANAGE_ROLES) ? `<button class="btn btn-secondary" data-route="roles">Manage</button>` : ""}</div><div class="list">${state.context.roles.map((role) => `<div class="list-row"><div class="avatar">${escapeHtml(initials(role.name))}</div><div class="grow"><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || `${role.permissions?.length || 0} permissions`)}</small></div>${role.system ? `<span class="pill owner">Core</span>` : ""}</div>`).join("")}</div></section>
      <section class="card"><div class="card-head"><div><h3>Community principles</h3><p>How Church Chatter treats church identity.</p></div></div><div class="list"><div class="list-row"><div class="avatar">1</div><div class="grow"><strong>Your church defines its language</strong><small>Roles are customizable instead of hard-coded by denomination.</small></div></div><div class="list-row"><div class="avatar">2</div><div class="grow"><strong>Your church defines its teaching</strong><small>Church Chatter provides tools, not denominational doctrine.</small></div></div><div class="list-row"><div class="avatar">3</div><div class="grow"><strong>Your community stays private</strong><small>Membership controls access to congregation content.</small></div></div></div></section>
    </div>
  </div>`;
}

function renderPeoplePage() {
  const members = state.context.members || [];
  const canManage = hasPermission(PERMISSIONS.MANAGE_ROLES) || hasPermission(PERMISSIONS.MANAGE_MEMBERS);
  return `<div class="page">
    <div class="page-head"><div><div class="eyebrow">Member directory</div><h1>People</h1><p>The people connected to ${escapeHtml(state.context.church.name)}. Member access is kept inside this church community.</p></div>${hasPermission(PERMISSIONS.MANAGE_INVITES) ? `<button class="btn btn-primary" id="people-invite">Invite people</button>` : ""}</div>
    <section class="card">
      <div class="card-head"><div><h3>${members.length} active ${members.length === 1 ? "member" : "members"}</h3><p>Profiles shown here come from verified Church Chatter accounts.</p></div></div>
      <div class="list">${members.map((member) => `<div class="list-row">${avatar(member)}<div class="grow"><strong>${escapeHtml(member.displayName || "Member")}${member.uid === state.user.uid ? " · You" : ""}</strong><small>${escapeHtml(member.email || "No email shown")}</small></div><div class="flex gap-8 wrap">${roleNames(member).map((name) => `<span class="pill ${member.roleIds?.includes("owner") ? "owner" : ""}">${escapeHtml(name)}</span>`).join("")}</div>${canManage && !member.roleIds?.includes("owner") ? `<button class="icon-btn" data-edit-member="${escapeHtml(member.uid)}" aria-label="Edit member roles">⋯</button>` : ""}</div>`).join("")}</div>
    </section>
  </div>`;
}

function renderAccessPage() {
  if (!(hasPermission(PERMISSIONS.MANAGE_ROLES) || hasPermission(PERMISSIONS.MANAGE_INVITES) || hasPermission(PERMISSIONS.MANAGE_MEMBERS))) {
    return `<div class="page"><div class="empty"><div class="empty-icon">⌁</div><h3>This area is restricted</h3><p>Your current role does not include church access administration.</p><button class="btn btn-secondary" data-route="home">Return home</button></div></div>`;
  }
  return `<div class="page">
    <div class="page-head"><div><div class="eyebrow">Church administration</div><h1>Access & roles</h1><p>Control how people enter your church and what each role is allowed to do. Titles are fully customizable.</p></div></div>
    <div class="settings-layout">
      <aside class="settings-nav"><button class="active" data-access-tab="roles">Roles</button><button data-access-tab="invites">Invitations</button><button data-access-tab="security">Security model</button></aside>
      <section id="access-content">${renderRolesPanel()}</section>
    </div>
  </div>`;
}

function renderRolesPanel() {
  const canManage = hasPermission(PERMISSIONS.MANAGE_ROLES);
  return `<section class="card">
    <div class="card-head"><div><h3>Church roles</h3><p>Use titles that match your congregation's own structure.</p></div>${canManage ? `<button class="btn btn-primary" id="create-role">＋ New role</button>` : ""}</div>
    <div class="list">${state.context.roles.map((role) => `<div class="list-row"><div class="avatar">${escapeHtml(initials(role.name))}</div><div class="grow"><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || "No description")}</small></div><span class="pill">${role.permissions?.length || 0} permissions</span>${role.system ? `<span class="pill owner">Protected</span>` : ""}</div>`).join("")}</div>
  </section>`;
}

async function renderInvitesPanel() {
  const target = document.querySelector("#access-content");
  if (!target) return;
  if (!hasPermission(PERMISSIONS.MANAGE_INVITES)) {
    target.innerHTML = `<section class="card"><div class="empty"><div class="empty-icon">⌁</div><h3>Invitation access required</h3><p>Your role cannot create or review church invitation codes.</p></div></section>`;
    return;
  }
  target.innerHTML = `<section class="card"><div class="skeleton" style="height:120px"></div></section>`;
  try {
    const invites = await getInvites(state.activeChurchId);
    target.innerHTML = `<section class="card"><div class="card-head"><div><h3>Private invitation codes</h3><p>Codes can be shared directly with people your church wants to invite.</p></div><button class="btn btn-primary" id="create-invite">＋ Create invitation</button></div>${invites.length ? `<div class="list">${invites.map((invite) => `<div class="list-row"><div class="invite-code">${escapeHtml(invite.code)}</div><div class="grow"><strong>${invite.active ? "Active invitation" : "Revoked invitation"}</strong><small>${invite.uses || 0} of ${invite.maxUses || 25} uses${invite.expiresAt?.toDate ? ` · expires ${invite.expiresAt.toDate().toLocaleDateString()}` : ""}</small></div><span class="pill ${invite.active ? "success" : ""}">${invite.active ? "Active" : "Revoked"}</span><button class="btn btn-secondary" data-toggle-invite="${escapeHtml(invite.code)}" data-current="${invite.active ? "true" : "false"}">${invite.active ? "Revoke" : "Reactivate"}</button></div>`).join("")}</div>` : `<div class="empty"><div class="empty-icon">＋</div><h3>No invitations yet</h3><p>Create a private code when you're ready to bring your congregation into Church Chatter.</p><button class="btn btn-primary" id="empty-create-invite">Create invitation</button></div>`}</section>`;
    document.querySelector("#create-invite")?.addEventListener("click", openInviteModal);
    document.querySelector("#empty-create-invite")?.addEventListener("click", openInviteModal);
    document.querySelectorAll("[data-toggle-invite]").forEach((button) => button.addEventListener("click", async () => {
      const active = button.dataset.current === "true";
      setBusy(button, true, active ? "Revoking…" : "Reactivating…");
      try {
        await setInviteActive(state.activeChurchId, button.dataset.toggleInvite, !active);
        toast(active ? "Invitation revoked" : "Invitation reactivated", "Access settings were updated.", "success");
        await renderInvitesPanel();
      } catch (error) { toast("Could not update invitation", friendlyError(error), "error"); setBusy(button, false); }
    }));
  } catch (error) {
    target.innerHTML = `<section class="card"><div class="empty"><h3>Could not load invitations</h3><p>${escapeHtml(friendlyError(error))}</p></div></section>`;
  }
}

function renderSecurityPanel() {
  return `<section class="card"><div class="card-head"><div><h3>Phase 1 security model</h3><p>Church Chatter is designed around membership boundaries.</p></div></div><div class="list"><div class="list-row"><div class="avatar">✓</div><div class="grow"><strong>Authenticated accounts only</strong><small>Google is primary, with Firebase email/password available as a fallback.</small></div></div><div class="list-row"><div class="avatar">✓</div><div class="grow"><strong>Church-scoped data</strong><small>Firestore rules check active church membership before member data can be read.</small></div></div><div class="list-row"><div class="avatar">✓</div><div class="grow"><strong>Permission-based administration</strong><small>Administrative actions depend on effective permissions, not a hard-coded denomination or title.</small></div></div><div class="list-row"><div class="avatar">✓</div><div class="grow"><strong>Non-enumerable invitation lookup</strong><small>Global invitation codes permit exact lookups while collection listing is denied.</small></div></div></div></section>`;
}

function renderProfilePage() {
  const profile = state.profile || state.user;
  return `<div class="page">
    <div class="page-head"><div><div class="eyebrow">Your account</div><h1>Profile</h1><p>Your Church Chatter identity follows you across every church community you join.</p></div></div>
    <div class="grid grid-2">
      <section class="card"><div class="flex items-center gap-12">${avatar(profile)}<div><h3 class="mb-0">${escapeHtml(profile.displayName || "Member")}</h3><p class="muted mb-0">${escapeHtml(profile.email || "")}</p></div></div><div class="mt-28"><button class="btn btn-primary" id="edit-profile">Edit profile</button></div></section>
      <section class="card"><div class="card-head"><div><h3>Your churches</h3><p>One account, multiple communities.</p></div></div><div class="list">${state.memberships.map((membership) => `<div class="list-row"><div class="avatar">${escapeHtml(initials(membership.churchName))}</div><div class="grow"><strong>${escapeHtml(membership.churchName)}</strong><small>${membership.churchId === state.activeChurchId ? "Current church" : "Connected church"}</small></div>${membership.churchId === state.activeChurchId ? `<span class="pill success">Active</span>` : `<button class="btn btn-secondary" data-profile-switch="${escapeHtml(membership.churchId)}">Switch</button>`}</div>`).join("")}</div></section>
    </div>
    <section class="card mt-28"><div class="card-head"><div><h3>Account access</h3><p>Authentication is handled securely by Firebase Authentication.</p></div><button class="btn btn-danger" id="sign-out">Sign out</button></div><p class="muted mb-0">Google sign-in is the primary Church Chatter experience. Email and password remain available as an alternative.</p></section>
  </div>`;
}

function bindRouteEvents() {
  document.querySelectorAll("#route-view [data-route]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.route)));
  document.querySelector("#quick-invite")?.addEventListener("click", openInviteModal);
  document.querySelector("#people-invite")?.addEventListener("click", openInviteModal);
  document.querySelector("#edit-church")?.addEventListener("click", openEditChurchModal);
  document.querySelector("#edit-profile")?.addEventListener("click", openEditProfileModal);
  document.querySelector("#sign-out")?.addEventListener("click", signOutUser);
  document.querySelectorAll("[data-profile-switch]").forEach((button) => button.addEventListener("click", async () => {
    await setActiveChurch(state.user.uid, button.dataset.profileSwitch);
    await loadWorkspace(button.dataset.profileSwitch);
    navigate("home");
  }));
  document.querySelector("#create-role")?.addEventListener("click", openRoleModal);
  document.querySelectorAll("[data-edit-member]").forEach((button) => button.addEventListener("click", () => openMemberRolesModal(button.dataset.editMember)));
  document.querySelectorAll("[data-access-tab]").forEach((button) => button.addEventListener("click", async () => {
    document.querySelectorAll("[data-access-tab]").forEach((item) => item.classList.toggle("active", item === button));
    const target = document.querySelector("#access-content");
    if (button.dataset.accessTab === "roles") {
      target.innerHTML = renderRolesPanel();
      document.querySelector("#create-role")?.addEventListener("click", openRoleModal);
    } else if (button.dataset.accessTab === "invites") {
      await renderInvitesPanel();
    } else {
      target.innerHTML = renderSecurityPanel();
    }
  }));
}

function openInviteModal() {
  if (!hasPermission(PERMISSIONS.MANAGE_INVITES)) return toast("Permission required", "Your role cannot create church invitations.");
  showModal(`
    <div class="modal-head"><div><div class="eyebrow">Invite securely</div><h2>Create an invitation</h2><p>Church Chatter will create a random private code. Share it only with people you want to admit.</p></div><button class="icon-btn" data-close-modal>×</button></div>
    <form id="invite-form"><div class="modal-body"><div class="field"><label>Maximum uses</label><input class="input" name="maxUses" type="number" min="1" max="500" value="25" required /><small>You can revoke the code at any time.</small></div><div class="field"><label>Expiration date <span class="muted">(optional)</span></label><input class="input" name="expires" type="date" /></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Create code</button></div></form>`);
  document.querySelector("#invite-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const data = new FormData(event.currentTarget);
    const expiresRaw = data.get("expires");
    const expiresAt = expiresRaw ? new Date(`${expiresRaw}T23:59:59`) : null;
    setBusy(button, true, "Creating code…");
    try {
      const code = await createInvite(state.activeChurchId, state.user.uid, { maxUses: data.get("maxUses"), expiresAt });
      showModal(`<div class="modal-head"><div><div class="eyebrow">Invitation ready</div><h2>Share this code privately</h2><p>Anyone with this code can use it until the limit or expiration is reached.</p></div><button class="icon-btn" data-close-modal>×</button></div><div class="modal-body"><div class="empty"><div class="invite-code" style="font-size:1.5rem;display:inline-block">${escapeHtml(code)}</div><p class="mt-18">Invitation for <strong>${escapeHtml(state.context.church.name)}</strong></p><button class="btn btn-primary" id="copy-invite">Copy invitation code</button></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Done</button></div>`);
      document.querySelector("#copy-invite")?.addEventListener("click", async () => {
        await navigator.clipboard.writeText(code);
        toast("Copied", "Invitation code copied to your clipboard.", "success");
      });
    } catch (error) { toast("Could not create invitation", friendlyError(error), "error"); setBusy(button, false); }
  });
}

function openRoleModal() {
  if (!hasPermission(PERMISSIONS.MANAGE_ROLES)) return;
  const permissionOptions = Object.entries(PERMISSION_LABELS).map(([key, [label, detail]]) => `<label class="check"><input type="checkbox" name="permissions" value="${escapeHtml(key)}" /><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span></label>`).join("");
  showModal(`
    <div class="modal-head"><div><div class="eyebrow">Custom church language</div><h2>Create a role</h2><p>Roles can represent any leadership, ministry, or membership structure your church uses.</p></div><button class="icon-btn" data-close-modal>×</button></div>
    <form id="role-form"><div class="modal-body"><div class="field"><label>Role name</label><input class="input" name="name" maxlength="60" required placeholder="e.g. Ministry Leader" /></div><div class="field"><label>Description</label><input class="input" name="description" maxlength="180" placeholder="What this role is for" /></div><div class="form-section"><h3>Permissions</h3><p>Choose exactly what people with this role can do.</p><div class="permission-grid">${permissionOptions}</div></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Create role</button></div></form>`, true);
  document.querySelector("#role-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const data = new FormData(event.currentTarget);
    setBusy(button, true, "Creating role…");
    try {
      await createRole(state.activeChurchId, state.user.uid, { name: data.get("name"), description: data.get("description"), permissions: data.getAll("permissions") });
      closeModal();
      state.context = await getChurchContext(state.activeChurchId, state.user.uid);
      renderShell();
      toast("Role created", "Your church's access model was updated.", "success");
    } catch (error) { toast("Could not create role", friendlyError(error), "error"); setBusy(button, false); }
  });
}

function openMemberRolesModal(uid) {
  if (!hasPermission(PERMISSIONS.MANAGE_ROLES)) return toast("Permission required", "Your role cannot change member roles.");
  const member = state.context.members.find((item) => item.uid === uid);
  if (!member || member.roleIds?.includes("owner")) return;
  const options = state.context.roles.filter((role) => role.id !== "owner").map((role) => `<label class="check"><input type="checkbox" name="roles" value="${escapeHtml(role.id)}" ${member.roleIds?.includes(role.id) ? "checked" : ""} /><span><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || `${role.permissions?.length || 0} permissions`)}</small></span></label>`).join("");
  showModal(`<div class="modal-head"><div><div class="eyebrow">Member access</div><h2>${escapeHtml(member.displayName || "Member")}</h2><p>Assign one or more roles. Effective permissions are recalculated automatically.</p></div><button class="icon-btn" data-close-modal>×</button></div><form id="member-role-form"><div class="modal-body"><div class="permission-grid">${options}</div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save roles</button></div></form>`, true);
  document.querySelector("#member-role-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const data = new FormData(event.currentTarget);
    setBusy(button, true, "Saving access…");
    try {
      await assignRoles(state.activeChurchId, uid, data.getAll("roles"));
      closeModal();
      state.context = await getChurchContext(state.activeChurchId, state.user.uid);
      renderShell();
      toast("Member access updated", "New role permissions are now active.", "success");
    } catch (error) { toast("Could not update member", friendlyError(error), "error"); setBusy(button, false); }
  });
}

function openEditChurchModal() {
  const church = state.context.church;
  if (!hasPermission(PERMISSIONS.MANAGE_CHURCH)) return;
  showModal(`<div class="modal-head"><div><div class="eyebrow">Church identity</div><h2>Edit church profile</h2><p>These details are shown to members of your church.</p></div><button class="icon-btn" data-close-modal>×</button></div><form id="edit-church-form"><div class="modal-body"><div class="field"><label>Church name</label><input class="input" name="name" required maxlength="100" value="${escapeHtml(church.name)}" /></div><div class="grid grid-2"><div class="field"><label>City</label><input class="input" name="city" maxlength="80" value="${escapeHtml(church.city || "")}" /></div><div class="field"><label>State / region</label><input class="input" name="region" maxlength="80" value="${escapeHtml(church.region || "")}" /></div></div><div class="grid grid-2"><div class="field"><label>Tradition / denomination</label><input class="input" name="tradition" maxlength="80" value="${escapeHtml(church.tradition || "")}" /></div><div class="field"><label>Website</label><input class="input" name="website" maxlength="250" value="${escapeHtml(church.website || "")}" /></div></div><div class="field"><label>About</label><textarea class="textarea" name="description" maxlength="800">${escapeHtml(church.description || "")}</textarea></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form>`);
  document.querySelector("#edit-church-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(button, true, "Saving…");
    try {
      await updateChurchProfile(state.activeChurchId, data);
      closeModal();
      state.context = await getChurchContext(state.activeChurchId, state.user.uid);
      state.memberships = await getMemberships(state.user.uid);
      renderShell();
      toast("Church profile updated", "Your changes are now live.", "success");
    } catch (error) { toast("Could not save church", friendlyError(error), "error"); setBusy(button, false); }
  });
}

function openEditProfileModal() {
  showModal(`<div class="modal-head"><div><div class="eyebrow">Your identity</div><h2>Edit profile</h2><p>This name appears in each church community you belong to.</p></div><button class="icon-btn" data-close-modal>×</button></div><form id="edit-profile-form"><div class="modal-body"><div class="field"><label>Display name</label><input class="input" name="displayName" maxlength="80" required value="${escapeHtml(state.profile?.displayName || state.user.displayName || "")}" /></div><div class="field"><label>Email</label><input class="input" value="${escapeHtml(state.user.email || "")}" disabled /><small>Email changes are not enabled in Phase 1.</small></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save profile</button></div></form>`);
  document.querySelector("#edit-profile-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const name = new FormData(event.currentTarget).get("displayName");
    setBusy(button, true, "Saving…");
    try {
      await updateOwnProfile(state.user, state.memberships, name);
      closeModal();
      await ensureUserProfile(state.user);
      await loadWorkspace(state.activeChurchId);
      toast("Profile updated", "Your display name is now current across your churches.", "success");
    } catch (error) { toast("Could not save profile", friendlyError(error), "error"); setBusy(button, false); }
  });
}

window.addEventListener("hashchange", () => {
  state.route = routeFromHash();
  if (state.user && state.context) renderShell();
});

observeAuth(async (user) => {
  state.user = user;
  state.switcherOpen = false;
  state.sidebarOpen = false;
  if (!user) {
    state.profile = null;
    state.memberships = [];
    state.context = null;
    renderAuth();
    return;
  }

  app.innerHTML = `<div class="boot-screen"><div class="brand-mark">CC</div><div><strong>Church Chatter</strong><p>Opening your community…</p></div></div>`;
  try {
    await ensureUserProfile(user);
    await loadWorkspace();
  } catch (error) {
    console.error(error);
    toast("Church Chatter could not open", friendlyError(error), "error");
    app.innerHTML = `<div class="onboarding"><div class="onboarding-main"><div class="empty"><div class="empty-icon">!</div><h3>We couldn't load your account</h3><p>${escapeHtml(friendlyError(error))}</p><button class="btn btn-primary" id="retry-app">Try again</button><button class="btn btn-secondary" id="error-signout" style="margin-left:8px">Sign out</button></div></div></div>`;
    document.querySelector("#retry-app")?.addEventListener("click", () => loadWorkspace());
    document.querySelector("#error-signout")?.addEventListener("click", signOutUser);
  }
});
