import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";
import { cacheBustUrl } from "./avatar-utils.js";
import {
  approveEscrowOrder, disputeEscrowOrder,
  formatMoney, orderStatusLabels
} from "./escrow.js";
import { initializeBuyerWallet } from "./wallet-client.js";
import {
  canReviewOrder, createOrderReview, formatStars, hasReviewedOrder
} from "./reviews.js";

const state = {
  user: null, profile: null, orders: [], favorites: [], tickets: [], notifications: [], reviews: [], receivedReviews: [],
  pendingOrderAction: null, pendingReviewOrder: null,
  avatarFile: null, avatarRemoved: false, avatarPreviewUrl: ""
};
const sectionTitles = { overview: "نظرة عامة", wallet: "المحفظة", orders: "طلباتي", favorites: "الخدمات المحفوظة", support: "الدعم والنزاعات", notifications: "الإشعارات", account: "إعدادات الحساب" };
const statusLabels = { pending: "بانتظار التأكيد", active: "قيد التنفيذ", delivered: "بانتظار الاستلام", completed: "مكتمل", cancelled: "ملغي", disputed: "نزاع مفتوح", funded: "تم الدفع وجاهز للتنفيذ", open: "مفتوحة", in_progress: "قيد المعالجة", waiting_user: "بانتظار ردك", resolved: "محلولة", closed: "مغلقة", ...orderStatusLabels };

const $ = id => document.getElementById(id);
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const sortNewest = (items, field = "createdAt") => items.sort((a, b) => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0));
const formatDate = value => toDate(value)?.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) || "-";

function appendSummary(row, iconText, titleText, detailText, dateText) {
  const icon = document.createElement("span");
  icon.textContent = iconText;
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = titleText;
  const detail = document.createElement("small");
  detail.textContent = detailText;
  copy.append(title, detail);
  const time = document.createElement("time");
  time.textContent = dateText;
  row.append(icon, copy, time);
}

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
    appendSummary(
      row,
      "▣",
      order.serviceTitle || "طلب خدمة",
      `${statusLabels[order.status] || order.status || "قيد المراجعة"} · ${formatMoney(order.total)} · مدفوع من المحفظة${releaseAt && order.status === "delivered" ? ` · موعد الإغلاق ${formatDate(releaseAt)}` : ""}`,
      formatDate(order.createdAt)
    );
    const actions = document.createElement("div");
    actions.className = "order-actions";
    const messages = document.createElement("a");
    messages.className = "secondary-button";
    messages.textContent = "المحادثة";
    messages.href = `messages.html?${new URLSearchParams({
      withUid: order.freelancerUid || "", serviceId: order.serviceId || order.id,
      serviceTitle: order.serviceTitle || "طلب خدمة", serviceImage: order.serviceImage || "",
      servicePrice: String(order.total || 0), sellerUid: order.freelancerUid || ""
    })}`;
    actions.appendChild(messages);
    if (order.status === "delivered") {
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "secondary-button";
      approve.textContent = "قبول وتحرير المبلغ";
      approve.addEventListener("click", () => openApproveModal(order));
      const dispute = document.createElement("button");
      dispute.type = "button";
      dispute.className = "secondary-button danger-button";
      dispute.textContent = "فتح نزاع";
      dispute.addEventListener("click", () => openDisputeModal(order));
      actions.append(approve, dispute);
    } else if (["funded", "active"].includes(order.status)) {
      const dispute = document.createElement("button");
      dispute.type = "button";
      dispute.className = "secondary-button danger-button";
      dispute.textContent = "فتح نزاع";
      dispute.addEventListener("click", () => openDisputeModal(order));
      actions.append(dispute);
    } else if (order.status === "completed") {
      if (canReviewOrder(order, state.user?.uid, state.reviews)) {
        const review = document.createElement("button");
        review.type = "button";
        review.className = "secondary-button";
        review.textContent = "تقييم المستقل";
        review.addEventListener("click", () => openReviewModal(order));
        actions.append(review);
      } else if (hasReviewedOrder(state.reviews, order.id, state.user?.uid)) {
        const reviewed = document.createElement("span");
        reviewed.className = "review-status-pill";
        reviewed.textContent = "تم التقييم";
        actions.append(reviewed);
      }
    }
    row.appendChild(actions);
    return row;
  };
  $("ordersList").replaceChildren(...(state.orders.length ? state.orders.map(createRow) : [emptyState("▣", "لا توجد طلبات حتى الآن", "اشحن محفظتك واختر الخدمة المناسبة لبدء أول طلب.", "services.html", "استكشف الخدمات")]));
  $("overviewOrders").replaceChildren(...state.orders.slice(0, 3).map(createRow));
  $("overviewOrdersEmpty").hidden = state.orders.length > 0;
}

function renderFavorites() {
  $("favoritesCount").textContent = state.favorites.length;
  $("favoritesBadge").textContent = state.favorites.length;
  const cards = state.favorites.map(item => {
    const card = document.createElement("article");
    card.className = "favorite-card";
    const category = document.createElement("small");
    category.textContent = item.category || "خدمة محفوظة";
    const title = document.createElement("h3");
    title.textContent = item.title || "خدمة";
    const price = document.createElement("p");
    price.textContent = `${Number(item.price || 0).toLocaleString("en-US")} ل.س`;
    const link = document.createElement("a");
    link.href = `service-details.html?id=${encodeURIComponent(item.serviceId || item.id)}`;
    link.textContent = "عرض الخدمة";
    card.append(category, title, price, link);
    return card;
  });
  $("favoritesList").replaceChildren(...(cards.length ? cards : [emptyState("♡", "لم تحفظ خدمات بعد", "احفظ الخدمات التي تهمك لتجدها بسرعة هنا.", "services.html", "تصفح الخدمات")]));
}

function renderTickets() {
  $("ticketsBadge").textContent = state.tickets.filter(ticket => !["resolved", "closed"].includes(ticket.status)).length;
  const rows = state.tickets.map(ticket => {
    const row = document.createElement("article");
    row.className = "list-row";
    appendSummary(row, "?", ticket.subject || "تذكرة دعم", `${statusLabels[ticket.status] || ticket.status} · ${ticket.category === "dispute" ? "نزاع" : "دعم"}`, formatDate(ticket.updatedAt));
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
    appendSummary(row, "♧", item.title || "إشعار جديد", item.body || "", formatDate(item.createdAt));
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
  const referralCode = state.profile.referralCode || "";
  const referralCard = $("clientReferralCard");
  if (referralCard) referralCard.hidden = !referralCode;
  const referralValue = $("clientReferralCode");
  if (referralValue) referralValue.textContent = referralCode || "-";
  renderBuyerRating();
}

function renderBuyerRating() {
  const count = state.receivedReviews.length;
  const average = count ? state.receivedReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / count : 0;
  if ($("buyerRatingAverage")) $("buyerRatingAverage").textContent = average.toFixed(1);
  if ($("buyerRatingStars")) $("buyerRatingStars").textContent = formatStars(average);
  if ($("buyerRatingCount")) $("buyerRatingCount").textContent = count;
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
      image.addEventListener("error", () => { target.replaceChildren(document.createTextNode(initial)); });
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
    return { url: "", path: "" };
  }
  if (!state.avatarFile) {
    const url = state.profile.avatar || "";
    return { url, path: url || state.profile.avatarPath ? `profile-images/${state.user.uid}/avatar` : "" };
  }
  await uploadBytes(avatarRef, state.avatarFile, { contentType: state.avatarFile.type });
  const url = await getDownloadURL(avatarRef);
  return { url: cacheBustUrl(url), path: `profile-images/${state.user.uid}/avatar` };
}

async function refreshStoredAvatar() {
  if (!state.user) return;
  try {
    const url = await getDownloadURL(storageRef(storage, `profile-images/${state.user.uid}/avatar`));
    state.profile.avatar = cacheBustUrl(url);
    state.profile.avatarPath = `profile-images/${state.user.uid}/avatar`;
  } catch (error) {
    if (!state.profile.avatar) return;
  }
}

async function markNotificationRead(id) {
  await updateDoc(doc(db, "notifications", state.user.uid, "items", id), { read: true });
  const item = state.notifications.find(notification => notification.id === id);
  if (item) item.read = true;
  renderNotifications();
}

function openApproveModal(order) {
  state.pendingOrderAction = order;
  $("orderApproveSummary").textContent = `سيتم إنهاء طلب "${order.serviceTitle || order.id}" وتحرير مبلغ ${formatMoney(order.total)} للمستقل.`;
  $("orderApproveModal").classList.add("open");
  $("orderApproveModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeApproveModal() {
  state.pendingOrderAction = null;
  $("orderApproveModal").classList.remove("open");
  $("orderApproveModal").setAttribute("aria-hidden", "true");
  if (!$("orderDisputeModal").classList.contains("open")) document.body.style.overflow = "";
}

function openDisputeModal(order) {
  state.pendingOrderAction = order;
  $("orderDisputeSummary").textContent = `سيتم إيقاف مبلغ طلب "${order.serviceTitle || order.id}" فقط حتى يراجعه فريق الدعم.`;
  $("orderDisputeReason").value = "";
  $("orderDisputeModal").classList.add("open");
  $("orderDisputeModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("orderDisputeReason").focus(), 50);
}

function closeDisputeModal() {
  state.pendingOrderAction = null;
  $("orderDisputeForm").reset();
  $("orderDisputeModal").classList.remove("open");
  $("orderDisputeModal").setAttribute("aria-hidden", "true");
  if (!$("orderApproveModal").classList.contains("open")) document.body.style.overflow = "";
}

function openReviewModal(order) {
  state.pendingReviewOrder = order;
  $("orderReviewSummary").textContent = `قيّم تجربتك مع المستقل في طلب "${order.serviceTitle || order.id}". يظهر التقييم على ملفه بعد الإرسال.`;
  $("orderReviewRating").value = "5";
  $("orderReviewStars").textContent = formatStars(5);
  $("orderReviewComment").value = "";
  $("orderReviewModal").classList.add("open");
  $("orderReviewModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeReviewModal() {
  state.pendingReviewOrder = null;
  $("orderReviewForm").reset();
  $("orderReviewModal").classList.remove("open");
  $("orderReviewModal").setAttribute("aria-hidden", "true");
  if (!$("orderApproveModal").classList.contains("open") && !$("orderDisputeModal").classList.contains("open")) document.body.style.overflow = "";
}

async function approveOrder(order) {
  await approveEscrowOrder(db, order);
  state.orders = state.orders.map(item => item.id === order.id ? { ...item, status: "completed", escrow: { ...(item.escrow || {}), status: "released" } } : item);
  renderOrders();
  showToast("تم قبول التسليم وتحرير مبلغ هذا الطلب.");
}

async function openOrderDispute(order, reason) {
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

async function handleApproveSubmit(event) {
  event.preventDefault();
  const order = state.pendingOrderAction;
  if (!order) return;
  const button = $("orderApproveSubmit");
  button.disabled = true;
  button.textContent = "جاري القبول...";
  try {
    await approveOrder(order);
    closeApproveModal();
  } catch (error) {
    console.error("Order approval failed", error);
    showToast("تعذر قبول التسليم حالياً. تحقق من الاتصال وحاول مجدداً.");
  } finally {
    button.disabled = false;
    button.textContent = "قبول التسليم";
  }
}

async function handleDisputeSubmit(event) {
  event.preventDefault();
  const order = state.pendingOrderAction;
  if (!order) return;
  const reason = $("orderDisputeReason").value.trim();
  if (!reason) {
    showToast("اكتب سبب النزاع قبل الإرسال.");
    $("orderDisputeReason").focus();
    return;
  }
  const button = $("orderDisputeSubmit");
  button.disabled = true;
  button.textContent = "جاري فتح النزاع...";
  try {
    await openOrderDispute(order, reason);
    closeDisputeModal();
  } catch (error) {
    console.error("Order dispute failed", error);
    showToast("تعذر فتح النزاع حالياً. تحقق من الاتصال وحاول مجدداً.");
  } finally {
    button.disabled = false;
    button.textContent = "فتح النزاع";
  }
}

async function handleReviewSubmit(event) {
  event.preventDefault();
  const order = state.pendingReviewOrder;
  if (!order) return;
  const button = $("orderReviewSubmit");
  button.disabled = true;
  button.textContent = "جاري نشر التقييم...";
  try {
    const review = await createOrderReview(db, order, state.user, state.profile, {
      rating: Number($("orderReviewRating").value),
      comment: $("orderReviewComment").value
    });
    state.reviews.unshift(review);
    renderOrders();
    closeReviewModal();
    showToast("تم نشر تقييمك بنجاح.");
  } catch (error) {
    console.error("Order review failed", error);
    showToast(error.code === "permission-denied" ? "تعذر نشر التقييم. تأكد أن الطلب مكتمل." : "تعذر نشر التقييم حالياً. حاول مجدداً.");
  } finally {
    button.disabled = false;
    button.textContent = "نشر التقييم";
  }
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
      status: state.profile.status || "active",
      avatar: avatar.url,
      avatarPath: avatar.path
    }, { merge: true });
    await batch.commit();
    state.profile = { ...state.profile, ...updates, avatar: avatar.url, avatarPath: avatar.path };
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
  const [ordersSnapshot, favoritesSnapshot, ticketsSnapshot, notificationsSnapshot, reviewsSnapshot, receivedReviewsSnapshot] = await Promise.all([
    getDocs(query(collection(db, "orders"), where("buyerUid", "==", uid))),
    getDocs(collection(db, "favorites", uid, "services")),
    getDocs(query(collection(db, "supportTickets"), where("requesterUid", "==", uid))),
    getDocs(collection(db, "notifications", uid, "items")),
    getDocs(query(collection(db, "reviews"), where("reviewerUid", "==", uid))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, "reviews"), where("targetUid", "==", uid))).catch(() => ({ docs: [] }))
  ]);
  state.orders = sortNewest(ordersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  state.favorites = favoritesSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  state.tickets = sortNewest(ticketsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })), "updatedAt");
  state.notifications = sortNewest(notificationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  state.reviews = sortNewest(reviewsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  state.receivedReviews = sortNewest(receivedReviewsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.targetType === "buyer"));
  renderOrders();
  renderFavorites();
  renderTickets();
  renderNotifications();
  renderBuyerRating();
}

document.querySelectorAll("[data-section], [data-section-target]").forEach(control => control.addEventListener("click", () => showSection(control.dataset.section || control.dataset.sectionTarget)));
$("menuButton").addEventListener("click", () => { $("sidebar").classList.toggle("open"); $("sidebarBackdrop").classList.toggle("open"); });
$("sidebarBackdrop").addEventListener("click", () => { $("sidebar").classList.remove("open"); $("sidebarBackdrop").classList.remove("open"); });
$("themeButton").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("markAllRead").addEventListener("click", markAllRead);
$("accountForm").addEventListener("submit", saveAccount);
$("copyClientReferralCode").addEventListener("click", async () => {
  const code = $("clientReferralCode").textContent.trim();
  if (!code || code === "-") return;
  await navigator.clipboard?.writeText(code).catch(() => {});
  showToast("تم نسخ كود الدعوة.");
});
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
$("orderApproveForm").addEventListener("submit", handleApproveSubmit);
$("orderDisputeForm").addEventListener("submit", handleDisputeSubmit);
$("orderReviewForm").addEventListener("submit", handleReviewSubmit);
$("orderReviewRating").addEventListener("change", event => { $("orderReviewStars").textContent = formatStars(event.target.value); });
document.querySelectorAll("[data-close-order-approve]").forEach(control => control.addEventListener("click", closeApproveModal));
document.querySelectorAll("[data-close-order-dispute]").forEach(control => control.addEventListener("click", closeDisputeModal));
document.querySelectorAll("[data-close-order-review]").forEach(control => control.addEventListener("click", closeReviewModal));
$("orderApproveModal").addEventListener("click", event => { if (event.target === $("orderApproveModal")) closeApproveModal(); });
$("orderDisputeModal").addEventListener("click", event => { if (event.target === $("orderDisputeModal")) closeDisputeModal(); });
$("orderReviewModal").addEventListener("click", event => { if (event.target === $("orderReviewModal")) closeReviewModal(); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeApproveModal();
    closeDisputeModal();
    closeReviewModal();
  }
});
$("logoutButton").addEventListener("click", async () => { await signOut(auth); location.replace("index.html"); });
setTheme(localStorage.getItem("theme") || "light");

window.addEventListener("focus", () => {
  if (state.user) loadWorkspace().catch(error => console.warn("Unable to refresh client dashboard", error));
});

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
    state.profile = { ...profile, ...(publicSnapshot.exists() ? publicSnapshot.data() : {}) };
    if (profile.earlyAccess) localStorage.setItem("piklanceEarlyAccess", "true");
    await refreshStoredAvatar();
    renderProfile();
    await loadWorkspace();
    await initializeBuyerWallet(user, showToast);
    showSection(sectionTitles[location.hash.slice(1)] ? location.hash.slice(1) : "overview");
    $("dashboardLoading").classList.add("hidden");
  } catch (error) {
    console.error("Client dashboard initialization failed", error);
    showToast("تعذر تحميل بعض بيانات لوحة العميل.");
    $("dashboardLoading").classList.add("hidden");
  }
});
