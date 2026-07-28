import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { getDownloadURL, ref as storageRef } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth, db, functions, storage } from "./firebase.js";
import { hasPermission, initializeAdminAccess } from "./admin-access.js";
import { appendUnique, ensureLoadMoreButton, updateLoadMoreButton } from "./pagination-ui.js";

const PAYMENT_PAGE_SIZE = 30;
const state = {
  deposits: [], withdrawals: [], selected: null, kind: "",
  pages: {
    deposits: { cursor: null, hasMore: false, loading: false },
    withdrawals: { cursor: null, hasMore: false, loading: false }
  }
};
let stopDeposits = null;
let stopWithdrawals = null;
const $ = id => document.getElementById(id);
const money = value => `${Number(value || 0).toLocaleString("en-US")} ل.س`;
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const labels = { pending: "بانتظار المراجعة", approved: "مقبول", rejected: "مرفوض", processing: "قيد التحويل", paid: "تم التحويل" };

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `table-button ${className}`;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function cellRow(values) {
  const row = document.createElement("tr");
  values.forEach(value => {
    const cell = document.createElement("td");
    if (value instanceof Node) cell.appendChild(value); else cell.textContent = value;
    row.appendChild(cell);
  });
  return row;
}

function render() {
  const depositRows = state.deposits.map(item => {
    const actions = document.createElement("div");
    actions.className = "table-actions";
    actions.append(actionButton("فتح", "", () => openReview("deposit", item)));
    return cellRow([item.reference || item.id, item.userName || item.userEmail || "-", money(item.amount), item.transferReference || "-", labels[item.status] || item.status, toDate(item.createdAt)?.toLocaleString("en-US") || "-", actions]);
  });
  $("depositRequestsTable").replaceChildren(...depositRows);
  $("depositRequestsEmpty").hidden = depositRows.length > 0;
  const withdrawalRows = state.withdrawals.map(item => {
    const actions = document.createElement("div");
    actions.className = "table-actions";
    actions.append(actionButton("فتح", "", () => openReview("withdrawal", item)));
    return cellRow([item.reference || item.id, item.userName || item.userEmail || "-", money(item.amount), item.payout?.walletNumber || "-", labels[item.status] || item.status, toDate(item.createdAt)?.toLocaleString("en-US") || "-", actions]);
  });
  $("withdrawalRequestsTable").replaceChildren(...withdrawalRows);
  $("withdrawalRequestsEmpty").hidden = withdrawalRows.length > 0;
  const pending = state.deposits.filter(item => item.status === "pending").length + state.withdrawals.filter(item => ["pending", "processing"].includes(item.status)).length;
  $("financeBadge").textContent = pending;
  $("financeBadge").hidden = pending === 0;
  $("pendingDepositsTotal").textContent = state.deposits.filter(item => item.status === "pending").length;
  $("pendingWithdrawalsTotal").textContent = state.withdrawals.filter(item => ["pending", "processing"].includes(item.status)).length;
}

function sortNewest(items) {
  return items.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}

function paymentLoadMoreButton(kind) {
  const tableId = kind === "deposits" ? "depositRequestsTable" : "withdrawalRequestsTable";
  return ensureLoadMoreButton({
    anchor: $(tableId)?.closest(".table-wrap"),
    id: `${tableId}LoadMore`,
    onClick: () => loadMorePayments(kind)
  });
}

async function loadMorePayments(kind) {
  const page = state.pages[kind];
  if (page.loading || !page.hasMore || !page.cursor) return;
  page.loading = true;
  const button = paymentLoadMoreButton(kind);
  updateLoadMoreButton(button, { hasMore: true, loading: true });
  const collectionName = kind === "deposits" ? "depositRequests" : "withdrawalRequests";
  try {
    const snapshot = await getDocs(query(
      collection(db, collectionName),
      orderBy("createdAt", "desc"),
      startAfter(page.cursor),
      limit(PAYMENT_PAGE_SIZE + 1)
    ));
    const visibleDocs = snapshot.docs.slice(0, PAYMENT_PAGE_SIZE);
    const additions = visibleDocs.map(item => ({ id: item.id, ...item.data() }));
    state[kind] = sortNewest(appendUnique(state[kind], additions));
    page.cursor = visibleDocs.at(-1) || page.cursor;
    page.hasMore = snapshot.docs.length > PAYMENT_PAGE_SIZE;
    render();
  } catch (error) {
    console.error(`Unable to load more ${kind}`, error);
  } finally {
    page.loading = false;
    updateLoadMoreButton(button, { hasMore: page.hasMore, loading: false });
  }
}

function listenForPaymentRequests() {
  stopDeposits?.();
  stopWithdrawals?.();
  stopDeposits = onSnapshot(query(collection(db, "depositRequests"), orderBy("createdAt", "desc"), limit(PAYMENT_PAGE_SIZE + 1)), snapshot => {
    const visibleDocs = snapshot.docs.slice(0, PAYMENT_PAGE_SIZE);
    state.deposits = sortNewest(appendUnique(visibleDocs.map(item => ({ id: item.id, ...item.data() })), state.deposits));
    if (!state.pages.deposits.cursor) {
      state.pages.deposits.cursor = visibleDocs.at(-1) || null;
      state.pages.deposits.hasMore = snapshot.docs.length > PAYMENT_PAGE_SIZE;
    }
    updateLoadMoreButton(paymentLoadMoreButton("deposits"), { hasMore: state.pages.deposits.hasMore });
    render();
  }, error => console.error("Unable to listen for deposit requests", error));
  stopWithdrawals = onSnapshot(query(collection(db, "withdrawalRequests"), orderBy("createdAt", "desc"), limit(PAYMENT_PAGE_SIZE + 1)), snapshot => {
    const visibleDocs = snapshot.docs.slice(0, PAYMENT_PAGE_SIZE);
    state.withdrawals = sortNewest(appendUnique(visibleDocs.map(item => ({ id: item.id, ...item.data() })), state.withdrawals));
    if (!state.pages.withdrawals.cursor) {
      state.pages.withdrawals.cursor = visibleDocs.at(-1) || null;
      state.pages.withdrawals.hasMore = snapshot.docs.length > PAYMENT_PAGE_SIZE;
    }
    updateLoadMoreButton(paymentLoadMoreButton("withdrawals"), { hasMore: state.pages.withdrawals.hasMore });
    render();
  }, error => console.error("Unable to listen for withdrawal requests", error));
}

async function openReview(kind, item) {
  state.kind = kind;
  state.selected = item;
  $("paymentReviewTitle").textContent = kind === "deposit" ? "مراجعة شحن الرصيد" : "مراجعة طلب السحب";
  $("paymentReviewReference").textContent = item.reference || item.id;
  $("paymentReviewUser").textContent = item.userName || item.userEmail || "-";
  $("paymentReviewAmount").textContent = money(item.amount);
  $("paymentReviewDetails").textContent = kind === "deposit"
    ? `رقم حوالة شام كاش: ${item.transferReference || "-"}`
    : `الاسم: ${item.payout?.holderName || "-"} · المحفظة: ${item.payout?.walletNumber || "-"}`;
  $("paymentReviewReason").value = "";
  const path = kind === "deposit" ? item.receiptPath : item.payout?.qrPath;
  const image = $("paymentReviewImage");
  image.hidden = true;
  if (path) {
    const url = await getDownloadURL(storageRef(storage, path)).catch(() => "");
    if (url) { image.src = url; image.hidden = false; }
  }
  $("paymentApproveButton").textContent = kind === "deposit" ? "موافقة وإضافة الرصيد" : item.status === "processing" ? "تأكيد التحويل" : "بدء التحويل";
  $("paymentRejectButton").hidden = !["pending", "processing"].includes(item.status);
  $("paymentApproveButton").hidden = kind === "deposit" ? item.status !== "pending" : !["pending", "processing"].includes(item.status);
  if (!hasPermission("finance.manage")) {
    $("paymentRejectButton").hidden = true;
    $("paymentApproveButton").hidden = true;
    $("paymentReviewReason").disabled = true;
  }
  $("paymentReviewModal").classList.add("open");
}

function closeReview() {
  $("paymentReviewModal").classList.remove("open");
  state.selected = null;
}

async function runDecision(decision) {
  if (!state.selected) return;
  const reason = $("paymentReviewReason").value.trim();
  if (decision === "reject" && reason.length < 3) {
    $("paymentReviewMessage").textContent = "اكتب سبب الرفض ليصل إلى المستخدم.";
    return;
  }
  $("paymentReviewMessage").textContent = "جاري تنفيذ القرار...";
  try {
    if (state.kind === "deposit") {
      await httpsCallable(functions, "reviewDepositRequest")({ requestId: state.selected.id, decision, reason });
    } else {
      const action = decision === "reject" ? "reject" : state.selected.status === "processing" ? "paid" : "processing";
      await httpsCallable(functions, "reviewWithdrawalRequest")({ requestId: state.selected.id, action, reason });
    }
    closeReview();
  } catch (error) {
    console.error("Payment review failed", error);
    $("paymentReviewMessage").textContent = error.message || "تعذر تنفيذ القرار.";
  }
}

$("paymentApproveButton")?.addEventListener("click", () => runDecision("approve"));
$("paymentRejectButton")?.addEventListener("click", () => runDecision("reject"));
document.querySelectorAll("[data-close-payment-review]").forEach(button => button.addEventListener("click", closeReview));

onAuthStateChanged(auth, async user => {
  if (!user) {
    stopDeposits?.();
    stopWithdrawals?.();
    return;
  }
  const profile = await getDoc(doc(db, "users", user.uid));
  if (profile.exists() && profile.data().role === "admin") {
    await initializeAdminAccess({ id: user.uid, email: user.email, ...profile.data() });
    if (hasPermission("finance.view")) listenForPaymentRequests();
  }
});
