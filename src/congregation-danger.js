import { auth } from "./firebase.js";
import { getChurch, getUserProfile } from "./services.js";
import { deleteCongregation } from "./congregation-delete.js";

let scheduled = false;
let state = null;

function route() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
}

function esc(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function loadState() {
  const user = auth.currentUser;
  if (!user) return null;
  const profile = await getUserProfile(user.uid);
  if (!profile?.activeChurchId) return null;
  const church = await getChurch(profile.activeChurchId);
  if (!church || church.createdBy !== user.uid) return null;
  return { user, churchId: profile.activeChurchId, church };
}

function injectTab() {
  if (route() !== "admin" || !state) return;
  const tabs = document.querySelector(".admin-tabs");
  if (!tabs || tabs.querySelector('[data-congregation-danger-tab]')) return;

  const button = document.createElement("button");
  button.dataset.congregationDangerTab = "true";
  button.className = "danger-tab";
  button.textContent = "Danger Zone";
  tabs.appendChild(button);

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    tabs.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    renderDangerZone();
  });
}

function renderDangerZone() {
  const root = document.querySelector("#admin-content");
  if (!root || !state) return;
  const name = state.church.name || "this congregation";

  root.innerHTML = `
    <section class="danger-zone-card">
      <div class="danger-zone-icon" aria-hidden="true">!</div>
      <div class="danger-zone-copy">
        <div class="eyebrow danger-eyebrow">Creator controls</div>
        <h2>Delete this congregation</h2>
        <p>This option is visible only to the account that originally created <strong>${esc(name)}</strong>. Deleting the congregation permanently removes its Church Chatter data and cannot be undone.</p>
      </div>
    </section>

    <section class="card deletion-impact-card">
      <div class="card-head"><div><h3>What will be deleted</h3><p>Church Chatter will remove the congregation and all data stored inside it.</p></div></div>
      <div class="deletion-grid">
        <div><span>✓</span><strong>Members & roles</strong><small>Membership records, roles, and church access links.</small></div>
        <div><span>✓</span><strong>Chatter</strong><small>Posts, comments, reactions, rooms, and activity.</small></div>
        <div><span>✓</span><strong>Prayer</strong><small>Prayer requests, leadership prayer, and prayer acknowledgements.</small></div>
        <div><span>✓</span><strong>Gather & Groups</strong><small>Events, RSVPs, groups, group content, and group members.</small></div>
        <div><span>✓</span><strong>Serve & Resources</strong><small>Volunteer opportunities, signups, and Church Chatter resource links.</small></div>
        <div><span>✓</span><strong>Administration</strong><small>Invitations, reports, Sunday Hub settings, and congregation configuration.</small></div>
      </div>
      <div class="external-file-note"><strong>External files are not deleted.</strong> Church Chatter stores links to services such as Google Drive rather than uploading those files, so the original external documents remain where they are hosted.</div>
    </section>

    <section class="card final-delete-card">
      <div class="card-head"><div><h3>Permanent deletion</h3><p>To continue, confirm both items below.</p></div></div>
      <div class="field">
        <label>Type the congregation name exactly</label>
        <input class="input" id="delete-congregation-name" autocomplete="off" spellcheck="false" placeholder="${esc(name)}">
        <small class="muted">Enter: <strong>${esc(name)}</strong></small>
      </div>
      <label class="check compact-check deletion-check">
        <input type="checkbox" id="delete-congregation-understand">
        <span><strong>I understand this is permanent.</strong><small>There is no restore button or recycle bin after this finishes.</small></span>
      </label>
      <div id="delete-congregation-progress" class="deletion-progress" hidden>
        <div class="deletion-progress-bar"><span></span></div>
        <strong>Preparing deletion…</strong>
        <small>Please keep this tab open until Church Chatter confirms deletion is complete.</small>
      </div>
      <button class="btn btn-danger delete-congregation-button" id="delete-congregation-button" disabled>Delete ${esc(name)} permanently</button>
    </section>`;

  const input = root.querySelector("#delete-congregation-name");
  const check = root.querySelector("#delete-congregation-understand");
  const button = root.querySelector("#delete-congregation-button");
  const progress = root.querySelector("#delete-congregation-progress");

  const validate = () => {
    button.disabled = input.value !== name || !check.checked;
  };
  input.addEventListener("input", validate);
  check.addEventListener("change", validate);

  button.addEventListener("click", async () => {
    if (input.value !== name || !check.checked) return;
    button.disabled = true;
    input.disabled = true;
    check.disabled = true;
    progress.hidden = false;
    button.textContent = "Deleting congregation…";

    try {
      const result = await deleteCongregation(state.churchId, state.user, (status) => {
        const label = progress.querySelector("strong");
        const bar = progress.querySelector(".deletion-progress-bar span");
        if (label) label.textContent = status.stage;
        if (bar) {
          const percent = status.total ? Math.min(100, Math.round((status.deleted / status.total) * 100)) : 5;
          bar.style.width = `${Math.max(5, percent)}%`;
        }
      });
      progress.querySelector("strong").textContent = `${result.churchName} was deleted.`;
      button.textContent = "Deleted";
      window.setTimeout(() => {
        window.location.hash = "#/home";
        window.location.reload();
      }, 900);
    } catch (error) {
      console.error("Congregation deletion failed", error);
      progress.hidden = false;
      progress.querySelector("strong").textContent = "Deletion did not finish.";
      progress.querySelector("small").textContent = error.message || "Try again. Church Chatter can safely continue a creator deletion that was interrupted.";
      input.disabled = false;
      check.disabled = false;
      validate();
      button.textContent = `Retry deleting ${name}`;
    }
  });
}

async function enhance() {
  if (route() !== "admin" || !auth.currentUser) return;
  if (!state) state = await loadState().catch(() => null);
  if (!state) return;
  injectTab();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(async () => {
    scheduled = false;
    await enhance();
  });
}

// The main app can switch congregations without changing the URL. Clear cached creator state
// before that switch completes so a Danger Zone can never point at the previous congregation.
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-switch-church]")) state = null;
}, true);

window.addEventListener("hashchange", () => {
  state = null;
  schedule();
});

const observer = new MutationObserver(schedule);
observer.observe(document.querySelector("#app"), { childList: true, subtree: true });

schedule();
