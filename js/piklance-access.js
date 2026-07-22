import {
  doc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { db, functions } from "./firebase.js";

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
  const result = await httpsCallable(functions, "validateRegistrationCode")({ code: id });
  return result.data?.valid ? { id, type: result.data.type, usable: true } : null;
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
  const result = await httpsCallable(functions, "consumeRegistrationCode")({ code: normalized });
  return result.data;
}

export async function seedDefaultBadges() {
  await Promise.all(Object.values(BADGES).map(badge => setDoc(doc(db, "badges", badge.id), {
    ...badge,
    active: true,
    updatedAt: serverTimestamp()
  }, { merge: true })));
}
