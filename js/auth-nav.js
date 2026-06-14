import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

function createLink(href, text, className = "") {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  if (className) link.className = className;
  return link;
}

function renderSignedInNav(container, user, profile) {
  container.replaceChildren();

  const messages = createLink("messages.html", "📬");
  messages.setAttribute("aria-label", "الرسائل");

  const profileLink = createLink("profile.html", "");
  profileLink.style.cssText = "display:flex;align-items:center;gap:.4rem;text-decoration:none;color:inherit";

  const avatar = document.createElement("span");
  avatar.textContent = (profile.name || user.email || "?").charAt(0);
  avatar.style.cssText = "width:36px;height:36px;border-radius:50%;background:#6C5CE7;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800";

  const name = document.createElement("span");
  name.textContent = profile.name || user.email;
  name.style.fontWeight = "600";
  profileLink.append(avatar, name);

  const logout = document.createElement("button");
  logout.type = "button";
  logout.textContent = "🚪";
  logout.title = "تسجيل الخروج";
  logout.style.cssText = "background:transparent;border:0;cursor:pointer;font-size:1.2rem";
  logout.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
  });

  const theme = document.createElement("button");
  theme.type = "button";
  theme.className = "theme-toggle";
  theme.id = "themeToggle";
  theme.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";
  theme.setAttribute("aria-label", "تبديل الوضع الليلي");
  theme.addEventListener("click", () => window.toggleTheme?.());

  const mobile = document.createElement("button");
  mobile.type = "button";
  mobile.className = "mobile-toggle";
  mobile.textContent = "☰";
  mobile.setAttribute("aria-label", "فتح القائمة");
  mobile.addEventListener("click", () => window.toggleMobileMenu?.());

  container.append(messages, profileLink, logout, theme, mobile);
}

onAuthStateChanged(auth, async (user) => {
  const container = document.getElementById("navActions");
  if (!container || !user) return;

  const snapshot = await getDoc(doc(db, "users", user.uid));
  if (!snapshot.exists()) return;

  renderSignedInNav(container, user, snapshot.data());
});
