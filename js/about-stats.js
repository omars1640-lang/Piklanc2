const categoryAliases = {
  "تصميم": "design", design: "design",
  "برمجة": "code", web: "code", code: "code",
  "كتابة": "write", writing: "write", write: "write",
  "تسويق": "market", marketing: "market", market: "market",
  "صوتيات": "audio", audio: "audio",
  "فيديو": "video", video: "video"
};

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

async function loadAboutStats() {
  try {
    const [
      firestoreModule,
      firebaseModule
    ] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
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
    const categories = new Set(services.map(service => categoryAliases[service.category] || service.category || "other"));
    const categoryCount = categories.size || 0;
    const formattedFee = `${feePercent.toLocaleString("ar-SY")}%`;
    setText("aboutPlatformFee", formattedFee);
    setText("aboutStoryPlatformFee", formattedFee);
    setText("aboutCategoryCount", categoryCount.toLocaleString("ar-SY"));
  } catch (error) {
    console.warn("Unable to load about page stats", error);
  }
}

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadAboutStats, { timeout: 1400 });
} else {
  window.setTimeout(loadAboutStats, 400);
}
