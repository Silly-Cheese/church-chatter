import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

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

function searchPrefixes(church) {
  const fields = [church?.name, church?.city, church?.region, church?.tradition]
    .map(normalize)
    .filter(Boolean);
  const prefixes = new Set();
  for (const field of fields) {
    for (const token of [field, ...field.split(/\s+/g)].filter(Boolean)) {
      const capped = token.slice(0, 40);
      for (let length = 2; length <= capped.length; length += 1) prefixes.add(capped.slice(0, length));
    }
  }
  return Array.from(prefixes).slice(0, 120);
}

function publicFields(church) {
  return {
    name: clean(church?.name, 100),
    city: clean(church?.city, 80),
    region: clean(church?.region, 80),
    tradition: clean(church?.tradition, 80),
    website: clean(church?.website, 500),
    description: clean(church?.description, 800),
    searchPrefixes: searchPrefixes(church)
  };
}

export async function syncPublicChurchMirrors(churchId, userId) {
  if (!churchId || !userId) return false;
  const churchRef = doc(db, "churches", churchId);
  const directoryRef = doc(db, "churchDirectory", churchId);
  const networkRef = doc(db, "churchNetwork", churchId);
  const [churchSnap, directorySnap, networkSnap] = await Promise.all([
    getDoc(churchRef),
    getDoc(directoryRef),
    getDoc(networkRef)
  ]);
  if (!churchSnap.exists() || (!directorySnap.exists() && !networkSnap.exists())) return false;

  const fields = publicFields(churchSnap.data());
  const batch = writeBatch(db);
  if (directorySnap.exists()) {
    batch.set(directoryRef, {
      churchId,
      ...fields,
      joinMode: directorySnap.data().joinMode === "open" ? "open" : "request",
      publishedBy: userId,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  if (networkSnap.exists()) {
    batch.set(networkRef, {
      churchId,
      ...fields,
      publishedBy: userId,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  await batch.commit();
  return true;
}
