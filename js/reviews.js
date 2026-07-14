import {
  collection, doc, serverTimestamp, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export function reviewDocId(order, reviewerUid) {
  return `${order.id}_${reviewerUid}`;
}

export function hasReviewedOrder(reviews, orderId, reviewerUid) {
  return reviews.some(review => review.orderId === orderId && review.reviewerUid === reviewerUid);
}

export function reviewTargetFor(order, reviewerUid) {
  if (!order || !reviewerUid) return null;
  if (reviewerUid === order.buyerUid) {
    return {
      targetUid: order.freelancerUid,
      targetName: order.freelancerName || "المستقل",
      targetType: "freelancer",
      reviewerType: "buyer"
    };
  }
  if (reviewerUid === order.freelancerUid) {
    return {
      targetUid: order.buyerUid,
      targetName: order.buyerName || "المشتري",
      targetType: "buyer",
      reviewerType: "freelancer"
    };
  }
  return null;
}

export function canReviewOrder(order, reviewerUid, reviews = []) {
  return order?.status === "completed"
    && Boolean(reviewTargetFor(order, reviewerUid))
    && !hasReviewedOrder(reviews, order.id, reviewerUid);
}

export function formatStars(rating) {
  const value = Math.max(0, Math.min(5, Math.round(Number(rating || 0))));
  return `${"★".repeat(value)}${"☆".repeat(5 - value)}`;
}

export function notificationData(title, body, relatedOrderId = "") {
  return {
    title,
    body,
    relatedOrderId,
    read: false,
    createdAt: serverTimestamp()
  };
}

export async function createOrderReview(db, order, user, profile, { rating, comment }) {
  const target = reviewTargetFor(order, user?.uid);
  if (!target) throw new Error("review-not-participant");
  if (order.status !== "completed") throw new Error("review-order-not-completed");

  const normalizedRating = Math.max(1, Math.min(5, Number(rating || 0)));
  if (!Number.isInteger(normalizedRating)) throw new Error("review-invalid-rating");

  const reviewRef = doc(db, "reviews", reviewDocId(order, user.uid));
  const batch = writeBatch(db);
  const review = {
    orderId: order.id,
    serviceId: String(order.serviceId || ""),
    serviceTitle: order.serviceTitle || "طلب خدمة",
    serviceCategory: order.serviceCategory || "",
    reviewerUid: user.uid,
    reviewerName: profile?.name || user.email || "مستخدم",
    reviewerType: target.reviewerType,
    targetUid: target.targetUid,
    targetName: target.targetName,
    targetType: target.targetType,
    rating: normalizedRating,
    comment: String(comment || "").trim().slice(0, 1000),
    status: "published",
    createdAt: serverTimestamp()
  };

  batch.set(reviewRef, review);
  batch.set(doc(collection(db, "notifications", target.targetUid, "items")), notificationData(
    "وصل تقييم جديد",
    `تم تقييم تجربة طلب "${order.serviceTitle || order.id}" ويمكنك متابعة التفاصيل من ملفك.`,
    order.id
  ));
  await batch.commit();
  return { id: reviewRef.id, ...review, createdAt: new Date() };
}
