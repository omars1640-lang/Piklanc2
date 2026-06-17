import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const portfolioImages = {
  design: [
    "https://images.unsplash.com/photo-1561070791-2526d30994b5?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1545235617-9465d2a55698?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1561070791-36c11767b26a?w=1000&h=700&fit=crop"
  ],
  code: [
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1000&h=700&fit=crop"
  ],
  writing: [
    "https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1456324504439-367cee3b3c32?w=1000&h=700&fit=crop"
  ],
  marketing: [
    "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1533750349088-cd871a92f312?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1000&h=700&fit=crop"
  ],
  audio: [
    "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=1000&h=700&fit=crop"
  ],
  video: [
    "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=1000&h=700&fit=crop",
    "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=1000&h=700&fit=crop"
  ]
};

const demoProfiles = {
  "1": createDemo({
    name: "أحمد المصمم", specialty: "مصمم جرافيك وهوية بصرية", category: "design",
    skills: ["Adobe Illustrator", "Photoshop", "Figma", "تصميم شعارات", "هوية بصرية", "مطبوعات"],
    about: ["مصمم جرافيك متخصص في بناء الهويات البصرية وتصميم الشعارات للعلامات التجارية الناشئة والشركات.", "أركز على تحويل فكرة المشروع إلى نظام بصري متكامل، واضح وقابل للاستخدام عبر المنصات الرقمية والمطبوعات."],
    stats: { completed: 347, rating: 4.9, success: 98, response: "ساعتان", repeat: 72 }
  }),
  "2": createDemo({
    name: "سارة المبرمجة", specialty: "مطورة ويب وتطبيقات", category: "code",
    skills: ["React", "Node.js", "Laravel", "WordPress", "UI Development", "REST APIs"],
    about: ["مطورة Full Stack أبني مواقع وتطبيقات سريعة وقابلة للتوسع مع اهتمام كبير بتجربة المستخدم وجودة الكود.", "عملت على متاجر إلكترونية ولوحات تحكم ومنصات خدمات لعملاء من قطاعات مختلفة."],
    stats: { completed: 215, rating: 4.8, success: 97, response: "3 ساعات", repeat: 65 }
  }),
  "3": createDemo({
    name: "خالد الكاتب", specialty: "كاتب محتوى ومحرر", category: "writing",
    skills: ["كتابة إبداعية", "SEO", "تحرير", "تدقيق لغوي", "مقالات", "محتوى مواقع"],
    about: ["كاتب ومحرر عربي أساعد المشاريع على التعبير عن أفكارها بلغة واضحة ومقنعة ومتوافقة مع محركات البحث.", "أقدّم المقالات وصفحات المواقع والمحتوى التسويقي مع مراجعة لغوية دقيقة."],
    stats: { completed: 489, rating: 4.7, success: 96, response: "ساعة", repeat: 78 }
  }),
  "4": createDemo({
    name: "ليلى المسوقة", specialty: "مسوقة رقمية وإعلانات", category: "marketing",
    skills: ["Meta Ads", "Google Ads", "Analytics", "استراتيجية محتوى", "SEO", "تقارير أداء"],
    about: ["متخصصة في التسويق الرقمي وإدارة الحملات المدفوعة المبنية على البيانات.", "أساعد العلامات التجارية على تحسين الوصول، خفض تكلفة الاكتساب، وبناء خطط نمو قابلة للقياس."],
    stats: { completed: 156, rating: 4.9, success: 99, response: "ساعتان", repeat: 70 }
  }),
  "5": createDemo({
    name: "عماد الصوت", specialty: "مهندس صوت ومعلق", category: "audio",
    skills: ["تعليق صوتي", "مكساج", "تنقية صوت", "بودكاست", "إعلانات", "إنتاج صوتي"],
    about: ["مهندس صوت ومعلق أقدّم تسجيلات عربية واضحة للمحتوى الإعلاني والتعليمي والبودكاست.", "أهتم بجودة التسجيل، سلامة النطق، والمعالجة الاحترافية للصوت."],
    stats: { completed: 92, rating: 4.6, success: 95, response: "4 ساعات", repeat: 58 }
  }),
  "6": createDemo({
    name: "نور المنتجة", specialty: "منتجة فيديو ومونتاج", category: "video",
    skills: ["Premiere Pro", "After Effects", "مونتاج", "Motion Graphics", "تصحيح ألوان", "إخراج"],
    about: ["منتجة فيديو ومونتيرة أحوّل المواد الخام إلى قصص بصرية جذابة مناسبة للإعلانات والمنصات الاجتماعية.", "أعمل على المونتاج والموشن جرافيك وتصحيح الألوان من الفكرة حتى النسخة النهائية."],
    stats: { completed: 118, rating: 4.8, success: 97, response: "3 ساعات", repeat: 63 }
  })
};

function createDemo({ name, specialty, category, skills, about, stats }) {
  const avatarMap = {
    design: "https://randomuser.me/api/portraits/men/1.jpg",
    code: "https://randomuser.me/api/portraits/women/1.jpg",
    writing: "https://randomuser.me/api/portraits/men/2.jpg",
    marketing: "https://randomuser.me/api/portraits/women/2.jpg",
    audio: "https://randomuser.me/api/portraits/men/3.jpg",
    video: "https://randomuser.me/api/portraits/women/3.jpg"
  };
  const images = portfolioImages[category];
  const labels = {
    design: ["هوية بصرية لمقهى محلي", "تصميم شعار لعلامة تقنية", "نظام تغليف لمنتج جديد", "حملة سوشال ميديا", "دليل استخدام الهوية", "تصميم واجهة تطبيق"],
    code: ["لوحة تحكم للمبيعات", "متجر إلكتروني متجاوب", "منصة إدارة مشاريع", "تطبيق خدمات مصغر"],
    writing: ["سلسلة مقالات تقنية", "محتوى موقع شركة", "دليل هوية لفظية"],
    marketing: ["حملة نمو لمتجر", "لوحة تحليل أداء", "استراتيجية إطلاق منتج"],
    audio: ["بودكاست ثقافي", "تعليق صوتي لإعلان"],
    video: ["فيلم تعريفي لشركة", "إعلان منتج قصير", "حزمة فيديو سوشال"]
  };
  const projects = images.map((image, index) => ({
    title: labels[category][index] || `مشروع ${index + 1}`,
    category: index % 2 ? "مشروع تجاري" : "عمل مختار",
    filter: index % 2 ? "تجاري" : "إبداعي",
    image,
    description: "مشروع متكامل تم تنفيذه وفق احتياج العميل، من تطوير الفكرة وحتى تسليم الملفات النهائية.",
    tags: skills.slice(index % 3, (index % 3) + 3)
  }));
  return {
    name, specialty, skills, about, projects, stats, avatar: avatarMap[category],
    location: "دمشق، سوريا", response: `يرد خلال ${stats.response}`, languages: "العربية، English",
    memberSince: "2022",
    experience: [
      { title: specialty, place: "عمل مستقل", period: "2020 - الآن" },
      { title: "متخصص رقمي", place: "مشاريع محلية وعربية", period: "2018 - 2020" }
    ],
    services: projects.slice(0, 3).map((project, index) => ({
      title: project.title, category: project.category, image: project.image,
      price: [25000, 15000, 10000][index], delivery: [4, 3, 2][index]
    })),
    reviews: [
      { name: "محمد الأحمد", rating: 5, date: "منذ 3 أيام", text: "تجربة ممتازة، التزام واضح بالتفاصيل والموعد وجودة أعلى من المتوقع." },
      { name: "سارة خالد", rating: 5, date: "منذ أسبوعين", text: "تواصل احترافي ونتيجة رائعة. سأتعامل معه مجدداً في مشاريع قادمة." },
      { name: "خالد علي", rating: 4, date: "منذ شهر", text: "عمل جيد جداً واستجابة سريعة للملاحظات والتعديلات." }
    ]
  };
}

const elements = {
  loader: document.getElementById("pageLoader"),
  portfolioGrid: document.getElementById("portfolioGrid"),
  featuredPortfolio: document.getElementById("featuredPortfolio"),
  servicesGrid: document.getElementById("servicesGrid"),
  reviewsList: document.getElementById("reviewsList"),
  modal: document.getElementById("portfolioModal"),
  toast: document.getElementById("toast")
};

let activeProfile = demoProfiles[new URLSearchParams(location.search).get("id")] || demoProfiles["1"];
let currentPortfolioFilter = "الكل";

function initials(name) {
  return (name || "م").trim().charAt(0).toUpperCase();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

function createSkill(skill) {
  const tag = document.createElement("span");
  tag.textContent = skill;
  return tag;
}

function renderProfile(profile) {
  document.title = `${profile.name} - PikLance`;
  document.getElementById("profileName").textContent = profile.name;
  document.getElementById("profileInitial").textContent = initials(profile.name);
  const rankBadge = document.getElementById("profileRankBadge");
  if (profile.rank?.label) {
    rankBadge.textContent = profile.rank.label;
    rankBadge.hidden = false;
  } else {
    rankBadge.hidden = true;
  }
  const avatar = document.getElementById("profileAvatar");
  avatar.querySelector("img")?.remove();
  if (profile.avatar) {
    const image = document.createElement("img");
    image.src = profile.avatar;
    image.alt = profile.name;
    image.addEventListener("load", () => {
      document.getElementById("profileInitial").hidden = true;
    });
    avatar.appendChild(image);
  } else {
    document.getElementById("profileInitial").hidden = false;
  }
  document.getElementById("profileHeadline").textContent = profile.specialty;
  document.getElementById("profileLocation").textContent = profile.location || "سوريا";
  document.getElementById("profileResponse").textContent = profile.response || "يرد خلال ساعات";
  document.getElementById("sidebarSpecialty").textContent = profile.specialty;
  document.getElementById("memberSince").textContent = profile.memberSince || "2026";
  document.getElementById("profileLanguages").textContent = profile.languages || "العربية";
  document.getElementById("completedStat").textContent = profile.stats.completed;
  document.getElementById("ratingStat").textContent = profile.stats.rating.toFixed(1);
  document.getElementById("successStat").textContent = `${profile.stats.success}%`;
  document.getElementById("responseStat").textContent = profile.stats.response;
  document.getElementById("repeatStat").textContent = `${profile.stats.repeat}%`;

  document.getElementById("heroSkills").replaceChildren(...profile.skills.slice(0, 4).map(createSkill));
  document.getElementById("skillsCloud").replaceChildren(...profile.skills.map(createSkill));

  const about = profile.about.map(paragraph => {
    const element = document.createElement("p");
    element.textContent = paragraph;
    return element;
  });
  document.getElementById("profileAbout").replaceChildren(...about);

  document.getElementById("portfolioCount").textContent = profile.projects.length;
  document.getElementById("servicesCount").textContent = profile.services.length;
  document.getElementById("reviewsCount").textContent = profile.reviews.length;
  renderFeatured(profile.projects);
  renderPortfolioFilters(profile.projects);
  renderPortfolio(profile.projects);
  renderServices(profile.services);
  renderExperience(profile.experience);
  renderReviews(profile.reviews, profile.stats.rating);
}

function portfolioButton(project, featured = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = featured ? "featured-item" : "portfolio-item";
  const image = document.createElement("img");
  image.src = project.image;
  image.alt = project.title;
  image.loading = "lazy";
  const overlay = document.createElement("span");
  overlay.className = "work-overlay";
  const title = document.createElement("strong");
  title.textContent = project.title;
  const category = document.createElement("span");
  category.textContent = project.category;
  overlay.append(title, category);
  button.append(image, overlay);
  button.addEventListener("click", () => openPortfolioProject(project));
  return button;
}

function renderFeatured(projects) {
  const featured = projects.slice(0, 3);
  elements.featuredPortfolio.replaceChildren(...featured.map(project => portfolioButton(project, true)));
  document.getElementById("featuredEmpty").hidden = featured.length > 0;
}

function renderPortfolioFilters(projects) {
  const filters = ["الكل", ...new Set(projects.map(project => project.filter))];
  const buttons = filters.map(filter => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = filter;
    button.classList.toggle("active", filter === currentPortfolioFilter);
    button.addEventListener("click", () => {
      currentPortfolioFilter = filter;
      renderPortfolioFilters(projects);
      renderPortfolio(projects);
    });
    return button;
  });
  document.getElementById("portfolioFilters").replaceChildren(...buttons);
}

function renderPortfolio(projects) {
  const filtered = currentPortfolioFilter === "الكل"
    ? projects
    : projects.filter(project => project.filter === currentPortfolioFilter);
  elements.portfolioGrid.replaceChildren(...filtered.map(project => portfolioButton(project)));
  document.getElementById("portfolioEmpty").hidden = filtered.length > 0;
}

function renderServices(services) {
  const profileUid = new URLSearchParams(location.search).get("uid");
  const cards = services.map((service, index) => {
    const card = document.createElement("a");
    card.className = "service-card";
    const serviceId = service.id || index + 1;
    card.href = `service-details.html?id=${encodeURIComponent(serviceId)}${profileUid ? `&sellerUid=${encodeURIComponent(profileUid)}` : ""}`;
    const cover = document.createElement("div");
    cover.className = "service-cover";
    const image = document.createElement("img");
    image.src = service.image;
    image.alt = service.title;
    image.loading = "lazy";
    cover.appendChild(image);
    const copy = document.createElement("div");
    copy.className = "service-copy";
    const category = document.createElement("span");
    category.textContent = service.category;
    const title = document.createElement("h3");
    title.textContent = service.title;
    const footer = document.createElement("div");
    footer.className = "service-footer";
    const price = document.createElement("strong");
    price.textContent = `${Number(service.price).toLocaleString("ar-SY")} ل.س`;
    const delivery = document.createElement("span");
    delivery.textContent = `${service.delivery} أيام`;
    footer.append(price, delivery);
    copy.append(category, title, footer);
    card.append(cover, copy);
    return card;
  });
  elements.servicesGrid.replaceChildren(...cards);
  document.getElementById("servicesEmpty").hidden = services.length > 0;
}

function renderExperience(experience) {
  const items = experience.map(item => {
    const wrapper = document.createElement("div");
    wrapper.className = "experience-item";
    const dot = document.createElement("span");
    dot.className = "experience-dot";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.title;
    const place = document.createElement("p");
    place.textContent = item.place;
    const period = document.createElement("small");
    period.textContent = item.period;
    copy.append(title, place, period);
    wrapper.append(dot, copy);
    return wrapper;
  });
  document.getElementById("experienceList").replaceChildren(...items);
}

function renderReviews(reviews, average) {
  document.getElementById("reviewAverage").textContent = Number(average).toFixed(1);
  document.getElementById("reviewStars").textContent = `${"★".repeat(Math.round(average))}${"☆".repeat(5 - Math.round(average))}`;
  document.getElementById("reviewTotal").textContent = reviews.length;
  const bars = [5, 4, 3, 2, 1].map(star => {
    const count = reviews.filter(review => review.rating === star).length;
    const percentage = reviews.length ? Math.round((count / reviews.length) * 100) : 0;
    const row = document.createElement("div");
    row.className = "rating-row";
    const label = document.createElement("span");
    label.textContent = `${star} نجوم`;
    const track = document.createElement("span");
    track.className = "rating-track";
    const fill = document.createElement("span");
    fill.style.width = `${percentage}%`;
    track.appendChild(fill);
    const number = document.createElement("span");
    number.textContent = count;
    row.append(label, track, number);
    return row;
  });
  document.getElementById("ratingBars").replaceChildren(...bars);

  const cards = reviews.map(review => {
    const card = document.createElement("article");
    card.className = "review-card";
    const head = document.createElement("div");
    head.className = "review-head";
    const user = document.createElement("div");
    user.className = "review-user";
    const avatar = document.createElement("span");
    avatar.className = "review-avatar";
    avatar.textContent = initials(review.name);
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = review.name;
    const date = document.createElement("small");
    date.textContent = review.date;
    copy.append(name, date);
    user.append(avatar, copy);
    const stars = document.createElement("span");
    stars.className = "review-stars";
    stars.textContent = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`;
    head.append(user, stars);
    const text = document.createElement("p");
    text.textContent = review.text;
    card.append(head, text);
    return card;
  });
  elements.reviewsList.replaceChildren(...cards);
  document.getElementById("reviewsEmpty").hidden = reviews.length > 0;
}

function openPortfolioProject(project) {
  document.getElementById("modalProjectImage").src = project.image;
  document.getElementById("modalProjectImage").alt = project.title;
  document.getElementById("modalProjectCategory").textContent = project.category;
  document.getElementById("modalProjectTitle").textContent = project.title;
  document.getElementById("modalProjectDescription").textContent = project.description;
  document.getElementById("modalProjectTags").replaceChildren(...project.tags.map(createSkill));
  elements.modal.classList.add("open");
  elements.modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closePortfolioProject() {
  elements.modal.classList.remove("open");
  elements.modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function showTab(tabName) {
  document.querySelectorAll(".profile-tabs button").forEach(button => button.classList.toggle("active", button.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${tabName}`));
  document.querySelector(".profile-tabs").scrollIntoView({ behavior: "smooth", block: "start" });
}

function realProfileData(publicProfile, privateProfile = null) {
  const specialtyMap = { design: "مصمم جرافيك", web: "مطور ويب", writing: "كاتب ومحرر", marketing: "مسوق رقمي" };
  const specialty = specialtyMap[privateProfile?.specialty] || "مستقل محترف للخدمات الرقمية";
  return {
    name: publicProfile.name || "مستقل PikLance",
    avatar: publicProfile.avatar || "",
    specialty,
    skills: privateProfile?.specialty ? [specialty] : ["خدمات رقمية"],
    about: ["هذا المستقل عضو موثّق في PikLance ويعمل على إعداد تفاصيل ملفه ومعرض أعماله."],
    projects: [],
    services: [],
    reviews: [],
    experience: [],
    location: "سوريا",
    response: "يرد عبر رسائل المنصة",
    languages: "العربية",
    memberSince: "2026",
    stats: { completed: 0, rating: 0, success: 0, response: "--", repeat: 0 },
    rank: publicProfile.rank || null
  };
}

async function loadUidProfile(uid, currentUser) {
  try {
    const publicSnapshot = await getDoc(doc(db, "publicProfiles", uid));
    if (!publicSnapshot.exists()) return;
    let privateProfile = null;
    if (currentUser?.uid === uid) {
      const privateSnapshot = await getDoc(doc(db, "users", uid));
      if (privateSnapshot.exists()) privateProfile = privateSnapshot.data();
    }
    activeProfile = realProfileData(publicSnapshot.data(), privateProfile);
    renderProfile(activeProfile);
    document.getElementById("messageButton").href = `messages.html?withUid=${encodeURIComponent(uid)}`;
    document.getElementById("sideMessageButton").href = `messages.html?withUid=${encodeURIComponent(uid)}`;
  } catch (error) {
    console.error("Unable to load public profile", error);
    showToast("تعذر تحميل بيانات الملف الحقيقية، تم عرض نموذج الملف.");
  }
}

function bindEvents() {
  document.querySelectorAll(".profile-tabs button").forEach(button => button.addEventListener("click", () => showTab(button.dataset.tab)));
  document.querySelectorAll("[data-tab-target]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.tabTarget)));
  document.querySelectorAll("[data-close-portfolio]").forEach(button => button.addEventListener("click", closePortfolioProject));
  document.getElementById("shareButton").addEventListener("click", async () => {
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
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closePortfolioProject();
  });
}

bindEvents();
renderProfile(activeProfile);
elements.loader.classList.add("hidden");

const uid = new URLSearchParams(location.search).get("uid");
onAuthStateChanged(auth, async user => {
  if (uid) await loadUidProfile(uid, user);
});
