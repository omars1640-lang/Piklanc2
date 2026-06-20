import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

const categoryAliases = {
  design: "تصميم", code: "برمجة", web: "برمجة", write: "كتابة",
  writing: "كتابة", market: "تسويق", marketing: "تسويق",
  audio: "صوتيات", video: "فيديو"
};

const state = { services: [] };
const $ = id => document.getElementById(id);

function normalizedCategory(value) {
  return categoryAliases[value] || value || "أخرى";
}

function categoryFilterValue(value) {
  return {
    "تصميم": "design", "برمجة": "code", "كتابة": "write",
    "تسويق": "market", "صوتيات": "audio", "فيديو": "video"
  }[normalizedCategory(value)] || "other";
}

function initial(name) {
  return (name || "م").trim().charAt(0).toUpperCase();
}

function serviceCard(service) {
  const link = document.createElement("a");
  link.className = "service-card";
  link.href = `service-details.html?id=${encodeURIComponent(service.id)}`;

  const media = document.createElement("div");
  media.className = "service-img";
  if (service.imageUrl) media.style.backgroundImage = `url("${service.imageUrl.replaceAll('"', "%22")}")`;
  else media.textContent = initial(service.category);

  const body = document.createElement("div");
  body.className = "service-body";
  const category = document.createElement("span");
  category.className = "service-category";
  category.textContent = normalizedCategory(service.category);
  const title = document.createElement("h3");
  title.className = "service-title";
  title.textContent = service.title || "خدمة بدون عنوان";

  const seller = document.createElement("div");
  seller.className = "service-seller";
  const avatar = document.createElement("div");
  avatar.className = "seller-avatar";
  if (service.ownerAvatar) avatar.style.backgroundImage = `url("${service.ownerAvatar.replaceAll('"', "%22")}")`;
  else avatar.textContent = initial(service.ownerName);
  const sellerName = document.createElement("span");
  sellerName.className = "seller-name";
  sellerName.textContent = service.ownerName || "مستقل PikLance";
  seller.append(avatar, sellerName);

  const footer = document.createElement("div");
  footer.className = "service-footer";
  const price = document.createElement("span");
  price.className = "service-price";
  price.textContent = `${Number(service.price || 0).toLocaleString("ar-SY")} ل.س`;
  const delivery = document.createElement("span");
  delivery.className = "service-rating";
  delivery.textContent = `${Number(service.deliveryDays || 1)} يوم`;
  footer.append(price, delivery);
  body.append(category, title, seller, footer);
  link.append(media, body);
  return link;
}

function render(items) {
  const container = $("servicesContainer");
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "marketplace-empty";
    empty.innerHTML = "<strong>لا توجد خدمات منشورة حالياً</strong><p>ستظهر هنا الخدمات فور موافقة الإدارة عليها.</p>";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...items.map(serviceCard));
}

function applyFilters() {
  const term = $("searchInput").value.trim().toLowerCase();
  const category = $("categoryFilter").value;
  const price = $("priceFilter").value;
  const sort = $("sortFilter").value;
  const filtered = state.services.filter(service => {
    const haystack = `${service.title || ""} ${service.ownerName || ""} ${(service.keywords || []).join(" ")}`.toLowerCase();
    const amount = Number(service.price || 0);
    if (term && !haystack.includes(term)) return false;
    if (category !== "all" && categoryFilterValue(service.category) !== category) return false;
    if (price === "under10k" && amount >= 10000) return false;
    if (price === "10k-50k" && (amount < 10000 || amount > 50000)) return false;
    if (price === "over50k" && amount <= 50000) return false;
    return true;
  });
  if (sort === "price-low") filtered.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  else if (sort === "price-high") filtered.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  else if (sort === "popular") filtered.sort((a, b) => Number(b.completedOrders || 0) - Number(a.completedOrders || 0));
  else filtered.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  render(filtered);
}

async function loadServices() {
  try {
    const snapshot = await getDocs(query(collection(db, "services"), where("status", "==", "published")));
    const services = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const profileIds = [...new Set(services.map(item => item.ownerUid).filter(Boolean))];
    const profiles = new Map();
    if (profileIds.length) {
      const publicSnapshot = await getDocs(collection(db, "publicProfiles"));
      publicSnapshot.docs.forEach(item => profiles.set(item.id, item.data()));
    }
    state.services = services.map(service => ({
      ...service,
      ownerName: profiles.get(service.ownerUid)?.name || service.ownerName,
      ownerAvatar: profiles.get(service.ownerUid)?.avatar || ""
    }));
    applyFilters();
  } catch (error) {
    console.error("Unable to load marketplace services", error);
    $("servicesContainer").innerHTML = '<div class="marketplace-empty"><strong>تعذر تحميل الخدمات</strong><p>تحقق من الاتصال وحاول تحديث الصفحة.</p></div>';
  }
}

[$("searchInput"), $("categoryFilter"), $("priceFilter"), $("sortFilter")].forEach(control => {
  control.addEventListener(control.tagName === "INPUT" ? "input" : "change", applyFilters);
});
$("serviceSearchButton").addEventListener("click", applyFilters);

const requestedCategory = new URLSearchParams(location.search).get("cat");
if (requestedCategory && [...$("categoryFilter").options].some(option => option.value === requestedCategory)) {
  $("categoryFilter").value = requestedCategory;
}
const requestedSearch = new URLSearchParams(location.search).get("q");
if (requestedSearch) $("searchInput").value = requestedSearch.slice(0, 100);
loadServices();
