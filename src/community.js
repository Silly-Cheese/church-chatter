import {
  archiveAnnouncement,
  createAnnouncement,
  createChatter,
  createComment,
  createEvent,
  createGroup,
  createGroupChatter,
  createGroupEvent,
  createGroupPrayer,
  createPrayer,
  createRoom,
  deleteChatter,
  deleteComment,
  editChatter,
  getGroupMembership,
  getMyChatterReaction,
  getMyPrayerStatus,
  getMyRsvp,
  getRecentCommunity,
  joinOpenGroup,
  leaveGroup,
  listenAnnouncements,
  listenChatter,
  listenComments,
  listenEvents,
  listenGroupChatter,
  listenGroupEvents,
  listenGroupPrayers,
  listenGroups,
  listenPrayers,
  listenRooms,
  markActivitySeen,
  setChatterPinned,
  setPrayerAnswered,
  setRsvp,
  toggleChatterReaction,
  togglePrayed
} from "./community-data.js";

const COMMUNITY_ROUTES = new Set(["chatter", "prayer", "gather", "groups", "activity"]);
let cleanups = [];
let activeGroup = null;
let groupTab = "chatter";

export function isCommunityRoute(route) {
  return COMMUNITY_ROUTES.has(route);
}

export function communityRouteShell(route) {
  const labels = { chatter: "Chatter", prayer: "Prayer", gather: "Gather", groups: "Groups", activity: "Activity" };
  return `<div class="page"><div id="community-route-root"><section class="card"><div class="skeleton" style="height:180px"></div><p class="muted mt-18">Opening ${labels[route] || "Church Chatter"}…</p></section></div></div>`;
}

function esc(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function initials(name = "CC") {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "CC";
}

function avatar(person = {}, className = "") {
  const name = person.authorName || person.displayName || person.name || "Member";
  const photo = person.authorPhotoURL || person.photoURL || "";
  return photo ? `<img class="avatar ${className}" src="${esc(photo)}" alt="${esc(name)}" referrerpolicy="no-referrer">` : `<div class="avatar ${className}">${esc(initials(name))}</div>`;
}

function asDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeTime(value) {
  const date = asDate(value);
  if (!date) return "just now";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (Math.abs(seconds) < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ${minutes >= 0 ? "ago" : "from now"}`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ${hours >= 0 ? "ago" : "from now"}`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return `${Math.abs(days)}d ${days >= 0 ? "ago" : "from now"}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

function eventTime(value) {
  const date = asDate(value);
  if (!date) return "Time not set";
  return date.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function modal(content, wide = false) {
  document.querySelector(".community-modal-backdrop")?.remove();
  const node = document.createElement("div");
  node.className = "modal-backdrop community-modal-backdrop";
  node.innerHTML = `<section class="modal ${wide ? "modal-lg" : ""}" role="dialog" aria-modal="true">${content}</section>`;
  node.addEventListener("click", (event) => {
    if (event.target === node || event.target.closest("[data-community-close]")) node.remove();
  });
  document.body.appendChild(node);
  node.querySelector("input,textarea,select")?.focus();
  return node;
}

function closeModal() {
  document.querySelector(".community-modal-backdrop")?.remove();
}

function busy(button, value, label = "Working…") {
  if (!button) return;
  if (value) {
    button.dataset.old = button.innerHTML;
    button.innerHTML = label;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.old || button.innerHTML;
    button.disabled = false;
  }
}

function stopListeners() {
  cleanups.forEach((fn) => {
    try { fn?.(); } catch (_) { /* listener cleanup */ }
  });
  cleanups = [];
}

export function destroyCommunityBindings() {
  stopListeners();
  activeGroup = null;
  groupTab = "chatter";
  document.querySelector(".community-modal-backdrop")?.remove();
}

function context(options) {
  const { state, hasPermission, permissions } = options;
  return {
    churchId: state.activeChurchId,
    church: state.context.church,
    member: state.context.member,
    user: state.user,
    hasPermission,
    permissions
  };
}

function empty(icon, title, body, action = "") {
  return `<div class="empty community-empty"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
}

function pageHead(eyebrow, title, body, action = "") {
  return `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(body)}</p></div>${action}</div>`;
}

export async function mountCommunityRoute(options) {
  stopListeners();
  const root = document.querySelector("#community-route-root");
  if (!root) return;
  if (options.state.route === "chatter") return mountChatter(root, options);
  if (options.state.route === "prayer") return mountPrayer(root, options);
  if (options.state.route === "gather") return mountGather(root, options);
  if (options.state.route === "groups") return mountGroups(root, options);
  if (options.state.route === "activity") return mountActivity(root, options);
}

export async function mountCommunityHome(options) {
  const root = document.querySelector("#home-community");
  if (!root) return;
  try {
    const data = await getRecentCommunity(options.state.activeChurchId);
    const now = new Date();
    const announcements = data.announcements.filter((item) => item.active !== false && (!asDate(item.expiresAt) || asDate(item.expiresAt) > now));
    const upcoming = data.events.filter((item) => item.status !== "cancelled" && (!asDate(item.startAt) || asDate(item.startAt) >= new Date(now.getTime() - 3 * 60 * 60 * 1000))).slice(0, 4);
    root.innerHTML = `
      <div class="grid grid-4 community-stats">
        <button class="card stat-card community-stat" data-community-route="chatter"><div class="stat-icon">◌</div><strong>${data.chatter.length}</strong><span>Recent Chatters</span></button>
        <button class="card stat-card community-stat" data-community-route="prayer"><div class="stat-icon">♡</div><strong>${data.prayers.length}</strong><span>Prayer requests</span></button>
        <button class="card stat-card community-stat" data-community-route="gather"><div class="stat-icon">◇</div><strong>${upcoming.length}</strong><span>Upcoming gatherings</span></button>
        <button class="card stat-card community-stat" data-community-route="activity"><div class="stat-icon">✦</div><strong>${announcements.length}</strong><span>Announcements</span></button>
      </div>
      ${announcements.length ? `<section class="announcement-stack mt-28">${announcements.slice(0, 3).map((item) => `<article class="announcement-banner ${esc(item.priority || "normal")}"><div><span class="announcement-label">${item.priority === "urgent" ? "Urgent" : item.priority === "important" ? "Important" : "Announcement"}</span><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></div><span>${relativeTime(item.createdAt)}</span></article>`).join("")}</section>` : ""}
      <div class="grid grid-2 mt-28">
        <section class="card"><div class="card-head"><div><h3>Right now</h3><p>Recent life from your congregation.</p></div><button class="btn btn-secondary" data-community-route="activity">See all</button></div><div class="list">${data.chatter.slice(0, 3).map((post) => `<button class="list-row community-list-button" data-community-route="chatter">${avatar(post)}<div class="grow"><strong>${esc(post.authorName || "Member")}</strong><small>${esc(post.body.slice(0, 110))}${post.body.length > 110 ? "…" : ""}</small></div><span class="muted">${relativeTime(post.createdAt)}</span></button>`).join("") || `<div class="muted">No Chatter yet. Your congregation gets to start the conversation.</div>`}</div></section>
        <section class="card"><div class="card-head"><div><h3>Coming up</h3><p>Your next church gatherings.</p></div><button class="btn btn-secondary" data-community-route="gather">Open Gather</button></div><div class="list">${upcoming.map((event) => `<button class="list-row community-list-button" data-community-route="gather"><div class="date-tile"><strong>${asDate(event.startAt)?.getDate() || "—"}</strong><span>${asDate(event.startAt)?.toLocaleString([], { month: "short" }) || "TBD"}</span></div><div class="grow"><strong>${esc(event.title)}</strong><small>${esc(event.location || "Location not added")} · ${esc(eventTime(event.startAt))}</small></div></button>`).join("") || `<div class="muted">No upcoming events have been posted yet.</div>`}</div></section>
      </div>`;
    root.querySelectorAll("[data-community-route]").forEach((button) => button.addEventListener("click", () => options.navigate(button.dataset.communityRoute)));
  } catch (error) {
    root.innerHTML = `<section class="card"><p class="muted">Community activity will appear here as your church begins using Church Chatter.</p></section>`;
  }
}

async function mountChatter(root, options) {
  const c = context(options);
  let posts = [];
  let rooms = [];
  let selectedRoom = "all";
  root.innerHTML = `${pageHead("Your church, talking", "Chatter", "Share updates, ask questions, celebrate life, and keep conversations moving beyond Sunday.", c.hasPermission(c.permissions.POST_CHATTER) ? `<button class="btn btn-primary" id="new-chatter">＋ Start a Chatter</button>` : "")}<div id="chatter-room-bar" class="room-bar"></div><div id="chatter-feed" class="community-feed"><section class="card"><div class="skeleton" style="height:180px"></div></section></div>`;

  function roomName(id) {
    return rooms.find((room) => room.id === id)?.name || "Community";
  }
  async function enhancePostButtons() {
    const buttons = root.querySelectorAll("[data-react-post]");
    await Promise.all(Array.from(buttons).map(async (button) => {
      try {
        const active = await getMyChatterReaction(c.churchId, button.dataset.reactPost, c.user.uid);
        button.classList.toggle("active", active);
        button.querySelector("span").textContent = active ? "Amen'd" : "Amen";
      } catch (_) { /* exact reaction lookup is optional UI enhancement */ }
    }));
  }
  function renderRooms() {
    const bar = root.querySelector("#chatter-room-bar");
    if (!bar) return;
    bar.innerHTML = `<button class="room-chip ${selectedRoom === "all" ? "active" : ""}" data-room="all">All Chatter</button>${rooms.filter((room) => !room.archived).map((room) => `<button class="room-chip ${selectedRoom === room.id ? "active" : ""}" data-room="${esc(room.id)}">${esc(room.name)}</button>`).join("")}${c.hasPermission(c.permissions.MANAGE_GROUPS) ? `<button class="room-chip room-add" id="new-room">＋ Room</button>` : ""}`;
    bar.querySelectorAll("[data-room]").forEach((button) => button.addEventListener("click", () => { selectedRoom = button.dataset.room; renderRooms(); renderPosts(); }));
    bar.querySelector("#new-room")?.addEventListener("click", openRoomModal);
  }
  function renderPosts() {
    const feed = root.querySelector("#chatter-feed");
    if (!feed) return;
    const visible = posts.filter((post) => selectedRoom === "all" || post.roomId === selectedRoom).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    feed.innerHTML = visible.length ? visible.map((post) => {
      const own = post.authorUid === c.user.uid;
      const moderate = c.hasPermission(c.permissions.MODERATE_CONTENT);
      return `<article class="card chatter-card ${post.pinned ? "pinned" : ""}" data-post-card="${esc(post.id)}"><div class="post-head">${avatar(post)}<div class="grow"><strong>${esc(post.authorName || "Member")}</strong><small>${esc(roomName(post.roomId))} · ${relativeTime(post.createdAt)}${post.editedAt ? " · edited" : ""}</small></div>${post.pinned ? `<span class="pill owner">Pinned</span>` : ""}${own || moderate ? `<button class="icon-btn" data-post-menu="${esc(post.id)}">⋯</button>` : ""}</div><div class="post-body">${esc(post.body).replaceAll("\n", "<br>")}</div><div class="post-actions"><button class="post-action" data-react-post="${esc(post.id)}">♡ <span>Amen</span>${post.reactionCount ? ` · ${post.reactionCount}` : ""}</button><button class="post-action" data-comments-post="${esc(post.id)}">◌ Discuss</button>${moderate ? `<button class="post-action" data-pin-post="${esc(post.id)}" data-pinned="${post.pinned ? "true" : "false"}">${post.pinned ? "Unpin" : "Pin"}</button>` : ""}</div></article>`;
    }).join("") : empty("◌", "No Chatter here yet", selectedRoom === "all" ? "Start the first conversation in your church community." : "This room is ready for its first conversation.", c.hasPermission(c.permissions.POST_CHATTER) ? `<button class="btn btn-primary" id="empty-new-chatter">Start a Chatter</button>` : "");
    bindPostActions();
    enhancePostButtons();
  }
  function openRoomModal() {
    const node = modal(`<div class="modal-head"><div><div class="eyebrow">Organize conversation</div><h2>Create a Chatter Room</h2><p>Rooms help your church keep recurring conversations easy to find.</p></div><button class="icon-btn" data-community-close>×</button></div><form id="room-form"><div class="modal-body"><div class="field"><label>Room name</label><input class="input" name="name" maxlength="60" required placeholder="Parents, Youth, Bible Study…"></div><div class="field"><label>Description</label><input class="input" name="description" maxlength="180" placeholder="What belongs in this room?"></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">Create room</button></div></form>`);
    node.querySelector("#room-form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); busy(button, true, "Creating…");
      try { await createRoom(c.churchId, c.user, Object.fromEntries(new FormData(event.currentTarget))); closeModal(); options.toast("Room created", "Your church has a new place to talk.", "success"); } catch (error) { options.toast("Could not create room", error.message, "error"); busy(button, false); }
    });
  }
  function openPostModal(post = null) {
    const node = modal(`<div class="modal-head"><div><div class="eyebrow">${post ? "Edit your Chatter" : "Share with your church"}</div><h2>${post ? "Edit Chatter" : "Start a Chatter"}</h2><p>Keep it useful, kind, and connected to your community.</p></div><button class="icon-btn" data-community-close>×</button></div><form id="chatter-form"><div class="modal-body">${!post && rooms.length ? `<div class="field"><label>Room</label><select class="input" name="roomId"><option value="">Community</option>${rooms.filter((room) => !room.archived).map((room) => `<option value="${esc(room.id)}" ${selectedRoom === room.id ? "selected" : ""}>${esc(room.name)}</option>`).join("")}</select></div>` : ""}<div class="field"><label>What do you want to share?</label><textarea class="textarea chatter-composer" name="body" maxlength="4000" required placeholder="Share an update, question, encouragement, or something your church should know…">${esc(post?.body || "")}</textarea></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">${post ? "Save changes" : "Post Chatter"}</button></div></form>`, true);
    node.querySelector("#chatter-form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); const data = Object.fromEntries(new FormData(event.currentTarget)); busy(button, true, post ? "Saving…" : "Posting…");
      try { if (post) await editChatter(c.churchId, post.id, data.body); else await createChatter(c.churchId, c.user, c.member, data); closeModal(); options.toast(post ? "Chatter updated" : "Chatter posted", "Your church can see it now.", "success"); } catch (error) { options.toast("Could not save Chatter", error.message, "error"); busy(button, false); }
    });
  }
  function openComments(post) {
    const node = modal(`<div class="modal-head"><div><div class="eyebrow">Conversation</div><h2>${esc(post.authorName || "Member")}'s Chatter</h2><p>${esc(post.body.slice(0, 180))}${post.body.length > 180 ? "…" : ""}</p></div><button class="icon-btn" data-community-close>×</button></div><div class="modal-body"><div id="comments-list"><div class="skeleton" style="height:100px"></div></div>${c.hasPermission(c.permissions.POST_CHATTER) ? `<form id="comment-form" class="comment-composer"><textarea class="textarea" name="body" maxlength="1500" required placeholder="Join the conversation…"></textarea><button class="btn btn-primary" type="submit">Comment</button></form>` : ""}</div>`, true);
    const unsub = listenComments(c.churchId, post.id, (comments, error) => {
      const list = node.querySelector("#comments-list"); if (!list) return;
      if (error) return list.innerHTML = `<p class="muted">Comments could not be loaded.</p>`;
      list.innerHTML = comments.length ? `<div class="comment-list">${comments.map((comment) => `<div class="comment">${avatar(comment)}<div class="comment-bubble"><div><strong>${esc(comment.authorName || "Member")}</strong><small>${relativeTime(comment.createdAt)}</small>${comment.authorUid === c.user.uid || c.hasPermission(c.permissions.MODERATE_CONTENT) ? `<button class="btn-link danger-link" data-delete-comment="${esc(comment.id)}">Delete</button>` : ""}</div><p>${esc(comment.body)}</p></div></div>`).join("")}</div>` : `<p class="muted">No comments yet. You can be the first.</p>`;
      list.querySelectorAll("[data-delete-comment]").forEach((button) => button.addEventListener("click", async () => { try { await deleteComment(c.churchId, post.id, button.dataset.deleteComment); } catch (err) { options.toast("Could not delete comment", err.message, "error"); } }));
    });
    const originalRemove = node.remove.bind(node); node.remove = () => { unsub(); originalRemove(); };
    node.querySelector("#comment-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button"); busy(button, true, "Posting…"); try { await createComment(c.churchId, post.id, c.user, c.member, new FormData(event.currentTarget).get("body")); event.currentTarget.reset(); busy(button, false); } catch (error) { options.toast("Could not comment", error.message, "error"); busy(button, false); } });
  }
  function bindPostActions() {
    root.querySelector("#empty-new-chatter")?.addEventListener("click", () => openPostModal());
    root.querySelectorAll("[data-react-post]").forEach((button) => button.addEventListener("click", async () => { button.disabled = true; try { await toggleChatterReaction(c.churchId, button.dataset.reactPost, c.user.uid); } catch (error) { options.toast("Could not react", error.message, "error"); } finally { button.disabled = false; } }));
    root.querySelectorAll("[data-comments-post]").forEach((button) => button.addEventListener("click", () => { const post = posts.find((item) => item.id === button.dataset.commentsPost); if (post) openComments(post); }));
    root.querySelectorAll("[data-pin-post]").forEach((button) => button.addEventListener("click", async () => { try { await setChatterPinned(c.churchId, button.dataset.pinPost, button.dataset.pinned !== "true"); } catch (error) { options.toast("Could not update pin", error.message, "error"); } }));
    root.querySelectorAll("[data-post-menu]").forEach((button) => button.addEventListener("click", () => { const post = posts.find((item) => item.id === button.dataset.postMenu); if (!post) return; const own = post.authorUid === c.user.uid; const node = modal(`<div class="modal-head"><div><h2>Chatter options</h2><p>Choose what you want to do with this post.</p></div><button class="icon-btn" data-community-close>×</button></div><div class="modal-body"><div class="list">${own ? `<button class="list-row community-list-button" id="edit-post"><div class="avatar">✎</div><div><strong>Edit Chatter</strong><small>Change the text of your post.</small></div></button>` : ""}<button class="list-row community-list-button danger-row" id="delete-post"><div class="avatar">×</div><div><strong>Delete Chatter</strong><small>Remove this post from the conversation.</small></div></button></div></div>`); node.querySelector("#edit-post")?.addEventListener("click", () => { closeModal(); openPostModal(post); }); node.querySelector("#delete-post")?.addEventListener("click", async () => { try { await deleteChatter(c.churchId, post.id); closeModal(); options.toast("Chatter deleted", "The post was removed.", "success"); } catch (error) { options.toast("Could not delete Chatter", error.message, "error"); } }); }));
  }
  root.querySelector("#new-chatter")?.addEventListener("click", () => openPostModal());
  cleanups.push(listenRooms(c.churchId, (items) => { rooms = items; renderRooms(); renderPosts(); }));
  cleanups.push(listenChatter(c.churchId, (items, error) => { posts = items; if (error) options.toast("Chatter unavailable", "The conversation feed could not be loaded.", "error"); renderPosts(); }));
}

async function mountPrayer(root, options) {
  const c = context(options);
  let publicPrayers = [];
  let leadershipPrayers = [];
  const canLeadership = c.hasPermission(c.permissions.VIEW_LEADERSHIP_PRAYER);
  root.innerHTML = `${pageHead("Carry one another", "Prayer", "Share prayer requests, quietly let someone know you prayed, and celebrate when prayer is answered.", c.hasPermission(c.permissions.CREATE_PRAYER) ? `<button class="btn btn-primary" id="new-prayer">＋ Share a prayer request</button>` : "")}<div class="prayer-intro card"><div class="prayer-symbol">♡</div><div><h3>Prayer is not a popularity contest.</h3><p>There are no likes here. Church Chatter simply lets someone know, “I prayed.”</p></div></div><div id="prayer-feed" class="community-feed mt-28"></div>`;
  function render() {
    const feed = root.querySelector("#prayer-feed"); if (!feed) return;
    const combined = [...publicPrayers.map((p) => ({ ...p, leadershipOnly: false })), ...leadershipPrayers.map((p) => ({ ...p, leadershipOnly: true }))].sort((a, b) => (asDate(b.createdAt)?.getTime() || 0) - (asDate(a.createdAt)?.getTime() || 0));
    feed.innerHTML = combined.length ? combined.map((prayer) => {
      const canAnswer = (!prayer.anonymous && prayer.authorUid === c.user.uid) || c.hasPermission(c.permissions.MODERATE_CONTENT);
      return `<article class="card prayer-card ${prayer.status === "answered" ? "answered" : ""}"><div class="prayer-head"><div class="prayer-avatar">${prayer.anonymous ? "♡" : avatar(prayer)}</div><div class="grow"><strong>${esc(prayer.authorName || "Anonymous")}</strong><small>${prayer.leadershipOnly ? "Leadership only · " : ""}${relativeTime(prayer.createdAt)}</small></div>${prayer.leadershipOnly ? `<span class="pill owner">Leadership</span>` : ""}${prayer.status === "answered" ? `<span class="pill success">Prayer answered</span>` : ""}</div><p class="prayer-body">${esc(prayer.body).replaceAll("\n", "<br>")}</p><div class="post-actions"><button class="post-action pray-button" data-prayed="${esc(prayer.id)}" data-leadership="${prayer.leadershipOnly ? "true" : "false"}>🙏 <span>I Prayed</span>${prayer.prayedCount ? ` · ${prayer.prayedCount}` : ""}</button>${canAnswer ? `<button class="post-action" data-answer-prayer="${esc(prayer.id)}" data-leadership="${prayer.leadershipOnly ? "true" : "false"}" data-answered="${prayer.status === "answered" ? "true" : "false"}">${prayer.status === "answered" ? "Reopen request" : "Mark prayer answered"}</button>` : ""}</div></article>`;
    }).join("") : empty("♡", "The prayer wall is quiet", "When someone shares a request, your congregation can surround them in prayer.", c.hasPermission(c.permissions.CREATE_PRAYER) ? `<button class="btn btn-primary" id="empty-new-prayer">Share a request</button>` : "");
    bindPrayerActions(combined);
  }
  async function hydratePrayedButtons() {
    await Promise.all(Array.from(root.querySelectorAll("[data-prayed]")).map(async (button) => { try { const active = await getMyPrayerStatus(c.churchId, button.dataset.prayed, c.user.uid, button.dataset.leadership === "true"); button.classList.toggle("active", active); button.querySelector("span").textContent = active ? "Prayed" : "I Prayed"; } catch (_) {} }));
  }
  function bindPrayerActions(combined) {
    root.querySelector("#empty-new-prayer")?.addEventListener("click", openPrayerModal);
    root.querySelectorAll("[data-prayed]").forEach((button) => button.addEventListener("click", async () => { button.disabled = true; try { await togglePrayed(c.churchId, button.dataset.prayed, c.user.uid, button.dataset.leadership === "true"); } catch (error) { options.toast("Could not update prayer", error.message, "error"); } finally { button.disabled = false; } }));
    root.querySelectorAll("[data-answer-prayer]").forEach((button) => button.addEventListener("click", async () => { try { await setPrayerAnswered(c.churchId, button.dataset.answerPrayer, button.dataset.answered !== "true", button.dataset.leadership === "true"); options.toast(button.dataset.answered === "true" ? "Prayer reopened" : "Prayer marked answered", "The prayer wall has been updated.", "success"); } catch (error) { options.toast("Could not update prayer", error.message, "error"); } }));
    hydratePrayedButtons();
  }
  function openPrayerModal() {
    const node = modal(`<div class="modal-head"><div><div class="eyebrow">Share what is on your heart</div><h2>Prayer request</h2><p>Choose who should see this request and whether your name should be shown.</p></div><button class="icon-btn" data-community-close>×</button></div><form id="prayer-form"><div class="modal-body"><div class="field"><label>Prayer request</label><textarea class="textarea" name="body" maxlength="2500" required placeholder="How can your church pray?"></textarea></div><div class="field"><label>Who can see this?</label><select class="input" name="audience"><option value="church">My congregation</option><option value="leadership">Church leadership only</option></select></div><label class="check compact-check"><input type="checkbox" name="anonymous" value="yes"><span><strong>Share anonymously</strong><small>Your name and account ID are not stored on the prayer document.</small></span></label></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">Share request</button></div></form>`);
    node.querySelector("#prayer-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); const form = new FormData(event.currentTarget); busy(button, true, "Sharing…"); try { await createPrayer(c.churchId, c.user, c.member, { body: form.get("body"), audience: form.get("audience"), anonymous: form.get("anonymous") === "yes" }); closeModal(); options.toast("Prayer request shared", form.get("audience") === "leadership" ? "Only authorized church leaders can see it." : "Your congregation can now pray with you.", "success"); } catch (error) { options.toast("Could not share prayer", error.message, "error"); busy(button, false); } });
  }
  root.querySelector("#new-prayer")?.addEventListener("click", openPrayerModal);
  cleanups.push(listenPrayers(c.churchId, (items, error) => { publicPrayers = items; if (error) options.toast("Prayer unavailable", "The prayer wall could not be loaded.", "error"); render(); }, false));
  if (canLeadership) cleanups.push(listenPrayers(c.churchId, (items) => { leadershipPrayers = items; render(); }, true));
}

async function mountGather(root, options) {
  const c = context(options);
  let events = [];
  root.innerHTML = `${pageHead("Come together", "Gather", "Services, studies, meetings, meals, and everything that brings your church into the same place.", c.hasPermission(c.permissions.MANAGE_EVENTS) ? `<button class="btn btn-primary" id="new-event">＋ Create gathering</button>` : "")}<div id="event-feed" class="event-grid"></div>`;
  function render() {
    const feed = root.querySelector("#event-feed"); if (!feed) return;
    const now = Date.now(); const upcoming = events.filter((item) => !asDate(item.startAt) || asDate(item.startAt).getTime() >= now - 6 * 60 * 60 * 1000);
    feed.innerHTML = upcoming.length ? upcoming.map((event) => `<article class="card event-card ${event.status === "cancelled" ? "cancelled" : ""}"><div class="event-date"><strong>${asDate(event.startAt)?.getDate() || "—"}</strong><span>${asDate(event.startAt)?.toLocaleString([], { month: "short" }) || "TBD"}</span></div><div class="event-content"><div class="flex justify-between gap-12"><div><span class="event-time">${esc(eventTime(event.startAt))}</span><h3>${esc(event.title)}</h3></div>${event.status === "cancelled" ? `<span class="pill">Cancelled</span>` : ""}</div><p>${esc(event.description || "No description has been added yet.")}</p><div class="event-meta"><span>⌖ ${esc(event.location || "Location not added")}</span></div><div class="rsvp-row" data-rsvp-row="${esc(event.id)}"><button data-rsvp="going">✓ Going</button><button data-rsvp="maybe">? Maybe</button><button data-rsvp="not-going">× Can't go</button></div>${c.hasPermission(c.permissions.MANAGE_EVENTS) && event.status !== "cancelled" ? `<button class="btn-link danger-link mt-12" data-cancel-event="${esc(event.id)}">Cancel gathering</button>` : ""}</div></article>`).join("") : empty("◇", "Nothing on the calendar yet", "When your church schedules a gathering, it will show up here.", c.hasPermission(c.permissions.MANAGE_EVENTS) ? `<button class="btn btn-primary" id="empty-new-event">Create the first gathering</button>` : "");
    bindEvents(); hydrateRsvps();
  }
  async function hydrateRsvps() {
    await Promise.all(events.map(async (event) => { const row = root.querySelector(`[data-rsvp-row="${CSS.escape(event.id)}"]`); if (!row) return; try { const status = await getMyRsvp(c.churchId, event.id, c.user.uid); row.querySelectorAll("[data-rsvp]").forEach((button) => button.classList.toggle("active", button.dataset.rsvp === status)); } catch (_) {} }));
  }
  function bindEvents() {
    root.querySelector("#empty-new-event")?.addEventListener("click", openEventModal);
    root.querySelectorAll("[data-rsvp-row]").forEach((row) => row.querySelectorAll("[data-rsvp]").forEach((button) => button.addEventListener("click", async () => { const current = button.classList.contains("active"); row.querySelectorAll("button").forEach((b) => b.disabled = true); try { await setRsvp(c.churchId, row.dataset.rsvpRow, c.user.uid, current ? null : button.dataset.rsvp); await hydrateRsvps(); } catch (error) { options.toast("Could not RSVP", error.message, "error"); } finally { row.querySelectorAll("button").forEach((b) => b.disabled = false); } })));
    root.querySelectorAll("[data-cancel-event]").forEach((button) => button.addEventListener("click", async () => { try { const { updateEvent } = await import("./community-data.js"); await updateEvent(c.churchId, button.dataset.cancelEvent, { status: "cancelled" }); options.toast("Gathering cancelled", "Members will see the updated status.", "success"); } catch (error) { options.toast("Could not cancel gathering", error.message, "error"); } }));
  }
  function openEventModal() {
    const node = modal(`<div class="modal-head"><div><div class="eyebrow">Bring people together</div><h2>Create a gathering</h2><p>Add the essentials now. You can keep the wording simple and church-specific.</p></div><button class="icon-btn" data-community-close>×</button></div><form id="event-form"><div class="modal-body"><div class="field"><label>Title</label><input class="input" name="title" maxlength="120" required placeholder="Wednesday Bible Study"></div><div class="grid grid-2"><div class="field"><label>Starts</label><input class="input" type="datetime-local" name="start" required></div><div class="field"><label>Ends <span class="muted">(optional)</span></label><input class="input" type="datetime-local" name="end"></div></div><div class="field"><label>Location</label><input class="input" name="location" maxlength="180" placeholder="Fellowship Hall"></div><div class="field"><label>Description</label><textarea class="textarea" name="description" maxlength="3000" placeholder="What should people know?"></textarea></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">Create gathering</button></div></form>`);
    node.querySelector("#event-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); const form = new FormData(event.currentTarget); busy(button, true, "Creating…"); try { await createEvent(c.churchId, c.user, { title: form.get("title"), startAt: new Date(form.get("start")), endAt: form.get("end") ? new Date(form.get("end")) : null, location: form.get("location"), description: form.get("description") }); closeModal(); options.toast("Gathering created", "It is now on your church calendar.", "success"); } catch (error) { options.toast("Could not create gathering", error.message, "error"); busy(button, false); } });
  }
  root.querySelector("#new-event")?.addEventListener("click", openEventModal);
  cleanups.push(listenEvents(c.churchId, (items, error) => { events = items; if (error) options.toast("Gather unavailable", "Church events could not be loaded.", "error"); render(); }));
}

async function mountGroups(root, options) {
  const c = context(options);
  if (activeGroup) return mountGroupDetail(root, options, activeGroup);
  let groups = [];
  root.innerHTML = `${pageHead("Smaller circles, same church", "Groups", "Ministries, classes, teams, and small groups each get a focused place to stay connected.", c.hasPermission(c.permissions.MANAGE_GROUPS) ? `<button class="btn btn-primary" id="new-group">＋ Create group</button>` : "")}<div id="group-grid" class="group-grid"></div>`;
  async function render() {
    const grid = root.querySelector("#group-grid"); if (!grid) return;
    if (!groups.length) { grid.innerHTML = empty("◎", "No groups yet", "Create ministry spaces without forcing your church into one denominational structure.", c.hasPermission(c.permissions.MANAGE_GROUPS) ? `<button class="btn btn-primary" id="empty-new-group">Create a group</button>` : ""); grid.querySelector("#empty-new-group")?.addEventListener("click", openGroupModal); return; }
    const memberships = await Promise.all(groups.map((group) => getGroupMembership(c.churchId, group.id, c.user.uid).catch(() => null)));
    grid.innerHTML = groups.map((group, index) => { const membership = memberships[index]; return `<article class="card group-card"><div class="group-icon">${esc(initials(group.name))}</div><div><span class="group-category">${esc(group.category || "Church group")}</span><h3>${esc(group.name)}</h3><p>${esc(group.description || "A community inside your church.")}</p></div><div class="group-footer"><span class="pill">${group.joinMode === "private" ? "Private" : "Open"}</span>${membership ? `<button class="btn btn-primary" data-open-group="${esc(group.id)}">Open group</button>` : group.joinMode === "open" ? `<button class="btn btn-secondary" data-join-group="${esc(group.id)}">Join group</button>` : `<span class="muted">Invitation required</span>`}</div></article>`; }).join("");
    grid.querySelectorAll("[data-open-group]").forEach((button) => button.addEventListener("click", () => { activeGroup = groups.find((g) => g.id === button.dataset.openGroup); mountGroupDetail(root, options, activeGroup); }));
    grid.querySelectorAll("[data-join-group]").forEach((button) => button.addEventListener("click", async () => { busy(button, true, "Joining…"); try { await joinOpenGroup(c.churchId, button.dataset.joinGroup, c.user.uid); options.toast("Welcome to the group", "Its conversations and prayer space are now open to you.", "success"); await render(); } catch (error) { options.toast("Could not join group", error.message, "error"); busy(button, false); } }));
  }
  function openGroupModal() {
    const node = modal(`<div class="modal-head"><div><div class="eyebrow">Create a smaller community</div><h2>New group</h2><p>Use whatever language fits your church: ministry, class, team, small group, or something else.</p></div><button class="icon-btn" data-community-close>×</button></div><form id="group-form"><div class="modal-body"><div class="field"><label>Name</label><input class="input" name="name" maxlength="100" required placeholder="Young Adults"></div><div class="field"><label>Category</label><input class="input" name="category" maxlength="60" placeholder="Ministry, class, team…"></div><div class="field"><label>Description</label><textarea class="textarea" name="description" maxlength="800"></textarea></div><div class="field"><label>Joining</label><select class="input" name="joinMode"><option value="open">Open — members can join themselves</option><option value="private">Private — membership is controlled</option></select></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">Create group</button></div></form>`);
    node.querySelector("#group-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); busy(button, true, "Creating…"); try { const id = await createGroup(c.churchId, c.user, Object.fromEntries(new FormData(event.currentTarget))); closeModal(); options.toast("Group created", "You are its first group leader.", "success"); } catch (error) { options.toast("Could not create group", error.message, "error"); busy(button, false); } });
  }
  root.querySelector("#new-group")?.addEventListener("click", openGroupModal);
  cleanups.push(listenGroups(c.churchId, (items, error) => { groups = items; if (error) options.toast("Groups unavailable", "Groups could not be loaded.", "error"); render(); }));
}

async function mountGroupDetail(root, options, group) {
  stopListeners();
  const c = context(options);
  const membership = await getGroupMembership(c.churchId, group.id, c.user.uid).catch(() => null);
  if (!membership && !c.hasPermission(c.permissions.MANAGE_GROUPS)) { activeGroup = null; return mountGroups(root, options); }
  root.innerHTML = `<button class="btn-link back-link" id="back-groups">← All groups</button><section class="group-hero"><div class="group-icon large">${esc(initials(group.name))}</div><div class="grow"><div class="eyebrow">${esc(group.category || "Church group")}</div><h1>${esc(group.name)}</h1><p>${esc(group.description || "A smaller community inside your church.")}</p></div>${membership && membership.role !== "leader" ? `<button class="btn btn-secondary" id="leave-group">Leave group</button>` : ""}</section><div class="group-tabs"><button data-group-tab="chatter" class="${groupTab === "chatter" ? "active" : ""}">Chatter</button><button data-group-tab="prayer" class="${groupTab === "prayer" ? "active" : ""}">Prayer</button><button data-group-tab="gather" class="${groupTab === "gather" ? "active" : ""}">Gather</button></div><div id="group-tab-view"></div>`;
  root.querySelector("#back-groups")?.addEventListener("click", () => { activeGroup = null; groupTab = "chatter"; mountGroups(root, options); });
  root.querySelector("#leave-group")?.addEventListener("click", async () => { try { await leaveGroup(c.churchId, group.id, c.user.uid); activeGroup = null; options.toast("You left the group", "You can rejoin later if it remains open.", "success"); mountGroups(root, options); } catch (error) { options.toast("Could not leave group", error.message, "error"); } });
  root.querySelectorAll("[data-group-tab]").forEach((button) => button.addEventListener("click", () => { groupTab = button.dataset.groupTab; mountGroupDetail(root, options, group); }));
  const tab = root.querySelector("#group-tab-view");
  if (groupTab === "chatter") mountGroupChatter(tab, options, group);
  else if (groupTab === "prayer") mountGroupPrayer(tab, options, group);
  else mountGroupGather(tab, options, group, membership);
}

function mountGroupChatter(root, options, group) {
  const c = context(options); root.innerHTML = `<div class="group-tab-head"><div><h3>Group Chatter</h3><p>Conversation for ${esc(group.name)}.</p></div><button class="btn btn-primary" id="group-new-post">＋ Post</button></div><div id="group-posts" class="community-feed"></div>`;
  function openComposer() { const node = modal(`<div class="modal-head"><div><h2>Post to ${esc(group.name)}</h2><p>This stays inside the group.</p></div><button class="icon-btn" data-community-close>×</button></div><form id="group-post-form"><div class="modal-body"><textarea class="textarea" name="body" maxlength="4000" required placeholder="Share with your group…"></textarea></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">Post</button></div></form>`); node.querySelector("form")?.addEventListener("submit", async (event) => { event.preventDefault(); const b = event.currentTarget.querySelector("button[type=submit]"); busy(b, true, "Posting…"); try { await createGroupChatter(c.churchId, group.id, c.user, c.member, new FormData(event.currentTarget).get("body")); closeModal(); } catch (error) { options.toast("Could not post", error.message, "error"); busy(b, false); } }); }
  root.querySelector("#group-new-post")?.addEventListener("click", openComposer);
  cleanups.push(listenGroupChatter(c.churchId, group.id, (items) => { const feed = root.querySelector("#group-posts"); if (feed) feed.innerHTML = items.length ? items.map((post) => `<article class="card chatter-card"><div class="post-head">${avatar(post)}<div><strong>${esc(post.authorName)}</strong><small>${relativeTime(post.createdAt)}</small></div></div><div class="post-body">${esc(post.body)}</div></article>`).join("") : empty("◌", "No group Chatter yet", "Start the conversation for this group."); }));
}

function mountGroupPrayer(root, options, group) {
  const c = context(options); root.innerHTML = `<div class="group-tab-head"><div><h3>Group Prayer</h3><p>Requests shared specifically with ${esc(group.name)}.</p></div><button class="btn btn-primary" id="group-new-prayer">＋ Prayer request</button></div><div id="group-prayers" class="community-feed"></div>`;
  root.querySelector("#group-new-prayer")?.addEventListener("click", () => { const node = modal(`<div class="modal-head"><div><h2>Group prayer request</h2><p>This request stays inside ${esc(group.name)}.</p></div><button class="icon-btn" data-community-close>×</button></div><form><div class="modal-body"><textarea class="textarea" name="body" maxlength="2500" required placeholder="How can this group pray?"></textarea><label class="check compact-check mt-18"><input type="checkbox" name="anonymous" value="yes"><span><strong>Share anonymously</strong><small>Your identity will not be stored on the request.</small></span></label></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">Share</button></div></form>`); node.querySelector("form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const b = event.currentTarget.querySelector("button[type=submit]"); busy(b, true, "Sharing…"); try { await createGroupPrayer(c.churchId, group.id, c.user, c.member, { body: form.get("body"), anonymous: form.get("anonymous") === "yes" }); closeModal(); } catch (error) { options.toast("Could not share prayer", error.message, "error"); busy(b, false); } }); });
  cleanups.push(listenGroupPrayers(c.churchId, group.id, (items) => { const feed = root.querySelector("#group-prayers"); if (feed) feed.innerHTML = items.length ? items.map((prayer) => `<article class="card prayer-card"><div class="prayer-head">${prayer.anonymous ? `<div class="avatar">♡</div>` : avatar(prayer)}<div><strong>${esc(prayer.authorName || "Anonymous")}</strong><small>${relativeTime(prayer.createdAt)}</small></div></div><p class="prayer-body">${esc(prayer.body)}</p></article>`).join("") : empty("♡", "No prayer requests here yet", "This group's prayer space is ready."); }));
}

function mountGroupGather(root, options, group, membership) {
  const c = context(options); const canCreate = membership?.role === "leader" || c.hasPermission(c.permissions.MANAGE_GROUPS);
  root.innerHTML = `<div class="group-tab-head"><div><h3>Group Gather</h3><p>Events just for ${esc(group.name)}.</p></div>${canCreate ? `<button class="btn btn-primary" id="group-new-event">＋ Gathering</button>` : ""}</div><div id="group-events" class="event-grid"></div>`;
  root.querySelector("#group-new-event")?.addEventListener("click", () => { const node = modal(`<div class="modal-head"><div><h2>Group gathering</h2><p>Create an event specifically for ${esc(group.name)}.</p></div><button class="icon-btn" data-community-close>×</button></div><form><div class="modal-body"><div class="field"><label>Title</label><input class="input" name="title" maxlength="120" required></div><div class="field"><label>Starts</label><input class="input" type="datetime-local" name="start" required></div><div class="field"><label>Location</label><input class="input" name="location" maxlength="180"></div><div class="field"><label>Description</label><textarea class="textarea" name="description" maxlength="2000"></textarea></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">Create</button></div></form>`); node.querySelector("form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const b = event.currentTarget.querySelector("button[type=submit]"); busy(b, true, "Creating…"); try { await createGroupEvent(c.churchId, group.id, c.user, { title: form.get("title"), startAt: new Date(form.get("start")), location: form.get("location"), description: form.get("description") }); closeModal(); } catch (error) { options.toast("Could not create gathering", error.message, "error"); busy(b, false); } }); });
  cleanups.push(listenGroupEvents(c.churchId, group.id, (items) => { const feed = root.querySelector("#group-events"); if (feed) feed.innerHTML = items.length ? items.map((event) => `<article class="card event-card"><div class="event-date"><strong>${asDate(event.startAt)?.getDate() || "—"}</strong><span>${asDate(event.startAt)?.toLocaleString([], { month: "short" }) || "TBD"}</span></div><div class="event-content"><h3>${esc(event.title)}</h3><p>${esc(event.description || "")}</p><div class="event-meta"><span>${esc(eventTime(event.startAt))}</span><span>⌖ ${esc(event.location || "Location not added")}</span></div></div></article>`).join("") : empty("◇", "No group gatherings yet", "Events for this group will appear here."); }));
}

async function mountActivity(root, options) {
  const c = context(options);
  root.innerHTML = `${pageHead("Everything in one place", "Activity", "Announcements and the newest things happening across your church community.", c.hasPermission(c.permissions.CREATE_ANNOUNCEMENTS) ? `<button class="btn btn-primary" id="new-announcement">＋ Announcement</button>` : "")}<div id="activity-feed"><section class="card"><div class="skeleton" style="height:200px"></div></section></div>`;
  async function render() {
    try {
      const data = await getRecentCommunity(c.churchId); const items = [
        ...data.announcements.filter((a) => a.active !== false).map((a) => ({ ...a, kind: "announcement", date: a.createdAt })),
        ...data.chatter.map((p) => ({ ...p, kind: "chatter", date: p.createdAt })),
        ...data.prayers.map((p) => ({ ...p, kind: "prayer", date: p.createdAt })),
        ...data.events.map((e) => ({ ...e, kind: "event", date: e.startAt }))
      ].sort((a, b) => (asDate(b.date)?.getTime() || 0) - (asDate(a.date)?.getTime() || 0)).slice(0, 25);
      const feed = root.querySelector("#activity-feed"); if (!feed) return;
      feed.innerHTML = items.length ? `<div class="activity-timeline">${items.map((item) => `<article class="activity-item"><div class="activity-icon">${item.kind === "announcement" ? "!" : item.kind === "chatter" ? "◌" : item.kind === "prayer" ? "♡" : "◇"}</div><div class="card activity-card"><div class="flex justify-between gap-12"><strong>${item.kind === "announcement" ? esc(item.title) : item.kind === "event" ? esc(item.title) : item.kind === "prayer" ? `${esc(item.authorName || "Anonymous")} shared a prayer request` : `${esc(item.authorName || "Member")} posted Chatter`}</strong><span class="muted">${relativeTime(item.date)}</span></div><p>${esc(item.kind === "announcement" ? item.body : item.kind === "event" ? `${eventTime(item.startAt)}${item.location ? ` · ${item.location}` : ""}` : item.body)}</p>${item.kind === "announcement" && c.hasPermission(c.permissions.CREATE_ANNOUNCEMENTS) ? `<button class="btn-link danger-link" data-archive-announcement="${esc(item.id)}">Archive</button>` : ""}</div></article>`).join("")}</div>` : empty("✦", "You're all caught up", "New church activity will appear here.");
      feed.querySelectorAll("[data-archive-announcement]").forEach((button) => button.addEventListener("click", async () => { try { await archiveAnnouncement(c.churchId, button.dataset.archiveAnnouncement); render(); } catch (error) { options.toast("Could not archive announcement", error.message, "error"); } }));
      await markActivitySeen(c.user.uid, c.churchId).catch(() => {});
    } catch (error) { root.querySelector("#activity-feed").innerHTML = empty("!", "Activity could not load", "Try opening this page again in a moment."); }
  }
  function openAnnouncement() {
    const node = modal(`<div class="modal-head"><div><div class="eyebrow">Official church update</div><h2>New announcement</h2><p>Announcements surface prominently on members' home screens and activity feed.</p></div><button class="icon-btn" data-community-close>×</button></div><form><div class="modal-body"><div class="field"><label>Title</label><input class="input" name="title" maxlength="120" required></div><div class="field"><label>Message</label><textarea class="textarea" name="body" maxlength="3000" required></textarea></div><div class="field"><label>Priority</label><select class="input" name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-community-close>Cancel</button><button class="btn btn-primary" type="submit">Publish announcement</button></div></form>`);
    node.querySelector("form")?.addEventListener("submit", async (event) => { event.preventDefault(); const b = event.currentTarget.querySelector("button[type=submit]"); busy(b, true, "Publishing…"); try { await createAnnouncement(c.churchId, c.user, Object.fromEntries(new FormData(event.currentTarget))); closeModal(); options.toast("Announcement published", "It is now live across Church Chatter.", "success"); render(); } catch (error) { options.toast("Could not publish announcement", error.message, "error"); busy(b, false); } });
  }
  root.querySelector("#new-announcement")?.addEventListener("click", openAnnouncement);
  render();
  cleanups.push(listenAnnouncements(c.churchId, () => render()));
}
