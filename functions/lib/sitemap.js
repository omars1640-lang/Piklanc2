const { createHash } = require("node:crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { db, REGION } = require("./helpers");

const ORIGIN = "https://piklance.com";
const NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";
const STATIC_PAGES = [
  "/", "/services.html", "/freelancers.html", "/blog.html", "/about.html",
  "/how-it-works.html", "/faq.html", "/contact.html", "/support.html",
  "/legal.html", "/terms.html", "/privacy.html", "/cookie-policy.html",
  "/refund-policy.html", "/dispute-policy.html", "/prohibited-services.html"
];
const COLLECTIONS = {
  "/sitemap-services.xml": { collection: "services", page: "/service-details.html" },
  "/sitemap-articles.xml": { collection: "articles", page: "/article.html" }
};
const MAX_URLS = 50000;

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[character]);
}

function lastModified(data, now) {
  for (const field of ["updatedAt", "publishedAt", "createdAt"]) {
    const value = data[field];
    const date = value instanceof Date ? value : value?.toDate?.();
    if (date instanceof Date && Number.isFinite(date.getTime()) && date.getTime() <= now) {
      return date.toISOString();
    }
  }
  return "";
}

function xmlDocument(root, entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="${NAMESPACE}">\n${entries.join("\n")}\n</${root}>\n`;
}

function urlEntry(url, modified = "") {
  return `  <url><loc>${escapeXml(url)}</loc>${modified ? `<lastmod>${escapeXml(modified)}</lastmod>` : ""}</url>`;
}

function createSitemapHandler(database, now = Date.now) {
  const cache = new Map();
  const pending = new Map();

  async function build(path) {
    if (path === "/sitemap.xml") {
      return xmlDocument("sitemapindex", ["/sitemap-pages.xml", ...Object.keys(COLLECTIONS)]
        .map(file => `  <sitemap><loc>${ORIGIN}${file}</loc></sitemap>`));
    }
    if (path === "/sitemap-pages.xml") {
      return xmlDocument("urlset", STATIC_PAGES.map(page => urlEntry(ORIGIN + page)));
    }
    const source = COLLECTIONS[path];
    const snapshot = await database.collection(source.collection)
      .where("status", "==", "published")
      .select("status", "updatedAt", "publishedAt", "createdAt")
      .limit(MAX_URLS + 1).get();
    // shortcut: one sitemap per collection; shard before a collection exceeds 50,000 public URLs.
    if (snapshot.size > MAX_URLS) throw new Error("Sitemap collection requires sharding");
    const entries = snapshot.docs
      .filter(document => document.data().status === "published")
      .map(document => urlEntry(`${ORIGIN}${source.page}?id=${encodeURIComponent(document.id)}`,
        lastModified(document.data(), now())));
    return xmlDocument("urlset", entries);
  }

  return async (request, response) => {
    response.set("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(request.method)) {
      return response.set("Allow", "GET, HEAD").set("Cache-Control", "no-store").status(405).send("Method not allowed");
    }
    const path = request.path;
    if (!["/sitemap.xml", "/sitemap-pages.xml", ...Object.keys(COLLECTIONS)].includes(path)) {
      return response.set("Cache-Control", "no-store").status(404).send("Not found");
    }
    try {
      let result = cache.get(path);
      if (!result || result.expires <= now()) {
        if (!pending.has(path)) {
          const operation = build(path).then(body => {
            const fresh = { body, etag: `"${createHash("sha256").update(body).digest("hex")}"`, expires: now() + 60000 };
            cache.set(path, fresh);
            return fresh;
          }).finally(() => pending.delete(path));
          pending.set(path, operation);
        }
        result = await pending.get(path);
      }
      response.set("Content-Type", "application/xml; charset=utf-8")
        .set("Cache-Control", "public, max-age=0, s-maxage=240")
        .set("ETag", result.etag);
      return response.status(200).send(request.method === "HEAD" ? "" : result.body);
    } catch (error) {
      console.error("Unable to generate public sitemap", error.message);
      return response.set("Cache-Control", "no-store").set("Retry-After", "60")
        .status(503).send("Sitemap temporarily unavailable");
    }
  };
}

exports.publicSitemap = onRequest({
  region: REGION, invoker: "public", timeoutSeconds: 60, memory: "256MiB", maxInstances: 3
}, createSitemapHandler(db));
exports._test = { createSitemapHandler, escapeXml, lastModified, STATIC_PAGES };
