import {
  collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getDownloadURL, ref } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { db, storage } from "./firebase.js";
import { refreshImageFromStorage, resolveProfileAvatar } from "./avatar-utils.js";
import { formatStars } from "./reviews.js";

const uid = new URLSearchParams(location.search).get("uid") || "";
const PORTFOLIO_COLLECTION = "freelancerPortfolio";
const LEGACY_PORTFOLIO_COLLECTION = "portfolioItems";
const $ = id => document.getElementById(id);
const toDate = value => value?.toDate?.() || (value ? new Date(value) : null);
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
  const count = reviews.length;
  const average = count ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / count : 0;
  const rounded = Math.max(0, Math.min(5, Math.round(average)));
  $("reviewsCount").textContent = count;
  $("ratingStat").textContent = average.toFixed(1);
  $("reviewAverage").textContent = average.toFixed(1);
  $("reviewStars").textContent = `${"★".repeat(rounded)}${"☆".repeat(5 - rounded)}`;
  $("reviewTotal").textContent = count;
  $("reviewsList").replaceChildren(...reviews.map(renderReviewCard));
  $("reviewsEmpty").hidden = count > 0;
  $("ratingBars").replaceChildren(...[5, 4, 3, 2, 1].map(stars => {
    const row = document.createElement("div");
    row.className = "rating-row";
    const label = document.createElement("span");
    label.textContent = `${stars} نجوم`;
    const track = document.createElement("div");
    track.className = "rating-track";
    const fill = document.createElement("span");
    const ratingCount = reviews.filter(review => Number(review.rating) === stars).length;
    fill.style.width = `${count ? Math.round(ratingCount / count * 100) : 0}%`;
    track.appendChild(fill);
    const total = document.createElement("b");
    total.textContent = ratingCount;
    row.append(label, track, total);
    return row;
  }));
}

function renderProfile(profile, services, portfolio, reviews = []) {
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
  $("portfolioCount").textContent = portfolio.length;
  $("servicesCount").textContent = services.length;
  $("reviewsCount").textContent = reviews.length || Number(profile.reviewsCount || 0);
  $("servicesGrid").replaceChildren(...services.map(serviceCard));
  $("servicesEmpty").hidden = services.length > 0;

  $("featuredPortfolio").replaceChildren(...portfolio.slice(0, 3).map(item => portfolioCard(item, true)));
  $("portfolioGrid").replaceChildren(...portfolio.map(item => portfolioCard(item)));
  $("featuredEmpty").hidden = portfolio.length > 0;
  $("portfolioEmpty").hidden = portfolio.length > 0;
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

async function loadProfile() {
  if (!uid) {
    showNotFound();
    return;
  }
  try {
    const [profileSnapshot, servicesSnapshot, portfolioSnapshot, legacyPortfolioSnapshot, reviewsSnapshot] = await Promise.all([
      getDoc(doc(db, "publicProfiles", uid)),
      getDocs(query(collection(db, "services"), where("status", "==", "published"))),
      getDocs(query(collection(db, PORTFOLIO_COLLECTION), where("published", "==", true))),
      getDocs(query(collection(db, LEGACY_PORTFOLIO_COLLECTION), where("published", "==", true))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, "reviews"), where("status", "==", "published"))).catch(() => ({ docs: [] }))
    ]);
    if (!profileSnapshot.exists()) {
      showNotFound();
      return;
    }
    const profile = profileSnapshot.data();
    profile.avatar = await resolveProfileAvatar(uid, profile);
    const services = servicesSnapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.ownerUid === uid);
    const portfolio = [
      ...portfolioSnapshot.docs.map(item => ({ id: item.id, ...item.data() })),
      ...legacyPortfolioSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    ]
      .filter(item => item.ownerUid === uid && item.published === true)
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const reviews = reviewsSnapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.targetUid === uid && item.targetType === "freelancer")
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    await Promise.all(portfolio.map(async item => {
      const mediaPath = item.mediaPath || item.imagePath;
      if ((item.mediaUrl || item.imageUrl) || !mediaPath) return;
      const url = await getDownloadURL(ref(storage, mediaPath)).catch(() => "");
      item.mediaUrl = url;
      if (!item.mediaType || item.mediaType === "image") item.imageUrl = url;
    }));
    if (profile.accountType !== "freelancer" || (profile.status !== "active" && !services.length)) {
      showNotFound();
      return;
    }
    renderProfile(profile, services, portfolio, reviews);
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
