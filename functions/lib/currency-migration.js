const { onCall } = require("firebase-functions/v2/https");
const { FieldValue, HttpsError, REGION, db, requireAdmin } = require("./helpers");

const VERSION = "SYP_NEW_2026";
const MONEY_FIELDS = {
  services: ["price"],
  wallets: ["available", "held", "pendingWithdrawal", "lifetimeDeposits", "lifetimeEarnings", "lifetimeWithdrawals"],
  depositRequests: ["amount"],
  withdrawalRequests: ["amount"],
  walletLedger: ["amount", "availableDelta", "heldDelta", "pendingWithdrawalDelta", "balanceAfter"],
  orders: ["listPrice", "buyerDiscountAmount", "total", "platformFeeAmount", "freelancerAmount"],
  chats: []
};

const converted = value => Number.isFinite(Number(value)) ? Math.round(Number(value) / 100) : value;

function convertedData(collectionName, data) {
  const update = { currencyVersion: VERSION, currencyConvertedAt: FieldValue.serverTimestamp() };
  MONEY_FIELDS[collectionName].forEach(field => {
    if (data[field] !== undefined) update[field] = converted(data[field]);
  });
  if (collectionName === "orders" && data.escrow) {
    update.escrow = { ...data.escrow };
    ["amount", "freelancerAmount", "platformFeeAmount"].forEach(field => {
      if (update.escrow[field] !== undefined) update.escrow[field] = converted(update.escrow[field]);
    });
  }
  if (collectionName === "chats" && data.context?.price !== undefined) {
    update.context = { ...data.context, price: converted(data.context.price) };
  }
  return update;
}

exports.migrateNewSyrianLira = onCall({ region: REGION, enforceAppCheck: false, timeoutSeconds: 540 }, async request => {
  const admin = await requireAdmin(request, "settings.manage");
  if (request.data?.confirmation !== "CONVERT_SYP_2026") {
    throw new HttpsError("failed-precondition", "تأكيد ترحيل العملة غير صالح.");
  }
  const migrationRef = db.doc(`platformMigrations/${VERSION}`);
  const existing = await migrationRef.get();
  if (existing.data()?.status === "completed") return existing.data().summary || {};

  const writer = db.bulkWriter();
  const summary = { converted: {}, deletedSandboxOrders: 0 };
  for (const collectionName of Object.keys(MONEY_FIELDS)) {
    const snapshot = await db.collection(collectionName).get();
    let count = 0;
    for (const document of snapshot.docs) {
      const data = document.data();
      if (data.currencyVersion === VERSION) continue;
      if (collectionName === "orders" && (data.payment?.method === "sandbox_test" || data.payment?.mode === "sandbox")) {
        writer.delete(document.ref);
        summary.deletedSandboxOrders += 1;
        continue;
      }
      writer.update(document.ref, convertedData(collectionName, data));
      count += 1;
    }
    summary.converted[collectionName] = count;
  }
  await writer.close();
  await migrationRef.set({
    status: "completed", version: VERSION, summary,
    completedAt: FieldValue.serverTimestamp(), completedBy: admin.id
  });
  return summary;
});
