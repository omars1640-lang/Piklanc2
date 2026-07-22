import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { ALWAYS_ALLOWED_PAGES, platformAccessDecision } from "./access-policy.js";

const page = location.pathname.split("/").pop() || "index.html";

function revealPage() {
  document.documentElement.setAttribute("data-platform-access", "ready");
  document.getElementById("platform-access-bootstrap")?.remove();
}

function safeReturnUrl(fallback = "/index.html") {
  const requested = new URLSearchParams(location.search).get("returnUrl") || "";
  try {
    const target = new URL(requested, location.origin);
    if (target.origin !== location.origin || !target.pathname.endsWith(".html")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

function currentUser() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, user => {
      stop();
      resolve(user);
    }, () => resolve(null));
  });
}

export const platformReady = (async () => {
  if (ALWAYS_ALLOWED_PAGES.has(page)) {
    revealPage();
    return true;
  }
  return new Promise(resolve => {
    let firstCheck = true;
    let redirecting = false;
    const finish = value => { if (firstCheck) { firstCheck = false; resolve(value); } };
    onSnapshot(doc(db, "platformSettings", "general"), async settings => {
      const configuration = settings.exists() ? settings.data() : {};
      const maintenanceMode = configuration.maintenanceMode === true;
      const prelaunchMode = configuration.prelaunchMode !== false;

      let profileData = null;
      if (maintenanceMode || prelaunchMode) {
        const user = await currentUser();
        if (user) {
          const profile = await getDoc(doc(db, "users", user.uid));
          profileData = profile.exists() ? profile.data() : null;
        }
      }

      const decision = platformAccessDecision({
        page,
        maintenanceMode,
        prelaunchMode,
        role: profileData?.role,
        earlyAccess: profileData?.earlyAccess
      });

      if (decision === "allow") {
        revealPage();
        return finish(true);
      }

      if (decision === "maintenance") {
        if (!redirecting) {
          redirecting = true;
          const returnUrl = `${location.pathname}${location.search}${location.hash}`;
          location.replace(`/maintenance.html?returnUrl=${encodeURIComponent(returnUrl)}`);
        }
        finish(false);
        return;
      }

      if (decision === "coming-soon") {
        if (!redirecting) {
          redirecting = true;
          const returnUrl = `${location.pathname}${location.search}${location.hash}`;
          location.replace(`/coming-soon.html?returnUrl=${encodeURIComponent(returnUrl)}`);
        }
        finish(false);
        return;
      }

      if (decision === "platform") {
        if (!redirecting) {
          redirecting = true;
          location.replace(safeReturnUrl());
        }
        finish(false);
        return;
      }
    }, error => {
      console.warn("Platform access status could not be checked", error);
      const fallbackDecision = platformAccessDecision({ page, maintenanceMode: false, prelaunchMode: true });
      if (fallbackDecision === "allow") {
        revealPage();
        return finish(true);
      }
      if (!redirecting) {
        redirecting = true;
        const returnUrl = `${location.pathname}${location.search}${location.hash}`;
        location.replace(`/coming-soon.html?returnUrl=${encodeURIComponent(returnUrl)}`);
      }
      finish(false);
    });
  });
})();
