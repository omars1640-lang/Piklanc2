import {
  Timestamp, collection, doc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const ESCROW_REVIEW_DAYS = 15;
export const PLATFORM_FEE_PERCENT = 20;

export const orderStatusLabels = {
  funded: "طلب تجريبي جاهز للتنفيذ",
  active: "قيد التنفيذ",
  delivered: "بانتظار مراجعة العميل",
  completed: "مكتمل وتم تحرير المبلغ",
  disputed: "نزاع مفتوح",
  cancelled: "ملغي"
};

export function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("ar-SY")} ل.س`;
}

export function calculateEscrow(total) {
  const amount = Number(total || 0);
  const platformFeeAmount = Math.round(amount * PLATFORM_FEE_PERCENT / 100);
  return {
    amount,
    platformFeePercent: PLATFORM_FEE_PERCENT,
    platformFeeAmount,
    freelancerAmount: Math.max(0, amount - platformFeeAmount),
    currency: "SYP"
  };
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function toDate(value) {
  return value?.toDate?.() || (value ? new Date(value) : null);
}

export function canAutoRelease(order) {
  const releaseAt = toDate(order.autoReleaseAt);
  return order.status === "delivered"
    && order.escrow?.status === "review_hold"
    && releaseAt
    && releaseAt.getTime() <= Date.now();
}

function notificationData(title, body, relatedOrderId = "") {
  return {
    title,
    body,
    relatedOrderId,
    read: false,
    createdAt: serverTimestamp()
  };
}

export async function createEscrowOrder(db, { user, buyerName, service, packageInfo, sellerUid }) {
  if (!user) throw new Error("auth-required");
  if (!sellerUid) throw new Error("seller-required");
  const total = Number(packageInfo.price || service.price || 0);
  if (!total || total < 1) throw new Error("invalid-total");

  const escrow = calculateEscrow(total);
  const orderRef = doc(collection(db, "orders"));
  const batch = writeBatch(db);

  batch.set(orderRef, {
    buyerUid: user.uid,
    buyerName: buyerName || user.email || "عميل",
    buyerEmail: user.email || "",
    freelancerUid: sellerUid,
    freelancerName: service.seller?.name || "مستقل",
    serviceId: String(service.id || ""),
    serviceTitle: service.title || "طلب خدمة",
    serviceCategory: service.category || "",
    serviceImage: service.images?.[0] || "",
    packageName: packageInfo.name || "أساسية",
    packageDelivery: packageInfo.delivery || "",
    packageRevisions: packageInfo.revisions || "",
    total,
    platformFeePercent: escrow.platformFeePercent,
    platformFeeAmount: escrow.platformFeeAmount,
    freelancerAmount: escrow.freelancerAmount,
    reviewDays: ESCROW_REVIEW_DAYS,
    status: "funded",
    escrow: {
      ...escrow,
      status: "held",
      heldForOrderId: orderRef.id,
      releaseScope: "single_order"
    },
    payment: {
      status: "sandbox_confirmed",
      method: "sandbox_test",
      mode: "sandbox",
      note: "Test order only. No real money was collected."
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.set(doc(collection(db, "notifications", user.uid, "items")), notificationData(
    "تم إنشاء طلب تجريبي",
    `تم تسجيل ${formatMoney(total)} كرصيد تجريبي محجوز لهذا الطلب فقط.`,
    orderRef.id
  ));
  batch.set(doc(collection(db, "notifications", sellerUid, "items")), notificationData(
    "طلب تجريبي جديد",
    `وصلك طلب تجريبي بقيمة ${formatMoney(total)} لاختبار التنفيذ والتسليم.`,
    orderRef.id
  ));

  await batch.commit();
  return orderRef.id;
}

export async function deliverEscrowOrder(db, order, deliveryNote = "") {
  const now = new Date();
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", order.id), {
    status: "delivered",
    deliveryNote: deliveryNote.trim().slice(0, 1000),
    deliveredAt: serverTimestamp(),
    autoReleaseAt: Timestamp.fromDate(addDays(now, ESCROW_REVIEW_DAYS)),
    "escrow.status": "review_hold",
    "escrow.reviewStartedAt": serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(collection(db, "notifications", order.buyerUid, "items")), notificationData(
    "تم تسليم طلبك",
    `سلّم المستقل طلب ${order.serviceTitle || order.id}. لديك 15 يوماً للمراجعة قبل الإغلاق التجريبي.`,
    order.id
  ));
  await batch.commit();
}

export async function approveEscrowOrder(db, order) {
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", order.id), {
    status: "completed",
    releaseType: "manual_approval",
    completedAt: serverTimestamp(),
    releasedAt: serverTimestamp(),
    "escrow.status": "released",
    "escrow.releasedAt": serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(collection(db, "notifications", order.freelancerUid, "items")), notificationData(
    "قبِل العميل التسليم",
    `تم إكمال طلب ${order.serviceTitle || order.id} وتحرير رصيده التجريبي.`,
    order.id
  ));
  await batch.commit();
}

export async function autoReleaseEscrowOrder(db, order) {
  if (!canAutoRelease(order)) return false;
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", order.id), {
    status: "completed",
    releaseType: "auto_after_review_window",
    completedAt: serverTimestamp(),
    releasedAt: serverTimestamp(),
    "escrow.status": "released",
    "escrow.releasedAt": serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(collection(db, "notifications", order.freelancerUid, "items")), notificationData(
    "انتهت مهلة المراجعة",
    `أُغلق طلب ${order.serviceTitle || order.id} وتحرر رصيده التجريبي لعدم فتح نزاع.`,
    order.id
  ));
  await batch.commit();
  return true;
}

export async function disputeEscrowOrder(db, order, user, reason = "") {
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", order.id), {
    status: "disputed",
    disputedAt: serverTimestamp(),
    "escrow.status": "disputed",
    "escrow.disputedAt": serverTimestamp(),
    dispute: {
      status: "open",
      openedByUid: user.uid,
      reason: reason.trim().slice(0, 1000),
      createdAt: serverTimestamp()
    },
    updatedAt: serverTimestamp()
  });
  const otherUid = user.uid === order.buyerUid ? order.freelancerUid : order.buyerUid;
  batch.set(doc(collection(db, "notifications", otherUid, "items")), notificationData(
    "فُتح نزاع على طلب",
    `تم إيقاف رصيد طلب ${order.serviceTitle || order.id} وحده حتى مراجعة الدعم.`,
    order.id
  ));
  await batch.commit();
}
