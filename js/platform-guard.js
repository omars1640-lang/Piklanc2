import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const page = location.pathname.split("/").pop() || "index.html";
const exemptPages = new Set(["maintenance.html", "login.html", "dashboard.html"]);

function currentUser() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, user => {
      stop();
      resolve(user);
    }, () => resolve(null));
  });
}

export const platformReady = (async () => {
  if (exemptPages.has(page)) return true;
  return new Promise(resolve => {
    let firstCheck = true;
    let redirecting = false;
    const finish = value => { if (firstCheck) { firstCheck = false; resolve(value); } };
    onSnapshot(doc(db, "platformSettings", "general"), async settings => {
      if (!settings.exists() || settings.data().maintenanceMode !== true) return finish(true);
      const user = await currentUser();
      if (user) {
        const profile = await getDoc(doc(db, "users", user.uid));
        if (profile.exists() && profile.data().role === "admin") return finish(true);
      }
      if (!redirecting) {
        redirecting = true;
        const returnUrl = `${location.pathname}${location.search}${location.hash}`;
        location.replace(`/maintenance.html?returnUrl=${encodeURIComponent(returnUrl)}`);
      }
      finish(false);
    }, error => {
      console.warn("Maintenance status could not be checked", error);
      finish(true);
    });
  });
})();
