const categoryAliases = {
  "تصميم": "design", design: "design",
  "برمجة": "code", "برمجة وتطوير": "code", web: "code", code: "code",
  "كتابة": "write", "كتابة وترجمة": "write", writing: "write", write: "write",
  "تسويق": "market", "تسويق رقمي": "market", marketing: "market", market: "market",
  "صوتيات": "audio", audio: "audio",
  "فيديو": "video", "فيديو وأنيميشن": "video", video: "video"
};

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function normalizeCategory(value) {
  const raw = String(value || "").trim();
  if (!raw) return "other";
  if (categoryAliases[raw]) return categoryAliases[raw];
  if (raw.includes("تصميم")) return "design";
  if (raw.includes("برمج") || raw.includes("تطوير")) return "code";
  if (raw.includes("كتابة") || raw.includes("ترجمة")) return "write";
  if (raw.includes("تسويق")) return "market";
  if (raw.includes("صوت")) return "audio";
  if (raw.includes("فيديو") || raw.includes("أنيميشن") || raw.includes("مونتاج")) return "video";
  return "other";
}

async function loadAboutStats() {
  try {
    const [
      firestoreModule,
      firebaseModule
    ] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js"),
      import("./firebase.js")
    ]);
    const { collection, doc, getDoc, getDocs, query, where } = firestoreModule;
    const { db } = firebaseModule;
    const [settingsSnapshot, servicesSnapshot] = await Promise.all([
      getDoc(doc(db, "platformSettings", "general")),
      getDocs(query(collection(db, "services"), where("status", "==", "published")))
    ]);
    const feePercent = Number(settingsSnapshot.exists() ? settingsSnapshot.data().platformFeePercent : 20);
    const services = servicesSnapshot.docs.map(item => item.data());
    const categories = new Set(services.map(service => normalizeCategory(service.category)));
    const categoryCount = categories.size || 0;
    const formattedFee = `${feePercent.toLocaleString("en-US")}%`;
    setText("aboutPlatformFee", formattedFee);
    setText("aboutStoryPlatformFee", formattedFee);
    setText("aboutCategoryCount", categoryCount.toLocaleString("en-US"));
  } catch (error) {
    console.warn("Unable to load about page stats", error);
  }
}

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadAboutStats, { timeout: 1400 });
} else {
  window.setTimeout(loadAboutStats, 400);
}
