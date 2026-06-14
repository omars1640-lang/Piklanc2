import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const requiredAccountType = document.body.dataset.accountType;

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  if (!requiredAccountType) return;

  const profile = await getDoc(doc(db, "users", user.uid));
  if (!profile.exists() || profile.data().accountType !== requiredAccountType) {
    window.location.replace("profile.html");
  }
});
