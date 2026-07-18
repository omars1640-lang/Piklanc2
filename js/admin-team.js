import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { auth, db, functions } from "./firebase.js";
import { getAdminAccess, initializeAdminAccess } from "./admin-access.js";

const permissionGroups = [
  ["المستخدمون", [["users.view", "الاطلاع على المستخدمين"], ["users.manage", "إيقاف وتفعيل الحسابات"]]],
  ["طلبات المستقلين", [["verifications.view", "الاطلاع على طلبات التسجيل"], ["verifications.manage", "قبول ورفض الطلبات"]]],
  ["الخدمات", [["services.view", "الاطلاع على الخدمات والطلبات"], ["services.moderate", "قبول ورفض وحذف الخدمات"]]],
  ["الدعم", [["support.view", "الاطلاع على تذاكر الدعم"], ["support.reply", "الرد وتغيير حالة التذاكر"]]],
  ["المحتوى", [["content.view", "الاطلاع على المحتوى"], ["content.manage", "إنشاء وتعديل ونشر المحتوى والتصنيفات"]]],
  ["المحادثات", [["conversations.view", "الاطلاع على محادثات المنصة"]]],
  ["التشغيل", [["ranks.manage", "إدارة رتب المستقلين"], ["promotions.manage", "إدارة الأكواد والشارات"]]]
];

const presets = [
  { name: "موظف دعم العملاء", description: "متابعة تذاكر الدعم والرد عليها.", permissions: ["support.view", "support.reply"] },
  { name: "كاتب محتوى", description: "إدارة المقالات والأسئلة الشائعة والتصنيفات.", permissions: ["content.view", "content.manage"] },
  { name: "مراجع المستقلين والخدمات", description: "مراجعة طلبات المستقلين والخدمات الجديدة.", permissions: ["verifications.view", "verifications.manage", "services.view", "services.moderate"] }
];

const state = { admin: null, roles: [], members: [] };
const $ = id => document.getElementById(id);

function toast(message) {
  const element = $("adminToast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3500);
}

function roleName(member) {
  if (member.adminAccessLevel !== "staff") return "إدارة كاملة";
  return state.roles.find(role => role.id === member.adminRoleId)?.name || "دور محذوف أو غير متاح";
}

function renderMembers() {
  $("teamMembersCount").textContent = state.members.length.toLocaleString("en-US");
  const list = $("teamMembersList");
  list.replaceChildren(...state.members.map(member => {
    const card = document.createElement("article");
    card.className = "team-member-card";
    const avatar = document.createElement("span");
    avatar.className = "table-avatar";
    avatar.textContent = (member.name || member.email || "أ").trim().charAt(0).toUpperCase();
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = member.name || "عضو إدارة";
    const email = document.createElement("small");
    email.textContent = member.email || "-";
    const role = document.createElement("b");
    role.textContent = roleName(member);
    copy.append(name, email, role);
    card.append(avatar, copy);
    if (member.adminAccessLevel === "staff") {
      const actions = document.createElement("div");
      actions.className = "team-member-actions";
      const select = document.createElement("select");
      state.roles.forEach(item => select.append(new Option(item.name, item.id)));
      select.value = member.adminRoleId || "";
      select.addEventListener("change", () => assignMember(member.email, select.value));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "table-button reject";
      remove.textContent = "إزالة";
      remove.addEventListener("click", () => removeMember(member));
      actions.append(select, remove);
      card.appendChild(actions);
    }
    return card;
  }));
}

function renderRoles() {
  const roleSelect = $("teamMemberRole");
  roleSelect.replaceChildren(new Option("اختر الدور", ""), ...state.roles.map(role => new Option(role.name, role.id)));
  $("adminRolesList").replaceChildren(...state.roles.map(role => {
    const card = document.createElement("article");
    card.className = "role-card";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = role.name;
    const description = document.createElement("p");
    description.textContent = role.description || "بدون وصف";
    const count = document.createElement("small");
    count.textContent = `${role.permissions?.length || 0} صلاحيات · ${state.members.filter(member => member.adminRoleId === role.id).length} أعضاء`;
    copy.append(title, description, count);
    const actions = document.createElement("div");
    actions.className = "table-actions";
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "table-button"; edit.textContent = "تعديل";
    edit.addEventListener("click", () => openRoleEditor(role));
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "table-button reject"; remove.textContent = "حذف";
    remove.addEventListener("click", () => deleteRole(role));
    actions.append(edit, remove);
    card.append(copy, actions);
    return card;
  }));
  renderMembers();
}

function renderPermissions() {
  $("permissionsGrid").replaceChildren(...permissionGroups.map(([title, permissions]) => {
    const group = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = title;
    group.appendChild(legend);
    permissions.forEach(([id, label]) => {
      const row = document.createElement("label");
      row.className = "permission-option";
      const input = document.createElement("input");
      input.type = "checkbox"; input.name = "permission"; input.value = id;
      const text = document.createElement("span"); text.textContent = label;
      row.append(input, text); group.appendChild(row);
    });
    return group;
  }));
}

function openRoleEditor(role = null) {
  $("roleForm").hidden = false;
  $("roleId").value = role?.id || "";
  $("roleName").value = role?.name || "";
  $("roleDescription").value = role?.description || "";
  $("roleFormTitle").textContent = role ? "تعديل الدور" : "إضافة دور جديد";
  document.querySelectorAll('#permissionsGrid input[name="permission"]').forEach(input => {
    input.checked = Boolean(role?.permissions?.includes(input.value));
  });
  $("roleForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeRoleEditor() { $("roleForm").hidden = true; $("roleForm").reset(); $("roleId").value = ""; }

async function loadTeam() {
  const [rolesSnapshot, usersSnapshot] = await Promise.all([
    getDocs(collection(db, "adminRoles")), getDocs(collection(db, "users"))
  ]);
  state.roles = rolesSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.active !== false).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
  state.members = usersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.role === "admin");
  renderRoles();
}

async function assignMember(email, roleId) {
  try {
    await httpsCallable(functions, "assignAdminRole")({ email, roleId });
    toast("تم حفظ دور عضو الفريق.");
    await loadTeam();
  } catch (error) { toast(error.message || "تعذر إضافة عضو الفريق."); }
}

async function removeMember(member) {
  if (!confirm(`إزالة ${member.name || member.email} من فريق الإدارة؟ سيعود حسابه إلى نوعه السابق.`)) return;
  try {
    await httpsCallable(functions, "removeAdminMember")({ userId: member.id });
    toast("تمت إزالة الحساب من فريق الإدارة.");
    await loadTeam();
  } catch (error) { toast(error.message || "تعذر إزالة عضو الفريق."); }
}

async function deleteRole(role) {
  if (!confirm(`حذف دور «${role.name}»؟`)) return;
  try {
    await httpsCallable(functions, "deleteAdminRole")({ roleId: role.id });
    toast("تم حذف الدور.");
    await loadTeam();
  } catch (error) { toast(error.message || "تعذر حذف الدور."); }
}

renderPermissions();
$("rolePresets").replaceChildren(...presets.map(preset => {
  const button = document.createElement("button");
  button.type = "button"; button.className = "role-preset";
  button.textContent = preset.name;
  button.addEventListener("click", () => openRoleEditor(preset));
  return button;
}));
$("newRoleButton").addEventListener("click", () => openRoleEditor());
$("cancelRoleButton").addEventListener("click", closeRoleEditor);
$("teamMemberForm").addEventListener("submit", event => {
  event.preventDefault();
  assignMember($("teamMemberEmail").value.trim().toLowerCase(), $("teamMemberRole").value).then(() => event.target.reset());
});
$("roleForm").addEventListener("submit", async event => {
  event.preventDefault();
  const permissions = [...document.querySelectorAll('#permissionsGrid input[name="permission"]:checked')].map(input => input.value);
  try {
    await httpsCallable(functions, "saveAdminRole")({ roleId: $("roleId").value, name: $("roleName").value, description: $("roleDescription").value, permissions });
    toast("تم حفظ الدور والصلاحيات."); closeRoleEditor(); await loadTeam();
  } catch (error) { toast(error.message || "تعذر حفظ الدور."); }
});

onAuthStateChanged(auth, async user => {
  if (!user) return;
  const snapshot = await getDoc(doc(db, "users", user.uid));
  if (!snapshot.exists() || snapshot.data().role !== "admin") return;
  state.admin = { id: user.uid, email: user.email, ...snapshot.data() };
  await initializeAdminAccess(state.admin);
  if (getAdminAccess().isSuperAdmin) loadTeam().catch(error => {
    console.error("Unable to load admin team", error); toast("تعذر تحميل الفريق والأدوار.");
  });
});
