import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { refreshImageFromStorage, resolveProfileAvatar } from "./avatar-utils.js";
import "./cookie-consent.js";
import "./footer-copy.js";

const header = document.querySelector(".site-header");
const nav = document.getElementById("siteHeaderNav");
const actions = document.getElementById("siteHeaderActions");
const mobileButton = document.getElementById("siteHeaderMobile");
const themeButton = document.getElementById("themeToggle");
let stopNotifications = null;

function renderSiteBrand() {
  const brands = [header?.querySelector(".site-header-brand"), ...document.querySelectorAll(".footer-brand")].filter(Boolean);
  brands.forEach(brand => {
    const light = document.createElement("img");
    light.className = "piklance-brand-logo light-logo";
    light.src = "assets/brand/logo-light.svg";
    light.alt = "PikLance";
    light.width = 150;
    light.height = 41;
    const dark = document.createElement("img");
    dark.className = "piklance-brand-logo dark-logo";
    dark.src = "assets/brand/logo-dark.svg";
    dark.alt = "";
    dark.width = 150;
    dark.height = 41;
    dark.setAttribute("aria-hidden", "true");
    brand.replaceChildren(light, dark);
  });
}
function getSavedTheme() {
  try {
    return localStorage.getItem("theme");
  } catch {
    return null;
  }
}
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Theme still applies for the current page even if storage is blocked.
  }
  if (themeButton) themeButton.textContent = theme === "dark" ? "☀" : "☾";
}
function setActiveLink() {
  const currentPage = location.pathname.split("/").pop() || "index.html";
  nav?.querySelectorAll("a").forEach(link => {
    const targetPage = new URL(link.href, location.href).pathname.split("/").pop();
    link.classList.toggle("active", targetPage === currentPage);
  });
}

function normalizeHeaderLinks() {
  const currentPage = location.pathname.split("/").pop() || "index.html";
  if (["blog.html", "article.html"].includes(currentPage)) {
    nav?.querySelectorAll('a[href="how-it-works.html"]').forEach(link => link.remove());
  }
}

function closeMenu() {
  nav?.classList.remove("open");
  mobileButton?.setAttribute("aria-expanded", "false");
}

function createLink(href, text, className) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  link.className = className;
  return link;
}

function renderSignedOutActions() {
  if (!actions) return;
  stopNotifications?.();
  stopNotifications = null;
  actions.classList.remove("is-signed-in");
  actions.classList.add("is-signed-out");
  const login = createLink("login.html", "دخول", "site-header-button ghost");
  const join = createLink("register.html", "انضم مجاناً", "site-header-button primary");
  actions.replaceChildren(themeButton, login, join);
}

function renderSignedInActions(user, profile) {
  if (!actions) return;
  actions.classList.remove("is-signed-out");
  actions.classList.add("is-signed-in");
  const messages = createLink("messages.html", "الرسائل", "site-header-button ghost");
  const accountHref = profile.role === "admin" ? "dashboard.html" : profile.accountType === "freelancer" ? "freelancer-dashboard.html" : "profile.html";
  const notifications = createLink(`${accountHref}#notifications`, "الإشعارات", "site-header-button ghost site-header-notifications");
  const notificationCount = document.createElement("b");
  notificationCount.hidden = true;
  notifications.appendChild(notificationCount);
  const account = createLink(accountHref, "", "site-header-account");
  const avatar = document.createElement("span");
  avatar.className = "site-header-avatar";
  if (profile.avatar) {
    const image = document.createElement("img");
    image.src = profile.avatar;
    image.alt = `صورة ${profile.name || user.email || "الحساب"}`;
    image.addEventListener("error", async () => {
      const recovered = await refreshImageFromStorage(image, user.uid, profile);
      if (!recovered) avatar.textContent = (profile.name || user.email || "م").charAt(0);
    });
    avatar.appendChild(image);
  } else {
    avatar.textContent = (profile.name || user.email || "م").charAt(0);
  }
  const copy = document.createElement("span");
  copy.className = "site-header-account-copy";
  const name = document.createElement("strong");
  name.textContent = profile.name || user.email;
  const role = document.createElement("small");
  role.textContent = profile.accountType === "freelancer" ? "حساب مستقل" : "حساب عميل";
  copy.append(name, role);
  account.append(avatar, copy);

  const logout = document.createElement("button");
  logout.type = "button";
  logout.className = "site-header-logout";
  logout.title = "تسجيل الخروج";
  logout.setAttribute("aria-label", "تسجيل الخروج");
  logout.textContent = "↪";
  logout.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "index.html";
  });
  actions.replaceChildren(themeButton, notifications, messages, account, logout);
  stopNotifications?.();
  stopNotifications = onSnapshot(
    query(collection(db, "notifications", user.uid, "items"), where("read", "==", false)),
    snapshot => {
      notificationCount.textContent = snapshot.size;
      notificationCount.hidden = snapshot.empty;
    },
    () => { notificationCount.hidden = true; }
  );
}

if (header) {
  setTheme(getSavedTheme() || "light");
  renderSiteBrand();
  normalizeHeaderLinks();
  setActiveLink();
  renderSignedOutActions();

  themeButton?.addEventListener("click", () => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  mobileButton?.addEventListener("click", () => {
    const isOpen = nav?.classList.toggle("open");
    mobileButton.setAttribute("aria-expanded", String(Boolean(isOpen)));
  });

  nav?.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });

  onAuthStateChanged(auth, async user => {
    if (!user) {
      renderSignedOutActions();
      return;
    }
    try {
      const snapshot = await getDoc(doc(db, "users", user.uid));
      if (!snapshot.exists()) {
        renderSignedOutActions();
        return;
      }
      const profile = snapshot.data();
      if (profile.status !== "active" && profile.role !== "admin") {
        renderSignedOutActions();
        return;
      }
      const publicSnapshot = await getDoc(doc(db, "publicProfiles", user.uid));
      const publicProfile = publicSnapshot.exists() ? publicSnapshot.data() : {};
      const avatar = await resolveProfileAvatar(user.uid, publicProfile);
      renderSignedInActions(user, {
        ...profile,
        ...publicProfile,
        avatar
      });
    } catch {
      renderSignedOutActions();
    }
  });
}
