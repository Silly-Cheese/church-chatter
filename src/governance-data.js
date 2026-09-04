import { auth, db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export const ADMIN_PERMISSION_KEYS = new Set([
  "manageChurch",
  "manageMembers",
  "manageRoles",
  "manageInvites",
  "moderateContent",
  "createAnnouncements",
  "manageEvents",
  "manageGroups",
  "viewLeadershipPrayer",
  "communicateChurchNetwork"
]);

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clean(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function rolePermissionUnion(roleIds, roles) {
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  return unique((roleIds || []).flatMap((roleId) => roleMap.get(roleId)?.permissions || []));
}

function queueMemberUpdate(batch, churchId, update) {
  batch.update(doc(db, "churches", churchId, "members", update.uid), {
    roleIds: update.roleIds,
    effectivePermissions: update.effectivePermissions,
    rolesUpdatedAt: serverTimestamp()
  });
}

async function getChurchRoles(churchId) {
  const snap = await getDocs(collection(db, "churches", churchId, "roles"));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function getChurchMembers(churchId) {
  const snap = await getDocs(collection(db, "churches", churchId, "members"));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function commitMemberUpdates(churchId, updates) {
  for (let index = 0; index < updates.length; index += 400) {
    const batch = writeBatch(db);
    updates.slice(index, index + 400).forEach((update) => queueMemberUpdate(batch, churchId, update));
    await batch.commit();
  }
}

async function preflightMemberRemoval(churchId, uid) {
  const [churchSnap, memberSnap] = await Promise.all([
    getDoc(doc(db, "churches", churchId)),
    getDoc(doc(db, "churches", churchId, "members", uid))
  ]);
  if (!churchSnap.exists()) throw new Error("This congregation no longer exists.");
  if (!memberSnap.exists()) throw new Error("That person is no longer a member of this congregation.");
  const church = churchSnap.data();
  const member = memberSnap.data();
  if (church.createdBy === uid || (member.roleIds || []).includes("owner")) {
    throw new Error("The congregation creator cannot leave or be removed. Delete the congregation instead.");
  }
  return { church, member };
}

async function bestEffortMembershipCleanup(churchId, uid) {
  // Participation records should not silently reactivate if this person later rejoins.
  // Authored content is intentionally preserved as historical church content.
  try {
    const groups = await getDocs(collection(db, "churches", churchId, "groups"));
    const groupDeletes = [];
    for (const group of groups.docs) {
      const ref = doc(db, "churches", churchId, "groups", group.id, "members", uid);
      const snap = await getDoc(ref);
      if (snap.exists()) groupDeletes.push(ref);
    }
    for (let index = 0; index < groupDeletes.length; index += 400) {
      const batch = writeBatch(db);
      groupDeletes.slice(index, index + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  } catch (error) {
    console.warn("Church Chatter could not clean every group membership before removal.", error);
  }

  try {
    const events = await getDocs(collection(db, "churches", churchId, "events"));
    const rsvpDeletes = [];
    for (const event of events.docs) {
      const ref = doc(db, "churches", churchId, "events", event.id, "rsvps", uid);
      const snap = await getDoc(ref);
      if (snap.exists()) rsvpDeletes.push(ref);
    }
    for (let index = 0; index < rsvpDeletes.length; index += 400) {
      const batch = writeBatch(db);
      rsvpDeletes.slice(index, index + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  } catch (error) {
    console.warn("Church Chatter could not clean every RSVP before removal.", error);
  }

  // Serve uses a public count, so withdrawal and count decrement happen together.
  try {
    const opportunities = await getDocs(collection(db, "churches", churchId, "serveOpportunities"));
    for (const opportunity of opportunities.docs) {
      const signupRef = doc(db, "churches", churchId, "serveOpportunities", opportunity.id, "signups", uid);
      const signupSnap = await getDoc(signupRef);
      if (!signupSnap.exists()) continue;
      await runTransaction(db, async (transaction) => {
        const opportunityRef = doc(db, "churches", churchId, "serveOpportunities", opportunity.id);
        const [opportunitySnap, currentSignupSnap] = await Promise.all([
          transaction.get(opportunityRef),
          transaction.get(signupRef)
        ]);
        if (!opportunitySnap.exists() || !currentSignupSnap.exists()) return;
        const data = opportunitySnap.data();
        const count = Number.isInteger(data.signupCount) ? data.signupCount : 0;
        transaction.delete(signupRef);
        transaction.update(opportunityRef, {
          signupCount: Math.max(0, count - 1),
          lastSignupRemovedUid: uid,
          lastSignupRemovedAt: serverTimestamp()
        });
      });
    }
  } catch (error) {
    console.warn("Church Chatter could not clean every Serve signup before removal.", error);
  }
}

async function nextChurchForUser(uid, excludedChurchId) {
  const snap = await getDocs(collection(db, "users", uid, "memberships"));
  const next = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .find((membership) => membership.id !== excludedChurchId && membership.status === "active");
  return next?.id || null;
}

async function removeMembershipCore(churchId, targetUid, { selfLeave = false } = {}) {
  if (!churchId || !targetUid) throw new Error("A congregation and member are required.");

  // Never touch participation records before confirming this is not the protected creator.
  await preflightMemberRemoval(churchId, targetUid);
  const nextChurchId = selfLeave ? await nextChurchForUser(targetUid, churchId) : null;
  await bestEffortMembershipCleanup(churchId, targetUid);

  return runTransaction(db, async (transaction) => {
    const churchRef = doc(db, "churches", churchId);
    const memberRef = doc(db, "churches", churchId, "members", targetUid);
    const membershipRef = doc(db, "users", targetUid, "memberships", churchId);
    const joinRequestRef = doc(db, "churchJoinRequests", churchId, "requests", targetUid);
    const userRef = doc(db, "users", targetUid);

    // A leader never reads another person's private users/{uid}/memberships mirror.
    // Firestore validates the coordinated deletion through existsAfter().
    const reads = [transaction.get(churchRef), transaction.get(memberRef), transaction.get(joinRequestRef)];
    if (selfLeave) reads.push(transaction.get(userRef));
    const results = await Promise.all(reads);
    const [churchSnap, memberSnap, joinRequestSnap, userSnap] = results;

    if (!churchSnap.exists()) throw new Error("This congregation no longer exists.");
    if (!memberSnap.exists()) throw new Error("That person is no longer a member of this congregation.");

    const church = churchSnap.data();
    const member = memberSnap.data();
    if (church.createdBy === targetUid || (member.roleIds || []).includes("owner")) {
      throw new Error("The congregation creator cannot leave or be removed. Delete the congregation instead.");
    }

    transaction.delete(memberRef);
    transaction.delete(membershipRef);
    if (joinRequestSnap.exists()) transaction.delete(joinRequestRef);
    transaction.update(churchRef, {
      memberCount: Math.max(0, (church.memberCount || 1) - 1),
      lastMemberRemovedUid: targetUid,
      lastMemberRemovedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (selfLeave && userSnap?.exists()) {
      transaction.set(userRef, {
        activeChurchId: nextChurchId,
        lastSeenAt: serverTimestamp()
      }, { merge: true });
    }

    return { nextChurchId, churchName: church.name || "your congregation" };
  });
}

export async function leaveCongregation(churchId, uid) {
  return removeMembershipCore(churchId, uid, { selfLeave: true });
}

export async function removeChurchMember(churchId, targetUid) {
  return removeMembershipCore(churchId, targetUid, { selfLeave: false });
}

export async function updateRoleAndPropagate(churchId, roleId, patch) {
  const roleRef = doc(db, "churches", churchId, "roles", roleId);
  const [roleSnap, roles, members] = await Promise.all([
    getDoc(roleRef),
    getChurchRoles(churchId),
    getChurchMembers(churchId)
  ]);
  if (!roleSnap.exists()) throw new Error("That role no longer exists.");
  if (roleId === "owner") throw new Error("The congregation owner role is protected.");

  const current = { id: roleSnap.id, ...roleSnap.data() };
  const nextRole = {
    ...current,
    name: clean(patch.name, 60),
    description: clean(patch.description, 180),
    permissions: roleId === "member" ? current.permissions || [] : unique(patch.permissions || [])
  };
  if (!nextRole.name) throw new Error("Role name is required.");

  const nextRoles = roles.map((role) => role.id === roleId ? nextRole : role);
  const affected = members.filter((member) => (member.roleIds || []).includes(roleId));
  const memberUpdates = affected.map((member) => ({
    uid: member.uid || member.id,
    roleIds: unique(member.roleIds || ["member"]),
    effectivePermissions: rolePermissionUnion(member.roleIds || ["member"], nextRoles)
  }));

  const rolePatch = {
    name: nextRole.name,
    description: nextRole.description,
    ...(roleId === "member" ? {} : { permissions: nextRole.permissions }),
    updatedAt: serverTimestamp()
  };

  if (memberUpdates.length <= 400) {
    const batch = writeBatch(db);
    batch.update(roleRef, rolePatch);
    memberUpdates.forEach((update) => queueMemberUpdate(batch, churchId, update));
    await batch.commit();
  } else {
    // Keep the acting leader's current live role intact until the final batch. Otherwise,
    // a role that grants manageRoles could revoke the person performing this operation
    // halfway through propagating a large congregation.
    const actorUid = auth.currentUser?.uid || "";
    const actorUpdate = memberUpdates.find((update) => update.uid === actorUid) || null;
    const others = memberUpdates.filter((update) => update.uid !== actorUid);
    await commitMemberUpdates(churchId, others);

    const finalBatch = writeBatch(db);
    finalBatch.update(roleRef, rolePatch);
    if (actorUpdate) queueMemberUpdate(finalBatch, churchId, actorUpdate);
    await finalBatch.commit();
  }

  return { affectedMembers: memberUpdates.length };
}

export async function deleteRoleAndReassign(churchId, roleId) {
  if (["owner", "member"].includes(roleId)) throw new Error("Core Church Chatter roles cannot be deleted.");
  const roleRef = doc(db, "churches", churchId, "roles", roleId);
  const [roleSnap, roles, members] = await Promise.all([
    getDoc(roleRef),
    getChurchRoles(churchId),
    getChurchMembers(churchId)
  ]);
  if (!roleSnap.exists()) throw new Error("That role no longer exists.");
  if (roleSnap.data().system) throw new Error("Core Church Chatter roles cannot be deleted.");

  const remainingRoles = roles.filter((role) => role.id !== roleId);
  const affected = members.filter((member) => (member.roleIds || []).includes(roleId));
  const memberUpdates = affected.map((member) => {
    let roleIds = unique((member.roleIds || []).filter((id) => id !== roleId));
    if (!roleIds.length) roleIds = ["member"];
    return {
      uid: member.uid || member.id,
      roleIds,
      effectivePermissions: rolePermissionUnion(roleIds, remainingRoles)
    };
  });

  if (memberUpdates.length <= 400) {
    const batch = writeBatch(db);
    memberUpdates.forEach((update) => queueMemberUpdate(batch, churchId, update));
    batch.delete(roleRef);
    await batch.commit();
  } else {
    // For large congregations, reassign everyone else first while the role still exists.
    // The actor's own reassignment and role deletion happen together in the final batch.
    const actorUid = auth.currentUser?.uid || "";
    const actorUpdate = memberUpdates.find((update) => update.uid === actorUid) || null;
    const others = memberUpdates.filter((update) => update.uid !== actorUid);
    await commitMemberUpdates(churchId, others);

    const finalBatch = writeBatch(db);
    if (actorUpdate) queueMemberUpdate(finalBatch, churchId, actorUpdate);
    finalBatch.delete(roleRef);
    await finalBatch.commit();
  }

  return { affectedMembers: memberUpdates.length };
}
