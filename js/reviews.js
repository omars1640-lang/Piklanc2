import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { functions } from "./firebase.js";

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

export async function createOrderReview(db, order, user, profile, { rating, comment }) {
  const target = reviewTargetFor(order, user?.uid);
  if (!target) throw new Error("review-not-participant");
  if (order.status !== "completed") throw new Error("review-order-not-completed");

  const normalizedRating = Math.max(1, Math.min(5, Number(rating || 0)));
  if (!Number.isInteger(normalizedRating)) throw new Error("review-invalid-rating");

  const result = await httpsCallable(functions, "createOrderReview")({
    orderId: order.id,
    rating: normalizedRating,
    comment: String(comment || "").trim().slice(0, 1000)
  });
  return { ...result.data, createdAt: new Date() };
}
