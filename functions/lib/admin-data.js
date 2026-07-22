const { onCall } = require("firebase-functions/v2/https");
const { REGION, db, requireAdmin } = require("./helpers");

const SUMMARY_FIELDS = [
  "name", "email", "accountType", "status", "specialty", "rank", "manualRank",
  "createdAt", "referralCode", "earlyAccess"
];

exports.getAdminUserSummaries = onCall({ region: REGION, enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" }, async request => {
  await requireAdmin(request, ["overview.view", "ranks.manage", "promotions.manage"]);
  const snapshot = await db.collection("users").orderBy("createdAt", "desc").limit(100).get();
  return {
    users: snapshot.docs.map(document => {
      const source = document.data();
      const summary = { id: document.id };
      SUMMARY_FIELDS.forEach(field => {
        if (source[field] !== undefined) summary[field] = source[field];
      });
      return summary;
    })
  };
});
