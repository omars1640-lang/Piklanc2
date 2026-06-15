import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs,
  serverTimestamp, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getDownloadURL, ref as storageRef, uploadBytes
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";

const state = { admin: null, services: [], tickets: [], articles: [], faqs: [], categories: [], selectedTicket: null, replies: [] };
const $ = id => document.getElementById(id);
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const sortNewest = (items, field = "updatedAt") => items.sort((a, b) => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0));
const formatDate = value => toDate(value)?.toLocaleDateString("ar-SY", { year: "numeric", month: "short", day: "numeric" }) || "-";
const serviceLabels = { draft: "مسودة", pending: "قيد المراجعة", published: "منشورة", paused: "متوقفة", rejected: "مرفوضة" };
const ticketLabels = { open: "مفتوحة", in_progress: "قيد المعالجة", waiting_user: "بانتظار المستخدم", resolved: "محلولة", closed: "مغلقة" };
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
    if (service.status === "pending") {
      actions.append(
        actionButton("نشر", "table-button approve", () => reviewService(service.id, true)),
        actionButton("رفض", "table-button reject", () => reviewService(service.id, false))
      );
    }
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
  batch.set(doc(collection(db, "notifications", ticket.requesterUid, "items")), notificationData(
    reply ? "رد جديد من فريق الدعم" : "تم تحديث حالة تذكرتك",
    reply || `أصبحت حالة تذكرتك: ${ticketLabels[status]}`,
    "support.html",
    "support_update"
  ));
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
  const [services, tickets, articles, faqs, categories] = await Promise.all([
    getDocs(collection(db, "services")),
    getDocs(collection(db, "supportTickets")),
    getDocs(collection(db, "articles")),
    getDocs(collection(db, "faqItems")),
    getDocs(collection(db, "serviceCategories"))
  ]);
  state.services = sortNewest(services.docs.map(item => ({ id: item.id, ...item.data() })));
  state.tickets = sortNewest(tickets.docs.map(item => ({ id: item.id, ...item.data() })));
  state.articles = sortNewest(articles.docs.map(item => ({ id: item.id, ...item.data() })));
  state.faqs = faqs.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  state.categories = categories.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  renderServices();
  renderTickets();
  renderContent();
}

["marketplace", "support", "content"].forEach(section => document.querySelector(`.nav-link[data-section="${section}"] i`)?.remove());
$("serviceAdminSearch").addEventListener("input", renderServices);
$("serviceAdminFilter").addEventListener("change", renderServices);
$("ticketAdminSearch").addEventListener("input", renderTickets);
$("ticketAdminFilter").addEventListener("change", renderTickets);
$("ticketAdminForm").addEventListener("submit", saveTicket);
document.querySelectorAll("[data-close-ticket-admin]").forEach(control => control.addEventListener("click", closeTicket));
$("ticketAdminModal").addEventListener("click", event => { if (event.target === $("ticketAdminModal")) closeTicket(); });
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
