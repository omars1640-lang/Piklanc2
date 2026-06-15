import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

let publishedArticles = [];
let currentCategory = "all";
const grid = document.getElementById("articlesGrid");

function formatDate(value) {
  const date = value?.toDate?.();
  return date ? date.toLocaleDateString("ar-SY", { year: "numeric", month: "long", day: "numeric" }) : "حديثاً";
}

function render(items) {
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "article-card";
    empty.style.padding = "2rem";
    empty.textContent = "لا توجد مقالات مطابقة حالياً.";
    grid.replaceChildren(empty);
    return;
  }
  grid.replaceChildren(...items.map(article => {
    const card = document.createElement("article");
    card.className = "article-card";
    card.tabIndex = 0;
    const image = document.createElement("div");
    image.className = "article-img";
    image.style.background = "linear-gradient(135deg,#372452,#8050c8)";
    const body = document.createElement("div");
    body.className = "article-body";
    const category = document.createElement("span");
    category.className = "article-category";
    category.textContent = article.category || "عام";
    const title = document.createElement("h3");
    title.textContent = article.title;
    const excerpt = document.createElement("p");
    excerpt.textContent = article.excerpt;
    const meta = document.createElement("div");
    meta.className = "article-meta";
    meta.innerHTML = `<span>📅 ${formatDate(article.publishedAt || article.createdAt)}</span><span>⏱ ${Math.max(2, Math.ceil(String(article.body || "").split(/\s+/).length / 180))} دقائق</span>`;
    body.append(category, title, excerpt, meta);
    card.append(image, body);
    const open = () => { location.href = `article.html?id=${encodeURIComponent(article.id)}`; };
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => { if (event.key === "Enter") open(); });
    return card;
  }));
}

function applyFilters() {
  const term = document.getElementById("blogSearch").value.trim().toLowerCase();
  render(publishedArticles.filter(article => {
    const categoryMatch = currentCategory === "all" || article.category === currentCategory;
    const termMatch = !term || `${article.title} ${article.excerpt}`.toLowerCase().includes(term);
    return categoryMatch && termMatch;
  }));
}

window.filterArticles = applyFilters;
window.filterCategory = (category, button) => {
  currentCategory = category;
  document.querySelectorAll(".filter-btn").forEach(control => control.classList.remove("active"));
  button.classList.add("active");
  applyFilters();
};

try {
  const snapshot = await getDocs(query(collection(db, "articles"), where("status", "==", "published")));
  publishedArticles = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  publishedArticles.sort((a, b) => (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0));
  if (publishedArticles.length) {
    render(publishedArticles);
    document.addEventListener("DOMContentLoaded", () => render(publishedArticles));
  }
} catch (error) {
  console.error("Unable to load published articles", error);
}
