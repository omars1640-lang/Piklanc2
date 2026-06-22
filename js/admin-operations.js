import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs,
  serverTimestamp, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";

const state = { admin: null, services: [], tickets: [], orders: [], articles: [], faqs: [], categories: [], selectedTicket: null, replies: [], verificationCount: 0 };
const $ = id => document.getElementById(id);
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const sortNewest = (items, field = "updatedAt") => items.sort((a, b) => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0));
const formatDate = value => toDate(value)?.toLocaleDateString("ar-SY", { year: "numeric", month: "short", day: "numeric" }) || "-";
const serviceLabels = { draft: "مسودة", pending: "قيد المراجعة", published: "منشورة", paused: "متوقفة", rejected: "مرفوضة" };
const ticketLabels = { open: "مفتوحة", in_progress: "قيد المعالجة", waiting_user: "بانتظار المستخدم", resolved: "محلولة", closed: "مغلقة" };
const orderLabels = { funded: "محجوز", active: "قيد التنفيذ", delivered: "قيد المراجعة", completed: "محرر", disputed: "نزاع", cancelled: "ملغي" };
const categoryLabels = { technical: "تقنية", account: "الحساب", payment: "الدفع", dispute: "نزاع", report: "بلاغ", general: "عام" };

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

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
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

  updateNavBadge("verifications", state.verificationCount);
  updateNavBadge("marketplace", pendingServices.length);
  updateNavBadge("finance", financeOrders.length);
  updateNavBadge("support", activeTickets.length);
  updateNavBadge("content", draftArticles.length);

  return [
    state.verificationCount ? adminNotification("✓", "طلبات توثيق معلقة", `${state.verificationCount} طلب حساب يحتاج مراجعة بيانات المستخدم قبل الموافقة.`, "verifications", state.verificationCount) : null,
    pendingServices.length ? adminNotification("▦", "خدمات بانتظار المراجعة", `${pendingServices.length} خدمة تحتاج عرض التفاصيل قبل النشر أو الرفض.`, "marketplace", pendingServices.length) : null,
    financeOrders.length ? adminNotification("◈", "مدفوعات وطلبات تحتاج متابعة", `${financeOrders.length} طلب مرتبط بالحجز أو التسليم أو النزاع.`, "finance", financeOrders.length) : null,
    activeTickets.length ? adminNotification("?", "تذاكر دعم نشطة", `${activeTickets.length} تذكرة مفتوحة أو قيد المعالجة.`, "support", activeTickets.length) : null,
    disputes.length ? adminNotification("⚖", "نزاعات مفتوحة", `${disputes.length} نزاع يحتاج قرار أو متابعة من الإدارة.`, "support", disputes.length) : null,
    draftArticles.length ? adminNotification("▤", "محتوى غير منشور", `${draftArticles.length} مقال ما زال كمسودة.`, "content", draftArticles.length) : null
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
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = service.title || "صورة الخدمة";
    image.loading = "lazy";
    imageWrap.appendChild(image);
  } else {
    imageWrap.innerHTML = "<span>لا توجد صورة مرفقة لهذه الخدمة</span>";
  }

  const summary = document.createElement("div");
  summary.className = "service-preview-summary";
  summary.append(
    serviceDetail("المستقل", service.ownerName || "-"),
    serviceDetail("الحالة", serviceLabels[service.status] || service.status || "-"),
    serviceDetail("السعر", `${Number(service.price || 0).toLocaleString("ar-SY")} ل.س`),
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
  if (service.status === "pending") {
    actions.append(
      actionButton("رفض الخدمة", "danger-button", async () => {
        closeServicePreview();
        await reviewService(service.id, false);
      }),
      actionButton("نشر الخدمة", "primary-button", async () => {
        closeServicePreview();
        await reviewService(service.id, true);
      })
    );
  }
  actions.appendChild(actionButton("حذف الخدمة", "danger-button", () => deleteServiceAdmin(service)));

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
    if (service.status === "pending") {
      actions.append(
        actionButton("نشر", "table-button approve", () => reviewService(service.id, true)),
        actionButton("رفض", "table-button reject", () => reviewService(service.id, false))
      );
    }
    actions.append(actionButton("حذف", "table-button reject", () => deleteServiceAdmin(service)));
    [service.title || "خدمة", service.ownerName || "-", `${Number(service.price || 0).toLocaleString("ar-SY")} ل.س`, serviceLabels[service.status] || service.status, formatDate(service.updatedAt), actions].forEach(value => {
      const cell = document.createElement("td");
      cell.append(value instanceof Node ? value : document.createTextNode(value));
      row.appendChild(cell);
    });
    return row;
  });
  $("adminServicesTable").replaceChildren(...rows);
  $("adminServicesEmpty").hidden = rows.length > 0;
}

async function reviewService(id, approved) {
  const service = state.services.find(item => item.id === id);
  if (!service) return;
  const reason = approved ? "" : prompt("اكتب سبب رفض الخدمة ليصل إلى المستقل:")?.trim();
  if (!approved && !reason) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "services", id), {
    status: approved ? "published" : "rejected",
    moderationReason: reason || "",
    reviewedAt: serverTimestamp(),
    reviewedBy: state.admin.id,
    updatedAt: serverTimestamp()
  });
  batch.set(doc(collection(db, "notifications", service.ownerUid, "items")), notificationData(
    approved ? "تم نشر خدمتك" : "تحتاج خدمتك إلى تعديل",
    approved ? `تمت الموافقة على خدمة: ${service.title}` : `تم رفض خدمة ${service.title}: ${reason}`,
    "freelancer-dashboard.html#projects",
    approved ? "service_approved" : "service_rejected"
  ));
  batch.set(doc(collection(db, "adminAuditLogs")), auditData(approved ? "approve_service" : "reject_service", service, reason || ""));
  await batch.commit();
  toast(approved ? "تم نشر الخدمة وإشعار المستقل." : "تم رفض الخدمة وإرسال السبب.");
  await loadOperations();
}

async function deleteServiceAdmin(service) {
  if (!confirm(`حذف خدمة «${service.title || "بدون عنوان"}» نهائياً؟`)) return;
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
  const held = state.orders.filter(order => ["funded", "active", "delivered", "disputed"].includes(order.status));
  const completed = state.orders.filter(order => order.status === "completed");
  $("financeOrdersTotal").textContent = state.orders.length;
  $("financeHeldTotal").textContent = `${held.reduce((sum, order) => sum + Number(order.total || 0), 0).toLocaleString("ar-SY")} ل.س`;
  $("financeFeeTotal").textContent = `${completed.reduce((sum, order) => sum + Number(order.platformFeeAmount || 0), 0).toLocaleString("ar-SY")} ل.س`;
  $("financeReleasedTotal").textContent = `${completed.reduce((sum, order) => sum + Number(order.freelancerAmount || 0), 0).toLocaleString("ar-SY")} ل.س`;
  const rows = orders.map(order => {
    const row = document.createElement("tr");
    const values = [
      order.serviceTitle || `#${order.id.slice(0, 8)}`,
      order.buyerName || "-",
      order.freelancerName || "-",
      `${Number(order.total || 0).toLocaleString("ar-SY")} ل.س`,
      `${Number(order.platformFeeAmount || 0).toLocaleString("ar-SY")} ل.س`,
      `${Number(order.freelancerAmount || 0).toLocaleString("ar-SY")} ل.س`,
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
  const snapshot = await getDocs(collection(db, "supportTickets", id, "replies"));
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
  if (onEdit) actions.append(actionButton("تعديل", "table-button", onEdit));
  actions.append(actionButton(toggleLabel, "table-button", onToggle), actionButton("حذف", "table-button reject", onDelete));
  item.append(copy, actions);
  return item;
}

function renderContent() {
  $("articlesCount").textContent = state.articles.length;
  $("faqsCount").textContent = state.faqs.length;
  $("categoriesCount").textContent = state.categories.length;
  $("articlesList").replaceChildren(...state.articles.map(article => contentItem(
    article.title, `${article.category || "عام"} · ${article.status === "published" ? "منشور" : "مسودة"}${article.featured ? " · مميز" : ""}`,
    () => toggleArticleStatus(article),
    article.status === "published" ? "إلغاء النشر" : "نشر",
    () => removeArticle(article),
    () => editArticle(article)
  )));
  $("faqsList").replaceChildren(...state.faqs.map(item => contentItem(
    item.question, `${item.category || "عام"} · ${item.published ? "منشور" : "مخفي"}`,
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
  const status = article.status === "published" ? "draft" : "published";
  const updates = {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: state.admin.id
  };
  if (status === "published" && !article.publishedAt) updates.publishedAt = serverTimestamp();
  await updateDoc(doc(db, "articles", article.id), updates);
  await addDoc(collection(db, "adminAuditLogs"), auditData("update_article", article, `status: ${status}`));
  toast(status === "published" ? "تم نشر المقال." : "تم تحويل المقال إلى مسودة.");
  await loadOperations();
}

async function toggleContent(collectionName, item, field, value, action) {
  await updateDoc(doc(db, collectionName, item.id), { [field]: value, updatedAt: serverTimestamp(), updatedBy: state.admin.id });
  await addDoc(collection(db, "adminAuditLogs"), auditData(action, item, `${field}: ${value}`));
  toast("تم تحديث حالة المحتوى.");
  await loadOperations();
}

async function removeContent(collectionName, item, action) {
  if (!confirm(`حذف "${item.title || item.question || item.name}" نهائياً؟`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, collectionName, item.id));
  batch.set(doc(collection(db, "adminAuditLogs")), auditData(action, item, "delete"));
  await batch.commit();
  toast("تم حذف العنصر.");
  await loadOperations();
}

async function removeArticle(article) {
  if (!confirm(`حذف "${article.title}" وتعليقاته وإعجاباته نهائياً؟`)) return;
  const [likes, comments] = await Promise.all([
    getDocs(collection(db, "articles", article.id, "likes")),
    getDocs(collection(db, "articles", article.id, "comments"))
  ]);
  const references = [...likes.docs, ...comments.docs].map(item => item.ref);
  while (references.length) {
    const batch = writeBatch(db);
    references.splice(0, 400).forEach(reference => batch.delete(reference));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, "articles", article.id));
  batch.set(doc(collection(db, "adminAuditLogs")), auditData("delete_article", article, "delete"));
  await batch.commit();
  if ($("articleId").value === article.id) resetArticleForm();
  toast("تم حذف المقال وتفاعلاته.");
  await loadOperations();
}

function slugify(value) {
  return value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\u0600-\u06ff\w-]/g, "");
}

function updateCoverPreview(url = "") {
  const preview = $("articleCoverPreview");
  preview.style.backgroundImage = url ? `url("${url.replace(/"/g, "%22")}")` : "";
  preview.classList.toggle("has-image", Boolean(url));
}

function resetArticleForm() {
  $("articleForm").reset();
  $("articleId").value = "";
  $("articleFormTitle").textContent = "مقال جديد";
  $("articleSubmitButton").textContent = "حفظ المقال";
  $("articleCancelEdit").hidden = true;
  $("articleAuthor").value = state.admin?.name || state.admin?.email || "فريق PikLance";
  updateCoverPreview();
}

function editArticle(article) {
  $("articleId").value = article.id;
  $("articleTitle").value = article.title || "";
  $("articleCategory").value = article.category || "";
  $("articleAuthor").value = article.authorName || "";
  $("articleStatus").value = article.status || "draft";
  $("articleTags").value = Array.isArray(article.tags) ? article.tags.join("، ") : "";
  $("articleCoverUrl").value = article.coverUrl || "";
  $("articleExcerpt").value = article.excerpt || "";
  $("articleBody").value = article.body || "";
  $("articleFeatured").checked = Boolean(article.featured);
  $("articleCoverFile").value = "";
  $("articleFormTitle").textContent = "تعديل المقال";
  $("articleSubmitButton").textContent = "حفظ التعديلات";
  $("articleCancelEdit").hidden = false;
  updateCoverPreview(article.coverUrl || "");
  $("articleForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadArticleCover(articleId, file) {
  if (!file) return "";
  if (file.size > 5 * 1024 * 1024) throw new Error("cover_too_large");
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const target = storageRef(storage, `article-covers/${articleId}/cover-${Date.now()}.${extension}`);
  await uploadBytes(target, file, { contentType: file.type });
  return getDownloadURL(target);
}

async function saveArticle(event) {
  event.preventDefault();
  const existingId = $("articleId").value;
  const existing = state.articles.find(article => article.id === existingId);
  const articleRef = existingId ? doc(db, "articles", existingId) : doc(collection(db, "articles"));
  const status = $("articleStatus").value;
  const title = $("articleTitle").value.trim();
  const file = $("articleCoverFile").files[0];
  let coverUrl = $("articleCoverUrl").value.trim() || existing?.coverUrl || "";
  try {
    if (file) coverUrl = await uploadArticleCover(articleRef.id, file);
  } catch (error) {
    if (error.message === "cover_too_large") {
      toast("حجم صورة الغلاف يجب ألا يتجاوز 5 ميغابايت.");
      return;
    }
    throw error;
  }
  const tags = $("articleTags").value.split(/[،,]/).map(tag => tag.trim()).filter(Boolean).slice(0, 12);
  const data = {
    title,
    slug: slugify(title),
    category: $("articleCategory").value.trim() || "عام",
    tags,
    coverUrl,
    excerpt: $("articleExcerpt").value.trim(),
    body: $("articleBody").value.trim(),
    status,
    featured: $("articleFeatured").checked,
    authorUid: state.admin.id,
    authorName: $("articleAuthor").value.trim() || state.admin.name || state.admin.email,
    updatedAt: serverTimestamp(),
    updatedBy: state.admin.id,
    publishedAt: status === "published" ? (existing?.publishedAt || serverTimestamp()) : (existing?.publishedAt || null)
  };
  if (!existing) {
    data.createdAt = serverTimestamp();
    data.views = 0;
  }
  const batch = writeBatch(db);
  if (data.featured) {
    state.articles.filter(article => article.id !== articleRef.id && article.featured).forEach(article => {
      batch.update(doc(db, "articles", article.id), { featured: false, updatedAt: serverTimestamp(), updatedBy: state.admin.id });
    });
  }
  if (existing) batch.update(articleRef, data);
  else batch.set(articleRef, data);
  batch.set(doc(collection(db, "adminAuditLogs")), auditData(existing ? "update_article" : "create_article", { id: articleRef.id, title }, status));
  await batch.commit();
  resetArticleForm();
  toast(existing ? "تم تحديث المقال." : "تم حفظ المقال.");
  await loadOperations();
}

async function addFaq(event) {
  event.preventDefault();
  await addDoc(collection(db, "faqItems"), {
    question: $("faqQuestion").value.trim(), answer: $("faqAnswer").value.trim(),
    category: $("faqCategory").value.trim() || "عام", published: $("faqPublished").checked,
    order: state.faqs.length + 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: state.admin.id
  });
  await addDoc(collection(db, "adminAuditLogs"), auditData("manage_faq", {}, "create"));
  event.currentTarget.reset();
  $("faqPublished").checked = true;
  toast("تمت إضافة السؤال الشائع.");
  await loadOperations();
}

async function addCategory(event) {
  event.preventDefault();
  const name = $("categoryName").value.trim();
  await addDoc(collection(db, "serviceCategories"), {
    name, slug: name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\u0600-\u06ff\w-]/g, ""),
    description: $("categoryDescription").value.trim(), active: $("categoryActive").checked,
    order: state.categories.length + 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: state.admin.id
  });
  await addDoc(collection(db, "adminAuditLogs"), auditData("manage_category", { title: name }, "create"));
  event.currentTarget.reset();
  $("categoryActive").checked = true;
  toast("تمت إضافة التصنيف.");
  await loadOperations();
}

async function loadOperations() {
  const [services, tickets, orders, articles, faqs, categories] = await Promise.all([
    getDocs(collection(db, "services")),
    getDocs(collection(db, "supportTickets")),
    getDocs(collection(db, "orders")),
    getDocs(collection(db, "articles")),
    getDocs(collection(db, "faqItems")),
    getDocs(collection(db, "serviceCategories"))
  ]);
  state.services = sortNewest(services.docs.map(item => ({ id: item.id, ...item.data() })));
  state.tickets = sortNewest(tickets.docs.map(item => ({ id: item.id, ...item.data() })));
  state.orders = sortNewest(orders.docs.map(item => ({ id: item.id, ...item.data() })));
  state.articles = sortNewest(articles.docs.map(item => ({ id: item.id, ...item.data() })));
  state.faqs = faqs.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  state.categories = categories.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  renderServices();
  renderTickets();
  renderFinance();
  renderContent();
  renderAdminNotifications();
}

["marketplace", "finance", "support", "content"].forEach(section => document.querySelector(`.nav-link[data-section="${section}"] i`)?.remove());
$("serviceAdminSearch").addEventListener("input", renderServices);
$("serviceAdminFilter").addEventListener("change", renderServices);
$("ticketAdminSearch").addEventListener("input", renderTickets);
$("ticketAdminFilter").addEventListener("change", renderTickets);
$("financeSearch").addEventListener("input", renderFinance);
$("financeFilter").addEventListener("change", renderFinance);
$("ticketAdminForm").addEventListener("submit", saveTicket);
document.querySelectorAll("[data-close-ticket-admin]").forEach(control => control.addEventListener("click", closeTicket));
$("ticketAdminModal").addEventListener("click", event => { if (event.target === $("ticketAdminModal")) closeTicket(); });
document.querySelectorAll("[data-close-service-preview]").forEach(control => control.addEventListener("click", closeServicePreview));
$("servicePreviewModal").addEventListener("click", event => { if (event.target === $("servicePreviewModal")) closeServicePreview(); });
$("articleForm").addEventListener("submit", event => {
  saveArticle(event).catch(error => {
    console.error("Unable to save article", error);
    toast("تعذر حفظ المقال. تحقق من البيانات وصورة الغلاف.");
  });
});
$("articleCancelEdit").addEventListener("click", resetArticleForm);
$("articleCoverUrl").addEventListener("input", event => updateCoverPreview(event.target.value.trim()));
$("articleCoverFile").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) updateCoverPreview(URL.createObjectURL(file));
});
$("faqForm").addEventListener("submit", addFaq);
$("categoryForm").addEventListener("submit", addCategory);
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

onAuthStateChanged(auth, async user => {
  if (!user) return;
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists() || snapshot.data().role !== "admin") return;
    state.admin = { id: user.uid, email: user.email, ...snapshot.data() };
    resetArticleForm();
    await loadOperations();
  } catch (error) {
    console.error("Unable to load operation modules", error);
    toast("تعذر تحميل بيانات الخدمات أو الدعم أو المحتوى.");
  }
});
