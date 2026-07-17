const META_PIXEL_ID = "1682745922834883";
let initialized = false;

function installPixel() {
  if (initialized) return;

  if (!window.fbq) {
    const fbq = function () {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, arguments);
      } else {
        fbq.queue.push(arguments);
      }
    };

    window.fbq = fbq;
    window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript?.parentNode?.insertBefore(script, firstScript);
  }

  window.fbq("init", META_PIXEL_ID);
  window.fbq("track", "PageView");
  initialized = true;
}

export function applyMetaPixelConsent(preference) {
  if (preference === "all") {
    if (initialized) {
      window.fbq?.("consent", "grant");
    } else {
      installPixel();
    }
    return;
  }

  if (initialized) window.fbq?.("consent", "revoke");
}

export function trackMetaEvent(eventName, parameters = {}) {
  if (!initialized || document.documentElement.dataset.cookieConsent !== "all") return;
  window.fbq?.("track", eventName, parameters);
}

