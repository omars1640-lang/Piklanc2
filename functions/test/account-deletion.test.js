const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertRecentAuthentication,
  financialDeletionBlockers
} = require("../lib/account-deletion");

test("account deletion requires a recent authenticated session", () => {
  const now = 2_000_000;
  assert.equal(assertRecentAuthentication({ uid: "user-1", token: { auth_time: now - 60 } }, now), "user-1");
  assert.throws(() => assertRecentAuthentication(null, now), error => error.code === "unauthenticated");
  assert.throws(
    () => assertRecentAuthentication({ uid: "user-1", token: { auth_time: now - 601 } }, now),
    error => error.code === "failed-precondition"
  );
});

test("account deletion blocks unresolved financial state", () => {
  assert.deepEqual(financialDeletionBlockers({}), []);
  assert.deepEqual(financialDeletionBlockers({ wallet: { available: 1 } }), ["wallet"]);
  assert.deepEqual(financialDeletionBlockers({ orders: [{ status: "funded" }] }), ["orders"]);
  assert.deepEqual(financialDeletionBlockers({ deposits: [{ status: "pending" }] }), ["deposits"]);
  assert.deepEqual(financialDeletionBlockers({ withdrawals: [{ status: "processing" }] }), ["withdrawals"]);
  assert.deepEqual(financialDeletionBlockers({
    wallet: { available: 0, held: 0, pendingWithdrawal: 0 },
    orders: [{ status: "completed" }, { status: "cancelled" }],
    deposits: [{ status: "approved" }, { status: "rejected" }],
    withdrawals: [{ status: "paid" }, { status: "rejected" }]
  }), []);
});
