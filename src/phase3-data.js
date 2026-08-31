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
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function safeUrl(value) {
  const text = clean(value, 500);
  if (!text) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL');
    return url.toString();
  } catch (_) {
    throw new Error("Enter a valid http or https link.");
  }
}

function churchCollection(churchId, name) {
  return collection(db, "churches", churchId, name);
}

function churchDoc(churchId, name, id) {
  return doc(db, "churches", churchId, name, id);
}

function mapSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export function listenResources(churchId, callback) {
  const q = query(churchCollection(churchId, "resources"), orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(q, (snapshot) => callback(mapSnapshot(snapshot)), (error) => callback([], error));
}

export async function createResource(churchId, user, input) {
  const title = clean(input.title, 120);
  if (!title) throw new Error("Resource title is required.");
  const ref = doc(churchCollection(churchId, "resources"));
  await setDoc(ref, {
    title,
    description: clean(input.description, 800),
    category: clean(input.category, 60) || "Other",
    kind: ["link", "sermon", "study", "document", "form"].includes(input.kind) ? input.kind : "link",
    url: safeUrl(input.url),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    active: true
  });
  return ref.id;
}

export async function updateResource(churchId, resourceId, input) {
  const patch = { updatedAt: serverTimestamp() };
  if (input.title !== undefined) patch.title = clean(input.title, 120);
  if (input.description !== undefined) patch.description = clean(input.description, 800);
  if (input.category !== undefined) patch.category = clean(input.category, 60) || "Other";
  if (input.kind !== undefined) patch.kind = ["link", "sermon", "study", "document", "form"].includes(input.kind) ? input.kind : "link";
  if (input.url !== undefined) patch.url = safeUrl(input.url);
  if (input.active !== undefined) patch.active = Boolean(input.active);
  await updateDoc(churchDoc(churchId, "resources", resourceId), patch);
}

export async function deleteResource(churchId, resourceId) {
  await deleteDoc(churchDoc(churchId, "resources", resourceId));
}

export function listenServeOpportunities(churchId, callback) {
  const q = query(churchCollection(churchId, "serveOpportunities"), orderBy("startAt", "asc"), limit(100));
  return onSnapshot(q, (snapshot) => callback(mapSnapshot(snapshot)), (error) => callback([], error));
}

export async function createServeOpportunity(churchId, user, input) {
  const title = clean(input.title, 120);
  if (!title) throw new Error("Opportunity title is required.");
  if (!(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime())) throw new Error("Choose a valid date and time.");
  const slots = Math.max(1, Math.min(Number(input.slots) || 1, 500));
  const ref = doc(churchCollection(churchId, "serveOpportunities"));
  await setDoc(ref, {
    title,
    team: clean(input.team, 80),
    description: clean(input.description, 1600),
    location: clean(input.location, 180),
    startAt: input.startAt,
    slots,
    status: "open",
    createdBy: user.uid,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateServeOpportunity(churchId, opportunityId, patch) {
  const data = { updatedAt: serverTimestamp() };
  if (patch.title !== undefined) data.title = clean(patch.title, 120);
  if (patch.team !== undefined) data.team = clean(patch.team, 80);
  if (patch.description !== undefined) data.description = clean(patch.description, 1600);
  if (patch.location !== undefined) data.location = clean(patch.location, 180);
  if (patch.startAt instanceof Date && !Number.isNaN(patch.startAt.getTime())) data.startAt = patch.startAt;
  if (patch.slots !== undefined) data.slots = Math.max(1, Math.min(Number(patch.slots) || 1, 500));
  if (["open", "closed", "cancelled"].includes(patch.status)) data.status = patch.status;
  await updateDoc(churchDoc(churchId, "serveOpportunities", opportunityId), data);
}

export async function getServeSignupState(churchId, opportunityId, uid) {
  const signupRef = doc(db, "churches", churchId, "serveOpportunities", opportunityId, "signups", uid);
  const [mine, all] = await Promise.all([
    getDoc(signupRef),
    getDocs(collection(db, "churches", churchId, "serveOpportunities", opportunityId, "signups"))
  ]);
  return {
    signedUp: mine.exists(),
    count: all.size,
    signups: mapSnapshot(all)
  };
}

export async function signUpToServe(churchId, opportunityId, user, member) {
  await setDoc(doc(db, "churches", churchId, "serveOpportunities", opportunityId, "signups", user.uid), {
    uid: user.uid,
    displayName: clean(member.displayName || user.displayName || "Member", 80),
    joinedAt: serverTimestamp()
  });
}

export async function withdrawFromServe(churchId, opportunityId, uid) {
  await deleteDoc(doc(db, "churches", churchId, "serveOpportunities", opportunityId, "signups", uid));
}

export async function getSundayHub(churchId) {
  const snap = await getDoc(doc(db, "churches", churchId, "settings", "sundayHub"));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveSundayHub(churchId, user, input) {
  const ref = doc(db, "churches", churchId, "settings", "sundayHub");
  await setDoc(ref, {
    enabled: Boolean(input.enabled),
    welcome: clean(input.welcome, 160) || "Welcome to church.",
    service1Name: clean(input.service1Name, 80),
    service1Time: clean(input.service1Time, 30),
    service2Name: clean(input.service2Name, 80),
    service2Time: clean(input.service2Time, 30),
    sermonTitle: clean(input.sermonTitle, 160),
    sermonScripture: clean(input.sermonScripture, 120),
    bulletinUrl: input.bulletinUrl ? safeUrl(input.bulletinUrl) : "",
    notesUrl: input.notesUrl ? safeUrl(input.notesUrl) : "",
    connectUrl: input.connectUrl ? safeUrl(input.connectUrl) : "",
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function createReport(churchId, user, input) {
  const targetType = ["chatter", "prayer", "comment"].includes(input.targetType) ? input.targetType : "chatter";
  const targetId = clean(input.targetId, 160);
  const reason = ["inappropriate", "harassment", "privacy", "spam", "other"].includes(input.reason) ? input.reason : "other";
  if (!targetId) throw new Error("The reported content could not be identified.");
  const ref = doc(churchCollection(churchId, "reports"));
  await setDoc(ref, {
    targetType,
    targetId,
    excerpt: clean(input.excerpt, 500),
    reason,
    details: clean(input.details, 1200),
    reporterUid: user.uid,
    createdAt: serverTimestamp(),
    status: "open",
    resolvedAt: null,
    resolvedBy: null
  });
  return ref.id;
}

export function listenReports(churchId, callback) {
  const q = query(churchCollection(churchId, "reports"), orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(q, (snapshot) => callback(mapSnapshot(snapshot)), (error) => callback([], error));
}

export async function resolveReport(churchId, reportId, user, status) {
  if (!["resolved", "dismissed", "open"].includes(status)) throw new Error("Invalid report status.");
  await updateDoc(churchDoc(churchId, "reports", reportId), {
    status,
    resolvedAt: status === "open" ? null : serverTimestamp(),
    resolvedBy: status === "open" ? null : user.uid
  });
}

export async function getAdminSnapshot(churchId) {
  const [groups, events, resources, serve, reports] = await Promise.all([
    getDocs(churchCollection(churchId, "groups")),
    getDocs(churchCollection(churchId, "events")),
    getDocs(churchCollection(churchId, "resources")),
    getDocs(churchCollection(churchId, "serveOpportunities")),
    getDocs(query(churchCollection(churchId, "reports"), where("status", "==", "open"), limit(100)))
  ]);
  const now = Date.now();
  return {
    groups: groups.docs.filter((item) => item.data().archived !== true).length,
    upcomingEvents: events.docs.filter((item) => {
      const date = item.data().startAt?.toDate?.();
      return item.data().status !== "cancelled" && (!date || date.getTime() >= now);
    }).length,
    resources: resources.docs.filter((item) => item.data().active !== false).length,
    serveOpen: serve.docs.filter((item) => item.data().status === "open").length,
    openReports: reports.size
  };
}
