/* Heartbound Application Main Logic & UI Controller */

import { db } from "./database.js";

// --- GLOBAL VARIABLES & DATA STORE ---
let localSpaceData = null;
let localLovesHates = [];
let localMemories = [];
let localEvents = [];

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
  
  // Connect database logic
  db.initConnection(handleConnectionStatusChange);
});

// --- CONNECTION STATUS HANDLER ---
function handleConnectionStatusChange(status, spaceId) {
  const badge = document.getElementById("connection-badge");
  const badgeText = document.getElementById("connection-status-text");
  
  // Reset classes
  badge.className = "connection-badge";
  
  // Toggle pairing panel inputs depending on connection status
  const configForm = document.getElementById("form-cloud-config");
  const pairPanel = document.getElementById("pairing-panel");
  const displayCode = document.getElementById("display-space-code");
  const btnCopy = document.getElementById("btn-copy-code");
  const inputPairCode = document.getElementById("input-pair-code");
  const btnSubmitPair = document.getElementById("btn-submit-pair");

  if (status === "sandbox") {
    badge.classList.add("sandbox");
    badgeText.innerText = "Sandbox Mode";
    pairPanel.classList.add("disabled");
    displayCode.innerText = "--------";
    btnCopy.disabled = true;
    inputPairCode.disabled = true;
    btnSubmitPair.disabled = true;
    
    // Check if sandbox onboarding exists
    checkOnboarding(false);
  } else {
    // Cloud connection established
    pairPanel.classList.remove("disabled");
    inputPairCode.disabled = false;
    btnSubmitPair.disabled = false;

    if (status === "cloud_connected") {
      badge.classList.add("cloud");
      badgeText.innerText = "Cloud Connected (Not Paired)";
      displayCode.innerText = "Generating...";
      btnCopy.disabled = true;
      
      // Auto-create space document if none exists
      triggerAutoSpaceCreation();
    } else if (status === "paired") {
      badge.classList.add("paired");
      badgeText.innerText = `Paired: ${spaceId}`;
      displayCode.innerText = spaceId;
      btnCopy.disabled = false;
      
      // Setup Firestore Live Listeners
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

function checkOnboarding(isCloud = false) {
  const onboardingModal = document.getElementById("modal-onboarding");
  let hasProfile = false;

  if (isCloud) {
    hasProfile = db.isPaired();
  } else {
    hasProfile = !!localStorage.getItem("hb_sandbox_profile");
  }

  if (!hasProfile) {
    onboardingModal.classList.remove("hidden");
  } else {
    onboardingModal.classList.add("hidden");
    if (!isCloud) {
      setupRealtimeSubscriptions(); // Trigger local subscriptions
    }
  }
}

// Setup listeners (for either Firestore or LocalStorage changes)
function setupRealtimeSubscriptions() {
  // 1. Profile / Milestone info
  db.subscribeSpaceInfo((profile) => {
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
    });
  });
}

// --- UPDATE UI CORE COMPONENTS ---

// Profile Metadata
function updateProfileUI() {
  if (!localSpaceData) return;

  const userAvatar = localSpaceData.partner1Avatar || "👤";
  const partnerAvatar = localSpaceData.partner2Avatar || "💖";
  const userName = localSpaceData.partner1Name || "Alex";
  const partnerName = localSpaceData.partner2Name || "Taylor";
  
  // Left Nav Panel
  document.getElementById("nav-user-avatar").innerText = userAvatar;
  document.getElementById("nav-partner-avatar").innerText = partnerAvatar;
  document.getElementById("nav-couple-names").innerText = `${userName} & ${partnerName}`;
  
  // Hero Greeting
  document.getElementById("hero-greeting").innerText = `Hello, ${userName}`;
  document.getElementById("hero-partner-name").innerText = partnerName;

  // Days Together Ticker
  if (localSpaceData.anniversaryDate) {
    const anniversary = new Date(localSpaceData.anniversaryDate);
    const today = new Date();
    const diffTime = Math.abs(today - anniversary);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Animate the ticker count!
    animateTicker("dash-days-together", diffDays);
    document.getElementById("nav-days-badge").innerText = `${diffDays} Days Together`;
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
  let candidateEvents = [];

  // 1. Partner's Birthday
  if (localSpaceData.partnerBirthday) {
    const birthdayStr = localSpaceData.partnerBirthday;
    const [bYear, bMonth, bDay] = birthdayStr.split("-").map(Number);
    let nextBday = new Date(today.getFullYear(), bMonth - 1, bDay);
    
    if (nextBday < today) {
      nextBday.setFullYear(today.getFullYear() + 1);
    }
    candidateEvents.push({
      title: `${localSpaceData.partner2Name}'s Birthday 🎂`,
      date: nextBday,
      displayDate: nextBday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    });
  }

  // 2. Scheduled Trip or celebration events
  localEvents.forEach(evt => {
    const evtDate = new Date(evt.date);
    if (evtDate >= today) {
      candidateEvents.push({
        title: evt.type === "trip" ? `Trip to ${evt.title} ✈️` : `${evt.title} 🎈`,
        date: evtDate,
        displayDate: evtDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      });
    }
  });

  // Sort candidates to find closest
  if (candidateEvents.length > 0) {
    candidateEvents.sort((a,b) => a.date - b.date);
    const nextEvent = candidateEvents[0];
    
    const diffTime = Math.abs(nextEvent.date - today);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    countdownDaysEl.innerText = String(diffDays).padStart(2, '0');
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

// Set tab category filter badges click handlers
const badges = document.querySelectorAll(".filter-badge");
badges.forEach(badge => {
  badge.addEventListener("click", () => {
    badges.forEach(b => b.classList.remove("active"));
    badge.classList.add("active");
    activeCategoryFilter = badge.getAttribute("data-category");
    renderLovesHates();
  });
});

// Switch Love / Hate ledger types
document.getElementById("tab-loves").addEventListener("click", () => {
  document.getElementById("tab-loves").classList.add("active");
  document.getElementById("tab-hates").classList.remove("active");
  activeTabType = "love";
  renderLovesHates();
});

document.getElementById("tab-hates").addEventListener("click", () => {
  document.getElementById("tab-loves").classList.remove("active");
  document.getElementById("tab-hates").classList.add("active");
  activeTabType = "hate";
  renderLovesHates();
});

// Search preferences ledger input
document.getElementById("pref-search").addEventListener("input", (e) => {
  renderLovesHates(e.target.value.toLowerCase());
});

// Render ledger items grid
function renderLovesHates(searchQuery = "") {
  const grid = document.getElementById("preferences-grid");
  const emptyState = document.getElementById("pref-empty-state");
  grid.innerHTML = "";

  // Filter items
  const filtered = localLovesHates.filter(item => {
    const matchesType = item.type === activeTabType;
    const matchesCategory = activeCategoryFilter === "all" || item.category === activeCategoryFilter;
    const matchesSearch = !searchQuery || 
      item.item.toLowerCase().includes(searchQuery) || 
      (item.notes && item.notes.toLowerCase().includes(searchQuery));
    
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

      card.innerHTML = `
        <div class="pref-card-header">
          <div class="pref-badge-row">
            <span class="category-badge ${pref.category.toLowerCase()}">
              <i class="fa-solid ${catIcon}"></i> ${pref.category}
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

document.getElementById("btn-next-spark").addEventListener("click", generateThoughtfulNudgeSpark);

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
      const formattedDate = new Date(memory.date).toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      });

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
              <h4>${memory.title}</h4>
              <p>${memory.description.replace(/\n/g, '<br>')}</p>
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

  cList.innerHTML = "";
  tList.innerHTML = "";

  const celebrations = localEvents.filter(e => e.type === "birthday");
  const trips = localEvents.filter(e => e.type === "trip");

  // Toggle empty states
  if (celebrations.length === 0) cEmpty.classList.remove("hidden");
  else cEmpty.classList.add("hidden");

  if (trips.length === 0) tEmpty.classList.remove("hidden");
  else tEmpty.classList.add("hidden");

  // Render celebrations
  celebrations.forEach(cel => {
    const card = document.createElement("div");
    card.className = "adventure-card celebration-card";
    
    const formattedDate = new Date(cel.date).toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });

    const isGiftChecklist = cel.checklist && cel.checklist.length > 0;
    const progress = calculateChecklistProgress(cel.checklist);

    card.innerHTML = `
      <div class="adventure-card-header">
        <div class="adv-title-box">
          <h4>${cel.title}</h4>
          <p><i class="fa-solid fa-cake-candles"></i> ${formattedDate}</p>
        </div>
        <div class="adv-action-row">
          <button class="adv-delete-btn" data-id="${cel.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <p class="adv-desc">${cel.notes || 'No description notes.'}</p>
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

    renderChecklistItems(cel, `checklist-items-${cel.id}`);

    // Checklist add step submit event
    card.querySelector(".checklist-add-input-row").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const text = input.value.trim();
      if (text) {
        const list = cel.checklist || [];
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

    cList.appendChild(card);
  });

  // Render trips
  trips.forEach(trip => {
    const card = document.createElement("div");
    card.className = "adventure-card trip-card";
    
    const formattedDate = new Date(trip.date).toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });

    const progress = calculateChecklistProgress(trip.checklist);

    card.innerHTML = `
      <div class="adventure-card-header">
        <div class="adv-title-box">
          <h4>Trip to ${trip.title}</h4>
          <p><i class="fa-solid fa-compass"></i> Departure: ${formattedDate}</p>
        </div>
        <div class="adv-action-row">
          <button class="adv-delete-btn" data-id="${trip.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <p class="adv-desc">${trip.notes || 'No trip descriptions.'}</p>
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

    renderChecklistItems(trip, `checklist-items-${trip.id}`);

    // Checklist add step submit event
    card.querySelector(".checklist-add-input-row").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const text = input.value.trim();
      if (text) {
        const list = trip.checklist || [];
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

    tList.appendChild(card);
  });
}

function calculateChecklistProgress(list) {
  if (!list || list.length === 0) return 0;
  const doneCount = list.filter(item => item.done).length;
  return Math.round((doneCount / list.length) * 100);
}

function renderChecklistItems(evt, elementId) {
  const container = document.getElementById(elementId);
  container.innerHTML = "";

  const list = evt.checklist || [];

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

  // Open buttons
  document.getElementById("btn-open-sync").addEventListener("click", () => {
    // Fill Firebase credentials if already configured
    if (db.dbConfig) {
      document.getElementById("db-apikey").value = db.dbConfig.apiKey || "";
      document.getElementById("db-projectid").value = db.dbConfig.projectId || "";
      document.getElementById("db-appid").value = db.dbConfig.appId || "";
    }
    cloudModal.classList.remove("hidden");
  });

  document.getElementById("btn-quick-settings").addEventListener("click", () => {
    if (localSpaceData) {
      document.getElementById("settings-user-name").value = localSpaceData.partner1Name || "";
      document.getElementById("settings-user-avatar").value = localSpaceData.partner1Avatar || "👤";
      document.getElementById("settings-partner-name").value = localSpaceData.partner2Name || "";
      document.getElementById("settings-partner-avatar").value = localSpaceData.partner2Avatar || "💖";
      document.getElementById("settings-anniversary").value = localSpaceData.anniversaryDate || "";
      document.getElementById("settings-partner-birthday").value = localSpaceData.partnerBirthday || "";
    }
    settingsModal.classList.remove("hidden");
  });

  document.getElementById("btn-add-preference").addEventListener("click", () => {
    // Reset forms
    document.getElementById("form-preference").reset();
    document.getElementById("pref-id").value = "";
    document.getElementById("pref-modal-title").innerText = "Add Loves/Hates Detail";
    prefModal.classList.remove("hidden");
  });

  document.getElementById("btn-add-memory").addEventListener("click", () => {
    document.getElementById("form-memory").reset();
    document.getElementById("memory-date").value = new Date().toISOString().split('T')[0];
    initPresetCovers(); // reload presets
    memoryModal.classList.remove("hidden");
  });

  document.getElementById("btn-add-celebration").addEventListener("click", () => {
    document.getElementById("form-celebration").reset();
    celModal.classList.remove("hidden");
  });

  document.getElementById("btn-add-trip").addEventListener("click", () => {
    document.getElementById("form-trip").reset();
    tripModal.classList.remove("hidden");
  });

  // Close buttons
  document.getElementById("btn-close-sync").addEventListener("click", () => cloudModal.classList.add("hidden"));
  document.getElementById("btn-close-settings").addEventListener("click", () => settingsModal.classList.add("hidden"));

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
  document.getElementById("form-onboarding").addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const profile = {
      partner1Name: document.getElementById("onboard-user-name").value.trim(),
      partner1Avatar: document.getElementById("onboard-user-avatar").value.trim(),
      partner2Name: document.getElementById("onboard-partner-name").value.trim(),
      partner2Avatar: document.getElementById("onboard-partner-avatar").value.trim(),
      anniversaryDate: document.getElementById("onboard-anniversary").value,
      partnerBirthday: document.getElementById("onboard-partner-birthday").value
    };

    onboardingModal.classList.add("hidden");
    
    if (db.isCloudMode() && !db.isPaired()) {
      try {
        const generatedId = await db.createCloudSpace(profile);
        handleConnectionStatusChange("paired", generatedId);
      } catch (err) {
        alert("Failed to initialize space database. Fallback to Local.");
      }
    } else {
      // Local setup
      localStorage.setItem("hb_sandbox_profile", JSON.stringify(profile));
      setupRealtimeSubscriptions();
    }
  });

  // 2. Settings Profile Update
  document.getElementById("form-settings").addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const profile = {
      userName: document.getElementById("settings-user-name").value.trim(),
      userAvatar: document.getElementById("settings-user-avatar").value.trim(),
      partnerName: document.getElementById("settings-partner-name").value.trim(),
      partnerAvatar: document.getElementById("settings-partner-avatar").value.trim(),
      anniversaryDate: document.getElementById("settings-anniversary").value,
      partnerBirthday: document.getElementById("settings-partner-birthday").value
    };

    await db.updateSpaceInfo(profile);
    settingsModal.classList.add("hidden");
  });

  // 3. Add/Edit Preference
  document.getElementById("form-preference").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("pref-id").value;
    const payload = {
      type: document.querySelector('input[name="pref-type"]:checked').value,
      item: document.getElementById("pref-item").value.trim(),
      category: document.getElementById("pref-category").value,
      notes: document.getElementById("pref-notes").value.trim()
    };

    if (id) {
      // Edit exists
      await db.deleteLoveHate(id); // Simple overwrite delete & add strategy
    }
    await db.addLoveHate(payload);
    
    prefModal.classList.add("hidden");
  });

  // 4. Memory Submission
  document.getElementById("form-memory").addEventListener("submit", async (e) => {
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
    memoryModal.classList.add("hidden");
  });

  // 5. Add Celebration Birthday event
  document.getElementById("form-celebration").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      type: "birthday",
      title: document.getElementById("cel-title").value.trim(),
      date: document.getElementById("cel-date").value,
      notes: document.getElementById("cel-notes").value.trim(),
      checklist: []
    };

    await db.addEvent(payload);
    celModal.classList.add("hidden");
  });

  // 6. Add Trip Adventure event
  document.getElementById("form-trip").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      type: "trip",
      title: document.getElementById("trip-title").value.trim(),
      date: document.getElementById("trip-date").value,
      notes: document.getElementById("trip-notes").value.trim(),
      checklist: []
    };

    await db.addEvent(payload);
    tripModal.classList.add("hidden");
  });

  // 7. Connect Database Config Credentials
  document.getElementById("form-cloud-config").addEventListener("submit", (e) => {
    e.preventDefault();
    const config = {
      apiKey: document.getElementById("db-apikey").value.trim(),
      projectId: document.getElementById("db-projectid").value.trim(),
      appId: document.getElementById("db-appid").value.trim()
    };
    db.saveDbConfig(config);
  });

  // Clear Database config / Reset to Local Sandbox
  document.getElementById("btn-clear-db-config").addEventListener("click", () => {
    if (confirm("Disconnect and clear cloud database credentials? Heartbound will return to Offline Local Sandbox.")) {
      db.clearDbConfig();
      document.getElementById("form-cloud-config").reset();
      cloudModal.classList.add("hidden");
    }
  });

  // Copy Love space Pairing code
  document.getElementById("btn-copy-code").addEventListener("click", () => {
    const code = document.getElementById("display-space-code").innerText;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById("btn-copy-code");
      btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Copied!`;
      setTimeout(() => {
        btn.innerHTML = `<i class="fa-solid fa-copy"></i> Copy`;
      }, 2000);
    });
  });

  // Pair existing Space ID code
  document.getElementById("form-pair-space").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("input-pair-code").value.trim();
    if (code) {
      const success = await db.pairExistingCloudSpace(code);
      if (success) {
        document.getElementById("input-pair-code").value = "";
        cloudModal.classList.add("hidden");
      }
    }
  });
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
