import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { resolveProfileAvatar } from "./avatar-utils.js";

const specialtyLabels = {
  design: "تصميم", web: "برمجة وتطوير", writing: "كتابة وترجمة",
  marketing: "تسويق رقمي", audio: "صوتيات", video: "فيديو"
};
const defaultCategories = [
  { id: "design", name: "تصميم", aliases: ["design"] },
  { id: "web", name: "برمجة وتطوير", aliases: ["web", "code", "برمجة"] },
  { id: "writing", name: "كتابة وترجمة", aliases: ["writing", "write", "كتابة"] },
  { id: "marketing", name: "تسويق رقمي", aliases: ["marketing", "market", "تسويق"] },
  { id: "audio", name: "صوتيات", aliases: ["audio", "صوت"] },
  { id: "video", name: "فيديو وأنيميشن", aliases: ["video", "فيديو"] }
];
const $ = id => document.getElementById(id);
const PAGE_SIZE = 9;
const requestedPage = Math.max(1, Number.parseInt(new URLSearchParams(location.search).get("page") || "1", 10) || 1);
const state = { freelancers: [], filtered: [], categories: new Map(), currentPage: requestedPage };

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/[ـًٌٍَُِّْ]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function textList(value) {
  if (Array.isArray(value)) return value.flatMap(textList);
  if (value && typeof value === "object") return Object.values(value).flatMap(textList);
  return value == null ? [] : [String(value)];
}

function profileText(profile) {
  return normalized([
    profile.name, profile.headline, profile.about, profile.specialty, specialtyLabels[profile.specialty],
    ...textList(profile.skills), ...textList(profile.keywords), ...textList(profile.careerItems),
    ...textList(profile.serviceCategories), ...textList(profile.serviceTitles)
  ].filter(Boolean).join(" "));
}

function categoryMatches(profile, categoryId) {
  if (categoryId === "all") return true;
  const category = state.categories.get(categoryId);
  if (!category) return false;
  const values = [
    profile.specialty, specialtyLabels[profile.specialty], ...textList(profile.skills),
    ...textList(profile.keywords), ...textList(profile.serviceCategories)
  ].map(normalized).filter(Boolean);
  return category.terms.some(term => values.some(value => value === term || value.includes(term) || term.includes(value)));
}

function populateCategoryFilter(items) {
  const definitions = [...defaultCategories, ...items.map(item => ({
    id: item.id,
    name: item.name || item.slug || item.id,
    aliases: [item.slug, item.id]
  }))];
  state.categories.clear();
  const options = [new Option("كل التخصصات", "all")];
  const usedNames = new Set();
  definitions.forEach(item => {
    const nameKey = normalized(item.name);
    if (!nameKey || usedNames.has(nameKey)) return;
    usedNames.add(nameKey);
    const id = String(item.id || nameKey);
    state.categories.set(id, { ...item, terms: [...new Set([item.name, ...(item.aliases || [])].map(normalized).filter(Boolean))] });
    options.push(new Option(item.name, id));
  });
  const select = $("categoryFilter");
  const current = select.value;
  select.replaceChildren(...options);
  if (state.categories.has(current)) select.value = current;
}

function initial(name) {
  return (name || "م").trim().charAt(0).toUpperCase();
}

function card(profile) {
  const link = document.createElement("a");
  link.className = "freelancer-card";
  link.href = `freelancer-profile.html?uid=${encodeURIComponent(profile.id)}`;
  const avatar = document.createElement("div");
  avatar.className = "freelancer-avatar";
  if (profile.avatar) avatar.style.backgroundImage = `url("${profile.avatar.replaceAll('"', "%22")}")`;
  else avatar.textContent = initial(profile.name);
  const name = document.createElement("h3");
  name.className = "freelancer-name";
  name.textContent = profile.name || "مستقل PikLance";
  const title = document.createElement("p");
  title.className = "freelancer-title";
  title.textContent = specialtyLabels[profile.specialty] || profile.headline || "مستقل للخدمات الرقمية";
  const stats = document.createElement("div");
  stats.className = "freelancer-stats";
  stats.innerHTML = `<div><span class="stat-value">★ ${Number(profile.rating || 0).toFixed(1)}</span><span class="stat-label">تقييم</span></div><div><span class="stat-value">${Number(profile.completedServices || profile.rank?.completedServices || 0)}</span><span class="stat-label">خدمة منجزة</span></div>`;
  const skills = document.createElement("div");
  skills.className = "freelancer-skills";
  const skillList = Array.isArray(profile.skills) && profile.skills.length
    ? profile.skills.slice(0, 3)
    : [specialtyLabels[profile.specialty] || "خدمات رقمية"];
  skillList.forEach(value => {
    const tag = document.createElement("span");
    tag.className = "skill-tag";
    tag.textContent = value;
    skills.appendChild(tag);
  });
  const action = document.createElement("span");
  action.className = "btn btn-primary";
  action.textContent = "عرض الملف";
  link.append(avatar, name, title, stats, skills, action);
  return link;
}

function pageButton(label, page, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "page-link";
  button.textContent = label;
  button.disabled = options.disabled === true;
  button.classList.toggle("active", options.active === true);
  if (options.active) button.setAttribute("aria-current", "page");
  button.setAttribute("aria-label", options.label || `الصفحة ${label}`);
  button.addEventListener("click", () => goToPage(page));
  return button;
}

function renderPagination(totalItems) {
  const pagination = $("freelancersPagination");
  const pageCount = Math.ceil(totalItems / PAGE_SIZE);
  pagination.hidden = pageCount <= 1;
  if (pageCount <= 1) {
    pagination.replaceChildren();
    return;
  }
  state.currentPage = Math.min(Math.max(1, state.currentPage), pageCount);
  const buttons = [pageButton("‹", state.currentPage - 1, { disabled: state.currentPage === 1, label: "الصفحة السابقة" })];
  for (let page = 1; page <= pageCount; page += 1) {
    buttons.push(pageButton(String(page), page, { active: page === state.currentPage }));
  }
  buttons.push(pageButton("›", state.currentPage + 1, { disabled: state.currentPage === pageCount, label: "الصفحة التالية" }));
  pagination.replaceChildren(...buttons);
}

function render(items) {
  if (!items.length) {
    $("freelancersContainer").innerHTML = '<div class="marketplace-empty"><strong>لا يوجد مستقلون مطابقون</strong><p>جرّب تغيير معايير البحث.</p></div>';
    renderPagination(0);
    return;
  }
  state.currentPage = Math.min(state.currentPage, Math.ceil(items.length / PAGE_SIZE));
  const start = (state.currentPage - 1) * PAGE_SIZE;
  $("freelancersContainer").replaceChildren(...items.slice(start, start + PAGE_SIZE).map(card));
  renderPagination(items.length);
}

function goToPage(page) {
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  const nextPage = Math.min(Math.max(1, page), pageCount);
  if (nextPage === state.currentPage) return;
  state.currentPage = nextPage;
  const url = new URL(location.href);
  if (nextPage === 1) url.searchParams.delete("page");
  else url.searchParams.set("page", String(nextPage));
  history.replaceState({}, "", url);
  render(state.filtered);
  $("freelancersContainer").scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyFilters({ resetPage = false } = {}) {
  if (resetPage) state.currentPage = 1;
  const term = $("searchInput").value.trim().toLowerCase();
  const category = $("categoryFilter").value;
  const minimumRating = Number($("ratingFilter").value === "all" ? 0 : $("ratingFilter").value);
  state.filtered = state.freelancers.filter(profile => {
    const haystack = profileText(profile);
    return (!term || haystack.includes(normalized(term)))
      && categoryMatches(profile, category)
      && Number(profile.rating || 0) >= minimumRating;
  });
  render(state.filtered);
}

async function loadFreelancers() {
  try {
    const [snapshot, servicesSnapshot, categoriesSnapshot] = await Promise.all([
      getDocs(query(collection(db, "publicProfiles"), where("accountType", "==", "freelancer"))),
      getDocs(query(collection(db, "services"), where("status", "==", "published"))),
      getDocs(query(collection(db, "serviceCategories"), where("active", "==", true)))
    ]);
    const ownerServices = new Map();
    servicesSnapshot.docs.forEach(item => {
      const service = item.data();
      if (!ownerServices.has(service.ownerUid)) ownerServices.set(service.ownerUid, []);
      ownerServices.get(service.ownerUid).push(service);
    });
    const publishedOwners = new Set(ownerServices.keys());
    populateCategoryFilter(categoriesSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.active !== false));
    const freelancers = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(profile => profile.status === "active" || publishedOwners.has(profile.id));
    state.freelancers = await Promise.all(freelancers.map(async profile => ({
      ...profile,
      serviceCategories: (ownerServices.get(profile.id) || []).map(service => service.category).filter(Boolean),
      serviceTitles: (ownerServices.get(profile.id) || []).map(service => service.title).filter(Boolean),
      avatar: await resolveProfileAvatar(profile.id, profile)
    })));
    applyFilters();
  } catch (error) {
    console.error("Unable to load freelancers", error);
    $("freelancersContainer").innerHTML = '<div class="marketplace-empty"><strong>تعذر تحميل المستقلين</strong><p>تحقق من نشر قواعد وفهارس Firebase الجديدة.</p></div>';
  }
}

$("searchInput").addEventListener("input", () => applyFilters({ resetPage: true }));
$("categoryFilter").addEventListener("change", () => applyFilters({ resetPage: true }));
$("ratingFilter").addEventListener("change", () => applyFilters({ resetPage: true }));
$("freelancerSearchButton").addEventListener("click", () => applyFilters({ resetPage: true }));
loadFreelancers();
