const { createHash, randomUUID } = require("node:crypto");
const { getAuth } = require("firebase-admin/auth");
const { FieldPath } = require("firebase-admin/firestore");
const { onCall } = require("firebase-functions/v2/https");
const {
  FieldValue, HttpsError, REGION, cleanText, db, requireAdmin, storageBucket
} = require("./helpers");

const PAGE_SIZE = 200;
const MAX_AUTH_AGE_SECONDS = 10 * 60;
const TERMINAL_ORDER_STATUSES = new Set(["completed", "cancelled", "released"]);
const TERMINAL_DEPOSIT_STATUSES = new Set(["approved", "rejected"]);
const TERMINAL_WITHDRAWAL_STATUSES = new Set(["paid", "rejected"]);

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function assertRecentAuthentication(auth, nowSeconds = Math.floor(Date.now() / 1000)) {
  const authenticatedAt = Number(auth?.token?.auth_time || 0);
  if (!auth?.uid) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  if (!Number.isFinite(authenticatedAt) || authenticatedAt <= 0 || nowSeconds - authenticatedAt > MAX_AUTH_AGE_SECONDS) {
    throw new HttpsError("failed-precondition", "أعد إدخال كلمة المرور ثم حاول حذف الحساب مجدداً.");
  }
  return auth.uid;
}

function financialDeletionBlockers({ wallet = {}, orders = [], deposits = [], withdrawals = [] } = {}) {
  const blockers = [];
  const walletFields = ["available", "held", "pendingWithdrawal"];
  if (walletFields.some(field => !Number.isFinite(Number(wallet[field] || 0)) || Number(wallet[field] || 0) !== 0)) {
    blockers.push("wallet");
  }
  if (orders.some(item => !TERMINAL_ORDER_STATUSES.has(item.status))) blockers.push("orders");
  if (deposits.some(item => !TERMINAL_DEPOSIT_STATUSES.has(item.status))) blockers.push("deposits");
  if (withdrawals.some(item => !TERMINAL_WITHDRAWAL_STATUSES.has(item.status))) blockers.push("withdrawals");
  return blockers;
}

async function drainQuery(query, operation) {
  let affected = 0;
  while (true) {
    const snapshot = await query.limit(PAGE_SIZE).get();
    if (snapshot.empty) break;
    await operation(snapshot.docs);
    affected += snapshot.size;
  }
  return affected;
}

async function deleteQuery(query) {
  return drainQuery(query, async documents => {
    const writer = db.bulkWriter();
    documents.forEach(document => writer.delete(document.ref));
    await writer.close();
  });
}

async function recursiveDeleteQuery(query, beforeDelete = null) {
  return drainQuery(query, async documents => {
    if (beforeDelete) await beforeDelete(documents);
    await Promise.all(documents.map(document => db.recursiveDelete(document.ref)));
  });
}

async function updateQuery(query, changesForDocument) {
  return drainQuery(query, async documents => {
    const writer = db.bulkWriter();
    documents.forEach(document => writer.update(document.ref, changesForDocument(document)));
    await writer.close();
  });
}

async function deleteStoragePrefix(prefix) {
  await storageBucket().deleteFiles({ prefix }).catch(error => {
    if (error.code !== 404) throw error;
  });
}

function deletedOrderFields(document, uid, deletedUid, accountName) {
  const data = document.data();
  const changes = {
    accountDeletedAt: FieldValue.serverTimestamp(),
    accountHolderName: accountName
  };
  if (data.buyerUid === uid) {
    changes.buyerUid = deletedUid;
    changes.buyerName = accountName;
    changes.buyerEmail = FieldValue.delete();
    if (data.payment?.walletUid === uid) changes["payment.walletUid"] = deletedUid;
  }
  if (data.freelancerUid === uid) {
    changes.freelancerUid = deletedUid;
    changes.freelancerName = accountName;
  }
  if (data.dispute?.openedByUid === uid) {
    changes["dispute.openedByUid"] = deletedUid;
  }
  return changes;
}

async function deletionPreflight(uid) {
  const [userSnapshot, walletSnapshot, buyerOrders, freelancerOrders, deposits, withdrawals] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`wallets/${uid}`).get(),
    db.collection("orders").where("buyerUid", "==", uid).get(),
    db.collection("orders").where("freelancerUid", "==", uid).get(),
    db.collection("depositRequests").where("userUid", "==", uid).get(),
    db.collection("withdrawalRequests").where("userUid", "==", uid).get()
  ]);
  if (!userSnapshot.exists) throw new HttpsError("not-found", "الحساب غير موجود.");
  const user = userSnapshot.data();
  if (user.role === "admin") throw new HttpsError("permission-denied", "لا يمكن حذف حسابات الإدارة من لوحة المستخدم.");
  const orders = new Map([...buyerOrders.docs, ...freelancerOrders.docs].map(item => [item.id, item.data()]));
  const blockers = financialDeletionBlockers({
    wallet: walletSnapshot.data() || {},
    orders: [...orders.values()],
    deposits: deposits.docs.map(item => item.data()),
    withdrawals: withdrawals.docs.map(item => item.data())
  });
  if (blockers.length) {
    const messages = {
      wallet: "يجب تصفير الرصيد المتاح والمحجوز قبل حذف الحساب.",
      orders: "يجب إنهاء أو إلغاء جميع الطلبات المفتوحة قبل حذف الحساب.",
      deposits: "يوجد طلب شحن قيد المراجعة ويجب إنهاؤه أولاً.",
      withdrawals: "يوجد طلب سحب قيد المعالجة ويجب إنهاؤه أولاً."
    };
    throw new HttpsError("failed-precondition", blockers.map(item => messages[item]).join(" "));
  }
  return { user, deposits: deposits.docs, withdrawals: withdrawals.docs };
}

async function anonymizeFinancialRecords(deletedUid, accountName, depositDocuments, withdrawalDocuments) {
  const writer = db.bulkWriter();
  depositDocuments.forEach(document => writer.update(document.ref, {
    userUid: deletedUid,
    userName: accountName,
    userEmail: FieldValue.delete(),
    accountDeletedAt: FieldValue.serverTimestamp()
  }));
  withdrawalDocuments.forEach(document => writer.update(document.ref, {
    userUid: deletedUid,
    userName: accountName,
    userEmail: FieldValue.delete(),
    accountDeletedAt: FieldValue.serverTimestamp()
  }));
  await writer.close();
}

async function deletePrivateAccountData(uid, email, deletedUid, accountName, depositDocuments, withdrawalDocuments) {
  const chatsQuery = db.collection("chats").where("participantUids", "array-contains", uid);
  const supportByUid = db.collection("supportTickets").where("requesterUid", "==", uid);
  const supportByEmail = email ? db.collection("supportTickets").where("requesterEmail", "==", email) : null;

  await recursiveDeleteQuery(chatsQuery, documents => Promise.all(
    documents.map(document => deleteStoragePrefix(`chat-attachments/${document.id}/`))
  ));
  await recursiveDeleteQuery(supportByUid);
  if (supportByEmail) await recursiveDeleteQuery(supportByEmail);

  const deletionQueries = [
    ["services", "ownerUid"],
    ["freelancerPortfolio", "ownerUid"],
    ["portfolioItems", "ownerUid"],
    ["reviews", "reviewerUid"],
    ["reviews", "targetUid"],
    ["userBadges", "uid"],
    ["referrals", "inviterUid"],
    ["referrals", "invitedUid"],
    ["userBenefits", "uid"],
    ["promoCodes", "ownerUid"],
    ["promoCodeUses", "uid"],
    ["articleViews", "uid"]
  ];
  if (email) {
    deletionQueries.push(["launchSubscribers", "email"], ["mailQueue", "to"], ["mailLogs", "to"]);
  }
  await Promise.all(deletionQueries.map(([collection, field]) => deleteQuery(
    db.collection(collection).where(field, "==", field === "email" || field === "to" ? email : uid)
  )));

  await Promise.all([
    deleteQuery(db.collectionGroup("likes").where("userUid", "==", uid)),
    deleteQuery(db.collectionGroup("comments").where("authorUid", "==", uid)),
    deleteQuery(db.collectionGroup("services").where("sellerUid", "==", uid)),
    updateQuery(db.collection("promoCodes").where("lastUsedBy", "==", uid), () => ({ lastUsedBy: FieldValue.delete() })),
    updateQuery(db.collection("users").where("referredByUid", "==", uid), () => ({
      referredByUid: FieldValue.delete(),
      referralCodeUsed: FieldValue.delete()
    })),
    updateQuery(db.collection("orders").where("buyerUid", "==", uid), document => deletedOrderFields(document, uid, deletedUid, accountName)),
    updateQuery(db.collection("orders").where("freelancerUid", "==", uid), document => deletedOrderFields(document, uid, deletedUid, accountName)),
    updateQuery(db.collection("walletLedger").where("userUid", "==", uid), () => ({
      userUid: deletedUid,
      userName: accountName,
      accountDeletedAt: FieldValue.serverTimestamp()
    })),
    updateQuery(db.collection("walletLedger").where("actorUid", "==", uid), () => ({
      actorUid: deletedUid,
      actorName: accountName,
      accountDeletedAt: FieldValue.serverTimestamp()
    })),
    updateQuery(db.collection("adminAuditLogs").where("targetUid", "==", uid), () => ({
      targetUid: deletedUid,
      targetName: accountName,
      targetEmail: FieldValue.delete(),
      accountDeletedAt: FieldValue.serverTimestamp()
    }))
  ]);

  if (email) {
    const launchSubscriberId = sha256(email);
    const ratePrefix = `launch_email_${launchSubscriberId.slice(0, 32)}_`;
    await Promise.all([
      db.doc(`launchSubscribers/${launchSubscriberId}`).delete().catch(() => {}),
      deleteQuery(db.collection("securityRateLimits")
        .where(FieldPath.documentId(), ">=", ratePrefix)
        .where(FieldPath.documentId(), "<", `${ratePrefix}\uf8ff`))
    ]);
  }

  await anonymizeFinancialRecords(deletedUid, accountName, depositDocuments, withdrawalDocuments);
  await Promise.all([
    db.recursiveDelete(db.doc(`favorites/${uid}`)),
    db.recursiveDelete(db.doc(`notifications/${uid}`)),
    db.recursiveDelete(db.doc(`payoutMethods/${uid}`)),
    db.doc(`accountBenefits/${uid}`).delete().catch(() => {}),
    db.doc(`wallets/${uid}`).delete().catch(() => {})
  ]);
}

async function deleteAccount(uid, confirmationEmail) {
  const { user, deposits, withdrawals } = await deletionPreflight(uid);
  const storedEmail = cleanText(user.email, 160).trim().toLowerCase();
  if (!storedEmail || confirmationEmail !== storedEmail) {
    throw new HttpsError("invalid-argument", "اكتب البريد الإلكتروني المرتبط بالحساب للتأكيد.");
  }
  const accountName = cleanText(user.name || user.fullName || "صاحب حساب محذوف", 120);
  const deletedUid = `deleted-${randomUUID()}`;
  await deletePrivateAccountData(uid, storedEmail, deletedUid, accountName, deposits, withdrawals);
  await Promise.all([
    deleteStoragePrefix(`identity/${uid}/`),
    deleteStoragePrefix(`profile-images/${uid}/`),
    deleteStoragePrefix(`service-images/${uid}/`),
    deleteStoragePrefix(`freelancer-portfolio/${uid}/`),
    deleteStoragePrefix(`portfolio-media/${uid}/`),
    deleteStoragePrefix(`portfolio-images/${uid}/`),
    deleteStoragePrefix(`payout-qr/${uid}/`)
  ]);
  await Promise.all([
    db.recursiveDelete(db.doc(`publicProfiles/${uid}`)),
    db.recursiveDelete(db.doc(`users/${uid}`))
  ]);
  await getAuth().deleteUser(uid).catch(error => {
    if (error.code !== "auth/user-not-found") throw error;
  });
  return { accountName, deletedUid };
}

exports.deleteOwnAccount = onCall({
  region: REGION,
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true",
  timeoutSeconds: 540,
  memory: "1GiB"
}, async request => {
  const uid = assertRecentAuthentication(request.auth);
  const tokenEmail = cleanText(request.auth.token.email, 160).trim().toLowerCase();
  const confirmedEmail = cleanText(request.data?.confirmationEmail, 160).trim().toLowerCase();
  if (!tokenEmail || confirmedEmail !== tokenEmail) {
    throw new HttpsError("invalid-argument", "اكتب البريد الإلكتروني المرتبط بالحساب للتأكيد.");
  }

  await deleteAccount(uid, tokenEmail);
  return { ok: true };
});

exports.deleteUserAccountByAdmin = onCall({
  region: REGION,
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true",
  timeoutSeconds: 540,
  memory: "1GiB"
}, async request => {
  assertRecentAuthentication(request.auth);
  const admin = await requireAdmin(request, "users.manage");
  const userId = cleanText(request.data?.userId, 128);
  const confirmationEmail = cleanText(request.data?.confirmationEmail, 160).trim().toLowerCase();
  const reason = cleanText(request.data?.reason, 500);
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(userId) || !confirmationEmail || reason.length < 3) {
    throw new HttpsError("invalid-argument", "معرف المستخدم وبريد التأكيد وسبب الحذف مطلوبة.");
  }
  if (userId === admin.id) throw new HttpsError("failed-precondition", "لا يمكنك حذف حسابك الإداري الحالي.");

  const { accountName, deletedUid } = await deleteAccount(userId, confirmationEmail);
  await db.collection("adminAuditLogs").add({
    action: "delete_user",
    actorUid: admin.id,
    actorName: admin.name || admin.email || "الإدارة",
    actorEmail: admin.email || "",
    targetUid: deletedUid,
    targetName: accountName,
    reason,
    accountDeletedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true };
});

module.exports.assertRecentAuthentication = assertRecentAuthentication;
module.exports.financialDeletionBlockers = financialDeletionBlockers;
