import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { getDownloadURL, ref as storageRef, uploadBytes } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { db, functions, storage } from "./firebase.js";

const state = { user: null, profile: null, wallet: {}, payout: {}, withdrawals: [], toast: () => {} };
const $ = id => document.getElementById(id);
const money = value => `${Number(value || 0).toLocaleString("en-US")} ل.س`;
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const labels = { pending: "بانتظار المراجعة", processing: "قيد التحويل", paid: "تم التحويل", rejected: "مرفوض" };

function render() {
  $("freelancerAvailableWallet").textContent = money(state.wallet.available);
  $("freelancerPendingWithdrawal").textContent = money(state.wallet.pendingWithdrawal);
  $("freelancerLifetimeEarnings").textContent = money(state.wallet.lifetimeEarnings);
  $("withdrawAvailableHint").textContent = `الرصيد المتاح حالياً: ${money(state.wallet.available)}`;
  $("withdrawHolderName").value = state.payout.holderName || state.profile.name || "";
  $("withdrawWalletNumber").value = state.payout.walletNumber || "";
  const preview = $("withdrawQrPreview");
  if (state.payout.qrUrl) {
    preview.src = state.payout.qrUrl;
    preview.hidden = false;
  } else preview.hidden = true;

  const rows = state.withdrawals.map(item => {
    const row = document.createElement("article");
    row.className = "finance-transaction-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `سحب ${money(item.amount)} عبر شام كاش`;
    const meta = document.createElement("small");
    meta.textContent = `${item.reference || "-"} · ${toDate(item.createdAt)?.toLocaleString("en-US") || "الآن"}`;
    copy.append(title, meta);
    const status = document.createElement("span");
    status.className = `finance-status ${item.status || "pending"}`;
    status.textContent = labels[item.status] || item.status;
    row.append(copy, status);
    return row;
  });
  $("withdrawalHistory").replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement("p"), { className: "finance-empty", textContent: "لا توجد طلبات سحب حتى الآن." })]));
}

async function refresh() {
  const [walletSnapshot, payoutSnapshot, requestsSnapshot] = await Promise.all([
    getDoc(doc(db, "wallets", state.user.uid)),
    getDoc(doc(db, "payoutMethods", state.user.uid, "items", "sham_cash")),
    getDocs(query(collection(db, "withdrawalRequests"), where("userUid", "==", state.user.uid)))
  ]);
  state.wallet = walletSnapshot.exists() ? walletSnapshot.data() : { available: 0, pendingWithdrawal: 0, lifetimeEarnings: 0 };
  state.payout = payoutSnapshot.exists() ? payoutSnapshot.data() : {};
  if (state.payout.qrPath) state.payout.qrUrl = await getDownloadURL(storageRef(storage, state.payout.qrPath)).catch(() => "");
  state.withdrawals = requestsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  render();
}

async function submit(event) {
  event.preventDefault();
  const amount = Number($("withdrawAmount").value);
  const holderName = $("withdrawHolderName").value.trim();
  const walletNumber = $("withdrawWalletNumber").value.trim();
  const qrFile = $("withdrawQrFile").files?.[0];
  const message = $("withdrawMessage");
  if (!Number.isInteger(amount) || amount < 1 || amount > 50) {
    message.textContent = "المبلغ يجب أن يكون بين 1 و50 ل.س بدون كسور.";
    return;
  }
  if (amount > Number(state.wallet.available || 0)) {
    message.textContent = "الرصيد المتاح غير كافٍ لهذا الطلب.";
    return;
  }
  if (holderName.length < 5 || walletNumber.length < 8) {
    message.textContent = "أدخل الاسم الثلاثي ورقم محفظة شام كاش.";
    return;
  }
  if (!state.payout.qrPath && !qrFile) {
    message.textContent = "ارفع صورة QR الخاصة بمحفظتك.";
    return;
  }
  if (qrFile && (!/^image\/(jpeg|png|webp)$/.test(qrFile.type) || qrFile.size > 5 * 1024 * 1024)) {
    message.textContent = "صورة QR يجب أن تكون JPG أو PNG أو WebP وأقل من 5MB.";
    return;
  }
  const button = $("withdrawButton");
  button.disabled = true;
  message.textContent = "جاري إرسال طلب السحب...";
  try {
    let qrPath = state.payout.qrPath || "";
    if (qrFile) {
      const extension = qrFile.type === "image/png" ? "png" : qrFile.type === "image/webp" ? "webp" : "jpg";
      qrPath = `payout-qr/${state.user.uid}/sham_cash/qr.${extension}`;
      await uploadBytes(storageRef(storage, qrPath), qrFile, { contentType: qrFile.type });
    }
    const call = httpsCallable(functions, "requestWithdrawal");
    const result = await call({ amount, providerId: "sham_cash", holderName, walletNumber, qrPath });
    $("withdrawAmount").value = "";
    $("withdrawQrFile").value = "";
    message.textContent = "";
    state.toast(`تم إرسال طلب السحب ${result.data.reference}. تتم المراجعة خلال 24–48 ساعة.`);
    await refresh();
  } catch (error) {
    console.error("Withdrawal request failed", error);
    message.textContent = error.message || "تعذر إرسال طلب السحب.";
  } finally {
    button.disabled = false;
  }
}

export async function initializeWithdrawals(user, profile, toast) {
  state.user = user;
  state.profile = profile;
  state.toast = toast || (() => {});
  $("withdrawForm")?.addEventListener("submit", submit);
  $("withdrawQrFile")?.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (!file) return;
    $("withdrawQrPreview").src = URL.createObjectURL(file);
    $("withdrawQrPreview").hidden = false;
  });
  await refresh();
}
