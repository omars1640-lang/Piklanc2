import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

function faqIconName(category) {
  const value = String(category || "").toLowerCase();
  if (value.includes("دفع") || value.includes("سحب") || value === "payment") return "payment-preparing";
  if (value.includes("مستقل") || value === "freelancer") return "earn-profits";
  if (value.includes("مشتري") || value === "buyer") return "search-service";
  return "support";
}

function headingIcon(name, theme) {
  const image = document.createElement("img");
  image.className = `faq-heading-icon ${theme}`;
  image.src = `assets/icons/${theme}/${name}.svg`;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  return image;
}

try {
  const snapshot = await getDocs(query(collection(db, "faqItems"), where("published", "==", true)));
  const items = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  if (items.length) {
    const container = document.getElementById("faqContainer");
    container.replaceChildren();
    const groups = new Map();
    items.forEach(item => {
      const category = item.category || "عام";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    });
    groups.forEach((questions, category) => {
      const section = document.createElement("div");
      section.className = "faq-category";
      section.dataset.category = category;
      const heading = document.createElement("h2");
      const icon = faqIconName(category);
      heading.append(headingIcon(icon, "light"), headingIcon(icon, "dark"), document.createTextNode(category));
      section.appendChild(heading);
      questions.forEach(question => {
        const item = document.createElement("div");
        item.className = "faq-item";
        const control = document.createElement("div");
        control.className = "faq-question";
        control.append(document.createTextNode(question.question), Object.assign(document.createElement("span"), { className: "faq-icon", textContent: "▼" }));
        const answer = document.createElement("div");
        answer.className = "faq-answer";
        const copy = document.createElement("p");
        copy.textContent = question.answer;
        answer.appendChild(copy);
        control.addEventListener("click", () => window.toggleFAQ(control));
        item.append(control, answer);
        section.appendChild(item);
      });
      container.appendChild(section);
    });
  }
} catch (error) {
  console.error("Unable to load FAQ content", error);
}
