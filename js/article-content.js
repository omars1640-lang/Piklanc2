import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

const container = document.getElementById("articleContent");
const id = new URLSearchParams(location.search).get("id");

function stateMessage(message) {
  const link = document.createElement("a");
  link.href = "blog.html";
  link.textContent = "← العودة إلى المدونة";
  const state = document.createElement("div");
  state.className = "article-state";
  state.textContent = message;
  container.replaceChildren(link, state);
}

if (!id) {
  stateMessage("المقال غير موجود.");
} else {
  try {
    const snapshot = await getDoc(doc(db, "articles", id));
    if (!snapshot.exists() || snapshot.data().status !== "published") {
      stateMessage("المقال غير موجود أو لم يعد منشوراً.");
    } else {
      const article = snapshot.data();
      document.title = `${article.title} | PikLance`;
      const link = document.createElement("a");
      link.href = "blog.html";
      link.textContent = "← العودة إلى المدونة";
      const meta = document.createElement("div");
      meta.className = "article-meta";
      const date = article.publishedAt?.toDate?.() || article.createdAt?.toDate?.();
      meta.textContent = `${article.category || "عام"} · ${date ? date.toLocaleDateString("ar-SY", { year: "numeric", month: "long", day: "numeric" }) : "حديثاً"} · ${article.authorName || "فريق PikLance"}`;
      const title = document.createElement("h1");
      title.textContent = article.title;
      const excerpt = document.createElement("p");
      excerpt.className = "excerpt";
      excerpt.textContent = article.excerpt;
      const body = document.createElement("div");
      body.className = "article-body";
      body.textContent = article.body;
      container.replaceChildren(link, meta, title, excerpt, body);
    }
  } catch (error) {
    console.error("Unable to load article", error);
    stateMessage("تعذر تحميل المقال حالياً.");
  }
}
