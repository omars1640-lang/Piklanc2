import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, increment, onSnapshot,
  query, serverTimestamp, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const articleId = new URLSearchParams(location.search).get("id");
const state = { article: null, user: null, profile: null, liked: false, likeIds: [], comments: [], pendingConfirmAction: null };
const $ = id => document.getElementById(id);

function toast(message) {
  $("articleToast").textContent = message;
  $("articleToast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("articleToast").classList.remove("show"), 2600);
}

function openArticleConfirm({ title, message, actionLabel = "تأكيد", onConfirm }) {
  state.pendingConfirmAction = onConfirm;
  $("articleConfirmTitle").textContent = title;
  $("articleConfirmMessage").textContent = message;
  $("articleConfirmAction").textContent = actionLabel;
  $("articleConfirmModal").classList.add("open");
  $("articleConfirmModal").setAttribute("aria-hidden", "false");
}

function closeArticleConfirm() {
  state.pendingConfirmAction = null;
  $("articleConfirmModal").classList.remove("open");
  $("articleConfirmModal").setAttribute("aria-hidden", "true");
}

async function runArticleConfirmAction() {
  const action = state.pendingConfirmAction;
  if (!action) return;
  const button = $("articleConfirmAction");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "جاري التنفيذ...";
  try {
    await action();
    closeArticleConfirm();
  } catch (error) {
    console.error("Article confirmed action failed", error);
    toast("تعذر تنفيذ الإجراء حالياً.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function toDate(value) {
  return value?.toDate?.() || (value ? new Date(value) : null);
}

function formatDate(value) {
  return toDate(value)?.toLocaleDateString("ar-SY", { year: "numeric", month: "long", day: "numeric" }) || "حديثاً";
}

function readTime(body) {
  return Math.max(2, Math.ceil(String(body || "").trim().split(/\s+/).filter(Boolean).length / 180));
}

function renderBody(text) {
  const fragment = document.createDocumentFragment();
  let list = null;
  const flushList = () => {
    if (list) fragment.appendChild(list);
    list = null;
  };
  String(text || "").split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line) {
      flushList();
      return;
    }
    if (line.startsWith("### ")) {
      flushList();
      const heading = document.createElement("h3");
      heading.textContent = line.slice(4);
      fragment.appendChild(heading);
    } else if (line.startsWith("## ")) {
      flushList();
      const heading = document.createElement("h2");
      heading.textContent = line.slice(3);
      fragment.appendChild(heading);
    } else if (line.startsWith("- ")) {
      if (!list) list = document.createElement("ul");
      const item = document.createElement("li");
      item.textContent = line.slice(2);
      list.appendChild(item);
    } else {
      flushList();
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      fragment.appendChild(paragraph);
    }
  });
  flushList();
  $("articleBody").replaceChildren(fragment);
}

function renderArticle(article) {
  document.title = `${article.title} | PikLance`;
  document.querySelector('meta[name="description"]').content = article.excerpt || "";
  $("articleCategory").textContent = article.category || "عام";
  $("articleTitle").textContent = article.title;
  $("articleExcerpt").textContent = article.excerpt || "";
  $("articleMeta").innerHTML = `<span>${article.authorName || "فريق PikLance"}</span><span>${formatDate(article.publishedAt || article.createdAt)}</span><span>◷ ${readTime(article.body)} دقائق قراءة</span><span id="articleViews">${Number(article.views || 0).toLocaleString("ar-SY")} مشاهدة</span>`;
  if (article.coverUrl) {
    $("articleCover").style.backgroundImage = `url("${String(article.coverUrl).replace(/"/g, "%22")}")`;
    $("articleCover").hidden = false;
  }
  renderBody(article.body);
  $("articleTags").replaceChildren(...(article.tags || []).map(tag => {
    const element = document.createElement("span");
    element.textContent = `#${tag}`;
    return element;
  }));
  $("articleState").hidden = true;
  $("articlePage").hidden = false;
}

function setLikeState(liked) {
  state.liked = liked;
  ["likeArticle", "likeArticleMobile"].forEach(id => {
    $(id).classList.toggle("active", liked);
    $(id).setAttribute("aria-pressed", String(liked));
  });
  $("likeArticle").querySelector("span").textContent = liked ? "♥" : "♡";
  $("likeArticleMobile").firstChild.textContent = liked ? "♥ إعجاب " : "♡ إعجاب ";
}

async function toggleLike() {
  if (!state.user || state.profile?.status !== "active") {
    toast("سجل الدخول أولاً لإضافة إعجاب.");
    return;
  }
  const likeRef = doc(db, "articles", articleId, "likes", state.user.uid);
  try {
    if (state.liked) await deleteDoc(likeRef);
    else await setDoc(likeRef, { userUid: state.user.uid, createdAt: serverTimestamp() });
  } catch (error) {
    console.error("Unable to update like", error);
    toast("تعذر تحديث الإعجاب حالياً.");
  }
}

async function shareArticle() {
  const data = { title: state.article?.title || "مقال PikLance", text: state.article?.excerpt || "", url: location.href };
  try {
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(location.href);
      toast("تم نسخ رابط المقال.");
    }
  } catch (error) {
    if (error.name !== "AbortError") toast("تعذرت المشاركة، حاول نسخ الرابط يدوياً.");
  }
}

function renderComments(snapshot = null) {
  if (snapshot) state.comments = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  const comments = [...state.comments];
  comments.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  $("commentsCount").textContent = comments.length.toLocaleString("ar-SY");
  if (!comments.length) {
    $("commentsList").innerHTML = '<div class="comment-empty">كن أول من يشارك رأيه في هذا المقال.</div>';
    return;
  }
  $("commentsList").replaceChildren(...comments.map(comment => {
    const item = document.createElement("article");
    item.className = "comment-item";
    const user = document.createElement("div");
    user.className = "comment-user";
    const avatar = document.createElement("span");
    avatar.className = "comment-avatar";
    avatar.textContent = (comment.authorName || "م").charAt(0);
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = comment.authorName || "مستخدم PikLance";
    const date = document.createElement("small");
    date.textContent = formatDate(comment.createdAt);
    copy.append(name, date);
    user.append(avatar, copy);
    if (state.user && (comment.authorUid === state.user.uid || state.profile?.role === "admin")) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "comment-delete";
      remove.textContent = "حذف";
      remove.addEventListener("click", () => {
        openArticleConfirm({
          title: "حذف التعليق؟",
          message: "سيتم حذف هذا التعليق نهائياً من المقال.",
          actionLabel: "حذف التعليق",
          onConfirm: async () => {
            await deleteDoc(doc(db, "articles", articleId, "comments", comment.id));
            state.comments = state.comments.filter(item => item.id !== comment.id);
            renderComments();
            toast("تم حذف التعليق.");
          }
        });
      });
      user.append(remove);
    }
    const text = document.createElement("p");
    text.textContent = comment.text;
    item.append(user, text);
    return item;
  }));
}

async function registerView() {
  if (!state.article || !state.user || state.profile?.status !== "active") return;
  const viewedKey = `piklance_article_viewed_${articleId}`;
  if (localStorage.getItem(viewedKey)) return;
  try {
    await updateDoc(doc(db, "articles", articleId), { views: increment(1) });
    localStorage.setItem(viewedKey, "1");
    state.article.views = Number(state.article.views || 0) + 1;
    $("articleViews").textContent = `${state.article.views.toLocaleString("ar-SY")} مشاهدة`;
  } catch (error) {
    console.warn("Unable to register article view", error);
  }
}

$("commentForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.user || state.profile?.status !== "active") {
    toast("يجب تسجيل الدخول لإضافة تعليق.");
    return;
  }
  const text = $("commentText").value.trim();
  if (!text) return;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await addDoc(collection(db, "articles", articleId, "comments"), {
      authorUid: state.user.uid,
      authorName: state.profile.name || state.user.email || "مستخدم PikLance",
      text,
      status: "published",
      createdAt: serverTimestamp()
    });
    event.currentTarget.reset();
    toast("تم نشر تعليقك.");
  } catch (error) {
    console.error("Unable to publish comment", error);
    toast("تعذر نشر التعليق حالياً.");
  } finally {
    button.disabled = false;
  }
});

["likeArticle", "likeArticleMobile"].forEach(id => $(id).addEventListener("click", toggleLike));
["shareArticle", "shareArticleMobile"].forEach(id => $(id).addEventListener("click", shareArticle));
$("articleConfirmAction").addEventListener("click", runArticleConfirmAction);
document.querySelectorAll("[data-close-article-confirm]").forEach(control => control.addEventListener("click", closeArticleConfirm));
$("articleConfirmModal").addEventListener("click", event => { if (event.target === $("articleConfirmModal")) closeArticleConfirm(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeArticleConfirm(); });

if (!articleId) {
  $("articleState").textContent = "المقال غير موجود.";
} else {
  try {
    const snapshot = await getDoc(doc(db, "articles", articleId));
    if (!snapshot.exists() || snapshot.data().status !== "published") {
      $("articleState").textContent = "المقال غير موجود أو لم يعد منشوراً.";
    } else {
      state.article = { id: snapshot.id, ...snapshot.data() };
      renderArticle(state.article);
      onSnapshot(collection(db, "articles", articleId, "likes"), likes => {
        state.likeIds = likes.docs.map(item => item.id);
        const count = likes.size.toLocaleString("ar-SY");
        $("likesCount").textContent = count;
        $("likesCountMobile").textContent = count;
        setLikeState(Boolean(state.user && state.likeIds.includes(state.user.uid)));
      });
      onSnapshot(query(collection(db, "articles", articleId, "comments"), where("status", "==", "published")), renderComments);
      registerView();
    }
  } catch (error) {
    console.error("Unable to load article", error);
    $("articleState").textContent = "تعذر تحميل المقال حالياً.";
  }
}

onAuthStateChanged(auth, async user => {
  state.user = user;
  state.profile = null;
  if (user) {
    const profile = await getDoc(doc(db, "users", user.uid));
    if (profile.exists()) state.profile = profile.data();
  }
  $("commentHint").textContent = user && state.profile?.status === "active"
    ? `سيظهر تعليقك باسم ${state.profile.name || user.email}.`
    : "يجب تسجيل الدخول بحساب نشط لإضافة تعليق.";
  setLikeState(Boolean(user && state.likeIds.includes(user.uid)));
  renderComments();
  registerView();
});
