import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";
import {
  approveEscrowOrder, autoReleaseEscrowOrder, disputeEscrowOrder,
  formatMoney, orderStatusLabels
} from "./escrow.js";

const state = {
  user: null, profile: null, orders: [], favorites: [], tickets: [], notifications: [],
  avatarFile: null, avatarRemoved: false, avatarPreviewUrl: ""
};
const sectionTitles = { overview: "نظرة عامة", orders: "طلباتي", favorites: "الخدمات المحفوظة", support: "الدعم والنزاعات", notifications: "الإشعارات", account: "إعدادات الحساب" };
const statusLabels = { pending: "بانتظار التأكيد", active: "قيد التنفيذ", delivered: "بانتظار الاستلام", completed: "مكتمل", cancelled: "ملغي", disputed: "نزاع مفتوح", funded: "المبلغ محجوز لدى المنصة", open: "مفتوحة", in_progress: "قيد المعالجة", waiting_user: "بانتظار ردك", resolved: "محلولة", closed: "مغلقة", ...orderStatusLabels };

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
  $("activeOrdersCount").textContent = state.orders.filter(order => ["pending", "funded", "active", "delivered", "disputed"].includes(order.status)).length;
  $("ordersBadge").textContent = state.orders.length;
  const createRow = order => {
    const row = document.createElement("article");
    row.className = "list-row";
    const releaseAt = toDate(order.autoReleaseAt);
    row.innerHTML = `<span>▣</span><div><strong>${order.serviceTitle || "طلب خدمة"}</strong><small>${statusLabels[order.status] || order.status || "قيد المراجعة"} · ${formatMoney(order.total)} · محجوز لهذا الطلب فقط${releaseAt && order.status === "delivered" ? ` · يتحرر تلقائياً في ${formatDate(releaseAt)}` : ""}</small></div><time>${formatDate(order.createdAt)}</time>`;
    const actions = document.createElement("div");
    actions.className = "order-actions";
    if (order.status === "delivered") {
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "secondary-button";
      approve.textContent = "قبول وتحرير المبلغ";
      approve.addEventListener("click", () => approveOrder(order));
      const dispute = document.createElement("button");
      dispute.type = "button";
      dispute.className = "secondary-button danger-button";
      dispute.textContent = "فتح نزاع";
      dispute.addEventListener("click", () => openOrderDispute(order));
      actions.append(approve, dispute);
    } else if (["funded", "active"].includes(order.status)) {
      const dispute = document.createElement("button");
      dispute.type = "button";
      dispute.className = "secondary-button danger-button";
      dispute.textContent = "فتح نزاع";
      dispute.addEventListener("click", () => openOrderDispute(order));
      actions.append(dispute);
    }
    if (actions.children.length) row.appendChild(actions);
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
  $("sidebarName").textContent = name;
  $("welcomeName").textContent = name.split(/\s+/)[0];
  renderAvatars(state.avatarPreviewUrl || state.profile.avatar || "", name);
  $("accountName").value = state.profile.name || "";
  $("accountEmail").value = state.user.email || "";
  $("accountPhone").value = state.profile.phone || "";
}

function renderAvatars(url, name) {
  const initial = (name || "ع").trim().charAt(0).toUpperCase();
  ["topAvatar", "sidebarAvatar", "accountAvatar"].forEach(id => {
    const target = $(id);
    target.replaceChildren();
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = `صورة ${name}`;
      target.appendChild(image);
    } else {
      target.textContent = initial;
    }
  });
  $("removeAccountAvatar").hidden = !url;
}

function previewAvatar(file) {
  if (state.avatarPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.avatarPreviewUrl);
  state.avatarPreviewUrl = file ? URL.createObjectURL(file) : "";
  renderAvatars(state.avatarPreviewUrl || state.profile.avatar || "", $("accountName").value || state.profile.name);
}

async function saveAvatar() {
  const avatarRef = storageRef(storage, `profile-images/${state.user.uid}/avatar`);
  if (state.avatarRemoved) {
    await deleteObject(avatarRef).catch(error => {
      if (error.code !== "storage/object-not-found") throw error;
    });
    return "";
  }
  if (!state.avatarFile) return state.profile.avatar || "";
  await uploadBytes(avatarRef, state.avatarFile, { contentType: state.avatarFile.type });
  const url = await getDownloadURL(avatarRef);
  return `${url}&v=${Date.now()}`;
}

async function markNotificationRead(id) {
  await updateDoc(doc(db, "notifications", state.user.uid, "items", id), { read: true });
  const item = state.notifications.find(notification => notification.id === id);
  if (item) item.read = true;
  renderNotifications();
}

async function approveOrder(order) {
  if (!confirm("هل تريد قبول التسليم وتحرير مبلغ هذا الطلب للمستقل؟")) return;
  await approveEscrowOrder(db, order);
  state.orders = state.orders.map(item => item.id === order.id ? { ...item, status: "completed", escrow: { ...(item.escrow || {}), status: "released" } } : item);
  renderOrders();
  showToast("تم قبول التسليم وتحرير مبلغ هذا الطلب.");
}

async function openOrderDispute(order) {
  const reason = prompt("اكتب سبب النزاع ليصل إلى فريق الدعم:");
  if (reason === null) return;
  if (!reason.trim()) {
    showToast("يجب كتابة سبب واضح لفتح النزاع.");
    return;
  }
  await disputeEscrowOrder(db, order, state.user, reason);
  await addDoc(collection(db, "supportTickets"), {
    requesterUid: state.user.uid,
    requesterName: state.profile.name || state.user.email || "عميل",
    requesterEmail: state.user.email || "",
    requesterPhone: state.profile.phone || "",
    subject: `نزاع على الطلب ${order.id}`,
    category: "dispute",
    message: reason.trim(),
    orderId: order.id,
    status: "open",
    priority: "high",
    assignedAdminUid: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  state.orders = state.orders.map(item => item.id === order.id ? { ...item, status: "disputed", escrow: { ...(item.escrow || {}), status: "disputed" } } : item);
  renderOrders();
  showToast("تم فتح نزاع وإيقاف مبلغ هذا الطلب فقط حتى قرار الدعم.");
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
  $("accountMessage").textContent = "جاري حفظ التعديلات...";
  try {
    const avatar = await saveAvatar();
    const batch = writeBatch(db);
    batch.update(doc(db, "users", state.user.uid), updates);
    batch.set(doc(db, "publicProfiles", state.user.uid), {
      name: updates.name,
      accountType: "buyer",
      avatar
    }, { merge: true });
    await batch.commit();
    state.profile = { ...state.profile, ...updates, avatar };
    state.avatarFile = null;
    state.avatarRemoved = false;
    if (state.avatarPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.avatarPreviewUrl);
    state.avatarPreviewUrl = "";
    $("accountAvatarInput").value = "";
    renderProfile();
    $("accountMessage").textContent = "تم حفظ التعديلات.";
    showToast("تم تحديث حسابك وصورتك بنجاح.");
  } catch (error) {
    console.error("Account update failed", error);
    $("accountMessage").textContent = error.code === "storage/unauthorized"
      ? "تعذر رفع الصورة بسبب صلاحيات الحساب. حدّث الصفحة وحاول مجدداً."
      : error.code === "permission-denied"
        ? "تعذر حفظ الصورة العامة. تأكد من نشر قواعد Firestore وStorage."
        : "تعذر حفظ التعديلات حالياً. تحقق من الصورة والاتصال.";
  }
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
  const releasable = state.orders.filter(order => order.status === "delivered" && order.escrow?.status === "review_hold" && toDate(order.autoReleaseAt)?.getTime() <= Date.now());
  if (releasable.length) {
    await Promise.all(releasable.map(order => autoReleaseEscrowOrder(db, order).catch(error => {
      console.warn("Auto release skipped", order.id, error);
      return false;
    })));
    releasable.forEach(order => {
      order.status = "completed";
      order.releaseType = "auto_after_review_window";
      order.escrow = { ...(order.escrow || {}), status: "released" };
    });
  }
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
$("accountAvatarInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.match(/^image\/(jpeg|png|webp)$/) || file.size > 5 * 1024 * 1024) {
    event.target.value = "";
    $("accountMessage").textContent = "اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 5MB.";
    return;
  }
  state.avatarFile = file;
  state.avatarRemoved = false;
  previewAvatar(file);
  $("accountMessage").textContent = "اضغط حفظ التعديلات لاعتماد الصورة.";
});
$("removeAccountAvatar").addEventListener("click", () => {
  state.avatarFile = null;
  state.avatarRemoved = true;
  if (state.avatarPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.avatarPreviewUrl);
  state.avatarPreviewUrl = "";
  $("accountAvatarInput").value = "";
  renderAvatars("", $("accountName").value || state.profile.name);
  $("accountMessage").textContent = "اضغط حفظ التعديلات لإزالة الصورة.";
});
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
    const publicSnapshot = await getDoc(doc(db, "publicProfiles", user.uid));
    state.user = user;
    state.profile = { ...profile, avatar: publicSnapshot.exists() ? (publicSnapshot.data().avatar || "") : "" };
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
