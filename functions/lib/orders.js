const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  CURRENCY, CURRENCY_VERSION, FieldValue, HttpsError, REGION, Timestamp, cleanText, db, ledgerEntry,
  notification, platformReference, requireAuth, requireCurrencyReady, requireProfile, walletData
} = require("./helpers");

const REVIEW_DAYS = 15;

function percent(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Math.min(100, Math.max(0, Number.isFinite(number) ? number : fallback));
}

function activeBenefit(snapshot) {
  if (!snapshot?.exists) return {};
  const value = snapshot.data();
  const expires = value.expiresAt?.toDate?.();
  if (value.active === false || (expires && expires.getTime() <= Date.now())) return {};
  return value;
}

async function releaseOrder(orderRef, expectedBuyerUid = "") {
  await requireCurrencyReady();
  return db.runTransaction(async transaction => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) throw new HttpsError("not-found", "الطلب غير موجود.");
    const order = orderSnapshot.data();
    if (expectedBuyerUid && order.buyerUid !== expectedBuyerUid) throw new HttpsError("permission-denied", "لا تملك هذا الطلب.");
    if (order.payment?.method !== "wallet") throw new HttpsError("failed-precondition", "هذا الطلب قديم ولا يرتبط بالمحفظة الحالية.");
    if (order.status === "completed" && order.escrow?.status === "released") return false;
    if (order.status !== "delivered" || order.escrow?.status !== "review_hold") {
      throw new HttpsError("failed-precondition", "الطلب غير جاهز لتحرير المبلغ.");
    }
    const buyerWalletRef = db.doc(`wallets/${order.buyerUid}`);
    const freelancerWalletRef = db.doc(`wallets/${order.freelancerUid}`);
    const [buyerWalletSnapshot, freelancerWalletSnapshot] = await Promise.all([
      transaction.get(buyerWalletRef), transaction.get(freelancerWalletRef)
    ]);
    const buyerWallet = walletData(buyerWalletSnapshot.exists ? buyerWalletSnapshot.data() : {});
    const freelancerWallet = walletData(freelancerWalletSnapshot.exists ? freelancerWalletSnapshot.data() : {});
    if (buyerWallet.held < order.total) throw new HttpsError("failed-precondition", "الرصيد المحجوز غير متطابق.");
    const buyerNext = { ...buyerWallet, held: buyerWallet.held - order.total, updatedAt: FieldValue.serverTimestamp() };
    const freelancerNext = {
      ...freelancerWallet,
      available: freelancerWallet.available + order.freelancerAmount,
      lifetimeEarnings: freelancerWallet.lifetimeEarnings + order.freelancerAmount,
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.set(buyerWalletRef, buyerNext, { merge: true });
    transaction.set(freelancerWalletRef, freelancerNext, { merge: true });
    transaction.update(orderRef, {
      status: "completed",
      releaseType: expectedBuyerUid ? "manual_approval" : "auto_after_review_window",
      completedAt: FieldValue.serverTimestamp(),
      releasedAt: FieldValue.serverTimestamp(),
      "escrow.status": "released",
      "escrow.releasedAt": FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    ledgerEntry(transaction, order.buyerUid, {
      type: "order_released", direction: "debit", amount: order.total,
      availableDelta: 0, heldDelta: -order.total, pendingWithdrawalDelta: 0,
      referenceType: "order", referenceId: orderRef.id, reference: order.reference,
      balanceAfter: buyerNext.available, actorUid: expectedBuyerUid || "system"
    });
    ledgerEntry(transaction, order.freelancerUid, {
      type: "earning_released", direction: "credit", amount: order.freelancerAmount,
      availableDelta: order.freelancerAmount, heldDelta: 0, pendingWithdrawalDelta: 0,
      referenceType: "order", referenceId: orderRef.id, reference: order.reference,
      balanceAfter: freelancerNext.available, actorUid: expectedBuyerUid || "system"
    });
    transaction.set(db.collection(`notifications/${order.freelancerUid}/items`).doc(), notification(
      expectedBuyerUid ? "قبِل العميل التسليم" : "انتهت مهلة المراجعة",
      `تم تحرير ${order.freelancerAmount.toLocaleString("ar-SY-u-nu-latn")} ل.س إلى رصيدك عن الطلب ${order.reference}.`,
      { relatedOrderId: orderRef.id }
    ));
    return true;
  });
}

exports.createWalletOrder = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const uid = requireAuth(request);
  await requireCurrencyReady();
  const buyer = await requireProfile(uid, "buyer");
  const serviceId = cleanText(request.data?.serviceId, 100);
  if (!serviceId) throw new HttpsError("invalid-argument", "الخدمة غير محددة.");
  const serviceRef = db.doc(`services/${serviceId}`);
  const serviceSnapshot = await serviceRef.get();
  if (!serviceSnapshot.exists || serviceSnapshot.data().status !== "published") {
    throw new HttpsError("not-found", "الخدمة غير متاحة.");
  }
  const service = serviceSnapshot.data();
  if (!service.ownerUid || service.ownerUid === uid) throw new HttpsError("failed-precondition", "لا يمكن شراء هذه الخدمة.");
  await requireProfile(service.ownerUid, "freelancer");

  const orderRef = db.collection("orders").doc();
  const walletRef = db.doc(`wallets/${uid}`);
  const settingsRef = db.doc("platformSettings/general");
  const buyerBenefitRef = db.doc(`accountBenefits/${uid}`);
  const sellerBenefitRef = db.doc(`accountBenefits/${service.ownerUid}`);
  const reference = platformReference("ORD", orderRef.id);

  await db.runTransaction(async transaction => {
    const [freshServiceSnapshot, walletSnapshot, settingsSnapshot, buyerBenefitSnapshot, sellerBenefitSnapshot] = await Promise.all([
      transaction.get(serviceRef), transaction.get(walletRef), transaction.get(settingsRef),
      transaction.get(buyerBenefitRef), transaction.get(sellerBenefitRef)
    ]);
    const freshService = freshServiceSnapshot.data();
    if (!freshServiceSnapshot.exists || freshService.status !== "published") throw new HttpsError("not-found", "الخدمة لم تعد متاحة.");
    const listPrice = Number(freshService.price || 0);
    if (!Number.isSafeInteger(listPrice) || listPrice < 1) throw new HttpsError("failed-precondition", "سعر الخدمة غير صالح.");
    const wallet = walletData(walletSnapshot.exists ? walletSnapshot.data() : {});
    const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
    const buyerBenefit = activeBenefit(buyerBenefitSnapshot);
    const sellerBenefit = activeBenefit(sellerBenefitSnapshot);
    const buyerDiscountPercent = percent(buyerBenefit.buyerDiscountPercent, 0);
    const commissionDiscountPercent = percent(sellerBenefit.commissionDiscountPercent, 0);
    const baseFeePercent = percent(settings.platformFeePercent, 20);
    const effectiveFeePercent = baseFeePercent * (1 - commissionDiscountPercent / 100);
    const buyerDiscountAmount = Math.round(listPrice * buyerDiscountPercent / 100);
    const total = Math.max(1, listPrice - buyerDiscountAmount);
    const platformFeeAmount = Math.round(total * effectiveFeePercent / 100);
    const freelancerAmount = total - platformFeeAmount;
    if (wallet.available < total) {
      throw new HttpsError("failed-precondition", `الرصيد غير كافٍ. تحتاج إلى ${total - wallet.available} ل.س إضافية.`);
    }
    const walletNext = {
      ...wallet,
      available: wallet.available - total,
      held: wallet.held + total,
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.set(walletRef, walletNext, { merge: true });
    transaction.set(orderRef, {
      reference,
      buyerUid: uid,
      buyerName: buyer.name || buyer.email || "عميل",
      buyerEmail: buyer.email || request.auth.token.email || "",
      freelancerUid: freshService.ownerUid,
      freelancerName: freshService.ownerName || "مستقل",
      serviceId,
      serviceTitle: freshService.title || "طلب خدمة",
      serviceCategory: freshService.category || "",
      serviceImage: freshService.imageUrl || "",
      packageName: "الخدمة الأساسية",
      packageDelivery: `${Number(freshService.deliveryDays || 1)} يوم`,
      packageRevisions: String(freshService.revisions ?? ""),
      listPrice,
      buyerDiscountPercent,
      buyerDiscountAmount,
      total,
      basePlatformFeePercent: baseFeePercent,
      commissionDiscountPercent,
      platformFeePercent: effectiveFeePercent,
      platformFeeAmount,
      freelancerAmount,
      pricingSnapshot: {
        buyerBenefitSource: cleanText(buyerBenefit.sourceCode || buyerBenefit.source || "", 100),
        sellerBenefitSource: cleanText(sellerBenefit.sourceCode || sellerBenefit.source || "", 100)
      },
      reviewDays: REVIEW_DAYS,
      status: "funded",
      escrow: {
        amount: total, currency: CURRENCY, status: "held",
        freelancerAmount, platformFeeAmount, heldForOrderId: orderRef.id,
        releaseScope: "single_order"
      },
      payment: { status: "wallet_confirmed", method: "wallet", mode: "live", walletUid: uid },
      currencyVersion: CURRENCY_VERSION,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    ledgerEntry(transaction, uid, {
      type: "order_funded", direction: "hold", amount: total,
      availableDelta: -total, heldDelta: total, pendingWithdrawalDelta: 0,
      referenceType: "order", referenceId: orderRef.id, reference,
      balanceAfter: walletNext.available, actorUid: uid
    });
    transaction.set(db.collection(`notifications/${uid}/items`).doc(), notification(
      "تم شراء الخدمة",
      `تم حجز ${total.toLocaleString("ar-SY-u-nu-latn")} ل.س للطلب ${reference}.`,
      { relatedOrderId: orderRef.id }
    ));
    transaction.set(db.collection(`notifications/${freshService.ownerUid}/items`).doc(), notification(
      "طلب جديد",
      `وصلك طلب جديد بقيمة صافية ${freelancerAmount.toLocaleString("ar-SY-u-nu-latn")} ل.س.`,
      { relatedOrderId: orderRef.id }
    ));
  });
  return { orderId: orderRef.id, reference };
});

exports.approveWalletOrder = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const uid = requireAuth(request);
  const orderId = cleanText(request.data?.orderId, 100);
  if (!orderId) throw new HttpsError("invalid-argument", "الطلب غير محدد.");
  await releaseOrder(db.doc(`orders/${orderId}`), uid);
  return { orderId, status: "completed" };
});

exports.deliverWalletOrder = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const uid = requireAuth(request);
  await requireProfile(uid, "freelancer");
  const orderId = cleanText(request.data?.orderId, 100);
  const deliveryNote = cleanText(request.data?.deliveryNote, 1000);
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(orderId) || deliveryNote.length < 3) throw new HttpsError("invalid-argument", "بيانات التسليم غير مكتملة.");
  const orderRef = db.doc(`orders/${orderId}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "الطلب غير موجود.");
    const order = snapshot.data();
    if (order.freelancerUid !== uid) throw new HttpsError("permission-denied", "لا تملك هذا الطلب.");
    if (!["funded", "active"].includes(order.status) || order.escrow?.status !== "held") throw new HttpsError("failed-precondition", "الطلب غير جاهز للتسليم.");
    transaction.update(orderRef, {
      status: "delivered",
      deliveryNote,
      deliveredAt: FieldValue.serverTimestamp(),
      autoReleaseAt: Timestamp.fromMillis(Date.now() + REVIEW_DAYS * 24 * 60 * 60 * 1000),
      "escrow.status": "review_hold",
      "escrow.reviewStartedAt": FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(db.collection(`notifications/${order.buyerUid}/items`).doc(), notification(
      "تم تسليم طلبك",
      `سلّم المستقل طلب ${cleanText(order.serviceTitle || order.reference, 180)}. لديك ${REVIEW_DAYS} يوماً للمراجعة قبل تحرير المبلغ تلقائياً.`,
      { relatedOrderId: orderId }
    ));
  });
  return { orderId, status: "delivered" };
});

exports.disputeWalletOrder = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const uid = requireAuth(request);
  await requireProfile(uid);
  const orderId = cleanText(request.data?.orderId, 100);
  const reason = cleanText(request.data?.reason, 1000);
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(orderId) || reason.length < 3) throw new HttpsError("invalid-argument", "سبب النزاع وبيانات الطلب مطلوبة.");
  const orderRef = db.doc(`orders/${orderId}`);
  let otherUid = "";
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "الطلب غير موجود.");
    const order = snapshot.data();
    if (![order.buyerUid, order.freelancerUid].includes(uid)) throw new HttpsError("permission-denied", "لست طرفاً في هذا الطلب.");
    if (!["funded", "active", "delivered"].includes(order.status) || !["held", "review_hold"].includes(order.escrow?.status)) {
      throw new HttpsError("failed-precondition", "لا يمكن فتح نزاع على حالة الطلب الحالية.");
    }
    otherUid = uid === order.buyerUid ? order.freelancerUid : order.buyerUid;
    transaction.update(orderRef, {
      status: "disputed",
      disputedAt: FieldValue.serverTimestamp(),
      "escrow.status": "disputed",
      "escrow.disputedAt": FieldValue.serverTimestamp(),
      dispute: { status: "open", openedByUid: uid, reason, createdAt: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(db.collection(`notifications/${otherUid}/items`).doc(), notification(
      "فُتح نزاع على طلب",
      `تم إيقاف رصيد طلب ${cleanText(order.serviceTitle || order.reference, 180)} وحده حتى مراجعة الدعم.`,
      { relatedOrderId: orderId }
    ));
  });
  return { orderId, status: "disputed", otherUid };
});

exports.releaseDueOrders = onSchedule({ region: REGION, schedule: "every 60 minutes", timeZone: "Asia/Damascus" }, async () => {
  const snapshot = await db.collection("orders")
    .where("status", "==", "delivered")
    .where("payment.method", "==", "wallet")
    .where("autoReleaseAt", "<=", Timestamp.now())
    .limit(100).get();
  for (const document of snapshot.docs) {
    try {
      await releaseOrder(document.ref);
    } catch (error) {
      console.error("Unable to auto-release order", document.id, error);
    }
  }
});

module.exports.releaseOrder = releaseOrder;
