const footerCopy = "© 2026 PikLance. جميع الحقوق محفوظة.";

function ensureFooterCopy() {
  if (document.body?.dataset.noGlobalFooter === "true") return;
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
      width: 100%;
      padding: 18px 14px;
      color: var(--piklance-footer-muted, #5f687b);
      background: var(--piklance-footer-bg, #f7f8ff);
      border-top: 1px solid var(--piklance-footer-border, #e4e6f3);
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
