import {
  collection, getCountFromServer, getDocs, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

const PAGE_SIZE = 9;
const state = { articles: [], category: "الكل", search: "", page: 1 };
const grid = document.getElementById("articlesGrid");
const featured = document.getElementById("featuredArticle");
const categories = document.getElementById("blogCategories");
const pagination = document.getElementById("blogPagination");
const resultCount = document.getElementById("articlesResultCount");

function toDate(value) {
  return value?.toDate?.() || (value ? new Date(value) : null);
}

function formatDate(value) {
  return toDate(value)?.toLocaleDateString("ar-SY", { year: "numeric", month: "long", day: "numeric" }) || "حديثاً";
}

function readTime(body) {
  return Math.max(2, Math.ceil(String(body || "").trim().split(/\s+/).filter(Boolean).length / 180));
}

function coverStyle(url) {
  return url ? `url("${String(url).replace(/"/g, "%22")}")` : "";
}

async function loadStats(article) {
  try {
    const [likes, comments] = await Promise.all([
      getCountFromServer(collection(db, "articles", article.id, "likes")),
      getCountFromServer(query(collection(db, "articles", article.id, "comments"), where("status", "==", "published")))
    ]);
    return { ...article, likesCount: likes.data().count, commentsCount: comments.data().count };
  } catch {
    return { ...article, likesCount: 0, commentsCount: 0 };
  }
}

function statsNode(article) {
  const stats = document.createElement("div");
  stats.className = "article-stats";
  stats.innerHTML = `<span>◷ ${readTime(article.body)} دقائق</span><span>♡ ${article.likesCount || 0}</span><span>◌ ${article.commentsCount || 0}</span><span>شاهد ${Number(article.views || 0).toLocaleString("ar-SY")}</span>`;
  return stats;
}

function renderFeatured(article) {
  if (!article || state.search || state.category !== "الكل") {
    featured.hidden = true;
    featured.replaceChildren();
    return;
  }
  const cover = document.createElement("div");
  cover.className = "featured-cover";
  cover.style.backgroundImage = coverStyle(article.coverUrl);
  const copy = document.createElement("div");
  copy.className = "featured-copy";
  const category = document.createElement("span");
  category.className = "article-category";
  category.textContent = "مقال مميز · " + (article.category || "عام");
  const title = document.createElement("h2");
  title.textContent = article.title;
  const excerpt = document.createElement("p");
  excerpt.textContent = article.excerpt;
  const open = document.createElement("a");
  open.className = "article-open";
  open.href = `article.html?id=${encodeURIComponent(article.id)}`;
  open.textContent = "قراءة المقال ←";
  copy.append(category, title, excerpt, statsNode(article), open);
  featured.replaceChildren(cover, copy);
  featured.hidden = false;
}

function articleCard(article) {
  const card = document.createElement("article");
  card.className = "article-card";
  const link = document.createElement("a");
  link.href = `article.html?id=${encodeURIComponent(article.id)}`;
  const cover = document.createElement("div");
  cover.className = "article-cover";
  cover.style.backgroundImage = coverStyle(article.coverUrl);
  const copy = document.createElement("div");
  copy.className = "article-card-copy";
  const category = document.createElement("span");
  category.className = "article-category";
  category.textContent = article.category || "عام";
  const title = document.createElement("h3");
  title.textContent = article.title;
  const excerpt = document.createElement("p");
  excerpt.textContent = article.excerpt;
  copy.append(category, title, excerpt, statsNode(article));
  link.append(cover, copy);
  card.append(link);
  return card;
}

function filteredArticles() {
  return state.articles.filter(article => {
    const categoryMatch = state.category === "الكل" || article.category === state.category;
    const haystack = `${article.title || ""} ${article.excerpt || ""} ${(article.tags || []).join(" ")}`.toLowerCase();
    return categoryMatch && (!state.search || haystack.includes(state.search));
  });
}

function renderPagination(total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) {
    pagination.replaceChildren();
    return;
  }
  const buttons = Array.from({ length: pages }, (_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(index + 1);
    button.classList.toggle("active", state.page === index + 1);
    button.addEventListener("click", () => {
      state.page = index + 1;
      render();
      document.querySelector(".blog-section-heading").scrollIntoView({ behavior: "smooth" });
    });
    return button;
  });
  pagination.replaceChildren(...buttons);
}

function render() {
  const items = filteredArticles();
  const featuredArticle = state.articles.find(article => article.featured) || state.articles[0];
  renderFeatured(featuredArticle);
  resultCount.textContent = `${items.length.toLocaleString("ar-SY")} مقال`;
  const maxPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  state.page = Math.min(state.page, maxPage);
  const pageItems = items.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  if (!pageItems.length) {
    const empty = document.createElement("div");
    empty.className = "blog-state";
    empty.textContent = "لا توجد مقالات مطابقة لبحثك حالياً.";
    grid.replaceChildren(empty);
  } else {
    grid.replaceChildren(...pageItems.map(articleCard));
  }
  renderPagination(items.length);
}

function renderCategories() {
  const names = ["الكل", ...new Set(state.articles.map(article => article.category || "عام"))];
  categories.replaceChildren(...names.map(name => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.classList.toggle("active", state.category === name);
    button.addEventListener("click", () => {
      state.category = name;
      state.page = 1;
      renderCategories();
      render();
    });
    return button;
  }));
}

document.getElementById("blogSearch").addEventListener("input", event => {
  state.search = event.target.value.trim().toLowerCase();
  state.page = 1;
  render();
});

onSnapshot(query(collection(db, "articles"), where("status", "==", "published")), async snapshot => {
  const articles = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  articles.sort((a, b) => (toDate(b.publishedAt || b.createdAt)?.getTime() || 0) - (toDate(a.publishedAt || a.createdAt)?.getTime() || 0));
  state.articles = await Promise.all(articles.map(loadStats));
  renderCategories();
  render();
}, error => {
  console.error("Unable to load articles realtime", error);
});

try {
  const snapshot = await getDocs(query(collection(db, "articles"), where("status", "==", "published")));
  const articles = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  articles.sort((a, b) => (toDate(b.publishedAt || b.createdAt)?.getTime() || 0) - (toDate(a.publishedAt || a.createdAt)?.getTime() || 0));
  state.articles = await Promise.all(articles.map(loadStats));
  renderCategories();
  render();
} catch (error) {
  console.error("Unable to load articles", error);
  grid.innerHTML = '<div class="blog-state">تعذر تحميل المقالات حالياً. حاول مرة أخرى لاحقاً.</div>';
}
