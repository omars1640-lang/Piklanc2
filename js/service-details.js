import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, deleteDoc, doc, getDoc, getDocs, query,
  serverTimestamp, setDoc, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getDownloadURL, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth, db, storage } from "./firebase.js";
import { createEscrowOrder } from "./escrow.js";
import { refreshImageFromStorage, resolveProfileAvatar } from "./avatar-utils.js";

const params = new URLSearchParams(location.search);
const serviceId = params.get("id") || "";
let service = null;
let sellerUid = "";
let sellerProfile = null;
let currentUser = null;
let currentProfile = null;
let relatedServices = [];

const $ = id => document.getElementById(id);

function showToast(message) {
  $("serviceToast").textContent = message;
  $("serviceToast").classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $("serviceToast").classList.remove("show"), 3000);
}

function formatPrice(value) {
  return `${Number(value || 0).toLocaleString("ar-SY")} ل.س`;
}

function revisionLabel(value) {
  const count = Number(value || 0);
  if (!count) return "بدون تعديلات";
  if (count === 1) return "تعديل واحد";
  if (count === 2) return "تعديلان";
  return `${count} تعديلات`;
}

function packageForService() {
  return {
    name: "الخدمة الأساسية",
    price: Number(service.price || 0),
    delivery: `${Number(service.deliveryDays || 1)} يوم`,
    revisions: revisionLabel(service.revisions),
    description: service.description || "تنفيذ الخدمة وفق التفاصيل المتفق عليها داخل المنصة.",
    features: [
      "تنفيذ الخدمة الموضحة في الوصف",
      `التسليم خلال ${Number(service.deliveryDays || 1)} يوم`,
      revisionLabel(service.revisions),
      "تواصل وتسليم موثّقان داخل PikLance"
    ]
  };
}

function messageUrl() {
  if (!currentUser) return `login.html?returnUrl=${encodeURIComponent(location.pathname + location.search)}`;
  const queryParams = new URLSearchParams({
    withUid: sellerUid,
    serviceId: service.id,
    serviceTitle: service.title,
    serviceImage: service.imageUrl || "",
    servicePrice: String(service.price || 0),
    sellerUid
  });
  return `messages.html?${queryParams}`;
}

function updateContactLinks() {
  if (!service) return;
  $("startConversation").href = messageUrl();
  $("sellerMessageLink").href = messageUrl();
}

function renderGallery() {
  const imageUrl = service.imageUrl || "assets/service-placeholder.svg";
  $("mainServiceImage").src = imageUrl;
  $("mainServiceImage").alt = service.title;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "active";
  const image = document.createElement("img");
  image.src = imageUrl;
  image.alt = `صورة ${service.title}`;
  button.appendChild(image);
  $("galleryThumbs").replaceChildren(button);
  $("popularBadge").hidden = true;
}

function renderPackage() {
  const packageInfo = packageForService();
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "active";
  tab.textContent = packageInfo.name;
  $("packageTabs").replaceChildren(tab);
  $("packagePrice").textContent = formatPrice(packageInfo.price);
  $("packageDescription").textContent = packageInfo.description;
  $("packageDelivery").textContent = packageInfo.delivery;
  $("packageRevisions").textContent = packageInfo.revisions;
  $("packageFeatures").replaceChildren(...packageInfo.features.map(value => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}

function renderRelated() {
  const cards = relatedServices.map(item => {
    const link = document.createElement("a");
    link.className = "related-card";
    link.href = `service-details.html?id=${encodeURIComponent(item.id)}`;
    const image = document.createElement("img");
    image.src = item.imageUrl || "assets/service-placeholder.svg";
    image.alt = item.title;
    image.loading = "lazy";
    const copy = document.createElement("div");
    copy.className = "related-copy";
    const category = document.createElement("span");
    category.textContent = item.category || "خدمات رقمية";
    const title = document.createElement("h3");
    title.textContent = item.title;
    const meta = document.createElement("div");
    const price = document.createElement("b");
    price.textContent = formatPrice(item.price);
    const delivery = document.createElement("span");
    delivery.textContent = `${Number(item.deliveryDays || 1)} يوم`;
    meta.append(price, delivery);
    copy.append(category, title, meta);
    link.append(image, copy);
    return link;
  });
  $("relatedServices").replaceChildren(...cards);
  document.querySelector(".related-section").hidden = cards.length === 0;
}

function renderService() {
  const profileName = sellerProfile?.name || service.ownerName || "مستقل PikLance";
  const specialty = sellerProfile?.specialty || service.category || "خدمات رقمية";
  document.title = `${service.title} - PikLance`;
  $("breadcrumbCategory").textContent = service.category || "خدمات رقمية";
  $("serviceCategory").textContent = service.category || "خدمات رقمية";
  $("serviceTitle").textContent = service.title;
  $("serviceSubtitle").textContent = "خدمة منشورة ومراجعة من إدارة PikLance.";
  $("serviceRating").textContent = Number(service.rating || 0).toFixed(1);
  $("reviewCount").textContent = `(${Number(service.reviewsCount || 0)} تقييم)`;
  $("ordersCount").textContent = `${Number(service.completedOrders || 0)} طلب مكتمل`;

  const description = document.createElement("p");
  description.textContent = service.description || "لم يضف المستقل وصفاً تفصيلياً بعد.";
  $("serviceDescription").replaceChildren(description);

  const deliverables = [
    ["الخدمة المتفق عليها", service.description || "تنفيذ العمل حسب تفاصيل الخدمة."],
    ["موعد واضح", `التسليم خلال ${Number(service.deliveryDays || 1)} يوم من بدء الطلب.`],
    ["مراجعات محددة", revisionLabel(service.revisions)]
  ];
  $("deliverablesGrid").replaceChildren(...deliverables.map(([title, text]) => {
    const article = document.createElement("article");
    const icon = document.createElement("span");
    icon.textContent = "✓";
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    copy.append(heading, paragraph);
    article.append(icon, copy);
    return article;
  }));

  $("sellerImage").src = sellerProfile?.avatar || "assets/avatar-placeholder.svg";
  $("sellerImage").alt = profileName;
  $("sellerImage").addEventListener("error", async event => {
    const recovered = await refreshImageFromStorage(event.currentTarget, sellerUid, sellerProfile || {});
    if (!recovered) event.currentTarget.src = "assets/avatar-placeholder.svg";
  });
  $("sellerName").textContent = profileName;
  $("sellerSpecialty").textContent = specialty;
  $("sellerRating").textContent = Number(sellerProfile?.rating || service.rating || 0).toFixed(1);
  $("sellerBio").textContent = sellerProfile?.about || "مستقل موثّق يقدّم خدماته عبر PikLance.";
  $("sellerProfileLink").href = `freelancer-profile.html?uid=${encodeURIComponent(sellerUid)}`;
  $("reviewAverage").textContent = Number(service.rating || 0).toFixed(1);
  $("reviewsList").innerHTML = '<article class="review-item"><p>لا توجد تقييمات لهذه الخدمة حتى الآن. تظهر التقييمات بعد إكمال طلب حقيقي.</p></article>';
  renderGallery();
  renderPackage();
  renderRelated();
  updateContactLinks();
}

function showNotFound() {
  document.title = "الخدمة غير موجودة - PikLance";
  document.querySelector("main").innerHTML = '<section class="container" style="padding:150px 24px;text-align:center"><h1>الخدمة غير موجودة</h1><p>قد تكون الخدمة حُذفت أو لم تحصل على موافقة الإدارة بعد.</p><a href="services.html">العودة إلى الخدمات</a></section>';
}

async function loadService() {
  if (!serviceId) {
    showNotFound();
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, "services", serviceId));
    if (!snapshot.exists() || snapshot.data().status !== "published") {
      showNotFound();
      return;
    }
    service = { id: snapshot.id, ...snapshot.data() };
    if (!service.imageUrl && service.imagePath) {
      service.imageUrl = await getDownloadURL(ref(storage, service.imagePath)).catch(() => "");
    }
    sellerUid = service.ownerUid;
    const [profileSnapshot, relatedSnapshot] = await Promise.all([
      getDoc(doc(db, "publicProfiles", sellerUid)),
      getDocs(query(collection(db, "services"), where("status", "==", "published")))
    ]);
    sellerProfile = profileSnapshot.exists() ? profileSnapshot.data() : null;
    if (sellerProfile) sellerProfile.avatar = await resolveProfileAvatar(sellerUid, sellerProfile);
    relatedServices = relatedSnapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.id !== service.id && item.category === service.category)
      .slice(0, 3);
    renderService();
  } catch (error) {
    console.error("Unable to load service", error);
    showNotFound();
  }
}

async function handleOrderService() {
  if (!currentUser) {
    location.href = `login.html?returnUrl=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  if (!currentUser.emailVerified) {
    showToast("فعّل بريدك الإلكتروني قبل إنشاء الطلب.");
    return;
  }
  if (currentProfile?.accountType !== "buyer" || currentProfile.status !== "active") {
    showToast("إنشاء الطلبات متاح من حساب مشتري نشط فقط.");
    return;
  }
  if (currentUser.uid === sellerUid) {
    showToast("لا يمكنك طلب خدمتك من حسابك نفسه.");
    return;
  }
  const button = $("orderService");
  button.disabled = true;
  try {
    const orderId = await createEscrowOrder(db, {
      user: currentUser,
      buyerName: currentProfile.name,
      service: {
        ...service,
        seller: { name: sellerProfile?.name || service.ownerName || "مستقل PikLance" },
        images: service.imageUrl ? [service.imageUrl] : []
      },
      packageInfo: packageForService(),
      sellerUid
    });
    showToast("تم إنشاء طلب تجريبي وحجز قيمته داخل بيئة الاختبار.");
    setTimeout(() => { location.href = `profile.html?section=orders&orderId=${encodeURIComponent(orderId)}`; }, 900);
  } catch (error) {
    console.error("Unable to create order", error);
    showToast("تعذر إنشاء الطلب. تحقق من حالة الحساب وقواعد Firebase.");
    button.disabled = false;
  }
}

async function toggleFavorite() {
  if (!currentUser) {
    location.href = `login.html?returnUrl=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const button = $("favoriteService");
  const active = button.getAttribute("aria-pressed") !== "true";
  button.disabled = true;
  try {
    const reference = doc(db, "favorites", currentUser.uid, "services", service.id);
    if (active) {
      await setDoc(reference, {
        serviceId: service.id, title: service.title, category: service.category || "",
        price: Number(service.price || 0), sellerUid, savedAt: serverTimestamp()
      });
    } else await deleteDoc(reference);
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("active", active);
    button.textContent = active ? "♥ محفوظة" : "♡ حفظ";
  } catch (error) {
    console.error("Unable to update favorite", error);
    showToast("تعذر تحديث قائمة المحفوظات.");
  } finally {
    button.disabled = false;
  }
}

$("favoriteService").addEventListener("click", toggleFavorite);
$("orderService").addEventListener("click", handleOrderService);
$("shareService").addEventListener("click", async () => {
  try {
    if (navigator.share) await navigator.share({ title: service?.title || "PikLance", url: location.href });
    else {
      await navigator.clipboard.writeText(location.href);
      showToast("تم نسخ رابط الخدمة.");
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("تعذرت مشاركة الرابط.");
  }
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  currentProfile = null;
  if (user) {
    const [profileSnapshot, favoriteSnapshot] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      serviceId ? getDoc(doc(db, "favorites", user.uid, "services", serviceId)) : Promise.resolve(null)
    ]).catch(() => [null, null]);
    currentProfile = profileSnapshot?.exists() ? profileSnapshot.data() : null;
    const saved = Boolean(favoriteSnapshot?.exists());
    const favoriteButton = $("favoriteService");
    if (favoriteButton) {
      favoriteButton.setAttribute("aria-pressed", String(saved));
      favoriteButton.classList.toggle("active", saved);
      favoriteButton.textContent = saved ? "♥ محفوظة" : "♡ حفظ";
    }
  }
  updateContactLinks();
});

loadService();
