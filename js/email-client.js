import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import { app } from "./firebase.js";

const functions = getFunctions(app);
const sendOfficialEmailCallable = httpsCallable(functions, "sendAdminOfficialEmail");

export async function sendOfficialEmail(payload) {
  if (!payload?.to || !payload?.subject || !payload?.message) return { skipped: true };
  return sendOfficialEmailCallable(payload);
}
