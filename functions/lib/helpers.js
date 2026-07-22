const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { HttpsError } = require("firebase-functions/v2/https");

if (!getApps().length) initializeApp();

const db = getFirestore();
const storageBucket = () => getStorage().bucket("piklance-c2651.firebasestorage.app");
const REGION = "europe-west1";
const CURRENCY = "SYP";
const CURRENCY_VERSION = "SYP_NEW_2026";

function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "يجب تفعيل البريد الإلكتروني أولاً.");
  }
  return request.auth.uid;
}

async function requireProfile(uid, type = "") {
  const snapshot = await db.doc(`users/${uid}`).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "الحساب غير موجود.");
  const profile = snapshot.data();
  if (profile.status !== "active") throw new HttpsError("permission-denied", "الحساب غير نشط.");
  if (type && profile.accountType !== type) throw new HttpsError("permission-denied", "نوع الحساب غير مسموح.");
  return { id: uid, ...profile };
}

async function adminAccess(uid) {
  const snapshot = await db.doc(`users/${uid}`).get();
  if (!snapshot.exists || snapshot.data().role !== "admin" || snapshot.data().status !== "active") return null;
  const profile = { id: uid, ...snapshot.data() };
  if (profile.adminAccessLevel === "super_admin" || !profile.adminRoleId) {
    return { profile, isSuperAdmin: true, permissions: ["*"] };
  }
  const roleSnapshot = await db.doc(`adminRoles/${profile.adminRoleId}`).get();
  if (!roleSnapshot.exists || roleSnapshot.data().active === false) {
    return { profile, isSuperAdmin: false, permissions: [] };
  }
  return { profile, isSuperAdmin: false, permissions: roleSnapshot.data().permissions || [] };
}

async function requireAdmin(request, permission = "") {
  const uid = requireAuth(request);
  const access = await adminAccess(uid);
  const requested = Array.isArray(permission) ? permission : (permission ? [permission] : []);
  if (!access || (requested.length && !access.isSuperAdmin && !requested.some(item => access.permissions.includes(item)))) {
    throw new HttpsError("permission-denied", "لا تملك الصلاحية المطلوبة لتنفيذ هذا الإجراء.");
  }
  return access.profile;
}

async function requireSuperAdmin(request) {
  const uid = requireAuth(request);
  const access = await adminAccess(uid);
  if (!access?.isSuperAdmin) {
    throw new HttpsError("permission-denied", "إدارة الفريق والأدوار متاحة للإدارة الكاملة فقط.");
  }
  return access.profile;
}

function integerAmount(value, min, max, label = "المبلغ") {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < min || amount > max) {
    throw new HttpsError("invalid-argument", `${label} يجب أن يكون رقماً صحيحاً بين ${min} و${max} ل.س.`);
  }
  return amount;
}

function cleanText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function walletData(data = {}) {
  return {
    available: Number(data.available || 0),
    held: Number(data.held || 0),
    pendingWithdrawal: Number(data.pendingWithdrawal || 0),
    lifetimeDeposits: Number(data.lifetimeDeposits || 0),
    lifetimeEarnings: Number(data.lifetimeEarnings || 0),
    lifetimeWithdrawals: Number(data.lifetimeWithdrawals || 0),
    currency: CURRENCY,
    currencyVersion: data.currencyVersion || (Object.keys(data).length ? "" : CURRENCY_VERSION)
  };
}

async function requireCurrencyReady() {
  const snapshot = await db.doc(`platformMigrations/${CURRENCY_VERSION}`).get();
  if (snapshot.data()?.status !== "completed") {
    throw new HttpsError("unavailable", "النظام المالي متوقف دقائق قليلة لإتمام تحويل العملة.");
  }
}

function platformReference(prefix, id, now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${String(id).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}`;
}

function notification(title, body, extra = {}) {
  return { title, body, read: false, createdAt: FieldValue.serverTimestamp(), ...extra };
}

function queueEmail(transaction, { to, subject, text, html = "", template, reference }) {
  const ref = db.collection("mailQueue").doc();
  transaction.set(ref, {
    to,
    from: "PikLance <info@piklance.com>",
    replyTo: "info@piklance.com",
    subject,
    text,
    html,
    template,
    reference,
    status: "queued",
    attempts: 0,
    createdAt: FieldValue.serverTimestamp()
  });
}

function ledgerEntry(transaction, uid, data) {
  const ref = db.collection("walletLedger").doc();
  transaction.set(ref, {
    userUid: uid,
    currency: CURRENCY,
    currencyVersion: CURRENCY_VERSION,
    createdAt: FieldValue.serverTimestamp(),
    ...data
  });
  return ref;
}

async function assertStorageObject(path, uid, root) {
  const normalized = cleanText(path, 500);
  if (!normalized.startsWith(`${root}/${uid}/`)) {
    throw new HttpsError("invalid-argument", "مسار الملف غير صالح.");
  }
  const file = storageBucket().file(normalized);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("failed-precondition", "الملف المرفوع غير موجود.");
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size || 0);
  const contentType = String(metadata.contentType || "");
  if (!Number.isSafeInteger(size) || size < 1 || size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw new HttpsError("failed-precondition", "نوع الملف المرفوع أو حجمه غير مسموح.");
  }
  const extension = normalized.split(".").pop()?.toLowerCase();
  const expectedContentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[extension];
  if (expectedContentType !== contentType) throw new HttpsError("failed-precondition", "امتداد الملف لا يطابق نوع الصورة.");
  const [header] = await file.download({ start: 0, end: 15 });
  const isJpeg = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng = header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = header.length >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
  if ((contentType === "image/jpeg" && !isJpeg) || (contentType === "image/png" && !isPng) || (contentType === "image/webp" && !isWebp)) {
    throw new HttpsError("failed-precondition", "محتوى الملف لا يطابق نوع الصورة المعلن.");
  }
  return {
    path: normalized,
    size,
    contentType,
    generation: String(metadata.generation || ""),
    md5Hash: String(metadata.md5Hash || "")
  };
}

module.exports = {
  CURRENCY, CURRENCY_VERSION, FieldValue, HttpsError, REGION, Timestamp, assertStorageObject, storageBucket,
  cleanText, db, integerAmount, ledgerEntry, notification, platformReference,
  queueEmail, requireAdmin, requireAuth, requireCurrencyReady, requireProfile, requireSuperAdmin, walletData
};
