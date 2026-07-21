const test = require("node:test");
const assert = require("node:assert/strict");
const { reportPeriod } = require("../lib/finance-reports");

test("monthly financial period uses UTC month boundaries", () => {
  const period = reportPeriod({ mode: "month", month: "2026-07" });
  assert.equal(period.start.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("yearly and all-time financial periods are stable", () => {
  const yearly = reportPeriod({ mode: "year", year: 2026 });
  assert.equal(yearly.start.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(yearly.end.toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(reportPeriod({ mode: "all" }).start, null);
});

test("custom financial period includes the selected end day", () => {
  const period = reportPeriod({ mode: "custom", startDate: "2026-07-01", endDate: "2026-07-21" });
  assert.equal(period.start.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-07-22T00:00:00.000Z");
});
