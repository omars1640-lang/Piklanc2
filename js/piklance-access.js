import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

export const BADGES = {
  friends: {
    id: "friends",
    label: "أصدقاء PikLance",
    icon: "◆",
    tone: "purple",
    description: "شارة الوصول المبكر لأوائل أصدقاء المنصة."
  },
  ambassador: {
    id: "ambassador",
    label: "سفير",
    icon: "✦",
    tone: "gold",
    description: "شارة يدوية لمن يساهم بنشر أخبار PikLance."
  }
};

export function normalizeAccessCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "");
}

export function codeDocId(value) {
  return normalizeAccessCode(value);
}

function isUsableCode(data) {
  const maxUses = Number(data.maxUses || 1);
  const usedCount = Number(data.usedCount || 0);
  const expiresAt = data.expiresAt?.toDate?.() || (data.expiresAt ? new Date(data.expiresAt) : null);
  return data.status === "active"
    && usedCount < maxUses
    && (!expiresAt || expiresAt.getTime() > Date.now());
}

export async function getAccessCode(code) {
  const id = codeDocId(code);
  if (!id) return null;
  const snapshot = await getDoc(doc(db, "promoCodes", id));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return { id, ...data, usable: isUsableCode(data) };
}

export async function validateEarlyAccessCode(code) {
  const entry = await getAccessCode(code);
  return entry && entry.type === "early_access" && entry.usable ? entry : null;
}

export function rememberEarlyAccess(code) {
  const normalized = codeDocId(code);
  if (!normalized) return;
  localStorage.setItem("piklanceEarlyAccess", "true");
  localStorage.setItem("piklanceAccessCode", normalized);
}

export function hasRememberedEarlyAccess() {
  return localStorage.getItem("piklanceEarlyAccess") === "true";
}

export function registrationCodeFromUrl() {
  const params = new URLSearchParams(location.search);
  return codeDocId(params.get("accessCode") || params.get("invite") || params.get("code") || localStorage.getItem("piklanceAccessCode"));
}

export async function consumeRegistrationCode({ uid, email, name, accountType, code }) {
  const normalized = codeDocId(code);
  if (!uid || !normalized) return { applied: false };

  const codeRef = doc(db, "promoCodes", normalized);
  const userRef = doc(db, "users", uid);
  const publicRef = doc(db, "publicProfiles", uid);
  const badgeRef = doc(db, "userBadges", `${uid}_friends`);
  const referralRef = doc(db, "referrals", `${normalized}_${uid}`);

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(codeRef);
    if (!snapshot.exists()) throw new Error("invalid-code");
    const data = snapshot.data();
    if (!isUsableCode(data)) throw new Error("used-code");

    const baseUsage = {
      uid,
      email: email || "",
      name: name || "",
      accountType: accountType || "",
      usedAt: new Date().toISOString()
    };
    const nextUsedCount = Number(data.usedCount || 0) + 1;

    transaction.update(codeRef, {
      usedCount: nextUsedCount,
      status: nextUsedCount >= Number(data.maxUses || 1) ? "used" : "active",
      lastUsedAt: serverTimestamp(),
      lastUsedBy: uid,
      usedBy: [...(Array.isArray(data.usedBy) ? data.usedBy : []), baseUsage]
    });

    if (data.type === "early_access") {
      const badge = BADGES.friends;
      transaction.set(badgeRef, {
        uid,
        badgeId: badge.id,
        label: badge.label,
        icon: badge.icon,
        tone: badge.tone,
        source: "early_access_code",
        code: normalized,
        assignedAt: serverTimestamp()
      });
      transaction.set(publicRef, {
        badges: { [badge.id]: { label: badge.label, icon: badge.icon, tone: badge.tone } },
        badgeSummary: [badge]
      }, { merge: true });
      transaction.update(userRef, {
        earlyAccess: true,
        accessCode: normalized,
        badges: { [badge.id]: true },
        accessGrantedAt: serverTimestamp()
      });
      return { applied: true, type: "early_access", badgeId: badge.id };
    }

    if (data.type === "referral" && data.ownerUid && data.ownerUid !== uid) {
      transaction.set(referralRef, {
        code: normalized,
        inviterUid: data.ownerUid,
        invitedUid: uid,
        invitedEmail: email || "",
        invitedName: name || "",
        invitedAccountType: accountType || "",
        status: "pending",
        createdAt: serverTimestamp()
      });
      transaction.update(userRef, {
        referredByUid: data.ownerUid,
        referralCodeUsed: normalized
      });
      return { applied: true, type: "referral", inviterUid: data.ownerUid };
    }

    return { applied: true, type: data.type || "promo" };
  });
}

export async function seedDefaultBadges() {
  await Promise.all(Object.values(BADGES).map(badge => setDoc(doc(db, "badges", badge.id), {
    ...badge,
    active: true,
    updatedAt: serverTimestamp()
  }, { merge: true })));
}
