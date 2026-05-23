/* Heartbound Application Main Logic & UI Controller */

import { db } from "./database.js";

// Safe LocalDate parser to prevent Safari timezone date slips (treating YYYY-MM-DD as local instead of UTC)
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date(NaN);
  if (dateStr instanceof Date) return dateStr;
  if (typeof dateStr === 'number') return new Date(dateStr);
  
  const parts = String(dateStr).split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // 0-based
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month, day);
    }
  }
  const parsed = new Date(dateStr);
  return parsed;
}

// Robust checklist parser helper
function safeParseChecklist(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Failed to parse checklist JSON string:", e);
      return [];
    }
  }
  return [];
}

// Dynamically populates preference and celebration target dropdown options with active nicknames
function populateTargetOptions(selectId, selectedValue = "partner2") {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = "";

  let p1Name = "Creator";
  let p2Name = "Partner";

  if (localSpaceData) {
    p1Name = localSpaceData.partner1Name || "Creator";
    p2Name = localSpaceData.partner2Name || "Partner";
  } else {
    const sandboxProfile = JSON.parse(localStorage.getItem("hb_sandbox_profile"));
    if (sandboxProfile) {
      p1Name = sandboxProfile.partner1Name || "Creator";
      p2Name = sandboxProfile.partner2Name || "Partner";
    }
  }

  // Option for Partner (partner2)
  const optPartner = document.createElement("option");
  optPartner.value = "partner2";
  optPartner.innerText = `For ${p2Name}`;
  if (selectedValue === "partner2") optPartner.selected = true;
  select.appendChild(optPartner);

  // Option for Creator (partner1)
  const optCreator = document.createElement("option");
  optCreator.value = "partner1";
  optCreator.innerText = `For ${p1Name}`;
  if (selectedValue === "partner1") optCreator.selected = true;
  select.appendChild(optCreator);
}

// --- GLOBAL VARIABLES & DATA STORE ---
let localSpaceData = null;
let localLovesHates = [];
let localMemories = [];
let localEvents = [];
let isLoggedOut = false; // Guard flag to prevent auto-login after logout

let activeTabType = "love";       // "love" | "hate"
let activeCategoryFilter = "all";  // "all" | "Food" | "Gifts" | ...
let activeMemoryCoverUrl = "";     // Current selected cover preset url

// Curated aesthetic cover presets for Memory Lane
const PRESET_COVERS = [
  "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=600&auto=format&fit=crop&q=60", // Couple holding hands
  "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&auto=format&fit=crop&q=60", // Cozy warm coffee cups
  "https://images.unsplash.com/photo-1526218626217-dc65a29bb444?w=600&auto=format&fit=crop&q=60", // Beautiful field flowers
  "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&auto=format&fit=crop&q=60", // Adventure maps & travel
  "https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=60", // Sparkling lights
  "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=600&auto=format&fit=crop&q=60", // Love note cozy letter
  "https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=600&auto=format&fit=crop&q=60", // Sunset sky
  "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=600&auto=format&fit=crop&q=60"  // Beach bonfire sparklers
];

// Curated Fallback Thoughtful Spark Prompts
const GENERAL_SPARKS = [
  "Surprise them with a hand-written sticky note left somewhere unexpected, like their laptop or mirror. 📝",
  "Brew their absolute favorite coffee or tea just the way they like it and bring it to them in bed. ☕",
  "Set a reminder to randomly text them a sweet memory from your early days together out of the blue. 💬",
  "Buy a small single stem of their favorite flower or a cute plant to brighten up their desk. 🌸",
  "Plan a 15-minute screen-free 'catch up walk' around the neighborhood tonight just to talk about their day. 🚶‍♂️",
  "Surprise them by preparing a playlist of songs that remind you of them or have memorable ties. 🎵",
  "Order their favorite comfort meal or dessert to be delivered directly to them if they are having a stressful day. 🍰"
];

// --- APP INITIALIZER ---
document.addEventListener("DOMContentLoaded", async () => {
  setupAestheticBackgroundHearts();
  initRouting();
  initPresetCovers();
  initSettingsAndForms();
  
  // Parse invite URL search parameters if any
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get("invite");
  
  if (inviteCode) {
    console.log("Found invite parameter in URL. Bootstrapping...");
    const success = db.bootstrapFromInviteCode(inviteCode);
    if (success) {
      // Clean query parameters from URL bar
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
      
      // Route connection (it will call initConnection and handle routing)
      await handleInviteRouting();
    } else {
      alert("Invalid or expired Love Sync invite link.");
      db.initConnection(handleConnectionStatusChange);
    }
  } else {
    // Clean up any logout redirect query params
    if (window.location.search) {
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
    
    // Connect database logic normally
    db.initConnection(handleConnectionStatusChange);

    // Load platform config non-blocking; apply maintenance mode + feature flags
    db.loadPlatformConfig().then(config => {
      if (config) {
        if (config.maintenanceMode) {
          const overlay = document.getElementById("maintenance-overlay");
          if (overlay) overlay.classList.remove("hidden");
        }
      }
    }).catch(e => console.warn("[HB] Platform config load error:", e));
  }
});

// --- CONNECTION STATUS HANDLER ---
function handleConnectionStatusChange(status, spaceId) {
  console.log("[HB] handleConnectionStatusChange:", status, spaceId || "");
  const badge = document.getElementById("connection-badge");
  const badgeText = document.getElementById("connection-status-text");
  
  // Reset classes
  if (badge) badge.className = "connection-badge";
  
  // Toggle pairing panel inputs depending on connection status
  const configForm = document.getElementById("form-cloud-config");
  const pairPanel = document.getElementById("pairing-panel");
  const displayCode = document.getElementById("display-space-code");
  const btnCopy = document.getElementById("btn-copy-code");
  const inputPairCode = document.getElementById("input-pair-code");
  const btnSubmitPair = document.getElementById("btn-submit-pair");
  
  const btnCopyInviteCode = document.getElementById("btn-copy-invite-code");
  const btnCopyCreatorCode = document.getElementById("btn-copy-creator-code");

  if (status === "sandbox") {
    if (badge) {
      badge.classList.add("sandbox");
      if (badgeText) badgeText.innerText = "Sandbox Mode";
    }
    if (pairPanel) pairPanel.classList.add("disabled");
    if (displayCode) displayCode.innerText = "--------";
    if (btnCopy) btnCopy.disabled = true;
    if (inputPairCode) inputPairCode.disabled = true;
    if (btnSubmitPair) btnSubmitPair.disabled = true;
    if (btnCopyCreatorCode) btnCopyCreatorCode.disabled = true;
    if (btnCopyInviteCode) btnCopyInviteCode.disabled = true;
    
    // Check if sandbox onboarding exists
    checkOnboarding(false);
  } else {
    // Cloud connection established
    if (pairPanel) pairPanel.classList.remove("disabled");
    if (inputPairCode) inputPairCode.disabled = false;
    if (btnSubmitPair) btnSubmitPair.disabled = false;

    const providerName = db.getCloudProvider() === "supabase" ? "Supabase" : "Firebase";

    if (status === "cloud_connected") {
      if (badge) {
        badge.classList.add("cloud");
        if (badgeText) badgeText.innerText = `${providerName} Connected (Not Paired)`;
      }
      if (displayCode) displayCode.innerText = "Generating...";
      if (btnCopy) btnCopy.disabled = true;
      if (btnCopyCreatorCode) btnCopyCreatorCode.disabled = true;
      if (btnCopyInviteCode) btnCopyInviteCode.disabled = true;
      
      // Auto-create space document if none exists
      triggerAutoSpaceCreation();
    } else if (status === "paired") {
      if (badge) {
        badge.classList.add("paired");
        if (badgeText) badgeText.innerText = `${providerName} Paired: ${spaceId}`;
      }
      if (displayCode) displayCode.innerText = spaceId;
      if (btnCopy) btnCopy.disabled = false;
      if (btnCopyCreatorCode) btnCopyCreatorCode.disabled = false;
      if (btnCopyInviteCode) btnCopyInviteCode.disabled = false;
      
      // Explicitly hide the onboarding modal once cloud connection is established and paired
      const onboardingModal = document.getElementById("modal-onboarding");
      if (onboardingModal) onboardingModal.classList.add("hidden");
      
      // Setup Live Listeners
      setupRealtimeSubscriptions();
    }
  }
}

// Automatically create document space for a new database connection
async function triggerAutoSpaceCreation() {
  const profileInput = JSON.parse(localStorage.getItem("hb_sandbox_profile"));
  if (profileInput) {
    try {
      const newSpaceId = await db.createCloudSpace(profileInput);
      if (newSpaceId) {
        handleConnectionStatusChange("paired", newSpaceId);
      }
    } catch (err) {
      console.error("Auto space creation failure:", err);
    }
  } else {
    // Show onboarding for cloud mode before creating
    checkOnboarding(true);
  }
}

async function handleInviteRouting() {
  const onboardingModal = document.getElementById("modal-onboarding");
  const onboardTabs = document.getElementById("onboard-tabs");
  const formOnboarding = document.getElementById("form-onboarding");
  const panelJoinSpace = document.getElementById("panel-join-space");
  const formPartnerSetup = document.getElementById("form-partner-setup");

  // Connect database and run connections
  console.log("Connecting database via invite code...");
  const connected = await db.initConnection(handleConnectionStatusChange);
  if (!connected) {
    alert("Database connection failed. Please verify configurations!");
    return;
  }

  const role = localStorage.getItem("hb_user_role") || "partner2";
  
  if (role === "partner1") {
    // Creator: bypass secondary setup details form and log in directly
    console.log("Creator Recovery Code used. Direct dashboard entry.");
    if (onboardingModal) onboardingModal.classList.add("hidden");
    setupRealtimeSubscriptions();
    return;
  }

  // Partner (partner2): fetch space to see if name/avatar details are already configured
  console.log("Partner Sync Code used. Fetching space data...");
  const spaceData = await db.fetchSpace();
  if (spaceData) {
    const isPartnerSet = spaceData.partner2Name && 
                         spaceData.partner2Name.trim() !== "" && 
                         spaceData.partner2Name !== "Taylor";
    if (isPartnerSet) {
      // Returning Partner: bypass onboarding, direct dashboard entry
      console.log("Returning partner detected (onboarded). Direct dashboard entry.");
      if (onboardingModal) onboardingModal.classList.add("hidden");
      setupRealtimeSubscriptions();
    } else {
      // First-time Partner: show simplified partner onboarding screen
      console.log("First-time partner detected. Redirecting to setup...");
      if (onboardingModal) onboardingModal.classList.remove("hidden");
      if (onboardTabs) onboardTabs.classList.add("hidden");
      if (formOnboarding) formOnboarding.classList.add("hidden");
      if (panelJoinSpace) panelJoinSpace.classList.add("hidden");
      if (formPartnerSetup) formPartnerSetup.classList.remove("hidden");
    }
  } else {
    // Fallback: show onboarding simplified form
    console.log("Space information not found. Showing partner setup form.");
    if (onboardingModal) onboardingModal.classList.remove("hidden");
    if (onboardTabs) onboardTabs.classList.add("hidden");
    if (formOnboarding) formOnboarding.classList.add("hidden");
    if (panelJoinSpace) panelJoinSpace.classList.add("hidden");
    if (formPartnerSetup) formPartnerSetup.classList.remove("hidden");
  }
}

function checkOnboarding(isCloud = false) {
  console.log("[HB] checkOnboarding called. isCloud:", isCloud, "isLoggedOut:", isLoggedOut);
  // If user just logged out, always show onboarding
  if (isLoggedOut) {
    showOnboardingScreen();
    return;
  }
  
  const onboardingModal = document.getElementById("modal-onboarding");
  let hasProfile = false;

  if (isCloud) {
    hasProfile = db.isPaired();
  } else {
    hasProfile = !!localStorage.getItem("hb_sandbox_profile");
  }

  if (!hasProfile) {
    showOnboardingScreen();
  } else {
    if (onboardingModal) onboardingModal.classList.add("hidden");
    if (!isCloud) {
      setupRealtimeSubscriptions(); // Trigger local subscriptions
    }
  }
}

// Centralized function to show onboarding and reset UI to clean state
function showOnboardingScreen() {
  console.log("[HB] showOnboardingScreen called");
  const onboardingModal = document.getElementById("modal-onboarding");
  const formOnboarding = document.getElementById("form-onboarding");
  const panelJoinSpace = document.getElementById("panel-join-space");
  const onboardTabs = document.getElementById("onboard-tabs");
  const formPartnerSetup = document.getElementById("form-partner-setup");
  
  // Reset onboarding to default "New Space" tab view
  if (onboardTabs) onboardTabs.classList.remove("hidden");
  if (formOnboarding) formOnboarding.classList.remove("hidden");
  if (panelJoinSpace) panelJoinSpace.classList.add("hidden");
  if (formPartnerSetup) formPartnerSetup.classList.add("hidden");
  
  // Show the modal
  if (onboardingModal) onboardingModal.classList.remove("hidden");
}

// Complete logout: wipe everything and trigger a clean, hard page reload
async function performLogout() {
  isLoggedOut = true;
  
  // 1. Stop all real-time database listeners
  db.unsubscribeAll();
  
  // 2. Tear down the Firebase/Supabase connection context completely
  try {
    await db.destroyApp();
  } catch (e) {
    console.error("Error tearing down Firebase context on logout:", e);
  }
  
  // 3. Selectively clear space pairing and profile details from local storage (preserving database configuration)
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("hb_") && key !== "hb_db_config") {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  
  // 4. Force a hard, clean page reload to completely destroy active JS state
  window.location.href = window.location.origin + window.location.pathname;
}

// Setup listeners (for either Firestore or LocalStorage changes)
function setupRealtimeSubscriptions() {
  console.log("[HB] setupRealtimeSubscriptions called. isLoggedOut:", isLoggedOut);
  if (isLoggedOut) return;

  // 1. Profile / Milestone info
  db.subscribeSpaceInfo((profile) => {
    if (!profile) {
      if (db.isCloudMode()) {
        console.error("Space info missing in cloud mode. Security rules might be blocking access.");
        alert("Error: Space data could not be retrieved. Please check your Database Security Rules and Provider Configuration.");
      } else {
        // In sandbox mode, no profile means not yet onboarded — ignore silently
        console.warn("Sandbox: no profile yet, ignoring subscribeSpaceInfo callback.");
      }
      return;
    }
    localSpaceData = profile;
    updateProfileUI();
    updateCountdownUI();
  });

  // 2. Loves & Hates
  db.subscribeLovesHates((items) => {
    localLovesHates = items;
    renderLovesHates();
    updateStatsUI();
  });

  // 3. Memories
  db.subscribeMemories((memories) => {
    localMemories = memories;
    renderMemories();
    updateStatsUI();
  });

  // 4. Celebrations & Trip Events
  db.subscribeEvents((events) => {
    localEvents = events;
    renderEvents();
    updateCountdownUI();
    updateStatsUI();
  });
}

// --- SPA VIEW ROUTING ---
function initRouting() {
  const navItems = document.querySelectorAll(".nav-item");
  const views = document.querySelectorAll(".app-view");
  const viewTitle = document.getElementById("view-title");

  navItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      
      const targetView = item.getAttribute("data-view");
      
      // Update nav active states
      navItems.forEach(n => n.classList.remove("active"));
      item.classList.add("active");
      
      // Toggle view layouts
      views.forEach(view => {
        if (view.id === `view-${targetView}`) {
          view.classList.add("active");
        } else {
          view.classList.remove("active");
        }
      });
      
      // Update Title header
      const headings = {
        dashboard: "Dashboard",
        preferences: "The Little Things",
        timeline: "Memory Lane",
        adventures: "Adventures & Planning"
      };
      viewTitle.innerText = headings[targetView] || "Heartbound";

      // Re-render the active tab so data fetched in background is always displayed
      // This fixes the issue where subscriptions fire before the tab is visible
      if (targetView === "adventures") {
        renderEvents();
        // Also trigger a fresh Firestore pull in case snapshot was missed
        if (typeof db !== "undefined") {
          db.refreshEvents && db.refreshEvents();
        }
      } else if (targetView === "preferences") {
        renderLovesHates();
      } else if (targetView === "timeline") {
        renderMemories();
      }
    });
  });
}

// --- UPDATE UI CORE COMPONENTS ---

// Profile Metadata
function updateProfileUI() {
  if (!localSpaceData) return;

  const role = localStorage.getItem("hb_user_role") || "partner1";
  
  let userName, partnerName, userAvatar, partnerAvatar;
  
  if (role === "partner2") {
    userAvatar = localSpaceData.partner2Avatar || "💖";
    partnerAvatar = localSpaceData.partner1Avatar || "👤";
    userName = localSpaceData.partner2Name || "Taylor";
    partnerName = localSpaceData.partner1Name || "Alex";
  } else {
    userAvatar = localSpaceData.partner1Avatar || "👤";
    partnerAvatar = localSpaceData.partner2Avatar || "💖";
    userName = localSpaceData.partner1Name || "Alex";
    partnerName = localSpaceData.partner2Name || "Taylor";
  }
  
  // Left Nav Panel
  document.getElementById("nav-user-avatar").innerText = userAvatar;
  document.getElementById("nav-partner-avatar").innerText = partnerAvatar;
  document.getElementById("nav-couple-names").innerText = `${userName} & ${partnerName}`;
  
  // Hero Greeting
  document.getElementById("hero-greeting").innerText = `Hello, ${userName}`;
  document.getElementById("hero-partner-name").innerText = partnerName;

  // Days Together Ticker
  if (localSpaceData.anniversaryDate) {
    const anniversary = parseLocalDate(localSpaceData.anniversaryDate);
    if (!isNaN(anniversary.getTime())) {
      const today = new Date();
      // Zero out time fields to get the exact midnight-to-midnight difference in local time
      const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const anniversaryZero = new Date(anniversary.getFullYear(), anniversary.getMonth(), anniversary.getDate());
      const diffTime = Math.abs(todayZero - anniversaryZero);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      // Animate the ticker count!
      animateTicker("dash-days-together", diffDays);
      document.getElementById("nav-days-badge").innerText = `${diffDays} Days Together`;
    } else {
      document.getElementById("dash-days-together").innerText = "--";
      document.getElementById("nav-days-badge").innerText = "Not Paired";
    }
  } else {
    document.getElementById("dash-days-together").innerText = "--";
    document.getElementById("nav-days-badge").innerText = "Not Paired";
  }
}

// Quick Statistics panel
function updateStatsUI() {
  document.getElementById("stat-loves").innerText = localLovesHates.filter(item => item.type === "love").length;
  document.getElementById("stat-hates").innerText = localLovesHates.filter(item => item.type === "hate").length;
  document.getElementById("stat-memories").innerText = localMemories.length;
  document.getElementById("stat-adventures").innerText = localEvents.length;
}

// Live Countdown tickers
function updateCountdownUI() {
  if (!localSpaceData) return;

  const countdownDaysEl = document.getElementById("countdown-days");
  const countdownTitleEl = document.getElementById("countdown-event-title");
  const countdownDateEl = document.getElementById("countdown-event-date");

  const today = new Date();
  const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let candidateEvents = [];

  // 1. Partner's Birthday
  const role = localStorage.getItem("hb_user_role") || "partner1";
  let targetBirthdayStr = role === "partner2" ? localSpaceData.partner1Birthday : localSpaceData.partner2Birthday;
    
  // Fallback if the new schema fields are missing
  if (!targetBirthdayStr && localSpaceData.partnerBirthday) {
    targetBirthdayStr = localSpaceData.partnerBirthday;
  }
    
  if (targetBirthdayStr) {
    const birthdayStr = String(targetBirthdayStr || "").trim();
    const parts = birthdayStr.split("-").map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      const [bYear, bMonth, bDay] = parts;
      let nextBday = new Date(todayZero.getFullYear(), bMonth - 1, bDay);
      
      if (nextBday < todayZero) {
        nextBday.setFullYear(todayZero.getFullYear() + 1);
      }
      
      const targetPartnerName = role === "partner2" ? (localSpaceData.partner1Name || "Alex") : (localSpaceData.partner2Name || "Taylor");
      candidateEvents.push({
        title: `${targetPartnerName}'s Birthday 🎂`,
        date: nextBday,
        displayDate: nextBday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      });
    }
  }

  // 2. Scheduled Trip or celebration events
  localEvents.forEach(evt => {
    if (!evt.date) return;
    const evtDate = parseLocalDate(evt.date);
    if (!isNaN(evtDate.getTime())) {
      const evtDateZero = new Date(evtDate.getFullYear(), evtDate.getMonth(), evtDate.getDate());
      if (evtDateZero >= todayZero) {
        candidateEvents.push({
          title: evt.type === "trip" ? `Trip to ${evt.title} ✈️` : `${evt.title} 🎈`,
          date: evtDateZero,
          displayDate: evtDateZero.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        });
      }
    }
  });

  // Sort candidates to find closest
  if (candidateEvents.length > 0) {
    candidateEvents.sort((a,b) => a.date - b.date);
    const nextEvent = candidateEvents[0];
    
    const diffTime = Math.abs(nextEvent.date - todayZero);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (isNaN(diffDays)) {
      countdownDaysEl.innerText = "--";
    } else {
      countdownDaysEl.innerText = String(diffDays).padStart(2, '0');
    }
    countdownTitleEl.innerText = nextEvent.title;
    countdownDateEl.innerText = nextEvent.displayDate;
  } else {
    // Fallback if no events scheduled
    countdownDaysEl.innerText = "--";
    countdownTitleEl.innerText = "No Upcoming Milestone";
    countdownDateEl.innerText = "Schedule a celebration in Adventures!";
  }
}

// Animate milestone numerical tickers smoothly
function animateTicker(elementId, targetValue) {
  const el = document.getElementById(elementId);
  const start = parseInt(el.innerText) || 0;
  const duration = 1000; // 1 second
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Ease out quad
    const easeProgress = progress * (2 - progress);
    const currentValue = Math.floor(start + (targetValue - start) * easeProgress);
    
    el.innerText = currentValue;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.innerText = targetValue;
    }
  }

  requestAnimationFrame(update);
}

// --- LOVES & HATES LEDGER ---

// (Ledger category and tab click event listeners moved inside initSettingsAndForms with defensive guards)

// Render ledger items grid
function renderLovesHates(searchQuery = "") {
  const grid = document.getElementById("preferences-grid");
  const emptyState = document.getElementById("pref-empty-state");
  grid.innerHTML = "";

  // Filter items safely with extreme defense against missing/casing issues in manual database records
  const filtered = localLovesHates.filter(item => {
    if (!item) return false;
    const matchesType = String(item.type || "").toLowerCase() === activeTabType;
    const matchesCategory = activeCategoryFilter === "all" || String(item.category || "").toLowerCase() === activeCategoryFilter.toLowerCase();
    
    const itemStr = String(item.item || "").toLowerCase();
    const notesStr = String(item.notes || "").toLowerCase();
    const matchesSearch = !searchQuery || 
      itemStr.includes(searchQuery) || 
      notesStr.includes(searchQuery);
    
    return matchesType && matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
    
    filtered.forEach(pref => {
      const card = document.createElement("div");
      card.className = `glass-card pref-card ${pref.type}-type`;
      
      const categoryIconMap = {
        Food: "fa-utensils",
        Gifts: "fa-gift",
        Travel: "fa-mountain",
        Habits: "fa-brain",
        Allergies: "fa-shield-virus",
        Other: "fa-ellipsis"
      };
      const catIcon = categoryIconMap[pref.category] || "fa-bookmark";

      let p1Name = "Creator";
      let p2Name = "Partner";
      if (localSpaceData) {
        p1Name = localSpaceData.partner1Name || "Creator";
        p2Name = localSpaceData.partner2Name || "Partner";
      } else {
        const sandboxProfile = JSON.parse(localStorage.getItem("hb_sandbox_profile"));
        if (sandboxProfile) {
          p1Name = sandboxProfile.partner1Name || "Creator";
          p2Name = sandboxProfile.partner2Name || "Partner";
        }
      }

      const roleClass = pref.targetRole === "partner1" ? "creator" : "partner";
      const targetName = pref.targetRole === "partner1" ? p1Name : p2Name;
      const targetEmoji = pref.targetRole === "partner1" ? "👤" : "💖";

      card.innerHTML = `
        <div class="pref-card-header">
          <div class="pref-badge-row" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span class="category-badge ${pref.category.toLowerCase()}">
              <i class="fa-solid ${catIcon}"></i> ${pref.category}
            </span>
            <span class="target-role-badge ${roleClass}">
              ${targetEmoji} ${targetName}
            </span>
          </div>
          <div class="pref-actions">
            <button class="pref-action-btn edit" data-id="${pref.id}" title="Edit Detail">
              <i class="fa-solid fa-pencil"></i>
            </button>
            <button class="pref-action-btn delete" data-id="${pref.id}" title="Delete Detail">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
        <div class="pref-card-body">
          <h5>${pref.item}</h5>
          <p>${pref.notes ? pref.notes.replace(/\n/g, '<br>') : 'No extra details added.'}</p>
        </div>
      `;

      // Bind delete action
      card.querySelector(".delete").addEventListener("click", () => {
        if (confirm(`Delete this note: "${pref.item}"?`)) {
          db.deleteLoveHate(pref.id);
        }
      });

      // Bind edit action
      card.querySelector(".edit").addEventListener("click", () => {
        openEditPreference(pref);
      });

      grid.appendChild(card);
    });
  }
  
  // Refresh Nudge Prompt generator because preferences list has updated
  generateThoughtfulNudgeSpark();
}

function openEditPreference(pref) {
  document.getElementById("pref-id").value = pref.id;
  document.querySelector(`input[name="pref-type"][value="${pref.type}"]`).checked = true;
  document.getElementById("pref-item").value = pref.item;
  document.getElementById("pref-category").value = pref.category;
  document.getElementById("pref-notes").value = pref.notes || "";
  
  populateTargetOptions("pref-target", pref.targetRole || "partner2");

  document.getElementById("pref-modal-title").innerText = "Edit Preference Detail";
  document.getElementById("modal-preference").classList.remove("hidden");
}

// --- THOUGHTFUL NUDGE SPARK GENERATOR ---
function generateThoughtfulNudgeSpark() {
  const sparkTextEl = document.getElementById("spark-text");
  
  // Filter Loves items
  const loves = localLovesHates.filter(item => item.type === "love");
  
  if (loves.length > 0) {
    const randomLove = loves[Math.floor(Math.random() * loves.length)];
    
    // Choose dynamic template
    const templates = [
      `Since you noted they love <strong>"${randomLove.item}"</strong>, maybe surprise them with it this week? It's the little gestures that count. 🥰`,
      `Remember that they love <strong>"${randomLove.item}"</strong>. Write a quick text letting them know you're thinking about them! 💖`,
      `Feeling thoughtful? Plan an evening built around <strong>"${randomLove.item}"</strong> (which you noted they love!). 🌹`,
      `Small alert: Surprise them with <strong>"${randomLove.item}"</strong> tonight just to make them smile. ✨`
    ];
    
    sparkTextEl.innerHTML = templates[Math.floor(Math.random() * templates.length)];
  } else {
    // If empty preference list, read from fallbacks
    const randomSpark = GENERAL_SPARKS[Math.floor(Math.random() * GENERAL_SPARKS.length)];
    sparkTextEl.innerText = randomSpark;
  }
}

// (Thoughtful spark click handler moved inside initSettingsAndForms with defensive guards)

// --- MEMORY LANE JOURNAL TIMELINE ---

// Initialize beautiful visual preset selectors
function initPresetCovers() {
  const container = document.getElementById("cover-presets");
  container.innerHTML = "";
  
  PRESET_COVERS.forEach((url, index) => {
    const preset = document.createElement("div");
    preset.className = "preset-cover-option";
    preset.style.backgroundImage = `url(${url})`;
    if (index === 0) {
      preset.classList.add("selected");
      activeMemoryCoverUrl = url;
    }
    
    preset.addEventListener("click", () => {
      document.querySelectorAll(".preset-cover-option").forEach(p => p.classList.remove("selected"));
      preset.classList.add("selected");
      activeMemoryCoverUrl = url;
      document.getElementById("memory-cover-url").value = ""; // Clear custom input
    });
    
    container.appendChild(preset);
  });
}

// Render Memories Timeline
function renderMemories() {
  const container = document.getElementById("timeline-container");
  const emptyState = document.getElementById("timeline-empty-state");
  container.innerHTML = "";

  if (localMemories.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
    
    localMemories.forEach(memory => {
      const item = document.createElement("div");
      item.className = "timeline-item";
      
      const cover = memory.coverUrl || activeMemoryCoverUrl;
      const memoryDate = parseLocalDate(memory.date);
      const formattedDate = !isNaN(memoryDate.getTime()) 
        ? memoryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : "Unknown Date";

      item.innerHTML = `
        <div class="timeline-node"></div>
        <div class="timeline-content-wrapper">
          <div class="glass-card timeline-card">
            <div class="memory-cover-wrapper" style="background-image: url('${cover}')">
              <div class="memory-cover-overlay"></div>
              <span class="memory-feeling-tag">${memory.feeling || '🥰'}</span>
              <span class="memory-date">${formattedDate}</span>
            </div>
            <div class="memory-text-content">
              <h4>${memory.title || "Untitled Memory"}</h4>
              <p>${(memory.description || "").replace(/\n/g, '<br>')}</p>
              <div class="memory-footer">
                <button class="btn-love-memory" data-id="${memory.id}">
                  <i class="fa-solid fa-heart"></i> Shower with Love (<span class="hearts-cnt">${memory.heartsCount || 0}</span>)
                </button>
                <button class="memory-delete-btn" data-id="${memory.id}" title="Delete Memory">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;

      // Memory delete
      item.querySelector(".memory-delete-btn").addEventListener("click", () => {
        if (confirm(`Are you sure you want to delete the memory: "${memory.title}"?`)) {
          db.deleteMemory(memory.id);
        }
      });

      // Shower with Love floating hearts particles trigger
      const loveBtn = item.querySelector(".btn-love-memory");
      loveBtn.addEventListener("click", (e) => {
        db.incrementMemoryHearts(memory.id);
        
        // Trigger particle burst animation!
        triggerFloatingHeartsBurst(e.clientX, e.clientY);
      });

      container.appendChild(item);
    });
  }
}

// Particle heart burst generator
function triggerFloatingHeartsBurst(startX, startY) {
  const heartIcons = ["❤️", "💖", "💕", "💘", "💝", "🌸"];
  const burstCount = 12;

  for (let i = 0; i < burstCount; i++) {
    const heart = document.createElement("div");
    heart.className = "shower-heart";
    heart.innerText = heartIcons[Math.floor(Math.random() * heartIcons.length)];
    
    // Position exactly at click coordinates
    heart.style.left = `${startX}px`;
    heart.style.top = `${startY}px`;
    
    // Random directions
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 90;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance - 80; // Rise upwards
    
    heart.style.setProperty("--tx", `${tx}px`);
    heart.style.setProperty("--ty", `${ty}px`);
    heart.style.animationDelay = `${Math.random() * 0.15}s`;
    
    document.body.appendChild(heart);
    
    // Clean up
    setTimeout(() => {
      heart.remove();
    }, 1200);
  }
}

// --- ADVENTURES & TRIP PLANNER ---

function renderEvents() {
  const cList = document.getElementById("celebrations-list");
  const cEmpty = document.getElementById("celebrations-empty");
  const tList = document.getElementById("trips-list");
  const tEmpty = document.getElementById("trips-empty");

  // Null guard — DOM elements may not exist if page is mid-load
  if (!cList || !tList) {
    console.warn("renderEvents: list containers not found in DOM yet, skipping render.");
    return;
  }

  cList.innerHTML = "";
  tList.innerHTML = "";

  // Case-insensitive type detection — handles "trip", "Trip", "TRIP", "adventure" etc.
  // Everything that isn't a "trip" variant falls into celebrations/milestones.
  const isTrip = (e) => {
    const t = (e.type || "").toLowerCase().trim();
    return t === "trip" || t === "adventure" || t === "travel";
  };
  const celebrations = localEvents.filter(e => !isTrip(e));
  const trips = localEvents.filter(e => isTrip(e));

  console.log(`renderEvents: ${localEvents.length} total | ${celebrations.length} celebrations | ${trips.length} trips`);

  // Toggle empty states
  if (!cEmpty || !tEmpty) {
    console.warn("renderEvents: empty-state elements not found in DOM.");
  } else {
    if (celebrations.length === 0) cEmpty.classList.remove("hidden");
    else cEmpty.classList.add("hidden");

    if (trips.length === 0) tEmpty.classList.remove("hidden");
    else tEmpty.classList.add("hidden");
  }

  // Render celebrations
  celebrations.forEach(cel => {
    const card = document.createElement("div");
    card.className = "adventure-card celebration-card";
    
    const rawDate = cel.date || cel.Date || "";
    const celDate = parseLocalDate(rawDate);
    const formattedDate = !isNaN(celDate.getTime())
      ? celDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : "Unknown Date";

    const displayTitle = cel.title || cel.Title || cel.name || cel.Name || "Unnamed Celebration";
    const displayNotes = cel.notes || cel.Notes || cel.description || cel.Description || "No description notes.";

    const progress = calculateChecklistProgress(cel.checklist);

    let p1Name = "Creator";
    let p2Name = "Partner";
    if (localSpaceData) {
      p1Name = localSpaceData.partner1Name || "Creator";
      p2Name = localSpaceData.partner2Name || "Partner";
    } else {
      const sandboxProfile = JSON.parse(localStorage.getItem("hb_sandbox_profile"));
      if (sandboxProfile) {
        p1Name = sandboxProfile.partner1Name || "Creator";
        p2Name = sandboxProfile.partner2Name || "Partner";
      }
    }

    const roleClass = cel.targetRole === "partner1" ? "creator" : "partner";
    const targetName = cel.targetRole === "partner1" ? p1Name : p2Name;
    const targetEmoji = cel.targetRole === "partner1" ? "👤" : "💖";

    card.innerHTML = `
      <div class="adventure-card-header">
        <div class="adv-title-box">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
            <h4 style="margin: 0;">${displayTitle}</h4>
            <span class="target-role-badge ${roleClass}">
              ${targetEmoji} ${targetName}
            </span>
          </div>
          <p><i class="fa-solid fa-cake-candles"></i> ${formattedDate}</p>
        </div>
        <div class="adv-action-row">
          <button class="adv-delete-btn" data-id="${cel.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <p class="adv-desc">${displayNotes}</p>
      <div class="checklist-wrapper">
        <div class="checklist-title">
          <span>Preparation / Gifts List</span>
          <span class="progress-txt">${progress}% Done</span>
        </div>
        <div class="checklist-progress-bar">
          <div class="checklist-progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="checklist-items" id="checklist-items-${cel.id}">
          <!-- List loaded by JS -->
        </div>
        <form class="checklist-add-input-row" data-id="${cel.id}">
          <input type="text" placeholder="Add preparation step or gift idea..." required>
          <button type="submit">Add</button>
        </form>
      </div>
    `;

    cList.appendChild(card);
    renderChecklistItems(cel, `checklist-items-${cel.id}`);

    // Checklist add step submit event
    card.querySelector(".checklist-add-input-row").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const text = input.value.trim();
      if (text) {
        const list = safeParseChecklist(cel.checklist);
        list.push({ text: text, done: false });
        db.updateEventChecklist(cel.id, list);
        input.value = "";
      }
    });

    card.querySelector(".adv-delete-btn").addEventListener("click", () => {
      if (confirm(`Remove this celebration: "${cel.title}"?`)) {
        db.deleteEvent(cel.id);
      }
    });
  });

  // Render trips
  trips.forEach(trip => {
    const card = document.createElement("div");
    card.className = "adventure-card trip-card";
    
    const rawDate = trip.date || trip.Date || "";
    const tripDate = parseLocalDate(rawDate);
    const formattedDate = !isNaN(tripDate.getTime())
      ? tripDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : "Unknown Date";

    const displayTitle = trip.title || trip.Title || trip.name || trip.Name || "Unnamed Trip";
    const displayNotes = trip.notes || trip.Notes || trip.description || trip.Description || "No trip descriptions.";

    const progress = calculateChecklistProgress(trip.checklist);

    card.innerHTML = `
      <div class="adventure-card-header">
        <div class="adv-title-box">
          <h4>Trip to ${displayTitle}</h4>
          <p><i class="fa-solid fa-compass"></i> Departure: ${formattedDate}</p>
        </div>
        <div class="adv-action-row">
          <button class="adv-delete-btn" data-id="${trip.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <p class="adv-desc">${displayNotes}</p>
      <div class="checklist-wrapper">
        <div class="checklist-title">
          <span>Itinerary & Packing List</span>
          <span class="progress-txt">${progress}% Packed</span>
        </div>
        <div class="checklist-progress-bar">
          <div class="checklist-progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="checklist-items" id="checklist-items-${trip.id}">
          <!-- List loaded by JS -->
        </div>
        <form class="checklist-add-input-row" data-id="${trip.id}">
          <input type="text" placeholder="Add packing item or booking detail..." required>
          <button type="submit">Add</button>
        </form>
      </div>
    `;

    tList.appendChild(card);
    renderChecklistItems(trip, `checklist-items-${trip.id}`);

    // Checklist add step submit event
    card.querySelector(".checklist-add-input-row").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const text = input.value.trim();
      if (text) {
        const list = safeParseChecklist(trip.checklist);
        list.push({ text: text, done: false });
        db.updateEventChecklist(trip.id, list);
        input.value = "";
      }
    });

    card.querySelector(".adv-delete-btn").addEventListener("click", () => {
      if (confirm(`Cancel this trip: "${trip.title}"?`)) {
        db.deleteEvent(trip.id);
      }
    });
  });
}

function calculateChecklistProgress(list) {
  const parsedList = safeParseChecklist(list);
  if (parsedList.length === 0) return 0;
  const doneCount = parsedList.filter(item => item.done).length;
  return Math.round((doneCount / parsedList.length) * 100);
}

function renderChecklistItems(evt, elementId) {
  const container = document.getElementById(elementId);
  container.innerHTML = "";

  const list = safeParseChecklist(evt.checklist);

  list.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = `checklist-item ${item.done ? 'done' : ''}`;
    row.innerHTML = `
      <input type="checkbox" ${item.done ? 'checked' : ''}>
      <span>${item.text}</span>
    `;

    // Toggle check checkbox state
    row.querySelector("input").addEventListener("change", (e) => {
      list[index].done = e.target.checked;
      db.updateEventChecklist(evt.id, list);
    });

    container.appendChild(row);
  });
}

// --- SETUP MODAL CONTROLS & SUBMIT HANDLERS ---

function initSettingsAndForms() {
  // Modal Overlays
  const onboardingModal = document.getElementById("modal-onboarding");
  const cloudModal = document.getElementById("modal-cloud-sync");
  const prefModal = document.getElementById("modal-preference");
  const memoryModal = document.getElementById("modal-memory");
  const celModal = document.getElementById("modal-celebration");
  const tripModal = document.getElementById("modal-trip");
  const settingsModal = document.getElementById("modal-settings");

  // Set tab category filter badges click handlers
  const badges = document.querySelectorAll(".filter-badge");
  if (badges && badges.length > 0) {
    badges.forEach(badge => {
      badge.addEventListener("click", () => {
        badges.forEach(b => b.classList.remove("active"));
        badge.classList.add("active");
        activeCategoryFilter = badge.getAttribute("data-category");
        renderLovesHates();
      });
    });
  }

  // Switch Love / Hate ledger types
  const tabLoves = document.getElementById("tab-loves");
  if (tabLoves) {
    tabLoves.addEventListener("click", () => {
      tabLoves.classList.add("active");
      const tabHates = document.getElementById("tab-hates");
      if (tabHates) tabHates.classList.remove("active");
      activeTabType = "love";
      renderLovesHates();
    });
  }

  const tabHates = document.getElementById("tab-hates");
  if (tabHates) {
    tabHates.addEventListener("click", () => {
      const tabLoves = document.getElementById("tab-loves");
      if (tabLoves) tabLoves.classList.remove("active");
      tabHates.classList.add("active");
      activeTabType = "hate";
      renderLovesHates();
    });
  }

  // Search preferences ledger input
  const prefSearch = document.getElementById("pref-search");
  if (prefSearch) {
    prefSearch.addEventListener("input", (e) => {
      renderLovesHates(e.target.value.toLowerCase());
    });
  }

  // Thoughtful Spark Next Idea Button
  const btnNextSpark = document.getElementById("btn-next-spark");
  if (btnNextSpark) {
    btnNextSpark.addEventListener("click", generateThoughtfulNudgeSpark);
  }

  // Onboarding Tab Switches (New Space vs Join Partner)
  const btnTabNewSpace = document.getElementById("btn-tab-new-space");
  const btnTabJoinSpace = document.getElementById("btn-tab-join-space");
  const formOnboarding = document.getElementById("form-onboarding");
  const panelJoinSpace = document.getElementById("panel-join-space");

  if (btnTabNewSpace && btnTabJoinSpace) {
    btnTabNewSpace.addEventListener("click", () => {
      btnTabNewSpace.classList.add("active");
      btnTabNewSpace.style.background = "rgba(255, 255, 255, 0.15)";
      btnTabNewSpace.style.borderColor = "rgba(255, 255, 255, 0.25)";
      btnTabNewSpace.style.color = "#fff";
      
      btnTabJoinSpace.classList.remove("active");
      btnTabJoinSpace.style.background = "rgba(255, 255, 255, 0.05)";
      btnTabJoinSpace.style.borderColor = "rgba(255, 255, 255, 0.1)";
      btnTabJoinSpace.style.color = "rgba(255, 255, 255, 0.6)";

      if (formOnboarding) formOnboarding.classList.remove("hidden");
      if (panelJoinSpace) panelJoinSpace.classList.add("hidden");
    });

    btnTabJoinSpace.addEventListener("click", () => {
      btnTabJoinSpace.classList.add("active");
      btnTabJoinSpace.style.background = "rgba(255, 255, 255, 0.15)";
      btnTabJoinSpace.style.borderColor = "rgba(255, 255, 255, 0.25)";
      btnTabJoinSpace.style.color = "#fff";
      
      btnTabNewSpace.classList.remove("active");
      btnTabNewSpace.style.background = "rgba(255, 255, 255, 0.05)";
      btnTabNewSpace.style.borderColor = "rgba(255, 255, 255, 0.1)";
      btnTabNewSpace.style.color = "rgba(255, 255, 255, 0.6)";

      if (formOnboarding) formOnboarding.classList.add("hidden");
      if (panelJoinSpace) panelJoinSpace.classList.remove("hidden");
    });
  }

  // Paste Love Sync Code Form Submit
  const formJoinInvite = document.getElementById("form-join-invite");
  if (formJoinInvite) {
    formJoinInvite.addEventListener("submit", async (e) => {
      e.preventDefault();
      const codeInput = document.getElementById("onboard-invite-code");
      const code = codeInput ? codeInput.value.trim() : "";
      
      // ── Admin portal secret key detection ──
      const adminKey = localStorage.getItem("hb_admin_key") || "hb-admin";
      if (code === adminKey) {
        window.location.href = "admin.html";
        return;
      }

      if (code) {
        const success = db.bootstrapFromInviteCode(code);
        if (success) {
          await handleInviteRouting();
        } else {
          alert("Failed to connect using that Love Sync Code. Please verify the code string!");
        }
      }
    });
  }

  // Simplified Partner welcome details submit
  const formPartnerSetup = document.getElementById("form-partner-setup");
  if (formPartnerSetup) {
    formPartnerSetup.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("partner-setup-name");
      const avatarInput = document.getElementById("partner-setup-avatar");
      const name = nameInput ? nameInput.value.trim() : "";
      const avatar = avatarInput ? avatarInput.value.trim() : "";
      
      if (name && avatar) {
        try {
          await db.updatePartnerDetails(name, avatar);
          if (onboardingModal) onboardingModal.classList.add("hidden");
          setupRealtimeSubscriptions();
        } catch (err) {
          console.error("Partner details update failure:", err);
          alert("Could not update space details. Logging you in anyway...");
          if (onboardingModal) onboardingModal.classList.add("hidden");
          setupRealtimeSubscriptions();
        }
      }
    });
  }

  const toggleDbInputs = (provider) => {
    const fbInputs = document.getElementById("firebase-inputs");
    const sbInputs = document.getElementById("supabase-inputs");
    if (provider === "supabase") {
      if (fbInputs) fbInputs.classList.add("hidden");
      if (sbInputs) sbInputs.classList.remove("hidden");
    } else {
      if (fbInputs) fbInputs.classList.remove("hidden");
      if (sbInputs) sbInputs.classList.add("hidden");
    }
  };

  const dbProvider = document.getElementById("db-provider");
  if (dbProvider) {
    dbProvider.addEventListener("change", (e) => {
      toggleDbInputs(e.target.value);
    });
  }

  const openSyncModal = () => {
    const providerSelect = document.getElementById("db-provider");
    const cloudConfigForm = document.getElementById("form-cloud-config");
    const defaultDbBanner = document.getElementById("default-db-status");
    const customDbAllowed = !db.platformConfig || db.platformConfig.allowCustomDb !== false;
    
    // Determine if using default platform DB or sandbox (checking projectId)
    const isUsingDefaultDb = db.dbConfig && (
      db.dbConfig.projectId === "heartbound-fb84e" || 
      db.dbConfig.projectId === "heartbound-dev" || 
      !db.dbConfig.projectId
    );

    if (db.dbConfig && !isUsingDefaultDb) {
      // ONLY populate fields if it's a true custom DB
      const provider = db.dbConfig.provider || "firebase";
      if (providerSelect) providerSelect.value = provider;
      toggleDbInputs(provider);
      
      if (provider === "firebase") {
        const apiKey = document.getElementById("db-apikey");
        const projectId = document.getElementById("db-projectid");
        const appId = document.getElementById("db-appid");
        if (apiKey) apiKey.value = db.dbConfig.apiKey || "";
        if (projectId) projectId.value = db.dbConfig.projectId || "";
        if (appId) appId.value = db.dbConfig.appId || "";
      } else if (provider === "supabase") {
        const sbUrl = document.getElementById("db-supabase-url");
        const sbKey = document.getElementById("db-supabase-key");
        if (sbUrl) sbUrl.value = db.dbConfig.supabaseUrl || "";
        if (sbKey) sbKey.value = db.dbConfig.supabaseKey || "";
      }
    } else {
      // Clear fields for default / sandbox
      if (providerSelect) providerSelect.value = "firebase";
      toggleDbInputs("firebase");
      const apiKey = document.getElementById("db-apikey");
      const projectId = document.getElementById("db-projectid");
      const appId = document.getElementById("db-appid");
      if (apiKey) apiKey.value = "";
      if (projectId) projectId.value = "";
      if (appId) appId.value = "";
    }
    
    // Dynamically update copy buttons labels based on the active session role
    const role = localStorage.getItem("hb_user_role") || "partner1";
    const btnCopyInvite = document.getElementById("btn-copy-invite-code");
    const btnCopyCreator = document.getElementById("btn-copy-creator-code");
    
    if (btnCopyInvite) {
      if (role === "partner2") {
        btnCopyInvite.innerHTML = `<i class="fa-solid fa-key"></i> Copy Partner 2 (Your) Recovery Code`;
      } else {
        btnCopyInvite.innerHTML = `<i class="fa-solid fa-key"></i> Copy Partner Sync Code (For SO)`;
      }
    }
    if (btnCopyCreator) {
      if (role === "partner2") {
        btnCopyCreator.innerHTML = `<i class="fa-solid fa-user-shield"></i> Copy Creator Sync Code (For SO)`;
      } else {
        btnCopyCreator.innerHTML = `<i class="fa-solid fa-user-shield"></i> Copy Creator Recovery Code`;
      }
    }

    if (cloudConfigForm) {
      if (!customDbAllowed) {
        cloudConfigForm.style.display = "none";
      } else if (isUsingDefaultDb) {
        cloudConfigForm.classList.add("hidden");
        if (defaultDbBanner) defaultDbBanner.classList.remove("hidden");
      } else {
        cloudConfigForm.classList.remove("hidden");
        if (defaultDbBanner) defaultDbBanner.classList.add("hidden");
      }
    }
    
    // Wire up the button to show the custom form manually
    const btnShowCustom = document.getElementById("btn-show-custom-db");
    if (btnShowCustom) {
      btnShowCustom.onclick = () => {
        if (defaultDbBanner) defaultDbBanner.classList.add("hidden");
        if (cloudConfigForm) {
          cloudConfigForm.classList.remove("hidden");
        }
      };
    }

    if (cloudModal) cloudModal.classList.remove("hidden");
  };

  const btnOpenSync = document.getElementById("btn-open-sync");
  if (btnOpenSync) {
    btnOpenSync.addEventListener("click", openSyncModal);
  }
  
  const btnOpenSyncMobile = document.getElementById("btn-open-sync-mobile");
  if (btnOpenSyncMobile) {
    btnOpenSyncMobile.addEventListener("click", openSyncModal);
  }

  const btnQuickSettings = document.getElementById("btn-quick-settings");
  if (btnQuickSettings) {
    btnQuickSettings.addEventListener("click", () => {
      if (localSpaceData) {
        const role = localStorage.getItem("hb_user_role") || "partner1";
        const userNameInput = document.getElementById("settings-user-name");
        const userAvatarInput = document.getElementById("settings-user-avatar");
        const partnerNameInput = document.getElementById("settings-partner-name");
        const partnerAvatarInput = document.getElementById("settings-partner-avatar");
        const anniversaryInput = document.getElementById("settings-anniversary");
        const userBirthdayInput = document.getElementById("settings-user-birthday");
        const partnerBirthdayInput = document.getElementById("settings-partner-birthday");

        if (role === "partner2") {
          if (userNameInput) userNameInput.value = localSpaceData.partner2Name || "";
          if (userAvatarInput) userAvatarInput.value = localSpaceData.partner2Avatar || "💖";
          if (partnerNameInput) partnerNameInput.value = localSpaceData.partner1Name || "";
          if (partnerAvatarInput) partnerAvatarInput.value = localSpaceData.partner1Avatar || "👤";
          if (userBirthdayInput) userBirthdayInput.value = localSpaceData.partner2Birthday || "";
          if (partnerBirthdayInput) partnerBirthdayInput.value = localSpaceData.partner1Birthday || "";
        } else {
          if (userNameInput) userNameInput.value = localSpaceData.partner1Name || "";
          if (userAvatarInput) userAvatarInput.value = localSpaceData.partner1Avatar || "👤";
          if (partnerNameInput) partnerNameInput.value = localSpaceData.partner2Name || "";
          if (partnerAvatarInput) partnerAvatarInput.value = localSpaceData.partner2Avatar || "💖";
          if (userBirthdayInput) userBirthdayInput.value = localSpaceData.partner1Birthday || "";
          if (partnerBirthdayInput) partnerBirthdayInput.value = localSpaceData.partner2Birthday || "";
        }
        if (anniversaryInput) anniversaryInput.value = localSpaceData.anniversaryDate || "";
      }
      if (settingsModal) settingsModal.classList.remove("hidden");
    });
  }

  const btnAddPreference = document.getElementById("btn-add-preference");
  if (btnAddPreference) {
    btnAddPreference.addEventListener("click", () => {
      const formPref = document.getElementById("form-preference");
      const prefId = document.getElementById("pref-id");
      const prefTitle = document.getElementById("pref-modal-title");
      if (formPref) formPref.reset();
      if (prefId) prefId.value = "";
      if (prefTitle) prefTitle.innerText = "Add Loves/Hates Detail";
      
      populateTargetOptions("pref-target");

      if (prefModal) prefModal.classList.remove("hidden");
    });
  }

  const btnAddMemory = document.getElementById("btn-add-memory");
  if (btnAddMemory) {
    btnAddMemory.addEventListener("click", () => {
      const formMem = document.getElementById("form-memory");
      const memDate = document.getElementById("memory-date");
      if (formMem) formMem.reset();
      if (memDate) memDate.value = new Date().toISOString().split('T')[0];
      initPresetCovers();
      if (memoryModal) memoryModal.classList.remove("hidden");
    });
  }

  const btnAddCelebration = document.getElementById("btn-add-celebration");
  if (btnAddCelebration) {
    btnAddCelebration.addEventListener("click", () => {
      const formCel = document.getElementById("form-celebration");
      if (formCel) formCel.reset();

      populateTargetOptions("cel-target");

      if (celModal) celModal.classList.remove("hidden");
    });
  }

  const btnAddTrip = document.getElementById("btn-add-trip");
  if (btnAddTrip) {
    btnAddTrip.addEventListener("click", () => {
      const formT = document.getElementById("form-trip");
      if (formT) formT.reset();
      if (tripModal) tripModal.classList.remove("hidden");
    });
  }

  // Close buttons
  const btnCloseSync = document.getElementById("btn-close-sync");
  if (btnCloseSync) {
    btnCloseSync.addEventListener("click", () => {
      if (cloudModal) cloudModal.classList.add("hidden");
    });
  }

  const btnCloseSettings = document.getElementById("btn-close-settings");
  if (btnCloseSettings) {
    btnCloseSettings.addEventListener("click", () => {
      if (settingsModal) settingsModal.classList.add("hidden");
    });
  }

  // Generic close by data-attributes
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-close");
      const modals = {
        preference: prefModal,
        memory: memoryModal,
        celebration: celModal,
        trip: tripModal
      };
      if (modals[type]) modals[type].classList.add("hidden");
    });
  });

  // Close modals when clicking outside modal window content
  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) {
      // Don't close onboarding modal on outside click!
      if (e.target.id !== "modal-onboarding") {
        e.target.classList.add("hidden");
      }
    }
  });

  // --- SUBMIT EVENTS HANDLERS ---

  // 1. Onboarding Form Setup
  const formOnboardingSubmit = document.getElementById("form-onboarding");
  if (formOnboardingSubmit) {
    formOnboardingSubmit.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("[HB] Onboarding form submitted. isCloudMode:", db.isCloudMode(), "isPaired:", db.isPaired());
      try {
      
      localStorage.setItem("hb_user_role", "partner1"); // Onboarding user is the creator (partner1)
      
      const profile = {
        partner1Name: document.getElementById("onboard-user-name").value.trim(),
        partner1Avatar: document.getElementById("onboard-user-avatar").value.trim(),
        partner2Name: document.getElementById("onboard-partner-name").value.trim(),
        partner2Avatar: document.getElementById("onboard-partner-avatar").value.trim(),
        anniversaryDate: document.getElementById("onboard-anniversary").value,
        partner1Birthday: document.getElementById("onboard-user-birthday").value,
        partner2Birthday: document.getElementById("onboard-partner-birthday").value
      };

      if (onboardingModal) onboardingModal.classList.add("hidden");
      
      if (db.isCloudMode() && !db.isPaired()) {
        console.log("[HB] Cloud mode: creating cloud space...");
        try {
          const generatedId = await db.createCloudSpace(profile);
          console.log("[HB] Cloud space created with ID:", generatedId);
          // Note: createCloudSpace internally calls saveSpaceId -> triggerStatusChange -> handleConnectionStatusChange("paired")
          // so we do NOT call handleConnectionStatusChange again here to avoid duplicate listener setup
        } catch (err) {
          console.error("[HB] Failed to create cloud space:", err);
          alert("Failed to initialize cloud space (" + err.message + "). Saving locally instead.");
          // Fallback: save locally and proceed
          localStorage.setItem("hb_sandbox_profile", JSON.stringify(profile));
          setupRealtimeSubscriptions();
        }
      } else {
        console.log("[HB] Sandbox mode: saving profile locally and starting subscriptions.");
        // Local setup
        localStorage.setItem("hb_sandbox_profile", JSON.stringify(profile));
        setupRealtimeSubscriptions();
      }
      } catch (err) {
        console.error("Fatal error during onboarding submission:", err);
        alert("An error occurred during onboarding: " + err.message);
      }
    });
  }

  // 2. Settings Profile Update
  const formSettingsSubmit = document.getElementById("form-settings");
  if (formSettingsSubmit) {
    formSettingsSubmit.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const role = localStorage.getItem("hb_user_role") || "partner1";
      const uBday = document.getElementById("settings-user-birthday").value;
      const pBday = document.getElementById("settings-partner-birthday").value;

      const profile = {
        userName: document.getElementById("settings-user-name").value.trim(),
        userAvatar: document.getElementById("settings-user-avatar").value.trim(),
        partnerName: document.getElementById("settings-partner-name").value.trim(),
        partnerAvatar: document.getElementById("settings-partner-avatar").value.trim(),
        anniversaryDate: document.getElementById("settings-anniversary").value,
        partner1Birthday: role === "partner2" ? pBday : uBday,
        partner2Birthday: role === "partner2" ? uBday : pBday
      };

      await db.updateSpaceInfo(profile);
      if (settingsModal) settingsModal.classList.add("hidden");
      // Safety-net: delayed full re-fetch in case primary refresh was missed
      setTimeout(() => db.forceRefreshAll(), 400);
    });
  }

  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      if (confirm("Are you sure you want to log out from this space? You will need your Sync Code to rejoin.")) {
        performLogout();
      }
    });
  }

  // 3. Add/Edit Preference
  const formPreferenceSubmit = document.getElementById("form-preference");
  if (formPreferenceSubmit) {
    formPreferenceSubmit.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("pref-id").value;
      const targetEl = document.getElementById("pref-target");
      const payload = {
        type: document.querySelector('input[name="pref-type"]:checked').value,
        item: document.getElementById("pref-item").value.trim(),
        category: document.getElementById("pref-category").value,
        notes: document.getElementById("pref-notes").value.trim(),
        targetRole: targetEl ? targetEl.value : "partner2"
      };

      if (id) {
        // Edit exists
        await db.deleteLoveHate(id); // Simple overwrite delete & add strategy
      }
      await db.addLoveHate(payload);
      
      if (prefModal) prefModal.classList.add("hidden");
      // Safety-net: delayed full re-fetch in case primary refresh was missed
      setTimeout(() => db.forceRefreshAll(), 400);
    });
  }

  // 4. Memory Submission
  const formMemorySubmit = document.getElementById("form-memory");
  if (formMemorySubmit) {
    formMemorySubmit.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const customUrl = document.getElementById("memory-cover-url").value.trim();
      const payload = {
        title: document.getElementById("memory-title").value.trim(),
        date: document.getElementById("memory-date").value,
        feeling: document.getElementById("memory-feeling").value.trim() || "🥰",
        description: document.getElementById("memory-description").value.trim(),
        coverUrl: customUrl || activeMemoryCoverUrl
      };

      await db.addMemory(payload);
      if (memoryModal) memoryModal.classList.add("hidden");
      // Safety-net: delayed full re-fetch in case primary refresh was missed
      setTimeout(() => db.forceRefreshAll(), 400);
    });
  }

  // 5. Add Celebration Birthday event
  const formCelebrationSubmit = document.getElementById("form-celebration");
  if (formCelebrationSubmit) {
    formCelebrationSubmit.addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetEl = document.getElementById("cel-target");
      const payload = {
        type: "birthday",
        title: document.getElementById("cel-title").value.trim(),
        date: document.getElementById("cel-date").value,
        notes: document.getElementById("cel-notes").value.trim(),
        targetRole: targetEl ? targetEl.value : "partner2",
        checklist: []
      };

      await db.addEvent(payload);
      if (celModal) celModal.classList.add("hidden");
      // Safety-net: delayed full re-fetch in case primary refresh was missed
      setTimeout(() => db.forceRefreshAll(), 400);
    });
  }

  // 6. Add Trip Adventure event
  const formTripSubmit = document.getElementById("form-trip");
  if (formTripSubmit) {
    formTripSubmit.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        type: "trip",
        title: document.getElementById("trip-title").value.trim(),
        date: document.getElementById("trip-date").value,
        notes: document.getElementById("trip-notes").value.trim(),
        checklist: []
      };

      await db.addEvent(payload);
      if (tripModal) tripModal.classList.add("hidden");
      // Safety-net: delayed full re-fetch in case primary refresh was missed
      setTimeout(() => db.forceRefreshAll(), 400);
    });
  }

  // 7. Connect Database Config Credentials
  const formCloudConfigSubmit = document.getElementById("form-cloud-config");
  if (formCloudConfigSubmit) {
    formCloudConfigSubmit.addEventListener("submit", (e) => {
      e.preventDefault();
      const providerSelect = document.getElementById("db-provider");
      const provider = providerSelect ? providerSelect.value : "firebase";
      let config = { provider: provider };
      
      if (provider === "firebase") {
        const apiKey = document.getElementById("db-apikey").value.trim();
        const projectId = document.getElementById("db-projectid").value.trim();
        const appId = document.getElementById("db-appid").value.trim();
        
        if (!apiKey || !projectId || !appId) {
          alert("Please fill in all Firebase credentials fields!");
          return;
        }
        config.apiKey = apiKey;
        config.projectId = projectId;
        config.appId = appId;
      } else if (provider === "supabase") {
        const supabaseUrl = document.getElementById("db-supabase-url").value.trim();
        const supabaseKey = document.getElementById("db-supabase-key").value.trim();
        
        if (!supabaseUrl || !supabaseKey) {
          alert("Please fill in all Supabase URL and Anon Key fields!");
          return;
        }
        config.supabaseUrl = supabaseUrl;
        config.supabaseKey = supabaseKey;
      }
      
      db.saveDbConfig(config);
    });
  }

  // Clear Database config / Reset to Local Sandbox
  const btnClearDbConfig = document.getElementById("btn-clear-db-config");
  if (btnClearDbConfig) {
    btnClearDbConfig.addEventListener("click", () => {
      if (confirm("Disconnect and clear cloud database credentials? Heartbound will return to Offline Local Sandbox.")) {
        db.clearDbConfig();
        const formCloudConfigReset = document.getElementById("form-cloud-config");
        if (formCloudConfigReset) formCloudConfigReset.reset();
        if (cloudModal) cloudModal.classList.add("hidden");
      }
    });
  }

  // Copy Love space Pairing code (Safely guarded, though not used in index.html)
  const btnCopyCode = document.getElementById("btn-copy-code");
  if (btnCopyCode) {
    btnCopyCode.addEventListener("click", () => {
      const displaySpaceCode = document.getElementById("display-space-code");
      const code = displaySpaceCode ? displaySpaceCode.innerText : "";
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          btnCopyCode.innerHTML = `<i class="fa-solid fa-circle-check"></i> Copied!`;
          setTimeout(() => {
            btnCopyCode.innerHTML = `<i class="fa-solid fa-copy"></i> Copy`;
          }, 2000);
        });
      }
    });
  }

  // Copy invite share link
  const btnCopyInviteLink = document.getElementById("btn-copy-invite-link");
  if (btnCopyInviteLink) {
    btnCopyInviteLink.addEventListener("click", () => {
      const token = db.generateInviteCode();
      if (token) {
        const shareLink = window.location.origin + window.location.pathname + "?invite=" + token;
        navigator.clipboard.writeText(shareLink).then(() => {
          btnCopyInviteLink.innerHTML = `<i class="fa-solid fa-circle-check"></i> Link Copied!`;
          setTimeout(() => {
            btnCopyInviteLink.innerHTML = `<i class="fa-solid fa-share-nodes"></i> Copy Invite Link`;
          }, 2000);
        });
      }
    });
  }

  // Copy raw partner invite code
  const btnCopyInviteCode = document.getElementById("btn-copy-invite-code");
  if (btnCopyInviteCode) {
    btnCopyInviteCode.addEventListener("click", () => {
      const token = db.generateInviteCode("partner2");
      if (token) {
        navigator.clipboard.writeText(token);
        const icon = btnCopyInviteCode.querySelector("i");
        if (icon) {
          icon.className = "fa-solid fa-check";
          setTimeout(() => icon.className = "fa-solid fa-key", 2000);
        }
      }
    });
  }

  // Copy raw creator recovery code
  const btnCopyCreatorCode = document.getElementById("btn-copy-creator-code");
  if (btnCopyCreatorCode) {
    btnCopyCreatorCode.addEventListener("click", () => {
      const token = db.generateInviteCode("partner1");
      if (token) {
        navigator.clipboard.writeText(token);
        const icon = btnCopyCreatorCode.querySelector("i");
        if (icon) {
          icon.className = "fa-solid fa-check";
          setTimeout(() => icon.className = "fa-solid fa-user-shield", 2000);
        }
      }
    });
  }

  // Pair existing Space ID code
  const formPairSpace = document.getElementById("form-pair-space");
  if (formPairSpace) {
    formPairSpace.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pairCodeInput = document.getElementById("input-pair-code");
      const code = pairCodeInput ? pairCodeInput.value.trim() : "";
      if (code) {
        const success = await db.pairExistingCloudSpace(code);
        if (success) {
          if (pairCodeInput) pairCodeInput.value = "";
          if (cloudModal) cloudModal.classList.add("hidden");
        }
      }
    });
  }
}

// --- FLOATING BACKGROUND DECORATIVE AESTHETICS ---

function setupAestheticBackgroundHearts() {
  const container = document.getElementById("heart-particles");
  if (!container) return;

  const heartEmojis = ["❤️", "💖", "💕", "🌸", "✨"];
  
  function spawnHeart() {
    const heart = document.createElement("div");
    heart.className = "bg-heart";
    heart.innerText = heartEmojis[Math.floor(Math.random() * heartEmojis.length)];
    
    // Spawn attributes randomly
    heart.style.left = `${Math.random() * 100}vw`;
    heart.style.fontSize = `${16 + Math.random() * 24}px`;
    
    const duration = 10 + Math.random() * 10; // 10s to 20s
    heart.style.animationDuration = `${duration}s`;
    
    container.appendChild(heart);
    
    // Garbage collector
    setTimeout(() => {
      heart.remove();
    }, duration * 1000);
  }

  // Initial populate
  for (let i = 0; i < 8; i++) {
    setTimeout(spawnHeart, Math.random() * 5000);
  }

  // Periodic spawn
  setInterval(spawnHeart, 2500);
}
