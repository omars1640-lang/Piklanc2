import {
  collection, getCountFromServer, getDocs, limit, orderBy, query, startAfter, where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./firebase.js";

const PAGE_SIZE = 9;
const state = {
  articles: [], featured: null, category: "الكل", search: "", page: 1,
  total: 0, hasMore: false, cursors: [null], loading: false, categories: ["الكل"]
};
const grid = document.getElementById("articlesGrid");
const featured = document.getElementById("featuredArticle");
const categories = document.getElementById("blogCategories");
const pagination = document.getElementById("blogPagination");
const resultCount = document.getElementById("articlesResultCount");

function toDate(value) {
  return value?.toDate?.() || (value ? new Date(value) : null);
}

function formatDate(value) {
  return toDate(value)?.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) || "حديثاً";
}

function readTime(article) {
  return Number(article.readingMinutes || Math.max(2, Math.ceil(String(article.body || "").trim().split(/\s+/).filter(Boolean).length / 180)));
}

function coverStyle(url) {
  return url ? `url("${String(url).replace(/"/g, "%22")}")` : "";
}

function statsNode(article) {
  const stats = document.createElement("div");
  stats.className = "article-stats";
  const values = [
    `◷ ${readTime(article)} دقائق`,
    `♡ ${Number(article.likesCount || 0).toLocaleString("en-US")}`,
    `◌ ${Number(article.commentsCount || 0).toLocaleString("en-US")}`,
    `شاهد ${Number(article.views || 0).toLocaleString("en-US")}`
  ];
  stats.replaceChildren(...values.map(value => {
    const span = document.createElement("span");
    span.textContent = value;
    return span;
  }));
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
  const date = document.createElement("small");
  date.textContent = formatDate(article.publishedAt || article.createdAt);
  copy.append(category, title, excerpt, date, statsNode(article));
  link.append(cover, copy);
  card.append(link);
  return card;
}

function renderPagination() {
  if (state.total <= PAGE_SIZE) {
    pagination.replaceChildren();
    return;
  }
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "السابق";
  previous.disabled = state.page === 1 || state.loading;
  previous.addEventListener("click", () => loadPage(state.page - 1));
  const current = document.createElement("span");
  current.className = "blog-page-current";
  current.textContent = `صفحة ${state.page.toLocaleString("en-US")} من ${Math.max(1, Math.ceil(state.total / PAGE_SIZE)).toLocaleString("en-US")}`;
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "التالي";
  next.disabled = !state.hasMore || state.loading;
  next.addEventListener("click", () => loadPage(state.page + 1));
  pagination.replaceChildren(previous, current, next);
}

function render() {
  renderFeatured(state.featured || state.articles[0]);
  resultCount.textContent = `${state.total.toLocaleString("en-US")} مقال`;
  if (!state.articles.length) {
    const empty = document.createElement("div");
    empty.className = "blog-state";
    empty.textContent = "لا توجد مقالات مطابقة لبحثك حالياً.";
    grid.replaceChildren(empty);
  } else {
    grid.replaceChildren(...state.articles.map(articleCard));
  }
  renderPagination();
}

function renderCategories() {
  categories.replaceChildren(...state.categories.map(name => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.classList.toggle("active", state.category === name);
    button.addEventListener("click", () => {
      state.category = name;
      state.cursors = [null];
      renderCategories();
      loadPage(1);
    });
    return button;
  }));
}

function normalizedSearchToken() {
  return state.search.toLowerCase().replace(/[^\u0600-\u06ffa-z0-9_-]/gi, " ").trim().split(/\s+/)[0] || "";
}

function queryParts(includePaging = true, page = state.page) {
  const constraints = [where("status", "==", "published")];
  if (state.category !== "الكل") constraints.push(where("category", "==", state.category));
  const token = normalizedSearchToken();
  if (token) constraints.push(where("searchTokens", "array-contains", token));
  constraints.push(orderBy("publishedAt", "desc"));
  if (includePaging) {
    const cursor = state.cursors[page - 1];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(PAGE_SIZE + 1));
  }
  return constraints;
}

async function loadPage(page = 1) {
  if (state.loading || page < 1 || (page > 1 && !state.cursors[page - 1])) return;
  state.loading = true;
  grid.innerHTML = '<div class="blog-state">جاري تحميل المقالات...</div>';
  try {
    const [snapshot, countSnapshot] = await Promise.all([
      getDocs(query(collection(db, "articles"), ...queryParts(true, page))),
      getCountFromServer(query(collection(db, "articles"), ...queryParts(false, page)))
    ]);
    const visible = snapshot.docs.slice(0, PAGE_SIZE);
    state.articles = visible.map(item => ({ id: item.id, ...item.data() }));
    state.page = page;
    state.total = countSnapshot.data().count;
    state.hasMore = snapshot.docs.length > PAGE_SIZE;
    if (state.hasMore && visible.length) state.cursors[page] = visible.at(-1);
  } catch (error) {
    console.error("Unable to load articles", error);
    state.articles = [];
    state.total = 0;
  } finally {
    state.loading = false;
    render();
  }
}

let searchTimer;
document.getElementById("blogSearch").addEventListener("input", event => {
  clearTimeout(searchTimer);
  state.search = event.target.value.trim();
  state.cursors = [null];
  searchTimer = setTimeout(() => loadPage(1), 300);
});

try {
  const [categorySnapshot, featuredSnapshot] = await Promise.all([
    getDocs(query(collection(db, "articleCategories"), where("active", "==", true), orderBy("name"))),
    getDocs(query(collection(db, "articles"), where("status", "==", "published"), where("featured", "==", true), limit(1)))
  ]);
  const names = categorySnapshot.docs.map(item => item.data().name).filter(Boolean);
  state.categories = ["الكل", ...new Set(names)];
  state.featured = featuredSnapshot.docs[0] ? { id: featuredSnapshot.docs[0].id, ...featuredSnapshot.docs[0].data() } : null;
} catch (error) {
  console.warn("Unable to load blog taxonomy", error);
}

renderCategories();
await loadPage(1);
