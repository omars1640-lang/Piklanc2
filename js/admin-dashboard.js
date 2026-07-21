import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { deleteObject, getDownloadURL, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { auth, db, functions, storage } from "./firebase.js";
import { sendOfficialEmail } from "./email-client.js";
import { seedDefaultBadges } from "./piklance-access.js";
import { applyAdminAccess, canAccessSection, firstAllowedSection, hasPermission, initializeAdminAccess } from "./admin-access.js";

const sectionMeta = {
  overview: ["مركز العمليات", "نظرة عامة"],
  verifications: ["الثقة والأمان", "طلبات التوثيق"],
  users: ["إدارة المجتمع", "المستخدمون"],
  ranks: ["نمو المستقلين", "رتب المستقلين"],
  promotions: ["النمو والدعوات", "الأكواد والشارات"],
  conversations: ["سلامة التواصل", "المحادثات"],
  marketplace: ["تشغيل السوق", "الخدمات والطلبات"],
  finance: ["الإدارة المالية", "المدفوعات والعمولات"],
  support: ["تجربة العملاء", "الدعم والنزاعات"],
  content: ["إدارة الموقع", "المحتوى والتصنيفات"],
  audit: ["الحوكمة", "سجل الإدارة"],
  settings: ["تهيئة النظام", "إعدادات المنصة"]
  ,team: ["إدارة الوصول", "الفريق والصلاحيات"]
};

const futureModules = {
  marketplace: {
    eyebrow: "مرحلة قاعدة البيانات التالية",
    title: "إدارة الخدمات والطلبات",
    description: "سيصبح هذا القسم مركز مراجعة الخدمات، دورة الطلب، التسليمات، الإلغاءات، ومؤشرات جودة السوق.",
    cards: [
      ["▦", "مراجعة الخدمات", "قبول أو إيقاف الخدمات وتتبع جودة بياناتها."],
      ["◎", "دورة الطلب", "متابعة الطلب منذ الشراء حتى التسليم والإغلاق."],
      ["↻", "الإلغاءات والاسترداد", "قرارات موثقة عند تعثر التنفيذ أو طلب الإلغاء."]
    ]
  },
  finance: {
    eyebrow: "يتطلب نظام الطلب والدفع",
    title: "المدفوعات والعمولات والمحافظ",
    description: "جاهز لاستقبال بيانات العمليات المالية الفعلية عند ربط بوابة الدفع ونظام المحفظة.",
    cards: [
      ["◈", "حركة الأموال", "تتبع الدفعات والرصيد المعلق والمحرر."],
      ["%", "عمولات المنصة", "تقارير العمولة حسب الفترة ونوع الخدمة."],
      ["↓", "طلبات السحب", "مراجعة واعتماد سحوبات المستقلين."]
    ]
  },
  support: {
    eyebrow: "وحدة تشغيل مستقبلية",
    title: "الدعم والنزاعات والبلاغات",
    description: "مركز موحد لتذاكر الدعم، النزاعات المرتبطة بالطلبات، وبلاغات إساءة الاستخدام.",
    cards: [
      ["?", "تذاكر الدعم", "توزيع الحالات ومتابعة وقت الاستجابة والحل."],
      ["⚖", "النزاعات", "مراجعة الأدلة واتخاذ قرار قابل للتدقيق."],
      ["!", "البلاغات", "التعامل مع المحتوى والحسابات المخالفة."]
    ]
  },
  content: {
    eyebrow: "وحدة محتوى مستقبلية",
    title: "المحتوى والتصنيفات",
    description: "ستدار من هنا صفحات المدونة، تصنيفات الخدمات، الأسئلة الشائعة، والبنرات الإعلانية.",
    cards: [
      ["▤", "المقالات", "تحرير وجدولة ونشر محتوى المدونة."],
      ["▦", "التصنيفات", "إدارة شجرة تصنيفات الخدمات والمهارات."],
      ["◇", "واجهات الموقع", "التحكم بالب banners والمحتوى المميز."]
    ]
  }
};

const statusLabels = {
  active: "نشط",
  pending: "معلق",
  rejected: "مرفوض",
  suspended: "موقوف"
};

const rankLevels = [
  { id: "auto", label: "تلقائي", minCompleted: -1, color: "auto" },
  { id: "new", label: "مستقل جديد", minCompleted: 0, color: "new" },
  { id: "active", label: "مستقل نشيط", minCompleted: 10, color: "active" },
  { id: "pro", label: "مستقل محترف", minCompleted: 50, color: "pro" },
  { id: "expert", label: "خبير خدمات", minCompleted: 100, color: "expert" },
  { id: "elite", label: "نخبة PikLance", minCompleted: 200, color: "elite" }
];

const actionLabels = {
  approve_user: "قبول وتفعيل مستخدم",
  reject_user: "رفض طلب مستخدم",
  suspend_user: "إيقاف حساب مستخدم",
  activate_user: "إعادة تفعيل مستخدم",
  update_freelancer_rank: "تحديث رتبة مستقل",
  create_promo_codes: "إنشاء أكواد",
  assign_badge: "إسناد شارة",
  create_badge: "إنشاء شارة",
  update_settings: "تحديث إعدادات المنصة"
};

const state = {
  admin: null,
  users: [],
  orders: [],
  chats: [],
  audit: [],
  promoCodes: [],
  badges: [],
  referrals: [],
  benefits: [],
  settings: null,
  metrics: null,
  selectedUser: null,
  pendingDecision: null
};

const elements = {
  loading: document.getElementById("adminLoading"),
  sidebar: document.getElementById("adminSidebar"),
  backdrop: document.getElementById("sidebarBackdrop"),
  userModal: document.getElementById("userModal"),
  modalBody: document.getElementById("modalBody"),
  modalActions: document.getElementById("modalActions"),
  decisionModal: document.getElementById("decisionModal"),
  toast: document.getElementById("adminToast")
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3000);
}

function initials(name) {
  return (name || "أ").trim().charAt(0).toUpperCase();
}

function toDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatDate(value, includeTime = false) {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleString("en-US", includeTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" });
}

function accountTypeLabel(type) {
  return type === "freelancer" ? "مستقل" : "عميل";
}

function userCell(user) {
  const wrapper = document.createElement("div");
  wrapper.className = "user-cell";
  const avatar = document.createElement("span");
  avatar.className = "table-avatar";
  avatar.textContent = initials(user.name);
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = user.name || "مستخدم بدون اسم";
  const email = document.createElement("small");
  email.textContent = user.email || "-";
  copy.append(name, email);
  wrapper.append(avatar, copy);
  return wrapper;
}

function badge(label, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = label;
  return span;
}

function button(label, className, handler) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  control.textContent = label;
  control.addEventListener("click", handler);
  return control;
}

function completedOrdersFor(uid) {
  return state.orders.filter(order => order.freelancerUid === uid && ["completed", "released"].includes(order.status)).length;
}

function automaticRank(completed) {
  return [...rankLevels]
    .filter(rank => rank.id !== "auto" && completed >= rank.minCompleted)
    .sort((a, b) => b.minCompleted - a.minCompleted)[0] || rankLevels.find(rank => rank.id === "new");
}

function effectiveRank(user) {
  const manual = rankLevels.find(rank => rank.id === user.manualRank);
  return manual && manual.id !== "auto" ? manual : automaticRank(completedOrdersFor(user.id));
}

function ensureRanksUi() {
  if (!document.querySelector('[data-section="ranks"]')) {
    const usersLink = document.querySelector('[data-section="users"]');
    const ranksLink = document.createElement("button");
    ranksLink.className = "nav-link";
    ranksLink.type = "button";
    ranksLink.dataset.section = "ranks";
    ranksLink.innerHTML = "<span>◆</span><b>رتب المستقلين</b>";
    usersLink?.after(ranksLink);
    ranksLink.addEventListener("click", () => showSection("ranks"));
  }

  if (!document.getElementById("ranks-section")) {
    const section = document.createElement("section");
    section.className = "admin-section";
    section.id = "ranks-section";
    section.innerHTML = `
      <div class="section-heading">
        <div><p>نمو المستقلين</p><h2>إدارة رتب وشارات المستقلين</h2><span>اضبط رتبة يدوية عند الحاجة، أو اتركها تلقائية حسب عدد الطلبات المكتملة.</span></div>
        <div class="heading-stat"><strong id="rankedFreelancersCount">0</strong><small>مستقل نشط</small></div>
      </div>
      <div class="rank-guide">
        <article><strong>جديد</strong><span>0 خدمة مكتملة</span></article>
        <article><strong>نشيط</strong><span>10 خدمات مكتملة</span></article>
        <article><strong>محترف</strong><span>50 خدمة مكتملة</span></article>
        <article><strong>خبير</strong><span>100 خدمة مكتملة</span></article>
        <article><strong>نخبة</strong><span>200 خدمة مكتملة</span></article>
      </div>
      <div class="data-panel">
        <div class="data-toolbar">
          <label class="search-field"><span>⌕</span><input id="rankSearch" type="search" placeholder="بحث باسم المستقل أو بريده"></label>
          <select id="rankFilter"><option value="all">كل الرتب</option>${rankLevels.filter(rank => rank.id !== "auto").map(rank => `<option value="${rank.id}">${rank.label}</option>`).join("")}</select>
        </div>
        <div class="table-wrap"><table><thead><tr><th>المستقل</th><th>الخدمات المكتملة</th><th>الرتبة الحالية</th><th>تعديل الرتبة</th></tr></thead><tbody id="ranksTable"></tbody></table></div>
        <div class="empty-state" id="ranksEmpty" hidden><span>◆</span><strong>لا يوجد مستقلون مطابقون</strong></div>
      </div>
    `;
    document.getElementById("users-section")?.after(section);
    document.getElementById("rankSearch").addEventListener("input", renderRanks);
    document.getElementById("rankFilter").addEventListener("change", renderRanks);
  }
}

const defaultBadges = {
  friends: { id: "friends", label: "أصدقاء PikLance", icon: "◆", tone: "purple" },
  ambassador: { id: "ambassador", label: "سفير", icon: "✦", tone: "gold" }
};

function normalizeAdminCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "");
}

function randomCode(prefix = "PIK") {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return normalizeAdminCode(`${prefix}-${random}`);
}

function ensurePromotionsUi() {
  if (!document.querySelector('[data-section="promotions"]')) {
    const ranksLink = document.querySelector('[data-section="ranks"]') || document.querySelector('[data-section="users"]');
    const link = document.createElement("button");
    link.className = "nav-link";
    link.type = "button";
    link.dataset.section = "promotions";
    link.innerHTML = "<span>✦</span><b>الأكواد والشارات</b>";
    ranksLink?.after(link);
    link.addEventListener("click", () => showSection("promotions"));
  }

  if (document.getElementById("promotions-section")) return;
  const section = document.createElement("section");
  section.className = "admin-section";
  section.id = "promotions-section";
  section.innerHTML = `
    <div class="section-heading">
      <div><p>النمو والدعوات</p><h2>إدارة الأكواد والشارات</h2><span>أنشئ أكواد وصول مسبق أو دعوات، وامنح الشارات اليدوية من مكان واحد.</span></div>
      <div class="heading-stat"><strong id="promoCodesCount">0</strong><small>كود</small></div>
    </div>
    <div class="content-admin-grid">
      <form class="content-editor" id="promoCodeForm">
        <header><div><small>قائمة أكواد جديدة</small><h3>إنشاء أكواد</h3></div></header>
        <div class="content-form-row">
          <label>نوع الكود<select id="promoType"><option value="early_access">وصول مسبق</option><option value="discount">خصم عام</option><option value="referral">دعوة شخصية</option></select></label>
          <label>عدد الأكواد<input id="promoCount" type="number" min="1" max="200" value="10"></label>
        </div>
        <div class="content-form-row">
          <label>بادئة الكود<input id="promoPrefix" type="text" maxlength="16" value="FRIEND"></label>
          <label>نسبة الخصم %<input id="promoDiscount" type="number" min="0" max="100" step="1" value="0"></label>
        </div>
        <div class="content-form-row">
          <label>مدة الخصم بالأيام<input id="promoDuration" type="number" min="0" max="365" value="0"></label>
          <label>الشارة<select id="promoBadge"><option value="">بدون شارة</option><option value="friends">أصدقاء PikLance</option><option value="ambassador">سفير</option></select></label>
        </div>
        <button class="primary-button" type="submit">إنشاء القائمة</button>
      </form>
      <div class="content-list-panel">
        <div class="panel-head"><div><p>الأكواد الحالية</p><h3>آخر الأكواد</h3></div><b id="promoActiveCount">0</b></div>
        <div class="promo-tools">
          <input id="promoSearch" type="search" placeholder="ابحث عن كود أو اسم المالك">
          <select id="promoStatusFilter">
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="used">مستخدم</option>
          </select>
          <select id="promoTypeFilter">
            <option value="all">كل الأنواع</option>
            <option value="early_access">وصول مسبق</option>
            <option value="referral">دعوة</option>
            <option value="discount">خصم</option>
          </select>
          <button class="secondary-button" id="exportPromoCodes" type="button">تصدير CSV</button>
        </div>
        <div class="admin-content-list" id="promoCodesList"></div>
      </div>
      <form class="content-editor featured-badges-form" id="featuredBadgesForm">
        <header><div><small>الصفحة الرئيسية</small><h3>شارات الخدمات المميزة</h3></div></header>
        <p class="form-help">اختر شارة أو أكثر لعرض خدمات أصحابها في بطاقات الصفحة الرئيسية. إذا لم تحدد أي شارة ستُعرض كل الخدمات المنشورة.</p>
        <div class="badge-choice-grid" id="featuredBadgeOptions"></div>
        <button class="primary-button" type="submit">حفظ فئات العرض</button>
      </form>
      <form class="content-editor" id="badgeAssignForm">
        <header><div><small>شارة يدوية</small><h3>إسناد شارة لمستخدم</h3></div></header>
        <div class="content-form-row">
          <label>بحث المستخدم<input id="badgeUserSearch" type="search" placeholder="ابحث بالاسم أو البريد"></label>
          <label>نوع الحساب<select id="badgeUserTypeFilter"><option value="all">كل الحسابات</option><option value="freelancer">المستقلون</option><option value="buyer">العملاء</option><option value="admin">الإدارة</option></select></label>
        </div>
        <label>المستخدم<select id="badgeUserSelect"></select></label>
        <label>الشارة<select id="manualBadge"></select></label>
        <button class="primary-button" type="submit">إسناد الشارة</button>
      </form>
      <form class="content-editor" id="badgeCreateForm">
        <header><div><small>شارة جديدة</small><h3>إضافة شارة للمنصة</h3></div></header>
        <div class="content-form-row">
          <label>معرّف الشارة<input id="newBadgeId" type="text" maxlength="32" placeholder="example-badge" required></label>
          <label>اسم الشارة<input id="newBadgeLabel" type="text" maxlength="40" placeholder="اسم الشارة" required></label>
        </div>
        <div class="content-form-row">
          <label>الأيقونة<input id="newBadgeIcon" type="text" maxlength="4" value="◆" required></label>
          <label>اللون<select id="newBadgeTone"><option value="purple">بنفسجي</option><option value="gold">ذهبي</option><option value="blue">أزرق</option><option value="green">أخضر</option><option value="red">أحمر</option></select></label>
        </div>
        <label>وصف الشارة<textarea id="newBadgeDescription" rows="2" maxlength="180" placeholder="وصف قصير يظهر للإدارة"></textarea></label>
        <button class="primary-button" type="submit">إضافة الشارة</button>
      </form>
      <div class="content-list-panel">
        <div class="panel-head"><div><p>الشارات</p><h3>شارات المنصة</h3></div><b id="badgesCount">0</b></div>
        <div class="admin-content-list" id="badgesList"></div>
      </div>
    </div>
  `;
  document.getElementById("users-section")?.after(section);
  document.getElementById("promoCodeForm").addEventListener("submit", createPromoCodes);
  document.getElementById("featuredBadgesForm").addEventListener("submit", saveFeaturedBadges);
  document.getElementById("badgeAssignForm").addEventListener("submit", assignManualBadge);
  document.getElementById("badgeCreateForm").addEventListener("submit", createPlatformBadge);
  document.getElementById("badgeUserSearch").addEventListener("input", renderPromotions);
  document.getElementById("badgeUserTypeFilter").addEventListener("change", renderPromotions);
  document.getElementById("promoSearch").addEventListener("input", renderPromotions);
  document.getElementById("promoStatusFilter").addEventListener("change", renderPromotions);
  document.getElementById("promoTypeFilter").addEventListener("change", renderPromotions);
  document.getElementById("exportPromoCodes").addEventListener("click", exportPromoCodes);
}

function filteredPromoCodes() {
  const searchText = (document.getElementById("promoSearch")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("promoStatusFilter")?.value || "all";
  const typeFilter = document.getElementById("promoTypeFilter")?.value || "all";
  return [...state.promoCodes]
    .filter(code => {
      const haystack = [code.code, code.id, code.type, code.status, code.ownerName, code.ownerUid, code.groupId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (!searchText || haystack.includes(searchText))
        && (statusFilter === "all" || (code.status || "active") === statusFilter)
        && (typeFilter === "all" || (code.type || "promo") === typeFilter);
    })
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

function renderPromotions() {
  const userSearch = (document.getElementById("badgeUserSearch")?.value || "").trim().toLowerCase();
  const userTypeFilter = document.getElementById("badgeUserTypeFilter")?.value || "all";
  const users = state.users.filter(user => {
    const haystack = `${user.name || ""} ${user.email || ""}`.toLowerCase();
    return user.status === "active"
      && (!userSearch || haystack.includes(userSearch))
      && (userTypeFilter === "all" || user.accountType === userTypeFilter || user.role === userTypeFilter);
  }).slice(0, 80);
  const badges = state.badges.length ? state.badges : Object.values(defaultBadges);
  const configuredRanks = new Map(rankLevels.filter(item => item.id !== "auto").map(item => [item.id, item]));
  state.users.forEach(user => {
    const rank = user.rank;
    if (rank?.id && rank?.label && !configuredRanks.has(rank.id)) {
      configuredRanks.set(rank.id, { id: rank.id, label: rank.label, color: rank.color || "auto", minCompleted: Number(rank.completedServices || 0) });
    }
  });
  const featuredCriteriaOptions = [
    ...badges.map(item => ({ ...item, criterionId: `badge:${item.id}`, criterionType: "badge" })),
    ...[...configuredRanks.values()].map(item => ({ ...item, criterionId: `rank:${item.id}`, criterionType: "rank", icon: "◆", tone: item.color }))
  ];
  const userSelect = document.getElementById("badgeUserSelect");
  if (userSelect) {
    userSelect.replaceChildren(...users.map(user => new Option(`${user.name || user.email} - ${user.role === "admin" ? "إدارة" : accountTypeLabel(user.accountType)}`, user.id)));
  }
  const manualBadge = document.getElementById("manualBadge");
  const promoBadge = document.getElementById("promoBadge");
  if (manualBadge) {
    const current = manualBadge.value;
    manualBadge.replaceChildren(...badges.map(badge => new Option(badge.label, badge.id)));
    if (badges.some(badge => badge.id === current)) manualBadge.value = current;
  }
  if (promoBadge) {
    const current = promoBadge.value;
    promoBadge.replaceChildren(new Option("بدون شارة", ""), ...badges.map(badge => new Option(badge.label, badge.id)));
    if (current && badges.some(badge => badge.id === current)) promoBadge.value = current;
  }
  const selectedCriteria = new Set(Array.isArray(state.settings?.homeFeaturedCriteria)
    ? state.settings.homeFeaturedCriteria
    : (Array.isArray(state.settings?.homeFeaturedBadgeIds) ? state.settings.homeFeaturedBadgeIds.map(id => `badge:${id}`) : []));
  const featuredOptions = document.getElementById("featuredBadgeOptions");
  if (featuredOptions) {
    featuredOptions.replaceChildren(...featuredCriteriaOptions.map(badge => {
      const label = document.createElement("label");
      label.className = "badge-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "homeFeaturedBadge";
      input.value = badge.criterionId;
      input.checked = selectedCriteria.has(badge.criterionId) || selectedCriteria.has(badge.id);
      const icon = document.createElement("span");
      icon.className = `profile-extra-badge ${badge.tone || ""}`.trim();
      icon.textContent = `${badge.icon || "◆"} ${badge.label || badge.id}${badge.criterionType === "rank" ? " · رتبة" : " · شارة"}`;
      label.append(input, icon);
      return label;
    }));
  }

  const codes = [...state.promoCodes].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const filteredCodes = filteredPromoCodes();

  document.getElementById("promoCodesCount").textContent = codes.length;
  document.getElementById("promoActiveCount").textContent = filteredCodes.filter(code => (code.status || "active") === "active").length;
  document.getElementById("promoCodesList").replaceChildren(...filteredCodes.slice(0, 120).map(code => {
    const row = document.createElement("article");
    const value = code.code || code.id;
    row.className = "admin-content-item promo-code-item";
    row.innerHTML = `
      <div class="promo-code-copy">
        <code>${value}</code>
        <button class="secondary-button promo-copy-button" type="button" data-code="${value}">نسخ</button>
      </div>
      <div>
        <strong>${code.ownerName || code.type || "كود منصة"}</strong>
        <small>${code.type || "promo"} · ${code.status || "active"} · ${Number(code.usedCount || 0)}/${Number(code.maxUses || 1)}</small>
      </div>
      <span>${code.discountPercent ? `${code.discountPercent}%` : code.badgeIds?.join(", ") || "-"}</span>
    `;
    row.querySelector("[data-code]").addEventListener("click", async event => {
      await navigator.clipboard?.writeText(event.currentTarget.dataset.code).catch(() => {});
      showToast("تم نسخ الكود.");
    });
    return row;
  }));

  document.getElementById("badgesCount").textContent = badges.length;
  document.getElementById("badgesList").replaceChildren(...badges.map(badge => {
    const row = document.createElement("article");
    row.className = "admin-content-item";
    row.innerHTML = `<div><strong>${badge.icon} ${badge.label}</strong><small>${badge.id}</small></div><span>${badge.tone}</span>`;
    return row;
  }));
}

async function saveFeaturedBadges(event) {
  event.preventDefault();
  if (!hasPermission("promotions.manage")) return showToast("لا تملك صلاحية إدارة الشارات.");
  const criteria = [...document.querySelectorAll('input[name="homeFeaturedBadge"]:checked')].map(input => input.value);
  const badgeIds = criteria.filter(value => value.startsWith("badge:")).map(value => value.slice(6));
  const batch = writeBatch(db);
  batch.set(doc(db, "platformSettings", "general"), {
    homeFeaturedBadgeIds: badgeIds,
    homeFeaturedCriteria: criteria,
    updatedAt: serverTimestamp(),
    updatedBy: state.admin.id
  }, { merge: true });
  batch.set(doc(collection(db, "adminAuditLogs")), auditData("update_settings", {}, `home_featured_criteria: ${criteria.join(",") || "all"}`));
  await batch.commit();
  showToast(criteria.length ? "تم حفظ فئات الشارات والرتب للخدمات المميزة." : "ستُعرض خدمات كل المستقلين في الصفحة الرئيسية.");
  await loadData();
}

function exportPromoCodes() {
  const headers = ["code", "type", "status", "usedCount", "maxUses", "discountPercent", "discountDays", "ownerName", "ownerUid", "groupId"];
  const rows = filteredPromoCodes().map(code => [
    code.code || code.id || "",
    code.type || "",
    code.status || "active",
    Number(code.usedCount || 0),
    Number(code.maxUses || 1),
    Number(code.discountPercent || 0),
    Number(code.discountDays || 0),
    code.ownerName || "",
    code.ownerUid || "",
    code.groupId || ""
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `piklance-promo-codes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function createPromoCodes(event) {
  event.preventDefault();
  const type = document.getElementById("promoType").value;
  const count = Math.max(1, Math.min(200, Number(document.getElementById("promoCount").value || 1)));
  const prefix = normalizeAdminCode(document.getElementById("promoPrefix").value || "PIK");
  const discountPercent = Number(document.getElementById("promoDiscount").value || 0);
  const discountDays = Number(document.getElementById("promoDuration").value || 0);
  const badgeId = document.getElementById("promoBadge").value;
  const groupRef = doc(collection(db, "promoCodeGroups"));
  const batch = writeBatch(db);
  batch.set(groupRef, {
    name: `${prefix} - ${type}`,
    type,
    prefix,
    count,
    discountPercent,
    discountDays,
    badgeIds: badgeId ? [badgeId] : [],
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: state.admin.id
  });
  const created = new Set();
  while (created.size < count) created.add(randomCode(prefix));
  created.forEach(code => {
    batch.set(doc(db, "promoCodes", code), {
      code,
      groupId: groupRef.id,
      type,
      status: "active",
      maxUses: 1,
      usedCount: 0,
      discountPercent,
      discountDays,
      badgeIds: badgeId ? [badgeId] : [],
      usedBy: [],
      createdAt: serverTimestamp(),
      createdBy: state.admin.id
    });
  });
  batch.set(doc(collection(db, "adminAuditLogs")), auditData("create_promo_codes", {}, `${type} ${prefix} x${count}`));
  await batch.commit();
  showToast(`تم إنشاء ${count} كود بنجاح.`);
  await loadData();
}

async function assignManualBadge(event) {
  event.preventDefault();
  const uid = document.getElementById("badgeUserSelect").value;
  const badgeId = document.getElementById("manualBadge").value;
  const user = state.users.find(item => item.id === uid);
  const badge = state.badges.find(item => item.id === badgeId) || defaultBadges[badgeId];
  if (!uid || !badge || !user) return;
  const batch = writeBatch(db);
  batch.set(doc(db, "userBadges", `${uid}_${badge.id}`), {
    uid,
    badgeId: badge.id,
    label: badge.label,
    icon: badge.icon,
    tone: badge.tone,
    source: "manual_admin",
    assignedBy: state.admin.id,
    assignedAt: serverTimestamp()
  });
  batch.set(doc(db, "publicProfiles", uid), {
    badges: { [badge.id]: { label: badge.label, icon: badge.icon, tone: badge.tone } }
  }, { merge: true });
  batch.set(doc(collection(db, "adminAuditLogs")), auditData("assign_badge", user, badge.label));
  await batch.commit();
  showToast("تم إسناد الشارة بنجاح.");
  await loadData();
}

async function createPlatformBadge(event) {
  event.preventDefault();
  const id = normalizeAdminCode(document.getElementById("newBadgeId").value).toLowerCase();
  const label = document.getElementById("newBadgeLabel").value.trim();
  const icon = document.getElementById("newBadgeIcon").value.trim() || "◆";
  const tone = document.getElementById("newBadgeTone").value;
  const description = document.getElementById("newBadgeDescription").value.trim();
  if (!id || !label) {
    showToast("أدخل معرّف واسم الشارة أولاً.");
    return;
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "badges", id), {
    id,
    label,
    icon,
    tone,
    description,
    active: true,
    custom: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: state.admin.id
  }, { merge: true });
  batch.set(doc(collection(db, "adminAuditLogs")), auditData("create_badge", { id, title: label }, description));
  await batch.commit();
  event.currentTarget.reset();
  document.getElementById("newBadgeIcon").value = "◆";
  showToast("تمت إضافة الشارة بنجاح.");
  await loadData();
}

function showSection(sectionName) {
  if (!canAccessSection(sectionName)) sectionName = firstAllowedSection();
  if (!sectionName) return;
  document.querySelectorAll(".admin-section").forEach(section => section.classList.toggle("active", section.id === `${sectionName}-section`));
  document.querySelectorAll(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.section === sectionName));
  const [eyebrow, title] = sectionMeta[sectionName];
  document.getElementById("pageEyebrow").textContent = eyebrow;
  document.getElementById("pageTitle").textContent = title;
  history.replaceState({}, "", `#${sectionName}`);
  elements.sidebar.classList.remove("open");
  elements.backdrop.classList.remove("open");
  window.dispatchEvent(new CustomEvent("admin:section-change", { detail: { section: sectionName } }));
}

function buildFutureSections() {
  document.querySelectorAll(".future-section").forEach(section => {
    const module = futureModules[section.dataset.module];
    section.innerHTML = `
      <div class="future-module">
        <div class="future-hero">
          <div><p>${module.eyebrow}</p><h2>${module.title}</h2><span>${module.description}</span></div>
          <b>مخطط وجاهز للربط</b>
        </div>
        <div class="future-grid">
          ${module.cards.map(([icon, title, copy]) => `<article class="future-card"><span>${icon}</span><h3>${title}</h3><p>${copy}</p><small>سيُفعّل عند إنشاء مجموعة البيانات الخاصة به</small></article>`).join("")}
        </div>
      </div>`;
  });
}

function renderMetrics() {
  const users = state.users;
  const freelancers = users.filter(user => user.accountType === "freelancer");
  const activeFreelancers = freelancers.filter(user => user.status === "active");
  const buyers = users.filter(user => user.accountType === "buyer");
  const pending = users.filter(user => user.status === "pending");
  const inactive = users.filter(user => user.status !== "active");

  const metrics = state.metrics || {};
  const totalUsers = metrics.totalUsers ?? users.length;
  const activeFreelancersTotal = metrics.activeFreelancers ?? activeFreelancers.length;
  const pendingTotal = metrics.pendingUsers ?? pending.length;
  const chatsTotal = metrics.totalChats ?? state.chats.length;
  const buyersTotal = metrics.buyers ?? buyers.length;
  const freelancersTotal = metrics.freelancers ?? freelancers.length;
  const inactiveTotal = metrics.inactiveUsers ?? inactive.length;
  document.getElementById("totalUsers").textContent = totalUsers;
  document.getElementById("activeFreelancers").textContent = activeFreelancersTotal;
  document.getElementById("pendingUsers").textContent = pendingTotal;
  document.getElementById("totalChats").textContent = chatsTotal;
  const verificationBadge = document.getElementById("verificationBadge");
  verificationBadge.textContent = pendingTotal ? String(pendingTotal) : "";
  verificationBadge.hidden = pendingTotal === 0;
  window.dispatchEvent(new CustomEvent("admin:verification-count", { detail: { count: pendingTotal } }));
  document.getElementById("pendingHeadingCount").textContent = pendingTotal;
  document.getElementById("freelancerShare").textContent = `${totalUsers ? Math.round(activeFreelancersTotal / totalUsers * 100) : 0}% من المستخدمين`;
  document.getElementById("buyersCount").textContent = buyersTotal;
  document.getElementById("freelancersCount").textContent = freelancersTotal;
  document.getElementById("inactiveCount").textContent = inactiveTotal;
  document.getElementById("donutTotal").textContent = totalUsers;
  const buyerPercent = totalUsers ? buyersTotal / totalUsers * 100 : 0;
  const freelancerPercent = totalUsers ? freelancersTotal / totalUsers * 100 : 0;
  const donut = document.getElementById("accountDonut");
  donut.style.setProperty("--buyer", `${buyerPercent}%`);
  donut.style.setProperty("--freelancer", `${freelancerPercent}%`);

  document.getElementById("chatMetricTotal").textContent = chatsTotal;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  document.getElementById("activeChatsWeek").textContent = metrics.activeChatsWeek ?? state.chats.filter(chat => toDate(chat.lastUpdated)?.getTime() >= weekAgo).length;
  document.getElementById("serviceChats").textContent = metrics.serviceChats ?? state.chats.filter(chat => chat.context?.serviceId).length;
}

function renderRegistrationChart() {
  const months = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleDateString("en-US", { month: "short" }),
      count: 0
    });
  }
  state.users.forEach(user => {
    const date = toDate(user.createdAt);
    const month = months.find(item => item.key === `${date?.getFullYear()}-${date?.getMonth()}`);
    if (month) month.count += 1;
  });
  const max = Math.max(...months.map(month => month.count), 1);
  document.getElementById("registrationChart").innerHTML = months.map(month => `
    <div class="bar-item"><strong>${month.count}</strong><i style="height:${Math.max(month.count / max * 160, 4)}px"></i><span>${month.label}</span></div>
  `).join("");
}

function renderAlerts() {
  const pending = state.metrics?.pendingUsers ?? state.users.filter(user => user.status === "pending").length;
  const suspended = state.users.filter(user => user.status === "suspended").length;
  const alerts = [];
  if (pending) alerts.push(["warning", "◷", `${pending} طلب توثيق ينتظر المراجعة`, "راجع الهوية واتخذ قراراً حتى لا تتأخر طلبات المستقلين.", "verifications"]);
  if (suspended) alerts.push(["", "!", `${suspended} حساب موقوف`, "راجع الحسابات الموقوفة واحتفظ بسبب واضح لكل قرار.", "users"]);
  if (!state.settings) alerts.push(["warning", "⚙", "إعدادات المنصة غير مهيأة", "احفظ الإعدادات العامة لأول مرة لإنشاء سجل مركزي.", "settings"]);
  if (!alerts.length) alerts.push(["", "✓", "لا توجد تنبيهات حرجة", "العمليات الحالية لا تحتاج تدخلاً فورياً.", "overview"]);

  const container = document.getElementById("operationalAlerts");
  container.replaceChildren(...alerts.map(([type, icon, title, copy, section]) => {
    const item = document.createElement("article");
    item.className = `alert-item ${type}`;
    item.innerHTML = `<span>${icon}</span><div><strong>${title}</strong><p>${copy}</p></div>`;
    item.appendChild(button("فتح", "text-button", () => showSection(section)));
    return item;
  }));
}

function renderVerifications() {
  const term = document.getElementById("verificationSearch").value.trim().toLowerCase();
  const specialty = document.getElementById("verificationSpecialty").value;
  const pending = state.users.filter(user => {
    const haystack = `${user.name || ""} ${user.email || ""} ${user.idNumber || ""}`.toLowerCase();
    return user.status === "pending" && (!term || haystack.includes(term)) && (specialty === "all" || user.specialty === specialty);
  });
  const table = document.getElementById("verificationTable");
  table.replaceChildren(...pending.map(user => {
    const row = document.createElement("tr");
    const identity = document.createElement("td");
    identity.append(badge(user.idFrontPath && user.idBackPath ? "مرفوعة" : "ناقصة", `status-badge ${user.idFrontPath && user.idBackPath ? "status-active" : "status-rejected"}`));
    const actions = document.createElement("td");
    actions.className = "table-actions";
    actions.append(button("عرض", "table-button", () => openUserModal(user.id)));
    if (hasPermission("verifications.manage")) actions.append(
      button("قبول", "table-button approve", () => openDecision(user.id, "approve_user")),
      button("رفض", "table-button reject", () => openDecision(user.id, "reject_user"))
    );
    const values = [
      userCell(user),
      user.specialty || "-",
      user.phone || "-",
      formatDate(user.createdAt),
      identity,
      actions
    ];
    values.forEach(value => {
      const cell = document.createElement("td");
      cell.append(value instanceof Node ? value : document.createTextNode(value));
      row.appendChild(cell);
    });
    return row;
  }));
  document.getElementById("verificationEmpty").hidden = pending.length > 0;
}

function populateSpecialties() {
  const select = document.getElementById("verificationSpecialty");
  const current = select.value;
  const specialties = [...new Set(state.users.filter(user => user.specialty).map(user => user.specialty))];
  select.replaceChildren(new Option("كل التخصصات", "all"), ...specialties.map(value => new Option(value, value)));
  select.value = specialties.includes(current) ? current : "all";
}

function renderUsers() {
  const term = document.getElementById("userSearch").value.trim().toLowerCase();
  const type = document.getElementById("userTypeFilter").value;
  const status = document.getElementById("userStatusFilter").value;
  const users = state.users.filter(user => {
    const haystack = `${user.name || ""} ${user.email || ""} ${user.phone || ""}`.toLowerCase();
    return (!term || haystack.includes(term))
      && (type === "all" || user.accountType === type)
      && (status === "all" || user.status === status);
  });
  const table = document.getElementById("usersTable");
  table.replaceChildren(...users.map(user => {
    const row = document.createElement("tr");
    const actions = document.createElement("div");
    actions.className = "table-actions";
    actions.appendChild(button("تفاصيل", "table-button", () => openUserModal(user.id)));
    if (hasPermission("users.manage") && user.status === "active" && user.id !== state.admin.id) actions.appendChild(button("إيقاف", "table-button reject", () => openDecision(user.id, "suspend_user")));
    if (hasPermission("users.manage") && ["suspended", "rejected"].includes(user.status)) actions.appendChild(button("تفعيل", "table-button approve", () => openDecision(user.id, "activate_user")));
    const values = [
      userCell(user),
      badge(accountTypeLabel(user.accountType), "type-badge"),
      badge(statusLabels[user.status] || user.status || "-", `status-badge status-${user.status || "pending"}`),
      user.phone || "-",
      formatDate(user.createdAt),
      actions
    ];
    values.forEach(value => {
      const cell = document.createElement("td");
      cell.append(value instanceof Node ? value : document.createTextNode(value));
      row.appendChild(cell);
    });
    return row;
  }));
  document.getElementById("usersResultCount").textContent = `${users.length} مستخدم`;
}

async function updateFreelancerRank(user, rankId) {
  const completed = completedOrdersFor(user.id);
  const rank = rankId === "auto" ? automaticRank(completed) : rankLevels.find(item => item.id === rankId);
  if (!rank) return;
  const rankData = {
    manualRank: rankId === "auto" ? deleteField() : rankId,
    rank: { id: rank.id, label: rank.label, color: rank.color, completedServices: completed, updatedAt: serverTimestamp() },
    updatedAt: serverTimestamp()
  };
  const publicRankData = {
    rank: { id: rank.id, label: rank.label, color: rank.color, completedServices: completed, updatedAt: serverTimestamp() }
  };
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "users", user.id), rankData);
    batch.set(doc(db, "publicProfiles", user.id), publicRankData, { merge: true });
    batch.set(doc(collection(db, "adminAuditLogs")), auditData("update_freelancer_rank", user, rank.label));
    await batch.commit();
    showToast("تم تحديث رتبة المستقل.");
    await loadData();
  } catch (error) {
    console.error("Unable to update freelancer rank", error);
    showToast("تعذر تحديث الرتبة. تحقق من الصلاحيات وقواعد Firebase.");
  }
}

function renderRanks() {
  ensureRanksUi();
  const search = document.getElementById("rankSearch")?.value.trim().toLowerCase() || "";
  const filter = document.getElementById("rankFilter")?.value || "all";
  const freelancers = state.users
    .filter(user => user.accountType === "freelancer" && user.status === "active")
    .filter(user => {
      const rank = effectiveRank(user);
      const haystack = `${user.name || ""} ${user.email || ""}`.toLowerCase();
      return (!search || haystack.includes(search)) && (filter === "all" || rank.id === filter);
    });
  const table = document.getElementById("ranksTable");
  if (!table) return;
  table.replaceChildren(...freelancers.map(user => {
    const rank = effectiveRank(user);
    const completed = completedOrdersFor(user.id);
    const row = document.createElement("tr");
    const selector = document.createElement("select");
    selector.className = "rank-select";
    selector.append(...rankLevels.map(item => new Option(item.label, item.id)));
    selector.value = user.manualRank || "auto";
    selector.addEventListener("change", () => updateFreelancerRank(user, selector.value));
    [
      userCell(user),
      completed.toLocaleString("en-US"),
      badge(rank.label, `rank-badge rank-${rank.color}`),
      selector
    ].forEach(value => {
      const cell = document.createElement("td");
      cell.append(value instanceof Node ? value : document.createTextNode(value));
      row.appendChild(cell);
    });
    return row;
  }));
  document.getElementById("rankedFreelancersCount").textContent = freelancers.length;
  document.getElementById("ranksEmpty").hidden = freelancers.length > 0;
}

function renderChats() {
  const term = document.getElementById("chatSearch").value.trim().toLowerCase();
  const chats = state.chats.filter(chat => {
    const names = Object.values(chat.participantNames || {}).join(" ");
    return !term || `${names} ${chat.context?.title || ""}`.toLowerCase().includes(term);
  });
  const table = document.getElementById("chatsTable");
  table.replaceChildren(...chats.map(chat => {
    const row = document.createElement("tr");
    const names = Object.values(chat.participantNames || {}).join("، ") || "مشاركون غير معروفين";
    const context = chat.context?.title || "محادثة مباشرة";
    const lastDate = toDate(chat.lastUpdated);
    const active = lastDate && Date.now() - lastDate.getTime() < 7 * 24 * 60 * 60 * 1000;
    [names, context, formatDate(chat.lastUpdated, true), chat.lastMessageType === "attachment" ? "مرفق" : chat.lastMessageType === "mixed" ? "نص ومرفق" : "نص", badge(active ? "نشطة" : "هادئة", `status-badge ${active ? "status-active" : "status-pending"}`)]
      .forEach(value => {
        const cell = document.createElement("td");
        cell.append(value instanceof Node ? value : document.createTextNode(value));
        row.appendChild(cell);
      });
    return row;
  }));
  document.getElementById("chatsEmpty").hidden = chats.length > 0;
}

function auditDescription(log) {
  const actor = log.actorName || log.actorEmail || "مدير";
  const target = log.targetName || log.targetEmail || "";
  return `${actor}${target ? ` على حساب ${target}` : ""}${log.reason ? `: ${log.reason}` : ""}`;
}

function renderAudit() {
  const term = document.getElementById("auditSearch").value.trim().toLowerCase();
  const action = document.getElementById("auditActionFilter").value;
  const logs = state.audit.filter(log => {
    const haystack = `${actionLabels[log.action] || log.action} ${auditDescription(log)}`.toLowerCase();
    return (!term || haystack.includes(term)) && (action === "all" || log.action === action);
  });
  const container = document.getElementById("auditTimeline");
  container.replaceChildren(...logs.map(log => {
    const item = document.createElement("article");
    item.className = "audit-entry";
    item.innerHTML = `<span>≡</span><div><strong>${actionLabels[log.action] || log.action}</strong><p>${auditDescription(log)}</p></div><time>${formatDate(log.createdAt, true)}</time>`;
    return item;
  }));
  document.getElementById("auditEmpty").hidden = logs.length > 0;

  const recent = document.getElementById("recentAudit");
  recent.replaceChildren(...state.audit.slice(0, 4).map(log => {
    const item = document.createElement("article");
    item.className = "activity-item";
    item.innerHTML = `<span>≡</span><div><strong>${actionLabels[log.action] || log.action}</strong><p>${auditDescription(log)}</p></div><time>${formatDate(log.createdAt)}</time>`;
    return item;
  }));
  if (!state.audit.length) recent.innerHTML = '<div class="empty-state"><span>≡</span><strong>سيظهر سجل القرارات هنا</strong></div>';
}

function renderSettings() {
  const settings = state.settings || {
    maintenanceMode: false,
    prelaunchMode: true,
    registrationsEnabled: true,
    freelancerApplicationsEnabled: true,
    platformFeePercent: 20,
    supportEmail: "",
    platformName: "PikLance"
  };
  document.getElementById("maintenanceMode").checked = Boolean(settings.maintenanceMode);
  document.getElementById("prelaunchMode").checked = settings.prelaunchMode !== false;
  document.getElementById("registrationsEnabled").checked = settings.registrationsEnabled !== false;
  document.getElementById("freelancerApplicationsEnabled").checked = settings.freelancerApplicationsEnabled !== false;
  document.getElementById("platformFeePercent").value = Number(settings.platformFeePercent ?? 20);
  document.getElementById("supportEmail").value = settings.supportEmail || "";
  document.getElementById("platformName").value = settings.platformName || "PikLance";
  document.getElementById("settingsStatus").textContent = settings.updatedAt ? `آخر تحديث: ${formatDate(settings.updatedAt, true)}` : "لم يتم إنشاء إعدادات مركزية بعد.";
}

async function syncAutomaticRanks() {
  const changes = state.users.filter(user => user.accountType === "freelancer" && user.status === "active" && !user.manualRank).map(user => {
    const completed = completedOrdersFor(user.id);
    const rank = automaticRank(completed);
    const current = user.rank || {};
    return current.id !== rank.id || Number(current.completedServices || 0) !== completed
      ? { user, completed, rank }
      : null;
  }).filter(Boolean);
  if (!changes.length) return;
  for (let offset = 0; offset < changes.length; offset += 200) {
    const batch = writeBatch(db);
    changes.slice(offset, offset + 200).forEach(({ user, completed, rank }) => {
      const rankData = { id: rank.id, label: rank.label, color: rank.color, completedServices: completed, updatedAt: serverTimestamp() };
      batch.update(doc(db, "users", user.id), { rank: rankData, updatedAt: serverTimestamp() });
      batch.set(doc(db, "publicProfiles", user.id), { rank: rankData }, { merge: true });
      user.rank = rankData;
    });
    await batch.commit();
  }
}

async function loadDashboardMetrics() {
  if (!hasPermission("overview.view")) return null;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const requests = {
    totalUsers: getCountFromServer(collection(db, "users")),
    activeFreelancers: getCountFromServer(query(collection(db, "users"), where("accountType", "==", "freelancer"), where("status", "==", "active"))),
    pendingUsers: getCountFromServer(query(collection(db, "users"), where("status", "==", "pending"))),
    activeUsers: getCountFromServer(query(collection(db, "users"), where("status", "==", "active"))),
    buyers: getCountFromServer(query(collection(db, "users"), where("accountType", "==", "buyer"))),
    freelancers: getCountFromServer(query(collection(db, "users"), where("accountType", "==", "freelancer"))),
    totalChats: getCountFromServer(collection(db, "chats")),
    activeChatsWeek: getCountFromServer(query(collection(db, "chats"), where("lastUpdated", ">=", weekAgo))),
    serviceChats: getCountFromServer(query(collection(db, "chats"), where("context.serviceId", ">", "")))
  };
  const entries = await Promise.all(Object.entries(requests).map(async ([key, request]) => {
    try {
      const snapshot = await request;
      return [key, snapshot.data().count];
    } catch (error) {
      console.warn(`Unable to load dashboard metric ${key}`, error);
      return [key, null];
    }
  }));
  const metrics = Object.fromEntries(entries);
  if (metrics.totalUsers != null && metrics.activeUsers != null) metrics.inactiveUsers = metrics.totalUsers - metrics.activeUsers;
  return metrics;
}

function settledSnapshot(result, label, fallback = { docs: [] }) {
  if (result.status === "fulfilled") return result.value;
  console.error(`Unable to load admin ${label}`, result.reason);
  return fallback;
}

async function loadData() {
  document.getElementById("refreshData").disabled = true;
  try {
    if (hasPermission("promotions.manage")) await seedDefaultBadges().catch(error => console.warn("Unable to seed default badges", error));
    const empty = { docs: [] };
    const needsUsers = hasPermission("overview.view") || hasPermission("users.view") || hasPermission("verifications.view") || hasPermission("ranks.manage") || hasPermission("promotions.manage");
    const results = await Promise.allSettled([
      needsUsers ? getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(100))) : empty,
      (hasPermission("overview.view") || hasPermission("finance.view") || hasPermission("services.view")) ? getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100))) : empty,
      (hasPermission("overview.view") || hasPermission("conversations.view")) ? getDocs(query(collection(db, "chats"), orderBy("lastUpdated", "desc"), limit(100))) : empty,
      (hasPermission("overview.view") || hasPermission("audit.view")) ? getDocs(query(collection(db, "adminAuditLogs"), orderBy("createdAt", "desc"), limit(100))) : empty,
      getDoc(doc(db, "platformSettings", "general")),
      hasPermission("promotions.manage") ? getDocs(query(collection(db, "promoCodes"), limit(100))) : empty,
      hasPermission("promotions.manage") ? getDocs(collection(db, "badges")) : empty,
      hasPermission("promotions.manage") ? getDocs(query(collection(db, "referrals"), limit(100))) : empty,
      hasPermission("promotions.manage") ? getDocs(query(collection(db, "userBenefits"), limit(100))) : empty,
      loadDashboardMetrics()
    ]);
    const usersSnapshot = settledSnapshot(results[0], "users");
    const ordersSnapshot = settledSnapshot(results[1], "orders");
    const chatsSnapshot = settledSnapshot(results[2], "chats");
    const auditSnapshot = settledSnapshot(results[3], "audit");
    const settingsSnapshot = settledSnapshot(results[4], "settings", { exists: () => false });
    const promoCodesSnapshot = settledSnapshot(results[5], "promo codes");
    const badgesSnapshot = settledSnapshot(results[6], "badges");
    const referralsSnapshot = settledSnapshot(results[7], "referrals");
    const benefitsSnapshot = settledSnapshot(results[8], "benefits");
    state.metrics = results[9].status === "fulfilled" ? results[9].value : null;
    state.users = usersSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    state.orders = ordersSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    state.chats = chatsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    state.audit = auditSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    state.promoCodes = promoCodesSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    state.badges = badgesSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.active !== false);
    state.referrals = referralsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    state.benefits = benefitsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    state.settings = settingsSnapshot.exists() ? settingsSnapshot.data() : null;
    renderAll();
    document.getElementById("lastRefresh").textContent = `آخر تحديث: ${new Date().toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    console.error("Unable to load admin data", error);
    showToast("تعذر تحميل بعض بيانات الإدارة. تأكد من نشر قواعد Firebase الجديدة.");
  } finally {
    document.getElementById("refreshData").disabled = false;
  }
}

function renderAll() {
  ensureRanksUi();
  ensurePromotionsUi();
  populateSpecialties();
  renderMetrics();
  renderRegistrationChart();
  renderAlerts();
  renderVerifications();
  renderUsers();
  renderRanks();
  renderPromotions();
  renderChats();
  renderAudit();
  renderSettings();
  applyAdminAccess();
}

function detailField(label, value) {
  const item = document.createElement("div");
  item.className = "detail-field";
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value || "-";
  item.append(small, strong);
  return item;
}

function identityImage(path, label) {
  const wrapper = document.createElement("div");
  wrapper.className = "identity-image";
  wrapper.textContent = path ? "" : "لم تُرفع الصورة";
  if (!path) return wrapper;
  const loader = document.createElement("span");
  loader.className = "image-loading-dots";
  loader.innerHTML = "<span><i></i><i></i><i></i></span>";
  wrapper.style.position = "relative";
  wrapper.appendChild(loader);
  getDownloadURL(ref(storage, path)).then(url => {
    const image = document.createElement("img");
    image.src = url;
    image.alt = label;
    image.addEventListener("load", () => loader.remove(), { once: true });
    image.addEventListener("error", () => loader.remove(), { once: true });
    wrapper.replaceChildren(image, loader);
  }).catch(() => {
    wrapper.textContent = "تعذر تحميل صورة الهوية";
  });
  return wrapper;
}

function printableUserHtml(user) {
  const escapeHtml = value => String(value || "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
  const rows = [
    ["الاسم", user.name],
    ["البريد", user.email],
    ["الهاتف", user.phone],
    ["نوع الحساب", accountTypeLabel(user.accountType)],
    ["الحالة", statusLabels[user.status] || user.status],
    ["التخصص", user.specialty],
    ["رقم الهوية", user.idNumber],
    ["الاسم في الهوية", user.idName],
    ["تاريخ التسجيل", formatDate(user.createdAt, true)],
    ["معرف الحساب", user.id]
  ].map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value || "-")}</td></tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طلب توثيق ${escapeHtml(user.name || "")}</title><style>body{font-family:Arial,sans-serif;line-height:1.8;padding:30px;color:#222}h1{margin-top:0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:10px;text-align:right}th{width:180px;background:#f3f3f7}@media print{button{display:none}}</style></head><body><button onclick="print()">حفظ PDF / طباعة</button><h1>طلب توثيق مستقل</h1><p>تاريخ التصدير: ${new Date().toLocaleString("en-US")}</p><table>${rows}</table><p>مسارات صور الهوية محفوظة في النظام: ${escapeHtml(user.idFrontPath || "-")} / ${escapeHtml(user.idBackPath || "-")}</p><script>setTimeout(()=>print(),300)</script></body></html>`;
}

function exportUserPdf(user) {
  const view = window.open("", "_blank", "width=900,height=700");
  if (!view) {
    showToast("اسمح بالنوافذ المنبثقة لحفظ ملف PDF.");
    return;
  }
  view.document.open();
  view.document.write(printableUserHtml(user));
  view.document.close();
}

function openUserModal(userId) {
  const user = state.users.find(item => item.id === userId);
  if (!user) return;
  state.selectedUser = user;
  document.getElementById("modalUserName").textContent = user.name || "تفاصيل الحساب";
  elements.modalBody.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "profile-summary";
  summary.append(userCell(user));
  const grid = document.createElement("div");
  grid.className = "details-grid";
  [
    ["نوع الحساب", accountTypeLabel(user.accountType)],
    ["الحالة", statusLabels[user.status] || user.status],
    ["الهاتف", user.phone],
    ["التخصص", user.specialty],
    ["تاريخ التسجيل", formatDate(user.createdAt, true)],
    ["رقم الهوية", user.idNumber],
    ["الاسم في الهوية", user.idName],
    ["معرف الحساب", user.id]
  ].forEach(([label, value]) => grid.appendChild(detailField(label, value)));
  elements.modalBody.append(summary, grid);

  if (user.accountType === "freelancer") {
    const section = document.createElement("section");
    section.className = "identity-section";
    const title = document.createElement("h3");
    title.textContent = "مستندات التحقق";
    const images = document.createElement("div");
    images.className = "identity-grid";
    images.append(identityImage(user.idFrontPath, "الوجه الأمامي للهوية"), identityImage(user.idBackPath, "الوجه الخلفي للهوية"));
    section.append(title, images);
    elements.modalBody.appendChild(section);
  }

  elements.modalActions.replaceChildren(
    button("حفظ الطلب PDF", "secondary-button", () => exportUserPdf(user)),
    button("إغلاق", "secondary-button", closeUserModal)
  );
  if (user.status === "pending" && hasPermission("verifications.manage")) {
    elements.modalActions.append(
      button("رفض الطلب", "danger-button", () => { closeUserModal(); openDecision(user.id, "reject_user"); }),
      button("قبول وتفعيل", "primary-button", () => { closeUserModal(); openDecision(user.id, "approve_user"); })
    );
  } else if (hasPermission("users.manage") && user.status === "active" && user.id !== state.admin.id) {
    elements.modalActions.appendChild(button("إيقاف الحساب", "danger-button", () => { closeUserModal(); openDecision(user.id, "suspend_user"); }));
  } else if (hasPermission("users.manage") && ["suspended", "rejected"].includes(user.status)) {
    elements.modalActions.appendChild(button("إعادة التفعيل", "primary-button", () => { closeUserModal(); openDecision(user.id, "activate_user"); }));
  }
  elements.userModal.classList.add("open");
  elements.userModal.setAttribute("aria-hidden", "false");
}

function closeUserModal() {
  elements.userModal.classList.remove("open");
  elements.userModal.setAttribute("aria-hidden", "true");
  state.selectedUser = null;
}

function openDecision(userId, action) {
  const permission = ["approve_user", "reject_user"].includes(action) ? "verifications.manage" : "users.manage";
  if (!hasPermission(permission)) return showToast("لا تملك صلاحية تنفيذ هذا الإجراء.");
  const user = state.users.find(item => item.id === userId);
  if (!user) return;
  state.pendingDecision = { user, action };
  const config = {
    approve_user: ["قبول وتفعيل الحساب", `سيتم تفعيل حساب ${user.name} وإتاحة ميزات المستقل له.`, false, "قبول الحساب", "primary-button"],
    reject_user: ["رفض طلب التوثيق", `سيتم رفض طلب ${user.name}. اكتب سبباً واضحاً ليظهر في سجل الإدارة.`, true, "رفض الطلب", "danger-button"],
    suspend_user: ["إيقاف الحساب", `سيفقد ${user.name} الوصول إلى الميزات التي تتطلب حساباً نشطاً.`, true, "إيقاف الحساب", "danger-button"],
    activate_user: ["إعادة تفعيل الحساب", `سيعود حساب ${user.name} إلى الحالة النشطة.`, false, "تفعيل الحساب", "primary-button"]
  }[action];
  document.getElementById("decisionTitle").textContent = config[0];
  document.getElementById("decisionDescription").textContent = config[1];
  document.getElementById("decisionReasonWrap").hidden = !config[2];
  document.getElementById("decisionReason").value = "";
  const confirm = document.getElementById("decisionConfirm");
  confirm.textContent = config[3];
  confirm.className = config[4];
  elements.decisionModal.classList.add("open");
  elements.decisionModal.setAttribute("aria-hidden", "false");
}

function closeDecision() {
  elements.decisionModal.classList.remove("open");
  elements.decisionModal.setAttribute("aria-hidden", "true");
  state.pendingDecision = null;
}

function auditData(action, target = {}, reason = "") {
  return {
    action,
    actorUid: state.admin.id,
    actorName: state.admin.name || state.admin.email,
    actorEmail: state.admin.email || "",
    targetUid: target.id || "",
    targetName: target.name || "",
    targetEmail: target.email || "",
    reason,
    createdAt: serverTimestamp()
  };
}

async function cleanupRejectedIdentity(user) {
  const paths = [user.idFrontPath, user.idBackPath].filter(Boolean);
  if (!paths.length) return;
  await Promise.allSettled(paths.map(path => deleteObject(ref(storage, path))));
}

function personalReferralCode(user) {
  const base = normalizeAdminCode((user.name || user.email || user.id).split("@")[0]).replace(/-/g, "");
  return `${base || "PIK"}-${String(user.id || "").slice(0, 5).toUpperCase()}`;
}

function addReferralActivation(batch, user, updates) {
  const code = user.referralCode || personalReferralCode(user);
  updates.referralCode = code;
  batch.set(doc(db, "promoCodes", code), {
    code,
    type: "referral",
    status: "active",
    maxUses: 9999,
    usedCount: Number(user.referralUseCount || 0),
    ownerUid: user.id,
    ownerName: user.name || user.email || "",
    discountPercent: 50,
    discountDays: 30,
    rewardEvery: 5,
    rewardDiscountPercent: 50,
    rewardDiscountDays: 30,
    updatedAt: serverTimestamp(),
    createdAt: user.referralCode ? user.referralCodeCreatedAt || serverTimestamp() : serverTimestamp()
  }, { merge: true });
}

function addReferralRewardIfNeeded(batch, approvedUser) {
  if (!approvedUser.referredByUid) return;
  const referrals = state.referrals.filter(referral =>
    referral.inviterUid === approvedUser.referredByUid
    && referral.status === "approved"
    && referral.invitedUid !== approvedUser.id
  );
  const approvedCount = referrals.length + 1;
  batch.set(doc(db, "referrals", `${approvedUser.referralCodeUsed || "manual"}_${approvedUser.id}`), {
    inviterUid: approvedUser.referredByUid,
    invitedUid: approvedUser.id,
    invitedEmail: approvedUser.email || "",
    invitedName: approvedUser.name || "",
    invitedAccountType: approvedUser.accountType || "",
    status: "approved",
    approvedAt: serverTimestamp()
  }, { merge: true });

  if (approvedCount % 5 !== 0) return;
  const benefitId = `${approvedUser.referredByUid}_referral_${Math.floor(approvedCount / 5)}`;
  batch.set(doc(db, "userBenefits", benefitId), {
    uid: approvedUser.referredByUid,
    type: "platform_fee_discount",
    discountPercent: 50,
    durationDays: 30,
    source: "referral_reward",
    status: "active",
    referralMilestone: approvedCount,
    createdAt: serverTimestamp()
  }, { merge: true });
  batch.set(doc(db, "accountBenefits", approvedUser.referredByUid), {
    commissionDiscountPercent: 50,
    active: true,
    source: "referral_reward",
    referralMilestone: approvedCount,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    updatedAt: serverTimestamp()
  }, { merge: true });
  batch.set(doc(collection(db, "notifications", approvedUser.referredByUid, "items")), {
    type: "referral_reward",
    title: "مكافأة دعوة جديدة",
    body: "تم تسجيل 5 أشخاص عن طريقك. حصلت على شهر خصم 50% على عمولة المنصة.",
    read: false,
    createdAt: serverTimestamp()
  });
}

function openRejectionEmail(user, reason) {
  if (!user.email) return;
  const subject = encodeURIComponent("نتيجة طلب توثيق حسابك في PikLance");
  const body = encodeURIComponent(
    `مرحباً ${user.name || ""}\n\nتمت مراجعة طلب توثيق حسابك في PikLance، ولم نتمكن من قبوله حالياً.\n\nسبب الرفض:\n${reason}\n\nيمكنك تسجيل الدخول إلى حسابك وإعادة تقديم الطلب بعد تعديل البيانات ورفع صور الهوية من جديد.\n\nفريق PikLance`
  );
  window.location.href = `mailto:${user.email}?subject=${subject}&body=${body}`;
}

async function sendFreelancerRejectionEmail(user, reason) {
  if (!user.email) return;
  await sendOfficialEmail({
    purpose: "freelancer_rejection",
    to: user.email,
    subject: "نتيجة طلب توثيق حسابك في PikLance",
    message: `مرحباً ${user.name || ""}\n\nتمت مراجعة طلب توثيق حسابك في PikLance، ولم نتمكن من قبوله حالياً.\n\nسبب الرفض:\n${reason}\n\nيمكنك تسجيل الدخول إلى حسابك وإعادة تقديم الطلب بعد تعديل البيانات ورفع صور الهوية من جديد.\n\nفريق PikLance`,
    actionUrl: "https://piklance.com/register.html",
    actionLabel: "إعادة تقديم الطلب"
  }).catch(error => {
    console.warn("Unable to send freelancer rejection email", error);
    openRejectionEmail(user, reason);
  });
}

async function executeDecision(event) {
  event.preventDefault();
  const decision = state.pendingDecision;
  if (!decision) return;
  const reason = document.getElementById("decisionReason").value.trim();
  if (["reject_user", "suspend_user"].includes(decision.action) && !reason) {
    showToast("اكتب سبب القرار قبل المتابعة.");
    return;
  }
  const updates = {
    approve_user: { status: "active", approvedAt: serverTimestamp(), approvedBy: state.admin.id },
    reject_user: {
      status: "rejected",
      rejectionReason: reason,
      rejectedAt: serverTimestamp(),
      rejectedBy: state.admin.id,
      idNumber: deleteField(),
      idName: deleteField(),
      idFrontPath: deleteField(),
      idBackPath: deleteField()
    },
    suspend_user: { status: "suspended", suspensionReason: reason, suspendedAt: serverTimestamp(), suspendedBy: state.admin.id },
    activate_user: { status: "active", reactivatedAt: serverTimestamp(), reactivatedBy: state.admin.id }
  }[decision.action];
  document.getElementById("decisionConfirm").disabled = true;
  try {
    if (["approve_user", "reject_user"].includes(decision.action)) {
      await httpsCallable(functions, "reviewFreelancerApplication")({
        userId: decision.user.id,
        action: decision.action === "approve_user" ? "approve" : "reject",
        reason
      });
      if (decision.action === "reject_user") await sendFreelancerRejectionEmail(decision.user, reason);
      closeDecision();
      showToast(decision.action === "reject_user"
        ? "تم رفض الطلب وتنظيف بيانات الهوية وإرسال رسالة لصاحب الطلب."
        : "تم قبول الطلب وتسجيل القرار بنجاح.");
      await loadData();
      return;
    }
    const batch = writeBatch(db);
    batch.update(doc(db, "users", decision.user.id), updates);
    batch.set(doc(db, "publicProfiles", decision.user.id), {
      name: decision.user.name || "مستخدم PikLance",
      accountType: decision.user.accountType,
      status: updates.status,
      ...(updates.referralCode ? { referralCode: updates.referralCode } : {}),
      ...(decision.user.specialty ? { specialty: decision.user.specialty } : {})
    }, { merge: true });
    batch.set(doc(collection(db, "adminAuditLogs")), auditData(decision.action, decision.user, reason));
    await batch.commit();
    if (decision.action === "reject_user") {
      await cleanupRejectedIdentity(decision.user);
      await sendFreelancerRejectionEmail(decision.user, reason);
    }
    closeDecision();
    showToast(decision.action === "reject_user"
      ? "تم رفض الطلب وتنظيف بيانات الهوية. تم تجهيز رسالة البريد لصاحب الطلب."
      : "تم تنفيذ القرار وتسجيله بنجاح.");
    await loadData();
  } catch (error) {
    console.error("Admin decision failed", error);
    showToast("تعذر تنفيذ القرار. تحقق من الصلاحيات والاتصال.");
  } finally {
    document.getElementById("decisionConfirm").disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const settings = {
    maintenanceMode: document.getElementById("maintenanceMode").checked,
    prelaunchMode: document.getElementById("prelaunchMode").checked,
    registrationsEnabled: document.getElementById("registrationsEnabled").checked,
    freelancerApplicationsEnabled: document.getElementById("freelancerApplicationsEnabled").checked,
    platformFeePercent: Number(document.getElementById("platformFeePercent").value || 0),
    supportEmail: document.getElementById("supportEmail").value.trim(),
    platformName: document.getElementById("platformName").value.trim() || "PikLance",
    updatedAt: serverTimestamp(),
    updatedBy: state.admin.id
  };
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "platformSettings", "general"), settings, { merge: true });
    batch.set(doc(collection(db, "adminAuditLogs")), auditData("update_settings"));
    await batch.commit();
    showToast("تم حفظ إعدادات المنصة.");
    await loadData();
  } catch (error) {
    console.error("Unable to save settings", error);
    showToast("تعذر حفظ الإعدادات.");
  }
}

function exportUsers() {
  const headers = ["uid", "name", "email", "phone", "accountType", "status", "createdAt"];
  const escape = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = state.users.map(user => [
    user.id, user.name, user.email, user.phone, user.accountType, user.status, toDate(user.createdAt)?.toISOString() || ""
  ].map(escape).join(","));
  const csv = `\uFEFF${headers.join(",")}\n${rows.join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `piklance-users-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  document.querySelectorAll(".nav-link").forEach(link => link.addEventListener("click", () => showSection(link.dataset.section)));
  document.querySelectorAll("[data-go-section]").forEach(control => control.addEventListener("click", () => showSection(control.dataset.goSection)));
  document.getElementById("mobileMenu").addEventListener("click", () => {
    elements.sidebar.classList.toggle("open");
    elements.backdrop.classList.toggle("open");
  });
  elements.backdrop.addEventListener("click", () => {
    elements.sidebar.classList.remove("open");
    elements.backdrop.classList.remove("open");
  });
  document.getElementById("themeToggle").addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("admin-theme", theme);
    document.getElementById("themeToggle").textContent = theme === "dark" ? "☀" : "☾";
  });
  document.getElementById("refreshData").addEventListener("click", async () => {
    await loadData();
    window.dispatchEvent(new CustomEvent("admin:refresh", { detail: { section: location.hash.slice(1) } }));
  });
  document.getElementById("logoutButton").addEventListener("click", async () => {
    await signOut(auth);
    location.replace("login.html");
  });
  ["verificationSearch", "verificationSpecialty"].forEach(id => document.getElementById(id).addEventListener("input", renderVerifications));
  ["userSearch", "userTypeFilter", "userStatusFilter"].forEach(id => document.getElementById(id).addEventListener("input", renderUsers));
  document.getElementById("chatSearch").addEventListener("input", renderChats);
  ["auditSearch", "auditActionFilter"].forEach(id => document.getElementById(id).addEventListener("input", renderAudit));
  document.getElementById("exportUsers").addEventListener("click", exportUsers);
  document.getElementById("settingsForm").addEventListener("submit", saveSettings);
  document.getElementById("maintenanceMode").addEventListener("change", () => document.getElementById("settingsForm").requestSubmit());
  document.getElementById("prelaunchMode").addEventListener("change", () => document.getElementById("settingsForm").requestSubmit());
  document.getElementById("decisionForm").addEventListener("submit", executeDecision);
  document.querySelectorAll("[data-close-modal]").forEach(control => control.addEventListener("click", closeUserModal));
  document.querySelectorAll("[data-close-decision]").forEach(control => control.addEventListener("click", closeDecision));
  [elements.userModal, elements.decisionModal].forEach(modal => modal.addEventListener("click", event => {
    if (event.target === modal) {
      if (modal === elements.userModal) closeUserModal();
      else closeDecision();
    }
  }));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeUserModal();
      closeDecision();
    }
  });
}

document.documentElement.dataset.theme = localStorage.getItem("admin-theme") || "light";
document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
document.getElementById("themeToggle").textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾";
buildFutureSections();
ensureRanksUi();
bindEvents();

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace(`login.html?returnUrl=${encodeURIComponent("dashboard.html")}`);
    return;
  }
  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!user.emailVerified || !profileSnapshot.exists() || profileSnapshot.data().role !== "admin") {
      await signOut(auth);
      alert("غير مصرح لك بدخول لوحة الإدارة.");
      location.replace("index.html");
      return;
    }
    state.admin = { id: user.uid, email: user.email, ...profileSnapshot.data() };
    await initializeAdminAccess(state.admin);
    localStorage.setItem("piklanceEarlyAccess", "true");
    localStorage.setItem("piklanceAdminAccess", "true");
    document.getElementById("adminName").textContent = state.admin.name || user.email;
    document.getElementById("adminAvatar").textContent = initials(state.admin.name || user.email);
    document.getElementById("welcomeName").textContent = state.admin.name || "مدير المنصة";
    const requestedSection = location.hash.slice(1);
    applyAdminAccess();
    showSection(sectionMeta[requestedSection] && canAccessSection(requestedSection) ? requestedSection : firstAllowedSection());
    await loadData();
  } catch (error) {
    console.error("Admin initialization failed", error);
    showToast("تعذر تشغيل لوحة الإدارة.");
  } finally {
    elements.loading.classList.add("hidden");
  }
});
