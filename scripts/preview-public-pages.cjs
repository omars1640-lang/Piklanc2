// Local read-only preview: anonymous Firestore REST reads only; no Admin credentials or writes.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { _test: { createPublicPageHandler } } = require("../functions/lib/public-pages");
const { PUBLIC_PAGES } = require("../functions/lib/public-page-config");
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4177);
function decode(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value || "doubleValue" in value) return Number(value.integerValue ?? value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  return null;
}
const database = { doc(key) {
  if (!/^(?:platformSettings\/general|(?:articles|articleBodies|services|publicProfiles)\/[A-Za-z0-9_-]{1,128})$/.test(key)) throw new Error("Preview read not allowed");
  return { async get() {
    const result = await fetch(`https://firestore.googleapis.com/v1/projects/piklance-c2651/databases/(default)/documents/${key}`, { signal: AbortSignal.timeout(10000) });
    if (result.status === 404) return { exists: false };
    let record;
    if (result.status === 403 && /^(?:articles|services)\//.test(key)) {
      // Public rules cannot authorize a missing document GET; a published-only query can return an empty result safely.
      const query = await fetch('https://firestore.googleapis.com/v1/projects/piklance-c2651/databases/(default)/documents:runQuery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: key.split('/')[0] }], limit: 1,
          where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
          orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
          startAt: { values: [{ referenceValue: `projects/piklance-c2651/databases/(default)/documents/${key}` }], before: true }
        } })
      });
      if (!query.ok) throw new Error(`Public preview query returned ${query.status}`);
      record = (await query.json()).find(row => row.document)?.document;
      if (!record || !record.name.endsWith(`/documents/${key}`)) return { exists: false };
    } else {
      if (!result.ok) throw new Error(`Public preview read returned ${result.status}`);
      record = await result.json();
    }
    const data = Object.fromEntries(Object.entries(record.fields || {}).map(([name, value]) => [name, decode(value)]));
    return { exists: true, data: () => data };
  } };
} };
const render = createPublicPageHandler(database);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };
const config = require("../firebase.json");
http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
  for (const header of config.hosting.headers[0].headers) res.setHeader(header.key, header.value);
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (PUBLIC_PAGES.includes(url.pathname) || url.pathname === "/index.html") {
    const response = {
      set(key, value) { res.setHeader(key, value); return this; },
      status(code) { res.statusCode = code; return this; },
      send(body) { res.end(body); return this; }
    };
    await render({ method: req.method, originalUrl: req.url, headers: req.headers }, response);
    return;
  }
  try {
    const allowed = /^\/(?:assets|css|js)\//.test(url.pathname) || /^\/[a-z0-9-]+\.html$/.test(url.pathname);
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!allowed || !file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error("Not found");
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    res.end(req.method === "HEAD" ? "" : fs.readFileSync(file));
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`Read-only public-page preview: http://127.0.0.1:${port}`));
