const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _test: { createSitemapHandler, escapeXml, lastModified, STATIC_PAGES } } = require("../lib/sitemap");

function database(rows = [], failure = false) {
  const calls = [];
  return { calls, collection(name) {
    calls.push(["collection", name]);
    return {
      where(...args) { calls.push(["where", ...args]); return this; },
      select(...args) { calls.push(["select", ...args]); return this; },
      limit(count) { calls.push(["limit", count]); return this; },
      async get() {
        if (failure) throw new Error("Database offline");
        return { size: rows.length, docs: rows.map(({ id, ...data }) => ({ id, data: () => data })) };
      }
    };
  } };
}

async function request(handler, pathname, method = "GET") {
  const response = { headers: {}, code: 200, body: "",
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; return this; }
  };
  await handler({ path: pathname, method }, response);
  return response;
}

test("index lists only the three sitemap files without querying private collections", async () => {
  const db = database();
  const result = await request(createSitemapHandler(db), "/sitemap.xml");
  assert.equal(result.code, 200);
  assert.match(result.body, /<sitemapindex xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.equal((result.body.match(/<sitemap>/g) || []).length, 3);
  for (const file of ["pages", "services", "articles"]) assert.ok(result.body.includes(`https://piklance.com/sitemap-${file}.xml`));
  assert.deepEqual(db.calls, []);
});

test("static pages exist and exclude authentication, administration and state pages", async () => {
  const result = await request(createSitemapHandler(database()), "/sitemap-pages.xml");
  for (const page of STATIC_PAGES) {
    if (page !== "/") assert.ok(fs.existsSync(path.join(__dirname, "../..", page.slice(1))));
  }
  assert.doesNotMatch(result.body, /dashboard|register|login|coming-soon|maintenance|404|wallet/);
  assert.equal((result.body.match(/<url>/g) || []).length, STATIC_PAGES.length);
  assert.doesNotMatch(result.body, /<lastmod>/);
});

test("collection sitemaps expose only published URLs and valid content modification dates", async () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  for (const [kind, page] of [["services", "service-details"], ["articles", "article"]]) {
    const db = database([
      { id: "abc&x?", status: "published", updatedAt: new Date(now - 1000), email: "private@example.com", body: "private body" },
      { id: "draft-id", status: "draft" }, { id: "trashed-id", status: "trash" }
    ]);
    const result = await request(createSitemapHandler(db, () => now), `/sitemap-${kind}.xml`);
    assert.equal(result.code, 200);
    assert.ok(result.body.includes(`https://piklance.com/${page}.html?id=abc%26x%3F`));
    assert.ok(result.body.includes("2026-11-20T11:59:59.000Z"));
    assert.doesNotMatch(result.body, /draft-id|trashed-id|private@example|private body/);
    assert.deepEqual(db.calls[1], ["where", "status", "==", "published"]);
    assert.ok(db.calls.some(call => call[0] === "select" && !call.includes("body")));
  }
});

test("XML escapes reserved characters and ignores invalid or future timestamps", () => {
  assert.equal(escapeXml('<a & "b"\'>'), "&lt;a &amp; &quot;b&quot;&apos;&gt;");
  assert.equal(lastModified({ updatedAt: new Date("invalid"), createdAt: new Date(1000) }, 2000), "1970-01-01T00:00:01.000Z");
  assert.equal(lastModified({ updatedAt: new Date(3000) }, 2000), "");
  assert.equal(lastModified({ updatedAt: { toDate: () => new Date(1000) } }, 2000), "1970-01-01T00:00:01.000Z");
});

test("cache is bounded to a minute, coalesces requests, and refreshes changed publication status", async () => {
  let now = 0;
  const rows = [{ id: "old", status: "published" }];
  const db = database(rows);
  const handler = createSitemapHandler(db, () => now);
  await Promise.all([request(handler, "/sitemap-services.xml"), request(handler, "/sitemap-services.xml")]);
  assert.equal(db.calls.filter(call => call[0] === "collection").length, 1);
  rows[0].status = "draft";
  rows.push({ id: "new", status: "published" });
  now = 60001;
  const result = await request(handler, "/sitemap-services.xml");
  assert.ok(result.body.includes("id=new"));
  assert.ok(!result.body.includes("id=old"));
  assert.equal(result.headers["Cache-Control"], "public, max-age=0, s-maxage=240");
});

test("HEAD works, invalid methods and paths do not access the database, and failures are not cached", async () => {
  const db = database();
  const handler = createSitemapHandler(db);
  assert.equal((await request(handler, "/sitemap.xml", "HEAD")).body, "");
  assert.equal((await request(handler, "/sitemap.xml", "POST")).code, 405);
  assert.equal((await request(handler, "/private.xml")).code, 404);
  assert.deepEqual(db.calls, []);
  const result = await request(createSitemapHandler(database([], true)), "/sitemap-articles.xml");
  assert.equal(result.code, 503);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.ok(!result.body.includes("Database offline"));
});

test("collections exceeding the XML limit fail explicitly rather than silently dropping public pages", async () => {
  const result = await request(createSitemapHandler(database(Array.from({ length: 50001 }, (_, index) => ({ id: String(index), status: "published" })))), "/sitemap-articles.xml");
  assert.equal(result.code, 503);
});
