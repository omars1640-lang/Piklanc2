import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getDownloadURL, ref } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { db, storage } from "./firebase.js";
import { refreshImageFromStorage, resolveProfileAvatar } from "./avatar-utils.js";
import { formatStars } from "./reviews.js";

const uid = new URLSearchParams(location.search).get("uid") || "";
const PORTFOLIO_COLLECTION = "freelancerPortfolio";
const LEGACY_PORTFOLIO_COLLECTION = "portfolioItems";
const PROFILE_PAGE_SIZE = 12;
const LEGACY_PORTFOLIO_LIMIT = 50;
const $ = id => document.getElementById(id);
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
const pageState = () => ({ items: [], cursor: null, hasMore: false, loading: false });
const state = {
  profile: null,
  legacyPortfolio: [],
  services: pageState(),
  portfolio: pageState(),
  reviews: pageState()
};
const specialtyLabels = {
  design: "مصمم جرافيك", web: "مطور برمجيات وويب", writing: "كاتب ومحرر",
  marketing: "مسوق رقمي", audio: "متخصص صوتيات", video: "منتج فيديو"
};

function showToast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $("toast").classList.remove("show"), 2800);
}

function initials(name) {
  return (name || "م").trim().charAt(0).toUpperCase();
}

function skillTag(value) {
  const tag = document.createElement("span");
  tag.textContent = value;
  return tag;
}

function badgeChip(badge) {
  const chip = document.createElement("span");
  chip.className = `profile-extra-badge ${badge.tone || ""}`.trim();
  chip.textContent = `${badge.icon || "◆"} ${badge.label || badge.id || "شارة"}`;
  return chip;
}

function renderAvatar(profile) {
  $("profileInitial").textContent = initials(profile.name);
  if (!profile.avatar) return;
  const image = document.createElement("img");
  image.src = profile.avatar;
  image.alt = profile.name;
  image.addEventListener("load", () => { $("profileInitial").hidden = true; });
  image.addEventListener("error", async () => {
    const recovered = await refreshImageFromStorage(image, uid, profile);
    if (!recovered) $("profileInitial").hidden = false;
  });
  $("profileAvatar").appendChild(image);
}

function serviceCard(service) {
  const card = document.createElement("a");
  card.className = "service-card";
  card.href = `service-details.html?id=${encodeURIComponent(service.id)}`;
  const cover = document.createElement("div");
  cover.className = "service-cover";
  const image = document.createElement("img");
  image.src = service.imageUrl || "assets/service-placeholder.svg";
  image.alt = service.title;
  image.loading = "lazy";
  image.addEventListener("error", () => { image.src = "assets/service-placeholder.svg"; });
  cover.appendChild(image);
  const copy = document.createElement("div");
  copy.className = "service-copy";
  const category = document.createElement("span");
  category.textContent = service.category || "خدمات رقمية";
  const title = document.createElement("h3");
  title.textContent = service.title;
  const footer = document.createElement("div");
  footer.className = "service-footer";
  const price = document.createElement("strong");
  price.textContent = `${Number(service.price || 0).toLocaleString("en-US")} ل.س`;
  const delivery = document.createElement("span");
  delivery.textContent = `${Number(service.deliveryDays || 1)} يوم`;
  footer.append(price, delivery);
  copy.append(category, title, footer);
  card.append(cover, copy);
  return card;
}

function closePortfolioModal() {
  $("portfolioModal").classList.remove("open");
  $("portfolioModal").setAttribute("aria-hidden", "true");
}

function openPortfolioModal(item) {
  $("modalProjectImage").src = item.mediaType === "video"
    ? "assets/service-placeholder.svg"
    : (item.mediaUrl || item.imageUrl || "assets/service-placeholder.svg");
  $("modalProjectImage").alt = item.title || "عمل منجز";
  $("modalProjectCategory").textContent = item.category || "مشروع";
  $("modalProjectTitle").textContent = item.title || "عمل منجز";
  $("modalProjectDescription").textContent = item.description || "";
  $("modalProjectTags").replaceChildren();
  $("portfolioModal").classList.add("open");
  $("portfolioModal").setAttribute("aria-hidden", "false");
}

function portfolioCard(item, featured = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = featured ? "featured-item" : "portfolio-item";
  const isVideo = item.mediaType === "video";
  const media = document.createElement(isVideo ? "video" : "img");
  if (isVideo) {
    media.src = item.mediaUrl || "";
    media.muted = true;
    media.preload = "metadata";
    media.playsInline = true;
  } else {
    media.src = item.mediaUrl || item.imageUrl || "assets/service-placeholder.svg";
    media.alt = item.title || "عمل منجز";
    media.loading = "lazy";
    media.addEventListener("error", () => { media.src = "assets/service-placeholder.svg"; });
  }
  const overlay = document.createElement("span");
  overlay.className = "work-overlay";
  const title = document.createElement("strong");
  title.textContent = item.title || "عمل منجز";
  const category = document.createElement("span");
  category.textContent = item.category || "مشروع";
  overlay.append(title, category);
  button.append(media, overlay);
  button.addEventListener("click", () => openPortfolioModal(item));
  return button;
}

function careerCard(item) {
  const row = document.createElement("article");
  row.className = "experience-item";
  const dot = document.createElement("span");
  dot.className = "experience-dot";
  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = item.title || "محطة مهنية";
  const meta = document.createElement("p");
  meta.textContent = [item.organization, item.period].filter(Boolean).join(" · ") || "مسيرة مهنية";
  const description = document.createElement("small");
  description.textContent = item.description || "";
  copy.append(title, meta, description);
  row.append(dot, copy);
  return row;
}

function renderReviewCard(review) {
  const card = document.createElement("article");
  card.className = "review-card";
  const head = document.createElement("div");
  head.className = "review-head";
  const user = document.createElement("div");
  user.className = "review-user";
  const avatar = document.createElement("span");
  avatar.className = "review-avatar";
  avatar.textContent = initials(review.reviewerName || "ع");
  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = review.reviewerName || "عميل PikLance";
  const meta = document.createElement("small");
  meta.textContent = [review.serviceTitle || "طلب خدمة", toDate(review.createdAt)?.toLocaleDateString("ar-SY")].filter(Boolean).join(" · ");
  copy.append(name, meta);
  user.append(avatar, copy);
  const stars = document.createElement("span");
  stars.className = "review-stars";
  stars.textContent = formatStars(review.rating);
  head.append(user, stars);
  const comment = document.createElement("p");
  comment.textContent = review.comment || "ترك العميل تقييماً بدون تعليق نصي.";
  card.append(head, comment);
  return card;
}

function renderReviews(reviews) {
  const loadedCount = reviews.length;
  const storedCount = Number(state.profile?.reviewsCount || 0);
  const count = Math.max(loadedCount, storedCount);
  const loadedAverage = loadedCount ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / loadedCount : 0;
  const storedAverage = Number(state.profile?.rating);
  const average = Number.isFinite(storedAverage) && storedCount ? storedAverage : loadedAverage;
  const rounded = Math.max(0, Math.min(5, Math.round(average)));
  $("reviewsCount").textContent = state.reviews.hasMore && count === loadedCount ? `${loadedCount}+` : count;
  $("ratingStat").textContent = average.toFixed(1);
  $("reviewAverage").textContent = average.toFixed(1);
  $("reviewStars").textContent = `${"★".repeat(rounded)}${"☆".repeat(5 - rounded)}`;
  $("reviewTotal").textContent = count;
  $("reviewsList").replaceChildren(...reviews.map(renderReviewCard));
  $("reviewsEmpty").hidden = loadedCount > 0;
  $("ratingBars").replaceChildren(...[5, 4, 3, 2, 1].map(stars => {
    const row = document.createElement("div");
    row.className = "rating-row";
    const label = document.createElement("span");
    label.textContent = `${stars} نجوم`;
    const track = document.createElement("div");
    track.className = "rating-track";
    const fill = document.createElement("span");
    const ratingCount = reviews.filter(review => Number(review.rating) === stars).length;
    fill.style.width = `${loadedCount ? Math.round(ratingCount / loadedCount * 100) : 0}%`;
    track.appendChild(fill);
    const total = document.createElement("b");
    total.textContent = ratingCount;
    row.append(label, track, total);
    return row;
  }));
  updateLoadMoreButton("reviewsLoadMore", state.reviews, "تحميل تقييمات إضافية");
}

function combinedPortfolio() {
  const items = [...state.portfolio.items, ...state.legacyPortfolio];
  const unique = new Map(items.map(item => [`${item.sourceCollection || PORTFOLIO_COLLECTION}:${item.id}`, item]));
  return [...unique.values()].sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}

function renderServicesSection() {
  const services = state.services.items;
  $("servicesCount").textContent = state.services.hasMore ? `${services.length}+` : services.length;
  $("servicesGrid").replaceChildren(...services.map(serviceCard));
  $("servicesEmpty").hidden = services.length > 0;
  updateLoadMoreButton("servicesLoadMore", state.services, "تحميل خدمات إضافية");
}

function renderPortfolioSection() {
  const portfolio = combinedPortfolio();
  $("portfolioCount").textContent = state.portfolio.hasMore ? `${portfolio.length}+` : portfolio.length;
  $("featuredPortfolio").replaceChildren(...portfolio.slice(0, 3).map(item => portfolioCard(item, true)));
  $("portfolioGrid").replaceChildren(...portfolio.map(item => portfolioCard(item)));
  $("featuredEmpty").hidden = portfolio.length > 0;
  $("portfolioEmpty").hidden = portfolio.length > 0;
  updateLoadMoreButton("portfolioLoadMore", state.portfolio, "تحميل أعمال إضافية");
}

function updateLoadMoreButton(id, page, label) {
  const button = $(id);
  if (!button) return;
  button.hidden = !page.hasMore;
  button.disabled = page.loading;
  button.textContent = page.loading ? "جاري التحميل..." : label;
}

function renderProfile(profile) {
  const reviews = state.reviews.items;
  const specialty = specialtyLabels[profile.specialty] || profile.headline || "مستقل للخدمات الرقمية";
  const skills = Array.isArray(profile.skills) && profile.skills.length ? profile.skills : [specialty];
  const completed = Number(profile.completedServices || profile.rank?.completedServices || 0);
  const rating = reviews.length ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length : Number(profile.rating || 0);
  document.title = `${profile.name || "مستقل PikLance"} - PikLance`;
  $("profileName").textContent = profile.name || "مستقل PikLance";
  $("profileHeadline").textContent = specialty;
  $("sidebarSpecialty").textContent = specialty;
  $("profileLocation").textContent = profile.location || "سوريا";
  $("profileResponse").textContent = "التواصل عبر رسائل المنصة";
  $("memberSince").textContent = profile.memberSince || "2026";
  $("profileLanguages").textContent = profile.languages || "العربية";
  $("completedStat").textContent = completed;
  $("ratingStat").textContent = rating.toFixed(1);
  $("successStat").textContent = completed ? `${Number(profile.successRate || 100)}%` : "--";
  $("responseStat").textContent = profile.responseTime || "--";
  $("repeatStat").textContent = completed ? `${Number(profile.repeatRate || 0)}%` : "--";
  $("heroSkills").replaceChildren(...skills.slice(0, 4).map(skillTag));
  $("skillsCloud").replaceChildren(...skills.map(skillTag));
  renderAvatar(profile);

  const rank = profile.rank;
  $("profileRankBadge").hidden = !rank?.label;
  if (rank?.label) $("profileRankBadge").textContent = rank.label;
  const extraBadges = profile.badges && typeof profile.badges === "object" ? Object.values(profile.badges) : [];
  $("profileExtraBadges").replaceChildren(...extraBadges.map(badgeChip));

  const about = document.createElement("p");
  about.textContent = profile.about || "مستقل موثّق على PikLance. ستظهر هنا نبذة الملف عند إضافتها من إعدادات الحساب.";
  $("profileAbout").replaceChildren(about);
  renderServicesSection();
  renderPortfolioSection();
  renderReviews(reviews);
  const careerItems = Array.isArray(profile.careerItems) ? profile.careerItems.filter(item => item?.title).slice(0, 8) : [];
  $("experienceList").replaceChildren(...(careerItems.length ? careerItems.map(careerCard) : [careerCard({
    title: "المسيرة المهنية قيد التحديث",
    organization: "PikLance",
    period: "قريباً",
    description: "سيضيف المستقل خبراته وشهاداته من لوحة التحكم."
  })]));

  const messageUrl = `messages.html?withUid=${encodeURIComponent(uid)}`;
  $("messageButton").href = messageUrl;
  $("sideMessageButton").href = messageUrl;
}

function showNotFound() {
  $("pageLoader").classList.add("hidden");
  document.querySelector("main").innerHTML = '<section style="padding:150px 24px;text-align:center"><h1>الملف غير موجود</h1><p>قد يكون الحساب غير نشط أو الرابط غير صحيح.</p><a href="freelancers.html">العودة إلى المستقلين</a></section>';
}

function profileContentQuery(kind, cursor = null) {
  const configurations = {
    services: {
      collectionName: "services",
      constraints: [where("ownerUid", "==", uid), where("status", "==", "published")]
    },
    portfolio: {
      collectionName: PORTFOLIO_COLLECTION,
      constraints: [where("ownerUid", "==", uid), where("published", "==", true)]
    },
    reviews: {
      collectionName: "reviews",
      constraints: [
        where("targetUid", "==", uid),
        where("targetType", "==", "freelancer"),
        where("status", "==", "published")
      ]
    }
  };
  const configuration = configurations[kind];
  const constraints = [...configuration.constraints, orderBy("createdAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(PROFILE_PAGE_SIZE + 1));
  return query(collection(db, configuration.collectionName), ...constraints);
}

function applyPageSnapshot(kind, snapshot, reset = false) {
  const page = state[kind];
  const visibleDocs = snapshot.docs.slice(0, PROFILE_PAGE_SIZE);
  const additions = visibleDocs.map(item => ({
    id: item.id,
    ...(kind === "portfolio" ? { sourceCollection: PORTFOLIO_COLLECTION } : {}),
    ...item.data()
  }));
  const existing = reset ? [] : page.items;
  const additionsById = new Map(additions.map(item => [item.id, item]));
  page.items = [...existing.filter(item => !additionsById.has(item.id)), ...additions];
  page.cursor = visibleDocs.at(-1) || page.cursor;
  page.hasMore = snapshot.docs.length > PROFILE_PAGE_SIZE;
}

async function hydratePortfolioImages(items) {
  await Promise.all(items.map(async item => {
    const mediaPath = item.mediaPath || item.imagePath;
    if ((item.mediaUrl || item.imageUrl) || !mediaPath) return;
    const url = await getDownloadURL(ref(storage, mediaPath)).catch(() => "");
    item.mediaUrl = url;
    if (!item.mediaType || item.mediaType === "image") item.imageUrl = url;
  }));
}

async function loadMoreProfileItems(kind) {
  const page = state[kind];
  if (page.loading || !page.hasMore || !page.cursor) return;
  page.loading = true;
  if (kind === "services") renderServicesSection();
  if (kind === "portfolio") renderPortfolioSection();
  if (kind === "reviews") renderReviews(state.reviews.items);
  try {
    const snapshot = await getDocs(profileContentQuery(kind, page.cursor));
    applyPageSnapshot(kind, snapshot);
    if (kind === "portfolio") await hydratePortfolioImages(state.portfolio.items);
  } catch (error) {
    console.error(`Unable to load more profile ${kind}`, error);
    showToast("تعذر تحميل عناصر إضافية. حاول مجدداً.");
  } finally {
    page.loading = false;
    if (kind === "services") renderServicesSection();
    if (kind === "portfolio") renderPortfolioSection();
    if (kind === "reviews") renderReviews(state.reviews.items);
  }
}

async function loadProfile() {
  if (!uid) {
    showNotFound();
    return;
  }
  try {
    const profileSnapshot = await getDoc(doc(db, "publicProfiles", uid));
    if (!profileSnapshot.exists()) {
      showNotFound();
      return;
    }
    const profile = profileSnapshot.data();
    if (profile.accountType !== "freelancer") {
      showNotFound();
      return;
    }
    const avatarPromise = resolveProfileAvatar(uid, profile);
    const [servicesSnapshot, portfolioSnapshot, legacyPortfolioSnapshot, reviewsSnapshot] = await Promise.all([
      getDocs(profileContentQuery("services")),
      getDocs(profileContentQuery("portfolio")),
      getDocs(query(
        collection(db, LEGACY_PORTFOLIO_COLLECTION),
        where("ownerUid", "==", uid),
        where("published", "==", true),
        orderBy("createdAt", "desc"),
        limit(LEGACY_PORTFOLIO_LIMIT)
      )).catch(() => ({ docs: [] })),
      getDocs(profileContentQuery("reviews")).catch(() => ({ docs: [] }))
    ]);
    applyPageSnapshot("services", servicesSnapshot, true);
    applyPageSnapshot("portfolio", portfolioSnapshot, true);
    applyPageSnapshot("reviews", reviewsSnapshot, true);
    state.profile = profile;
    state.legacyPortfolio = legacyPortfolioSnapshot.docs.map(item => ({
      id: item.id,
      sourceCollection: LEGACY_PORTFOLIO_COLLECTION,
      ...item.data()
    }));
    profile.avatar = await avatarPromise;
    await hydratePortfolioImages(combinedPortfolio());
    if (profile.status !== "active" && !state.services.items.length) {
      showNotFound();
      return;
    }
    renderProfile(profile);
    $("pageLoader").classList.add("hidden");
  } catch (error) {
    console.error("Unable to load freelancer profile", error);
    showNotFound();
  }
}

function showTab(tabName) {
  document.querySelectorAll(".profile-tabs button").forEach(button => button.classList.toggle("active", button.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${tabName}`));
}

document.querySelectorAll(".profile-tabs button").forEach(button => button.addEventListener("click", () => showTab(button.dataset.tab)));
document.querySelectorAll("[data-tab-target]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.tabTarget)));
document.querySelectorAll("[data-close-portfolio]").forEach(control => control.addEventListener("click", closePortfolioModal));
$("servicesLoadMore").addEventListener("click", () => loadMoreProfileItems("services"));
$("portfolioLoadMore").addEventListener("click", () => loadMoreProfileItems("portfolio"));
$("reviewsLoadMore").addEventListener("click", () => loadMoreProfileItems("reviews"));
$("shareButton").addEventListener("click", async () => {
  try {
    if (navigator.share) await navigator.share({ title: document.title, url: location.href });
    else {
      await navigator.clipboard.writeText(location.href);
      showToast("تم نسخ رابط الملف.");
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("تعذر مشاركة الرابط.");
  }
});

loadProfile();
