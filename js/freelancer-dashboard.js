import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const specialtyLabels = {
  design: "تصميم",
  web: "برمجة وتطوير",
  writing: "كتابة وترجمة",
  marketing: "تسويق رقمي"
};

const state = {
  user: null,
  profile: null,
  services: readLocalServices()
};

const elements = {
  loadingScreen: document.getElementById("loadingScreen"),
  sidebar: document.getElementById("sidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  mobileMenuButton: document.getElementById("mobileMenuButton"),
  serviceModal: document.getElementById("serviceModal"),
  serviceForm: document.getElementById("serviceForm"),
  servicesTable: document.getElementById("servicesTable"),
  servicesEmpty: document.getElementById("servicesEmpty"),
  overviewServices: document.getElementById("overviewServices"),
  overviewServicesEmpty: document.getElementById("overviewServicesEmpty"),
  serviceSearch: document.getElementById("serviceSearch"),
  profileForm: document.getElementById("profileForm"),
  profileMessage: document.getElementById("profileMessage"),
  toast: document.getElementById("toast")
};

function readLocalServices() {
  try {
    const value = JSON.parse(localStorage.getItem("myServices") || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveLocalServices() {
  localStorage.setItem("myServices", JSON.stringify(state.services));
}

function initials(name, email = "") {
  return (name || email || "م").trim().charAt(0).toUpperCase();
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("ar-SY");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  document.getElementById("themeButton").textContent = theme === "dark" ? "☀" : "☾";
  document.getElementById("darkModeSwitch").checked = theme === "dark";
}

function openSidebar() {
  elements.sidebar.classList.add("open");
  elements.sidebarOverlay.classList.add("open");
  elements.mobileMenuButton.setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  elements.sidebar.classList.remove("open");
  elements.sidebarOverlay.classList.remove("open");
  elements.mobileMenuButton.setAttribute("aria-expanded", "false");
}

function showSection(sectionName) {
  document.querySelectorAll(".dashboard-section").forEach(section => section.classList.remove("active"));
  document.querySelectorAll(".side-link[data-section]").forEach(link => link.classList.remove("active"));
  document.getElementById(`section-${sectionName}`)?.classList.add("active");
  document.querySelector(`.side-link[data-section="${sectionName}"]`)?.classList.add("active");
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openServiceModal() {
  elements.serviceModal.classList.add("open");
  elements.serviceModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => document.getElementById("serviceTitle").focus(), 50);
}

function closeServiceModal() {
  elements.serviceModal.classList.remove("open");
  elements.serviceModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  elements.serviceForm.reset();
}

function serviceRow(service, index) {
  const row = document.createElement("tr");
  const serviceCell = document.createElement("td");
  const serviceInfo = document.createElement("div");
  serviceInfo.className = "table-service";
  const title = document.createElement("strong");
  title.textContent = service.title || "خدمة بدون عنوان";
  const category = document.createElement("small");
  category.textContent = service.category || "غير مصنفة";
  serviceInfo.append(title, category);
  serviceCell.appendChild(serviceInfo);
  row.appendChild(serviceCell);

  [formatMoney(service.price) + " ل.س", `${service.delivery || 2} أيام`].forEach(value => {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);
  });

  const statusCell = document.createElement("td");
  const status = document.createElement("span");
  status.className = "status-pill warning";
  status.textContent = "مسودة محلية";
  statusCell.appendChild(status);
  row.appendChild(statusCell);

  const actionCell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "table-actions";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "table-button danger";
  remove.textContent = "حذف";
  remove.addEventListener("click", () => deleteService(index));
  actions.appendChild(remove);
  actionCell.appendChild(actions);
  row.appendChild(actionCell);
  return row;
}

function overviewServiceCard(service) {
  const row = document.createElement("div");
  row.className = "project-row";
  const titleWrap = document.createElement("div");
  titleWrap.className = "project-title";
  const thumb = document.createElement("span");
  thumb.className = "project-thumb";
  thumb.textContent = (service.category || "خ").charAt(0);
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = service.title || "خدمة بدون عنوان";
  const details = document.createElement("small");
  details.textContent = `${service.category || "غير مصنفة"} · ${formatMoney(service.price)} ل.س`;
  copy.append(title, details);
  titleWrap.append(thumb, copy);

  const delivery = document.createElement("div");
  delivery.className = "project-meta";
  const deliveryValue = document.createElement("strong");
  deliveryValue.textContent = `${service.delivery || 2} أيام`;
  const deliveryLabel = document.createElement("small");
  deliveryLabel.textContent = "مدة التسليم";
  delivery.append(deliveryValue, deliveryLabel);

  const status = document.createElement("span");
  status.className = "status-pill warning";
  status.textContent = "مسودة";
  row.append(titleWrap, delivery, status);
  return row;
}

function renderServices() {
  const query = (elements.serviceSearch?.value || "").trim().toLowerCase();
  const filtered = state.services
    .map((service, index) => ({ service, index }))
    .filter(({ service }) => !query || [service.title, service.category, service.description]
      .some(value => String(value || "").toLowerCase().includes(query)));

  elements.servicesTable.replaceChildren(...filtered.map(({ service, index }) => serviceRow(service, index)));
  elements.servicesEmpty.hidden = filtered.length > 0;

  const recent = state.services.slice(-3).reverse();
  elements.overviewServices.replaceChildren(...recent.map(overviewServiceCard));
  elements.overviewServicesEmpty.hidden = recent.length > 0;

  document.getElementById("servicesCount").textContent = state.services.length;
  document.getElementById("draftServicesCount").textContent = state.services.length;
  document.getElementById("servicesNavCount").textContent = state.services.length;
}

function deleteService(index) {
  if (!window.confirm("هل تريد حذف هذه المسودة؟")) return;
  state.services.splice(index, 1);
  saveLocalServices();
  renderServices();
  showToast("تم حذف مسودة الخدمة.");
}

function handleServiceSubmit(event) {
  event.preventDefault();
  state.services.push({
    title: document.getElementById("serviceTitle").value.trim(),
    category: document.getElementById("serviceCategory").value,
    price: Number(document.getElementById("servicePrice").value),
    description: document.getElementById("serviceDescription").value.trim(),
    delivery: document.getElementById("serviceDelivery").value,
    revisions: document.getElementById("serviceRevisions").value,
    keywords: document.getElementById("serviceKeywords").value.trim(),
    status: "draft",
    date: new Date().toISOString()
  });
  saveLocalServices();
  renderServices();
  closeServiceModal();
  showToast("تم حفظ الخدمة كمسودة محلية على هذا الجهاز.");
}

function fillProfile(user, profile) {
  const name = profile.name || user.email || "مستقل PikLance";
  const firstName = name.trim().split(/\s+/)[0];
  const avatarText = initials(name, user.email);
  ["topName", "sidebarName", "profileCardName"].forEach(id => {
    document.getElementById(id).textContent = name;
  });
  ["topAvatar", "sidebarAvatar", "profileAvatar"].forEach(id => {
    document.getElementById(id).textContent = avatarText;
  });
  document.getElementById("welcomeName").textContent = firstName;
  document.getElementById("profileName").value = profile.name || "";
  document.getElementById("profileEmail").value = user.email || profile.email || "";
  document.getElementById("profilePhone").value = profile.phone || "";
  document.getElementById("profileSpecialty").value = profile.specialty || "";
  document.getElementById("profileCardSpecialty").textContent = specialtyLabels[profile.specialty] || "مستقل محترف";

  const completedFields = [profile.name, profile.phone, profile.specialty, user.email].filter(Boolean).length;
  const progress = Math.max(35, Math.round((completedFields / 4) * 100));
  document.getElementById("profileProgressValue").textContent = `${progress}%`;
  document.getElementById("profileProgressBar").style.width = `${progress}%`;
}

async function saveProfile(event) {
  event.preventDefault();
  const button = document.getElementById("saveProfileButton");
  const updates = {
    name: document.getElementById("profileName").value.trim(),
    phone: document.getElementById("profilePhone").value.trim(),
    specialty: document.getElementById("profileSpecialty").value
  };
  if (!updates.name) return;

  button.disabled = true;
  button.textContent = "جاري الحفظ...";
  elements.profileMessage.textContent = "";
  try {
    await updateDoc(doc(db, "users", state.user.uid), updates);
    state.profile = { ...state.profile, ...updates };
    fillProfile(state.user, state.profile);
    elements.profileMessage.textContent = "تم حفظ التعديلات بنجاح.";
    showToast("تم تحديث ملفك الشخصي.");
  } catch (error) {
    console.error("Profile update failed", error);
    elements.profileMessage.textContent = "تعذر حفظ التعديلات. حاول مجدداً.";
    elements.profileMessage.style.color = "var(--danger)";
  } finally {
    button.disabled = false;
    button.textContent = "حفظ التعديلات";
  }
}

function bindEvents() {
  document.querySelectorAll(".side-link[data-section]").forEach(link => {
    link.addEventListener("click", () => showSection(link.dataset.section));
  });
  document.querySelectorAll("[data-section-target]").forEach(button => {
    button.addEventListener("click", () => showSection(button.dataset.sectionTarget));
  });
  document.querySelectorAll("[data-open-service-modal]").forEach(button => button.addEventListener("click", openServiceModal));
  document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", closeServiceModal));
  elements.mobileMenuButton.addEventListener("click", () => elements.sidebar.classList.contains("open") ? closeSidebar() : openSidebar());
  elements.sidebarOverlay.addEventListener("click", closeSidebar);
  elements.serviceForm.addEventListener("submit", handleServiceSubmit);
  elements.profileForm.addEventListener("submit", saveProfile);
  elements.serviceSearch.addEventListener("input", renderServices);
  document.getElementById("themeButton").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  document.getElementById("darkModeSwitch").addEventListener("change", event => setTheme(event.target.checked ? "dark" : "light"));
  document.getElementById("withdrawButton").addEventListener("click", () => showToast("السحب غير مفعّل بعد. لم يتم إرسال أي طلب مالي."));
  document.getElementById("logoutButton").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeServiceModal();
      closeSidebar();
    }
  });
}

setTheme(localStorage.getItem("theme") || "light");
bindEvents();
renderServices();

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    const profile = snapshot.exists() ? snapshot.data() : null;
    if (!user.emailVerified || !profile || profile.status !== "active" || profile.accountType !== "freelancer") {
      await signOut(auth);
      window.location.replace("login.html");
      return;
    }
    state.user = user;
    state.profile = profile;
    fillProfile(user, profile);
    document.getElementById("publicProfileLink").href = `freelancer-profile.html?uid=${encodeURIComponent(user.uid)}`;
    elements.loadingScreen.classList.add("hidden");
  } catch (error) {
    console.error("Dashboard initialization failed", error);
    await signOut(auth);
    window.location.replace("login.html");
  }
});
