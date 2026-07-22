import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const requiredAccountType = document.body.dataset.accountType;

function loginRedirect() {
  const returnUrl = `${location.pathname.split("/").pop() || "index.html"}${location.search}${location.hash}`;
  return `login.html?returnUrl=${encodeURIComponent(returnUrl)}`;
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace(loginRedirect());
    return;
  }

  const profile = await getDoc(doc(db, "users", user.uid));
  if (!user.emailVerified || !profile.exists()) {
    await signOut(auth);
    window.location.replace(loginRedirect());
    return;
  }

  const data = profile.data();
  if (data.status === "pending") {
    window.location.replace("pending-review.html");
    return;
  }

  if (data.status === "rejected" && data.accountType === "freelancer") {
    window.location.replace("register.html?resubmit=1");
    return;
  }

  if (data.status !== "active") {
    await signOut(auth);
    window.location.replace(loginRedirect());
    return;
  }

  if (requiredAccountType && data.accountType !== requiredAccountType) {
    window.location.replace(data.accountType === "freelancer" ? "freelancer-dashboard.html" : "profile.html");
  }
});
