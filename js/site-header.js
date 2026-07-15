import "./cookie-consent.js";
import "./footer-copy.js";
import "./platform-guard.js";

const header = document.querySelector(".site-header");
const nav = document.getElementById("siteHeaderNav");
const actions = document.getElementById("siteHeaderActions");
const mobileButton = document.getElementById("siteHeaderMobile");
const themeButton = document.getElementById("themeToggle");
const HEADER_PROFILE_CACHE_KEY = "piklanceHeaderProfile";
const HEADER_PROFILE_CACHE_TTL = 1000 * 60 * 60 * 12;
let stopNotifications = null;
let firebaseDeps = null;
let signOutUser = async () => {};
let refreshHeaderImage = async () => false;

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
  document.documentElement.style.colorScheme = theme;
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

function readCachedHeaderProfile() {
  try {
    const cached = JSON.parse(localStorage.getItem(HEADER_PROFILE_CACHE_KEY) || "null");
    if (!cached?.uid || Date.now() - Number(cached.cachedAt || 0) > HEADER_PROFILE_CACHE_TTL) return null;
    return cached;
  } catch {
    return null;
  }
}

function cacheHeaderProfile(user, profile) {
  try {
    localStorage.setItem(HEADER_PROFILE_CACHE_KEY, JSON.stringify({
      uid: user.uid,
      email: user.email || "",
      profile,
      cachedAt: Date.now()
    }));
  } catch {
    // Header cache is optional; auth still resolves normally without it.
  }
}

function clearHeaderProfileCache() {
  try {
    localStorage.removeItem(HEADER_PROFILE_CACHE_KEY);
  } catch {
    // Ignore storage restrictions.
  }
}

function renderAuthLoadingActions() {
  if (!actions) return;
  actions.classList.remove("is-signed-in", "is-signed-out");
  actions.classList.add("is-auth-loading");
  const skeleton = document.createElement("span");
  skeleton.className = "site-header-auth-skeleton";
  skeleton.setAttribute("role", "status");
  skeleton.setAttribute("aria-label", "جاري التحقق من تسجيل الدخول");
  actions.replaceChildren(themeButton, skeleton);
}

function renderSignedOutActions() {
  if (!actions) return;
  stopNotifications?.();
  stopNotifications = null;
  clearHeaderProfileCache();
  actions.classList.remove("is-signed-in", "is-auth-loading");
  actions.classList.add("is-signed-out");
  const login = createLink("login.html", "دخول", "site-header-button ghost");
  const join = createLink("register.html", "انضم مجاناً", "site-header-button primary");
  actions.replaceChildren(themeButton, login, join);
}

function renderSignedInActions(user, profile) {
  if (!actions) return;
  actions.classList.remove("is-signed-out", "is-auth-loading");
  actions.classList.add("is-signed-in");
  const messages = createLink("messages.html", "الرسائل", "site-header-button ghost");
  messages.classList.add("site-header-notifications");
  const messagesCount = document.createElement("b");
  messagesCount.hidden = true;
  messages.appendChild(messagesCount);
  const accountHref = profile.role === "admin" ? "dashboard.html" : profile.accountType === "freelancer" ? "freelancer-dashboard.html" : "profile.html";
  const notifications = createLink(`${accountHref}#notifications`, "الإشعارات", "site-header-button ghost site-header-notifications");
  const shouldWatchNotifications = profile.role !== "admin";
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
      const recovered = await refreshHeaderImage(image, user.uid, profile);
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
    await signOutUser();
    location.href = "index.html";
  });
  actions.replaceChildren(themeButton, notifications, messages, account, logout);
  stopNotifications?.();
  if (firebaseDeps && shouldWatchNotifications) {
    const { collection, db, onSnapshot, query, where } = firebaseDeps;
    const stopSystemNotifications = onSnapshot(
      query(collection(db, "notifications", user.uid, "items"), where("read", "==", false)),
      snapshot => {
        notificationCount.textContent = snapshot.size;
        notificationCount.hidden = snapshot.empty;
      },
      () => { notificationCount.hidden = true; }
    );
    const stopMessageNotifications = onSnapshot(
      query(collection(db, "chats"), where("participantUids", "array-contains", user.uid)),
      snapshot => {
        const total = snapshot.docs.reduce((sum, item) => sum + Number(item.data().unreadCounts?.[user.uid] || 0), 0);
        messagesCount.textContent = total > 99 ? "99+" : String(total);
        messagesCount.hidden = total === 0;
      },
      () => { messagesCount.hidden = true; }
    );
    stopNotifications = () => {
      stopSystemNotifications();
      stopMessageNotifications();
    };
  }
}

function renderCachedHeaderProfile() {
  const cached = readCachedHeaderProfile();
  if (!cached) {
    renderAuthLoadingActions();
    return;
  }
  renderSignedInActions({ uid: cached.uid, email: cached.email }, cached.profile || {});
  actions?.classList.add("is-auth-loading");
}

async function initHeaderAuth() {
  try {
    const [
      authModule,
      firestoreModule,
      firebaseModule,
      avatarModule
    ] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
      import("./firebase.js"),
      import("./avatar-utils.js")
    ]);
    const { onAuthStateChanged, signOut } = authModule;
    const { collection, doc, getDoc, onSnapshot, query, where } = firestoreModule;
    const { auth, db } = firebaseModule;
    const { refreshImageFromStorage, resolveProfileAvatar } = avatarModule;
    firebaseDeps = { collection, db, onSnapshot, query, where };
    signOutUser = () => signOut(auth);
    refreshHeaderImage = refreshImageFromStorage;

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
        const mergedProfile = {
          ...profile,
          ...publicProfile,
          avatar
        };
        cacheHeaderProfile(user, mergedProfile);
        renderSignedInActions(user, mergedProfile);
      } catch {
        renderSignedOutActions();
      }
    });
  } catch (error) {
    console.warn("Unable to initialize authenticated header", error);
    renderSignedOutActions();
  }
}

function scheduleHeaderAuth() {
  window.setTimeout(initHeaderAuth, 0);
}

if (header) {
  setTheme(getSavedTheme() || "light");
  renderSiteBrand();
  normalizeHeaderLinks();
  setActiveLink();
  renderCachedHeaderProfile();

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

  scheduleHeaderAuth();
}
