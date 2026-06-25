import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";
import { cacheBustUrl } from "./avatar-utils.js";
import {
  deliverEscrowOrder, orderStatusLabels
} from "./escrow.js";

const specialtyLabels = { design: "تصميم", web: "برمجة وتطوير", writing: "كتابة وترجمة", marketing: "تسويق رقمي" };
const serviceStatus = {
  draft: ["مسودة", "warning"], pending: ["قيد المراجعة", "neutral"],
  published: ["منشورة", "success"], paused: ["متوقفة", "neutral"], rejected: ["مرفوضة", "danger"]
};
const orderStatus = { pending: "بانتظار التأكيد", funded: "طلب تجريبي جاهز", active: "قيد التنفيذ", delivered: "بانتظار مراجعة العميل", completed: "مكتمل", disputed: "نزاع مفتوح", cancelled: "ملغي", ...orderStatusLabels };
const PORTFOLIO_COLLECTION = "freelancerPortfolio";
const LEGACY_PORTFOLIO_COLLECTION = "portfolioItems";

const state = {
  user: null, profile: null, services: [], orders: [], notifications: [], categories: [], portfolio: [],
  editingServiceId: null,
  pendingDeliveryOrder: null,
  pendingConfirmAction: null,
  avatarFile: null, avatarRemoved: false, avatarPreviewUrl: ""
};
const $ = id => document.getElementById(id);
const elements = {
  loadingScreen: $("loadingScreen"), sidebar: $("sidebar"), sidebarOverlay: $("sidebarOverlay"),
  mobileMenuButton: $("mobileMenuButton"), serviceModal: $("serviceModal"), serviceForm: $("serviceForm"),
  deliveryModal: $("deliveryModal"), deliveryForm: $("deliveryForm"),
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
function populateServiceCategories(selected = "") {
  const defaults = ["تصميم", "برمجة وتطوير", "كتابة وترجمة", "تسويق رقمي", "صوتيات", "فيديو وأنيميشن", "أعمال", "هندسة", "بيانات", "تعليم واستشارات"];
  const names = [...new Set([...defaults, ...state.categories.filter(item => item.active !== false).map(item => item.name).filter(Boolean)])];
  $("serviceCategory").replaceChildren(new Option("اختر الفئة", ""), ...names.map(name => new Option(name, name)));
  $("serviceCategory").value = selected;
}

function openServiceModal(service = null) {
  state.editingServiceId = service?.id || null;
  elements.serviceForm.reset();
  populateServiceCategories(service?.category || "");
  $("serviceModalTitle").textContent = service ? "تعديل الخدمة وإرسالها للمراجعة" : "أضف تفاصيل خدمتك";
  $("serviceModalDescription").textContent = service
    ? "بعد حفظ التعديل ستعود الخدمة إلى الإدارة للمراجعة قبل ظهورها للعملاء."
    : "أضف بيانات الخدمة، وسيتم إرسالها مباشرة إلى الإدارة للمراجعة قبل ظهورها للعملاء.";
  $("serviceSubmitButton").textContent = service ? "حفظ وإرسال للمراجعة" : "إرسال الخدمة للمراجعة";
  if (service) {
    $("serviceTitle").value = service.title || "";
    $("servicePrice").value = Number(service.price || 0) || "";
    $("serviceDescription").value = service.description || "";
    $("serviceDelivery").value = String(service.deliveryDays || 1);
    $("serviceRevisions").value = String(service.revisions || 0);
    $("serviceKeywords").value = Array.isArray(service.keywords) ? service.keywords.join("، ") : (service.keywords || "");
  }
  elements.serviceModal.classList.add("open");
  elements.serviceModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("serviceTitle").focus(), 50);
}
function closeServiceModal() {
  elements.serviceModal.classList.remove("open");
  elements.serviceModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  elements.serviceForm.reset();
  state.editingServiceId = null;
}

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
  const title = document.createElement("strong");
  title.textContent = service.title || "خدمة بدون عنوان";
  const category = document.createElement("small");
  category.textContent = service.category || "غير مصنفة";
  info.append(title, category);
  const actions = document.createElement("div");
  actions.className = "table-actions";
  if (service.status !== "pending") {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "table-button";
    edit.textContent = "تعديل";
    edit.addEventListener("click", () => openServiceModal(service));
    actions.appendChild(edit);
  }
  if (["draft", "rejected"].includes(service.status)) {
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "table-button primary";
    submit.textContent = "إرسال للمراجعة";
    submit.addEventListener("click", () => submitService(service.id));
    actions.appendChild(submit);
  }
  if (service.status !== "pending") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "table-button danger";
    remove.textContent = "حذف";
    remove.addEventListener("click", () => deleteService(service.id));
    actions.appendChild(remove);
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
  const project = document.createElement("div");
  project.className = "project-title";
  const thumb = document.createElement("span");
  thumb.className = "project-thumb";
  thumb.textContent = (service.category || "خ").charAt(0);
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = service.title || "خدمة بدون عنوان";
  const detail = document.createElement("small");
  detail.textContent = `${service.category || "غير مصنفة"} · ${formatMoney(service.price)} ل.س`;
  copy.append(title, detail);
  project.append(thumb, copy);
  const meta = document.createElement("div");
  meta.className = "project-meta";
  const duration = document.createElement("strong");
  duration.textContent = `${service.deliveryDays || 2} أيام`;
  const label = document.createElement("small");
  label.textContent = "مدة التسليم";
  meta.append(duration, label);
  row.append(project, meta);
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
  const pendingServices = state.services.filter(service => ["pending", "rejected"].includes(service.status)).length;
  $("servicesNavCount").textContent = pendingServices;
  $("servicesNavCount").hidden = pendingServices === 0;
}

function renderOrders() {
  const activeOrders = state.orders.filter(order => !["completed", "cancelled"].includes(order.status)).length;
  $("ordersNavCount").textContent = activeOrders;
  $("ordersNavCount").hidden = activeOrders === 0;
  $("completedProjects").textContent = state.orders.filter(order => order.status === "completed").length;
  const rows = state.orders.map(order => {
    const row = document.createElement("tr");
    const actions = document.createElement("div");
    actions.className = "table-actions";
    const messages = document.createElement("a");
    messages.className = "table-button";
    messages.textContent = "المحادثة";
    messages.href = `messages.html?${new URLSearchParams({
      withUid: order.buyerUid || "", serviceId: order.serviceId || order.id,
      serviceTitle: order.serviceTitle || "طلب خدمة", serviceImage: order.serviceImage || "",
      servicePrice: String(order.total || 0), sellerUid: order.freelancerUid || state.user.uid
    })}`;
    actions.appendChild(messages);
    if (["funded", "active"].includes(order.status)) {
      const deliver = document.createElement("button");
      deliver.type = "button";
      deliver.className = "table-button primary";
      deliver.textContent = "تسليم العمل";
      deliver.addEventListener("click", () => openDeliveryModal(order));
      actions.appendChild(deliver);
    }
    [
      order.serviceTitle || "طلب خدمة",
      order.buyerName || "عميل",
      `${formatMoney(order.total)} ل.س`,
      orderStatus[order.status] || order.status,
      formatDate(order.createdAt),
      actions
    ].forEach(value => {
      const cell = document.createElement("td");
      cell.append(value instanceof Node ? value : document.createTextNode(value));
      row.appendChild(cell);
    });
    return row;
  });
  $("ordersTable").replaceChildren(...rows);
  $("ordersEmpty").hidden = rows.length > 0;
  const revenue = state.orders.filter(order => order.status === "completed").reduce((sum, order) => sum + Number(order.freelancerAmount || order.escrow?.freelancerAmount || order.total || 0), 0);
  $("availableBalance").textContent = formatMoney(revenue);
  updateFinanceSummary();
}

function renderNotifications() {
  const unread = state.notifications.filter(item => !item.read).length;
  $("notificationsNavCount").textContent = unread;
  $("notificationsNavCount").hidden = unread === 0;
  const rows = state.notifications.map(item => {
    const row = document.createElement("article");
    row.className = `notification-item ${item.read ? "" : "unread"}`;
    const icon = document.createElement("span");
    icon.textContent = "♧";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.title || "إشعار جديد";
    const body = document.createElement("small");
    body.textContent = item.body || "";
    copy.append(title, body);
    const time = document.createElement("time");
    time.textContent = formatDate(item.createdAt);
    row.append(icon, copy, time);
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

function orderFreelancerAmount(order) {
  return Number(order.freelancerAmount || order.escrow?.freelancerAmount || order.total || 0);
}

function updateFinanceSummary() {
  const available = state.orders.filter(order => order.status === "completed").reduce((sum, order) => sum + orderFreelancerAmount(order), 0);
  const pending = state.orders.filter(order => ["funded", "active", "delivered"].includes(order.status)).reduce((sum, order) => sum + orderFreelancerAmount(order), 0);
  const disputed = state.orders.filter(order => order.status === "disputed").reduce((sum, order) => sum + orderFreelancerAmount(order), 0);
  const financeHero = document.querySelector("#section-finance .finance-hero");
  if (!financeHero) return;
  const total = financeHero.querySelector("strong");
  const breakdown = financeHero.querySelectorAll(".finance-breakdown strong");
  if (total) total.innerHTML = `${formatMoney(available)} <small>ل.س</small>`;
  if (breakdown[0]) breakdown[0].textContent = `${formatMoney(available)} ل.س`;
  if (breakdown[1]) breakdown[1].textContent = `${formatMoney(pending)} ل.س`;
  if (breakdown[2]) breakdown[2].textContent = `${formatMoney(disputed)} ل.س`;
}

function openDeliveryModal(order) {
  state.pendingDeliveryOrder = order;
  $("deliveryServiceTitle").textContent = order.serviceTitle || "طلب خدمة";
  $("deliveryClientName").textContent = order.buyerName ? `العميل: ${order.buyerName}` : "العميل";
  $("deliveryOrderAmount").textContent = `${formatMoney(order.total)} ل.س`;
  $("deliveryNote").value = order.deliveryNote || "";
  elements.deliveryModal.classList.add("open");
  elements.deliveryModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("deliveryNote").focus(), 50);
}

function closeDeliveryModal() {
  state.pendingDeliveryOrder = null;
  elements.deliveryForm.reset();
  elements.deliveryModal.classList.remove("open");
  elements.deliveryModal.setAttribute("aria-hidden", "true");
  if (!elements.serviceModal.classList.contains("open")) document.body.style.overflow = "";
}

function openConfirmModal({ title, message, actionLabel = "تأكيد", danger = false, onConfirm }) {
  state.pendingConfirmAction = onConfirm;
  $("confirmModalTitle").textContent = title;
  $("confirmModalMessage").textContent = message;
  const button = $("confirmModalAction");
  button.textContent = actionLabel;
  button.classList.toggle("danger", danger);
  $("confirmModal").classList.add("open");
  $("confirmModal").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeConfirmModal() {
  state.pendingConfirmAction = null;
  $("confirmModal").classList.remove("open");
  $("confirmModal").setAttribute("aria-hidden", "true");
  if (!elements.serviceModal.classList.contains("open") && !elements.deliveryModal.classList.contains("open")) document.body.style.overflow = "";
}

async function runConfirmAction() {
  const action = state.pendingConfirmAction;
  if (!action) return;
  const button = $("confirmModalAction");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "جاري التنفيذ...";
  try {
    await action();
    closeConfirmModal();
  } catch (error) {
    console.error("Confirmed action failed", error);
    showToast("تعذر تنفيذ الإجراء حالياً. تحقق من الاتصال وحاول مجدداً.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleDeliverySubmit(event) {
  event.preventDefault();
  const order = state.pendingDeliveryOrder;
  if (!order) return;
  const note = $("deliveryNote").value.trim();
  if (!note) {
    showToast("أضف ملاحظة التسليم أو رابط الملفات قبل الإرسال.");
    $("deliveryNote").focus();
    return;
  }
  const button = $("deliverySubmitButton");
  button.disabled = true;
  button.textContent = "جاري التسليم...";
  try {
    await deliverEscrowOrder(db, order, note);
    state.orders = state.orders.map(item => item.id === order.id ? {
      ...item,
      status: "delivered",
      deliveryNote: note,
      escrow: { ...(item.escrow || {}), status: "review_hold" }
    } : item);
    renderOrders();
    closeDeliveryModal();
    showToast("تم تسليم العمل وبدأت مهلة مراجعة العميل لمدة 15 يوم.");
  } catch (error) {
    console.error("Order delivery failed", error);
    showToast("تعذر تسليم العمل حالياً. تحقق من الاتصال وحاول مجدداً.");
  } finally {
    button.disabled = false;
    button.textContent = "تأكيد التسليم";
  }
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
  openConfirmModal({
    title: "حذف الخدمة نهائياً",
    message: "هل تريد حذف هذه الخدمة؟ لا يمكن التراجع عن هذا الإجراء.",
    actionLabel: "حذف الخدمة",
    danger: true,
    onConfirm: () => deleteServiceConfirmed(id)
  });
}

async function deleteServiceConfirmed(id) {
  const service = state.services.find(item => item.id === id);
  if (service?.imagePath) await deleteObject(storageRef(storage, service.imagePath)).catch(() => {});
  await deleteDoc(doc(db, "services", id));
  state.services = state.services.filter(service => service.id !== id);
  renderServices();
  showToast("تم حذف الخدمة.");
}

async function submitService(id) {
  openConfirmModal({
    title: "إرسال الخدمة للمراجعة",
    message: "سيتم إرسال الخدمة إلى الإدارة ولن تظهر للعملاء قبل الموافقة عليها.",
    actionLabel: "إرسال للمراجعة",
    onConfirm: () => submitServiceConfirmed(id)
  });
}

async function submitServiceConfirmed(id) {
  await updateDoc(doc(db, "services", id), { status: "pending", updatedAt: serverTimestamp() });
  const service = state.services.find(item => item.id === id);
  if (service) service.status = "pending";
  renderServices();
  showToast("تم إرسال الخدمة للمراجعة.");
}

async function handleServiceSubmit(event) {
  event.preventDefault();
  const submit = elements.serviceForm.querySelector('[type="submit"]');
  const editingServiceId = state.editingServiceId;
  const imageFile = $("serviceImage").files[0];
  if (imageFile && (!["image/jpeg", "image/png", "image/webp"].includes(imageFile.type) || imageFile.size > 5 * 1024 * 1024)) {
    showToast("اختر صورة خدمة بصيغة JPG أو PNG أو WebP وبحجم لا يتجاوز 5MB.");
    return;
  }
  submit.disabled = true;
  try {
    const data = {
      ownerUid: state.user.uid, ownerName: state.profile.name || state.user.email || "مستقل",
      title: $("serviceTitle").value.trim(), category: $("serviceCategory").value,
      price: Number($("servicePrice").value), description: $("serviceDescription").value.trim(),
      deliveryDays: Number($("serviceDelivery").value), revisions: Number($("serviceRevisions").value),
      keywords: $("serviceKeywords").value.split(/[،,]/).map(value => value.trim()).filter(Boolean),
      status: editingServiceId ? "pending" : "draft",
      updatedAt: serverTimestamp()
    };
    let serviceRef;
    if (editingServiceId) {
      serviceRef = doc(db, "services", editingServiceId);
      delete data.ownerUid;
      delete data.ownerName;
      if (imageFile) {
        const extension = imageFile.type.split("/")[1].replace("jpeg", "jpg");
        const path = `service-images/${state.user.uid}/${editingServiceId}/cover.${extension}`;
        const imageRef = storageRef(storage, path);
        await uploadBytes(imageRef, imageFile, { contentType: imageFile.type });
        data.imageUrl = await getDownloadURL(imageRef);
        data.imagePath = path;
      }
      await updateDoc(serviceRef, data);
      const oldPath = state.services.find(item => item.id === editingServiceId)?.imagePath;
      if (oldPath && data.imagePath && oldPath !== data.imagePath) await deleteObject(storageRef(storage, oldPath)).catch(() => {});
    } else {
      serviceRef = await addDoc(collection(db, "services"), { ...data, createdAt: serverTimestamp() });
      const reviewUpdate = { status: "pending", updatedAt: serverTimestamp() };
      if (imageFile) {
        const extension = imageFile.type.split("/")[1].replace("jpeg", "jpg");
        const path = `service-images/${state.user.uid}/${serviceRef.id}/cover.${extension}`;
        const imageRef = storageRef(storage, path);
        await uploadBytes(imageRef, imageFile, { contentType: imageFile.type });
        reviewUpdate.imageUrl = await getDownloadURL(imageRef);
        reviewUpdate.imagePath = path;
      }
      await updateDoc(serviceRef, reviewUpdate);
    }
    closeServiceModal();
    await loadWorkspace();
    showToast(editingServiceId ? "تم إرسال التعديلات إلى الإدارة للمراجعة." : "تم إرسال الخدمة إلى الإدارة للمراجعة.");
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
  $("profileAboutInput").value = profile.about || "";
  $("profileSkills").value = Array.isArray(profile.skills) ? profile.skills.join("، ") : "";
  $("profileCardSpecialty").textContent = specialtyLabels[profile.specialty] || "مستقل محترف";
  const completionFields = [profile.name, profile.phone, profile.specialty, user.email, profile.about, profile.skills?.length];
  const progress = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100);
  $("profileProgressValue").textContent = `${progress}%`;
  $("profileProgressBar").style.width = `${progress}%`;
  $("profileCompletionCard").hidden = progress === 100;
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
      image.addEventListener("error", () => { target.replaceChildren(document.createTextNode(initial)); });
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

async function optimizeAvatarFile(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = Math.min(768, Math.max(bitmap.width, bitmap.height));
    const scale = size / Math.max(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.86));
    if (!blob) return file;
    return new File([blob], "avatar.webp", { type: "image/webp", lastModified: Date.now() });
  } catch (error) {
    console.warn("Unable to optimize avatar image", error);
    return file;
  }
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

async function saveProfile(event) {
  event.preventDefault();
  const updates = { name: $("profileName").value.trim(), phone: $("profilePhone").value.trim(), specialty: $("profileSpecialty").value };
  const about = $("profileAboutInput").value.trim();
  const skills = [...new Set($("profileSkills").value.split(/[،,]/).map(value => value.trim()).filter(Boolean))].slice(0, 20);
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
      status: state.profile.status || "active",
      avatar: avatar.url,
      avatarPath: avatar.path,
      specialty: updates.specialty,
      about,
      skills
    }, { merge: true });
    await batch.commit();
    state.profile = { ...state.profile, ...updates, avatar: avatar.url, avatarPath: avatar.path, about, skills };
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

function portfolioCard(item) {
  const card = document.createElement("article");
  card.className = "portfolio-dashboard-card";
  const mediaUrl = item.mediaUrl || item.imageUrl || "";
  const isVideo = item.mediaType === "video";
  const media = document.createElement(isVideo ? "video" : "img");
  if (isVideo) {
    media.src = mediaUrl;
    media.controls = true;
    media.preload = "metadata";
    media.muted = true;
  } else {
    media.src = mediaUrl || "assets/service-placeholder.svg";
    media.alt = item.title || "عمل منجز";
    media.addEventListener("error", () => { media.src = "assets/service-placeholder.svg"; });
  }
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = item.title || "عمل منجز";
  const category = document.createElement("small");
  category.textContent = item.category || "مشروع";
  const description = document.createElement("p");
  description.className = "portfolio-dashboard-description";
  description.textContent = item.description || "";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "table-button danger";
  remove.textContent = "حذف العمل";
  remove.addEventListener("click", () => deletePortfolioItem(item));
  copy.append(title, category, description, remove);
  card.append(media, copy);
  return card;
}

function renderPortfolio() {
  $("portfolioDashboardGrid").replaceChildren(...state.portfolio.map(portfolioCard));
  $("portfolioDashboardEmpty").hidden = state.portfolio.length > 0;
  $("portfolioNavCount").textContent = state.portfolio.length;
  $("portfolioNavCount").hidden = state.portfolio.length === 0;
}

async function deletePortfolioItem(item) {
  openConfirmModal({
    title: "حذف عمل من المعرض",
    message: `هل تريد حذف العمل "${item.title || "بدون عنوان"}" من معرض أعمالك؟`,
    actionLabel: "حذف العمل",
    danger: true,
    onConfirm: () => deletePortfolioItemConfirmed(item)
  });
}

async function deletePortfolioItemConfirmed(item) {
  const mediaPath = item.mediaPath || item.imagePath;
  if (mediaPath) await deleteObject(storageRef(storage, mediaPath)).catch(() => {});
  await deleteDoc(doc(db, item.sourceCollection || PORTFOLIO_COLLECTION, item.id));
  state.portfolio = state.portfolio.filter(entry => entry.id !== item.id);
  renderPortfolio();
  fillProfile(state.user, state.profile);
  showToast("تم حذف العمل من معرضك.");
}

async function handlePortfolioSubmit(event) {
  event.preventDefault();
  const file = $("portfolioImage").files[0];
  const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file?.type);
  const isVideo = ["video/mp4", "video/webm", "video/quicktime"].includes(file?.type);
  const maxSize = isVideo ? 50 * 1024 * 1024 : 5 * 1024 * 1024;
  if (!file || (!isImage && !isVideo) || file.size > maxSize) {
    showToast("اختر صورة حتى 5MB أو فيديو MP4/WebM حتى 50MB.");
    return;
  }
  const submit = $("portfolioSubmitButton");
  const message = $("portfolioMessage");
  submit.disabled = true;
  const itemRef = doc(collection(db, PORTFOLIO_COLLECTION));
  let mediaPath = "";
  let uploadedMediaUrl = "";
  let phase = "upload";
  let saved = false;
  try {
    if (message) message.textContent = isVideo ? "جاري رفع الفيديو..." : "جاري رفع الصورة...";
    const extension = file.type.split("/")[1].replace("jpeg", "jpg").replace("quicktime", "mov");
    mediaPath = `freelancer-portfolio/${state.user.uid}/${itemRef.id}/cover.${extension}`;
    const mediaRef = storageRef(storage, mediaPath);
    await uploadBytes(mediaRef, file, { contentType: file.type });
    uploadedMediaUrl = await getDownloadURL(mediaRef).catch(() => "");

    phase = "database";
    if (message) message.textContent = "جاري نشر العمل في معرضك...";
    const portfolioPayload = {
      ownerUid: state.user.uid,
      title: $("portfolioTitle").value.trim(),
      category: $("portfolioCategory").value.trim(),
      description: $("portfolioDescription").value.trim(),
      mediaType: isVideo ? "video" : "image",
      mediaUrl: "",
      mediaPath,
      imageUrl: "",
      imagePath: isImage ? mediaPath : "",
      published: true,
      source: "freelancer-dashboard",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    console.info("Saving portfolio item", {
      ...portfolioPayload,
      createdAt: "serverTimestamp",
      updatedAt: "serverTimestamp"
    });
    await setDoc(itemRef, portfolioPayload);
    saved = true;

    event.currentTarget.reset();
    try {
      await loadWorkspace();
    } catch (refreshError) {
      console.warn("Portfolio saved but workspace refresh failed", refreshError);
      state.portfolio.unshift({
        id: itemRef.id,
        sourceCollection: PORTFOLIO_COLLECTION,
        ...portfolioPayload,
        mediaUrl: uploadedMediaUrl,
        imageUrl: isImage ? uploadedMediaUrl : "",
        createdAt: new Date(),
        updatedAt: new Date()
      });
      renderPortfolio();
      fillProfile(state.user, state.profile);
    }
    if (message) message.textContent = "تم نشر العمل بنجاح.";
    showToast("تم نشر العمل في ملفك الشخصي.");
  } catch (error) {
    console.error("Portfolio creation failed", error);
    if (saved) {
      if (message) message.textContent = "تم نشر العمل بنجاح.";
      showToast("تم نشر العمل في ملفك الشخصي.");
      setTimeout(() => location.reload(), 700);
      return;
    }
    if (!saved && mediaPath) await deleteObject(storageRef(storage, mediaPath)).catch(() => {});
    const detail = error.code ? ` (${error.code})` : "";
    const source = phase === "upload" ? "رفع الصورة" : "حفظ بيانات العمل";
    if (message) message.textContent = `تعذر ${source}${detail}.`;
    showToast(`تعذر ${source}. تحقق من الصلاحيات${detail}.`);
  } finally {
    submit.disabled = false;
  }
}

async function hydratePortfolioImages() {
  await Promise.all(state.portfolio.map(async item => {
    const mediaPath = item.mediaPath || item.imagePath;
    if ((item.mediaUrl || item.imageUrl) || !mediaPath) return;
    try {
      const url = await getDownloadURL(storageRef(storage, mediaPath));
      item.mediaUrl = url;
      if (!item.mediaType || item.mediaType === "image") item.imageUrl = url;
    } catch (error) {
      console.warn("Unable to resolve portfolio image", item.id, error);
    }
  }));
}

function renderAccountPerformance() {
  const panel = document.querySelector(".performance-panel");
  if (!panel) return;
  const bars = [...panel.querySelectorAll(".chart-bars span")];
  const now = Date.now();
  const bucketSize = 2.5 * 24 * 60 * 60 * 1000;
  const buckets = Array.from({ length: bars.length }, (_, index) => ({
    start: now - (bars.length - index) * bucketSize,
    end: now - (bars.length - index - 1) * bucketSize,
    value: 0
  }));
  state.orders.forEach(order => {
    const created = toDate(order.createdAt)?.getTime();
    if (!created || created < now - 30 * 24 * 60 * 60 * 1000) return;
    const bucket = buckets.find(item => created >= item.start && created < item.end);
    if (bucket) bucket.value += 1;
  });
  const max = Math.max(...buckets.map(item => item.value), 1);
  bars.forEach((bar, index) => {
    const value = buckets[index]?.value || 0;
    bar.style.setProperty("--bar", `${value ? Math.max(18, Math.round(value / max * 100)) : 6}%`);
    bar.title = `${value} طلب`;
  });
  const completed = state.orders.filter(order => order.status === "completed").length;
  const active = state.orders.filter(order => ["funded", "active", "delivered"].includes(order.status)).length;
  const note = panel.querySelector(".chart-note");
  if (note) note.textContent = `يعتمد المخطط على الطلبات الحقيقية خلال آخر 30 يوماً. لديك ${active} طلب قيد التنفيذ و${completed} طلب مكتمل.`;
}

async function loadWorkspace() {
  const uid = state.user.uid;
  const [servicesSnapshot, ordersSnapshot, notificationsSnapshot, categoriesSnapshot, portfolioSnapshot, legacyPortfolioSnapshot] = await Promise.all([
    getDocs(query(collection(db, "services"), where("ownerUid", "==", uid))),
    getDocs(query(collection(db, "orders"), where("freelancerUid", "==", uid))),
    getDocs(collection(db, "notifications", uid, "items")),
    getDocs(query(collection(db, "serviceCategories"), where("active", "==", true))),
    getDocs(query(collection(db, PORTFOLIO_COLLECTION), where("ownerUid", "==", uid))),
    getDocs(query(collection(db, LEGACY_PORTFOLIO_COLLECTION), where("ownerUid", "==", uid))).catch(() => ({ docs: [] }))
  ]);
  state.services = sortNewest(servicesSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  state.orders = sortNewest(ordersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })), "createdAt");
  state.notifications = sortNewest(notificationsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })), "createdAt");
  state.categories = categoriesSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  const portfolioItems = [
    ...portfolioSnapshot.docs.map(item => ({ id: item.id, sourceCollection: PORTFOLIO_COLLECTION, ...item.data() })),
    ...legacyPortfolioSnapshot.docs.map(item => ({ id: item.id, sourceCollection: LEGACY_PORTFOLIO_COLLECTION, ...item.data() }))
  ];
  state.portfolio = sortNewest(
    portfolioItems.filter(item => item.published === true),
    "createdAt"
  );
  await hydratePortfolioImages();
  populateServiceCategories();
  renderServices();
  renderOrders();
  renderNotifications();
  renderPortfolio();
  renderAccountPerformance();
  fillProfile(state.user, state.profile);
}

function bindEvents() {
  document.querySelectorAll(".side-link[data-section]").forEach(link => link.addEventListener("click", () => showSection(link.dataset.section)));
  document.querySelectorAll("[data-section-target]").forEach(control => control.addEventListener("click", () => showSection(control.dataset.sectionTarget)));
  document.querySelectorAll("[data-open-service-modal]").forEach(control => control.addEventListener("click", () => openServiceModal()));
  document.querySelectorAll("[data-close-modal]").forEach(control => control.addEventListener("click", closeServiceModal));
  document.querySelectorAll("[data-close-delivery-modal]").forEach(control => control.addEventListener("click", closeDeliveryModal));
  document.querySelectorAll("[data-close-confirm-modal]").forEach(control => control.addEventListener("click", closeConfirmModal));
  $("confirmModalAction").addEventListener("click", runConfirmAction);
  elements.mobileMenuButton.addEventListener("click", () => elements.sidebar.classList.contains("open") ? closeSidebar() : openSidebar());
  elements.sidebarOverlay.addEventListener("click", closeSidebar);
  elements.serviceForm.addEventListener("submit", handleServiceSubmit);
  elements.deliveryForm.addEventListener("submit", handleDeliverySubmit);
  elements.profileForm.addEventListener("submit", saveProfile);
  $("portfolioForm").addEventListener("submit", handlePortfolioSubmit);
  $("profileAvatarInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.target.value = "";
      showToast("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 5MB.");
      return;
    }
    elements.profileMessage.textContent = "جاري تجهيز الصورة...";
    const optimizedFile = await optimizeAvatarFile(file);
    state.avatarFile = optimizedFile;
    state.avatarRemoved = false;
    previewAvatar(optimizedFile);
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
  document.addEventListener("keydown", event => { if (event.key === "Escape") { closeServiceModal(); closeDeliveryModal(); closeConfirmModal(); closeSidebar(); } });
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
    state.profile = { ...profile, ...(publicSnapshot.exists() ? publicSnapshot.data() : {}) };
    await refreshStoredAvatar();
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
