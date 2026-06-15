import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query,
  serverTimestamp, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";

const specialtyLabels = { design: "تصميم", web: "برمجة وتطوير", writing: "كتابة وترجمة", marketing: "تسويق رقمي" };
const serviceStatus = {
  draft: ["مسودة", "warning"], pending: ["قيد المراجعة", "neutral"],
  published: ["منشورة", "success"], paused: ["متوقفة", "neutral"], rejected: ["مرفوضة", "danger"]
};
const orderStatus = { pending: "بانتظار التأكيد", active: "قيد التنفيذ", delivered: "بانتظار الاستلام", completed: "مكتمل", cancelled: "ملغي" };
const state = {
  user: null, profile: null, services: [], orders: [], notifications: [],
  avatarFile: null, avatarRemoved: false, avatarPreviewUrl: ""
};
const $ = id => document.getElementById(id);
const elements = {
  loadingScreen: $("loadingScreen"), sidebar: $("sidebar"), sidebarOverlay: $("sidebarOverlay"),
  mobileMenuButton: $("mobileMenuButton"), serviceModal: $("serviceModal"), serviceForm: $("serviceForm"),
  servicesTable: $("servicesTable"), servicesEmpty: $("servicesEmpty"), overviewServices: $("overviewServices"),
  overviewServicesEmpty: $("overviewServicesEmpty"), serviceSearch: $("serviceSearch"),
  profileForm: $("profileForm"), profileMessage: $("profileMessage"), toast: $("toast")
};
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const formatDate = value => toDate(value)?.toLocaleDateString("ar-SY", { year: "numeric", month: "short", day: "numeric" }) || "-";
const formatMoney = value => Number(value || 0).toLocaleString("ar-SY");
const sortNewest = (items, field = "updatedAt") => items.sort((a, b) => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0));

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3000);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  $("themeButton").textContent = theme === "dark" ? "☾" : "☀";
  $("darkModeSwitch").checked = theme === "dark";
}

function openSidebar() { elements.sidebar.classList.add("open"); elements.sidebarOverlay.classList.add("open"); elements.mobileMenuButton.setAttribute("aria-expanded", "true"); }
function closeSidebar() { elements.sidebar.classList.remove("open"); elements.sidebarOverlay.classList.remove("open"); elements.mobileMenuButton.setAttribute("aria-expanded", "false"); }
function showSection(name) {
  document.querySelectorAll(".dashboard-section").forEach(section => section.classList.toggle("active", section.id === `section-${name}`));
  document.querySelectorAll(".side-link[data-section]").forEach(link => link.classList.toggle("active", link.dataset.section === name));
  history.replaceState({}, "", `#${name}`);
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function openServiceModal() { elements.serviceModal.classList.add("open"); elements.serviceModal.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; setTimeout(() => $("serviceTitle").focus(), 50); }
function closeServiceModal() { elements.serviceModal.classList.remove("open"); elements.serviceModal.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; elements.serviceForm.reset(); }

function statusPill(statusValue) {
  const [label, className] = serviceStatus[statusValue] || [statusValue || "مسودة", "neutral"];
  const status = document.createElement("span");
  status.className = `status-pill ${className}`;
  status.textContent = label;
  return status;
}

function serviceRow(service) {
  const row = document.createElement("tr");
  const info = document.createElement("div");
  info.className = "table-service";
  info.innerHTML = `<strong>${service.title || "خدمة بدون عنوان"}</strong><small>${service.category || "غير مصنفة"}</small>`;
  const actions = document.createElement("div");
  actions.className = "table-actions";
  if (["draft", "rejected"].includes(service.status)) {
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "table-button primary";
    submit.textContent = "إرسال للمراجعة";
    submit.addEventListener("click", () => submitService(service.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "table-button danger";
    remove.textContent = "حذف";
    remove.addEventListener("click", () => deleteService(service.id));
    actions.append(submit, remove);
  }
  [info, `${formatMoney(service.price)} ل.س`, `${service.deliveryDays || 2} أيام`, statusPill(service.status), actions].forEach(value => {
    const cell = document.createElement("td");
    cell.append(value instanceof Node ? value : document.createTextNode(value));
    row.appendChild(cell);
  });
  return row;
}

function overviewServiceCard(service) {
  const row = document.createElement("div");
  row.className = "project-row";
  row.innerHTML = `<div class="project-title"><span class="project-thumb">${(service.category || "خ").charAt(0)}</span><div><strong>${service.title || "خدمة بدون عنوان"}</strong><small>${service.category || "غير مصنفة"} · ${formatMoney(service.price)} ل.س</small></div></div><div class="project-meta"><strong>${service.deliveryDays || 2} أيام</strong><small>مدة التسليم</small></div>`;
  row.appendChild(statusPill(service.status));
  return row;
}

function renderServices() {
  const term = (elements.serviceSearch.value || "").trim().toLowerCase();
  const filter = $("serviceFilter").value;
  const filtered = state.services.filter(service => {
    const matches = !term || `${service.title || ""} ${service.category || ""} ${service.description || ""}`.toLowerCase().includes(term);
    return matches && (filter === "all" || service.status === filter);
  });
  elements.servicesTable.replaceChildren(...filtered.map(serviceRow));
  elements.servicesEmpty.hidden = filtered.length > 0;
  const recent = state.services.slice(0, 3);
  elements.overviewServices.replaceChildren(...recent.map(overviewServiceCard));
  elements.overviewServicesEmpty.hidden = recent.length > 0;
  $("servicesCount").textContent = state.services.filter(service => service.status === "published").length;
  $("draftServicesCount").textContent = state.services.filter(service => service.status === "draft").length;
  $("servicesNavCount").textContent = state.services.length;
}

function renderOrders() {
  $("ordersNavCount").textContent = state.orders.filter(order => !["completed", "cancelled"].includes(order.status)).length;
  $("completedProjects").textContent = state.orders.filter(order => order.status === "completed").length;
  const rows = state.orders.map(order => {
    const row = document.createElement("tr");
    [order.serviceTitle || "طلب خدمة", order.buyerName || "عميل", `${formatMoney(order.total)} ل.س`, orderStatus[order.status] || order.status, formatDate(order.createdAt)].forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    return row;
  });
  $("ordersTable").replaceChildren(...rows);
  $("ordersEmpty").hidden = rows.length > 0;
  const revenue = state.orders.filter(order => order.status === "completed").reduce((sum, order) => sum + Number(order.freelancerAmount || order.total || 0), 0);
  $("availableBalance").textContent = formatMoney(revenue);
}

function renderNotifications() {
  const unread = state.notifications.filter(item => !item.read).length;
  $("notificationsNavCount").textContent = unread;
  const rows = state.notifications.map(item => {
    const row = document.createElement("article");
    row.className = `notification-item ${item.read ? "" : "unread"}`;
    row.innerHTML = `<span>♧</span><div><strong>${item.title || "إشعار جديد"}</strong><small>${item.body || ""}</small></div><time>${formatDate(item.createdAt)}</time>`;
    if (!item.read) {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = "مقروء";
      control.addEventListener("click", () => markNotificationRead(item.id));
      row.appendChild(control);
    }
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<span>♧</span><strong>لا توجد إشعارات</strong><p>ستظهر هنا قرارات مراجعة الخدمات وتحديثات الدعم.</p>";
    rows.push(empty);
  }
  $("notificationsList").replaceChildren(...rows);
}

async function markNotificationRead(id) {
  await updateDoc(doc(db, "notifications", state.user.uid, "items", id), { read: true });
  const item = state.notifications.find(entry => entry.id === id);
  if (item) item.read = true;
  renderNotifications();
}

async function markAllNotificationsRead() {
  const unread = state.notifications.filter(item => !item.read);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach(item => batch.update(doc(db, "notifications", state.user.uid, "items", item.id), { read: true }));
  await batch.commit();
  unread.forEach(item => { item.read = true; });
  renderNotifications();
  showToast("تم تحديد جميع الإشعارات كمقروءة.");
}

async function deleteService(id) {
  if (!confirm("هل تريد حذف هذه المسودة نهائياً؟")) return;
  await deleteDoc(doc(db, "services", id));
  state.services = state.services.filter(service => service.id !== id);
  renderServices();
  showToast("تم حذف الخدمة.");
}

async function submitService(id) {
  if (!confirm("إرسال الخدمة إلى الإدارة للمراجعة؟")) return;
  await updateDoc(doc(db, "services", id), { status: "pending", updatedAt: serverTimestamp() });
  const service = state.services.find(item => item.id === id);
  if (service) service.status = "pending";
  renderServices();
  showToast("تم إرسال الخدمة للمراجعة.");
}

async function handleServiceSubmit(event) {
  event.preventDefault();
  const submit = elements.serviceForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await addDoc(collection(db, "services"), {
      ownerUid: state.user.uid, ownerName: state.profile.name || state.user.email || "مستقل",
      title: $("serviceTitle").value.trim(), category: $("serviceCategory").value,
      price: Number($("servicePrice").value), description: $("serviceDescription").value.trim(),
      deliveryDays: Number($("serviceDelivery").value), revisions: Number($("serviceRevisions").value),
      keywords: $("serviceKeywords").value.split(",").map(value => value.trim()).filter(Boolean),
      status: "draft", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    closeServiceModal();
    await loadWorkspace();
    showToast("تم حفظ الخدمة كمسودة في حسابك.");
  } catch (error) {
    console.error("Service creation failed", error);
    showToast("تعذر حفظ الخدمة. تحقق من الاتصال والصلاحيات.");
  } finally {
    submit.disabled = false;
  }
}

async function migrateLocalServices() {
  let localServices = [];
  try { localServices = JSON.parse(localStorage.getItem("myServices") || "[]"); } catch { localServices = []; }
  if (!Array.isArray(localServices) || !localServices.length) return;
  await Promise.all(localServices.map(service => addDoc(collection(db, "services"), {
    ownerUid: state.user.uid, ownerName: state.profile.name || state.user.email || "مستقل",
    title: service.title || "خدمة بدون عنوان", category: service.category || "أخرى",
    price: Number(service.price || 0), description: service.description || "",
    deliveryDays: Number(service.delivery || 2), revisions: Number(service.revisions || 1),
    keywords: String(service.keywords || "").split(",").map(value => value.trim()).filter(Boolean),
    status: "draft", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  })));
  localStorage.removeItem("myServices");
  showToast("تم نقل مسودات الخدمات القديمة إلى حسابك.");
}

function fillProfile(user, profile) {
  const name = profile.name || user.email || "مستقل PikLance";
  ["topName", "sidebarName", "profileCardName"].forEach(id => { $(id).textContent = name; });
  renderAvatars(state.avatarPreviewUrl || profile.avatar || "", name);
  $("welcomeName").textContent = name.split(/\s+/)[0];
  $("profileName").value = profile.name || "";
  $("profileEmail").value = user.email || "";
  $("profilePhone").value = profile.phone || "";
  $("profileSpecialty").value = profile.specialty || "";
  $("profileCardSpecialty").textContent = specialtyLabels[profile.specialty] || "مستقل محترف";
  const progress = Math.max(35, Math.round(([profile.name, profile.phone, profile.specialty, user.email].filter(Boolean).length / 4) * 100));
  $("profileProgressValue").textContent = `${progress}%`;
  $("profileProgressBar").style.width = `${progress}%`;
}

function renderAvatars(url, name) {
  const initial = (name || "م").trim().charAt(0).toUpperCase();
  ["topAvatar", "sidebarAvatar", "profileAvatar"].forEach(id => {
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
  $("removeProfileAvatar").hidden = !url;
}

function previewAvatar(file) {
  if (state.avatarPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.avatarPreviewUrl);
  state.avatarPreviewUrl = file ? URL.createObjectURL(file) : "";
  renderAvatars(state.avatarPreviewUrl || state.profile.avatar || "", $("profileName").value || state.profile.name);
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

async function saveProfile(event) {
  event.preventDefault();
  const updates = { name: $("profileName").value.trim(), phone: $("profilePhone").value.trim(), specialty: $("profileSpecialty").value };
  if (!updates.name) return;
  const submit = $("saveProfileButton");
  submit.disabled = true;
  elements.profileMessage.textContent = "جاري حفظ التعديلات...";
  try {
    const avatar = await saveAvatar();
    const batch = writeBatch(db);
    batch.update(doc(db, "users", state.user.uid), updates);
    batch.set(doc(db, "publicProfiles", state.user.uid), {
      name: updates.name,
      accountType: "freelancer",
      avatar
    }, { merge: true });
    await batch.commit();
    state.profile = { ...state.profile, ...updates, avatar };
    state.avatarFile = null;
    state.avatarRemoved = false;
    if (state.avatarPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.avatarPreviewUrl);
    state.avatarPreviewUrl = "";
    $("profileAvatarInput").value = "";
    fillProfile(state.user, state.profile);
    elements.profileMessage.textContent = "تم حفظ التعديلات بنجاح.";
    showToast("تم تحديث ملفك الشخصي وصورتك.");
  } catch (error) {
    console.error("Profile update failed", error);
    const message = error.code === "storage/unauthorized"
      ? "تعذر رفع الصورة بسبب صلاحيات الحساب. حدّث الصفحة وحاول مجدداً."
      : error.code === "storage/invalid-format" || error.code === "storage/invalid-argument"
        ? "صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP."
        : error.code === "permission-denied"
          ? "تعذر تحديث الملف العام. تم إصلاح دعم الحسابات القديمة، حدّث الصفحة وحاول مجدداً."
          : "تعذر الحفظ حالياً. تحقق من الاتصال وحاول مجدداً.";
    elements.profileMessage.textContent = message;
    showToast(message);
  } finally {
    submit.disabled = false;
  }
}

async function loadWorkspace() {
  const uid = state.user.uid;
  const [servicesSnapshot, ordersSnapshot, notificationsSnapshot] = await Promise.all([
    getDocs(query(collection(db, "services"), where("ownerUid", "==", uid))),
    getDocs(query(collection(db, "orders"), where("freelancerUid", "==", uid))),
    getDocs(collection(db, "notifications", uid, "items"))
  ]);
  state.services = sortNewest(servicesSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  state.orders = sortNewest(ordersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })), "createdAt");
  state.notifications = sortNewest(notificationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })), "createdAt");
  renderServices();
  renderOrders();
  renderNotifications();
}

function bindEvents() {
  document.querySelectorAll(".side-link[data-section]").forEach(link => link.addEventListener("click", () => showSection(link.dataset.section)));
  document.querySelectorAll("[data-section-target]").forEach(control => control.addEventListener("click", () => showSection(control.dataset.sectionTarget)));
  document.querySelectorAll("[data-open-service-modal]").forEach(control => control.addEventListener("click", openServiceModal));
  document.querySelectorAll("[data-close-modal]").forEach(control => control.addEventListener("click", closeServiceModal));
  elements.mobileMenuButton.addEventListener("click", () => elements.sidebar.classList.contains("open") ? closeSidebar() : openSidebar());
  elements.sidebarOverlay.addEventListener("click", closeSidebar);
  elements.serviceForm.addEventListener("submit", handleServiceSubmit);
  elements.profileForm.addEventListener("submit", saveProfile);
  $("profileAvatarInput").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.target.value = "";
      showToast("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 5MB.");
      return;
    }
    state.avatarFile = file;
    state.avatarRemoved = false;
    previewAvatar(file);
    elements.profileMessage.textContent = "اضغط حفظ التعديلات لاعتماد الصورة.";
  });
  $("removeProfileAvatar").addEventListener("click", () => {
    state.avatarFile = null;
    state.avatarRemoved = true;
    if (state.avatarPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.avatarPreviewUrl);
    state.avatarPreviewUrl = "";
    $("profileAvatarInput").value = "";
    renderAvatars("", $("profileName").value || state.profile.name);
    elements.profileMessage.textContent = "اضغط حفظ التعديلات لإزالة الصورة.";
  });
  elements.serviceSearch.addEventListener("input", renderServices);
  $("serviceFilter").addEventListener("change", renderServices);
  $("markAllNotificationsRead").addEventListener("click", markAllNotificationsRead);
  $("themeButton").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("darkModeSwitch").addEventListener("change", event => setTheme(event.target.checked ? "dark" : "light"));
  $("withdrawButton").addEventListener("click", () => showToast("السحب غير مفعّل قبل ربط بوابة الدفع."));
  $("logoutButton").addEventListener("click", async () => { await signOut(auth); location.href = "index.html"; });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { closeServiceModal(); closeSidebar(); } });
}

setTheme(localStorage.getItem("theme") || "light");
bindEvents();
onAuthStateChanged(auth, async user => {
  if (!user) return location.replace("login.html");
  try {
    const [snapshot, publicSnapshot] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "publicProfiles", user.uid))
    ]);
    const profile = snapshot.exists() ? snapshot.data() : null;
    if (!user.emailVerified || !profile || profile.status !== "active" || profile.accountType !== "freelancer") {
      await signOut(auth);
      return location.replace("login.html");
    }
    state.user = user;
    state.profile = { ...profile, avatar: publicSnapshot.exists() ? (publicSnapshot.data().avatar || "") : "" };
    fillProfile(user, state.profile);
    $("publicProfileLink").href = `freelancer-profile.html?uid=${encodeURIComponent(user.uid)}`;
    await migrateLocalServices();
    await loadWorkspace();
    showSection(location.hash.slice(1) || "overview");
    elements.loadingScreen.classList.add("hidden");
  } catch (error) {
    console.error("Dashboard initialization failed", error);
    showToast("تعذر تحميل لوحة المستقل.");
    elements.loadingScreen.classList.add("hidden");
  }
});
