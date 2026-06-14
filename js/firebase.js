import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCMrfgQ1kcfPMF-qLM_88HqZUki-xU7OW4",
  authDomain: "piklance-c2651.firebaseapp.com",
  projectId: "piklance-c2651",
  storageBucket: "piklance-c2651.firebasestorage.app",
  messagingSenderId: "290309648200",
  appId: "1:290309648200:web:b5948813ef1087ab0ccd7d"
};

const app = getApps()[0] || initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
