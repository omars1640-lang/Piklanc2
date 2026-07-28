export function ensureLoadMoreButton({
  anchor,
  id,
  label = "تحميل المزيد",
  onClick
}) {
  if (!anchor) return null;
  let button = document.getElementById(id);
  if (!button) {
    const footer = document.createElement("div");
    footer.className = "content-list-footer pagination-load-more";
    button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "secondary-button";
    button.textContent = label;
    footer.appendChild(button);
    anchor.insertAdjacentElement("afterend", footer);
  }
  if (onClick && button.dataset.paginationBound !== "true") {
    button.dataset.paginationBound = "true";
    button.addEventListener("click", onClick);
  }
  return button;
}

export function updateLoadMoreButton(button, { hasMore, loading = false, label = "تحميل المزيد" }) {
  if (!button) return;
  button.hidden = !hasMore;
  button.disabled = loading;
  button.textContent = loading ? "جاري التحميل..." : label;
}

export function appendUnique(items, additions) {
  const existingIds = new Set(items.map(item => item.id));
  return [...items, ...additions.filter(item => !existingIds.has(item.id))];
}
