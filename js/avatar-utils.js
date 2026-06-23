import { getDownloadURL, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { storage } from "./firebase.js";

export function cacheBustUrl(url) {
  return url ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : "";
}

export function avatarStoragePath(uid, profile = {}) {
  return profile.avatarPath || `profile-images/${uid}/avatar`;
}

export async function resolveProfileAvatar(uid, profile = {}) {
  const savedUrl = typeof profile.avatar === "string" ? profile.avatar.trim() : "";
  if (!uid) return savedUrl;
  const freshUrl = await getDownloadURL(ref(storage, avatarStoragePath(uid, profile)))
    .then(cacheBustUrl)
    .catch(() => "");
  return freshUrl || savedUrl;
}

export async function refreshImageFromStorage(image, uid, profile = {}) {
  const freshUrl = await getDownloadURL(ref(storage, avatarStoragePath(uid, profile)))
    .then(cacheBustUrl)
    .catch(() => "");
  if (!freshUrl || image.dataset.avatarRetry === "1") return false;
  image.dataset.avatarRetry = "1";
  image.src = freshUrl;
  return true;
}
