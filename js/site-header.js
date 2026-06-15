import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, getDoc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const header = document.querySelector(".site-header");
const nav = document.getElementById("siteHeaderNav");
const actions = document.getElementById("siteHeaderActions");
const mobileButton = document.getElementById("siteHeaderMobile");
const themeButton = document.getElementById("themeToggle");
let stopNotifications = null;

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  if (themeButton) themeButton.textContent = theme === "dark" ? "☀" : "☾";
}

function setActiveLink() {
  const currentPage = location.pathname.split("/").pop() || "index.html";
  nav?.querySelectorAll("a").forEach(link => {
    const targetPage = new URL(link.href, location.href).pathname.split("/").pop();
    link.classList.toggle("active", targetPage === currentPage);
  });
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
  const login = createLink("login.html", "دخول", "site-header-button ghost");
  const join = createLink("register.html", "انضم مجاناً", "site-header-button primary");
  actions.replaceChildren(themeButton, login, join);
}

function renderSignedInActions(user, profile) {
  if (!actions) return;
  const messages = createLink("messages.html", "الرسائل", "site-header-button ghost");
  const accountHref = profile.accountType === "freelancer" ? "freelancer-dashboard.html" : "profile.html";
  const notifications = createLink(`${accountHref}#notifications`, "الإشعارات", "site-header-button ghost site-header-notifications");
  const notificationCount = document.createElement("b");
  notificationCount.hidden = true;
  notifications.appendChild(notificationCount);
  const account = createLink(accountHref, "", "site-header-account");
  const avatar = document.createElement("span");
  avatar.className = "site-header-avatar";
  avatar.textContent = (profile.name || user.email || "م").charAt(0);
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
  setTheme(localStorage.getItem("theme") || "light");
  setActiveLink();

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
        await signOut(auth);
        renderSignedOutActions();
        return;
      }
      renderSignedInActions(user, profile);
    } catch {
      renderSignedOutActions();
    }
  });
}
