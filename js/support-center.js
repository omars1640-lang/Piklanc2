import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { auth, db, functions } from "./firebase.js";

const state = { user: null, profile: null, tickets: [], selectedId: null, replies: [] };
const $ = id => document.getElementById(id);
const statusLabels = { open: "مفتوحة", in_progress: "قيد المعالجة", waiting_user: "بانتظار ردك", resolved: "محلولة", closed: "مغلقة" };
const categoryLabels = { technical: "مشكلة تقنية", account: "الحساب والتوثيق", payment: "الدفع والفواتير", dispute: "نزاع", report: "بلاغ", general: "استفسار عام" };
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const formatDate = value => toDate(value)?.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) || "-";
const escapeHtml = value => String(value || "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
}[character]));

function toast(message) {
  $("supportToast").textContent = message;
  $("supportToast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("supportToast").classList.remove("show"), 2800);
}
function openModal() { $("ticketModal").classList.add("open"); $("ticketModal").setAttribute("aria-hidden", "false"); }
function closeModal() {
  $("ticketModal").classList.remove("open");
  $("ticketModal").setAttribute("aria-hidden", "true");
  document.querySelector(".ticket-form").reset();
  $("orderIdWrap").hidden = true;
  syncGuestFields();
}
function sortNewest(items, field = "updatedAt") { return items.sort((a, b) => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0)); }

function renderStats() {
  $("allTicketsCount").textContent = state.tickets.length;
  $("activeTicketsCount").textContent = state.tickets.filter(ticket => ["open", "in_progress"].includes(ticket.status)).length;
  $("waitingTicketsCount").textContent = state.tickets.filter(ticket => ticket.status === "waiting_user").length;
  $("resolvedTicketsCount").textContent = state.tickets.filter(ticket => ["resolved", "closed"].includes(ticket.status)).length;
}

function renderTickets() {
  const filter = $("ticketFilter").value;
  const tickets = state.tickets.filter(ticket => filter === "all" || ticket.status === filter);
  const controls = tickets.map(ticket => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ticket-item ${state.selectedId === ticket.id ? "active" : ""}`;
    button.innerHTML = `<header><strong>${escapeHtml(ticket.subject)}</strong><span class="status">${escapeHtml(statusLabels[ticket.status] || ticket.status)}</span></header><p>${escapeHtml(categoryLabels[ticket.category] || ticket.category)}${ticket.orderId ? ` · طلب ${escapeHtml(ticket.orderId)}` : ""}</p><small>${formatDate(ticket.updatedAt)}</small>`;
    button.addEventListener("click", () => selectTicket(ticket.id));
    return button;
  });
  if (!controls.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.innerHTML = "<span>?</span><strong>لا توجد تذاكر مطابقة</strong>";
    controls.push(empty);
  }
  $("ticketsList").replaceChildren(...controls);
}

function messageNode(reply) {
  const item = document.createElement("article");
  const mine = state.user && reply.authorUid === state.user.uid;
  item.className = `message ${mine ? "mine" : ""} ${reply.authorRole === "admin" ? "admin" : ""}`;
  item.innerHTML = `<strong>${escapeHtml(reply.authorName || (reply.authorRole === "admin" ? "فريق الدعم" : "أنت"))}</strong><p></p><time>${formatDate(reply.createdAt)}</time>`;
  item.querySelector("p").textContent = reply.text;
  return item;
}

function renderDetail() {
  const ticket = state.tickets.find(item => item.id === state.selectedId);
  if (!ticket) return;
  $("ticketDetail").innerHTML = `
    <div class="detail-head"><small>${escapeHtml(categoryLabels[ticket.category] || ticket.category)}</small><h2>${escapeHtml(ticket.subject)}</h2><div class="detail-meta"><span class="status">${escapeHtml(statusLabels[ticket.status] || ticket.status)}</span><span>#${ticket.id.slice(0, 8)}</span><span>${formatDate(ticket.createdAt)}</span></div></div>
    <div class="conversation" id="ticketConversation"></div>
    <form class="reply-form" id="replyForm"><textarea id="replyText" rows="2" maxlength="2000" required placeholder="اكتب ردك أو أضف معلومات جديدة..."></textarea><button class="primary-button" type="submit">إرسال</button></form>`;
  const initial = { authorUid: ticket.requesterUid, authorRole: "user", authorName: ticket.requesterName, text: ticket.message, createdAt: ticket.createdAt };
  $("ticketConversation").replaceChildren(messageNode(initial), ...state.replies.map(messageNode));
  $("ticketConversation").scrollTop = $("ticketConversation").scrollHeight;
  $("replyForm").addEventListener("submit", sendReply);
  if (["resolved", "closed"].includes(ticket.status)) {
    $("replyText").disabled = true;
    $("replyText").placeholder = "هذه التذكرة مغلقة.";
    $("replyForm").querySelector("button").disabled = true;
  }
}

async function selectTicket(id) {
  state.selectedId = id;
  const snapshot = await getDocs(collection(db, "supportTickets", id, "replies"));
  state.replies = sortNewest(snapshot.docs.map(item => ({ id: item.id, ...item.data() })), "createdAt").reverse();
  renderTickets();
  renderDetail();
}

async function sendReply(event) {
  event.preventDefault();
  if (!state.user) {
    toast("الرد على التذكرة يتطلب تسجيل الدخول. فريق الدعم سيتواصل معك عبر بياناتك.");
    return;
  }
  const text = $("replyText").value.trim();
  if (!text) return;
  await addDoc(collection(db, "supportTickets", state.selectedId, "replies"), {
    authorUid: state.user.uid,
    authorRole: "user",
    authorName: state.profile.name || state.user.email,
    text,
    createdAt: serverTimestamp()
  });
  $("replyText").value = "";
  await selectTicket(state.selectedId);
  toast("تم إرسال ردك إلى فريق الدعم.");
}

async function createTicket(event) {
  event.preventDefault();
  const category = $("ticketCategory").value;
  const guestName = $("guestName").value.trim();
  const guestEmail = $("guestEmail").value.trim().toLowerCase();
  if (!state.user && (!guestName || !guestEmail)) {
    toast("اكتب الاسم والبريد الإلكتروني ليتمكن الدعم من التواصل معك.");
    return;
  }
  const result = await httpsCallable(functions, "createSupportTicket")({
    requesterName: guestName,
    requesterEmail: guestEmail,
    requesterPhone: $("guestPhone").value.trim(),
    subject: $("ticketSubject").value.trim(),
    category,
    message: $("ticketMessage").value.trim(),
    orderId: category === "dispute" ? $("ticketOrderId").value.trim() : ""
  });
  closeModal();
  if (state.user) {
    await loadTickets();
    await selectTicket(result.data.ticketId);
  }
  toast(state.user ? "تم إنشاء التذكرة بنجاح." : "تم إرسال تذكرتك. سيتواصل الدعم معك عبر البريد أو الهاتف.");
}

async function loadTickets() {
  if (!state.user) return;
  const snapshot = await getDocs(query(collection(db, "supportTickets"), where("requesterUid", "==", state.user.uid)));
  state.tickets = sortNewest(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  renderStats();
  renderTickets();
}

function syncGuestFields() {
  const guest = !state.user;
  $("guestFields").hidden = !guest;
  $("guestName").required = guest;
  $("guestEmail").required = guest;
}

$("newTicketButton").addEventListener("click", openModal);
document.querySelectorAll("[data-close-ticket]").forEach(button => button.addEventListener("click", closeModal));
$("ticketModal").addEventListener("click", event => { if (event.target === $("ticketModal")) closeModal(); });
$("ticketCategory").addEventListener("change", event => { $("orderIdWrap").hidden = event.target.value !== "dispute"; });
$("ticketFilter").addEventListener("change", renderTickets);
document.querySelector(".ticket-form").addEventListener("submit", createTicket);
syncGuestFields();

onAuthStateChanged(auth, async user => {
  state.user = user;
  syncGuestFields();
  if (!user) { state.tickets = []; renderStats(); renderTickets(); return; }
  const snapshot = await getDoc(doc(db, "users", user.uid));
  state.profile = snapshot.exists() ? snapshot.data() : {};
  await loadTickets();
});
