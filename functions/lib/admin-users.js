const { onCall } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const {
  FieldValue, HttpsError, REGION, cleanText, db, notification, requireAdmin, storageBucket
} = require("./helpers");

function referralCode(user, uid) {
  const base = String(user.name || user.email || uid).split("@")[0]
    .toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "").replace(/-/g, "");
  return `${base || "PIK"}-${uid.slice(0, 5).toUpperCase()}`;
}

exports.reviewFreelancerApplication = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const admin = await requireAdmin(request, "verifications.manage");
  const userId = cleanText(request.data?.userId, 100);
  const action = cleanText(request.data?.action, 20);
  const reason = cleanText(request.data?.reason, 500);
  if (!userId || !["approve", "reject"].includes(action) || (action === "reject" && reason.length < 3)) {
    throw new HttpsError("invalid-argument", "بيانات القرار غير مكتملة.");
  }
  const userReference = db.doc(`users/${userId}`);
  const snapshot = await userReference.get();
  if (!snapshot.exists || snapshot.data().accountType !== "freelancer" || snapshot.data().status !== "pending") {
    throw new HttpsError("failed-precondition", "الطلب لم يعد معلقاً أو لم يعد متاحاً للمراجعة.");
  }
  const user = snapshot.data();
  const batch = db.batch();
  const auditReference = db.collection("adminAuditLogs").doc();
  if (action === "approve") {
    const code = user.referralCode || referralCode(user, userId);
    batch.update(userReference, { status: "active", approvedAt: FieldValue.serverTimestamp(), approvedBy: admin.id, referralCode: code });
    batch.set(db.doc(`publicProfiles/${userId}`), {
      name: user.name || "مستخدم PikLance", accountType: user.accountType, status: "active",
      referralCode: code, ...(user.specialty ? { specialty: user.specialty } : {})
    }, { merge: true });
    batch.set(db.doc(`promoCodes/${code}`), {
      code, type: "referral", status: "active", maxUses: 9999,
      usedCount: Number(user.referralUseCount || 0), ownerUid: userId,
      ownerName: user.name || user.email || "", discountPercent: 50, discountDays: 30,
      rewardEvery: 5, rewardDiscountPercent: 50, rewardDiscountDays: 30,
      updatedAt: FieldValue.serverTimestamp(), createdAt: user.referralCodeCreatedAt || FieldValue.serverTimestamp()
    }, { merge: true });
    if (user.referredByUid) {
      const previous = await db.collection("referrals")
        .where("inviterUid", "==", user.referredByUid)
        .where("status", "==", "approved")
        .count().get();
      const approvedCount = Number(previous.data().count || 0) + 1;
      batch.set(db.doc(`referrals/${user.referralCodeUsed || "manual"}_${userId}`), {
        inviterUid: user.referredByUid, invitedUid: userId, invitedEmail: user.email || "",
        invitedName: user.name || "", invitedAccountType: user.accountType, status: "approved",
        approvedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      if (approvedCount % 5 === 0) {
        batch.set(db.doc(`userBenefits/${user.referredByUid}_referral_${Math.floor(approvedCount / 5)}`), {
          uid: user.referredByUid, type: "platform_fee_discount", discountPercent: 50,
          durationDays: 30, source: "referral_reward", status: "active",
          referralMilestone: approvedCount, createdAt: FieldValue.serverTimestamp()
        }, { merge: true });
        batch.set(db.doc(`accountBenefits/${user.referredByUid}`), {
          commissionDiscountPercent: 50, active: true, source: "referral_reward",
          referralMilestone: approvedCount, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        batch.set(db.collection(`notifications/${user.referredByUid}/items`).doc(), notification(
          "مكافأة دعوة جديدة",
          "تم تسجيل 5 أشخاص عن طريقك. حصلت على شهر خصم 50% على عمولة المنصة.",
          { type: "referral_reward" }
        ));
      }
    }
  } else {
    batch.update(userReference, {
      status: "rejected", rejectionReason: reason, rejectedAt: FieldValue.serverTimestamp(), rejectedBy: admin.id,
      idNumber: FieldValue.delete(), idName: FieldValue.delete(), idFrontPath: FieldValue.delete(), idBackPath: FieldValue.delete()
    });
    batch.set(db.doc(`publicProfiles/${userId}`), {
      name: user.name || "مستخدم PikLance", accountType: user.accountType, status: "rejected",
      ...(user.specialty ? { specialty: user.specialty } : {})
    }, { merge: true });
  }
  batch.set(auditReference, {
    action: action === "approve" ? "approve_user" : "reject_user",
    actorUid: admin.id, actorName: admin.name || admin.email || "", actorEmail: admin.email || "",
    targetUid: userId, targetName: user.name || "", targetEmail: user.email || "", reason,
    createdAt: FieldValue.serverTimestamp()
  });
  await batch.commit();
  if (action === "reject") {
    await Promise.allSettled([
      ...[user.idFrontPath, user.idBackPath].filter(Boolean).map(path => storageBucket().file(path).delete()),
      getAuth().revokeRefreshTokens(userId)
    ]);
  }
  return { ok: true };
});

exports.setUserStatus = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const admin = await requireAdmin(request, "users.manage");
  const userId = cleanText(request.data?.userId, 128);
  const status = cleanText(request.data?.status, 20);
  const reason = cleanText(request.data?.reason, 500);
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(userId) || !["active", "suspended"].includes(status)) {
    throw new HttpsError("invalid-argument", "بيانات حالة الحساب غير صالحة.");
  }
  if (userId === admin.id) throw new HttpsError("failed-precondition", "لا يمكنك تغيير حالة حسابك الإداري الحالي.");
  if (status === "suspended" && reason.length < 3) throw new HttpsError("invalid-argument", "سبب إيقاف الحساب مطلوب.");

  const userReference = db.doc(`users/${userId}`);
  const publicReference = db.doc(`publicProfiles/${userId}`);
  const snapshot = await userReference.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "الحساب غير موجود.");
  const user = snapshot.data();
  if (user.role === "admin" && admin.adminAccessLevel !== "super_admin" && admin.adminRoleId) {
    throw new HttpsError("permission-denied", "تغيير حالة حساب إداري يتطلب الإدارة الكاملة.");
  }

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  batch.update(userReference, status === "suspended"
    ? { status, suspensionReason: reason, suspendedAt: now, suspendedBy: admin.id }
    : { status, suspensionReason: FieldValue.delete(), reactivatedAt: now, reactivatedBy: admin.id });
  batch.set(publicReference, { status }, { merge: true });
  batch.set(db.collection("adminAuditLogs").doc(), {
    action: status === "suspended" ? "suspend_user" : "activate_user",
    actorUid: admin.id,
    actorName: admin.name || admin.email || "الإدارة",
    actorEmail: admin.email || "",
    targetUid: userId,
    targetName: user.name || "",
    targetEmail: user.email || "",
    reason,
    createdAt: now
  });
  await batch.commit();
  if (status === "suspended") await getAuth().revokeRefreshTokens(userId);
  return { ok: true, userId, status };
});
