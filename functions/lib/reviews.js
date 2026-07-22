const { onCall } = require("firebase-functions/v2/https");
const { FieldValue, HttpsError, REGION, cleanText, db, notification, requireAuth, requireProfile } = require("./helpers");

exports.createOrderReview = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const uid = requireAuth(request);
  const reviewer = await requireProfile(uid);
  const orderId = cleanText(request.data?.orderId, 100);
  const rating = Number(request.data?.rating);
  const comment = cleanText(request.data?.comment, 1000);
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(orderId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpsError("invalid-argument", "بيانات التقييم غير صالحة.");
  }
  const orderRef = db.doc(`orders/${orderId}`);
  const reviewRef = db.doc(`reviews/${orderId}_${uid}`);
  const result = await db.runTransaction(async transaction => {
    const [orderSnapshot, existing] = await Promise.all([transaction.get(orderRef), transaction.get(reviewRef)]);
    if (!orderSnapshot.exists || orderSnapshot.data().status !== "completed") throw new HttpsError("failed-precondition", "الطلب غير مكتمل أو غير موجود.");
    if (existing.exists) throw new HttpsError("already-exists", "تم تقييم هذا الطلب مسبقاً.");
    const order = orderSnapshot.data();
    if (![order.buyerUid, order.freelancerUid].includes(uid)) throw new HttpsError("permission-denied", "لست طرفاً في هذا الطلب.");
    const reviewerType = uid === order.buyerUid ? "buyer" : "freelancer";
    const targetUid = reviewerType === "buyer" ? order.freelancerUid : order.buyerUid;
    const targetType = reviewerType === "buyer" ? "freelancer" : "buyer";
    const targetSnapshot = await transaction.get(db.doc(`users/${targetUid}`));
    if (!targetSnapshot.exists) throw new HttpsError("not-found", "الحساب المستهدف غير موجود.");
    const target = targetSnapshot.data();
    const review = {
      orderId,
      serviceId: cleanText(order.serviceId, 100),
      serviceTitle: cleanText(order.serviceTitle || "طلب خدمة", 180),
      serviceCategory: cleanText(order.serviceCategory, 120),
      reviewerUid: uid,
      reviewerName: cleanText(reviewer.name || reviewer.email, 160),
      reviewerType,
      targetUid,
      targetName: cleanText(target.name || target.email, 160),
      targetType,
      rating,
      comment,
      status: "published",
      createdAt: FieldValue.serverTimestamp()
    };
    transaction.create(reviewRef, review);
    transaction.create(db.collection(`notifications/${targetUid}/items`).doc(), notification(
      "وصل تقييم جديد",
      `تم تقييم تجربة طلب "${review.serviceTitle}" ويمكنك متابعة التفاصيل من ملفك.`,
      { relatedOrderId: orderId }
    ));
    return review;
  });
  return { id: reviewRef.id, ...result };
});
