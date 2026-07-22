const { onCall } = require("firebase-functions/v2/https");
const { createHash } = require("node:crypto");
const { FieldValue, HttpsError, REGION, cleanText, db } = require("./helpers");

const FRIENDS_BADGE = Object.freeze({
  id: "friends",
  label: "أصدقاء PikLance",
  icon: "◆",
  tone: "purple",
  description: "شارة الوصول المبكر لأوائل أصدقاء المنصة."
});

function normalizedCode(value) {
  return cleanText(value, 80).toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");
}

function usableCode(data, now) {
  const expiresAt = data.expiresAt?.toDate?.();
  return data.status === "active"
    && Number.isSafeInteger(Number(data.usedCount || 0))
    && Number(data.usedCount || 0) < Number(data.maxUses || 1)
    && (!expiresAt || expiresAt.getTime() > now);
}

async function limitValidationRequests(request) {
  const ip = cleanText(request.rawRequest?.ip || request.rawRequest?.headers?.["x-forwarded-for"] || "unknown", 100).split(",")[0];
  const window = Math.floor(Date.now() / 3_600_000);
  const key = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  const reference = db.doc(`securityRateLimits/access_validation_${key}_${window}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const count = Number(snapshot.data()?.count || 0);
    if (count >= 30) throw new HttpsError("resource-exhausted", "محاولات كثيرة. حاول لاحقاً.");
    transaction.set(reference, {
      scope: "access_validation",
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 70 * 60 * 1000)
    }, { merge: true });
  });
}

exports.validateRegistrationCode = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  await limitValidationRequests(request);
  const code = normalizedCode(request.data?.code);
  if (!/^[A-Z0-9][A-Z0-9-]{2,79}$/.test(code)) return { valid: false };
  const snapshot = await db.doc(`promoCodes/${code}`).get();
  if (!snapshot.exists || !usableCode(snapshot.data(), Date.now())) return { valid: false };
  const type = cleanText(snapshot.data().type, 30);
  return { valid: true, id: code, type };
});

exports.consumeRegistrationCode = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "يجب إنشاء الحساب أولاً.");
  const code = normalizedCode(request.data?.code);
  if (!/^[A-Z0-9][A-Z0-9-]{2,79}$/.test(code)) throw new HttpsError("invalid-argument", "كود الوصول غير صالح.");

  const codeRef = db.doc(`promoCodes/${code}`);
  const userRef = db.doc(`users/${uid}`);
  const publicRef = db.doc(`publicProfiles/${uid}`);
  const useRef = db.doc(`promoCodeUses/${code}_${uid}`);

  return db.runTransaction(async transaction => {
    const [codeSnapshot, userSnapshot, priorUse, badgeSnapshot] = await Promise.all([
      transaction.get(codeRef),
      transaction.get(userRef),
      transaction.get(useRef),
      transaction.get(db.doc("badges/friends"))
    ]);
    if (!userSnapshot.exists) throw new HttpsError("failed-precondition", "ملف الحساب غير مكتمل.");
    const user = userSnapshot.data();
    const tokenEmail = String(request.auth.token.email || "").trim().toLowerCase();
    if (tokenEmail && String(user.email || "").trim().toLowerCase() !== tokenEmail) {
      throw new HttpsError("permission-denied", "الحساب لا يطابق البريد المسجل.");
    }
    if (priorUse.exists) return { applied: true, type: priorUse.data().type || "promo", duplicate: true };
    if (!codeSnapshot.exists || !usableCode(codeSnapshot.data(), Date.now())) {
      throw new HttpsError("failed-precondition", "الكود غير صحيح أو انتهى استخدامه.");
    }

    const data = codeSnapshot.data();
    const nextUsedCount = Number(data.usedCount || 0) + 1;
    transaction.update(codeRef, {
      usedCount: nextUsedCount,
      status: nextUsedCount >= Number(data.maxUses || 1) ? "used" : "active",
      lastUsedAt: FieldValue.serverTimestamp(),
      lastUsedBy: uid
    });
    transaction.set(useRef, {
      code,
      uid,
      type: data.type || "promo",
      email: user.email || tokenEmail,
      name: user.name || "",
      accountType: user.accountType || "",
      usedAt: FieldValue.serverTimestamp()
    });

    if (data.type === "early_access") {
      const configured = badgeSnapshot.exists ? badgeSnapshot.data() : FRIENDS_BADGE;
      const badge = {
        id: "friends",
        label: cleanText(configured.label || FRIENDS_BADGE.label, 80),
        icon: cleanText(configured.icon || FRIENDS_BADGE.icon, 8),
        tone: cleanText(configured.tone || FRIENDS_BADGE.tone, 30),
        description: cleanText(configured.description || FRIENDS_BADGE.description, 240)
      };
      transaction.set(db.doc(`userBadges/${uid}_friends`), {
        uid,
        badgeId: badge.id,
        label: badge.label,
        icon: badge.icon,
        tone: badge.tone,
        source: "early_access_code",
        code,
        assignedAt: FieldValue.serverTimestamp()
      });
      transaction.set(publicRef, { badges: { friends: { label: badge.label, icon: badge.icon, tone: badge.tone } } }, { merge: true });
      transaction.update(userRef, {
        earlyAccess: true,
        accessCode: code,
        badges: { friends: true },
        accessGrantedAt: FieldValue.serverTimestamp()
      });
      return { applied: true, type: "early_access", badgeId: "friends" };
    }

    if (data.type === "referral" && data.ownerUid && data.ownerUid !== uid) {
      transaction.set(db.doc(`referrals/${code}_${uid}`), {
        code,
        inviterUid: data.ownerUid,
        invitedUid: uid,
        invitedEmail: user.email || tokenEmail,
        invitedName: user.name || "",
        invitedAccountType: user.accountType || "",
        status: "pending",
        createdAt: FieldValue.serverTimestamp()
      });
      transaction.update(userRef, { referredByUid: data.ownerUid, referralCodeUsed: code });
      return { applied: true, type: "referral", inviterUid: data.ownerUid };
    }

    return { applied: true, type: data.type || "promo" };
  });
});
