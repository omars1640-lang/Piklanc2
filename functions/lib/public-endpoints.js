const { createHash } = require("node:crypto");
const { onCall } = require("firebase-functions/v2/https");
const { FieldValue, HttpsError, REGION, cleanText, db } = require("./helpers");

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizedEmail(value) {
  const email = cleanText(value, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "صيغة البريد الإلكتروني غير صحيحة.");
  return email;
}

function requestIp(request) {
  return cleanText(request.rawRequest?.ip || request.rawRequest?.headers?.["x-forwarded-for"] || "unknown", 100).split(",")[0];
}

async function enforceRateLimit(scope, identity, maximum, windowMinutes = 60) {
  const window = Math.floor(Date.now() / (windowMinutes * 60 * 1000));
  const reference = db.doc(`securityRateLimits/${scope}_${sha256(identity).slice(0, 32)}_${window}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const count = Number(snapshot.data()?.count || 0);
    if (count >= maximum) throw new HttpsError("resource-exhausted", "محاولات كثيرة. حاول لاحقاً.");
    transaction.set(reference, {
      scope,
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + (windowMinutes + 10) * 60 * 1000)
    }, { merge: true });
  });
}

exports.subscribeLaunch = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const email = normalizedEmail(request.data?.email);
  await Promise.all([
    enforceRateLimit("launch_ip", requestIp(request), 10),
    enforceRateLimit("launch_email", email, 2, 24 * 60)
  ]);
  const subscriberId = sha256(email);
  const reference = db.doc(`launchSubscribers/${subscriberId}`);
  const snapshot = await reference.get();
  if (snapshot.exists) return { ok: true, duplicate: true };
  await reference.create({
    email,
    category: "coming-soon-launch",
    source: "coming-soon-page",
    launchDate: "2026-08-01",
    createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true, duplicate: false };
});

exports.createSupportTicket = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const uid = request.auth?.uid || "";
  let profile = null;
  if (uid) {
    if (request.auth.token.email_verified !== true) throw new HttpsError("failed-precondition", "فعّل بريدك الإلكتروني أولاً.");
    const snapshot = await db.doc(`users/${uid}`).get();
    if (!snapshot.exists || snapshot.data().status !== "active") throw new HttpsError("permission-denied", "الحساب غير نشط.");
    profile = snapshot.data();
  }
  const requesterEmail = uid ? normalizedEmail(request.auth.token.email || profile.email) : normalizedEmail(request.data?.requesterEmail);
  const requesterName = uid ? cleanText(profile.name || requesterEmail, 100) : cleanText(request.data?.requesterName, 100);
  const requesterPhone = uid ? cleanText(profile.phone, 40) : cleanText(request.data?.requesterPhone, 40);
  const subject = cleanText(request.data?.subject, 120);
  const message = cleanText(request.data?.message, 3000);
  const orderId = cleanText(request.data?.orderId, 100);
  const category = cleanText(request.data?.category, 30);
  if (requesterName.length < 2 || subject.length < 3 || message.length < 3) throw new HttpsError("invalid-argument", "بيانات التذكرة غير مكتملة.");
  if (!["technical", "account", "payment", "dispute", "report", "general"].includes(category)) throw new HttpsError("invalid-argument", "تصنيف التذكرة غير صالح.");
  if (category === "dispute") {
    if (!uid) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول لفتح نزاع مرتبط بطلب.");
    if (!/^[A-Za-z0-9_-]{6,100}$/.test(orderId)) throw new HttpsError("invalid-argument", "رقم الطلب غير صالح.");
    const order = await db.doc(`orders/${orderId}`).get();
    if (!order.exists || ![order.data().buyerUid, order.data().freelancerUid].includes(uid)) {
      throw new HttpsError("permission-denied", "لا يمكنك فتح نزاع لطلب لست طرفاً فيه.");
    }
  }
  await Promise.all([
    enforceRateLimit("support_ip", requestIp(request), uid ? 20 : 5),
    enforceRateLimit("support_identity", uid || requesterEmail, uid ? 20 : 3)
  ]);
  const reference = db.collection("supportTickets").doc();
  await reference.set({
    requesterUid: uid,
    requesterName,
    requesterEmail,
    requesterPhone,
    subject,
    category,
    message,
    orderId: category === "dispute" ? orderId : "",
    status: "open",
    priority: category === "dispute" ? "high" : "normal",
    assignedAdminUid: "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { ok: true, ticketId: reference.id };
});
