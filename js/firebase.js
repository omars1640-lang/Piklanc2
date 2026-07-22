import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  setPersistence
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyCMrfgQ1kcfPMF-qLM_88HqZUki-xU7OW4",
  authDomain: "piklance-c2651.firebaseapp.com",
  projectId: "piklance-c2651",
  storageBucket: "piklance-c2651.firebasestorage.app",
  messagingSenderId: "290309648200",
  appId: "1:290309648200:web:b5948813ef1087ab0ccd7d",
  appCheckSiteKey: ""
};

export const app = getApps()[0] || initializeApp(firebaseConfig);

if (firebaseConfig.appCheckSiteKey) {
  const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js");
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(firebaseConfig.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "europe-west1");

setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch(error => {
    console.warn("Auth local persistence unavailable", error);
  });
