import { db } from "./firebase.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function churchCollection(churchId, name) {
  return collection(db, "churches", churchId, name);
}

function churchDoc(churchId, name, id) {
  return doc(db, "churches", churchId, name, id);
}

function groupCollection(churchId, groupId, name) {
  return collection(db, "churches", churchId, "groups", groupId, name);
}

function groupDoc(churchId, groupId, name, id) {
  return doc(db, "churches", churchId, "groups", groupId, name, id);
}

function mapSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function listenOrdered(ref, callback, max = 50, direction = "desc", field = "createdAt") {
  const q = query(ref, orderBy(field, direction), limit(max));
  return onSnapshot(q, (snapshot) => callback(mapSnapshot(snapshot)), (error) => callback([], error));
}

export function listenRooms(churchId, callback) {
  return onSnapshot(churchCollection(churchId, "rooms"), (snapshot) => {
    const rooms = mapSnapshot(snapshot).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    callback(rooms);
  }, (error) => callback([], error));
}

export async function createRoom(churchId, user, input) {
  const name = clean(input.name, 60);
  if (!name) throw new Error("Room name is required.");
  const ref = doc(churchCollection(churchId, "rooms"));
  await setDoc(ref, {
    name,
    description: clean(input.description, 180),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    archived: false
  });
  return ref.id;
}

export async function archiveRoom(churchId, roomId, archived = true) {
  await updateDoc(churchDoc(churchId, "rooms", roomId), { archived: Boolean(archived), updatedAt: serverTimestamp() });
}

export function listenChatter(churchId, callback) {
  return listenOrdered(churchCollection(churchId, "chatter"), callback, 50);
}

export async function createChatter(churchId, user, member, input) {
  const body = clean(input.body, 4000);
  if (!body) throw new Error("Write something before posting.");
  const ref = doc(churchCollection(churchId, "chatter"));
  await setDoc(ref, {
    body,
    roomId: clean(input.roomId, 80) || null,
    authorUid: user.uid,
    authorName: clean(member.displayName || user.displayName || "Member", 80),
    authorPhotoURL: clean(member.photoURL || user.photoURL || "", 500),
    createdAt: serverTimestamp(),
    editedAt: null,
    reactionCount: 0,
    pinned: false
  });
  return ref.id;
}

export async function editChatter(churchId, postId, body) {
  const value = clean(body, 4000);
  if (!value) throw new Error("A Chatter post cannot be empty.");
  await updateDoc(churchDoc(churchId, "chatter", postId), { body: value, editedAt: serverTimestamp() });
}

export async function deleteChatter(churchId, postId) {
  await deleteDoc(churchDoc(churchId, "chatter", postId));
}

export async function setChatterPinned(churchId, postId, pinned) {
  await updateDoc(churchDoc(churchId, "chatter", postId), { pinned: Boolean(pinned), moderatedAt: serverTimestamp() });
}

export function listenComments(churchId, postId, callback) {
  return listenOrdered(collection(db, "churches", churchId, "chatter", postId, "comments"), callback, 100, "asc");
}

export async function createComment(churchId, postId, user, member, body) {
  const value = clean(body, 1500);
  if (!value) throw new Error("Write a comment first.");
  const ref = doc(collection(db, "churches", churchId, "chatter", postId, "comments"));
  await setDoc(ref, {
    body: value,
    authorUid: user.uid,
    authorName: clean(member.displayName || user.displayName || "Member", 80),
    authorPhotoURL: clean(member.photoURL || user.photoURL || "", 500),
    createdAt: serverTimestamp(),
    editedAt: null
  });
  return ref.id;
}

export async function deleteComment(churchId, postId, commentId) {
  await deleteDoc(doc(db, "churches", churchId, "chatter", postId, "comments", commentId));
}

export async function getMyChatterReaction(churchId, postId, uid) {
  const snap = await getDoc(doc(db, "churches", churchId, "chatter", postId, "reactions", uid));
  return snap.exists();
}

export async function toggleChatterReaction(churchId, postId, uid) {
  const postRef = churchDoc(churchId, "chatter", postId);
  const reactionRef = doc(db, "churches", churchId, "chatter", postId, "reactions", uid);
  return runTransaction(db, async (transaction) => {
    const [postSnap, reactionSnap] = await Promise.all([transaction.get(postRef), transaction.get(reactionRef)]);
    if (!postSnap.exists()) throw new Error("That Chatter post no longer exists.");
    const current = Number(postSnap.data().reactionCount || 0);
    if (reactionSnap.exists()) {
      transaction.delete(reactionRef);
      transaction.update(postRef, { reactionCount: Math.max(0, current - 1) });
      return false;
    }
    transaction.set(reactionRef, { uid, createdAt: serverTimestamp() });
    transaction.update(postRef, { reactionCount: current + 1 });
    return true;
  });
}

export function listenPrayers(churchId, callback, leadershipOnly = false) {
  return listenOrdered(churchCollection(churchId, leadershipOnly ? "leadershipPrayers" : "prayers"), callback, 50);
}

export async function createPrayer(churchId, user, member, input) {
  const body = clean(input.body, 2500);
  if (!body) throw new Error("Prayer request cannot be empty.");
  const anonymous = Boolean(input.anonymous);
  const leadershipOnly = input.audience === "leadership";
  const ref = doc(churchCollection(churchId, leadershipOnly ? "leadershipPrayers" : "prayers"));
  const payload = {
    body,
    anonymous,
    authorName: anonymous ? "Anonymous" : clean(member.displayName || user.displayName || "Member", 80),
    authorPhotoURL: anonymous ? "" : clean(member.photoURL || user.photoURL || "", 500),
    createdAt: serverTimestamp(),
    status: "open",
    prayedCount: 0,
    answeredAt: null
  };
  if (!anonymous) payload.authorUid = user.uid;
  await setDoc(ref, payload);
  return ref.id;
}

export async function setPrayerAnswered(churchId, prayerId, answered, leadershipOnly = false) {
  await updateDoc(churchDoc(churchId, leadershipOnly ? "leadershipPrayers" : "prayers", prayerId), {
    status: answered ? "answered" : "open",
    answeredAt: answered ? serverTimestamp() : null
  });
}

export async function getMyPrayerStatus(churchId, prayerId, uid, leadershipOnly = false) {
  const base = leadershipOnly ? "leadershipPrayers" : "prayers";
  const snap = await getDoc(doc(db, "churches", churchId, base, prayerId, "prayedBy", uid));
  return snap.exists();
}

export async function togglePrayed(churchId, prayerId, uid, leadershipOnly = false) {
  const base = leadershipOnly ? "leadershipPrayers" : "prayers";
  const prayerRef = churchDoc(churchId, base, prayerId);
  const prayedRef = doc(db, "churches", churchId, base, prayerId, "prayedBy", uid);
  return runTransaction(db, async (transaction) => {
    const [prayerSnap, prayedSnap] = await Promise.all([transaction.get(prayerRef), transaction.get(prayedRef)]);
    if (!prayerSnap.exists()) throw new Error("That prayer request no longer exists.");
    const current = Number(prayerSnap.data().prayedCount || 0);
    if (prayedSnap.exists()) {
      transaction.delete(prayedRef);
      transaction.update(prayerRef, { prayedCount: Math.max(0, current - 1) });
      return false;
    }
    transaction.set(prayedRef, { uid, createdAt: serverTimestamp() });
    transaction.update(prayerRef, { prayedCount: current + 1 });
    return true;
  });
}

export function listenAnnouncements(churchId, callback) {
  return listenOrdered(churchCollection(churchId, "announcements"), callback, 30);
}

export async function createAnnouncement(churchId, user, input) {
  const title = clean(input.title, 120);
  const body = clean(input.body, 3000);
  if (!title || !body) throw new Error("Announcement title and message are required.");
  const ref = doc(churchCollection(churchId, "announcements"));
  await setDoc(ref, {
    title,
    body,
    priority: ["normal", "important", "urgent"].includes(input.priority) ? input.priority : "normal",
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    expiresAt: input.expiresAt || null,
    active: true
  });
  return ref.id;
}

export async function archiveAnnouncement(churchId, announcementId) {
  await updateDoc(churchDoc(churchId, "announcements", announcementId), { active: false, archivedAt: serverTimestamp() });
}

export function listenEvents(churchId, callback) {
  return listenOrdered(churchCollection(churchId, "events"), callback, 80, "asc", "startAt");
}

export async function createEvent(churchId, user, input) {
  const title = clean(input.title, 120);
  if (!title) throw new Error("Event title is required.");
  if (!(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime())) throw new Error("Choose a valid start date and time.");
  const ref = doc(churchCollection(churchId, "events"));
  await setDoc(ref, {
    title,
    description: clean(input.description, 3000),
    location: clean(input.location, 180),
    startAt: input.startAt,
    endAt: input.endAt instanceof Date && !Number.isNaN(input.endAt.getTime()) ? input.endAt : null,
    allDay: Boolean(input.allDay),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    status: "scheduled"
  });
  return ref.id;
}

export async function updateEvent(churchId, eventId, patch) {
  const data = { updatedAt: serverTimestamp() };
  if (patch.title !== undefined) data.title = clean(patch.title, 120);
  if (patch.description !== undefined) data.description = clean(patch.description, 3000);
  if (patch.location !== undefined) data.location = clean(patch.location, 180);
  if (patch.startAt instanceof Date) data.startAt = patch.startAt;
  if (patch.endAt === null || patch.endAt instanceof Date) data.endAt = patch.endAt;
  if (patch.status && ["scheduled", "cancelled"].includes(patch.status)) data.status = patch.status;
  await updateDoc(churchDoc(churchId, "events", eventId), data);
}

export async function getMyRsvp(churchId, eventId, uid) {
  const snap = await getDoc(doc(db, "churches", churchId, "events", eventId, "rsvps", uid));
  return snap.exists() ? snap.data().status : null;
}

export async function setRsvp(churchId, eventId, uid, status) {
  const ref = doc(db, "churches", churchId, "events", eventId, "rsvps", uid);
  if (!status) return deleteDoc(ref);
  if (!["going", "maybe", "not-going"].includes(status)) throw new Error("Invalid RSVP status.");
  return setDoc(ref, { uid, status, updatedAt: serverTimestamp() }, { merge: true });
}

export function listenGroups(churchId, callback) {
  return onSnapshot(churchCollection(churchId, "groups"), (snapshot) => {
    const groups = mapSnapshot(snapshot).filter((item) => item.archived !== true).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    callback(groups);
  }, (error) => callback([], error));
}

export async function createGroup(churchId, user, input) {
  const name = clean(input.name, 100);
  if (!name) throw new Error("Group name is required.");
  const ref = doc(churchCollection(churchId, "groups"));
  await setDoc(ref, {
    name,
    description: clean(input.description, 800),
    category: clean(input.category, 60),
    joinMode: input.joinMode === "private" ? "private" : "open",
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    archived: false
  });
  await setDoc(doc(ref, "members", user.uid), { uid: user.uid, role: "leader", status: "active", joinedAt: serverTimestamp() });
  return ref.id;
}

export async function getGroupMembership(churchId, groupId, uid) {
  const snap = await getDoc(groupDoc(churchId, groupId, "members", uid));
  return snap.exists() ? snap.data() : null;
}

export async function joinOpenGroup(churchId, groupId, uid) {
  await setDoc(groupDoc(churchId, groupId, "members", uid), { uid, role: "member", status: "active", joinedAt: serverTimestamp() });
}

export async function leaveGroup(churchId, groupId, uid) {
  const ref = groupDoc(churchId, groupId, "members", uid);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().role === "leader") throw new Error("A group leader cannot leave until another leader is assigned.");
  await deleteDoc(ref);
}

export function listenGroupChatter(churchId, groupId, callback) {
  return listenOrdered(groupCollection(churchId, groupId, "chatter"), callback, 40);
}

export async function createGroupChatter(churchId, groupId, user, member, body) {
  const value = clean(body, 4000);
  if (!value) throw new Error("Write something before posting.");
  const ref = doc(groupCollection(churchId, groupId, "chatter"));
  await setDoc(ref, {
    body: value,
    authorUid: user.uid,
    authorName: clean(member.displayName || user.displayName || "Member", 80),
    authorPhotoURL: clean(member.photoURL || user.photoURL || "", 500),
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export function listenGroupPrayers(churchId, groupId, callback) {
  return listenOrdered(groupCollection(churchId, groupId, "prayers"), callback, 40);
}

export async function createGroupPrayer(churchId, groupId, user, member, input) {
  const body = clean(input.body, 2500);
  if (!body) throw new Error("Prayer request cannot be empty.");
  const anonymous = Boolean(input.anonymous);
  const ref = doc(groupCollection(churchId, groupId, "prayers"));
  const payload = {
    body,
    anonymous,
    authorName: anonymous ? "Anonymous" : clean(member.displayName || user.displayName || "Member", 80),
    authorPhotoURL: anonymous ? "" : clean(member.photoURL || user.photoURL || "", 500),
    createdAt: serverTimestamp(),
    status: "open"
  };
  if (!anonymous) payload.authorUid = user.uid;
  await setDoc(ref, payload);
  return ref.id;
}

export function listenGroupEvents(churchId, groupId, callback) {
  return listenOrdered(groupCollection(churchId, groupId, "events"), callback, 40, "asc", "startAt");
}

export async function createGroupEvent(churchId, groupId, user, input) {
  const title = clean(input.title, 120);
  if (!title) throw new Error("Event title is required.");
  if (!(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime())) throw new Error("Choose a valid start date and time.");
  const ref = doc(groupCollection(churchId, groupId, "events"));
  await setDoc(ref, {
    title,
    description: clean(input.description, 2000),
    location: clean(input.location, 180),
    startAt: input.startAt,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    status: "scheduled"
  });
  return ref.id;
}

export async function getRecentCommunity(churchId) {
  const loaders = [
    getDocs(query(churchCollection(churchId, "announcements"), orderBy("createdAt", "desc"), limit(5))),
    getDocs(query(churchCollection(churchId, "chatter"), orderBy("createdAt", "desc"), limit(5))),
    getDocs(query(churchCollection(churchId, "prayers"), orderBy("createdAt", "desc"), limit(5))),
    getDocs(query(churchCollection(churchId, "events"), orderBy("startAt", "asc"), limit(10)))
  ];
  const [announcements, chatter, prayers, events] = await Promise.all(loaders);
  return {
    announcements: mapSnapshot(announcements),
    chatter: mapSnapshot(chatter),
    prayers: mapSnapshot(prayers),
    events: mapSnapshot(events)
  };
}

export async function markActivitySeen(uid, churchId) {
  await setDoc(doc(db, "users", uid, "activity", churchId), { churchId, lastSeenAt: serverTimestamp() }, { merge: true });
}
