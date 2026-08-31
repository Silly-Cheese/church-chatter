import { auth, db, googleProvider } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export const PERMISSIONS = {
  MANAGE_CHURCH: "manageChurch",
  MANAGE_MEMBERS: "manageMembers",
  MANAGE_ROLES: "manageRoles",
  MANAGE_INVITES: "manageInvites",
  MODERATE_CONTENT: "moderateContent",
  CREATE_ANNOUNCEMENTS: "createAnnouncements",
  MANAGE_EVENTS: "manageEvents",
  MANAGE_GROUPS: "manageGroups",
  VIEW_LEADERSHIP_PRAYER: "viewLeadershipPrayer",
  READ_COMMUNITY: "readCommunity",
  POST_CHATTER: "postChatter",
  CREATE_PRAYER: "createPrayer",
  RSVP_EVENTS: "rsvpEvents"
};

export const PERMISSION_LABELS = {
  manageChurch: ["Manage church", "Edit the church profile and core settings."],
  manageMembers: ["Manage members", "Review, update, or remove church members."],
  manageRoles: ["Manage roles", "Create roles and configure permissions."],
  manageInvites: ["Manage invitations", "Create and revoke invitation codes."],
  moderateContent: ["Moderate content", "Review reports and moderate community content."],
  createAnnouncements: ["Create announcements", "Publish official church announcements."],
  manageEvents: ["Manage events", "Create and maintain church gatherings."],
  manageGroups: ["Manage groups", "Create and maintain ministry groups."],
  viewLeadershipPrayer: ["Leadership prayer", "See prayer requests shared only with leadership."],
  readCommunity: ["Read community", "Access member-only Church Chatter content."],
  postChatter: ["Post Chatter", "Create posts and participate in discussions."],
  createPrayer: ["Share prayer requests", "Post prayer requests to allowed audiences."],
  rsvpEvents: ["RSVP to events", "Respond to church gathering invitations."]
};

export const OWNER_PERMISSIONS = Object.values(PERMISSIONS);
export const MEMBER_PERMISSIONS = [
  PERMISSIONS.READ_COMMUNITY,
  PERMISSIONS.POST_CHATTER,
  PERMISSIONS.CREATE_PRAYER,
  PERMISSIONS.RSVP_EVENTS
];

export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(result.user);
  return result.user;
}

export async function signUpEmail({ name, email, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(credential.user, { displayName: name.trim() });
  await ensureUserProfile(credential.user);
  return credential.user;
}

export async function signInEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  await ensureUserProfile(credential.user);
  return credential.user;
}

export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email.trim());
}

export async function signOutUser() {
  return signOut(auth);
}

export async function ensureUserProfile(user) {
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const base = {
    displayName: user.displayName || user.email?.split("@")[0] || "Church Chatter Member",
    email: user.email || "",
    photoURL: user.photoURL || "",
    lastSeenAt: serverTimestamp()
  };

  if (!snap.exists()) {
    await setDoc(ref, {
      ...base,
      createdAt: serverTimestamp(),
      activeChurchId: null
    });
  } else {
    await setDoc(ref, base, { merge: true });
  }
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getMemberships(uid) {
  const snaps = await getDocs(collection(db, "users", uid, "memberships"));
  return snaps.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((membership) => membership.status === "active")
    .sort((a, b) => (a.churchName || "").localeCompare(b.churchName || ""));
}

export async function getChurch(churchId) {
  const snap = await getDoc(doc(db, "churches", churchId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getMember(churchId, uid) {
  const snap = await getDoc(doc(db, "churches", churchId, "members", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getChurchContext(churchId, uid) {
  const [church, member, members, roles] = await Promise.all([
    getChurch(churchId),
    getMember(churchId, uid),
    getMembers(churchId),
    getRoles(churchId)
  ]);
  return { church, member, members, roles };
}

export async function setActiveChurch(uid, churchId) {
  await updateDoc(doc(db, "users", uid), { activeChurchId: churchId, lastSeenAt: serverTimestamp() });
}

function cleanText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function cleanWebsite(value) {
  const trimmed = cleanText(value, 250);
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function createChurch(user, form) {
  const churchRef = doc(collection(db, "churches"));
  const ownerRoleRef = doc(churchRef, "roles", "owner");
  const memberRoleRef = doc(churchRef, "roles", "member");
  const memberRef = doc(churchRef, "members", user.uid);
  const membershipRef = doc(db, "users", user.uid, "memberships", churchRef.id);
  const userRef = doc(db, "users", user.uid);
  const batch = writeBatch(db);

  const churchName = cleanText(form.name, 100);
  if (!churchName) throw new Error("Church name is required.");

  batch.set(churchRef, {
    name: churchName,
    city: cleanText(form.city, 80),
    region: cleanText(form.region, 80),
    tradition: cleanText(form.tradition, 80),
    website: cleanWebsite(form.website),
    description: cleanText(form.description, 800),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    memberCount: 1,
    status: "active"
  });

  batch.set(ownerRoleRef, {
    name: cleanText(form.leadershipRole, 60) || "Church Owner",
    description: "Full access to this Church Chatter community.",
    permissions: OWNER_PERMISSIONS,
    system: true,
    createdAt: serverTimestamp(),
    createdBy: user.uid
  });

  batch.set(memberRoleRef, {
    name: cleanText(form.memberRole, 60) || "Member",
    description: "Standard community access.",
    permissions: MEMBER_PERMISSIONS,
    system: true,
    createdAt: serverTimestamp(),
    createdBy: user.uid
  });

  batch.set(memberRef, {
    uid: user.uid,
    displayName: user.displayName || user.email?.split("@")[0] || "Member",
    email: user.email || "",
    photoURL: user.photoURL || "",
    roleIds: ["owner"],
    effectivePermissions: OWNER_PERMISSIONS,
    status: "active",
    joinedAt: serverTimestamp(),
    createdBy: user.uid
  });

  batch.set(membershipRef, {
    churchId: churchRef.id,
    churchName,
    status: "active",
    joinedAt: serverTimestamp()
  });

  batch.set(userRef, { activeChurchId: churchRef.id, lastSeenAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return churchRef.id;
}

export function normalizeInviteCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
}

function makeInviteCode(length = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (n) => alphabet[n % alphabet.length]).join("");
}

export async function joinChurch(user, rawCode) {
  const code = normalizeInviteCode(rawCode);
  if (code.length < 8) throw new Error("Enter a valid Church Chatter invitation code.");

  return runTransaction(db, async (transaction) => {
    const inviteRef = doc(db, "inviteCodes", code);
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error("That invitation code could not be found.");

    const invite = inviteSnap.data();
    if (!invite.active) throw new Error("That invitation is no longer active.");
    if (invite.expiresAt?.toDate && invite.expiresAt.toDate() < new Date()) throw new Error("That invitation has expired.");
    if (invite.maxUses && (invite.uses || 0) >= invite.maxUses) throw new Error("That invitation has reached its usage limit.");

    const churchRef = doc(db, "churches", invite.churchId);
    const memberRef = doc(db, "churches", invite.churchId, "members", user.uid);
    const membershipRef = doc(db, "users", user.uid, "memberships", invite.churchId);
    const churchInviteRef = doc(db, "churches", invite.churchId, "invites", code);
    const userRef = doc(db, "users", user.uid);

    const [churchSnap, memberSnap] = await Promise.all([
      transaction.get(churchRef),
      transaction.get(memberRef)
    ]);
    if (!churchSnap.exists()) throw new Error("The church connected to this invite no longer exists.");
    if (memberSnap.exists() && memberSnap.data().status === "active") {
      transaction.set(userRef, { activeChurchId: invite.churchId, lastSeenAt: serverTimestamp() }, { merge: true });
      return invite.churchId;
    }

    const church = churchSnap.data();
    transaction.set(memberRef, {
      uid: user.uid,
      displayName: user.displayName || user.email?.split("@")[0] || "Member",
      email: user.email || "",
      photoURL: user.photoURL || "",
      roleIds: ["member"],
      effectivePermissions: MEMBER_PERMISSIONS,
      status: "active",
      joinedAt: serverTimestamp(),
      joinedViaInvite: code
    });
    transaction.set(membershipRef, {
      churchId: invite.churchId,
      churchName: church.name,
      status: "active",
      joinedAt: serverTimestamp()
    });
    transaction.update(inviteRef, { uses: (invite.uses || 0) + 1, lastUsedAt: serverTimestamp() });
    transaction.update(churchInviteRef, { uses: (invite.uses || 0) + 1, lastUsedAt: serverTimestamp() });
    transaction.update(churchRef, { memberCount: (church.memberCount || 0) + 1, updatedAt: serverTimestamp() });
    transaction.set(userRef, { activeChurchId: invite.churchId, lastSeenAt: serverTimestamp() }, { merge: true });
    return invite.churchId;
  });
}

export async function getMembers(churchId) {
  const snaps = await getDocs(collection(db, "churches", churchId, "members"));
  return snaps.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((member) => member.status === "active")
    .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
}

export async function getRoles(churchId) {
  const snaps = await getDocs(collection(db, "churches", churchId, "roles"));
  return snaps.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function createRole(churchId, userId, role) {
  const roleRef = doc(collection(db, "churches", churchId, "roles"));
  await setDoc(roleRef, {
    name: cleanText(role.name, 60),
    description: cleanText(role.description, 180),
    permissions: Array.from(new Set(role.permissions || [])),
    system: false,
    createdAt: serverTimestamp(),
    createdBy: userId
  });
  return roleRef.id;
}

export async function updateRole(churchId, roleId, role) {
  if (roleId === "owner") throw new Error("The church owner role is protected.");
  await updateDoc(doc(db, "churches", churchId, "roles", roleId), {
    name: cleanText(role.name, 60),
    description: cleanText(role.description, 180),
    permissions: Array.from(new Set(role.permissions || [])),
    updatedAt: serverTimestamp()
  });
}

export async function removeRole(churchId, roleId) {
  if (["owner", "member"].includes(roleId)) throw new Error("System roles cannot be deleted.");
  await deleteDoc(doc(db, "churches", churchId, "roles", roleId));
}

export async function assignRoles(churchId, uid, roleIds) {
  const uniqueIds = Array.from(new Set(roleIds));
  if (!uniqueIds.length) uniqueIds.push("member");
  const permissions = new Set();

  for (const roleId of uniqueIds) {
    const roleSnap = await getDoc(doc(db, "churches", churchId, "roles", roleId));
    if (roleSnap.exists()) (roleSnap.data().permissions || []).forEach((permission) => permissions.add(permission));
  }

  await updateDoc(doc(db, "churches", churchId, "members", uid), {
    roleIds: uniqueIds,
    effectivePermissions: Array.from(permissions),
    rolesUpdatedAt: serverTimestamp()
  });
}

export async function createInvite(churchId, userId, options = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = makeInviteCode(10);
    const globalRef = doc(db, "inviteCodes", code);
    const existing = await getDoc(globalRef);
    if (existing.exists()) continue;

    const churchRef = doc(db, "churches", churchId, "invites", code);
    const batch = writeBatch(db);
    const invite = {
      code,
      churchId,
      active: true,
      uses: 0,
      maxUses: Math.max(1, Math.min(Number(options.maxUses) || 25, 500)),
      expiresAt: options.expiresAt || null,
      createdBy: userId,
      createdAt: serverTimestamp()
    };
    batch.set(globalRef, invite);
    batch.set(churchRef, invite);
    await batch.commit();
    return code;
  }
  throw new Error("Could not create a unique invitation code. Try again.");
}

export async function getInvites(churchId) {
  const snaps = await getDocs(collection(db, "churches", churchId, "invites"));
  return snaps.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function setInviteActive(churchId, code, active) {
  const batch = writeBatch(db);
  batch.update(doc(db, "inviteCodes", code), { active, updatedAt: serverTimestamp() });
  batch.update(doc(db, "churches", churchId, "invites", code), { active, updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function updateChurchProfile(churchId, patch) {
  await updateDoc(doc(db, "churches", churchId), {
    name: cleanText(patch.name, 100),
    city: cleanText(patch.city, 80),
    region: cleanText(patch.region, 80),
    tradition: cleanText(patch.tradition, 80),
    website: cleanWebsite(patch.website),
    description: cleanText(patch.description, 800),
    updatedAt: serverTimestamp()
  });
}

export async function updateOwnProfile(user, memberships, displayName) {
  const name = cleanText(displayName, 80);
  if (!name) throw new Error("Your name cannot be blank.");
  await updateProfile(user, { displayName: name });

  const batch = writeBatch(db);
  batch.set(doc(db, "users", user.uid), { displayName: name, updatedAt: serverTimestamp() }, { merge: true });
  memberships.forEach((membership) => {
    batch.set(doc(db, "churches", membership.churchId, "members", user.uid), { displayName: name }, { merge: true });
  });
  await batch.commit();
}
