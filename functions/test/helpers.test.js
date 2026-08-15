const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CURRENCY,
  CURRENCY_VERSION,
  cleanText,
  integerAmount,
  platformReference,
  requireAuth,
  walletData
} = require("../lib/helpers");

test("authentication requires a verified signed-in user", () => {
  assert.equal(requireAuth({ auth: { uid: "user-1", token: { email_verified: true } } }), "user-1");
  assert.throws(() => requireAuth({}), error => error.code === "unauthenticated");
  assert.throws(
    () => requireAuth({ auth: { uid: "user-1", token: { email_verified: false } } }),
    error => error.code === "failed-precondition"
  );
});

test("financial amounts reject fractions, unsafe values and out-of-range input", () => {
  assert.equal(integerAmount("1", 1, 100), 1);
  assert.equal(integerAmount(100, 1, 100), 100);
  [0, 101, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1].forEach(value => {
    assert.throws(() => integerAmount(value, 1, 100), error => error.code === "invalid-argument");
  });
});

test("wallet defaults preserve the current currency contract", () => {
  assert.equal(CURRENCY, "SYP");
  assert.equal(CURRENCY_VERSION, "SYP_NEW_2026");
  assert.deepEqual(walletData({}), {
    available: 0,
    held: 0,
    pendingWithdrawal: 0,
    lifetimeDeposits: 0,
    lifetimeEarnings: 0,
    lifetimeWithdrawals: 0,
    currency: "SYP",
    currencyVersion: "SYP_NEW_2026"
  });
  assert.equal(walletData({ available: "12", held: 3 }).available, 12);
});

test("platform references and bounded text stay stable", () => {
  const now = new Date("2026-08-15T10:00:00.000Z");
  assert.equal(platformReference("ORD", "ab-cd_123456789", now), "ORD-20260815-ABCD1234");
  assert.equal(cleanText("  PikLance  ", 4), "PikL");
});
