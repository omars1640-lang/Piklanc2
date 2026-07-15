export const ALWAYS_ALLOWED_PAGES = new Set(["maintenance.html", "login.html", "dashboard.html"]);
export const PRELAUNCH_FLOW_PAGES = new Set(["coming-soon.html", "register.html", "pending-review.html"]);

export function platformAccessDecision({ page, maintenanceMode, prelaunchMode, role, earlyAccess }) {
  if (ALWAYS_ALLOWED_PAGES.has(page)) return "allow";

  if (maintenanceMode) {
    return role === "admin" ? "allow" : "maintenance";
  }

  if (prelaunchMode) {
    const hasPlatformAccess = role === "admin" || earlyAccess === true;
    if (page === "coming-soon.html" && hasPlatformAccess) return "platform";
    if (PRELAUNCH_FLOW_PAGES.has(page) || hasPlatformAccess) return "allow";
    return "coming-soon";
  }

  return page === "coming-soon.html" ? "platform" : "allow";
}
