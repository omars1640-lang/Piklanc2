const footerCopy = "© 2026 PikLance. جميع الحقوق محفوظة.";

function ensureFooterCopy() {
  const existing = document.querySelectorAll("footer small, .footer-bottom, .piklance-global-footer");
  if (existing.length) {
    existing.forEach(element => {
      element.textContent = footerCopy;
    });
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    .piklance-global-footer {
      padding: 18px 14px;
      color: #8b93a3;
      background: transparent;
      text-align: center;
      font: 600 12px/1.9 "Cairo", sans-serif;
    }
  `;
  const footer = document.createElement("footer");
  footer.className = "piklance-global-footer";
  footer.textContent = footerCopy;
  document.head.appendChild(style);
  document.body.appendChild(footer);
}

ensureFooterCopy();
