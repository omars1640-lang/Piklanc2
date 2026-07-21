const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("../lib/articles");

test("slugify keeps Arabic and produces stable slugs", () => {
  assert.equal(_test.slugify("  دليل العمل الحر  "), "دليل-العمل-الحر");
  assert.equal(_test.slugify("PikLance Guide!"), "piklance-guide");
});

test("search tokens are normalized, unique and bounded", () => {
  const tokens = _test.searchTokens("العمل العمل", "PikLance GUIDE", "نصائح");
  assert.deepEqual(tokens, ["العمل", "piklance", "guide", "نصائح"]);
  assert.ok(_test.searchTokens(...Array.from({ length: 100 }, (_, index) => `word${index}`)).length <= 80);
});
