import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  deleteDoc, doc, getDoc, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { createEscrowOrder } from "./escrow.js";

const services = [
  {
    id: "1",
    title: "تصميم هوية بصرية كاملة تعكس شخصية مشروعك",
    subtitle: "هوية متكاملة تمنح علامتك حضوراً واضحاً ومتناسقاً عبر كل نقاط التواصل.",
    category: "تصميم وهوية بصرية",
    price: 25000,
    rating: 4.9,
    reviewsCount: 128,
    orders: 347,
    profileId: "1",
    seller: {
      name: "أحمد المصمم",
      specialty: "مصمم جرافيك وهوية بصرية",
      image: "https://randomuser.me/api/portraits/men/1.jpg",
      bio: "أساعد المشاريع الناشئة والعلامات التجارية على بناء هوية بصرية واضحة، متماسكة وقابلة للاستخدام في المطبوعات والمنصات الرقمية."
    },
    images: [
      "https://images.unsplash.com/photo-1561070791-2526d30994b5?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=1200&h=800&fit=crop"
    ],
    description: [
      "سأبني لمشروعك هوية بصرية احترافية تبدأ من فهم النشاط والجمهور، ثم تحويل شخصية العلامة إلى نظام بصري متناسق وسهل الاستخدام.",
      "تشمل الخدمة جلسة لفهم الاتجاه المطلوب، تطوير الأفكار، عرض المقترحات، وتنفيذ التعديلات ضمن الباقة المختارة. عند التسليم تحصل على ملفات منظمة وجاهزة للاستخدام."
    ],
    deliverables: [
      ["شعار رئيسي وبدائل", "نسخ مناسبة للخلفيات والأحجام المختلفة."],
      ["لوحة ألوان احترافية", "ألوان أساسية وثانوية مع أكواد الاستخدام."],
      ["نظام خطوط", "اختيار خطوط متناسقة للعناوين والنصوص."],
      ["دليل استخدام", "إرشادات عملية تحافظ على اتساق الهوية."]
    ]
  },
  {
    id: "2",
    title: "تطوير متجر إلكتروني سريع ومتجاوب",
    subtitle: "متجر احترافي يقدّم تجربة شراء واضحة ويعمل بكفاءة على جميع الأجهزة.",
    category: "برمجة وتطوير",
    price: 150000,
    rating: 4.8,
    reviewsCount: 94,
    orders: 215,
    profileId: "2",
    seller: {
      name: "سارة المبرمجة",
      specialty: "مطورة ويب وتطبيقات",
      image: "https://randomuser.me/api/portraits/women/1.jpg",
      bio: "أبني متاجر ومواقع سريعة وقابلة للتوسع مع اهتمام كبير بتجربة المستخدم، الأمان، وسهولة إدارة المحتوى والطلبات."
    },
    images: [
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=800&fit=crop"
    ],
    description: [
      "تطوير متجر إلكتروني متجاوب يركز على سهولة التصفح وتحويل الزوار إلى عملاء، مع صفحات منتجات منظمة وسلة شراء وتجربة استخدام مناسبة للموبايل.",
      "قبل التنفيذ نحدد عدد الصفحات والمنتجات والتكاملات المطلوبة، ثم تحصل على تحديثات دورية ونسخة جاهزة للاختبار قبل التسليم النهائي."
    ],
    deliverables: [
      ["واجهة متجاوبة", "تجربة متقنة على الموبايل والكمبيوتر."],
      ["إدارة المنتجات", "إضافة وتعديل المنتجات والتصنيفات بسهولة."],
      ["تهيئة أساسية للبحث", "بنية صفحات وعناوين مناسبة لمحركات البحث."],
      ["تدريب وتسليم", "شرح إدارة المتجر وملفات المشروع النهائية."]
    ]
  },
  {
    id: "3",
    title: "كتابة محتوى SEO احترافي يرفع جودة موقعك",
    subtitle: "محتوى عربي واضح ومقنع، مبني على نية البحث وصوت علامتك التجارية.",
    category: "كتابة ومحتوى",
    price: 8000,
    rating: 4.7,
    reviewsCount: 156,
    orders: 489,
    profileId: "3",
    seller: {
      name: "خالد الكاتب",
      specialty: "كاتب محتوى ومحرر",
      image: "https://randomuser.me/api/portraits/men/2.jpg",
      bio: "أكتب وأحرر المحتوى العربي للمواقع والمدونات والصفحات التسويقية، مع توازن بين سهولة القراءة ومتطلبات الظهور في نتائج البحث."
    },
    images: [
      "https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1456324504439-367cee3b3c32?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200&h=800&fit=crop"
    ],
    description: [
      "أكتب محتوى أصلياً ومنظماً يخاطب جمهورك ويجيب عن أسئلته، مع دمج الكلمات المفتاحية بصورة طبيعية دون الإضرار بجودة النص.",
      "تشمل العملية مراجعة موضوع المقال والجمهور المستهدف، بناء الهيكل، الكتابة، التدقيق اللغوي، وتجهيز العناوين والوصف المقترح."
    ],
    deliverables: [
      ["بحث الموضوع", "فهم المنافسين ونية البحث والأسئلة المهمة."],
      ["هيكل منظم", "عناوين رئيسية وفرعية سهلة القراءة."],
      ["تدقيق لغوي", "لغة عربية سليمة وأسلوب متناسق."],
      ["تهيئة SEO", "عنوان ووصف وكلمات مفتاحية مقترحة."]
    ]
  },
  {
    id: "4",
    title: "إدارة حملات إعلانية مبنية على البيانات",
    subtitle: "خطة إعلانية قابلة للقياس لتحسين الوصول وتقليل تكلفة اكتساب العميل.",
    category: "تسويق رقمي",
    price: 35000,
    rating: 4.9,
    reviewsCount: 87,
    orders: 156,
    profileId: "4",
    seller: {
      name: "ليلى المسوقة",
      specialty: "مسوقة رقمية وإعلانات",
      image: "https://randomuser.me/api/portraits/women/2.jpg",
      bio: "أدير الحملات المدفوعة وفق أهداف واضحة ومؤشرات أداء قابلة للقياس، من إعداد الجمهور والإعلانات إلى التحليل والتحسين."
    },
    images: [
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1533750349088-cd871a92f312?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1552664730-d307ca884978?w=1200&h=800&fit=crop"
    ],
    description: [
      "إعداد وإدارة حملة إعلانية تبدأ بتحليل الهدف والجمهور والعرض، ثم بناء الهيكل الإعلاني ومراقبة النتائج وإجراء التحسينات.",
      "تحصل على تقرير مفهوم يوضح المصروف والنتائج والتوصيات، مع تواصل مستمر حول التغييرات المهمة أثناء الحملة."
    ],
    deliverables: [
      ["استراتيجية حملة", "تحديد الهدف والجمهور والرسائل الإعلانية."],
      ["إعداد الإعلانات", "تنظيم الحملات والمجموعات والنسخ."],
      ["متابعة وتحسين", "مراجعة الأداء وتعديل الميزانيات والاستهداف."],
      ["تقرير نتائج", "ملخص واضح للأداء والخطوات التالية."]
    ]
  },
  {
    id: "5",
    title: "تسجيل تعليق صوتي عربي بجودة استوديو",
    subtitle: "أداء واضح وطبيعي يناسب الإعلانات والفيديوهات التعليمية والبودكاست.",
    category: "صوتيات",
    price: 15000,
    rating: 4.6,
    reviewsCount: 61,
    orders: 92,
    profileId: "5",
    seller: {
      name: "عماد الصوت",
      specialty: "مهندس صوت ومعلق",
      image: "https://randomuser.me/api/portraits/men/3.jpg",
      bio: "أقدّم تعليقاً صوتياً عربياً واضحاً مع تسجيل نظيف ومعالجة احترافية تناسب الإعلانات، الشروحات، والمواد التعليمية."
    },
    images: [
      "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=1200&h=800&fit=crop"
    ],
    description: [
      "تسجيل تعليق صوتي عربي وفق النبرة والسرعة المناسبة لمشروعك، مع تنقية الصوت وإزالة الضوضاء وتسليم ملف جاهز للاستخدام.",
      "أرسل النص ومرجعاً للنبرة المطلوبة إن وجد، وسنتفق قبل البدء على النطق والمدة وصيغة الملف النهائية."
    ],
    deliverables: [
      ["تسجيل عالي الجودة", "صوت نظيف مسجل في بيئة مناسبة."],
      ["معالجة احترافية", "تنقية وموازنة مستوى الصوت."],
      ["نبرة مخصصة", "أداء إعلاني أو تعليمي أو رسمي."],
      ["صيغ متعددة", "تسليم WAV وMP3 حسب الحاجة."]
    ]
  },
  {
    id: "6",
    title: "مونتاج فيديو احترافي يحافظ على انتباه المشاهد",
    subtitle: "إيقاع بصري مدروس ومونتاج نظيف للمحتوى الإعلاني ومنصات التواصل.",
    category: "فيديو ومونتاج",
    price: 50000,
    rating: 4.8,
    reviewsCount: 73,
    orders: 118,
    profileId: "6",
    seller: {
      name: "نور المنتجة",
      specialty: "منتجة فيديو ومونتيرة",
      image: "https://randomuser.me/api/portraits/women/3.jpg",
      bio: "أحوّل المواد الخام إلى قصة بصرية واضحة وجذابة، مع مونتاج وإيقاع وتصحيح ألوان يناسب المنصة والجمهور."
    },
    images: [
      "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=1200&h=800&fit=crop",
      "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1200&h=800&fit=crop"
    ],
    description: [
      "مونتاج فيديو متكامل يشمل ترتيب اللقطات، تحسين الإيقاع، إضافة النصوص والانتقالات المناسبة، ومعالجة الألوان والصوت.",
      "نحدد معاً هدف الفيديو والمنصة المستهدفة والمدة، ثم تحصل على نسخة أولية للمراجعة قبل إخراج النسخة النهائية."
    ],
    deliverables: [
      ["مونتاج كامل", "ترتيب اللقطات وبناء تسلسل واضح."],
      ["تصحيح ألوان", "مظهر متناسق واحترافي للفيديو."],
      ["نصوص وانتقالات", "عناصر بصرية تخدم المحتوى دون مبالغة."],
      ["تصدير للمنصة", "مقاسات وجودة مناسبة لمكان النشر."]
    ]
  }
];

const packagesFor = service => [
  {
    name: "أساسية",
    price: service.price,
    description: "مناسبة لطلب واضح ومحدد مع المخرجات الأساسية.",
    delivery: "4 أيام",
    revisions: "تعديلان",
    features: service.deliverables.slice(0, 2).map(item => item[0])
  },
  {
    name: "متقدمة",
    price: Math.round(service.price * 1.65),
    description: "نطاق أوسع وخيارات إضافية للمشاريع التي تحتاج مرونة أكبر.",
    delivery: "6 أيام",
    revisions: "3 تعديلات",
    features: service.deliverables.slice(0, 3).map(item => item[0])
  },
  {
    name: "احترافية",
    price: Math.round(service.price * 2.4),
    description: "الحزمة المتكاملة للمشاريع الجدية التي تريد أفضل نتيجة ممكنة.",
    delivery: "8 أيام",
    revisions: "5 تعديلات",
    features: service.deliverables.map(item => item[0])
  }
];

const sampleReviews = [
  ["محمد الأحمد", 5, "منذ 3 أيام", "تواصل ممتاز وفهم سريع للمطلوب، والنتيجة النهائية كانت مرتبة وأكثر احترافية مما توقعت."],
  ["سارة خالد", 5, "منذ أسبوعين", "التزام واضح بالموعد وتجاوب سريع مع الملاحظات. سأتعامل معه مجدداً."],
  ["عمر علي", 4, "منذ شهر", "عمل جميل وتجربة مريحة، خصوصاً في وضوح الخطوات والتحديثات أثناء التنفيذ."]
];

const params = new URLSearchParams(location.search);
const service = services.find(item => item.id === params.get("id")) || services[0];
const sellerUid = params.get("sellerUid") || "";
let selectedPackage = 0;
let signedIn = false;
let currentUser = null;
let currentProfile = null;

function showToast(message) {
  const toast = document.getElementById("serviceToast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function formatPrice(value) {
  return `${Number(value).toLocaleString("ar-SY")} ل.س`;
}

function messageUrl() {
  if (!sellerUid) return `freelancer-profile.html?id=${service.profileId}`;
  const query = new URLSearchParams({
    withUid: sellerUid,
    serviceId: service.id,
    serviceTitle: service.title,
    serviceImage: service.images[0],
    servicePrice: String(packagesFor(service)[selectedPackage].price)
  });
  return `messages.html?${query}`;
}

function updateContactLinks() {
  const href = messageUrl();
  const isMessage = Boolean(sellerUid);
  const primary = document.getElementById("startConversation");
  const sellerMessage = document.getElementById("sellerMessageLink");
  primary.href = signedIn || !isMessage ? href : `login.html?returnUrl=${encodeURIComponent(href)}`;
  primary.textContent = isMessage ? "ناقش الخدمة مع البائع" : "عرض ملف مقدم الخدمة";
  sellerMessage.href = signedIn || !isMessage ? href : `login.html?returnUrl=${encodeURIComponent(href)}`;
  sellerMessage.textContent = isMessage ? "مراسلة مقدم الخدمة" : "عرض الملف الشخصي";
}

async function handleOrderService() {
  if (!currentUser) {
    location.href = `login.html?returnUrl=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  if (!sellerUid) {
    showToast("اطلب الخدمة من ملف المستقل حتى يتم ربط الطلب بصاحب الخدمة الصحيح.");
    return;
  }
  if (sellerUid === currentUser.uid) {
    showToast("لا يمكنك طلب خدمة من حسابك نفسه.");
    return;
  }
  const button = document.getElementById("orderService");
  button.disabled = true;
  button.textContent = "جاري إنشاء الطلب...";
  try {
    const orderId = await createEscrowOrder(db, {
      user: currentUser,
      buyerName: currentProfile?.name || currentUser.email || "عميل",
      service,
      packageInfo: packagesFor(service)[selectedPackage],
      sellerUid
    });
    console.info("Created escrow order", orderId);
    showToast("تم إنشاء الطلب وحجز المبلغ لدى المنصة لهذا العمل فقط.");
    setTimeout(() => { location.href = "profile.html#orders"; }, 900);
  } catch (error) {
    console.error("Unable to create escrow order", error);
    showToast("تعذر إنشاء الطلب حالياً. تحقق من تسجيل الدخول والصلاحيات.");
    button.disabled = false;
    button.textContent = "اطلب الخدمة الآن";
  }
}

function renderGallery() {
  const main = document.getElementById("mainServiceImage");
  main.src = service.images[0];
  main.alt = service.title;
  const buttons = service.images.map((image, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("active", index === 0);
    const thumbnail = document.createElement("img");
    thumbnail.src = image;
    thumbnail.alt = `معاينة ${index + 1} من ${service.title}`;
    thumbnail.loading = "lazy";
    button.appendChild(thumbnail);
    button.addEventListener("click", () => {
      main.style.opacity = ".3";
      main.src = image;
      main.onload = () => { main.style.opacity = "1"; };
      document.querySelectorAll(".gallery-thumbs button").forEach(item => item.classList.toggle("active", item === button));
    });
    return button;
  });
  document.getElementById("galleryThumbs").replaceChildren(...buttons);
}

function renderPackages() {
  const packages = packagesFor(service);
  const tabs = packages.map((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.name;
    button.classList.toggle("active", index === selectedPackage);
    button.addEventListener("click", () => {
      selectedPackage = index;
      renderPackages();
      updateContactLinks();
    });
    return button;
  });
  document.getElementById("packageTabs").replaceChildren(...tabs);
  const active = packages[selectedPackage];
  document.getElementById("packagePrice").textContent = formatPrice(active.price);
  document.getElementById("packageDescription").textContent = active.description;
  document.getElementById("packageDelivery").textContent = active.delivery;
  document.getElementById("packageRevisions").textContent = active.revisions;
  document.getElementById("packageFeatures").replaceChildren(...active.features.map(feature => {
    const item = document.createElement("li");
    item.textContent = feature;
    return item;
  }));
}

function renderReviews() {
  const cards = sampleReviews.map(([name, rating, date, text]) => {
    const article = document.createElement("article");
    article.className = "review-item";
    article.innerHTML = `
      <div class="review-head">
        <div class="review-user"><span class="review-avatar">${name.charAt(0)}</span><span><strong>${name}</strong><small>${date}</small></span></div>
        <span class="review-stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span>
      </div>
      <p>${text}</p>`;
    return article;
  });
  document.getElementById("reviewsList").replaceChildren(...cards);
}

function renderRelated() {
  const related = services.filter(item => item.id !== service.id).slice(0, 3);
  const cards = related.map(item => {
    const link = document.createElement("a");
    link.className = "related-card";
    link.href = `service-details.html?id=${item.id}`;
    link.innerHTML = `
      <img src="${item.images[0]}" alt="${item.title}" loading="lazy">
      <div class="related-copy">
        <span>${item.category}</span>
        <h3>${item.title}</h3>
        <div><b>${formatPrice(item.price)}</b><span>★ ${item.rating}</span></div>
      </div>`;
    return link;
  });
  document.getElementById("relatedServices").replaceChildren(...cards);
}

function renderService() {
  document.title = `${service.title} - PikLance`;
  document.getElementById("breadcrumbCategory").textContent = service.category;
  document.getElementById("serviceCategory").textContent = service.category;
  document.getElementById("serviceTitle").textContent = service.title;
  document.getElementById("serviceSubtitle").textContent = service.subtitle;
  document.getElementById("serviceRating").textContent = service.rating.toFixed(1);
  document.getElementById("reviewCount").textContent = `(${service.reviewsCount} تقييماً)`;
  document.getElementById("ordersCount").textContent = `${service.orders} طلباً مكتملاً`;
  document.getElementById("serviceDescription").replaceChildren(...service.description.map(text => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
  document.getElementById("deliverablesGrid").replaceChildren(...service.deliverables.map(([title, description]) => {
    const article = document.createElement("article");
    article.className = "deliverable";
    article.innerHTML = `<span>✓</span><div><strong>${title}</strong><p>${description}</p></div>`;
    return article;
  }));
  document.getElementById("sellerImage").src = service.seller.image;
  document.getElementById("sellerImage").alt = service.seller.name;
  document.getElementById("sellerName").textContent = service.seller.name;
  document.getElementById("sellerSpecialty").textContent = service.seller.specialty;
  document.getElementById("sellerRating").textContent = service.rating.toFixed(1);
  document.getElementById("sellerBio").textContent = service.seller.bio;
  document.getElementById("reviewAverage").textContent = service.rating.toFixed(1);
  const profileHref = sellerUid
    ? `freelancer-profile.html?uid=${encodeURIComponent(sellerUid)}`
    : `freelancer-profile.html?id=${service.profileId}`;
  document.getElementById("sellerProfileLink").href = profileHref;
  renderGallery();
  renderPackages();
  renderReviews();
  renderRelated();
  updateContactLinks();
}

document.getElementById("favoriteService").addEventListener("click", event => {
  const active = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(active));
  event.currentTarget.classList.toggle("active", active);
  event.currentTarget.textContent = active ? "♥ محفوظة" : "♡ حفظ";
  showToast(active ? "تمت إضافة الخدمة إلى المحفوظات." : "تمت إزالة الخدمة من المحفوظات.");
});

document.getElementById("favoriteService").addEventListener("click", async event => {
  event.stopImmediatePropagation();
  if (!currentUser) {
    location.href = `login.html?returnUrl=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const button = event.currentTarget;
  const active = button.getAttribute("aria-pressed") !== "true";
  button.disabled = true;
  try {
    const reference = doc(db, "favorites", currentUser.uid, "services", service.id);
    if (active) {
      await setDoc(reference, {
        serviceId: service.id,
        title: service.title,
        category: service.category,
        price: packagesFor(service)[selectedPackage].price,
        sellerUid,
        savedAt: serverTimestamp()
      });
    } else {
      await deleteDoc(reference);
    }
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("active", active);
    button.textContent = active ? "♥ محفوظة" : "♡ حفظ";
    showToast(active ? "تمت إضافة الخدمة إلى المحفوظات." : "تمت إزالة الخدمة من المحفوظات.");
  } catch (error) {
    console.error("Unable to update favorite", error);
    showToast("تعذر تحديث قائمة المحفوظات.");
  } finally {
    button.disabled = false;
  }
}, true);

document.getElementById("orderService").addEventListener("click", handleOrderService);

document.getElementById("shareService").addEventListener("click", async () => {
  try {
    if (navigator.share) await navigator.share({ title: service.title, url: location.href });
    else {
      await navigator.clipboard.writeText(location.href);
      showToast("تم نسخ رابط الخدمة.");
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("تعذرت مشاركة الرابط.");
  }
});

document.querySelectorAll(".detail-tabs a").forEach(link => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".detail-tabs a").forEach(item => item.classList.toggle("active", item === link));
  });
});

onAuthStateChanged(auth, user => {
  signedIn = Boolean(user);
  updateContactLinks();
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  currentProfile = null;
  if (!user) return;
  try {
    const [snapshot, profileSnapshot] = await Promise.all([
      getDoc(doc(db, "favorites", user.uid, "services", service.id)),
      getDoc(doc(db, "users", user.uid))
    ]);
    currentProfile = profileSnapshot.exists() ? profileSnapshot.data() : null;
    const button = document.getElementById("favoriteService");
    button.setAttribute("aria-pressed", String(snapshot.exists()));
    button.classList.toggle("active", snapshot.exists());
    button.textContent = snapshot.exists() ? "♥ محفوظة" : "♡ حفظ";
  } catch {
    // The account may not have access to favorites yet.
  }
});

renderService();
