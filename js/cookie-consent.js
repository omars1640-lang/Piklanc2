const STORAGE_KEY = "piklance_cookie_consent";

function savePreference(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    value,
    updatedAt: new Date().toISOString()
  }));
  document.documentElement.dataset.cookieConsent = value;
}

function getPreference() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved?.value === "all" || saved?.value === "essential" ? saved.value : null;
  } catch {
    return null;
  }
}

function closePanel(panel) {
  panel.classList.remove("is-visible");
  window.setTimeout(() => panel.hidden = true, 180);
}

function openPanel(panel) {
  panel.hidden = false;
  window.requestAnimationFrame(() => panel.classList.add("is-visible"));
}

function buildPanel() {
  const panel = document.createElement("section");
  panel.className = "cookie-consent";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-live", "polite");
  panel.setAttribute("aria-label", "تفضيلات ملفات الارتباط");
  panel.innerHTML = `
    <div class="cookie-consent-copy">
      <strong>خصوصيتك مهمة</strong>
      <p>نستخدم تقنيات ضرورية لتسجيل الدخول وتشغيل الموقع، ويمكنك السماح بالتقنيات الاختيارية عند تفعيلها مستقبلاً.</p>
      <a href="cookie-policy.html">اقرأ سياسة ملفات الارتباط</a>
    </div>
    <div class="cookie-consent-actions">
      <button type="button" data-cookie-choice="essential">الضرورية فقط</button>
      <button type="button" class="primary" data-cookie-choice="all">قبول الاختيارية</button>
    </div>
  `;

  panel.querySelectorAll("[data-cookie-choice]").forEach(button => {
    button.addEventListener("click", () => {
      savePreference(button.dataset.cookieChoice);
      closePanel(panel);
    });
  });

  document.body.appendChild(panel);
  return panel;
}

function initializeConsent() {
  const panel = buildPanel();
  const preference = getPreference();
  if (preference) {
    document.documentElement.dataset.cookieConsent = preference;
  } else {
    openPanel(panel);
  }

  document.getElementById("openCookiePreferences")?.addEventListener("click", () => {
    openPanel(panel);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeConsent, { once: true });
} else {
  initializeConsent();
}
