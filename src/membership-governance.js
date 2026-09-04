import { auth } from "./firebase.js";
import {
  getChurchContext,
  getMemberships,
  getUserProfile,
  observeAuth,
  PERMISSIONS,
  PERMISSION_LABELS
} from "./services.js";
import {
  ADMIN_PERMISSION_KEYS,
  deleteRoleAndReassign,
  leaveCongregation,
  removeChurchMember,
  updateRoleAndPropagate
} from "./governance-data.js";

let state = null;
let scheduled = false;
let dialog = null;

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function route() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
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
  window.setTimeout(() => node.remove(), 4600);
}

function closeDialog() {
  dialog?.remove();
  dialog = null;
  document.body.classList.remove("governance-dialog-open");
}

function showDialog(html, wide = false) {
  closeDialog();
  dialog = document.createElement("div");
  dialog.className = "governance-backdrop";
  dialog.innerHTML = `<section class="governance-dialog ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</section>`;
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-governance-close]")) closeDialog();
  });
  document.body.appendChild(dialog);
  document.body.classList.add("governance-dialog-open");
  dialog.querySelector("input, textarea, select, button")?.focus();
  return dialog;
}

function hasPermission(permission) {
  return Boolean(state?.context?.member?.effectivePermissions?.includes(permission));
}

function isCreator(uid = state?.user?.uid) {
  return Boolean(uid && state?.context?.church?.createdBy === uid);
}

function roleById(id) {
  return state?.context?.roles?.find((role) => role.id === id);
}

function roleNames(member) {
  return (member?.roleIds || []).map((id) => roleById(id)?.name || id);
}

async function loadState() {
  const user = auth.currentUser;
  if (!user) return null;
  const [profile, memberships] = await Promise.all([
    getUserProfile(user.uid),
    getMemberships(user.uid)
  ]);
  if (!memberships.length) return { user, profile, memberships, activeChurchId: null, context: null };
  const activeChurchId = memberships.some((membership) => membership.churchId === profile?.activeChurchId)
    ? profile.activeChurchId
    : memberships[0].churchId;
  const context = await getChurchContext(activeChurchId, user.uid);
  return { user, profile, memberships, activeChurchId, context };
}

function avatar(member) {
  if (member?.photoURL) return `<img class="governance-avatar" src="${esc(member.photoURL)}" alt="" referrerpolicy="no-referrer">`;
  const initials = String(member?.displayName || "M").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  return `<div class="governance-avatar">${esc(initials || "M")}</div>`;
}

function memberRow(member) {
  const creator = isCreator(member.uid);
  const self = member.uid === state.user.uid;
  const owner = (member.roleIds || []).includes("owner");
  const canRemove = hasPermission(PERMISSIONS.MANAGE_MEMBERS) && !creator && !owner && !self;
  const canEditRoles = hasPermission(PERMISSIONS.MANAGE_ROLES) && !owner;
  return `
    <div class="governance-member-row">
      ${avatar(member)}
      <div class="governance-member-copy">
        <strong>${esc(member.displayName || "Member")}${self ? " · You" : ""}</strong>
        <span>${esc(member.email || "")}</span>
        <div class="governance-pills">
          ${roleNames(member).map((name) => `<span>${esc(name)}</span>`).join("")}
          ${creator ? `<span class="protected">Creator</span>` : ""}
        </div>
      </div>
      <div class="governance-member-actions">
        ${canEditRoles ? `<button class="btn btn-secondary" type="button" data-governance-edit-member="${esc(member.uid)}">Edit roles</button>` : ""}
        ${canRemove ? `<button class="btn governance-danger-button" type="button" data-governance-remove-member="${esc(member.uid)}">Remove</button>` : ""}
        ${self && !creator ? `<span class="governance-self-note">Leave from Profile</span>` : ""}
      </div>
    </div>`;
}

function injectPeople() {
  if (route() !== "people" || !state?.context) return;

  // The original Phase 1 UI used one menu for manageRoles OR manageMembers. Hide the
  // role editor when this person has member-management authority but not role authority.
  if (!hasPermission(PERMISSIONS.MANAGE_ROLES)) {
    document.querySelectorAll("[data-edit-member]").forEach((button) => button.remove());
  }

  if (!hasPermission(PERMISSIONS.MANAGE_MEMBERS) && !hasPermission(PERMISSIONS.MANAGE_ROLES)) return;
  const page = document.querySelector("#route-view .page");
  if (!page || page.querySelector(".governance-member-admin")) return;

  const section = document.createElement("section");
  section.className = "card mt-28 governance-member-admin";
  section.innerHTML = `
    <div class="card-head governance-section-head">
      <div>
        <div class="eyebrow">Membership administration</div>
        <h3>Manage your congregation</h3>
        <p>Role access and membership removal are separated so each leader only sees the authority their role actually grants.</p>
      </div>
      <span class="governance-count">${state.context.members.length} active</span>
    </div>
    <div class="governance-member-list">${state.context.members.map(memberRow).join("")}</div>`;
  page.appendChild(section);

  section.querySelectorAll("[data-governance-edit-member]").forEach((button) => button.addEventListener("click", () => {
    const original = document.querySelector(`[data-edit-member="${CSS.escape(button.dataset.governanceEditMember)}"]`);
    if (original) original.click();
    else toast("Role editor unavailable", "Refresh Church Chatter and try again.", "error");
  }));
  section.querySelectorAll("[data-governance-remove-member]").forEach((button) => button.addEventListener("click", () => {
    openRemoveMemberDialog(button.dataset.governanceRemoveMember);
  }));
}

function permissionGrid(role, editable) {
  const canGrantAdmin = hasPermission(PERMISSIONS.MANAGE_CHURCH);
  return Object.entries(PERMISSION_LABELS).map(([key, [label, detail]]) => {
    const checked = (role.permissions || []).includes(key);
    const admin = ADMIN_PERMISSION_KEYS.has(key);
    const disabled = !editable || (admin && !canGrantAdmin);
    return `<label class="governance-permission ${disabled ? "disabled" : ""}">
      <input type="checkbox" name="permissions" value="${esc(key)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
      <span><strong>${esc(label)}</strong><small>${esc(detail)}${admin ? " · Administrative" : ""}</small></span>
    </label>`;
  }).join("");
}

function roleHasAdmin(role) {
  return (role.permissions || []).some((permission) => ADMIN_PERMISSION_KEYS.has(permission));
}

function injectRoleControls() {
  if (route() !== "roles" || !state?.context || !hasPermission(PERMISSIONS.MANAGE_ROLES)) return;
  const rows = document.querySelectorAll("#access-content .list-row");
  if (!rows.length) return;

  rows.forEach((row, index) => {
    if (row.querySelector(".governance-role-actions")) return;
    const role = state.context.roles[index];
    if (!role) return;
    const actions = document.createElement("div");
    actions.className = "governance-role-actions";
    if (role.id === "owner") {
      actions.innerHTML = `<span class="governance-protected">Owner role protected</span>`;
    } else {
      actions.innerHTML = `
        <button class="btn btn-secondary" type="button" data-governance-edit-role="${esc(role.id)}">Edit</button>
        ${!role.system ? `<button class="btn governance-danger-button" type="button" data-governance-delete-role="${esc(role.id)}">Delete</button>` : ""}`;
    }
    row.appendChild(actions);
  });

  document.querySelectorAll("[data-governance-edit-role]").forEach((button) => {
    if (button.dataset.boundGovernance) return;
    button.dataset.boundGovernance = "true";
    button.addEventListener("click", () => openRoleEditDialog(button.dataset.governanceEditRole));
  });
  document.querySelectorAll("[data-governance-delete-role]").forEach((button) => {
    if (button.dataset.boundGovernance) return;
    button.dataset.boundGovernance = "true";
    button.addEventListener("click", () => openRoleDeleteDialog(button.dataset.governanceDeleteRole));
  });
}

function injectProfileLeave() {
  if (route() !== "profile" || !state?.context) return;
  const page = document.querySelector("#route-view .page");
  if (!page || page.querySelector(".governance-leave-card")) return;
  const creator = isCreator();
  const section = document.createElement("section");
  section.className = `card mt-28 governance-leave-card ${creator ? "protected" : ""}`;
  section.innerHTML = creator ? `
    <div class="governance-leave-icon">◇</div>
    <div class="grow"><div class="eyebrow">Congregation ownership</div><h3>You created ${esc(state.context.church.name)}</h3><p>The original congregation creator cannot leave, because Church Chatter must always retain a protected creator for destructive ownership actions. Use Church Admin → Danger Zone if the congregation itself needs to be permanently deleted.</p></div>
    <span class="governance-protected">Creator protected</span>` : `
    <div class="governance-leave-icon">↗</div>
    <div class="grow"><div class="eyebrow">Membership</div><h3>Leave ${esc(state.context.church.name)}</h3><p>This removes your access, group memberships, RSVPs, and active Serve signups from this congregation. Your Church Chatter account and your historical posts remain.</p></div>
    <button class="btn governance-danger-button" id="leave-congregation" type="button">Leave congregation</button>`;
  page.appendChild(section);
  section.querySelector("#leave-congregation")?.addEventListener("click", openLeaveDialog);
}

function enhanceMemberRoleModal() {
  const form = document.querySelector("#member-role-form");
  if (!form || form.dataset.governanceEnhanced) return;
  form.dataset.governanceEnhanced = "true";
  const grid = form.querySelector(".permission-grid");
  if (!grid) return;
  const note = document.createElement("div");
  note.className = "governance-role-limit-note";
  note.innerHTML = `<strong>Up to 4 roles per person</strong><span>This keeps permissions understandable and lets Firestore validate every assigned role directly.</span>`;
  grid.before(note);
  const boxes = [...form.querySelectorAll('input[name="roles"]')];
  const sync = () => {
    const selected = boxes.filter((box) => box.checked).length;
    boxes.forEach((box) => { if (!box.checked) box.disabled = selected >= 4; });
    note.dataset.count = String(selected);
  };
  boxes.forEach((box) => box.addEventListener("change", sync));
  sync();
}

function openRemoveMemberDialog(uid) {
  const member = state.context.members.find((item) => item.uid === uid);
  if (!member) return toast("Member not found", "They may have already left the congregation.", "error");
  if (isCreator(uid) || (member.roleIds || []).includes("owner")) return toast("Protected member", "The congregation creator cannot be removed.", "error");
  if (uid === state.user.uid) return toast("Use Leave Congregation", "Leaders should leave through their own Profile rather than removing themselves.");

  const modal = showDialog(`
    <div class="governance-dialog-head"><div><div class="eyebrow">Remove member</div><h2>Remove ${esc(member.displayName || "this member")}?</h2></div><button class="icon-btn" data-governance-close>×</button></div>
    <div class="governance-warning"><strong>Their access ends immediately.</strong><p>Church Chatter will remove their congregation membership, group memberships, RSVPs, and active Serve signups. Their Firebase account and historical authored content are not deleted.</p></div>
    <div class="governance-person-preview">${avatar(member)}<div><strong>${esc(member.displayName || "Member")}</strong><span>${esc(member.email || "")}</span></div></div>
    <div class="governance-dialog-actions"><button class="btn btn-secondary" data-governance-close>Cancel</button><button class="btn governance-danger-button" id="confirm-remove-member">Remove member</button></div>`);

  modal.querySelector("#confirm-remove-member")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Removing…";
    try {
      await removeChurchMember(state.activeChurchId, uid);
      closeDialog();
      toast("Member removed", `${member.displayName || "The member"} no longer has access to ${state.context.church.name}.`, "success");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      toast("Could not remove member", error?.message || "Try again.", "error");
      button.disabled = false;
      button.textContent = "Remove member";
    }
  });
}

function openLeaveDialog() {
  if (isCreator()) return;
  const churchName = state.context.church.name;
  const modal = showDialog(`
    <div class="governance-dialog-head"><div><div class="eyebrow">Leave congregation</div><h2>Leave ${esc(churchName)}?</h2></div><button class="icon-btn" data-governance-close>×</button></div>
    <div class="governance-warning"><strong>This removes your church access.</strong><p>Your Church Chatter account will remain. If you belong to another congregation, Church Chatter will switch you there; otherwise you will return to the Find/Create Church screen.</p></div>
    <div class="field"><label>Type the congregation name to confirm</label><input class="input" id="leave-confirm-name" autocomplete="off" placeholder="${esc(churchName)}"><small>This prevents accidental taps on mobile.</small></div>
    <div class="governance-dialog-actions"><button class="btn btn-secondary" data-governance-close>Stay</button><button class="btn governance-danger-button" id="confirm-leave-congregation" disabled>Leave congregation</button></div>`);
  const input = modal.querySelector("#leave-confirm-name");
  const confirm = modal.querySelector("#confirm-leave-congregation");
  input?.addEventListener("input", () => { confirm.disabled = input.value.trim() !== churchName.trim(); });
  confirm?.addEventListener("click", async () => {
    confirm.disabled = true;
    confirm.textContent = "Leaving…";
    try {
      await leaveCongregation(state.activeChurchId, state.user.uid);
      closeDialog();
      window.location.hash = "#/home";
      window.location.reload();
    } catch (error) {
      toast("Could not leave congregation", error?.message || "Try again.", "error");
      confirm.disabled = false;
      confirm.textContent = "Leave congregation";
    }
  });
}

function openRoleEditDialog(roleId) {
  const role = roleById(roleId);
  if (!role || role.id === "owner") return;
  if (roleHasAdmin(role) && !hasPermission(PERMISSIONS.MANAGE_CHURCH)) {
    return toast("Church management required", "This role contains administrative authority. Only someone with Manage Church can change it.", "error");
  }
  const editablePermissions = role.id !== "member";
  const modal = showDialog(`
    <div class="governance-dialog-head"><div><div class="eyebrow">Role management</div><h2>Edit ${esc(role.name)}</h2><p>${editablePermissions ? "Changes to permissions are propagated to everyone with this role." : "The standard Member role can be renamed, but its baseline permissions stay protected."}</p></div><button class="icon-btn" data-governance-close>×</button></div>
    <form id="governance-role-edit-form">
      <div class="field"><label>Role name</label><input class="input" name="name" maxlength="60" required value="${esc(role.name)}"></div>
      <div class="field"><label>Description</label><input class="input" name="description" maxlength="180" value="${esc(role.description || "")}"></div>
      <div class="governance-permission-head"><strong>Permissions</strong><span>${editablePermissions ? "Updates take effect server-side immediately." : "Protected baseline"}</span></div>
      <div class="governance-permission-grid">${permissionGrid(role, editablePermissions)}</div>
      ${editablePermissions && !hasPermission(PERMISSIONS.MANAGE_CHURCH) ? `<p class="governance-admin-note">Administrative permissions are locked. Manage Church authority is required to grant them.</p>` : ""}
      <div class="governance-dialog-actions"><button class="btn btn-secondary" type="button" data-governance-close>Cancel</button><button class="btn btn-primary" type="submit">Save role</button></div>
    </form>`, true);

  modal.querySelector("#governance-role-edit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const data = new FormData(event.currentTarget);
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const result = await updateRoleAndPropagate(state.activeChurchId, role.id, {
        name: data.get("name"),
        description: data.get("description"),
        permissions: editablePermissions ? data.getAll("permissions") : role.permissions
      });
      closeDialog();
      toast("Role updated", `${result.affectedMembers} member${result.affectedMembers === 1 ? "" : "s"} refreshed.`, "success");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      toast("Could not update role", error?.message || "Try again.", "error");
      button.disabled = false;
      button.textContent = "Save role";
    }
  });
}

function openRoleDeleteDialog(roleId) {
  const role = roleById(roleId);
  if (!role || role.system || ["owner", "member"].includes(role.id)) return toast("Protected role", "Core Church Chatter roles cannot be deleted.", "error");
  if (roleHasAdmin(role) && !hasPermission(PERMISSIONS.MANAGE_CHURCH)) {
    return toast("Church management required", "Only someone with Manage Church can delete a role that contains administrative permissions.", "error");
  }
  const assigned = state.context.members.filter((member) => (member.roleIds || []).includes(role.id)).length;
  const modal = showDialog(`
    <div class="governance-dialog-head"><div><div class="eyebrow">Delete role</div><h2>Delete ${esc(role.name)}?</h2></div><button class="icon-btn" data-governance-close>×</button></div>
    <div class="governance-warning"><strong>This role will disappear immediately.</strong><p>${assigned ? `${assigned} member${assigned === 1 ? " is" : "s are"} currently assigned this role. Church Chatter will remove it from them and recalculate their permissions automatically. Anyone left with no other role returns to the standard Member role.` : "No active members currently use this role."}</p></div>
    <div class="field"><label>Type the role name to confirm</label><input class="input" id="delete-role-confirm" autocomplete="off" placeholder="${esc(role.name)}"></div>
    <div class="governance-dialog-actions"><button class="btn btn-secondary" data-governance-close>Cancel</button><button class="btn governance-danger-button" id="confirm-delete-role" disabled>Delete role</button></div>`);
  const input = modal.querySelector("#delete-role-confirm");
  const confirm = modal.querySelector("#confirm-delete-role");
  input?.addEventListener("input", () => { confirm.disabled = input.value.trim() !== role.name.trim(); });
  confirm?.addEventListener("click", async () => {
    confirm.disabled = true;
    confirm.textContent = "Deleting…";
    try {
      const result = await deleteRoleAndReassign(state.activeChurchId, role.id);
      closeDialog();
      toast("Role deleted", `${result.affectedMembers} member${result.affectedMembers === 1 ? "" : "s"} safely reassigned.`, "success");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      toast("Could not delete role", error?.message || "Try again.", "error");
      confirm.disabled = false;
      confirm.textContent = "Delete role";
    }
  });
}

function apply() {
  injectPeople();
  injectRoleControls();
  injectProfileLeave();
  enhanceMemberRoleModal();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(async () => {
    scheduled = false;
    try {
      if (!auth.currentUser) return;
      if (!state || state.user?.uid !== auth.currentUser.uid) state = await loadState();
      if (!state?.context) return;
      apply();
    } catch (error) {
      console.error("Church Chatter membership governance", error);
    }
  });
}

window.addEventListener("hashchange", async () => {
  state = await loadState();
  schedule();
});
window.addEventListener("church-chatter-phase3-refresh", async () => {
  state = await loadState();
  schedule();
});
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDialog(); });

const observer = new MutationObserver(schedule);
observer.observe(document.querySelector("#app"), { childList: true, subtree: true });

observeAuth(async () => {
  state = await loadState();
  schedule();
});

schedule();
