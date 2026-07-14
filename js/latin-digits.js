(function () {
  const digitMap = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9"
  };
  const digitPattern = /[٠-٩۰-۹]/g;
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "KBD", "SAMP"]);

  function toLatinDigits(value) {
    return typeof value === "string"
      ? value.replace(digitPattern, digit => digitMap[digit] || digit)
      : value;
  }

  function normalizeTextNode(node) {
    const normalized = toLatinDigits(node.nodeValue);
    if (normalized !== node.nodeValue) node.nodeValue = normalized;
  }

  function normalizeElementAttributes(element) {
    if (!(element instanceof Element)) return;
    ["title", "aria-label", "placeholder", "alt"].forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      const value = element.getAttribute(attribute);
      const normalized = toLatinDigits(value);
      if (normalized !== value) element.setAttribute(attribute, normalized);
    });
  }

  function shouldSkip(element) {
    return !element || skipTags.has(element.tagName);
  }

  function normalizeTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (!shouldSkip(root.parentElement)) normalizeTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && shouldSkip(root)) return;
    if (root.nodeType === Node.ELEMENT_NODE) normalizeElementAttributes(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return shouldSkip(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });

    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) normalizeTextNode(node);
      else normalizeElementAttributes(node);
      node = walker.nextNode();
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") normalizeTextNode(mutation.target);
      if (mutation.type === "attributes") normalizeElementAttributes(mutation.target);
      mutation.addedNodes.forEach(normalizeTree);
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["title", "aria-label", "placeholder", "alt"]
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => normalizeTree(document.body), { once: true });
  } else {
    normalizeTree(document.body);
  }

  window.PikLanceDigits = { toLatinDigits, normalizeTree };
})();
