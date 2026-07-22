import {
  collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { ref as storageRef, uploadBytes } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { db, functions, storage } from "./firebase.js";

const state = { user: null, deposits: [], wallet: {}, toast: () => {} };
const $ = id => document.getElementById(id);
const money = value => `${Number(value || 0).toLocaleString("en-US")} ل.س`;
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const statusLabels = { pending: "بانتظار المراجعة", approved: "تمت الموافقة", rejected: "مرفوض" };

function showDepositModal(open) {
  $("depositModal")?.classList.toggle("open", open);
  $("depositModal")?.setAttribute("aria-hidden", String(!open));
  document.body.style.overflow = open ? "hidden" : "";
  if (open) setTimeout(() => $("depositAmount")?.focus(), 50);
}

function renderWallet() {
  const wallet = state.wallet || {};
  $("buyerAvailableBalance").textContent = money(wallet.available);
  $("buyerHeldBalance").textContent = money(wallet.held);
  $("overviewWalletBalance").textContent = money(wallet.available);
  const rows = state.deposits.map(item => {
    const row = document.createElement("article");
    row.className = "wallet-history-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `شحن عبر شام كاش · ${money(item.amount)}`;
    const meta = document.createElement("small");
    meta.textContent = `${item.reference || "-"} · ${toDate(item.createdAt)?.toLocaleString("en-US") || "الآن"}`;
    copy.append(title, meta);
    const status = document.createElement("span");
    status.className = `wallet-status ${item.status || "pending"}`;
    status.textContent = statusLabels[item.status] || item.status;
    row.append(copy, status);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<span>◈</span><strong>لا توجد عمليات شحن</strong><p>ستظهر طلبات شراء الرصيد وحالات مراجعتها هنا.</p>";
    rows.push(empty);
  }
  $("depositHistory").replaceChildren(...rows);
}

async function refreshWallet() {
  if (!state.user) return;
  const [walletSnapshot, depositsSnapshot] = await Promise.all([
    getDoc(doc(db, "wallets", state.user.uid)),
    getDocs(query(collection(db, "depositRequests"), where("userUid", "==", state.user.uid)))
  ]);
  state.wallet = walletSnapshot.exists() ? walletSnapshot.data() : { available: 0, held: 0 };
  state.deposits = depositsSnapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  renderWallet();
}

function extensionFor(file) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[file.type] || "jpg";
}

async function submitDeposit(event) {
  event.preventDefault();
  const amount = Number($("depositAmount").value);
  const transferReference = $("depositTransferReference").value.trim();
  const receipt = $("depositReceipt").files?.[0];
  const message = $("depositMessage");
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    message.textContent = "المبلغ يجب أن يكون بين 1 و100 ل.س بدون كسور.";
    return;
  }
  if (transferReference.length < 4) {
    message.textContent = "أدخل رقم حوالة شام كاش الظاهر بعد التحويل.";
    return;
  }
  if (!receipt || !/^image\/(jpeg|png|webp)$/.test(receipt.type) || receipt.size > 5 * 1024 * 1024) {
    message.textContent = "ارفع إيصال JPG أو PNG أو WebP بحجم لا يتجاوز 5MB.";
    return;
  }
  const button = $("depositSubmit");
  button.disabled = true;
  message.textContent = "جاري رفع الإيصال وإرسال الطلب...";
  try {
    const requestId = doc(collection(db, "depositRequests")).id;
    const path = `payment-receipts/${state.user.uid}/${requestId}/receipt.${extensionFor(receipt)}`;
    await uploadBytes(storageRef(storage, path), receipt, { contentType: receipt.type });
    const call = httpsCallable(functions, "submitDepositRequest");
    const result = await call({ requestId, amount, providerId: "sham_cash", transferReference, receiptPath: path });
    $("depositForm").reset();
    showDepositModal(false);
    state.toast(`تم إرسال طلب الشحن ${result.data.reference}. ستتم المراجعة خلال 2–6 ساعات ضمن أوقات العمل.`);
    await refreshWallet();
  } catch (error) {
    console.error("Deposit request failed", error);
    message.textContent = error.message || "تعذر إرسال الطلب حالياً.";
  } finally {
    button.disabled = false;
  }
}

export async function initializeBuyerWallet(user, toast) {
  state.user = user;
  state.toast = toast || (() => {});
  $("depositForm")?.addEventListener("submit", submitDeposit);
  document.querySelectorAll("[data-open-deposit]").forEach(button => button.addEventListener("click", () => showDepositModal(true)));
  document.querySelectorAll("[data-close-deposit]").forEach(button => button.addEventListener("click", () => showDepositModal(false)));
  $("depositModal")?.addEventListener("click", event => { if (event.target === $("depositModal")) showDepositModal(false); });
  await refreshWallet();
}

export { refreshWallet };
