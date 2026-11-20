export function safeImageUrl(value, origin = location.origin, allowBlob = false) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, origin);
    if (url.username || url.password) return "";
    if (allowBlob && url.protocol === "blob:" && url.origin === origin) return url.href;
    if (url.protocol === "https:" && url.hostname === "firebasestorage.googleapis.com") return url.href;
    if (url.origin === origin && ["https:", "http:"].includes(url.protocol)
        && url.pathname.startsWith("/assets/")) return url.href;
  } catch { /* Invalid URLs use the existing initials/hidden-image fallback. */ }
  return "";
}

export function setSafeImageSource(image, value, allowBlob = false) {
  const url = safeImageUrl(value, location.origin, allowBlob);
  if (!url) {
    image.removeAttribute("src");
    return false;
  }
  image.src = url;
  return true;
}
