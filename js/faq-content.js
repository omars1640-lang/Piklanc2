import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

const faqSections = {
  buyer: { label: "للمشترين", icon: "search-service" },
  freelancer: { label: "للمستقلين", icon: "earn-profits" },
  payment: { label: "الدفع والسحب", icon: "payment-preparing" },
  technical: { label: "أسئلة تقنية", icon: "support" },
  general: { label: "أسئلة عامة", icon: "support" }
};

// Legacy questions remain visible even when the admin collection is empty or
// only partially migrated. Published admin questions override these by text,
// so restoring the old FAQ never creates duplicates.
const legacyFaqItems = [
  { id: "legacy-buyer-order", category: "buyer", question: "كيف أطلب خدمة؟", answer: "تصفح الخدمات أو استخدم البحث والفلاتر، ثم افتح الخدمة المناسبة واضغط «اختيار الخدمة» واتبع خطوات الطلب." },
  { id: "legacy-buyer-refund", category: "buyer", question: "هل يمكنني استرجاع المبلغ إذا لم تعجبني الخدمة؟", answer: "تواصل مع الدعم من داخل الطلب قبل إغلاقه، وسيراجع الفريق تفاصيل الحالة وفق سياسة المنصة." },
  { id: "legacy-buyer-quality", category: "buyer", question: "كيف أضمن جودة الخدمة؟", answer: "راجع وصف الخدمة وتقييمات المستقل وأعماله السابقة، وتواصل معه قبل الطلب لتوضيح المطلوب." },
  { id: "legacy-freelancer-join", category: "freelancer", question: "كيف أصبح مستقلاً على المنصة؟", answer: "أنشئ حساباً كمستقل، أكمل بيانات ملفك وأرسل طلب التوثيق. بعد الموافقة يمكنك إضافة خدماتك." },
  { id: "legacy-freelancer-fee", category: "freelancer", question: "كم نسبة عمولة المنصة؟", answer: "تُحتسب العمولة وفق إعدادات المنصة والخصومات أو الأكواد المطبقة على الحساب، وتظهر التفاصيل قبل إتمام العملية." },
  { id: "legacy-freelancer-withdrawal", category: "freelancer", question: "متى يمكنني سحب أرباحي؟", answer: "يمكنك طلب السحب عبر شام كاش من 100 ل.س وحتى 5000 ل.س للعملية الواحدة، من دون رسوم. تُراجع الطلبات خلال 24–48 ساعة." },
  { id: "legacy-payment-methods", category: "payment", question: "ما طرق الدفع المتاحة؟", answer: "يتوفر حالياً الشحن اليدوي عبر شام كاش، مع رفع إيصال التحويل لمراجعته من الإدارة." },
  { id: "legacy-payment-time", category: "payment", question: "كم تستغرق عملية الشحن؟", answer: "تتم مراجعة طلب الشحن خلال 2–6 ساعات ضمن أوقات العمل، ثم يُضاف الرصيد بعد الموافقة." },
  { id: "legacy-technical-mobile", category: "technical", question: "هل المنصة تعمل على الجوال؟", answer: "نعم، صُممت PikLance لتعمل على الجوال والتابلت والكمبيوتر." },
  { id: "legacy-technical-password", category: "technical", question: "نسيت كلمة المرور، ماذا أفعل؟", answer: "استخدم خيار «نسيت كلمة المرور» في صفحة تسجيل الدخول واتبع رسالة إعادة التعيين المرسلة إلى بريدك." }
];

function normalizedSection(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (faqSections[raw]) return raw;
  if (raw.includes("دفع") || raw.includes("سحب")) return "payment";
  if (raw.includes("مستقل")) return "freelancer";
  if (raw.includes("مشتري") || raw.includes("عميل")) return "buyer";
  if (raw.includes("تقن")) return "technical";
  return "general";
}

function sectionInfo(item) {
  const id = normalizedSection(item.category);
  return {
    id,
    label: item.categoryLabel || faqSections[id].label,
    icon: faqSections[id].icon
  };
}

function headingIcon(name, theme) {
  const image = document.createElement("img");
  image.className = `faq-heading-icon ${theme}`;
  image.src = `assets/icons/${theme}/${name}.svg`;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  return image;
}

function categoryButton(id, label, active = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `category-btn${active ? " active" : ""}`;
  button.textContent = label;
  button.addEventListener("click", () => window.filterCategory(id, button));
  return button;
}

function questionItem(question) {
  const item = document.createElement("div");
  item.className = "faq-item";
  const control = document.createElement("button");
  control.type = "button";
  control.className = "faq-question";
  control.setAttribute("aria-expanded", "false");
  control.append(document.createTextNode(question.question), Object.assign(document.createElement("span"), { className: "faq-icon", textContent: "▼" }));
  const answer = document.createElement("div");
  answer.className = "faq-answer";
  const copy = document.createElement("p");
  copy.textContent = question.answer;
  answer.appendChild(copy);
  control.addEventListener("click", () => window.toggleFAQ(control));
  item.append(control, answer);
  return item;
}

function renderFaq(items) {
  const container = document.getElementById("faqContainer");
  const categories = document.getElementById("faqCategories");
  if (!container || !categories || !items.length) return;

  const groups = new Map();
  items.forEach(item => {
    const section = sectionInfo(item);
    if (!groups.has(section.id)) groups.set(section.id, { ...section, questions: [] });
    groups.get(section.id).questions.push(item);
  });

  categories.replaceChildren(categoryButton("all", "الكل", true), ...[...groups.values()].map(group => categoryButton(group.id, group.label)));
  container.replaceChildren(...[...groups.values()].map(group => {
    const section = document.createElement("section");
    section.className = "faq-category";
    section.dataset.category = group.id;
    const heading = document.createElement("h2");
    heading.append(headingIcon(group.icon, "light"), headingIcon(group.icon, "dark"), document.createTextNode(group.label));
    section.append(heading, ...group.questions.map(questionItem));
    return section;
  }));
}

function mergeLegacyFaqItems(items) {
  const byQuestion = new Map(items.map(item => [String(item.question || "").trim().toLocaleLowerCase("ar"), item]));
  legacyFaqItems.forEach(item => {
    const key = item.question.toLocaleLowerCase("ar");
    if (!byQuestion.has(key)) byQuestion.set(key, item);
  });
  return [...byQuestion.values()].map((item, index) => ({ ...item, order: item.order ?? 1000 + index }));
}

try {
  const snapshot = await getDocs(query(collection(db, "faqItems"), where("published", "==", true)));
  const items = snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  renderFaq(mergeLegacyFaqItems(items));
} catch (error) {
  console.error("Unable to load FAQ content", error);
  renderFaq(legacyFaqItems);
}
