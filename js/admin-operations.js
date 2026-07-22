import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc, collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query,
  serverTimestamp, startAfter, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { auth, db, functions, storage } from "./firebase.js";
import { sendOfficialEmail } from "./email-client.js";
import { applyAdminAccess, hasPermission, initializeAdminAccess } from "./admin-access.js";

const state = {
  admin: null, services: [], tickets: [], orders: [], articles: [], faqs: [], categories: [],
  selectedTicket: null, replies: [], verificationCount: 0, pendingServiceReview: null, pendingConfirmAction: null,
  articleCursor: null, articleHasMore: false, articleTotal: 0, articleLoading: false,
  articleSaving: false, articleOperationId: "", loadedSections: new Set(), counts: {}, financeMetrics: null
};
const $ = id => document.getElementById(id);
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const sortNewest = (items, field = "updatedAt") => items.sort((a, b) => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0));
const formatDate = value => toDate(value)?.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) || "-";
const serviceLabels = { draft: "مسودة", pending: "قيد المراجعة", published: "منشورة", paused: "متوقفة", rejected: "مرفوضة" };
const ticketLabels = { open: "مفتوحة", in_progress: "قيد المعالجة", waiting_user: "بانتظار المستخدم", resolved: "محلولة", closed: "مغلقة" };
const orderLabels = { funded: "محجوز", active: "قيد التنفيذ", delivered: "قيد المراجعة", completed: "محرر", disputed: "نزاع", cancelled: "ملغي" };
const categoryLabels = { technical: "تقنية", account: "الحساب", payment: "الدفع", dispute: "نزاع", report: "بلاغ", general: "عام" };
const faqSectionLabels = { buyer: "للمشترين", freelancer: "للمستقلين", payment: "الدفع والسحب", technical: "أسئلة تقنية", general: "أسئلة عامة" };
const ADMIN_PAGE_SIZE = 20;
const money = value => `${Number(value || 0).toLocaleString("en-US")} ل.س`;

function initializeFinancePeriod() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  $("financeReportMonth").value ||= month;
  $("financeReportYear").value ||= String(now.getFullYear());
  $("financeReportStart").value ||= `${now.getFullYear()}-01-01`;
  $("financeReportEnd").value ||= now.toISOString().slice(0, 10);
  updateFinancePeriodControls();
}

function updateFinancePeriodControls() {
  const mode = $("financePeriodMode").value;
  document.querySelectorAll("[data-finance-period]").forEach(control => {
    control.hidden = control.dataset.financePeriod !== mode;
  });
}

function financeReportRequest() {
  return {
    mode: $("financePeriodMode").value,
    month: $("financeReportMonth").value,
    year: Number($("financeReportYear").value),
    startDate: $("financeReportStart").value,
    endDate: $("financeReportEnd").value
  };
}

function operationId(prefix) {
  const random = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

async function callArticleFunction(name, data) {
  const result = await httpsCallable(functions, name)(data);
  return result.data;
}

function toast(message) {
  const element = $("adminToast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3000);
}

function auditData(action, target = {}, reason = "") {
  return {
    action,
    actorUid: state.admin.id,
    actorName: state.admin.name || state.admin.email,
    actorEmail: state.admin.email || "",
    targetUid: target.ownerUid || target.requesterUid || target.id || "",
    targetName: target.ownerName || target.requesterName || target.title || target.subject || "",
    targetEmail: target.requesterEmail || "",
    reason,
    createdAt: serverTimestamp()
  };
}

function notificationData(title, body, link, type) {
  return { title, body, link, type, read: false, createdAt: serverTimestamp() };
}

async function serviceOwnerEmail(service) {
  if (service.ownerEmail) return service.ownerEmail;
  if (!service.ownerUid) return "";
  const snapshot = await getDoc(doc(db, "users", service.ownerUid)).catch(() => null);
  return snapshot?.exists() ? (snapshot.data().email || "") : "";
}

function openAdminConfirm({ title, message, actionLabel = "تأكيد", onConfirm }) {
  state.pendingConfirmAction = onConfirm;
  $("adminConfirmTitle").textContent = title;
  $("adminConfirmMessage").textContent = message;
  $("adminConfirmAction").textContent = actionLabel;
  $("adminConfirmModal").classList.add("open");
  $("adminConfirmModal").setAttribute("aria-hidden", "false");
}

function closeAdminConfirm() {
  state.pendingConfirmAction = null;
  $("adminConfirmModal").classList.remove("open");
  $("adminConfirmModal").setAttribute("aria-hidden", "true");
}

async function runAdminConfirmAction() {
  const action = state.pendingConfirmAction;
  if (!action) return;
  const button = $("adminConfirmAction");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "جاري التنفيذ...";
  try {
    await action();
    closeAdminConfirm();
  } catch (error) {
    console.error("Admin confirmed action failed", error);
    toast("تعذر تنفيذ الإجراء حالياً. تحقق من الصلاحيات والاتصال.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await handler();
    } catch (error) {
      console.error(`Admin action failed: ${label}`, error);
      toast("تعذر تنفيذ الإجراء حالياً. حاول مرة أخرى.");
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function serviceImageUrl(service) {
  const firstImage = Array.isArray(service.images) ? service.images.find(Boolean) : "";
  return service.imageUrl || service.coverUrl || service.serviceImage || service.thumbnail || firstImage || "";
}

function imageLoader() {
  const loader = document.createElement("span");
  loader.className = "image-loading-dots";
  loader.innerHTML = "<span><i></i><i></i><i></i></span>";
  return loader;
}

function ensureNavBadge(section) {
  const link = document.querySelector(`.nav-link[data-section="${section}"]`);
  if (!link) return null;
  let badge = link.querySelector("em[data-admin-badge], em[id]");
  if (!badge) {
    badge = document.createElement("em");
    badge.dataset.adminBadge = section;
    link.appendChild(badge);
  } else {
    badge.dataset.adminBadge = section;
  }
  return badge;
}

function updateNavBadge(section, count) {
  const badge = ensureNavBadge(section);
  if (!badge) return;
  badge.textContent = count > 0 ? String(count) : "";
  badge.hidden = count <= 0;
}

function adminNotification(icon, title, body, section, count = 1) {
  return { icon, title, body, section, count };
}

function buildAdminNotifications() {
  const pendingServices = state.services.filter(service => service.status === "pending");
  const activeTickets = state.tickets.filter(ticket => !["resolved", "closed"].includes(ticket.status));
  const disputes = state.tickets.filter(ticket => ticket.category === "dispute" && !["resolved", "closed"].includes(ticket.status));
  const financeOrders = state.orders.filter(order => ["funded", "active", "delivered", "disputed"].includes(order.status));
  const draftArticles = state.articles.filter(article => article.status === "draft");
  const pendingServicesCount = state.counts.pendingServices ?? pendingServices.length;
  const activeTicketsCount = state.counts.activeTickets ?? activeTickets.length;
  const financeOrdersCount = state.counts.financeOrders ?? financeOrders.length;
  const draftArticlesCount = state.counts.draftArticles ?? draftArticles.length;

  updateNavBadge("verifications", state.verificationCount);
  updateNavBadge("marketplace", pendingServicesCount);
  updateNavBadge("finance", financeOrdersCount);
  updateNavBadge("support", activeTicketsCount);
  updateNavBadge("content", draftArticlesCount);

  return [
    state.verificationCount ? adminNotification("✓", "طلبات توثيق معلقة", `${state.verificationCount} طلب حساب يحتاج مراجعة بيانات المستخدم قبل الموافقة.`, "verifications", state.verificationCount) : null,
    pendingServicesCount ? adminNotification("▦", "خدمات بانتظار المراجعة", `${pendingServicesCount} خدمة تحتاج عرض التفاصيل قبل النشر أو الرفض.`, "marketplace", pendingServicesCount) : null,
    financeOrdersCount ? adminNotification("◈", "مدفوعات وطلبات تحتاج متابعة", `${financeOrdersCount} طلب مرتبط بالحجز أو التسليم أو النزاع.`, "finance", financeOrdersCount) : null,
    activeTicketsCount ? adminNotification("?", "تذاكر دعم نشطة", `${activeTicketsCount} تذكرة مفتوحة أو قيد المعالجة.`, "support", activeTicketsCount) : null,
    disputes.length ? adminNotification("⚖", "نزاعات مفتوحة", `${disputes.length} نزاع يحتاج قرار أو متابعة من الإدارة.`, "support", disputes.length) : null,
    draftArticlesCount ? adminNotification("▤", "محتوى غير منشور", `${draftArticlesCount} مقال ما زال كمسودة.`, "content", draftArticlesCount) : null
  ].filter(Boolean);
}

function renderAdminNotifications() {
  const notifications = buildAdminNotifications();
  const total = notifications.reduce((sum, item) => sum + item.count, 0);
  const count = $("adminNotificationsCount");
  count.textContent = String(total);
  count.hidden = total === 0;

  const list = $("adminNotificationsList");
  if (!notifications.length) {
    list.innerHTML = '<div class="admin-notification-empty">لا توجد إشعارات تشغيلية حالياً.</div>';
    return;
  }
  list.replaceChildren(...notifications.map(item => {
    const row = document.createElement("article");
    row.className = "admin-notification-item";
    row.innerHTML = `<span>${item.icon}</span><div><strong>${item.title}</strong><small>${item.body}</small></div>`;
    const button = actionButton("عرض", "text-button", () => {
      toggleAdminNotifications(false);
      document.querySelector(`.nav-link[data-section="${item.section}"]`)?.click();
    });
    row.appendChild(button);
    return row;
  }));
}

function toggleAdminNotifications(force) {
  const panel = $("adminNotificationsPanel");
  const button = $("adminNotificationsButton");
  const isOpen = force ?? panel.hidden;
  panel.hidden = !isOpen;
  button.setAttribute("aria-expanded", String(isOpen));
}

function serviceDetail(label, value) {
  const field = document.createElement("div");
  field.className = "detail-field";
  field.innerHTML = `<small>${escapeHtml(label)}</small><strong>${escapeHtml(value ?? "-")}</strong>`;
  return field;
}

function closeServicePreview() {
  $("servicePreviewModal").classList.remove("open");
  $("servicePreviewModal").setAttribute("aria-hidden", "true");
  $("servicePreviewBody").replaceChildren();
  $("servicePreviewActions").replaceChildren();
}

function openServicePreview(id) {
  const service = state.services.find(item => item.id === id);
  if (!service) return;
  $("servicePreviewTitle").textContent = service.title || "تفاصيل الخدمة";
  const body = $("servicePreviewBody");
  body.replaceChildren();

  const imageWrap = document.createElement("div");
  imageWrap.className = "service-preview-cover";
  const imageUrl = serviceImageUrl(service);
  if (imageUrl) {
    const loader = imageLoader();
    imageWrap.style.position = "relative";
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = service.title || "صورة الخدمة";
    image.loading = "lazy";
    image.addEventListener("load", () => loader.remove(), { once: true });
    image.addEventListener("error", () => loader.remove(), { once: true });
    imageWrap.append(image, loader);
  } else {
    imageWrap.innerHTML = "<span>لا توجد صورة مرفقة لهذه الخدمة</span>";
  }

  const summary = document.createElement("div");
  summary.className = "service-preview-summary";
  summary.append(
    serviceDetail("المستقل", service.ownerName || "-"),
    serviceDetail("الحالة", serviceLabels[service.status] || service.status || "-"),
    serviceDetail("السعر", `${Number(service.price || 0).toLocaleString("en-US")} ل.س`),
    serviceDetail("التصنيف", service.category || "-"),
    serviceDetail("مدة التسليم", service.deliveryDays ? `${service.deliveryDays} يوم` : "-"),
    serviceDetail("عدد التعديلات", service.revisions ?? "-"),
    serviceDetail("آخر تحديث", formatDate(service.updatedAt)),
    serviceDetail("رقم الخدمة", service.id)
  );

  const description = document.createElement("section");
  description.className = "service-preview-section";
  const keywords = Array.isArray(service.keywords) ? service.keywords.join("، ") : (service.keywords || "");
  description.innerHTML = `
    <h3>وصف الخدمة</h3>
    <p>${escapeHtml(service.description || "لا يوجد وصف مضاف.")}</p>
    <h3>الكلمات المفتاحية</h3>
    <p>${escapeHtml(keywords || "لا توجد كلمات مفتاحية.")}</p>
    ${service.moderationReason ? `<h3>ملاحظة المراجعة السابقة</h3><p>${escapeHtml(service.moderationReason)}</p>` : ""}
  `;

  body.append(imageWrap, summary, description);

  const actions = $("servicePreviewActions");
  actions.replaceChildren(actionButton("إغلاق", "secondary-button", closeServicePreview));
  if (service.status === "pending" && hasPermission("services.moderate")) {
    actions.append(
      actionButton("رفض الخدمة", "danger-button", () => {
        closeServicePreview();
        openServiceReviewModal(service);
      }),
      actionButton("نشر الخدمة", "primary-button", async () => {
        closeServicePreview();
        await reviewService(service.id, true);
      })
    );
  }
  if (hasPermission("services.moderate")) actions.appendChild(actionButton("حذف الخدمة", "danger-button", () => deleteServiceAdmin(service)));

  $("servicePreviewModal").classList.add("open");
  $("servicePreviewModal").setAttribute("aria-hidden", "false");
}

function renderServices() {
  const term = $("serviceAdminSearch").value.trim().toLowerCase();
  const filter = $("serviceAdminFilter").value;
  const services = state.services.filter(service => {
    const haystack = `${service.title || ""} ${service.ownerName || ""}`.toLowerCase();
    return (!term || haystack.includes(term)) && (filter === "all" || service.status === filter);
  });
  $("pendingServicesCount").textContent = state.services.filter(service => service.status === "pending").length;
  const rows = services.map(service => {
    const row = document.createElement("tr");
    const actions = document.createElement("div");
    actions.className = "table-actions";
    actions.append(actionButton("عرض الخدمة", "table-button", () => openServicePreview(service.id)));
    if (service.status === "pending" && hasPermission("services.moderate")) {
      actions.append(
        actionButton("نشر", "table-button approve", () => reviewService(service.id, true)),
        actionButton("رفض", "table-button reject", () => openServiceReviewModal(service))
      );
    }
    if (hasPermission("services.moderate")) actions.append(actionButton("حذف", "table-button reject", () => deleteServiceAdmin(service)));
    [service.title || "خدمة", service.ownerName || "-", `${Number(service.price || 0).toLocaleString("en-US")} ل.س`, serviceLabels[service.status] || service.status, formatDate(service.updatedAt), actions].forEach(value => {
      const cell = document.createElement("td");
      cell.append(value instanceof Node ? value : document.createTextNode(value));
      row.appendChild(cell);
    });
    return row;
  });
  $("adminServicesTable").replaceChildren(...rows);
  $("adminServicesEmpty").hidden = rows.length > 0;
}

function openServiceReviewModal(service) {
  state.pendingServiceReview = service;
  $("serviceReviewTitle").textContent = `رفض خدمة: ${service.title || "بدون عنوان"}`;
  $("serviceReviewDescription").textContent = "اكتب ملاحظة واضحة تساعد المستقل على تعديل الخدمة وإعادة إرسالها للمراجعة.";
  $("serviceReviewReason").value = service.moderationReason || "";
  $("serviceReviewModal").classList.add("open");
  $("serviceReviewModal").setAttribute("aria-hidden", "false");
  setTimeout(() => $("serviceReviewReason").focus(), 50);
}

function closeServiceReviewModal() {
  state.pendingServiceReview = null;
  $("serviceReviewForm").reset();
  $("serviceReviewModal").classList.remove("open");
  $("serviceReviewModal").setAttribute("aria-hidden", "true");
}

async function reviewService(id, approved, reason = "") {
  if (!hasPermission("services.moderate")) return toast("لا تملك صلاحية مراجعة الخدمات.");
  const service = state.services.find(item => item.id === id);
  if (!service) return;
  const moderationReason = approved ? "" : reason.trim();
  if (!approved && !moderationReason) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "services", id), {
    status: approved ? "published" : "rejected",
    moderationReason,
    reviewedAt: serverTimestamp(),
    reviewedBy: state.admin.id,
    updatedAt: serverTimestamp()
  });
  batch.set(doc(collection(db, "notifications", service.ownerUid, "items")), notificationData(
    approved ? "تم نشر خدمتك" : "تحتاج خدمتك إلى تعديل",
    approved ? `تمت الموافقة على خدمة: ${service.title}` : `تم رفض خدمة ${service.title}: ${moderationReason}`,
    "freelancer-dashboard.html#projects",
    approved ? "service_approved" : "service_rejected"
  ));
  batch.set(doc(collection(db, "adminAuditLogs")), auditData(approved ? "approve_service" : "reject_service", service, moderationReason));
  await batch.commit();
  if (!approved) {
    const ownerEmail = await serviceOwnerEmail(service);
    await sendOfficialEmail({
      purpose: "service_rejection",
      to: ownerEmail,
      subject: "نتيجة مراجعة خدمتك في PikLance",
      message: `مرحباً ${service.ownerName || ""}\n\nتمت مراجعة خدمتك: ${service.title || ""}\n\nلم نتمكن من نشر الخدمة حالياً بسبب:\n${moderationReason}\n\nيمكنك تعديل الخدمة وإعادة إرسالها للمراجعة من لوحة المستقل.\n\nفريق PikLance`,
      actionUrl: "https://piklance.com/freelancer-dashboard.html#services",
      actionLabel: "تعديل الخدمة"
    }).catch(error => {
      console.warn("Unable to send service rejection email", error);
      toast("تم رفض الخدمة، لكن تعذر إرسال البريد الرسمي حالياً.");
    });
  }
  toast(approved ? "تم نشر الخدمة وإشعار المستقل." : "تم رفض الخدمة وإرسال السبب.");
  await loadOperations();
}

async function handleServiceReviewSubmit(event) {
  event.preventDefault();
  const service = state.pendingServiceReview;
  if (!service) return;
  const reason = $("serviceReviewReason").value.trim();
  if (!reason) {
    toast("اكتب سبب الرفض قبل الإرسال.");
    $("serviceReviewReason").focus();
    return;
  }
  const button = $("serviceReviewConfirm");
  button.disabled = true;
  button.textContent = "جاري الرفض...";
  try {
    await reviewService(service.id, false, reason);
    closeServiceReviewModal();
  } catch (error) {
    console.error("Service rejection failed", error);
    toast("تعذر رفض الخدمة حالياً. تحقق من الصلاحيات والاتصال.");
  } finally {
    button.disabled = false;
    button.textContent = "رفض الخدمة";
  }
}

async function deleteServiceAdmin(service) {
  if (!hasPermission("services.moderate")) return toast("لا تملك صلاحية حذف الخدمات.");
  openAdminConfirm({
    title: "حذف خدمة نهائياً",
    message: `هل تريد حذف خدمة "${service.title || "بدون عنوان"}"؟ لا يمكن التراجع عن هذا الإجراء.`,
    actionLabel: "حذف الخدمة",
    onConfirm: () => deleteServiceAdminConfirmed(service)
  });
}

async function deleteServiceAdminConfirmed(service) {
  if (service.imagePath) await deleteObject(storageRef(storage, service.imagePath)).catch(() => {});
  const batch = writeBatch(db);
  batch.delete(doc(db, "services", service.id));
  batch.set(doc(collection(db, "adminAuditLogs")), auditData("delete_service", service, "admin_delete"));
  await batch.commit();
  closeServicePreview();
  toast("تم حذف الخدمة.");
  await loadOperations();
}

function renderTickets() {
  const term = $("ticketAdminSearch").value.trim().toLowerCase();
  const filter = $("ticketAdminFilter").value;
  const tickets = state.tickets.filter(ticket => {
    const haystack = `${ticket.subject || ""} ${ticket.requesterName || ""} ${ticket.requesterEmail || ""}`.toLowerCase();
    return (!term || haystack.includes(term)) && (filter === "all" || ticket.status === filter);
  });
  const active = state.tickets.filter(ticket => !["resolved", "closed"].includes(ticket.status));
  $("openTicketsCount").textContent = active.length;
  $("ticketOpenMetric").textContent = state.tickets.filter(ticket => ticket.status === "open").length;
  $("ticketProgressMetric").textContent = state.tickets.filter(ticket => ticket.status === "in_progress").length;
  $("ticketDisputeMetric").textContent = state.tickets.filter(ticket => ticket.category === "dispute").length;
  const rows = tickets.map(ticket => {
    const row = document.createElement("tr");
    const actions = actionButton("فتح", "table-button", () => openTicket(ticket.id));
    [ticket.subject || "تذكرة", ticket.requesterName || ticket.requesterEmail || "-", categoryLabels[ticket.category] || ticket.category, ticket.priority || "normal", ticketLabels[ticket.status] || ticket.status, formatDate(ticket.updatedAt), actions].forEach(value => {
      const cell = document.createElement("td");
      cell.append(value instanceof Node ? value : document.createTextNode(value));
      row.appendChild(cell);
    });
    return row;
  });
  $("adminTicketsTable").replaceChildren(...rows);
  $("adminTicketsEmpty").hidden = rows.length > 0;
}

function renderFinance() {
  const term = $("financeSearch").value.trim().toLowerCase();
  const filter = $("financeFilter").value;
  const orders = state.orders.filter(order => {
    const haystack = `${order.id} ${order.serviceTitle || ""} ${order.buyerName || ""} ${order.freelancerName || ""}`.toLowerCase();
    return (!term || haystack.includes(term)) && (filter === "all" || order.status === filter);
  });
  const report = state.financeMetrics;
  $("financeDepositsApproved").textContent = money(report?.deposits?.amount);
  $("financeDepositsCount").textContent = `${Number(report?.deposits?.count || 0).toLocaleString("en-US")} عملية`;
  $("financePlatformFunds").textContent = money(report?.current?.platformFunds);
  $("financeWithdrawnTotal").textContent = money(report?.withdrawals?.amount);
  $("financeWithdrawalsCount").textContent = `${Number(report?.withdrawals?.count || 0).toLocaleString("en-US")} عملية`;
  $("financeFeeTotal").textContent = money(report?.completed?.profit);
  $("financeGrossTotal").textContent = money(report?.orders?.gross);
  $("financeOrdersTotal").textContent = `${Number(report?.orders?.count || 0).toLocaleString("en-US")} طلب`;
  $("financeReleasedTotal").textContent = money(report?.completed?.freelancerReleased);
  $("financeCompletedOrders").textContent = `${Number(report?.completed?.count || 0).toLocaleString("en-US")} طلب مكتمل`;
  $("financeHeldTotal").textContent = money(report?.current?.heldOrders);
  $("financeWalletAvailable").textContent = money(report?.current?.walletAvailable);
  $("financeWalletBreakdown").textContent = `محجوز ${money(report?.current?.walletHeld)} · قيد السحب ${money(report?.current?.pendingWithdrawalBalance)}`;
  $("financeReportPeriod").textContent = report?.period?.label ? `الفترة المعروضة: ${report.period.label}` : "تعذر تحميل الملخص المالي";
  if (report?.current) {
    $("pendingDepositsTotal").textContent = Number(report.current.pendingDepositsCount || 0).toLocaleString("en-US");
    $("pendingWithdrawalsTotal").textContent = Number(report.current.pendingWithdrawalsCount || 0).toLocaleString("en-US");
  }
  const rows = orders.map(order => {
    const row = document.createElement("tr");
    const values = [
      order.serviceTitle || `#${order.id.slice(0, 8)}`,
      order.buyerName || "-",
      order.freelancerName || "-",
      `${Number(order.total || 0).toLocaleString("en-US")} ل.س`,
      `${Number(order.platformFeeAmount || 0).toLocaleString("en-US")} ل.س`,
      `${Number(order.freelancerAmount || 0).toLocaleString("en-US")} ل.س`,
      orderLabels[order.status] || order.status || "-"
    ];
    values.forEach(value => { const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell); });
    return row;
  });
  $("financeOrdersTable").replaceChildren(...rows);
  $("financeEmpty").hidden = rows.length > 0;
}

function ticketMessage(reply) {
  const item = document.createElement("article");
  item.className = `ticket-admin-message ${reply.authorRole === "admin" ? "admin" : ""}`;
  const title = document.createElement("strong");
  title.textContent = reply.authorName || (reply.authorRole === "admin" ? "فريق الدعم" : "المستخدم");
  const copy = document.createElement("p");
  copy.textContent = reply.text;
  const time = document.createElement("small");
  time.textContent = formatDate(reply.createdAt);
  item.append(title, copy, time);
  return item;
}

async function openTicket(id) {
  const ticket = state.tickets.find(item => item.id === id);
  if (!ticket) return;
  state.selectedTicket = ticket;
  const snapshot = await getDocs(query(collection(db, "supportTickets", id, "replies"), orderBy("createdAt", "desc"), limit(100)));
  state.replies = sortNewest(snapshot.docs.map(item => ({ id: item.id, ...item.data() })), "createdAt").reverse();
  $("ticketAdminTitle").textContent = ticket.subject;
  $("ticketAdminMeta").textContent = `${ticket.requesterName || ticket.requesterEmail} · ${categoryLabels[ticket.category] || ticket.category} · #${ticket.id.slice(0, 8)}`;
  $("ticketAdminStatus").value = ticket.status;
  $("ticketAdminPriority").value = ticket.priority || "normal";
  $("ticketAdminReply").value = "";
  const initial = { authorRole: "user", authorName: ticket.requesterName, text: ticket.message, createdAt: ticket.createdAt };
  $("ticketAdminThread").replaceChildren(ticketMessage(initial), ...state.replies.map(ticketMessage));
  $("ticketAdminModal").classList.add("open");
  $("ticketAdminModal").setAttribute("aria-hidden", "false");
}

function closeTicket() {
  $("ticketAdminModal").classList.remove("open");
  $("ticketAdminModal").setAttribute("aria-hidden", "true");
  state.selectedTicket = null;
}

async function saveTicket(event) {
  event.preventDefault();
  if (!hasPermission("support.reply")) return toast("لديك صلاحية الاطلاع فقط ولا يمكنك تعديل التذكرة.");
  const ticket = state.selectedTicket;
  if (!ticket) return;
  const status = $("ticketAdminStatus").value;
  const priority = $("ticketAdminPriority").value;
  const reply = $("ticketAdminReply").value.trim();
  const batch = writeBatch(db);
  batch.update(doc(db, "supportTickets", ticket.id), {
    status, priority, assignedAdminUid: state.admin.id, updatedAt: serverTimestamp()
  });
  if (reply) {
    batch.set(doc(collection(db, "supportTickets", ticket.id, "replies")), {
      authorUid: state.admin.id, authorRole: "admin", authorName: state.admin.name || "فريق الدعم",
      text: reply, createdAt: serverTimestamp()
    });
  }
  if (ticket.requesterUid) {
    batch.set(doc(collection(db, "notifications", ticket.requesterUid, "items")), notificationData(
      reply ? "رد جديد من فريق الدعم" : "تم تحديث حالة تذكرتك",
      reply || `أصبحت حالة تذكرتك: ${ticketLabels[status]}`,
      "support.html",
      "support_update"
    ));
  }
  batch.set(doc(collection(db, "adminAuditLogs")), auditData(reply ? "reply_ticket" : "update_ticket", ticket, `${status}${reply ? `: ${reply.slice(0, 300)}` : ""}`));
  await batch.commit();
  if (reply && ticket.requesterEmail) {
    await sendOfficialEmail({
      purpose: "support_reply",
      to: ticket.requesterEmail,
      subject: `رد على تذكرتك: ${ticket.subject || "دعم PikLance"}`,
      message: `مرحباً ${ticket.requesterName || ""}\n\n${reply}\n\nحالة التذكرة: ${ticketLabels[status] || status}\nرقم التذكرة: #${ticket.id.slice(0, 8)}\n\nفريق دعم PikLance`,
      actionUrl: "https://piklance.com/support.html",
      actionLabel: "فتح مركز الدعم"
    }).catch(error => {
      console.warn("Unable to send support reply email", error);
      toast("تم حفظ الرد، لكن تعذر إرسال البريد الرسمي حالياً.");
    });
  }
  closeTicket();
  toast("تم حفظ التحديث وإشعار المستخدم.");
  await loadOperations();
}

function contentItem(title, meta, onToggle, toggleLabel, onDelete, onEdit = null) {
  const item = document.createElement("article");
  item.className = "content-list-item";
  const copy = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = meta;
  copy.append(strong, small);
  const actions = document.createElement("div");
  actions.className = "table-actions";
  if (hasPermission("content.manage")) {
    if (onEdit) actions.append(actionButton("تعديل", "table-button", onEdit));
    actions.append(actionButton(toggleLabel, "table-button", onToggle), actionButton("حذف", "table-button reject", onDelete));
  }
  item.append(copy, actions);
  return item;
}

function renderContent() {
  $("articlesCount").textContent = state.articleTotal || state.articles.length;
  $("faqsCount").textContent = state.faqs.length;
  $("categoriesCount").textContent = state.categories.length;
  const articleItems = state.articles.map(article => {
    if (article.status !== "trash") {
      return contentItem(
        article.title,
        `${article.category || "عام"} · ${article.status === "published" ? "منشور" : "مسودة"}${article.featured ? " · مميز" : ""}`,
        () => toggleArticleStatus(article),
        article.status === "published" ? "إلغاء النشر" : "نشر",
        () => removeArticle(article),
        () => editArticle(article)
      );
    }
    const item = contentItem(article.title, `${article.category || "عام"} · في المحذوفات`, () => {}, "", () => {});
    const actions = item.querySelector(".table-actions");
    actions?.replaceChildren(
      actionButton("استعادة", "table-button", () => restoreArticle(article)),
      actionButton("حذف نهائي", "table-button reject", () => permanentlyRemoveArticle(article))
    );
    return item;
  });
  if (!articleItems.length) {
    const empty = document.createElement("div");
    empty.className = "admin-list-empty";
    empty.textContent = "لا توجد مقالات في هذه الصفحة.";
    articleItems.push(empty);
  }
  $("articlesList").replaceChildren(...articleItems);
  $("articlesLoadMore").hidden = !state.articleHasMore;
  $("articlesLoadMore").disabled = state.articleLoading;
  $("faqsList").replaceChildren(...state.faqs.map(item => contentItem(
    item.question, `${item.categoryLabel || faqSectionLabels[item.category] || item.category || "أسئلة عامة"} · ${item.published ? "منشور" : "مخفي"}`,
    () => toggleContent("faqItems", item, "published", !item.published, "manage_faq"),
    item.published ? "إخفاء" : "نشر",
    () => removeContent("faqItems", item, "manage_faq")
  )));
  $("categoriesList").replaceChildren(...state.categories.map(item => contentItem(
    item.name, item.active ? "نشط" : "متوقف",
    () => toggleContent("serviceCategories", item, "active", !item.active, "manage_category"),
    item.active ? "إيقاف" : "تفعيل",
    () => removeContent("serviceCategories", item, "manage_category")
  )));
}

async function toggleArticleStatus(article) {
  if (!hasPermission("content.manage")) return toast("لديك صلاحية الاطلاع فقط.");
  const status = article.status === "published" ? "draft" : "published";
  await callArticleFunction("updateArticleStatus", { articleId: article.id, status, operationId: operationId("article-status") });
  toast(status === "published" ? "تم نشر المقال." : "تم تحويل المقال إلى مسودة.");
  await loadArticlesPage(true);
}

async function toggleContent(collectionName, item, field, value, action) {
  if (!hasPermission("content.manage")) return toast("لديك صلاحية الاطلاع فقط.");
  await updateDoc(doc(db, collectionName, item.id), { [field]: value, updatedAt: serverTimestamp(), updatedBy: state.admin.id });
  await addDoc(collection(db, "adminAuditLogs"), auditData(action, item, `${field}: ${value}`));
  toast("تم تحديث حالة المحتوى.");
  await loadOperations();
}

async function removeContent(collectionName, item, action) {
  openAdminConfirm({
    title: "حذف عنصر محتوى",
    message: `هل تريد حذف "${item.title || item.question || item.name}" نهائياً؟`,
    actionLabel: "حذف العنصر",
    onConfirm: () => removeContentConfirmed(collectionName, item, action)
  });
}

async function removeContentConfirmed(collectionName, item, action) {
  const batch = writeBatch(db);
  batch.delete(doc(db, collectionName, item.id));
  batch.set(doc(collection(db, "adminAuditLogs")), auditData(action, item, "delete"));
  await batch.commit();
  toast("تم حذف العنصر.");
  await loadOperations();
}

async function removeArticle(article) {
  openAdminConfirm({
    title: "نقل المقال إلى المحذوفات",
    message: `سيختفي "${article.title}" من المنصة ويمكن استعادته لاحقاً قبل الحذف النهائي.`,
    actionLabel: "نقل إلى المحذوفات",
    onConfirm: () => removeArticleConfirmed(article)
  });
}

async function removeArticleConfirmed(article) {
  await callArticleFunction("archiveArticle", { articleId: article.id, operationId: operationId("article-archive") });
  if ($("articleId").value === article.id) resetArticleForm();
  toast("تم نقل المقال إلى المحذوفات.");
  await loadArticlesPage(true);
}

async function restoreArticle(article) {
  await callArticleFunction("restoreArticle", { articleId: article.id, operationId: operationId("article-restore") });
  toast("تمت استعادة المقال كمسودة.");
  await loadArticlesPage(true);
}

function permanentlyRemoveArticle(article) {
  openAdminConfirm({
    title: "حذف المقال نهائياً",
    message: `سيتم حذف "${article.title}" مع التعليقات والإعجابات والصور ولن يمكن استعادته.`,
    actionLabel: "حذف نهائي",
    onConfirm: async () => {
      await callArticleFunction("deleteArticlePermanently", { articleId: article.id, operationId: operationId("article-delete") });
      toast("تم حذف المقال وملفاته نهائياً.");
      await loadArticlesPage(true);
    }
  });
}

function updateCoverPreview(url = "") {
  const preview = $("articleCoverPreview");
  preview.style.backgroundImage = url ? `url("${url.replace(/"/g, "%22")}")` : "";
  preview.classList.toggle("has-image", Boolean(url));
}

function resetArticleForm() {
  $("articleForm").reset();
  $("articleId").value = "";
  state.articleOperationId = "";
  $("articleFormTitle").textContent = "مقال جديد";
  $("articleSubmitButton").textContent = "حفظ المقال";
  $("articleCancelEdit").hidden = true;
  $("articleAuthor").value = state.admin?.name || state.admin?.email || "فريق PikLance";
  updateCoverPreview();
}

async function editArticle(article) {
  if (state.articleSaving) return;
  let body = article.body || "";
  try {
    const bodySnapshot = await getDoc(doc(db, "articleBodies", article.id));
    if (bodySnapshot.exists()) body = bodySnapshot.data().body || body;
  } catch (error) {
    console.error("Unable to load article body", error);
    toast("تعذر تحميل محتوى المقال للتعديل.");
    return;
  }
  $("articleId").value = article.id;
  $("articleTitle").value = article.title || "";
  $("articleCategory").value = article.category || "";
  $("articleAuthor").value = article.authorName || "";
  $("articleStatus").value = article.status || "draft";
  $("articleTags").value = Array.isArray(article.tags) ? article.tags.join("، ") : "";
  $("articleCoverUrl").value = article.coverUrl || "";
  $("articleExcerpt").value = article.excerpt || "";
  $("articleBody").value = body;
  $("articleFeatured").checked = Boolean(article.featured);
  $("articleCoverFile").value = "";
  $("articleFormTitle").textContent = "تعديل المقال";
  $("articleSubmitButton").textContent = "حفظ التعديلات";
  $("articleCancelEdit").hidden = false;
  updateCoverPreview(article.coverUrl || "");
  $("articleForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadArticleCover(articleId, file) {
  if (!file) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error("cover_too_large");
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `article-covers/${articleId}/cover-${Date.now()}.${extension}`;
  const target = storageRef(storage, path);
  await uploadBytes(target, file, { contentType: file.type });
  return { url: await getDownloadURL(target), path };
}

async function saveArticle(event) {
  event.preventDefault();
  if (!hasPermission("content.manage")) return toast("لا تملك صلاحية تعديل المحتوى.");
  if (state.articleSaving) return;
  state.articleSaving = true;
  const submitButton = $("articleSubmitButton");
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "جاري الحفظ...";
  let existingId = $("articleId").value;
  if (!existingId) {
    existingId = doc(collection(db, "articles")).id;
    $("articleId").value = existingId;
  }
  const existing = state.articles.find(article => article.id === existingId);
  const status = $("articleStatus").value;
  const title = $("articleTitle").value.trim();
  const file = $("articleCoverFile").files[0];
  const enteredCoverUrl = $("articleCoverUrl").value.trim();
  let coverUrl = enteredCoverUrl || existing?.coverUrl || "";
  let coverPath = existing?.coverPath || "";
  if (enteredCoverUrl && enteredCoverUrl !== existing?.coverUrl) coverPath = "";
  try {
    if (file) {
      const uploaded = await uploadArticleCover(existingId, file);
      coverUrl = uploaded.url;
      coverPath = uploaded.path;
    }
    const tags = $("articleTags").value.split(/[،,]/).map(tag => tag.trim()).filter(Boolean).slice(0, 12);
    state.articleOperationId ||= operationId("article-save");
    const result = await callArticleFunction("saveArticle", {
      articleId: existingId,
      operationId: state.articleOperationId,
      title,
      category: $("articleCategory").value.trim() || "عام",
      tags,
      coverUrl,
      coverPath,
      excerpt: $("articleExcerpt").value.trim(),
      body: $("articleBody").value.trim(),
      status,
      featured: $("articleFeatured").checked,
      authorName: $("articleAuthor").value.trim() || state.admin.name || state.admin.email
    });
    resetArticleForm();
    toast(result.created ? "تم حفظ المقال." : "تم تحديث المقال.");
    await loadArticlesPage(true);
  } catch (error) {
    if (error.message === "cover_too_large") toast("حجم صورة الغلاف يجب ألا يتجاوز 5 ميغابايت.");
    else throw error;
  } finally {
    state.articleSaving = false;
    submitButton.disabled = false;
    if ($("articleId").value) submitButton.textContent = originalLabel;
  }
}

async function addFaq(event) {
  event.preventDefault();
  if (!hasPermission("content.manage")) return toast("لا تملك صلاحية تعديل المحتوى.");
  const category = $("faqCategory").value || "general";
  await addDoc(collection(db, "faqItems"), {
    question: $("faqQuestion").value.trim(), answer: $("faqAnswer").value.trim(),
    category, categoryLabel: faqSectionLabels[category] || "أسئلة عامة", published: $("faqPublished").checked,
    order: Date.now(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: state.admin.id
  });
  await addDoc(collection(db, "adminAuditLogs"), auditData("manage_faq", {}, "create"));
  event.currentTarget.reset();
  $("faqPublished").checked = true;
  toast("تمت إضافة السؤال الشائع.");
  await loadOperations();
}

async function addCategory(event) {
  event.preventDefault();
  if (!hasPermission("content.manage")) return toast("لا تملك صلاحية تعديل المحتوى.");
  const name = $("categoryName").value.trim();
  await addDoc(collection(db, "serviceCategories"), {
    name, slug: name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\u0600-\u06ff\w-]/g, ""),
    description: $("categoryDescription").value.trim(), active: $("categoryActive").checked,
    order: Date.now(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: state.admin.id
  });
  await addDoc(collection(db, "adminAuditLogs"), auditData("manage_category", { title: name }, "create"));
  event.currentTarget.reset();
  $("categoryActive").checked = true;
  toast("تمت إضافة التصنيف.");
  await loadOperations();
}

async function loadArticlesPage(reset = false) {
  if (!(hasPermission("content.view") || hasPermission("content.manage")) || state.articleLoading) return;
  state.articleLoading = true;
  if (reset) {
    state.articles = [];
    state.articleCursor = null;
    state.articleHasMore = false;
  }
  $("articlesLoadMore").disabled = true;
  $("articlesLoadMore").textContent = "جاري التحميل...";
  try {
    const constraints = [orderBy("updatedAt", "desc"), limit(ADMIN_PAGE_SIZE + 1)];
    if (state.articleCursor) constraints.splice(1, 0, startAfter(state.articleCursor));
    const pageQuery = query(collection(db, "articles"), ...constraints);
    const requests = [getDocs(pageQuery)];
    if (reset) requests.push(getCountFromServer(collection(db, "articles")));
    const [snapshot, total] = await Promise.all(requests);
    const visibleDocs = snapshot.docs.slice(0, ADMIN_PAGE_SIZE);
    const page = visibleDocs.map(item => ({ id: item.id, ...item.data() }));
    state.articles = reset ? page : [...state.articles, ...page];
    state.articleCursor = visibleDocs.at(-1) || state.articleCursor;
    state.articleHasMore = snapshot.docs.length > ADMIN_PAGE_SIZE;
    if (total) state.articleTotal = total.data().count;
  } catch (error) {
    console.error("Unable to load article page", error);
    toast("تعذر تحميل صفحة المقالات. حاول مرة أخرى.");
  } finally {
    state.articleLoading = false;
    $("articlesLoadMore").disabled = false;
    $("articlesLoadMore").textContent = "تحميل المزيد";
    renderContent();
  }
}

async function safeSnapshot(label, request) {
  try {
    return await request;
  } catch (error) {
    console.error(`Unable to load ${label}`, error);
    toast(`تعذر تحميل قسم ${label}، بينما ستبقى بقية الأقسام متاحة.`);
    return { docs: [] };
  }
}

async function loadOperationCounts() {
  const requests = {};
  if (hasPermission("services.view") || hasPermission("services.moderate")) {
    requests.pendingServices = getCountFromServer(query(collection(db, "services"), where("status", "==", "pending")));
  }
  if (hasPermission("support.view") || hasPermission("support.reply")) {
    requests.activeTickets = getCountFromServer(query(collection(db, "supportTickets"), where("status", "in", ["open", "in_progress", "waiting_user"])));
  }
  if (hasPermission("finance.view")) {
    requests.financeOrders = getCountFromServer(query(collection(db, "orders"), where("status", "in", ["funded", "active", "delivered", "disputed"])));
  }
  if (hasPermission("content.view") || hasPermission("content.manage")) {
    requests.draftArticles = getCountFromServer(query(collection(db, "articles"), where("status", "==", "draft")));
  }
  const values = await Promise.all(Object.entries(requests).map(async ([key, request]) => {
    try { return [key, (await request).data().count]; }
    catch (error) { console.warn(`Unable to load operation count ${key}`, error); return [key, null]; }
  }));
  state.counts = Object.fromEntries(values.filter(([, value]) => value != null));
  renderAdminNotifications();
}

async function loadFinanceMetrics() {
  if (!hasPermission("finance.view")) return;
  try {
    const result = await httpsCallable(functions, "getFinancialReport")(financeReportRequest());
    state.financeMetrics = result.data;
  } catch (error) {
    console.warn("Unable to load finance aggregates", error);
    state.financeMetrics = null;
    toast("تعذر تحميل التقرير المالي. تأكد من نشر الدالة والفهارس الجديدة.");
  }
}

function bindAsyncForm(id, handler, errorMessage) {
  $(id).addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    const button = form.querySelector('button[type="submit"]');
    form.dataset.submitting = "true";
    if (button) button.disabled = true;
    try {
      await handler(event);
    } catch (error) {
      console.error(`Unable to submit ${id}`, error);
      toast(errorMessage);
    } finally {
      delete form.dataset.submitting;
      if (button) button.disabled = false;
    }
  });
}

async function loadOperations(section = document.querySelector(".nav-link.active")?.dataset.section || "all") {
  const empty = { docs: [] };
  const wants = name => section === "all" || section === name;
  const [services, tickets, orders, faqs, categories] = await Promise.all([
    wants("marketplace") && (hasPermission("services.view") || hasPermission("services.moderate")) ? safeSnapshot("الخدمات", getDocs(query(collection(db, "services"), orderBy("updatedAt", "desc"), limit(50)))) : empty,
    wants("support") && (hasPermission("support.view") || hasPermission("support.reply")) ? safeSnapshot("الدعم", getDocs(query(collection(db, "supportTickets"), orderBy("updatedAt", "desc"), limit(50)))) : empty,
    wants("finance") && hasPermission("finance.view") ? safeSnapshot("الطلبات", getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(50)))) : empty,
    wants("content") && (hasPermission("content.view") || hasPermission("content.manage")) ? safeSnapshot("الأسئلة الشائعة", getDocs(query(collection(db, "faqItems"), orderBy("order"), limit(50)))) : empty,
    wants("content") && (hasPermission("content.view") || hasPermission("content.manage")) ? safeSnapshot("التصنيفات", getDocs(query(collection(db, "serviceCategories"), orderBy("order"), limit(50)))) : empty
  ]);
  if (wants("marketplace")) { state.services = sortNewest(services.docs.map(item => ({ id: item.id, ...item.data() }))); renderServices(); }
  if (wants("support")) { state.tickets = sortNewest(tickets.docs.map(item => ({ id: item.id, ...item.data() }))); renderTickets(); }
  if (wants("finance")) {
    state.orders = sortNewest(orders.docs.map(item => ({ id: item.id, ...item.data() })));
    await loadFinanceMetrics();
    renderFinance();
  }
  if (wants("content")) {
    if (hasPermission("content.manage")) {
      await callArticleFunction("migrateArticlesForScale", {}).catch(error => console.warn("Unable to migrate legacy articles", error));
    }
    state.faqs = faqs.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    state.categories = categories.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    await loadArticlesPage(true);
    renderContent();
  }
  await loadOperationCounts();
  applyAdminAccess();
}

["marketplace", "finance", "support", "content"].forEach(section => document.querySelector(`.nav-link[data-section="${section}"] i`)?.remove());
$("serviceAdminSearch").addEventListener("input", renderServices);
$("serviceAdminFilter").addEventListener("change", renderServices);
$("ticketAdminSearch").addEventListener("input", renderTickets);
$("ticketAdminFilter").addEventListener("change", renderTickets);
$("financeSearch").addEventListener("input", renderFinance);
$("financeFilter").addEventListener("change", renderFinance);
$("financePeriodMode").addEventListener("change", updateFinancePeriodControls);
$("financeReportForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("financeReportSubmit");
  button.disabled = true;
  try {
    await loadFinanceMetrics();
    renderFinance();
  } finally {
    button.disabled = false;
  }
});
initializeFinancePeriod();
bindAsyncForm("ticketAdminForm", saveTicket, "تعذر حفظ تحديث التذكرة.");
document.querySelectorAll("[data-close-ticket-admin]").forEach(control => control.addEventListener("click", closeTicket));
$("ticketAdminModal").addEventListener("click", event => { if (event.target === $("ticketAdminModal")) closeTicket(); });
document.querySelectorAll("[data-close-service-preview]").forEach(control => control.addEventListener("click", closeServicePreview));
$("servicePreviewModal").addEventListener("click", event => { if (event.target === $("servicePreviewModal")) closeServicePreview(); });
$("serviceReviewForm").addEventListener("submit", handleServiceReviewSubmit);
document.querySelectorAll("[data-close-service-review]").forEach(control => control.addEventListener("click", closeServiceReviewModal));
$("serviceReviewModal").addEventListener("click", event => { if (event.target === $("serviceReviewModal")) closeServiceReviewModal(); });
$("adminConfirmAction").addEventListener("click", runAdminConfirmAction);
document.querySelectorAll("[data-close-admin-confirm]").forEach(control => control.addEventListener("click", closeAdminConfirm));
$("adminConfirmModal").addEventListener("click", event => { if (event.target === $("adminConfirmModal")) closeAdminConfirm(); });
$("articleForm").addEventListener("submit", event => {
  saveArticle(event).catch(error => {
    console.error("Unable to save article", error);
    toast("تعذر حفظ المقال. تحقق من البيانات وصورة الغلاف.");
  });
});
$("articleCancelEdit").addEventListener("click", resetArticleForm);
$("articlesLoadMore").addEventListener("click", () => loadArticlesPage(false));
$("articleCoverUrl").addEventListener("input", event => updateCoverPreview(event.target.value.trim()));
$("articleCoverFile").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) updateCoverPreview(URL.createObjectURL(file));
});
bindAsyncForm("faqForm", addFaq, "تعذر إضافة السؤال الشائع.");
bindAsyncForm("categoryForm", addCategory, "تعذر إضافة التصنيف.");
$("adminNotificationsButton").addEventListener("click", () => toggleAdminNotifications());
$("adminNotificationsClose").addEventListener("click", () => toggleAdminNotifications(false));
document.addEventListener("click", event => {
  const panel = $("adminNotificationsPanel");
  const button = $("adminNotificationsButton");
  if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) {
    toggleAdminNotifications(false);
  }
});
window.addEventListener("admin:verification-count", event => {
  state.verificationCount = Number(event.detail?.count || 0);
  renderAdminNotifications();
});
window.addEventListener("admin:section-change", event => {
  if (!["marketplace", "finance", "support", "content"].includes(event.detail?.section) || !state.admin || state.loadedSections.has(event.detail.section)) return;
  loadOperations(event.detail.section).then(() => { state.loadedSections.add(event.detail.section); }).catch(error => {
    console.error("Unable to lazy-load operation modules", error);
  });
});
window.addEventListener("admin:refresh", event => {
  if (!["marketplace", "finance", "support", "content"].includes(event.detail?.section) || !state.admin) return;
  loadOperations(event.detail.section).then(() => { state.loadedSections.add(event.detail.section); }).catch(error => {
    console.error("Unable to refresh operation modules", error);
  });
});

onAuthStateChanged(auth, async user => {
  if (!user) return;
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists() || snapshot.data().role !== "admin") return;
    state.admin = { id: user.uid, email: user.email, ...snapshot.data() };
    await initializeAdminAccess(state.admin);
    if (!hasPermission("content.manage")) ["articleForm", "faqForm", "categoryForm"].forEach(id => { if ($(id)) $(id).hidden = true; });
    if (!hasPermission("support.reply")) {
      ["ticketAdminStatus", "ticketAdminPriority", "ticketAdminReply"].forEach(id => { if ($(id)) $(id).disabled = true; });
      $("ticketAdminForm")?.querySelector('button[type="submit"]')?.setAttribute("hidden", "");
    }
    resetArticleForm();
    await loadOperationCounts();
    const activeSection = document.querySelector(".nav-link.active")?.dataset.section;
    if (["marketplace", "finance", "support", "content"].includes(activeSection)) {
      await loadOperations(activeSection);
      state.loadedSections.add(activeSection);
    }
  } catch (error) {
    console.error("Unable to load operation modules", error);
    toast("تعذر تحميل بيانات الخدمات أو الدعم أو المحتوى.");
  }
});
