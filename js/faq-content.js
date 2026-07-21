import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

const faqSections = {
  buyer: { label: "للمشترين", icon: "search-service" },
  freelancer: { label: "للمستقلين", icon: "earn-profits" },
  payment: { label: "الدفع والسحب", icon: "payment-preparing" },
  technical: { label: "أسئلة تقنية", icon: "support" },
  general: { label: "أسئلة عامة", icon: "support" }
};

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

try {
  const snapshot = await getDocs(query(collection(db, "faqItems"), where("published", "==", true)));
  const items = snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  renderFaq(items);
} catch (error) {
  console.error("Unable to load FAQ content", error);
}
