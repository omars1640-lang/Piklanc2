const { onCall } = require("firebase-functions/v2/https");
const { FieldValue, HttpsError, REGION, cleanText, db, requireSuperAdmin } = require("./helpers");

const PERMISSIONS = new Set([
  "users.view", "users.manage", "verifications.view", "verifications.manage",
  "conversations.view", "services.view", "services.moderate", "support.view", "support.reply",
  "content.view", "content.manage", "promotions.manage", "ranks.manage"
]);

function normalizedPermissions(values) {
  if (!Array.isArray(values)) return [];
  const selected = new Set(values.map(value => cleanText(value, 60)).filter(value => PERMISSIONS.has(value)));
  const implications = {
    "users.manage": "users.view", "verifications.manage": "verifications.view",
    "services.moderate": "services.view", "support.reply": "support.view", "content.manage": "content.view"
  };
  Object.entries(implications).forEach(([manage, view]) => { if (selected.has(manage)) selected.add(view); });
  return [...selected];
}

exports.saveAdminRole = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  const admin = await requireSuperAdmin(request);
  const roleId = cleanText(request.data?.roleId, 80);
  const name = cleanText(request.data?.name, 80);
  const description = cleanText(request.data?.description, 240);
  const permissions = normalizedPermissions(request.data?.permissions);
  if (name.length < 2 || !permissions.length) {
    throw new HttpsError("invalid-argument", "أدخل اسم الدور وحدد صلاحية واحدة على الأقل.");
  }
  const reference = roleId ? db.doc(`adminRoles/${roleId}`) : db.collection("adminRoles").doc();
  const current = await reference.get();
  await reference.set({
    name, description, permissions, active: true,
    createdAt: current.data()?.createdAt || FieldValue.serverTimestamp(),
    createdBy: current.data()?.createdBy || admin.id,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.id
  }, { merge: true });
  return { ok: true, roleId: reference.id };
});

exports.deleteAdminRole = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  await requireSuperAdmin(request);
  const roleId = cleanText(request.data?.roleId, 80);
  if (!roleId) throw new HttpsError("invalid-argument", "الدور غير صالح.");
  const assigned = await db.collection("users").where("adminRoleId", "==", roleId).limit(1).get();
  if (!assigned.empty) throw new HttpsError("failed-precondition", "لا يمكن حذف دور مرتبط بأحد أعضاء الفريق.");
  await db.doc(`adminRoles/${roleId}`).delete();
  return { ok: true };
});

exports.assignAdminRole = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  const admin = await requireSuperAdmin(request);
  const email = cleanText(request.data?.email, 160).toLowerCase();
  const roleId = cleanText(request.data?.roleId, 80);
  if (!email || !roleId) throw new HttpsError("invalid-argument", "أدخل البريد وحدد الدور.");
  const [roleSnapshot, usersSnapshot] = await Promise.all([
    db.doc(`adminRoles/${roleId}`).get(),
    db.collection("users").where("email", "==", email).limit(1).get()
  ]);
  if (!roleSnapshot.exists) throw new HttpsError("not-found", "الدور غير موجود.");
  if (usersSnapshot.empty) throw new HttpsError("not-found", "لا يوجد حساب مسجل بهذا البريد.");
  const member = usersSnapshot.docs[0];
  if (member.id === admin.id) throw new HttpsError("failed-precondition", "لا يمكن تحويل حساب الإدارة الحالي إلى دور موظف.");
  const data = member.data();
  if (data.role === "admin" && data.adminAccessLevel !== "staff") {
    throw new HttpsError("failed-precondition", "هذا الحساب يملك إدارة كاملة بالفعل ولا يمكن تحويله إلى دور موظف من هنا.");
  }
  const previousRole = data.role === "admin" ? (data.teamPreviousRole || data.accountType || "buyer") : (data.role || data.accountType || "buyer");
  await member.ref.update({
    role: "admin", adminAccessLevel: "staff", adminRoleId: roleId,
    teamPreviousRole: previousRole, teamAssignedAt: FieldValue.serverTimestamp(), teamAssignedBy: admin.id
  });
  return { ok: true, userId: member.id };
});

exports.removeAdminMember = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  const admin = await requireSuperAdmin(request);
  const userId = cleanText(request.data?.userId, 100);
  if (!userId || userId === admin.id) throw new HttpsError("failed-precondition", "لا يمكن إزالة حساب الإدارة الحالي.");
  const reference = db.doc(`users/${userId}`);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data().adminAccessLevel !== "staff") {
    throw new HttpsError("failed-precondition", "هذا الحساب ليس موظفاً ضمن الفريق.");
  }
  const previousRole = snapshot.data().teamPreviousRole || snapshot.data().accountType || "buyer";
  await reference.update({
    role: previousRole,
    adminAccessLevel: FieldValue.delete(), adminRoleId: FieldValue.delete(),
    teamPreviousRole: FieldValue.delete(), teamAssignedAt: FieldValue.delete(), teamAssignedBy: FieldValue.delete()
  });
  return { ok: true };
});
