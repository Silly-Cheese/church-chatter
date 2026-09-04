import { db } from "./firebase.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { MEMBER_PERMISSIONS } from "./services.js";

const DIRECTORY_LIMIT = 40;
const NETWORK_LIMIT = 40;

function clean(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function publicChurch(church) {
  return {
    name: clean(church?.name, 100),
    city: clean(church?.city, 80),
    region: clean(church?.region, 80),
    tradition: clean(church?.tradition, 80),
    website: clean(church?.website, 500),
    description: clean(church?.description, 800)
  };
}

export function makeSearchPrefixes(church) {
  const fields = [church?.name, church?.city, church?.region, church?.tradition].map(normalize).filter(Boolean);
  const prefixes = new Set();

  for (const field of fields) {
    const tokens = [field, ...field.split(/\s+/g)].filter(Boolean);
    for (const token of tokens) {
      const capped = token.slice(0, 40);
      for (let length = 2; length <= capped.length; length += 1) prefixes.add(capped.slice(0, length));
    }
  }

  return Array.from(prefixes).slice(0, 120);
}

export async function getDiscoverySettings(churchId) {
  const [churchSnap, directorySnap, networkSnap] = await Promise.all([
    getDoc(doc(db, "churches", churchId)),
    getDoc(doc(db, "churchDirectory", churchId)),
    getDoc(doc(db, "churchNetwork", churchId))
  ]);
  if (!churchSnap.exists()) return null;
  const church = { id: churchSnap.id, ...churchSnap.data() };
  return {
    church,
    discoveryEnabled: directorySnap.exists(),
    discoveryJoinMode: directorySnap.exists() ? directorySnap.data().joinMode || "request" : church.discoveryJoinMode || "request",
    networkEnabled: networkSnap.exists()
  };
}

export async function saveDiscoverySettings(churchId, userId, options = {}) {
  const churchRef = doc(db, "churches", churchId);
  const churchSnap = await getDoc(churchRef);
  if (!churchSnap.exists()) throw new Error("This congregation no longer exists.");
  const church = churchSnap.data();
  const enabled = Boolean(options.enabled);
  const joinMode = options.joinMode === "open" ? "open" : "request";
  const directoryRef = doc(db, "churchDirectory", churchId);
  const batch = writeBatch(db);

  batch.update(churchRef, {
    discoveryEnabled: enabled,
    discoveryJoinMode: joinMode,
    updatedAt: serverTimestamp()
  });

  if (enabled) {
    batch.set(directoryRef, {
      churchId,
      ...publicChurch(church),
      joinMode,
      searchPrefixes: makeSearchPrefixes(church),
      publishedBy: userId,
      publishedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    batch.delete(directoryRef);
  }

  await batch.commit();
}

export async function saveNetworkSettings(churchId, userId, enabled) {
  const churchRef = doc(db, "churches", churchId);
  const churchSnap = await getDoc(churchRef);
  if (!churchSnap.exists()) throw new Error("This congregation no longer exists.");
  const church = churchSnap.data();
  const networkRef = doc(db, "churchNetwork", churchId);
  const batch = writeBatch(db);

  batch.update(churchRef, { networkEnabled: Boolean(enabled), updatedAt: serverTimestamp() });
  if (enabled) {
    batch.set(networkRef, {
      churchId,
      ...publicChurch(church),
      searchPrefixes: makeSearchPrefixes(church),
      publishedBy: userId,
      publishedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    batch.delete(networkRef);
  }
  await batch.commit();
}

async function searchCollection(collectionName, term, maxResults) {
  const normalized = normalize(term).slice(0, 40);
  const ref = collection(db, collectionName);
  const snap = normalized.length >= 2
    ? await getDocs(query(ref, where("searchPrefixes", "array-contains", normalized), limit(maxResults)))
    : await getDocs(query(ref, limit(maxResults)));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export function searchChurchDirectory(term = "") {
  return searchCollection("churchDirectory", term, DIRECTORY_LIMIT);
}

export function searchChurchNetwork(term = "") {
  return searchCollection("churchNetwork", term, NETWORK_LIMIT);
}

export async function getOwnJoinRequest(churchId, uid) {
  const snap = await getDoc(doc(db, "churchJoinRequests", churchId, "requests", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function requestChurchJoin(churchId, user) {
  const directorySnap = await getDoc(doc(db, "churchDirectory", churchId));
  if (!directorySnap.exists()) throw new Error("This congregation is no longer available in Church Chatter discovery.");
  const directory = directorySnap.data();
  if (directory.joinMode !== "request") throw new Error("This congregation does not require approval. You can join it directly.");

  await setDoc(doc(db, "churchJoinRequests", churchId, "requests", user.uid), {
    churchId,
    churchName: clean(directory.name, 100),
    uid: user.uid,
    displayName: clean(user.displayName || user.email?.split("@")[0] || "Member", 80),
    email: clean(user.email, 254),
    photoURL: clean(user.photoURL, 500),
    status: "pending",
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function getPendingJoinRequests(churchId) {
  const snap = await getDocs(collection(db, "churchJoinRequests", churchId, "requests"));
  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => ["pending", "approved", "denied"].includes(item.status))
    .sort((a, b) => (b.requestedAt?.seconds || 0) - (a.requestedAt?.seconds || 0));
}

export async function reviewJoinRequest(churchId, uid, status, reviewerUid) {
  if (!["approved", "denied"].includes(status)) throw new Error("Choose Approve or Deny.");
  await updateDoc(doc(db, "churchJoinRequests", churchId, "requests", uid), {
    status,
    reviewedBy: reviewerUid,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function joinDiscoveredChurch(churchId, user) {
  const directoryRef = doc(db, "churchDirectory", churchId);
  const requestRef = doc(db, "churchJoinRequests", churchId, "requests", user.uid);
  const churchRef = doc(db, "churches", churchId);
  const memberRef = doc(db, "churches", churchId, "members", user.uid);
  const membershipRef = doc(db, "users", user.uid, "memberships", churchId);
  const userRef = doc(db, "users", user.uid);

  return runTransaction(db, async (transaction) => {
    const [directorySnap, requestSnap, churchSnap, memberSnap] = await Promise.all([
      transaction.get(directoryRef),
      transaction.get(requestRef),
      transaction.get(churchRef),
      transaction.get(memberRef)
    ]);

    if (!directorySnap.exists()) throw new Error("This congregation is no longer available in discovery.");
    if (!churchSnap.exists()) throw new Error("This congregation no longer exists.");
    const directory = directorySnap.data();
    const request = requestSnap.exists() ? requestSnap.data() : null;
    const approved = request?.status === "approved";
    if (directory.joinMode !== "open" && !approved) throw new Error("This congregation requires approval before you can join.");

    if (memberSnap.exists() && memberSnap.data().status === "active") {
      transaction.set(userRef, { activeChurchId: churchId, lastSeenAt: serverTimestamp() }, { merge: true });
      return churchId;
    }

    const church = churchSnap.data();
    transaction.set(memberRef, {
      uid: user.uid,
      displayName: clean(user.displayName || user.email?.split("@")[0] || "Member", 80),
      email: clean(user.email, 254),
      photoURL: clean(user.photoURL, 500),
      roleIds: ["member"],
      effectivePermissions: MEMBER_PERMISSIONS,
      status: "active",
      joinedAt: serverTimestamp(),
      joinedViaDiscovery: true,
      discoveryJoinMode: directory.joinMode
    });
    transaction.set(membershipRef, {
      churchId,
      churchName: clean(church.name, 100),
      status: "active",
      joinedAt: serverTimestamp()
    });
    transaction.update(churchRef, { memberCount: (church.memberCount || 0) + 1, updatedAt: serverTimestamp() });
    transaction.set(userRef, { activeChurchId: churchId, lastSeenAt: serverTimestamp() }, { merge: true });
    if (requestSnap.exists()) transaction.update(requestRef, { status: "joined", joinedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return churchId;
  });
}

function connectionId(a, b) {
  return [String(a), String(b)].sort().join("__");
}

export async function requestChurchConnection(fromChurch, toChurch, userId) {
  if (!fromChurch?.id || !toChurch?.churchId) throw new Error("Choose a congregation to connect with.");
  if (fromChurch.id === toChurch.churchId) throw new Error("Your congregation is already itself.");
  const id = connectionId(fromChurch.id, toChurch.churchId);
  const ref = doc(db, "churchConnections", id);
  const existing = await getDoc(ref);
  if (existing.exists() && existing.data().status === "accepted") throw new Error("These congregations are already connected.");

  const churchIds = [fromChurch.id, toChurch.churchId].sort();
  await setDoc(ref, {
    connectionId: id,
    churchIds,
    churchAId: churchIds[0],
    churchBId: churchIds[1],
    churchAName: churchIds[0] === fromChurch.id ? clean(fromChurch.name, 100) : clean(toChurch.name, 100),
    churchBName: churchIds[1] === fromChurch.id ? clean(fromChurch.name, 100) : clean(toChurch.name, 100),
    requestedByChurchId: fromChurch.id,
    requestedByUid: userId,
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return id;
}

export async function getChurchConnections(churchId) {
  const snap = await getDocs(query(collection(db, "churchConnections"), where("churchIds", "array-contains", churchId), limit(60)));
  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (b.updatedAt?.seconds || b.createdAt?.seconds || 0) - (a.updatedAt?.seconds || a.createdAt?.seconds || 0));
}

export async function respondToChurchConnection(connectionIdValue, activeChurchId, userId, status) {
  if (!["accepted", "declined"].includes(status)) throw new Error("Choose Accept or Decline.");
  const ref = doc(db, "churchConnections", connectionIdValue);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That church connection request no longer exists.");
  const data = snap.data();
  if (data.requestedByChurchId === activeChurchId) throw new Error("The receiving congregation must respond to this request.");
  await updateDoc(ref, {
    status,
    respondedByChurchId: activeChurchId,
    respondedByUid: userId,
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function sendChurchNetworkMessage(connectionIdValue, activeChurch, user, body) {
  const text = clean(body, 3000);
  if (!text) throw new Error("Write a message first.");
  const messageRef = doc(collection(db, "churchConnections", connectionIdValue, "messages"));
  await setDoc(messageRef, {
    body: text,
    senderChurchId: activeChurch.id,
    senderChurchName: clean(activeChurch.name, 100),
    senderUid: user.uid,
    senderName: clean(user.displayName || user.email?.split("@")[0] || "Church leader", 80),
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, "churchConnections", connectionIdValue), { updatedAt: serverTimestamp() });
}

export async function getChurchNetworkMessages(connectionIdValue) {
  const snap = await getDocs(collection(db, "churchConnections", connectionIdValue, "messages"));
  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
}

export async function removeChurchConnection(connectionIdValue) {
  const messageSnap = await getDocs(collection(db, "churchConnections", connectionIdValue, "messages"));
  const batch = writeBatch(db);
  messageSnap.docs.forEach((item) => batch.delete(item.ref));
  batch.delete(doc(db, "churchConnections", connectionIdValue));
  await batch.commit();
}
