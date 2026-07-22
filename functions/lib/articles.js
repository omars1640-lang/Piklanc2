const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { FieldPath } = require("firebase-admin/firestore");
const {
  FieldValue, HttpsError, REGION, Timestamp, cleanText, db, requireAdmin, requireAuth, requireProfile, storageBucket
} = require("./helpers");

const ARTICLE_STATUSES = new Set(["draft", "published"]);
const ARTICLE_ID = /^[A-Za-z0-9_-]{8,120}$/;
const OPERATION_ID = /^[A-Za-z0-9_-]{8,160}$/;

function requiredId(value, pattern, message) {
  const id = cleanText(value, 160);
  if (!pattern.test(id)) throw new HttpsError("invalid-argument", message);
  return id;
}

function slugify(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\u0600-\u06ff\w-]/g, "");
}

function searchTokens(...values) {
  const words = values.join(" ").toLowerCase().replace(/[^\u0600-\u06ffa-z0-9\s_-]/gi, " ").split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, 80);
}

function auditData(admin, action, article, reason = "") {
  return {
    action,
    actorUid: admin.id,
    actorName: admin.name || admin.email || "",
    actorEmail: admin.email || "",
    targetUid: article.id,
    targetName: article.title || "",
    reason,
    createdAt: FieldValue.serverTimestamp()
  };
}

function operationReference(operationId) {
  return db.doc(`adminOperations/${operationId}`);
}

exports.registerArticleView = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const uid = requireAuth(request);
  await requireProfile(uid);
  const articleId = requiredId(request.data?.articleId, ARTICLE_ID, "معرف المقال غير صالح.");
  const articleRef = db.doc(`articles/${articleId}`);
  const viewRef = db.doc(`articleViews/${articleId}_${uid}`);
  const counted = await db.runTransaction(async transaction => {
    const [article, previous] = await Promise.all([transaction.get(articleRef), transaction.get(viewRef)]);
    if (!article.exists || article.data().status !== "published") throw new HttpsError("not-found", "المقال غير موجود.");
    if (previous.exists) return false;
    transaction.create(viewRef, { articleId, uid, createdAt: FieldValue.serverTimestamp() });
    transaction.update(articleRef, { views: FieldValue.increment(1) });
    return true;
  });
  return { counted };
});

function operationExpiry() {
  return Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

async function deleteStoredCover(path) {
  if (!path || !String(path).startsWith("article-covers/")) return;
  await storageBucket().file(path).delete({ ignoreNotFound: true }).catch(error => {
    console.warn("Unable to delete replaced article cover", path, error);
  });
}

async function purgeArticleData(articleId) {
  const articleRef = db.doc(`articles/${articleId}`);
  const articleSnapshot = await articleRef.get();
  if (articleSnapshot.exists) await db.recursiveDelete(articleRef);
  await Promise.allSettled([
    db.doc(`articleBodies/${articleId}`).delete(),
    storageBucket().deleteFiles({ prefix: `article-covers/${articleId}/` })
  ]);
  return articleSnapshot.data() || {};
}

exports.saveArticle = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const admin = await requireAdmin(request, "content.manage");
  const articleId = requiredId(request.data?.articleId, ARTICLE_ID, "معرّف المقال غير صالح.");
  const operationId = requiredId(request.data?.operationId, OPERATION_ID, "معرّف عملية الحفظ غير صالح.");
  const title = cleanText(request.data?.title, 160);
  const excerpt = cleanText(request.data?.excerpt, 300);
  const body = cleanText(request.data?.body, 30000);
  const status = cleanText(request.data?.status, 20);
  if (title.length < 3 || excerpt.length < 3 || body.length < 3 || !ARTICLE_STATUSES.has(status)) {
    throw new HttpsError("invalid-argument", "أكمل عنوان المقال وملخصه ومحتواه وحدد حالة صالحة.");
  }

  const category = cleanText(request.data?.category, 60) || "عام";
  const authorName = cleanText(request.data?.authorName, 100) || admin.name || admin.email || "فريق PikLance";
  const tags = Array.isArray(request.data?.tags)
    ? [...new Set(request.data.tags.map(value => cleanText(value, 40)).filter(Boolean))].slice(0, 12)
    : [];
  const coverUrl = cleanText(request.data?.coverUrl, 1200);
  const coverPath = cleanText(request.data?.coverPath, 500);
  if (coverUrl) {
    try {
      const parsed = new URL(coverUrl);
      if (parsed.protocol !== "https:" || parsed.hostname !== "firebasestorage.googleapis.com") throw new Error("untrusted_cover_host");
    } catch {
      throw new HttpsError("invalid-argument", "رابط صورة الغلاف غير صالح.");
    }
  }
  if (coverPath && !coverPath.startsWith(`article-covers/${articleId}/`)) {
    throw new HttpsError("invalid-argument", "مسار صورة غلاف المقال غير صالح.");
  }
  if (coverPath) {
    const [exists] = await storageBucket().file(coverPath).exists();
    if (!exists) throw new HttpsError("failed-precondition", "صورة غلاف المقال المرفوعة غير موجودة.");
  }

  const articleRef = db.doc(`articles/${articleId}`);
  const bodyRef = db.doc(`articleBodies/${articleId}`);
  const operationRef = operationReference(operationId);
  const revisionRef = articleRef.collection("revisions").doc();
  const categoryRef = db.doc(`articleCategories/${slugify(category) || "general"}`);
  const auditRef = db.collection("adminAuditLogs").doc();
  let previousCoverPath = "";

  const result = await db.runTransaction(async transaction => {
    const [operationSnapshot, articleSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(articleRef)
    ]);
    if (operationSnapshot.exists) return operationSnapshot.data().result;

    const current = articleSnapshot.exists ? articleSnapshot.data() : {};
    previousCoverPath = current.coverPath || "";
    const now = FieldValue.serverTimestamp();
    const publishedAt = status === "published" ? (current.publishedAt || now) : (current.publishedAt || null);
    const metadata = {
      title,
      slug: slugify(title),
      category,
      tags,
      searchTokens: searchTokens(title, excerpt, category, tags.join(" ")),
      coverUrl,
      coverPath,
      excerpt,
      status,
      featured: Boolean(request.data?.featured),
      authorUid: current.authorUid || admin.id,
      authorName,
      readingMinutes: Math.max(2, Math.ceil(body.split(/\s+/).filter(Boolean).length / 180)),
      contentVersion: Number(current.contentVersion || 0) + 1,
      schemaVersion: 2,
      updatedAt: now,
      updatedBy: admin.id,
      publishedAt,
      deletedAt: FieldValue.delete(),
      deletedBy: FieldValue.delete(),
      body: FieldValue.delete()
    };
    if (!articleSnapshot.exists) {
      metadata.createdAt = now;
      metadata.views = 0;
      metadata.likesCount = 0;
      metadata.commentsCount = 0;
    }

    transaction.set(articleRef, metadata, { merge: true });
    transaction.set(bodyRef, { body, version: Number(current.contentVersion || 0) + 1, updatedAt: now, updatedBy: admin.id }, { merge: true });
    transaction.set(revisionRef, { body, title, excerpt, status, createdAt: now, createdBy: admin.id });
    transaction.set(categoryRef, { name: category, active: true, updatedAt: now }, { merge: true });
    transaction.set(auditRef, auditData(admin, articleSnapshot.exists ? "update_article" : "create_article", { id: articleId, title }, status));
    const response = { ok: true, articleId, created: !articleSnapshot.exists };
    transaction.set(operationRef, { type: "save_article", actorUid: admin.id, articleId, result: response, createdAt: now, expireAt: operationExpiry() });
    return response;
  });

  if (Boolean(request.data?.featured)) {
    const featured = await db.collection("articles").where("featured", "==", true).get();
    const writer = db.bulkWriter();
    featured.docs.filter(item => item.id !== articleId).forEach(item => {
      writer.update(item.ref, { featured: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.id });
    });
    await writer.close();
  }
  if (previousCoverPath && previousCoverPath !== coverPath) await deleteStoredCover(previousCoverPath);
  const oldRevisions = await articleRef.collection("revisions").orderBy("createdAt", "desc").offset(20).limit(50).get();
  if (!oldRevisions.empty) {
    const writer = db.bulkWriter();
    oldRevisions.docs.forEach(item => writer.delete(item.ref));
    await writer.close();
  }
  return result;
});

exports.updateArticleStatus = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const admin = await requireAdmin(request, "content.manage");
  const articleId = requiredId(request.data?.articleId, ARTICLE_ID, "معرّف المقال غير صالح.");
  const operationId = requiredId(request.data?.operationId, OPERATION_ID, "معرّف العملية غير صالح.");
  const status = cleanText(request.data?.status, 20);
  if (!ARTICLE_STATUSES.has(status)) throw new HttpsError("invalid-argument", "حالة المقال غير صالحة.");
  const articleRef = db.doc(`articles/${articleId}`);
  const operationRef = operationReference(operationId);
  return db.runTransaction(async transaction => {
    const [operationSnapshot, articleSnapshot] = await Promise.all([transaction.get(operationRef), transaction.get(articleRef)]);
    if (operationSnapshot.exists) return operationSnapshot.data().result;
    if (!articleSnapshot.exists) throw new HttpsError("not-found", "المقال غير موجود.");
    const article = articleSnapshot.data();
    const updates = { status, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.id };
    if (status === "published" && !article.publishedAt) updates.publishedAt = FieldValue.serverTimestamp();
    transaction.update(articleRef, updates);
    transaction.set(db.collection("adminAuditLogs").doc(), auditData(admin, "update_article", { id: articleId, title: article.title }, `status: ${status}`));
    const result = { ok: true, articleId, status };
    transaction.set(operationRef, { type: "update_article_status", actorUid: admin.id, articleId, result, createdAt: FieldValue.serverTimestamp(), expireAt: operationExpiry() });
    return result;
  });
});

exports.archiveArticle = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const admin = await requireAdmin(request, "content.manage");
  const articleId = requiredId(request.data?.articleId, ARTICLE_ID, "معرّف المقال غير صالح.");
  const operationId = requiredId(request.data?.operationId, OPERATION_ID, "معرّف العملية غير صالح.");
  const articleRef = db.doc(`articles/${articleId}`);
  const operationRef = operationReference(operationId);
  return db.runTransaction(async transaction => {
    const [operationSnapshot, articleSnapshot] = await Promise.all([transaction.get(operationRef), transaction.get(articleRef)]);
    if (operationSnapshot.exists) return operationSnapshot.data().result;
    if (!articleSnapshot.exists) throw new HttpsError("not-found", "المقال غير موجود.");
    const article = articleSnapshot.data();
    transaction.update(articleRef, {
      status: "trash", previousStatus: article.status || "draft", featured: false,
      deletedAt: FieldValue.serverTimestamp(), deletedBy: admin.id,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.id
    });
    transaction.set(db.collection("adminAuditLogs").doc(), auditData(admin, "archive_article", { id: articleId, title: article.title }, "trash"));
    const result = { ok: true, articleId, status: "trash" };
    transaction.set(operationRef, { type: "archive_article", actorUid: admin.id, articleId, result, createdAt: FieldValue.serverTimestamp(), expireAt: operationExpiry() });
    return result;
  });
});

exports.restoreArticle = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  const admin = await requireAdmin(request, "content.manage");
  const articleId = requiredId(request.data?.articleId, ARTICLE_ID, "معرّف المقال غير صالح.");
  const operationId = requiredId(request.data?.operationId, OPERATION_ID, "معرّف العملية غير صالح.");
  const articleRef = db.doc(`articles/${articleId}`);
  const operationRef = operationReference(operationId);
  return db.runTransaction(async transaction => {
    const [operationSnapshot, articleSnapshot] = await Promise.all([transaction.get(operationRef), transaction.get(articleRef)]);
    if (operationSnapshot.exists) return operationSnapshot.data().result;
    if (!articleSnapshot.exists) throw new HttpsError("not-found", "المقال غير موجود.");
    const article = articleSnapshot.data();
    const status = ARTICLE_STATUSES.has(article.previousStatus) ? article.previousStatus : "draft";
    transaction.update(articleRef, {
      status, previousStatus: FieldValue.delete(), deletedAt: FieldValue.delete(), deletedBy: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.id
    });
    transaction.set(db.collection("adminAuditLogs").doc(), auditData(admin, "restore_article", { id: articleId, title: article.title }, status));
    const result = { ok: true, articleId, status };
    transaction.set(operationRef, { type: "restore_article", actorUid: admin.id, articleId, result, createdAt: FieldValue.serverTimestamp(), expireAt: operationExpiry() });
    return result;
  });
});

exports.deleteArticlePermanently = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true", timeoutSeconds: 120 }, async request => {
  const admin = await requireAdmin(request, "content.manage");
  const articleId = requiredId(request.data?.articleId, ARTICLE_ID, "معرّف المقال غير صالح.");
  const operationId = requiredId(request.data?.operationId, OPERATION_ID, "معرّف العملية غير صالح.");
  const operationRef = operationReference(operationId);
  const completed = await operationRef.get();
  if (completed.exists) return completed.data().result;
  const articleRef = db.doc(`articles/${articleId}`);
  const articleSnapshot = await articleRef.get();
  const article = articleSnapshot.data() || {};
  if (articleSnapshot.exists && article.status !== "trash") {
    throw new HttpsError("failed-precondition", "انقل المقال إلى المحذوفات قبل حذفه نهائياً.");
  }
  await purgeArticleData(articleId);
  const result = { ok: true, articleId, deleted: true };
  const batch = db.batch();
  batch.set(db.collection("adminAuditLogs").doc(), auditData(admin, "delete_article", { id: articleId, title: article.title || articleId }, "permanent"));
  batch.set(operationRef, { type: "delete_article", actorUid: admin.id, articleId, result, createdAt: FieldValue.serverTimestamp(), expireAt: operationExpiry() });
  await batch.commit();
  return result;
});

exports.migrateArticlesForScale = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true", timeoutSeconds: 120 }, async request => {
  const admin = await requireAdmin(request, "content.manage");
  const migrationRef = db.doc("platformMigrations/ARTICLE_SCALE_V2");
  const migration = await migrationRef.get();
  if (migration.data()?.status === "completed") return { ok: true, completed: true, migrated: 0 };

  let cursor = migration.data()?.cursor || "";
  let migrated = 0;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    let articlesQuery = db.collection("articles").orderBy(FieldPath.documentId()).limit(25);
    if (cursor) articlesQuery = articlesQuery.startAfter(cursor);
    const snapshot = await articlesQuery.get();
    if (snapshot.empty) {
      await migrationRef.set({ status: "completed", completedAt: FieldValue.serverTimestamp(), completedBy: admin.id }, { merge: true });
      return { ok: true, completed: true, migrated };
    }

    let batchMigrated = 0;
    for (const articleDocument of snapshot.docs) {
      const article = articleDocument.data();
      if (article.schemaVersion === 2) continue;
      const [likes, comments, existingBody] = await Promise.all([
        articleDocument.ref.collection("likes").count().get(),
        articleDocument.ref.collection("comments").where("status", "==", "published").count().get(),
        db.doc(`articleBodies/${articleDocument.id}`).get()
      ]);
      const body = article.body || existingBody.data()?.body || "";
      const batch = db.batch();
      batch.set(db.doc(`articleBodies/${articleDocument.id}`), {
        body, version: Number(article.contentVersion || existingBody.data()?.version || 1),
        updatedAt: article.updatedAt || article.createdAt || FieldValue.serverTimestamp(),
        updatedBy: article.updatedBy || article.authorUid || admin.id
      }, { merge: true });
      batch.update(articleDocument.ref, {
        body: FieldValue.delete(),
        schemaVersion: 2,
        contentVersion: Number(article.contentVersion || existingBody.data()?.version || 1),
        readingMinutes: Math.max(2, Math.ceil(String(body).split(/\s+/).filter(Boolean).length / 180)),
        likesCount: likes.data().count,
        commentsCount: comments.data().count,
        searchTokens: searchTokens(article.title, article.excerpt, article.category, (article.tags || []).join(" "))
      });
      const category = cleanText(article.category, 60) || "عام";
      batch.set(db.doc(`articleCategories/${slugify(category) || "general"}`), {
        name: category, active: true, updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      await batch.commit();
      migrated += 1;
      batchMigrated += 1;
    }
    cursor = snapshot.docs.at(-1).id;
    await migrationRef.set({ status: "running", cursor, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.id, migrated: FieldValue.increment(batchMigrated) }, { merge: true });
    if (snapshot.size < 25) {
      await migrationRef.set({ status: "completed", completedAt: FieldValue.serverTimestamp(), completedBy: admin.id }, { merge: true });
      return { ok: true, completed: true, migrated };
    }
  }
  return { ok: true, completed: false, migrated };
});

exports.purgeExpiredArticles = onSchedule({
  schedule: "every day 03:00",
  timeZone: "Asia/Damascus",
  region: REGION,
  timeoutSeconds: 540
}, async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const expired = await db.collection("articles")
    .where("status", "==", "trash")
    .where("deletedAt", "<=", cutoff)
    .limit(50)
    .get();
  for (const article of expired.docs) await purgeArticleData(article.id);
  console.log(`Purged ${expired.size} expired articles`);
});

module.exports._test = { slugify, searchTokens };
