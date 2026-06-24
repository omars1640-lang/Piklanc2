const categoryAliases = {
  "تصميم": "design", design: "design",
  "برمجة": "code", "برمجة وتطوير": "code", web: "code", code: "code",
  "كتابة": "write", "كتابة وترجمة": "write", writing: "write", write: "write",
  "تسويق": "market", "تسويق رقمي": "market", marketing: "market", market: "market",
  "صوتيات": "audio", audio: "audio",
  "فيديو": "video", "فيديو وأنيميشن": "video", video: "video"
};
const FEATURED_ROTATION_MS = 10 * 60 * 1000;
let marketplaceDeps = null;

async function loadMarketplaceDeps() {
  if (marketplaceDeps) return marketplaceDeps;
  const [
    firestoreModule,
    storageModule,
    firebaseModule,
    avatarModule
  ] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js"),
    import("./firebase.js"),
    import("./avatar-utils.js")
  ]);
  marketplaceDeps = {
    collection: firestoreModule.collection,
    doc: firestoreModule.doc,
    getDoc: firestoreModule.getDoc,
    getDocs: firestoreModule.getDocs,
    query: firestoreModule.query,
    where: firestoreModule.where,
    getDownloadURL: storageModule.getDownloadURL,
    ref: storageModule.ref,
    db: firebaseModule.db,
    storage: firebaseModule.storage,
    resolveProfileAvatar: avatarModule.resolveProfileAvatar
  };
  return marketplaceDeps;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function initial(value) {
  return (value || "م").trim().charAt(0).toUpperCase();
}

function normalizeCategory(value) {
  const raw = String(value || "").trim();
  if (!raw) return "other";
  if (categoryAliases[raw]) return categoryAliases[raw];
  if (raw.includes("تصميم")) return "design";
  if (raw.includes("برمج") || raw.includes("تطوير")) return "code";
  if (raw.includes("كتابة") || raw.includes("ترجمة")) return "write";
  if (raw.includes("تسويق")) return "market";
  if (raw.includes("صوت")) return "audio";
  if (raw.includes("فيديو") || raw.includes("أنيميشن") || raw.includes("مونتاج")) return "video";
  return "other";
}

function serviceCard(service, profile) {
  const link = document.createElement("a");
  link.href = `service-details.html?id=${encodeURIComponent(service.id)}`;
  link.className = "service-card";
  const image = document.createElement("div");
  image.className = "service-img";
  image.style.backgroundImage = `url("${service.imageUrl || "assets/service-placeholder.svg"}")`;
  const body = document.createElement("div");
  body.className = "service-body";
  const category = document.createElement("span");
  category.className = "service-category";
  category.textContent = service.category || "خدمات رقمية";
  const title = document.createElement("h3");
  title.className = "service-title";
  title.textContent = service.title;
  const seller = document.createElement("div");
  seller.className = "service-seller";
  const avatar = document.createElement("div");
  avatar.className = "service-avatar";
  if (profile?.avatar) avatar.style.backgroundImage = `url("${profile.avatar}")`;
  else avatar.textContent = initial(profile?.name || service.ownerName);
  const sellerCopy = document.createElement("div");
  const name = document.createElement("div");
  name.className = "service-seller-name";
  name.textContent = profile?.name || service.ownerName || "مستقل PikLance";
  const level = document.createElement("div");
  level.className = "service-seller-level";
  level.textContent = profile?.rank?.label || "مستقل موثّق";
  sellerCopy.append(name, level);
  seller.append(avatar, sellerCopy);
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
  link.append(image, body);
  return link;
}

function renderHeroMarketService(service, profile) {
  const cover = document.getElementById("heroMarketCover");
  const title = document.getElementById("heroMarketTitle");
  const delivery = document.getElementById("heroMarketDelivery");
  const price = document.getElementById("heroMarketPrice");
  const avatar = document.getElementById("heroMarketSellerAvatar");
  const seller = document.getElementById("heroMarketSellerName");
  const rank = document.getElementById("heroMarketSellerRank");
  const category = document.getElementById("heroMarketCategory");
  const summary = document.getElementById("heroMarketSummary");
  if (!cover || !title || !service) return;

  cover.classList.toggle("has-image", Boolean(service.imageUrl));
  cover.style.backgroundImage = service.imageUrl ? `url("${service.imageUrl.replaceAll('"', "%22")}")` : "";
  title.textContent = service.title || "خدمة منشورة على PikLance";
  delivery.textContent = `تسليم خلال ${Number(service.deliveryDays || 1).toLocaleString("ar-SY")} يوم`;
  price.textContent = `${Number(service.price || 0).toLocaleString("ar-SY")} ل.س`;
  seller.textContent = profile?.name || service.ownerName || "مستقل PikLance";
  rank.textContent = profile?.rank?.label || "صاحب الخدمة";
  category.textContent = service.category || "خدمة منشورة";
  summary.textContent = (service.description || "خدمة حقيقية منشورة داخل المنصة.").slice(0, 120);
  avatar.style.backgroundImage = profile?.avatar ? `url("${profile.avatar.replaceAll('"', "%22")}")` : "";
  avatar.textContent = profile?.avatar ? "" : initial(profile?.name || service.ownerName);
}

function createUniqueRotator(items, onRender, visibleCount = 1) {
  let queue = shuffle(items);
  let cursor = 0;
  const nextItems = () => {
    if (cursor >= queue.length) {
      queue = shuffle(items);
      cursor = 0;
    }
    const selected = [];
    while (selected.length < visibleCount && queue.length) {
      if (cursor >= queue.length) {
        queue = shuffle(items);
        cursor = 0;
      }
      const next = queue[cursor];
      cursor += 1;
      if (!selected.some(item => item.id === next.id)) selected.push(next);
    }
    return selected;
  };
  const render = () => onRender(nextItems());
  render();
  if (items.length > visibleCount) setInterval(render, FEATURED_ROTATION_MS);
}

function createFeaturedRotator(container, services, profiles) {
  const visibleCount = Math.min(3, services.length);
  createUniqueRotator(services, selectedServices => {
    const cards = selectedServices.map(service => serviceCard(service, profiles.get(service.ownerUid)));
    container.replaceChildren(...cards);
  }, visibleCount);
}

async function loadHomeData() {
  const featured = document.getElementById("homeFeaturedServices");
  if (!featured) return;
  try {
    const {
      collection,
      db,
      doc,
      getDoc,
      getDocs,
      getDownloadURL,
      query,
      ref,
      resolveProfileAvatar,
      storage,
      where
    } = await loadMarketplaceDeps();
    const [servicesSnapshot, profilesSnapshot, settingsSnapshot] = await Promise.all([
      getDocs(query(collection(db, "services"), where("status", "==", "published"))),
      getDocs(query(collection(db, "publicProfiles"), where("accountType", "==", "freelancer"))),
      getDoc(doc(db, "platformSettings", "general"))
    ]);
    const feePercent = Number(settingsSnapshot.exists() ? settingsSnapshot.data().platformFeePercent : 20);
    document.getElementById("homePlatformFee").textContent = `${feePercent.toLocaleString("ar-SY")}%`;
    const services = (await Promise.all(servicesSnapshot.docs.map(async item => {
      const service = { id: item.id, ...item.data() };
      if (!service.imageUrl && service.imagePath) {
        service.imageUrl = await getDownloadURL(ref(storage, service.imagePath)).catch(() => "");
      }
      return service;
    }))).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const publishedOwners = new Set(services.map(service => service.ownerUid));
    const profileEntries = profilesSnapshot.docs
      .map(item => [item.id, item.data()])
      .filter(([id, profile]) => profile.status === "active" || publishedOwners.has(id));
    const profiles = new Map(await Promise.all(profileEntries.map(async ([id, profile]) => [
      id,
      { ...profile, avatar: await resolveProfileAvatar(id, profile) }
    ])));

    document.getElementById("homeFreelancersCount").textContent = profiles.size.toLocaleString("ar-SY");
    document.getElementById("homeServicesCount").textContent = services.length.toLocaleString("ar-SY");
    const categoryCounts = services.reduce((counts, service) => {
      const key = normalizeCategory(service.category);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    const availableCategories = Object.values(categoryCounts).filter(Boolean).length;
    document.getElementById("homeCategoriesCount").textContent = availableCategories.toLocaleString("ar-SY");
    document.getElementById("homeHeroFreelancers").textContent = profiles.size
      ? `${profiles.size.toLocaleString("ar-SY")} مستقل موثّق وجاهز للعمل`
      : "كن من أوائل المستقلين على PikLance";
    document.querySelectorAll("[data-category-count]").forEach(element => {
      const count = categoryCounts[element.dataset.categoryCount] || 0;
      element.textContent = `${count.toLocaleString("ar-SY")} خدمة`;
    });

    if (services.length) {
      createUniqueRotator(services, ([service]) => renderHeroMarketService(service, profiles.get(service.ownerUid)));
      createFeaturedRotator(featured, services, profiles);
    }
    else featured.innerHTML = '<div class="testimonial-card" style="grid-column:1/-1;text-align:center"><p class="testimonial-text">لا توجد خدمات منشورة بعد. ستظهر أول خدمة هنا فور موافقة الإدارة عليها.</p></div>';
  } catch (error) {
    console.error("Unable to load homepage marketplace data", error);
    featured.innerHTML = '<div class="testimonial-card" style="grid-column:1/-1;text-align:center"><p class="testimonial-text">تعذر تحميل الخدمات حالياً. حاول تحديث الصفحة.</p></div>';
  }
}

function scheduleHomeDataLoad() {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(loadHomeData, { timeout: 1600 });
  } else {
    window.setTimeout(loadHomeData, 500);
  }
}

scheduleHomeDataLoad();
