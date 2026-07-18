const { onCall } = require("firebase-functions/v2/https");
const { createHash } = require("node:crypto");
const {
  CURRENCY, CURRENCY_VERSION, FieldValue, HttpsError, REGION, assertStorageObject, cleanText, db,
  integerAmount, ledgerEntry, notification, platformReference, queueEmail,
  requireAdmin, requireAuth, requireCurrencyReady, requireProfile, walletData
} = require("./helpers");

// New Syrian lira: all monetary values are stored without the two removed zeros.
const DEPOSIT_MIN = 1;
const DEPOSIT_MAX = 100;
const WITHDRAWAL_MIN = 1;
const WITHDRAWAL_MAX = 50;

exports.submitDepositRequest = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  const uid = requireAuth(request);
  const profile = await requireProfile(uid, "buyer");
  const amount = integerAmount(request.data?.amount, DEPOSIT_MIN, DEPOSIT_MAX);
  const providerId = cleanText(request.data?.providerId, 40);
  if (providerId !== "sham_cash") throw new HttpsError("invalid-argument", "وسيلة الدفع غير مدعومة.");

  const requestId = cleanText(request.data?.requestId, 80);
  if (!/^[A-Za-z0-9]{12,80}$/.test(requestId)) throw new HttpsError("invalid-argument", "رقم الطلب غير صالح.");
  const transferReference = cleanText(request.data?.transferReference, 100);
  if (transferReference.length < 4) throw new HttpsError("invalid-argument", "أدخل رقم حوالة شام كاش.");
  const requestedReceiptPath = cleanText(request.data?.receiptPath, 500);
  const receiptBase = `payment-receipts/${uid}/${requestId}/receipt.`;
  if (!requestedReceiptPath.startsWith(receiptBase) || !["jpg", "png", "webp"].includes(requestedReceiptPath.slice(receiptBase.length))) {
    throw new HttpsError("invalid-argument", "مسار إيصال التحويل غير صالح.");
  }
  const receiptPath = await assertStorageObject(requestedReceiptPath, uid, "payment-receipts");
  const requestRef = db.doc(`depositRequests/${requestId}`);
  const reference = platformReference("DEP", requestId);
  const providerReferenceId = createHash("sha256").update(`${providerId}:${transferReference.toLowerCase()}`).digest("hex");
  const providerReferenceRef = db.doc(`paymentProviderReferences/${providerReferenceId}`);
  await db.runTransaction(async transaction => {
    const [existing, providerReferenceSnapshot] = await Promise.all([
      transaction.get(requestRef), transaction.get(providerReferenceRef)
    ]);
    if (existing.exists) throw new HttpsError("already-exists", "تم إرسال هذا الطلب مسبقاً.");
    if (providerReferenceSnapshot.exists) throw new HttpsError("already-exists", "رقم الحوالة مستخدم في طلب سابق.");
    transaction.set(providerReferenceRef, {
      providerId, transferReference, requestId, reference,
      createdAt: FieldValue.serverTimestamp()
    });
    transaction.set(requestRef, {
      reference,
      userUid: uid,
      userName: profile.name || "عميل PikLance",
      userEmail: profile.email || request.auth.token.email || "",
      amount,
      currency: CURRENCY,
      currencyVersion: CURRENCY_VERSION,
      providerId,
      providerMode: "manual",
      transferReference,
      receiptPath,
      status: "pending",
      reviewWindow: "2-6 business hours",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { requestId, reference, status: "pending" };
});

exports.reviewDepositRequest = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  const admin = await requireAdmin(request, "finance.manage");
  await requireCurrencyReady();
  const requestId = cleanText(request.data?.requestId, 80);
  const decision = cleanText(request.data?.decision, 20);
  const reason = cleanText(request.data?.reason, 500);
  if (!requestId || !["approve", "reject"].includes(decision)) {
    throw new HttpsError("invalid-argument", "بيانات المراجعة غير مكتملة.");
  }
  if (decision === "reject" && reason.length < 3) {
    throw new HttpsError("invalid-argument", "اكتب سبب الرفض بوضوح.");
  }

  const requestRef = db.doc(`depositRequests/${requestId}`);
  await db.runTransaction(async transaction => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) throw new HttpsError("not-found", "طلب الشحن غير موجود.");
    const deposit = requestSnapshot.data();
    if (deposit.status !== "pending") throw new HttpsError("failed-precondition", "تمت مراجعة الطلب سابقاً.");
    const walletRef = db.doc(`wallets/${deposit.userUid}`);
    const walletSnapshot = await transaction.get(walletRef);
    const wallet = walletData(walletSnapshot.exists ? walletSnapshot.data() : {});
    const nowFields = {
      status: decision === "approve" ? "approved" : "rejected",
      reviewReason: reason,
      reviewedBy: admin.id,
      reviewedByName: admin.name || admin.email || "الإدارة",
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.update(requestRef, nowFields);
    const userNotificationRef = db.collection(`notifications/${deposit.userUid}/items`).doc();

    if (decision === "approve") {
      const next = {
        ...wallet,
        available: wallet.available + deposit.amount,
        lifetimeDeposits: wallet.lifetimeDeposits + deposit.amount,
        updatedAt: FieldValue.serverTimestamp()
      };
      transaction.set(walletRef, next, { merge: true });
      ledgerEntry(transaction, deposit.userUid, {
        type: "deposit_approved",
        direction: "credit",
        amount: deposit.amount,
        availableDelta: deposit.amount,
        heldDelta: 0,
        pendingWithdrawalDelta: 0,
        referenceType: "deposit",
        referenceId: requestId,
        reference: deposit.reference,
        balanceAfter: next.available,
        actorUid: admin.id
      });
      transaction.set(userNotificationRef, notification(
        "تمت الموافقة على شحن الرصيد",
        `تمت إضافة ${deposit.amount.toLocaleString("ar-SY-u-nu-latn")} ل.س إلى محفظتك. رقم العملية ${deposit.reference}.`,
        { relatedDepositId: requestId }
      ));
      queueEmail(transaction, {
        to: deposit.userEmail,
        subject: `تمت الموافقة على شحن رصيدك - ${deposit.reference}`,
        text: `مرحباً ${deposit.userName}،\n\nتمت الموافقة على عملية شحن الرصيد وإضافة ${deposit.amount} ل.س إلى محفظتك.\nرقم العملية: ${deposit.reference}\n\nفريق PikLance`,
        template: "deposit_approved",
        reference: deposit.reference
      });
    } else {
      transaction.set(userNotificationRef, notification(
        "تم رفض طلب شحن الرصيد",
        `لم تتم الموافقة على العملية ${deposit.reference}. السبب: ${reason}`,
        { relatedDepositId: requestId }
      ));
      queueEmail(transaction, {
        to: deposit.userEmail,
        subject: `تعذر اعتماد شحن الرصيد - ${deposit.reference}`,
        text: `مرحباً ${deposit.userName}،\n\nتم رفض طلب شحن الرصيد رقم ${deposit.reference}.\nالسبب: ${reason}\n\nيمكنك تقديم طلب جديد بعد تصحيح المشكلة.\nفريق PikLance`,
        template: "deposit_rejected",
        reference: deposit.reference
      });
    }
    transaction.set(db.collection("adminAuditLogs").doc(), {
      action: decision === "approve" ? "approve_deposit" : "reject_deposit",
      actorUid: admin.id,
      actorName: admin.name || admin.email || "الإدارة",
      actorEmail: admin.email || "",
      targetUid: deposit.userUid,
      targetName: deposit.userName || "",
      targetEmail: deposit.userEmail || "",
      reason: reason || deposit.reference,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return { requestId, status: decision === "approve" ? "approved" : "rejected" };
});

exports.requestWithdrawal = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  const uid = requireAuth(request);
  await requireCurrencyReady();
  const profile = await requireProfile(uid, "freelancer");
  const amount = integerAmount(request.data?.amount, WITHDRAWAL_MIN, WITHDRAWAL_MAX);
  const providerId = cleanText(request.data?.providerId, 40);
  if (providerId !== "sham_cash") throw new HttpsError("invalid-argument", "وسيلة السحب غير مدعومة.");
  const holderName = cleanText(request.data?.holderName, 120);
  const walletNumber = cleanText(request.data?.walletNumber, 100);
  if (holderName.length < 5 || walletNumber.length < 8) {
    throw new HttpsError("invalid-argument", "الاسم الثلاثي ورقم المحفظة مطلوبان.");
  }
  const requestedQrPath = cleanText(request.data?.qrPath, 500);
  const qrBase = `payout-qr/${uid}/sham_cash/qr.`;
  if (!requestedQrPath.startsWith(qrBase) || !["jpg", "png", "webp"].includes(requestedQrPath.slice(qrBase.length))) {
    throw new HttpsError("invalid-argument", "مسار صورة QR غير صالح.");
  }
  const qrPath = await assertStorageObject(requestedQrPath, uid, "payout-qr");
  const requestRef = db.collection("withdrawalRequests").doc();
  const walletRef = db.doc(`wallets/${uid}`);
  const payoutRef = db.doc(`payoutMethods/${uid}/items/sham_cash`);
  const reference = platformReference("WDR", requestRef.id);

  await db.runTransaction(async transaction => {
    const walletSnapshot = await transaction.get(walletRef);
    const wallet = walletData(walletSnapshot.exists ? walletSnapshot.data() : {});
    if (wallet.available < amount) throw new HttpsError("failed-precondition", "الرصيد المتاح غير كافٍ.");
    const next = {
      ...wallet,
      available: wallet.available - amount,
      pendingWithdrawal: wallet.pendingWithdrawal + amount,
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.set(walletRef, next, { merge: true });
    transaction.set(payoutRef, {
      providerId,
      holderName,
      walletNumber,
      qrPath,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(requestRef, {
      reference,
      userUid: uid,
      userName: profile.name || "مستقل PikLance",
      userEmail: profile.email || request.auth.token.email || "",
      amount,
      currency: CURRENCY,
      currencyVersion: CURRENCY_VERSION,
      providerId,
      providerMode: "manual",
      payout: { holderName, walletNumber, qrPath },
      status: "pending",
      reviewWindow: "24-48 hours",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    ledgerEntry(transaction, uid, {
      type: "withdrawal_requested",
      direction: "hold",
      amount,
      availableDelta: -amount,
      heldDelta: 0,
      pendingWithdrawalDelta: amount,
      referenceType: "withdrawal",
      referenceId: requestRef.id,
      reference,
      balanceAfter: next.available,
      actorUid: uid
    });
  });
  return { requestId: requestRef.id, reference, status: "pending" };
});

exports.reviewWithdrawalRequest = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  const admin = await requireAdmin(request, "finance.manage");
  await requireCurrencyReady();
  const requestId = cleanText(request.data?.requestId, 80);
  const action = cleanText(request.data?.action, 20);
  const reason = cleanText(request.data?.reason, 500);
  if (!requestId || !["processing", "paid", "reject"].includes(action)) {
    throw new HttpsError("invalid-argument", "بيانات المراجعة غير مكتملة.");
  }
  if (action === "reject" && reason.length < 3) throw new HttpsError("invalid-argument", "سبب الرفض مطلوب.");
  const withdrawalRef = db.doc(`withdrawalRequests/${requestId}`);

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(withdrawalRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "طلب السحب غير موجود.");
    const withdrawal = snapshot.data();
    if (!["pending", "processing"].includes(withdrawal.status)) {
      throw new HttpsError("failed-precondition", "تم إنهاء هذا الطلب سابقاً.");
    }
    if (action === "processing") {
      transaction.update(withdrawalRef, {
        status: "processing", processingBy: admin.id,
        processingAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      });
      return;
    }

    const walletRef = db.doc(`wallets/${withdrawal.userUid}`);
    const walletSnapshot = await transaction.get(walletRef);
    const wallet = walletData(walletSnapshot.exists ? walletSnapshot.data() : {});
    if (wallet.pendingWithdrawal < withdrawal.amount) {
      throw new HttpsError("failed-precondition", "الرصيد المحجوز للسحب غير متطابق.");
    }
    const approved = action === "paid";
    const next = {
      ...wallet,
      available: approved ? wallet.available : wallet.available + withdrawal.amount,
      pendingWithdrawal: wallet.pendingWithdrawal - withdrawal.amount,
      lifetimeWithdrawals: approved ? wallet.lifetimeWithdrawals + withdrawal.amount : wallet.lifetimeWithdrawals,
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.set(walletRef, next, { merge: true });
    transaction.update(withdrawalRef, {
      status: approved ? "paid" : "rejected",
      reviewReason: reason,
      reviewedBy: admin.id,
      reviewedByName: admin.name || admin.email || "الإدارة",
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    ledgerEntry(transaction, withdrawal.userUid, {
      type: approved ? "withdrawal_paid" : "withdrawal_rejected",
      direction: approved ? "debit" : "release",
      amount: withdrawal.amount,
      availableDelta: approved ? 0 : withdrawal.amount,
      heldDelta: 0,
      pendingWithdrawalDelta: -withdrawal.amount,
      referenceType: "withdrawal",
      referenceId: requestId,
      reference: withdrawal.reference,
      balanceAfter: next.available,
      actorUid: admin.id
    });
    transaction.set(db.collection(`notifications/${withdrawal.userUid}/items`).doc(), notification(
      approved ? "تم تحويل طلب السحب" : "تم رفض طلب السحب",
      approved
        ? `تم تحويل ${withdrawal.amount.toLocaleString("ar-SY-u-nu-latn")} ل.س عبر شام كاش. رقم العملية ${withdrawal.reference}.`
        : `أُعيد مبلغ ${withdrawal.amount.toLocaleString("ar-SY-u-nu-latn")} ل.س إلى رصيدك. السبب: ${reason}`,
      { relatedWithdrawalId: requestId }
    ));
    queueEmail(transaction, {
      to: withdrawal.userEmail,
      subject: approved ? `تم تحويل السحب - ${withdrawal.reference}` : `تم رفض السحب - ${withdrawal.reference}`,
      text: approved
        ? `مرحباً ${withdrawal.userName}،\n\nتم تحويل ${withdrawal.amount} ل.س إلى محفظة شام كاش المسجلة.\nرقم العملية: ${withdrawal.reference}\n\nفريق PikLance`
        : `مرحباً ${withdrawal.userName}،\n\nتم رفض طلب السحب ${withdrawal.reference} وإعادة المبلغ إلى رصيدك.\nالسبب: ${reason}\n\nفريق PikLance`,
      template: approved ? "withdrawal_paid" : "withdrawal_rejected",
      reference: withdrawal.reference
    });
    transaction.set(db.collection("adminAuditLogs").doc(), {
      action: approved ? "pay_withdrawal" : "reject_withdrawal",
      actorUid: admin.id,
      actorName: admin.name || admin.email || "الإدارة",
      actorEmail: admin.email || "",
      targetUid: withdrawal.userUid,
      targetName: withdrawal.userName || "",
      targetEmail: withdrawal.userEmail || "",
      reason: reason || withdrawal.reference,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  return { requestId, status: action === "reject" ? "rejected" : action };
});
