/**
 * admin.js — Heartbound Admin Portal Logic
 *
 * Access: type the admin secret key in the "Join Partner" field on the
 * onboarding screen, then enter the admin password here.
 *
 * Defaults:
 *   Secret key  : hb-admin          (change in Access Control)
 *   Password    : heartbound-admin-2025  (change in Access Control)
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const DEFAULT_ADMIN_KEY      = "hb-admin";
const DEFAULT_ADMIN_PASSWORD = "heartbound-admin-2025";

// Bootstrap Firebase credentials (mirrors production config in database.js)
const BOOTSTRAP_CONFIG = {
  apiKey:        "AIzaSyBdifZtIlVrKtnZxkHBycvMNRGpnxs5Weo",
  authDomain:    "heartbound-fb84e.firebaseapp.com",
  projectId:     "heartbound-fb84e",
  storageBucket: "heartbound-fb84e.appspot.com",
  appId:         "1:1057660034330:web:e30c2c4338247d8de220a3"
};

// ── STATE ──────────────────────────────────────────────────────────────────
let firebaseApp    = null;
let firestore      = null;
let platformConfig = {};

// ── INIT ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();

  // If already authenticated this browser session, skip login
  if (sessionStorage.getItem("hb_admin_authed") === "true") {
    await showDashboard();
  } else {
    showLoginScreen();
  }
});

// ── EVENT LISTENERS ────────────────────────────────────────────────────────
function setupEventListeners() {
  // Login form
  document.getElementById("form-admin-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl  = document.getElementById("login-error");
    const btn      = document.getElementById("btn-login");
    const password = document.getElementById("admin-password").value;

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying…`;

    const valid = await verifyPassword(password);
    if (valid) {
      sessionStorage.setItem("hb_admin_authed", "true");
      errorEl.classList.add("hidden");
      await showDashboard();
    } else {
      errorEl.classList.remove("hidden");
      document.getElementById("admin-password").value = "";
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Access Portal`;
    }
  });

  // Sidebar navigation
  document.querySelectorAll(".admin-nav .nav-item").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const section = link.getAttribute("data-section");
      showSection(section);
      document.querySelectorAll(".admin-nav .nav-item").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
    });
  });

  // Logout
  document.getElementById("btn-admin-logout").addEventListener("click", () => {
    sessionStorage.removeItem("hb_admin_authed");
    showLoginScreen();
  });

  // Platform config save
  document.getElementById("btn-save-platform-config").addEventListener("click", savePlatformConfig);

  // Access control saves
  document.getElementById("btn-save-admin-key").addEventListener("click", saveAdminKey);
  document.getElementById("btn-save-password").addEventListener("click", saveAdminPassword);
}

// ── AUTH ───────────────────────────────────────────────────────────────────
async function hashPassword(password) {
  const data        = new TextEncoder().encode(password);
  const hashBuffer  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyPassword(input) {
  const inputHash  = await hashPassword(input);
  const storedHash = localStorage.getItem("hb_admin_password_hash");

  if (storedHash) {
    return inputHash === storedHash;
  }
  // First run — compare against the default password
  const defaultHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  return inputHash === defaultHash;
}

// ── SCREEN CONTROL ─────────────────────────────────────────────────────────
function showLoginScreen() {
  document.getElementById("admin-login-screen").classList.remove("hidden");
  document.getElementById("admin-dashboard").classList.add("hidden");
}

async function showDashboard() {
  document.getElementById("admin-login-screen").classList.add("hidden");
  document.getElementById("admin-dashboard").classList.remove("hidden");

  await connectFirebase();
  await Promise.all([loadStats(), loadPlatformConfig()]);
  populateAccessSection();
  populateDatabaseSection();
}

function showSection(name) {
  document.querySelectorAll(".admin-section").forEach(s => {
    s.classList.remove("active");
    s.classList.add("hidden");
  });
  const target = document.getElementById(`section-${name}`);
  if (target) {
    target.classList.remove("hidden");
    target.classList.add("active");
  }
}

// ── FIREBASE CONNECTION ────────────────────────────────────────────────────
async function connectFirebase() {
  try {
    setConnectionStatus("connecting", "Connecting…");

    const apps  = getApps();
    firebaseApp = apps.length > 0 ? apps[0] : initializeApp(BOOTSTRAP_CONFIG);
    firestore   = getFirestore(firebaseApp);

    setConnectionStatus("connected", "Connected");

    // Update overview info panel
    document.getElementById("info-provider").textContent   = "Firebase Firestore";
    document.getElementById("info-project-id").textContent = BOOTSTRAP_CONFIG.projectId;
    document.getElementById("info-connection").textContent = "✓ Active";
    document.getElementById("info-connection").classList.add("connected");

  } catch (err) {
    console.error("[Admin] Firebase connection failed:", err);
    setConnectionStatus("error", "Connection Failed");
  }
}

function setConnectionStatus(status, label) {
  const dot   = document.getElementById("indicator-dot");
  const labelEl = document.getElementById("connection-label");
  dot.className   = `indicator-dot ${status}`;
  labelEl.textContent = label;
}

// ── STATS ──────────────────────────────────────────────────────────────────
async function loadStats() {
  if (!firestore) return;
  try {
    const spacesSnap = await getDocs(collection(firestore, "spaces"));
    document.getElementById("stat-total-spaces").textContent = spacesSnap.size;
  } catch (err) {
    document.getElementById("stat-total-spaces").textContent = "—";
    console.warn("[Admin] Could not load space count:", err);
  }
}

// ── PLATFORM CONFIG ────────────────────────────────────────────────────────
async function loadPlatformConfig() {
  if (!firestore) return;
  try {
    const configRef = doc(firestore, "config", "platform");
    const snap      = await getDoc(configRef);

    platformConfig = snap.exists()
      ? snap.data()
      : { allowCustomDb: true, maintenanceMode: false, platformName: "Heartbound" };

  } catch (err) {
    console.warn("[Admin] Could not load platform config:", err);
    platformConfig = { allowCustomDb: true, maintenanceMode: false, platformName: "Heartbound" };
  }

  applyPlatformConfigToUI();
  updateOverviewStats();
  updateLastConfigTime();
}

function applyPlatformConfigToUI() {
  document.getElementById("toggle-allow-custom-db").checked  = platformConfig.allowCustomDb !== false;
  document.getElementById("toggle-maintenance-mode").checked = platformConfig.maintenanceMode === true;
  document.getElementById("input-platform-name").value       = platformConfig.platformName || "Heartbound";
}

function updateOverviewStats() {
  const customDbEl = document.getElementById("stat-custom-db");
  customDbEl.textContent = platformConfig.allowCustomDb !== false ? "Allowed" : "Disabled";
  customDbEl.style.color  = platformConfig.allowCustomDb !== false ? "#4caf50" : "#ff9800";

  const statusEl = document.getElementById("stat-platform-status");
  statusEl.textContent = platformConfig.maintenanceMode ? "Maintenance" : "Online";
  statusEl.style.color  = platformConfig.maintenanceMode ? "#ff9800" : "#4caf50";
}

function updateLastConfigTime() {
  const el = document.getElementById("info-last-update");
  if (platformConfig.updatedAt && typeof platformConfig.updatedAt.toDate === "function") {
    el.textContent = platformConfig.updatedAt.toDate().toLocaleString();
  } else {
    el.textContent = "Never (using defaults)";
  }
}

async function savePlatformConfig() {
  if (!firestore) {
    showToast("Not connected to Firebase.", "error");
    return;
  }

  const btn = document.getElementById("btn-save-platform-config");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;

  try {
    const config = {
      allowCustomDb:   document.getElementById("toggle-allow-custom-db").checked,
      maintenanceMode: document.getElementById("toggle-maintenance-mode").checked,
      platformName:    document.getElementById("input-platform-name").value.trim() || "Heartbound",
      updatedAt:       serverTimestamp()
    };

    const configRef = doc(firestore, "config", "platform");
    await setDoc(configRef, config, { merge: true });

    platformConfig = config;
    updateOverviewStats();
    showToast("Platform configuration saved!");

  } catch (err) {
    console.error("[Admin] Platform config save failed:", err);
    showToast("Save failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Configuration`;
  }
}

// ── DATABASE SECTION ───────────────────────────────────────────────────────
function populateDatabaseSection() {
  const container = document.getElementById("db-active-config");
  const rows = [
    { key: "Provider",    val: "Firebase Firestore" },
    { key: "Project ID",  val: BOOTSTRAP_CONFIG.projectId },
    { key: "Auth Domain", val: BOOTSTRAP_CONFIG.authDomain },
    { key: "API Key",     val: BOOTSTRAP_CONFIG.apiKey.substring(0, 10) + "••••••••••" },
    { key: "App ID",      val: BOOTSTRAP_CONFIG.appId.substring(0, 14) + "••••" }
  ];
  container.innerHTML = rows.map(r => `
    <div class="db-detail-row">
      <span class="key">${r.key}</span>
      <span class="val">${r.val}</span>
    </div>
  `).join("");
}

// ── ACCESS CONTROL ─────────────────────────────────────────────────────────
function populateAccessSection() {
  const currentKey = localStorage.getItem("hb_admin_key") || DEFAULT_ADMIN_KEY;
  document.getElementById("input-admin-key").value = currentKey;
}

function saveAdminKey() {
  const newKey = document.getElementById("input-admin-key").value.trim();
  if (!newKey) {
    showToast("Secret key cannot be empty.", "error");
    return;
  }
  localStorage.setItem("hb_admin_key", newKey);
  showToast(`Secret key updated to: "${newKey}"`);
}

async function saveAdminPassword() {
  const newPass     = document.getElementById("input-new-password").value;
  const confirmPass = document.getElementById("input-confirm-password").value;

  if (!newPass || newPass.length < 8) {
    showToast("Password must be at least 8 characters.", "error");
    return;
  }
  if (newPass !== confirmPass) {
    showToast("Passwords do not match.", "error");
    return;
  }

  const hash = await hashPassword(newPass);
  localStorage.setItem("hb_admin_password_hash", hash);
  document.getElementById("input-new-password").value   = "";
  document.getElementById("input-confirm-password").value = "";
  showToast("Admin password updated successfully!");
}

// ── TOAST ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = "success") {
  const toast   = document.getElementById("admin-toast");
  const msg     = document.getElementById("toast-message");
  const icon    = document.getElementById("toast-icon");

  msg.textContent = message;
  icon.className  = type === "error"
    ? "fa-solid fa-circle-xmark"
    : "fa-solid fa-circle-check";
  toast.className = "admin-toast" + (type === "error" ? " error" : "");
  toast.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}
