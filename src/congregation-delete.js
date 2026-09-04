import { db } from "./firebase.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const TOP_LEVEL_COLLECTIONS = [
  "rooms",
  "chatter",
  "prayers",
  "leadershipPrayers",
  "announcements",
  "events",
  "groups",
  "resources",
  "serveOpportunities",
  "settings",
  "reports",
  "invites",
  "roles"
];

const CHILD_COLLECTIONS = {
  chatter: ["comments", "reactions"],
  prayers: ["prayedBy"],
  leadershipPrayers: ["prayedBy"],
  events: ["rsvps"],
  groups: ["members", "chatter", "prayers", "events"],
  serveOpportunities: ["signups"]
};

async function runLimited(items, worker, concurrency = 8) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function deleteRefs(refs, onProgress, progress) {
  await runLimited(refs, async (ref) => {
    await deleteDoc(ref);
    progress.deleted += 1;
    onProgress?.({ ...progress });
  });
}

async function collectChildren(parentDocs, childNames) {
  const refs = [];
  await runLimited(parentDocs, async (parentDoc) => {
    for (const childName of childNames) {
      const snapshot = await getDocs(collection(parentDoc.ref, childName));
      snapshot.docs.forEach((item) => refs.push(item.ref));
    }
  }, 6);
  return refs;
}

async function disconnectMember(churchId, uid, memberRef, onProgress, progress) {
  await deleteDoc(doc(db, "users", uid, "memberships", churchId));
  progress.deleted += 1;
  onProgress?.({ ...progress });
  await deleteDoc(doc(db, "users", uid, "activity", churchId));
  progress.deleted += 1;
  onProgress?.({ ...progress });
  await deleteDoc(memberRef);
  progress.deleted += 1;
  onProgress?.({ ...progress });
}

export async function deleteCongregation(churchId, user, onProgress) {
  if (!churchId || !user?.uid) throw new Error("A signed-in congregation creator is required.");

  const churchRef = doc(db, "churches", churchId);
  const churchSnap = await getDoc(churchRef);
  if (!churchSnap.exists()) throw new Error("This congregation no longer exists.");

  const church = churchSnap.data();
  if (church.createdBy !== user.uid) {
    throw new Error("Only the account that originally created this congregation can delete it.");
  }

  const progress = { stage: "Preparing deletion…", deleted: 0, total: 0 };
  onProgress?.({ ...progress });
  progress.stage = "Finding congregation data…";
  onProgress?.({ ...progress });

  const topSnapshots = new Map();
  for (const name of TOP_LEVEL_COLLECTIONS) {
    topSnapshots.set(name, await getDocs(collection(churchRef, name)));
  }
  const membersSnapshot = await getDocs(collection(churchRef, "members"));

  const nestedRefs = [];
  for (const [parentName, childNames] of Object.entries(CHILD_COLLECTIONS)) {
    const parents = topSnapshots.get(parentName)?.docs || [];
    nestedRefs.push(...await collectChildren(parents, childNames));
  }

  const topRefs = [];
  for (const snapshot of topSnapshots.values()) snapshot.docs.forEach((item) => topRefs.push(item.ref));

  const inviteSnapshot = topSnapshots.get("invites");
  const globalInviteRefs = (inviteSnapshot?.docs || []).map((item) => doc(db, "inviteCodes", item.id));

  // Church Discovery / Network data lives outside the private congregation tree, so it must
  // be explicitly included in deletion as well.
  const externalRefs = [];
  const directorySnap = await getDoc(doc(db, "churchDirectory", churchId));
  if (directorySnap.exists()) externalRefs.push(directorySnap.ref);
  const networkSnap = await getDoc(doc(db, "churchNetwork", churchId));
  if (networkSnap.exists()) externalRefs.push(networkSnap.ref);

  const joinRequests = await getDocs(collection(db, "churchJoinRequests", churchId, "requests"));
  joinRequests.docs.forEach((item) => externalRefs.push(item.ref));

  const connectionSnap = await getDocs(query(collection(db, "churchConnections"), where("churchIds", "array-contains", churchId)));
  const connectionMessageRefs = [];
  for (const connectionDoc of connectionSnap.docs) {
    const messages = await getDocs(collection(connectionDoc.ref, "messages"));
    messages.docs.forEach((message) => connectionMessageRefs.push(message.ref));
  }
  const connectionRefs = connectionSnap.docs.map((item) => item.ref);

  const creatorMember = membersSnapshot.docs.find((item) => item.id === user.uid) || null;
  const otherMembers = membersSnapshot.docs.filter((item) => item.id !== user.uid);
  progress.total = nestedRefs.length + topRefs.length + globalInviteRefs.length + externalRefs.length
    + connectionMessageRefs.length + connectionRefs.length + (otherMembers.length * 3) + 4;

  progress.stage = "Disconnecting congregation members…";
  onProgress?.({ ...progress });
  await runLimited(otherMembers, async (memberDoc) => {
    await disconnectMember(churchId, memberDoc.id, memberDoc.ref, onProgress, progress);
  }, 4);

  progress.stage = "Removing conversations and nested activity…";
  onProgress?.({ ...progress });
  await deleteRefs(nestedRefs, onProgress, progress);

  progress.stage = "Removing church-to-church connections…";
  onProgress?.({ ...progress });
  await deleteRefs(connectionMessageRefs, onProgress, progress);
  await deleteRefs(connectionRefs, onProgress, progress);

  progress.stage = "Removing discovery and network records…";
  onProgress?.({ ...progress });
  await deleteRefs(externalRefs, onProgress, progress);

  progress.stage = "Removing congregation content…";
  onProgress?.({ ...progress });
  await deleteRefs(topRefs, onProgress, progress);

  progress.stage = "Revoking invitations…";
  onProgress?.({ ...progress });
  await deleteRefs(globalInviteRefs, onProgress, progress);

  progress.stage = "Removing creator membership…";
  onProgress?.({ ...progress });
  await deleteDoc(doc(db, "users", user.uid, "activity", churchId));
  progress.deleted += 1;
  onProgress?.({ ...progress });
  await deleteDoc(doc(db, "users", user.uid, "memberships", churchId));
  progress.deleted += 1;
  onProgress?.({ ...progress });

  if (creatorMember) {
    await deleteDoc(creatorMember.ref);
    progress.deleted += 1;
    onProgress?.({ ...progress });
  }

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists() && userSnap.data().activeChurchId === churchId) {
    await updateDoc(userRef, { activeChurchId: null, lastSeenAt: serverTimestamp() });
  }

  progress.stage = "Deleting congregation…";
  onProgress?.({ ...progress });
  await deleteDoc(churchRef);
  progress.deleted += 1;
  progress.stage = "Congregation deleted.";
  onProgress?.({ ...progress });

  return { deletedDocuments: progress.deleted, churchName: church.name || "Congregation" };
}
