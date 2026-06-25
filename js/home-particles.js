// خلفية جسيمات تفاعلية للصفحة الرئيسية فقط باستخدام particles.js من CDN.
// نسخة الموبايل توقف تفاعل الماوس وتبقي حركة تلقائية بطيئة لتخفيف استهلاك البطارية.

(function initHomeParticles() {
  const containerId = "homeParticleBackground";
  const container = document.getElementById(containerId);

  // لا يعمل السكربت إلا إذا كانت الحاوية موجودة في index.html.
  if (!container || typeof window.particlesJS !== "function") return;

  document.documentElement.classList.add("home-particles-enabled");
  document.body.classList.add("home-particles-enabled");

  const isMobileOrTablet = () => window.matchMedia("(max-width: 767px)").matches;
  let lastMode = isMobileOrTablet() ? "mobile" : "desktop";

  function buildParticleConfig() {
    const mobile = isMobileOrTablet();

    return {
      particles: {
        number: {
          value: mobile ? 36 : 86,
          density: {
            enable: true,
            value_area: mobile ? 1100 : 900
          }
        },
        color: {
          value: "#00e5ff"
        },
        shape: {
          type: "circle"
        },
        opacity: {
          value: mobile ? 0.24 : 0.34,
          random: true,
          anim: {
            enable: true,
            speed: mobile ? 0.25 : 0.45,
            opacity_min: 0.08,
            sync: false
          }
        },
        size: {
          value: mobile ? 2 : 2.4,
          random: true
        },
        line_linked: {
          enable: true,
          distance: mobile ? 115 : 145,
          color: "#00e5ff",
          opacity: mobile ? 0.10 : 0.18,
          width: 0.55
        },
        move: {
          enable: true,
          speed: mobile ? 0.35 : 1.05,
          direction: "none",
          random: true,
          straight: false,
          out_mode: "out",
          bounce: false
        }
      },
      interactivity: {
        detect_on: "canvas",
        events: {
          // على الموبايل نلغي التفاعل بالكامل ونترك الحركة تلقائية فقط.
          onhover: {
            enable: !mobile,
            mode: "repulse"
          },
          onclick: {
            enable: !mobile,
            mode: "push"
          },
          resize: true
        },
        modes: {
          repulse: {
            distance: 135,
            duration: 0.35
          },
          push: {
            particles_nb: 3
          }
        }
      },
      retina_detect: true
    };
  }

  function renderParticles() {
    window.particlesJS(containerId, buildParticleConfig());
  }

  renderParticles();

  // عند الانتقال بين موبايل/ديسكتوب نعيد بناء الإعدادات مرة واحدة فقط.
  window.addEventListener("resize", () => {
    const currentMode = isMobileOrTablet() ? "mobile" : "desktop";
    if (currentMode === lastMode) return;
    lastMode = currentMode;
    renderParticles();
  });
})();
