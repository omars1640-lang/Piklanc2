import {
  EmailAuthProvider, reauthenticateWithCredential, signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { auth, functions } from "./firebase.js";

const $ = id => document.getElementById(id);

function setModalOpen(open) {
  const modal = $("accountDeletionModal");
  if (!modal) return;
  modal.classList.toggle("open", open);
  modal.setAttribute("aria-hidden", String(!open));
  document.body.style.overflow = open ? "hidden" : "";
  if (open) setTimeout(() => $("deleteAccountConfirmation")?.focus(), 50);
}

function readableError(error) {
  if (["auth/invalid-credential", "auth/wrong-password"].includes(error.code)) return "كلمة المرور غير صحيحة.";
  if (error.code === "auth/too-many-requests") return "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.";
  const message = String(error.message || "").replace(/^Firebase:\s*/i, "").replace(/\s*\([^)]*\)\.?$/, "").trim();
  return message || "تعذر حذف الحساب حالياً. حاول مجدداً أو تواصل مع الدعم.";
}

function clearAccountCache() {
  ["piklanceHeaderProfile", "myServices", "piklanceAccessCode"].forEach(key => localStorage.removeItem(key));
}

export function initializeAccountDeletion(user, toast = () => {}) {
  const openButton = $("deleteAccountButton");
  const form = $("accountDeletionForm");
  if (!openButton || !form || !user?.email || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  const confirmation = $("deleteAccountConfirmation");
  const password = $("deleteAccountPassword");
  const submit = $("deleteAccountSubmit");
  const message = $("deleteAccountMessage");

  function updateSubmitState() {
    submit.disabled = confirmation.value.trim().toLowerCase() !== user.email.toLowerCase() || !password.value;
  }

  function close() {
    if (submit.dataset.running === "true") return;
    form.reset();
    message.textContent = "";
    updateSubmitState();
    setModalOpen(false);
  }

  openButton.addEventListener("click", () => {
    $("deleteAccountEmailHint").textContent = user.email;
    setModalOpen(true);
    updateSubmitState();
  });
  document.querySelectorAll("[data-close-account-deletion]").forEach(control => control.addEventListener("click", close));
  confirmation.addEventListener("input", updateSubmitState);
  password.addEventListener("input", updateSubmitState);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("accountDeletionModal").classList.contains("open")) close();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    updateSubmitState();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.dataset.running = "true";
    submit.textContent = "جاري الحذف النهائي...";
    message.textContent = "قد تستغرق إزالة البيانات والملفات عدة لحظات. لا تغلق الصفحة.";
    try {
      const credential = EmailAuthProvider.credential(user.email, password.value);
      await reauthenticateWithCredential(user, credential);
      await user.getIdToken(true);
      const deleteAccount = httpsCallable(functions, "deleteOwnAccount", { timeout: 540000 });
      await deleteAccount({ confirmationEmail: confirmation.value.trim() });
      clearAccountCache();
      await signOut(auth).catch(() => {});
      location.replace("index.html?accountDeleted=1");
    } catch (error) {
      console.error("Account deletion failed", error);
      message.textContent = readableError(error);
      toast(message.textContent);
      submit.dataset.running = "false";
      submit.textContent = "حذف الحساب نهائياً";
      updateSubmitState();
    }
  });
}
