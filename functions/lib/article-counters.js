const crypto = require("crypto");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { FieldValue, REGION, db } = require("./helpers");
const { Timestamp } = require("firebase-admin/firestore");

function eventReference(eventId) {
  const id = crypto.createHash("sha256").update(String(eventId || "unknown")).digest("hex");
  return db.doc(`systemEvents/${id}`);
}

async function applyCounter(event, field, delta) {
  if (!delta) return;
  const articleId = event.params.articleId;
  const articleRef = db.doc(`articles/${articleId}`);
  const markerRef = eventReference(event.id);
  await db.runTransaction(async transaction => {
    const [marker, article] = await Promise.all([transaction.get(markerRef), transaction.get(articleRef)]);
    if (marker.exists || !article.exists) return;
    const current = Number(article.data()[field] || 0);
    transaction.update(articleRef, { [field]: Math.max(0, current + delta) });
    transaction.set(markerRef, {
      type: "article_counter", articleId, field, delta,
      createdAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
  });
}

exports.syncArticleLikesCount = onDocumentWritten({
  region: REGION,
  document: "articles/{articleId}/likes/{likeId}"
}, async event => {
  const before = event.data?.before.exists ? 1 : 0;
  const after = event.data?.after.exists ? 1 : 0;
  await applyCounter(event, "likesCount", after - before);
});

exports.syncArticleCommentsCount = onDocumentWritten({
  region: REGION,
  document: "articles/{articleId}/comments/{commentId}"
}, async event => {
  const before = event.data?.before.exists && event.data.before.data()?.status === "published" ? 1 : 0;
  const after = event.data?.after.exists && event.data.after.data()?.status === "published" ? 1 : 0;
  await applyCounter(event, "commentsCount", after - before);
});

module.exports._test = { eventReference };
