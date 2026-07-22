import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { functions } from "./firebase.js";

export const ESCROW_REVIEW_DAYS = 15;
export const DEFAULT_PLATFORM_FEE_PERCENT = 20;

export const orderStatusLabels = {
  funded: "تم الدفع وجاهز للتنفيذ",
  active: "قيد التنفيذ",
  delivered: "بانتظار مراجعة العميل",
  completed: "مكتمل وتم تحرير المبلغ",
  disputed: "نزاع مفتوح",
  cancelled: "ملغي"
};

export function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("en-US")} ل.س`;
}

export function calculateEscrow(total, feePercent = DEFAULT_PLATFORM_FEE_PERCENT) {
  const amount = Number(total || 0);
  const normalizedFee = Math.min(100, Math.max(0, Number(feePercent ?? DEFAULT_PLATFORM_FEE_PERCENT)));
  const platformFeeAmount = amount * normalizedFee / 100;
  return {
    amount,
    platformFeePercent: normalizedFee,
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

export async function createEscrowOrder(db, { user, buyerName, service, packageInfo, sellerUid }) {
  if (!user) throw new Error("auth-required");
  if (!sellerUid) throw new Error("seller-required");
  const call = httpsCallable(functions, "createWalletOrder");
  const result = await call({ serviceId: String(service.id || "") });
  return result.data.orderId;
}

export async function deliverEscrowOrder(db, order, deliveryNote = "") {
  await httpsCallable(functions, "deliverWalletOrder")({ orderId: order.id, deliveryNote: deliveryNote.trim().slice(0, 1000) });
}

export async function approveEscrowOrder(db, order) {
  const call = httpsCallable(functions, "approveWalletOrder");
  await call({ orderId: order.id });
}

export async function autoReleaseEscrowOrder(db, order) {
  return false;
}

export async function disputeEscrowOrder(db, order, user, reason = "") {
  await httpsCallable(functions, "disputeWalletOrder")({ orderId: order.id, reason: reason.trim().slice(0, 1000) });
}
