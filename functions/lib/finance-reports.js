const { AggregateField } = require("firebase-admin/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { HttpsError, REGION, Timestamp, cleanText, db, requireAdmin } = require("./helpers");

function startOfUtcDay(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function reportPeriod(data = {}) {
  const mode = cleanText(data.mode, 20) || "month";
  const now = new Date();
  if (mode === "all") return { mode, start: null, end: null, label: "كل المدة" };

  if (mode === "year") {
    const year = Math.min(2100, Math.max(2024, Number.parseInt(data.year, 10) || now.getUTCFullYear()));
    return {
      mode,
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year + 1, 0, 1)),
      label: String(year)
    };
  }

  if (mode === "custom") {
    const start = startOfUtcDay(cleanText(data.startDate, 10));
    const lastDay = startOfUtcDay(cleanText(data.endDate, 10));
    if (!start || !lastDay || lastDay < start) {
      throw new HttpsError("invalid-argument", "اختر فترة مالية صحيحة.");
    }
    const end = new Date(lastDay.getTime() + 24 * 60 * 60 * 1000);
    return { mode, start, end, label: `${data.startDate} – ${data.endDate}` };
  }

  const monthValue = /^\d{4}-\d{2}$/.test(String(data.month || ""))
    ? String(data.month)
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [year, month] = monthValue.split("-").map(Number);
  if (year < 2024 || year > 2100 || month < 1 || month > 12) {
    throw new HttpsError("invalid-argument", "الشهر المحدد غير صالح.");
  }
  return {
    mode: "month",
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
    label: monthValue
  };
}

function withinPeriod(query, field, period) {
  if (!period.start || !period.end) return query;
  return query
    .where(field, ">=", Timestamp.fromDate(period.start))
    .where(field, "<", Timestamp.fromDate(period.end));
}

async function aggregate(query, fields) {
  const definition = { count: AggregateField.count() };
  fields.forEach(field => { definition[field] = AggregateField.sum(field); });
  const data = (await query.aggregate(definition).get()).data();
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Number(value || 0)]));
}

exports.getFinancialReport = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  await requireAdmin(request, "finance.view");
  const period = reportPeriod(request.data);

  const approvedDeposits = withinPeriod(
    db.collection("depositRequests").where("status", "==", "approved"),
    "reviewedAt",
    period
  );
  const paidWithdrawals = withinPeriod(
    db.collection("withdrawalRequests").where("status", "==", "paid"),
    "reviewedAt",
    period
  );
  const completedOrders = withinPeriod(
    db.collection("orders").where("status", "==", "completed"),
    "completedAt",
    period
  );
  const createdOrders = withinPeriod(db.collection("orders"), "createdAt", period);

  const [deposits, withdrawals, completed, orders, wallets, heldOrders, pendingDeposits, pendingWithdrawals] = await Promise.all([
    aggregate(approvedDeposits, ["amount"]),
    aggregate(paidWithdrawals, ["amount"]),
    aggregate(completedOrders, ["total", "platformFeeAmount", "freelancerAmount"]),
    aggregate(createdOrders, ["total"]),
    aggregate(db.collection("wallets"), ["available", "held", "pendingWithdrawal"]),
    aggregate(db.collection("orders").where("status", "in", ["funded", "active", "delivered", "disputed"]), ["total"]),
    aggregate(db.collection("depositRequests").where("status", "==", "pending"), ["amount"]),
    aggregate(db.collection("withdrawalRequests").where("status", "in", ["pending", "processing"]), ["amount"])
  ]);

  const platformFunds = wallets.available + wallets.held + wallets.pendingWithdrawal;
  return {
    period: {
      mode: period.mode,
      label: period.label,
      start: period.start?.toISOString() || null,
      end: period.end?.toISOString() || null
    },
    orders: { count: orders.count, gross: orders.total },
    completed: {
      count: completed.count,
      gross: completed.total,
      profit: completed.platformFeeAmount,
      freelancerReleased: completed.freelancerAmount
    },
    deposits: { count: deposits.count, amount: deposits.amount },
    withdrawals: { count: withdrawals.count, amount: withdrawals.amount },
    current: {
      platformFunds,
      walletAvailable: wallets.available,
      walletHeld: wallets.held,
      pendingWithdrawalBalance: wallets.pendingWithdrawal,
      heldOrders: heldOrders.total,
      pendingDepositsCount: pendingDeposits.count,
      pendingDepositsAmount: pendingDeposits.amount,
      pendingWithdrawalsCount: pendingWithdrawals.count,
      pendingWithdrawalsAmount: pendingWithdrawals.amount
    }
  };
});

exports.reportPeriod = reportPeriod;
