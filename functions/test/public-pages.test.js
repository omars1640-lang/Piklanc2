const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { _test: { createPublicPageHandler, publicImage, articleBody, markAccess } } = require("../lib/public-pages");
const { ORIGIN, PAGE_DESCRIPTIONS, PUBLIC_PAGES } = require("../lib/public-page-config");
const root = path.resolve(__dirname, "../..");
const template = route => fs.readFileSync(path.join(root, route === "/" ? "index.html" : route.slice(1)), "utf8");
const article = {
  status: "published", title: "معرض أعمال للمبتدئين", excerpt: "دليل لبناء معرض أعمالك الأول.",
  authorName: "فريق PikLance", coverUrl: "https://example.com/cover.jpg",
  publishedAt: new Date("2026-11-19T12:00:00Z"), tags: ["تصميم", "برمجة"], likesCount: 12,
  privateEmail: "never-output@example.com", pendingChanges: { title: "SECRET DRAFT TITLE" }
};
const service = {
  status: "published", title: "تعليق صوتي إعلاني", description: "تسجيل إعلان لمشروعك بصوت احترافي.",
  category: "تعليق صوتي", price: 50, deliveryDays: 3, revisions: 2, ownerUid: "seller",
  imageUrl: "https://example.com/service.jpg", privatePhone: "+0000000000",
  pendingChanges: { description: "SECRET SERVICE REVISION" }
};
function database(overrides = {}, failurePath = "") {
  const rows = {
    "platformSettings/general": {}, "articles/article": article,
    "articleBodies/article": { body: "## البداية\nفقرة مفيدة.\n- مثال أول\n- مثال ثان\n\n### نصائح\nابدأ اليوم." },
    "services/service": service,
    "publicProfiles/seller": { name: "مستقل تجريبي", specialty: "تعليق صوتي", about: "معلومات الملف العام" },
    ...overrides
  };
  const calls = [];
  return { calls, doc(key) {
    calls.push(key);
    return { async get() {
      if (failurePath === key) throw new Error("INTERNAL FAILURE, DO NOT OUTPUT");
      const row = rows[key];
      return { exists: row !== null && row !== undefined, data: () => row };
    } };
  } };
}
async function request(handler, url, { method = "GET", headers = { host: "piklance.com" } } = {}) {
  const response = { headers: {}, code: 200, body: "",
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; return this; }
  };
  await handler({ path: url.split("?")[0], originalUrl: url, method, headers }, response);
  return response;
}
function handler(db = database()) { return createPublicPageHandler(db, template); }

test("every public static route has one canonical, description and an immediately visible server decision", async () => {
  for (const route of Object.keys(PAGE_DESCRIPTIONS)) {
    const result = await request(handler(), route + "?utm_source=test");
    assert.equal(result.code, 200, route);
    assert.match(result.body, /data-platform-mode="open" data-platform-access="ready"/);
    assert.equal((result.body.match(/rel="canonical"/g) || []).length, 1);
    assert.ok(result.body.includes(`<link rel="canonical" href="${ORIGIN}${route}">`));
    assert.ok(result.body.includes(PAGE_DESCRIPTIONS[route]));
    assert.doesNotMatch(result.body, /setAttribute\("data-platform-access", "pending"\)/);
    assert.equal(result.headers["Cache-Control"], "private, no-store");
  }
});

test("published article contains the complete visible body, real title, cover and JSON-LD before JavaScript", async () => {
  const result = await request(handler(), "/article.html?id=article&utm_source=test");
  assert.equal(result.code, 200);
  assert.match(result.body, /<title>معرض أعمال للمبتدئين \| PikLance<\/title>/);
  assert.match(result.body, /<h1 id="articleTitle">معرض أعمال للمبتدئين<\/h1>/);
  assert.match(result.body, /<article class="article-page" id="articlePage">/);
  assert.match(result.body, /id="articleState" hidden/);
  assert.match(result.body, /<h2>البداية<\/h2>[\s\S]*<li>مثال أول<\/li>/);
  assert.match(result.body, /background-image:url\('https:\/\/example.com\/cover.jpg'\)/);
  assert.match(result.body, /"@type":"Article"/);
  assert.match(result.body, /href="https:\/\/piklance.com\/article.html\?id=article"/);
  assert.doesNotMatch(result.body, /SECRET|never-output@example/);
});

test("published service renders its real content in the existing DOM without changing purchase hooks", async () => {
  const db = database();
  const result = await request(handler(db), "/service-details.html?id=service");
  assert.equal(result.code, 200);
  assert.match(result.body, /<title>تعليق صوتي إعلاني - PikLance<\/title>/);
  assert.match(result.body, /<h1[^>]*id="serviceTitle"[^>]*>تعليق صوتي إعلاني<\/h1>/);
  assert.match(result.body, /<p>تسجيل إعلان لمشروعك بصوت احترافي.<\/p>/);
  assert.match(result.body, /<strong[^>]*id="packagePrice"[^>]*>50 ل.س<\/strong>/);
  assert.match(result.body, /src="https:\/\/example.com\/service.jpg"/);
  assert.match(result.body, /مستقل تجريبي/);
  for (const id of ["orderService", "favoriteService", "shareService", "startConversation"]) assert.ok(result.body.includes(`id="${id}"`));
  assert.ok(result.body.includes('src="js/service-details.js"'));
  assert.doesNotMatch(result.body, /SECRET|\+0000000000/);
  assert.deepEqual(db.calls, ["platformSettings/general", "services/service", "publicProfiles/seller"]);
});

test("draft, archived, trashed and missing content never exposes the body or private fields", async () => {
  for (const status of ["draft", "archived", "trash", "pending", null]) {
    for (const [route, key, row] of [["article", "articles/article", article], ["service-details", "services/article", service]]) {
      const db = database({ [key]: status ? { ...row, title: "SECRET UNPUBLISHED", status } : null });
      const result = await request(handler(db), `/${route}.html?id=article`);
      assert.equal(result.code, 404);
      assert.equal(result.headers["X-Robots-Tag"], "noindex, follow");
      assert.doesNotMatch(result.body, /SECRET UNPUBLISHED|دليل لبناء|تسجيل إعلان/);
      assert.ok(!db.calls.includes("articleBodies/article"));
      assert.doesNotMatch(result.body, /src="js\/(?:article-content|service-details)\.js"/);
    }
  }
});

test("maintenance/prelaunch never query public content and retain the client admin/early-access guard", async () => {
  for (const mode of ["maintenance", "prelaunch"]) {
    for (const route of ["/", "/article.html?id=article", "/service-details.html?id=service"]) {
      const db = database({ "platformSettings/general": { [`${mode}Mode`]: true } });
      const result = await request(handler(db), route);
      assert.equal(result.code, 503);
      assert.match(result.body, new RegExp(`data-platform-mode="${mode}" data-platform-access="pending"`));
      assert.match(result.body, /html\[data-platform-access="pending"\] body/);
      assert.ok(result.body.includes('src="js/site-header.js"'));
      assert.doesNotMatch(result.body, /<h1[^>]*>معرض أعمال للمبتدئين|<h1[^>]*>تعليق صوتي إعلاني/);
      assert.deepEqual(db.calls, ["platformSettings/general"]);
      assert.equal(result.headers["Retry-After"], "300");
    }
  }
});

test("backend failures return retryable 503, never deleted-content 404 or hidden UI", async () => {
  for (const failurePath of ["platformSettings/general", "articles/article", "articleBodies/article"]) {
    const result = await request(handler(database({}, failurePath)), "/article.html?id=article");
    assert.equal(result.code, 503);
    assert.equal(result.headers["Retry-After"], "60");
    assert.match(result.body, /تعذر تحميل الصفحة مؤقتاً/);
    assert.doesNotMatch(result.body, /INTERNAL FAILURE|data-platform-access="pending"|جاري تحميل المقال/);
  }
});

test("a hung database read has a bounded deadline and returns a visible retryable response", async () => {
  const offline = { doc() { return { get: () => new Promise(() => {}) }; } };
  const result = await request(createPublicPageHandler(offline, template, 15), "/");
  assert.equal(result.code, 503);
  assert.match(result.body, /تعذر تحميل الصفحة مؤقتاً/);
  assert.equal(result.headers["Retry-After"], "60");
});

test("www and index redirects preserve valid deep links and tracking but cannot redirect to another origin", async () => {
  const db = database();
  const render = handler(db);
  for (const [url, headers, destination] of [
    ["/article.html?id=article&utm_source=meta", { host: "www.piklance.com" }, `${ORIGIN}/article.html?id=article&utm_source=meta`],
    ["/index.html?utm_source=meta", { host: "piklance.com" }, "/?utm_source=meta"],
    ["/index.html?utm_source=preview", { host: "piklance-preview.web.app" }, "/?utm_source=preview"],
    ["/index.html?next=https://evil.example", { "x-forwarded-host": "www.piklance.com" }, `${ORIGIN}/?next=https://evil.example`]
  ]) {
    const result = await request(render, url, { headers });
    assert.equal(result.code, 301);
    assert.equal(result.headers.Location, destination);
  }
  assert.deepEqual(db.calls, []);
});

test("invalid IDs, duplicate IDs, private paths and non-read methods cannot access arbitrary documents", async () => {
  const db = database();
  const render = handler(db);
  for (const url of ["/article.html", "/article.html?id=../users/admin", "/article.html?id=a&id=b", "/service-details.html?id=%2Fusers%2Fa"]) {
    assert.equal((await request(render, url)).code, 404);
  }
  assert.ok(db.calls.every(key => key === "platformSettings/general"));
  for (const route of ["/dashboard.html", "/register.html", "/login.html", "/js/firebase.js", "/random.html"]) {
    assert.equal((await request(render, route)).code, 404);
  }
  assert.equal((await request(render, "/", { method: "POST" })).code, 405);
  assert.equal((await request(render, "/article.html?id=article", { method: "HEAD" })).body, "");
});

test("stored text, metadata, image URLs and JSON-LD cannot inject HTML/scripts or CSS", async () => {
  const attack = '</script><img src=x onerror="alert(1)">';
  const result = await request(handler(database({
    "articles/article": { ...article, title: attack, excerpt: attack, authorName: attack, tags: [attack], coverUrl: "javascript:alert(1)" },
    "articleBodies/article": { body: attack }
  })), "/article.html?id=article");
  assert.equal(result.code, 200);
  assert.doesNotMatch(result.body, /<img src=x|javascript:alert/);
  assert.ok(result.body.includes("&lt;/script&gt;"));
  const structured = JSON.parse(result.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(structured.headline, attack);
  assert.ok(!result.body.includes('data-platform-mode="open" data-platform-mode="open"'));
  assert.equal(publicImage(""), "");
  assert.equal(publicImage("data:image/svg+xml,xxx", "fallback"), "fallback");
  assert.equal(publicImage("https://user:pass@example.com/image.jpg", "fallback"), "fallback");
  const css = await request(handler(database({ "articles/article": { ...article, coverUrl: "https://example.com/a');color:red;/*" } })), "/article.html?id=article");
  assert.doesNotMatch(css.body.match(/id="articleCover"[^>]*>/)[0], /a'\);color/);
});

test("legacy inline article bodies still render and Markdown semantics match the existing supported subset", async () => {
  const result = await request(handler(database({ "articleBodies/article": null, "articles/article": { ...article, body: "نص قديم" } })), "/article.html?id=article");
  assert.match(result.body, /<p>نص قديم<\/p>/);
  assert.equal(articleBody("## عنوان\n- أول\n- ثان\n\n### فرعي\nفقرة"), "<h2>عنوان</h2>\n<ul>\n<li>أول</li>\n<li>ثان</li>\n</ul>\n<h3>فرعي</h3>\n<p>فقرة</p>");
  const marked = markAccess(markAccess(template("/"), "maintenance"), "open");
  assert.equal((marked.match(/data-platform-access="/g) || []).length, 2); // html + CSS selector
  assert.ok(marked.includes('data-platform-mode="open" data-platform-access="ready"'));
});

test("deployment templates are current, routes bypass static precedence, and private pages stay static", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "functions/public-pages/manifest.json")));
  const config = JSON.parse(fs.readFileSync(path.join(root, "firebase.json")));
  const rewrite = config.hosting.rewrites.find(rule => rule.function?.functionId === "publicPage");
  assert.equal(rewrite.function.pinTag, true);
  for (const route of PUBLIC_PAGES) {
    const file = route === "/" ? "index.html" : route.slice(1);
    assert.ok(config.hosting.ignore.includes(file), `${file} would override its dynamic rewrite`);
    const source = fs.readFileSync(path.join(root, file));
    assert.equal(manifest[file], createHash("sha256").update(source).digest("hex"), `${file} template is stale`);
    assert.equal(fs.readFileSync(path.join(root, "functions/public-pages", file), "utf8"), source.toString("utf8"));
    if (route !== "/") assert.ok(rewrite.source.includes(file));
  }
  for (const file of ["dashboard.html", "register.html", "login.html", "maintenance.html", "coming-soon.html"]) {
    assert.ok(!config.hosting.ignore.includes(file));
    assert.ok(!rewrite.source.includes(file));
  }
  const csp = config.hosting.headers[0].headers.find(header => header.key === "Content-Security-Policy").value;
  assert.ok(csp.includes("https://apis.google.com"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(!csp.includes("script-src *"));
});
