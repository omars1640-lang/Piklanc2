import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const state = { user: null, profile: null, orders: [], favorites: [], tickets: [], notifications: [] };
const sectionTitles = { overview: "نظرة عامة", orders: "طلباتي", favorites: "الخدمات المحفوظة", support: "الدعم والنزاعات", notifications: "الإشعارات", account: "إعدادات الحساب" };
const statusLabels = { pending: "بانتظار التأكيد", active: "قيد التنفيذ", delivered: "بانتظار الاستلام", completed: "مكتمل", cancelled: "ملغي", open: "مفتوحة", in_progress: "قيد المعالجة", waiting_user: "بانتظار ردك", resolved: "محلولة", closed: "مغلقة" };

const $ = id => document.getElementById(id);
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const sortNewest = (items, field = "createdAt") => items.sort((a, b) => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0));
const formatDate = value => toDate(value)?.toLocaleDateString("ar-SY", { year: "numeric", month: "short", day: "numeric" }) || "-";

function showToast(message) {
  $("dashboardToast").textContent = message;
  $("dashboardToast").classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $("dashboardToast").classList.remove("show"), 2800);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  $("themeButton").textContent = theme === "dark" ? "☾" : "☀";
}

function showSection(name) {
  document.querySelectorAll(".dashboard-section").forEach(section => section.classList.toggle("active", section.id === `section-${name}`));
  document.querySelectorAll(".nav-link[data-section]").forEach(link => link.classList.toggle("active", link.dataset.section === name));
  $("topbarTitle").textContent = sectionTitles[name];
  history.replaceState({}, "", `#${name}`);
  $("sidebar").classList.remove("open");
  $("sidebarBackdrop").classList.remove("open");
}

function emptyState(icon, title, copy, href = "", label = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  wrapper.innerHTML = `<span>${icon}</span><strong>${title}</strong><p>${copy}</p>${href ? `<a href="${href}">${label}</a>` : ""}`;
  return wrapper;
}

function renderOrders() {
  $("ordersCount").textContent = state.orders.length;
  $("activeOrdersCount").textContent = state.orders.filter(order => ["pending", "active", "delivered"].includes(order.status)).length;
  $("ordersBadge").textContent = state.orders.length;
  const createRow = order => {
    const row = document.createElement("article");
    row.className = "list-row";
    row.innerHTML = `<span>▣</span><div><strong>${order.serviceTitle || "طلب خدمة"}</strong><small>${statusLabels[order.status] || order.status || "قيد المراجعة"} · ${Number(order.total || 0).toLocaleString("ar-SY")} ل.س</small></div><time>${formatDate(order.createdAt)}</time>`;
    return row;
  };
  $("ordersList").replaceChildren(...(state.orders.length ? state.orders.map(createRow) : [emptyState("▣", "لا توجد طلبات حتى الآن", "ستظهر الطلبات الحقيقية هنا بعد إكمال نظام الشراء والدفع.", "services.html", "استكشف الخدمات")]));
  $("overviewOrders").replaceChildren(...state.orders.slice(0, 3).map(createRow));
  $("overviewOrdersEmpty").hidden = state.orders.length > 0;
}

function renderFavorites() {
  $("favoritesCount").textContent = state.favorites.length;
  $("favoritesBadge").textContent = state.favorites.length;
  const cards = state.favorites.map(item => {
    const card = document.createElement("article");
    card.className = "favorite-card";
    card.innerHTML = `<small>${item.category || "خدمة محفوظة"}</small><h3>${item.title || "خدمة"}</h3><p>${Number(item.price || 0).toLocaleString("ar-SY")} ل.س</p><a href="service-details.html?id=${encodeURIComponent(item.serviceId || item.id)}">عرض الخدمة</a>`;
    return card;
  });
  $("favoritesList").replaceChildren(...(cards.length ? cards : [emptyState("♡", "لم تحفظ خدمات بعد", "احفظ الخدمات التي تهمك لتجدها بسرعة هنا.", "services.html", "تصفح الخدمات")]));
}

function renderTickets() {
  $("ticketsBadge").textContent = state.tickets.filter(ticket => !["resolved", "closed"].includes(ticket.status)).length;
  const rows = state.tickets.map(ticket => {
    const row = document.createElement("article");
    row.className = "list-row";
    row.innerHTML = `<span>?</span><div><strong>${ticket.subject || "تذكرة دعم"}</strong><small>${statusLabels[ticket.status] || ticket.status} · ${ticket.category === "dispute" ? "نزاع" : "دعم"}</small></div><time>${formatDate(ticket.updatedAt)}</time>`;
    return row;
  });
  $("ticketsList").replaceChildren(...(rows.length ? rows : [emptyState("?", "لا توجد تذاكر دعم", "يمكنك إنشاء تذكرة تقنية أو فتح نزاع موثّق من مركز الدعم.", "support.html", "فتح مركز الدعم")]));
}

function renderNotifications() {
  const unread = state.notifications.filter(item => !item.read).length;
  $("unreadCount").textContent = unread;
  $("notificationBadge").textContent = unread;
  $("notificationBadge").hidden = unread === 0;
  const rows = state.notifications.map(item => {
    const row = document.createElement("article");
    row.className = `notification-item ${item.read ? "" : "unread"}`;
    row.innerHTML = `<span>♧</span><div><strong>${item.title || "إشعار جديد"}</strong><small>${item.body || ""}</small></div><time>${formatDate(item.createdAt)}</time>`;
    if (!item.read) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "تحديد كمقروء";
      button.addEventListener("click", () => markNotificationRead(item.id));
      row.appendChild(button);
    }
    return row;
  });
  $("notificationsList").replaceChildren(...(rows.length ? rows : [emptyState("♧", "لا توجد إشعارات", "ستصلك هنا تحديثات الحساب والدعم والطلبات.")]));
}

function renderProfile() {
  const name = state.profile.name || state.user.email || "عميل PikLance";
  const avatar = name.trim().charAt(0).toUpperCase();
  $("sidebarName").textContent = name;
  $("welcomeName").textContent = name.split(/\s+/)[0];
  $("topAvatar").textContent = avatar;
  $("sidebarAvatar").textContent = avatar;
  $("accountName").value = state.profile.name || "";
  $("accountEmail").value = state.user.email || "";
  $("accountPhone").value = state.profile.phone || "";
}

async function markNotificationRead(id) {
  await updateDoc(doc(db, "notifications", state.user.uid, "items", id), { read: true });
  const item = state.notifications.find(notification => notification.id === id);
  if (item) item.read = true;
  renderNotifications();
}

async function markAllRead() {
  const unread = state.notifications.filter(item => !item.read);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach(item => batch.update(doc(db, "notifications", state.user.uid, "items", item.id), { read: true }));
  await batch.commit();
  unread.forEach(item => { item.read = true; });
  renderNotifications();
  showToast("تم تحديد جميع الإشعارات كمقروءة.");
}

async function saveAccount(event) {
  event.preventDefault();
  const updates = { name: $("accountName").value.trim(), phone: $("accountPhone").value.trim(), specialty: state.profile.specialty || "" };
  if (!updates.name) return;
  await updateDoc(doc(db, "users", state.user.uid), updates);
  state.profile = { ...state.profile, ...updates };
  renderProfile();
  $("accountMessage").textContent = "تم حفظ التعديلات.";
  showToast("تم تحديث حسابك بنجاح.");
}

async function loadWorkspace() {
  const uid = state.user.uid;
  const [ordersSnapshot, favoritesSnapshot, ticketsSnapshot, notificationsSnapshot] = await Promise.all([
    getDocs(query(collection(db, "orders"), where("buyerUid", "==", uid))),
    getDocs(collection(db, "favorites", uid, "services")),
    getDocs(query(collection(db, "supportTickets"), where("requesterUid", "==", uid))),
    getDocs(collection(db, "notifications", uid, "items"))
  ]);
  state.orders = sortNewest(ordersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  state.favorites = favoritesSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  state.tickets = sortNewest(ticketsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })), "updatedAt");
  state.notifications = sortNewest(notificationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  renderOrders();
  renderFavorites();
  renderTickets();
  renderNotifications();
}

document.querySelectorAll("[data-section], [data-section-target]").forEach(control => control.addEventListener("click", () => showSection(control.dataset.section || control.dataset.sectionTarget)));
$("menuButton").addEventListener("click", () => { $("sidebar").classList.toggle("open"); $("sidebarBackdrop").classList.toggle("open"); });
$("sidebarBackdrop").addEventListener("click", () => { $("sidebar").classList.remove("open"); $("sidebarBackdrop").classList.remove("open"); });
$("themeButton").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("markAllRead").addEventListener("click", markAllRead);
$("accountForm").addEventListener("submit", saveAccount);
$("logoutButton").addEventListener("click", async () => { await signOut(auth); location.replace("index.html"); });
setTheme(localStorage.getItem("theme") || "light");

onAuthStateChanged(auth, async user => {
  if (!user) return location.replace("login.html");
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    const profile = snapshot.exists() ? snapshot.data() : null;
    if (!user.emailVerified || !profile || profile.status !== "active" || profile.accountType !== "buyer") {
      await signOut(auth);
      return location.replace("login.html");
    }
    state.user = user;
    state.profile = profile;
    renderProfile();
    await loadWorkspace();
    showSection(sectionTitles[location.hash.slice(1)] ? location.hash.slice(1) : "overview");
    $("dashboardLoading").classList.add("hidden");
  } catch (error) {
    console.error("Client dashboard initialization failed", error);
    showToast("تعذر تحميل بعض بيانات لوحة العميل.");
    $("dashboardLoading").classList.add("hidden");
  }
});
