const categoryAliases = {
  "تصميم": "design", design: "design",
  "برمجة": "code", "برمجة وتطوير": "code", web: "code", code: "code",
  "كتابة": "write", "كتابة وترجمة": "write", writing: "write", write: "write",
  "تسويق": "market", "تسويق رقمي": "market", marketing: "market", market: "market",
  "صوتيات": "audio", audio: "audio",
  "فيديو": "video", "فيديو وأنيميشن": "video", video: "video"
};

function setStatValue(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.classList.remove("stat-loading");
  element.removeAttribute("aria-label");
  element.textContent = value;
}
const FEATURED_ROTATION_MS = 10 * 60 * 1000;
const HERO_STACK_ROTATION_MS = 5720;
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

function loadMarketplaceImage(element, source) {
  const imageSource = source || "assets/service-placeholder.svg";
  element.classList.add("is-image-loading");
  const preload = new Image();
  const finish = url => {
    element.style.backgroundImage = `url("${url.replaceAll('"', "%22")}")`;
    element.classList.remove("is-image-loading");
    element.classList.add("image-ready");
  };
  preload.addEventListener("load", () => finish(imageSource), { once: true });
  preload.addEventListener("error", () => finish("assets/service-placeholder.svg"), { once: true });
  preload.src = imageSource;
}

function serviceCard(service, profile) {
  const link = document.createElement("a");
  link.href = `service-details.html?id=${encodeURIComponent(service.id)}`;
  link.className = "service-card";
  const image = document.createElement("div");
  image.className = "service-img";
  loadMarketplaceImage(image, service.imageUrl);
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
  price.textContent = `${Number(service.price || 0).toLocaleString("en-US")} ل.س`;
  const delivery = document.createElement("span");
  delivery.className = "service-rating";
  delivery.textContent = `${Number(service.deliveryDays || 1)} يوم`;
  footer.append(price, delivery);
  body.append(category, title, seller, footer);
  link.append(image, body);
  return link;
}

function heroStackCard(service, profile) {
  const card = document.createElement("article");
  card.className = "hero-stack-card";
  const cover = document.createElement("div");
  cover.className = "hero-stack-cover";
  loadMarketplaceImage(cover, service.imageUrl);
  const category = document.createElement("span");
  category.className = "hero-stack-category";
  category.textContent = service.category || "خدمات رقمية";
  cover.append(category);

  const copy = document.createElement("div");
  copy.className = "hero-stack-copy";
  const eyebrow = document.createElement("span");
  eyebrow.className = "hero-stack-eyebrow";
  eyebrow.textContent = "خدمة مميزة";
  const title = document.createElement("h3");
  title.className = "hero-stack-title";
  title.textContent = service.title || "خدمة منشورة على PikLance";
  const seller = document.createElement("div");
  seller.className = "hero-stack-seller";
  const avatar = document.createElement("span");
  avatar.className = "hero-stack-avatar";
  if (profile?.avatar) avatar.style.backgroundImage = `url("${profile.avatar.replaceAll('"', "%22")}")`;
  else avatar.textContent = initial(profile?.name || service.ownerName);
  const sellerName = document.createElement("span");
  sellerName.textContent = profile?.name || service.ownerName || "مستقل PikLance";
  seller.append(avatar, sellerName);
  const meta = document.createElement("div");
  meta.className = "hero-stack-meta";
  const delivery = document.createElement("span");
  delivery.textContent = `تسليم خلال ${Number(service.deliveryDays || 1).toLocaleString("en-US")} يوم`;
  const price = document.createElement("strong");
  price.className = "hero-stack-price";
  price.textContent = `${Number(service.price || 0).toLocaleString("en-US")} ل.س`;
  meta.append(delivery, price);
  const action = document.createElement("a");
  action.className = "hero-stack-action";
  action.href = `service-details.html?id=${encodeURIComponent(service.id)}`;
  action.textContent = "اختر الخدمة ←";
  action.setAttribute("aria-label", `اختر خدمة ${service.title || "من PikLance"}`);
  copy.append(eyebrow, title, seller, meta, action);
  card.append(cover, copy);
  return card;
}

function createHeroStackRotator(services, profiles) {
  const stack = document.getElementById("heroServiceStack");
  if (!stack || !services.length) return;
  const selected = shuffle(services).slice(0, Math.min(5, services.length));
  const cards = selected.map(service => heroStackCard(service, profiles.get(service.ownerUid)));
  let animating = false;
  let nextAutoDirection = -1;
  let lastAdvanceAt = Date.now();
  let drag = null;
  let pointerPaused = false;

  const updatePositions = () => {
    const compact = window.matchMedia("(max-width: 520px)").matches;
    const tablet = window.matchMedia("(min-width: 521px) and (max-width: 1100px)").matches;
    const desktopPositions = [
      { x: 0, y: 0, scale: 1 },
      { x: 155, y: 22, scale: .9 },
      { x: 225, y: 38, scale: .82 },
      { x: -155, y: 22, scale: .9 },
      { x: -225, y: 38, scale: .82 }
    ];
    const compactPositions = [
      { x: 0, y: 0, scale: 1 },
      { x: 72, y: 24, scale: .92 },
      { x: 110, y: 40, scale: .86 },
      { x: -72, y: 24, scale: .92 },
      { x: -110, y: 40, scale: .86 }
    ];
    const tabletPositions = [
      { x: 0, y: 0, scale: 1 },
      { x: 94, y: 23, scale: .91 },
      { x: 138, y: 39, scale: .84 },
      { x: -94, y: 23, scale: .91 },
      { x: -138, y: 39, scale: .84 }
    ];
    const positions = compact ? compactPositions : tablet ? tabletPositions : desktopPositions;
    cards.forEach((card, index) => {
      const position = positions[index] || positions[positions.length - 1];
      card.style.setProperty("--stack-index", index);
      card.style.setProperty("--stack-x", `${position.x}px`);
      card.style.setProperty("--stack-y", `${position.y}px`);
      card.style.setProperty("--stack-scale", String(position.scale));
      card.dataset.stackIndex = String(index);
      const action = card.querySelector(".hero-stack-action");
      if (action) action.tabIndex = 0;
    });
  };
  stack.replaceChildren(...cards);
  updatePositions();
  if (cards.length < 2) return;

  const advance = direction => {
    if (animating) return;
    animating = true;
    stack.dataset.lastDirection = direction < 0 ? "left" : "right";
    const outgoing = cards[0];
    outgoing.style.setProperty("--drag-x", "0px");
    outgoing.style.setProperty("--drag-rotate", "0deg");
    outgoing.classList.add(direction < 0 ? "is-leaving-left" : "is-leaving-right");
    window.setTimeout(() => {
      outgoing.classList.remove("is-leaving-left", "is-leaving-right", "is-dragging");
      cards.push(cards.shift());
      stack.append(outgoing);
      updatePositions();
      lastAdvanceAt = Date.now();
      animating = false;
    }, 485);
  };

  const endDrag = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { card, deltaX, horizontal } = drag;
    drag = null;
    card.classList.remove("is-dragging");
    card.style.setProperty("--drag-x", "0px");
    card.style.setProperty("--drag-rotate", "0deg");
    if (card.hasPointerCapture?.(event.pointerId)) card.releasePointerCapture(event.pointerId);
    lastAdvanceAt = Date.now();
    if (horizontal && Math.abs(deltaX) >= 62) advance(deltaX < 0 ? -1 : 1);
  };

  cards.forEach(card => {
    card.addEventListener("pointerdown", event => {
      if (card !== cards[0] || animating || event.button !== 0 || event.target.closest("a")) return;
      drag = {
        card,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        deltaX: 0,
        horizontal: null
      };
      card.setPointerCapture?.(event.pointerId);
      card.classList.add("is-dragging");
      lastAdvanceAt = Date.now();
    });
    card.addEventListener("pointermove", event => {
      if (!drag || drag.card !== card || event.pointerId !== drag.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (drag.horizontal === null && (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8)) {
        drag.horizontal = Math.abs(deltaX) > Math.abs(deltaY);
      }
      if (!drag.horizontal) return;
      event.preventDefault();
      drag.deltaX = Math.max(-210, Math.min(210, deltaX));
      card.style.setProperty("--drag-x", `${drag.deltaX}px`);
      card.style.setProperty("--drag-rotate", `${drag.deltaX / 25}deg`);
    });
    card.addEventListener("pointerup", endDrag);
    card.addEventListener("pointercancel", endDrag);
  });

  stack.addEventListener("pointerenter", () => {
    pointerPaused = true;
    stack.dataset.paused = "true";
    lastAdvanceAt = Date.now();
  });
  stack.addEventListener("pointerleave", () => {
    pointerPaused = false;
    stack.dataset.paused = "false";
    lastAdvanceAt = Date.now();
  });
  window.addEventListener("resize", updatePositions, { passive: true });
  window.setInterval(() => {
    if (pointerPaused || stack.matches(":hover, :focus-within") || document.hidden || drag || animating) {
      lastAdvanceAt = Date.now();
      return;
    }
    if (Date.now() - lastAdvanceAt < HERO_STACK_ROTATION_MS) return;
    advance(nextAutoDirection);
    nextAutoDirection *= -1;
  }, 300);
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
    setStatValue("homePlatformFee", `${feePercent.toLocaleString("en-US")}%`);
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

    setStatValue("homeFreelancersCount", profiles.size.toLocaleString("en-US"));
    setStatValue("homeServicesCount", services.length.toLocaleString("en-US"));
    const categoryCounts = services.reduce((counts, service) => {
      const key = normalizeCategory(service.category);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    const availableCategories = Object.values(categoryCounts).filter(Boolean).length;
    setStatValue("homeCategoriesCount", availableCategories.toLocaleString("en-US"));
    document.getElementById("homeHeroFreelancers").textContent = profiles.size
      ? `${profiles.size.toLocaleString("en-US")} مستقل موثّق وجاهز للعمل`
      : "كن من أوائل المستقلين على PikLance";
    document.querySelectorAll("[data-category-count]").forEach(element => {
      const count = categoryCounts[element.dataset.categoryCount] || 0;
      element.textContent = `${count.toLocaleString("en-US")} خدمة`;
    });

    if (services.length) {
      createHeroStackRotator(services, profiles);
      createFeaturedRotator(featured, services, profiles);
    }
    else featured.innerHTML = '<div class="testimonial-card" style="grid-column:1/-1;text-align:center"><p class="testimonial-text">لا توجد خدمات منشورة بعد. ستظهر أول خدمة هنا فور موافقة الإدارة عليها.</p></div>';
  } catch (error) {
    console.error("Unable to load homepage marketplace data", error);
    ["homeFreelancersCount", "homeServicesCount", "homeCategoriesCount", "homePlatformFee"].forEach(id => setStatValue(id, "—"));
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
