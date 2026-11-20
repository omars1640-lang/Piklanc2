const fs = require("node:fs");
const path = require("node:path");
const { onRequest } = require("firebase-functions/v2/https");
const { db, REGION } = require("./helpers");
const { ORIGIN, PAGE_DESCRIPTIONS, PUBLIC_PAGES } = require("./public-page-config");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function text(value, max = 10000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function publicImage(value, fallback = "") {
  if (!text(value, 4096).trim()) return fallback;
  try {
    const url = new URL(text(value, 4096), ORIGIN);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : fallback;
  } catch { return fallback; }
}

function excerpt(value) {
  return text(value, 2000).replace(/\s+/g, " ").trim().slice(0, 180);
}

function isoDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function element(html, id, content) {
  const pattern = new RegExp(`(<([a-z][\\w-]*)\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?<\\/\\2>`, "i");
  if (!pattern.test(html)) throw new Error(`Missing public template element: ${id}`);
  return html.replace(pattern, (_, opening, tag) => `${opening}${content}</${tag}>`);
}

function openingTag(html, id, transform) {
  return html.replace(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`, "i"), transform);
}

function removeLoading(tag) {
  return tag.replace(/\bservice-text-loading(?:-[\w-]+)?\b/g, "").replace(/\saria-label="جاري التحميل"/, "");
}

function metadata(html, { title, description, canonical, image, type = "website", structured, noindex = false }) {
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\b(?=[^>]*(?:name="(?:description|robots)"|property="og:[^"]+"))[^>]*>/gi, "")
    .replace(/<link\b(?=[^>]*rel="canonical")[^>]*>/gi, "");
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:locale" content="ar_AR">`,
    `<meta property="og:site_name" content="PikLance">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`
  ];
  if (image) tags.push(`<meta property="og:image" content="${escapeHtml(image)}">`);
  if (noindex) tags.push('<meta name="robots" content="noindex, follow">');
  if (structured) {
    // Escaping '<' also prevents stored content from terminating the JSON script element.
    tags.push(`<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, "\\u003c")}</script>`);
  }
  return html.replace(/<\/head>/i, `${tags.join("\n")}\n</head>`);
}

function markAccess(html, mode) {
  html = html.replace(/<html\b[^>]*>/i, tag => `${tag.replace(/\sdata-platform-(?:mode|access)="[^"]*"/g, "").slice(0, -1)} data-platform-mode="${mode}" data-platform-access="${mode === "open" ? "ready" : "pending"}">`);
  // Replace the old unconditional bootstrap rather than revealing restricted content briefly.
  html = html.replace(/<script>\s*document\.documentElement\.setAttribute\("data-platform-access", "pending"\);\s*<\/script>/, "");
  if (!html.includes('id="platform-access-bootstrap"')) {
    html = html.replace(/<head>/i, '<head><style id="platform-access-bootstrap">html[data-platform-access="pending"] body{visibility:hidden}</style>');
  }
  return html;
}

function articleBody(body) {
  const result = [];
  let list = false;
  const flush = () => { if (list) { result.push("</ul>"); list = false; } };
  for (const raw of text(body, 120000).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("- ")) {
      if (!list) { result.push("<ul>"); list = true; }
      result.push(`<li>${escapeHtml(line.slice(2))}</li>`);
    } else {
      flush();
      const level = line.startsWith("### ") ? 3 : line.startsWith("## ") ? 2 : 0;
      result.push(level ? `<h${level}>${escapeHtml(line.slice(level + 1))}</h${level}>` : `<p>${escapeHtml(line)}</p>`);
    }
  }
  flush();
  return result.join("\n");
}

function renderArticle(html, article, canonical) {
  const title = text(article.title, 300);
  const description = excerpt(article.excerpt || article.body);
  const image = publicImage(article.coverUrl);
  html = element(html, "articleTitle", escapeHtml(title));
  html = element(html, "articleCategory", escapeHtml(text(article.category, 100) || "عام"));
  html = element(html, "articleExcerpt", escapeHtml(text(article.excerpt, 2000)));
  html = element(html, "articleBody", articleBody(article.body));
  html = element(html, "articleTags", (Array.isArray(article.tags) ? article.tags.slice(0, 30) : []).map(tag => `<span>#${escapeHtml(text(tag, 80))}</span>`).join(""));
  const published = isoDate(article.publishedAt || article.createdAt);
  const date = published ? new Date(published).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "حديثاً";
  const minutes = Math.max(2, Math.ceil(text(article.body, 120000).trim().split(/\s+/).length / 180));
  html = element(html, "articleMeta", `<span>${escapeHtml(text(article.authorName, 200) || "فريق PikLance")}</span><span>${date}</span><span>◷ ${Number(article.readingMinutes) || minutes} دقائق قراءة</span><span id="articleViews">${Number(article.views || 0).toLocaleString("en-US")} مشاهدة</span>`);
  html = openingTag(html, "articleState", tag => tag.replace(/>$/, " hidden>"));
  html = openingTag(html, "articlePage", tag => tag.replace(/\s+hidden\b/, ""));
  if (image) {
    const cssUrl = image.replace(/['"()\\]/g, char => `%${char.charCodeAt(0).toString(16)}`);
    html = openingTag(html, "articleCover", tag => tag.replace(/\s+hidden\b/, "").replace(/>$/, ` style="background-image:url('${escapeHtml(cssUrl)}')">`));
  }
  for (const id of ["likesCount", "likesCountMobile"]) html = element(html, id, Number(article.likesCount || 0).toLocaleString("en-US"));
  html = element(html, "commentsCount", Number(article.commentsCount || 0).toLocaleString("en-US"));
  const structured = {
    "@context": "https://schema.org", "@type": "Article", headline: title, description,
    mainEntityOfPage: canonical, image: image || undefined,
    datePublished: published, dateModified: isoDate(article.updatedAt) || published,
    author: { "@type": /^(?:فريق\s+)?PikLance$/i.test(text(article.authorName, 200) || "PikLance") ? "Organization" : "Person", name: text(article.authorName, 200) || "فريق PikLance" },
    publisher: { "@type": "Organization", name: "PikLance", url: ORIGIN }
  };
  return metadata(html, { title: `${title} | PikLance`, description, canonical, image, type: "article", structured });
}

function revisionsLabel(value) {
  const count = Number(value || 0);
  return !count ? "بدون تعديلات" : count === 1 ? "تعديل واحد" : count === 2 ? "تعديلان" : `${count} تعديلات`;
}

function renderService(html, service, profile, canonical) {
  const title = text(service.title, 300);
  const category = text(service.category, 100) || "خدمات رقمية";
  const description = text(service.description, 20000) || "لم يضف المستقل وصفاً تفصيلياً بعد.";
  const name = text(profile?.name || service.ownerName, 200) || "مستقل PikLance";
  const image = publicImage(service.imageUrl, `${ORIGIN}/assets/service-placeholder.svg`);
  const delivery = `${Number(service.deliveryDays || 1)} يوم`;
  const revisions = revisionsLabel(service.revisions);
  const rating = Number(service.rating || 0).toFixed(1);
  const values = {
    breadcrumbCategory: category, serviceCategory: category, serviceTitle: title,
    serviceSubtitle: "خدمة منشورة ومراجعة من إدارة PikLance.", serviceRating: rating,
    reviewCount: `(${Number(service.reviewsCount || 0)} تقييم)`, ordersCount: `${Number(service.completedOrders || 0)} طلب مكتمل`,
    sellerName: name, sellerSpecialty: text(profile?.specialty, 100) || category,
    sellerRating: Number(profile?.rating || service.rating || 0).toFixed(1),
    sellerBio: text(profile?.about, 5000) || "مستقل موثّق يقدّم خدماته عبر PikLance.",
    reviewAverage: rating, packagePrice: `${Number(service.price || 0).toLocaleString("en-US")} ل.س`,
    packageDescription: description, packageDelivery: delivery, packageRevisions: revisions
  };
  for (const [id, value] of Object.entries(values)) {
    html = element(html, id, escapeHtml(value));
    html = openingTag(html, id, removeLoading);
  }
  html = element(html, "serviceDescription", `<p>${escapeHtml(description)}</p>`);
  html = element(html, "deliverablesGrid", [
    ["الخدمة المتفق عليها", description], ["موعد واضح", `التسليم خلال ${delivery} من بدء الطلب.`], ["مراجعات محددة", revisions]
  ].map(([heading, copy]) => `<article><span>✓</span><div><strong>${escapeHtml(heading)}</strong><p>${escapeHtml(copy)}</p></div></article>`).join(""));
  html = element(html, "packageTabs", '<button type="button" class="active">الخدمة الأساسية</button>');
  html = element(html, "packageFeatures", ["تنفيذ الخدمة الموضحة في الوصف", `التسليم خلال ${delivery}`, revisions, "تواصل وتسليم موثّقان داخل PikLance"].map(value => `<li>${escapeHtml(value)}</li>`).join(""));
  html = openingTag(html, "serviceProofLoading", tag => removeLoading(tag).replace(/>$/, " hidden>"));
  html = html.replace(/(<span class="rating service-proof-content") hidden/, "$1");
  html = openingTag(html, "mainServiceImageLoader", tag => tag.replace(/>$/, " hidden>"));
  html = openingTag(html, "mainServiceImage", () => `<img id="mainServiceImage" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" fetchpriority="high">`);
  html = openingTag(html, "sellerImage", () => `<img id="sellerImage" src="${escapeHtml(publicImage(profile?.avatar, `${ORIGIN}/assets/avatar-placeholder.svg`))}" alt="${escapeHtml(name)}">`);
  const profileUrl = `/freelancer-profile.html?uid=${encodeURIComponent(text(service.ownerUid, 128))}`;
  html = openingTag(html, "sellerProfileLink", tag => tag.replace(/href="[^"]*"/, `href="${profileUrl}"`));
  const loginUrl = `/login.html?returnUrl=${encodeURIComponent(new URL(canonical).pathname + new URL(canonical).search)}`;
  for (const id of ["startConversation", "sellerMessageLink"]) html = openingTag(html, id, tag => tag.replace(/href="[^"]*"/, `href="${loginUrl}"`));
  // Reviews remain client-loaded; don't invent a review or a zero-review claim in server HTML.
  html = html.replace('class="related-section"', 'class="related-section" hidden');
  return metadata(html, { title: `${title} - PikLance`, description: excerpt(description), canonical, image });
}

function unavailable(html, message, canonical) {
  html = html.replace(/<main\b[^>]*>[\s\S]*?<\/main>/i, `<main><section class="container" style="padding:150px 24px;text-align:center"><h1>${escapeHtml(message)}</h1><p>يمكنك العودة لتصفح الخدمات والمقالات المتاحة.</p><a href="/services.html">الخدمات</a> · <a href="/blog.html">المقالات</a></section></main>`);
  html = html.replace(/<script type="module" src="js\/(?:service-details|article-content)\.js"><\/script>/g, "");
  return metadata(html, { title: `${message} - PikLance`, description: message, canonical, noindex: true });
}

function readTemplate(route) {
  return fs.readFileSync(path.join(__dirname, "../public-pages", route === "/" ? "index.html" : route.slice(1)), "utf8");
}

function createPublicPageHandler(database, template = readTemplate, timeoutMs = 8000) {
  return async (request, response) => {
    response.set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "private, no-store").set("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(request.method)) return response.set("Allow", "GET, HEAD").status(405).send("");
    const url = new URL(request.originalUrl || request.url || request.path, ORIGIN);
    const route = url.pathname === "/index.html" ? "/" : url.pathname;
    if (!PUBLIC_PAGES.includes(route)) return response.status(404).send("Not found");
    const host = String(request.headers?.["x-forwarded-host"] || request.headers?.host || "").toLowerCase();
    if (host === "www.piklance.com" || url.pathname === "/index.html") {
      const target = host === "www.piklance.com" ? `${ORIGIN}${route}${url.search}` : `${route}${url.search}`;
      return response.set("Location", target).status(301).send("");
    }
    const dynamic = route === "/article.html" || route === "/service-details.html";
    const ids = url.searchParams.getAll("id");
    const id = ids.length === 1 && /^[A-Za-z0-9_-]{1,128}$/.test(ids[0]) ? ids[0] : "";
    const canonical = `${ORIGIN}${route}${dynamic && id ? `?id=${encodeURIComponent(id)}` : ""}`;
    let html;
    const send = (code, body) => response.status(code).send(request.method === "HEAD" ? "" : body);
    const deadline = Date.now() + timeoutMs;
    async function readDocument(key) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Public page read deadline exceeded");
      let timer;
      try {
        return await Promise.race([
          database.doc(key).get(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Public page read deadline exceeded")), remaining); })
        ]);
      } finally { clearTimeout(timer); }
    }
    try {
      html = template(route);
      const settings = await readDocument("platformSettings/general");
      const config = settings.exists ? settings.data() : {};
      const mode = config.maintenanceMode === true ? "maintenance" : config.prelaunchMode === true ? "prelaunch" : "open";
      html = markAccess(html, mode);
      if (mode !== "open") {
        // Don't serialize public content while closed. The unchanged auth guard can still admit admins/early access.
        response.set("X-Robots-Tag", "noindex, follow").set("Retry-After", "300");
        return send(503, metadata(html, { title: "PikLance", description: "المنصة غير متاحة للعموم حالياً.", canonical, noindex: true }));
      }
      if (!dynamic) {
        const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "PikLance";
        return send(200, metadata(html, { title, description: PAGE_DESCRIPTIONS[route], canonical,
          image: `${ORIGIN}/assets/brand/logo-light.svg`,
          structured: route === "/" ? { "@context": "https://schema.org", "@type": "Organization", name: "PikLance", url: ORIGIN, logo: `${ORIGIN}/assets/brand/logo-light.svg` } : undefined }));
      }
      const isArticle = route === "/article.html";
      const snapshot = id ? await readDocument(`${isArticle ? "articles" : "services"}/${id}`) : null;
      if (!snapshot?.exists || snapshot.data().status !== "published") {
        response.set("X-Robots-Tag", "noindex, follow");
        return send(404, unavailable(html, isArticle ? "المقال غير موجود" : "الخدمة غير موجودة", canonical));
      }
      const data = snapshot.data();
      if (isArticle) {
        const body = await readDocument(`articleBodies/${id}`);
        return send(200, renderArticle(html, { ...data, body: body.exists ? body.data().body : data.body }, canonical));
      }
      const ownerUid = text(data.ownerUid, 128);
      const profile = /^[A-Za-z0-9_-]{1,128}$/.test(ownerUid) ? await readDocument(`publicProfiles/${ownerUid}`) : null;
      return send(200, renderService(html, data, profile?.exists ? profile.data() : null, canonical));
    } catch (error) {
      console.error("Public page rendering failed", error.message);
      response.set("Retry-After", "60").set("X-Robots-Tag", "noindex, follow");
      // A network/backend error is not a deleted service/article (never return 404 for a transient failure).
      const body = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PikLance — غير متاح مؤقتاً</title><link rel="stylesheet" href="/css/brand.css"></head><body><main style="max-width:700px;margin:15vh auto;padding:24px;text-align:center"><a href="/"><img src="/assets/brand/logo-light.svg" alt="PikLance" width="180"></a><h1>تعذر تحميل الصفحة مؤقتاً</h1><p>يرجى إعادة المحاولة بعد قليل.</p><a href="/login.html">تسجيل الدخول</a></main></body></html>';
      return send(503, body);
    }
  };
}

exports.publicPage = onRequest({ region: REGION, invoker: "public", timeoutSeconds: 30, memory: "256MiB", maxInstances: 3 }, createPublicPageHandler(db));
exports._test = { createPublicPageHandler, escapeHtml, publicImage, articleBody, metadata, renderArticle, renderService, markAccess };
