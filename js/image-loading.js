const IMAGE_LOADING_CLASS = "piklance-image-loading";
const IMAGE_READY_CLASS = "piklance-image-ready";
const BACKGROUND_LOADING_CLASS = "piklance-background-loading";

function markImageReady(image) {
  image.classList.remove(IMAGE_LOADING_CLASS);
  image.classList.add(IMAGE_READY_CLASS);
}

function watchImage(image) {
  if (!(image instanceof HTMLImageElement) || image.dataset.piklanceImageTracked === "true") return;
  image.dataset.piklanceImageTracked = "true";

  if (image.complete) {
    markImageReady(image);
    return;
  }

  image.classList.add(IMAGE_LOADING_CLASS);
  image.addEventListener("load", () => markImageReady(image), { once: true });
  image.addEventListener("error", () => markImageReady(image), { once: true });
}

function backgroundUrl(element) {
  const value = element.style.backgroundImage || "";
  const match = value.match(/^url\(["']?(.*?)["']?\)$/i);
  return match?.[1] || "";
}

function watchBackground(element) {
  if (!(element instanceof HTMLElement)) return;
  const url = backgroundUrl(element);
  if (!url || element.dataset.piklanceBackgroundUrl === url) return;
  element.dataset.piklanceBackgroundUrl = url;
  element.classList.add(BACKGROUND_LOADING_CLASS);
  const probe = new Image();
  const finish = () => {
    if (element.dataset.piklanceBackgroundUrl === url) element.classList.remove(BACKGROUND_LOADING_CLASS);
  };
  probe.addEventListener("load", finish, { once: true });
  probe.addEventListener("error", finish, { once: true });
  probe.src = url;
}

function scan(root) {
  if (root instanceof HTMLImageElement) watchImage(root);
  if (root instanceof HTMLElement) watchBackground(root);
  root.querySelectorAll?.("img").forEach(watchImage);
  root.querySelectorAll?.('[style*="background-image"]').forEach(watchBackground);
}

scan(document);

new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    mutation.addedNodes.forEach(node => {
      if (node instanceof Element) scan(node);
    });
    if (mutation.type === "attributes" && mutation.target instanceof Element) {
      if (mutation.target instanceof HTMLImageElement) {
        mutation.target.dataset.piklanceImageTracked = "false";
        mutation.target.classList.remove(IMAGE_READY_CLASS);
        watchImage(mutation.target);
      } else {
        watchBackground(mutation.target);
      }
    }
  });
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src", "srcset", "style"]
});
