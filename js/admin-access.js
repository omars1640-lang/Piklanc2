import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

const SECTION_PERMISSIONS = {
  overview: "overview.view", verifications: "verifications.view", users: "users.view",
  conversations: "conversations.view", marketplace: "services.view", finance: "finance.view",
  support: "support.view", content: "content.view", audit: "audit.view",
  settings: "settings.manage", promotions: "promotions.manage", ranks: "ranks.manage", team: "team.view"
};

let access = { ready: false, isSuperAdmin: false, permissions: new Set(), role: null };

export async function initializeAdminAccess(profile) {
  const isSuperAdmin = profile.adminAccessLevel === "super_admin" || !profile.adminRoleId;
  let role = null;
  if (!isSuperAdmin && profile.adminRoleId) {
    const snapshot = await getDoc(doc(db, "adminRoles", profile.adminRoleId));
    role = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  }
  access = {
    ready: true,
    isSuperAdmin,
    role,
    permissions: new Set(isSuperAdmin ? ["*"] : (role?.active === false ? [] : role?.permissions || []))
  };
  window.dispatchEvent(new CustomEvent("admin:access-ready", { detail: getAdminAccess() }));
  return getAdminAccess();
}

export function hasPermission(permission) {
  return access.isSuperAdmin || access.permissions.has(permission);
}

export function canAccessSection(section) {
  const permission = SECTION_PERMISSIONS[section];
  return Boolean(permission && hasPermission(permission));
}

export function getAdminAccess() {
  return { ...access, permissions: [...access.permissions] };
}

export function applyAdminAccess() {
  document.querySelectorAll(".nav-link[data-section]").forEach(link => {
    link.hidden = !canAccessSection(link.dataset.section);
  });
  document.querySelectorAll(".admin-section[id$='-section']").forEach(section => {
    const name = section.id.replace(/-section$/, "");
    if (!canAccessSection(name)) {
      section.classList.remove("active");
      section.hidden = true;
    } else {
      section.hidden = false;
    }
  });
  document.querySelectorAll("[data-admin-permission]").forEach(element => {
    element.hidden = !hasPermission(element.dataset.adminPermission);
  });
  return document.querySelector(".nav-link[data-section]:not([hidden])")?.dataset.section || "";
}

export function firstAllowedSection() {
  return Object.keys(SECTION_PERMISSIONS).find(canAccessSection) || "";
}
