/* Heartbound Database abstraction layer - Multi-Cloud (LocalStorage, Firebase & Supabase) */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  updateDoc, 
  collection, 
  addDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

// --- ROBUST UNIFIED MODEL MAPPERS FOR SUPABASE & FIREBASE ---

function normalizeDate(val) {
  if (!val) return "";
  
  // If it's a Firestore Timestamp object
  if (typeof val.toDate === 'function') {
    try {
      return val.toDate().toISOString().split("T")[0];
    } catch (e) {
      console.error("normalizeDate: toDate() failed", e);
    }
  }
  
  // If it's a Date object
  if (val instanceof Date) {
    try {
      return val.toISOString().split("T")[0];
    } catch (e) {}
  }
  
  // If it's a string, try parsing or cleaning it
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === "") return "";
    // If it looks like ISO date YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    // If it contains timestamp or other format, try to parse
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
    return trimmed;
  }
  
  // If it is a number (timestamp)
  if (typeof val === 'number') {
    try {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split("T")[0];
      }
    } catch (e) {}
  }
  
  return "";
}

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

const mapSpaceData = (row) => {
  if (!row) return null;
  return {
    partner1Name: row.partner1Name || row.partner1_name || row.userName || "Alex",
    partner1Avatar: row.partner1Avatar || row.partner1_avatar || row.userAvatar || "👤",
    partner2Name: row.partner2Name || row.partner2_name || row.partnerName || "Taylor",
    partner2Avatar: row.partner2Avatar || row.partner2_avatar || row.partnerAvatar || "💖",
    anniversaryDate: normalizeDate(row.anniversaryDate || row.anniversary_date),
    partner1Birthday: normalizeDate(row.partner1Birthday || row.partner1_birthday),
    partner2Birthday: normalizeDate(row.partner2Birthday || row.partner2_birthday || row.partnerBirthday || row.partner_birthday)
  };
};

const mapLoveHateData = (id, row) => {
  if (!row) return null;
  const type = String(row.type || row.Type || "love").toLowerCase().trim();
  const item = row.item || row.Item || "";
  const category = row.category || row.Category || "Other";
  const notes = row.notes || row.Notes || "";
  const targetRole = row.targetRole || row.target_role || row.TargetRole || "partner2";
  
  let createdAt = Date.now();
  const rawCreated = row.createdAt || row.created_at || row.CreatedAt;
  if (rawCreated) {
    if (typeof rawCreated.toMillis === 'function') {
      createdAt = rawCreated.toMillis();
    } else {
      const parsedTime = new Date(rawCreated).getTime();
      if (!isNaN(parsedTime)) createdAt = parsedTime;
    }
  }

  return {
    id,
    type,
    item,
    category,
    notes,
    targetRole,
    createdAt
  };
};

const mapMemoryData = (id, row) => {
  if (!row) return null;
  const title = row.title || row.Title || "Untitled Memory";
  const description = row.description || row.Description || "";
  const date = normalizeDate(row.date || row.Date);
  const feeling = row.feeling || row.Feeling || "🥰";
  const coverUrl = row.coverUrl || row.cover_url || row.CoverUrl || "";
  const heartsCount = Number(row.heartsCount || row.hearts_count || row.HeartsCount || 0);

  let createdAt = Date.now();
  const rawCreated = row.createdAt || row.created_at || row.CreatedAt;
  if (rawCreated) {
    if (typeof rawCreated.toMillis === 'function') {
      createdAt = rawCreated.toMillis();
    } else {
      const parsedTime = new Date(rawCreated).getTime();
      if (!isNaN(parsedTime)) createdAt = parsedTime;
    }
  }

  return {
    id,
    title,
    description,
    date,
    feeling,
    coverUrl,
    heartsCount,
    createdAt
  };
};

const mapCelebrationData = (id, row) => {
  if (!row) return null;
  const type = String(row.type || row.Type || "celebration").toLowerCase().trim();
  const title = row.title || row.Title || row.name || row.Name || "Unnamed Event";
  const date = normalizeDate(row.date || row.Date);
  const notes = row.notes || row.Notes || row.description || row.Description || "";
  const targetRole = row.targetRole || row.target_role || row.TargetRole || "partner2";
  const checklist = safeParseChecklist(row.checklist || row.Checklist);

  return {
    id,
    type,
    title,
    date,
    notes,
    targetRole,
    checklist
  };
};

const mapSpaceRow = (row) => mapSpaceData(row);
const mapLoveHateRow = (row) => mapLoveHateData(row.id, row);
const mapMemoryRow = (row) => mapMemoryData(row.id, row);
const mapCelebrationRow = (row) => mapCelebrationData(row.id, row);


class HeartboundDatabase {
  constructor() {
    this.firebaseApp = null;
    this.firestore = null;
    this.supabaseClient = null;
    this.activeSpaceId = null;
    this.dbConfig = null;
    this.onStatusChangeCallback = null;
    
    // Active callbacks for manual refreshes (Double-Insurance Sync)
    this.callbacks = {
      space: null,
      lovesHates: null,
      memories: null,
      events: null
    };

    // Live subscriptions storage to permit quick cleanup
    this.subscriptions = {
      space: null,
      lovesHates: null,
      memories: null,
      events: null
    };

    // Load initial configs
    this.loadLocalConfig();
  }

  // --- CONFIG MANAGERS ---
  
  loadLocalConfig() {
    try {
      this.dbConfig = JSON.parse(localStorage.getItem("hb_db_config"));
      
      // Dynamic fallback Firebase config based on environment
      if (!this.dbConfig) {
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '';
        
        if (isLocalhost) {
          // Development Database
          this.dbConfig = {
            provider: "firebase",
            apiKey: "AIzaSyAcAHDO1-9IIEJSmeOrt-AhJ7aFuHp_cjQ",
            projectId: "heartbound-dev",
            appId: "1:644870081451:web:d42f68c8ba36156902a0ee"
          };
        } else {
          // Production Database
          this.dbConfig = {
            provider: "firebase",
            apiKey: "AIzaSyBdifZtIlVrKtnZxkHBycvMNRGpnxs5Weo",
            projectId: "heartbound-fb84e",
            appId: "1:1057660034330:web:e30c2c4338247d8de220a3"
          };
        }
        localStorage.setItem("hb_db_config", JSON.stringify(this.dbConfig));
      }
      
      this.activeSpaceId = localStorage.getItem("hb_space_id");
    } catch (e) {
      console.error("Failed to load local config", e);
    }
  }

  saveDbConfig(config) {
    this.dbConfig = config;
    localStorage.setItem("hb_db_config", JSON.stringify(config));
    this.initConnection();
  }

  async destroyApp() {
    this.unsubscribeAll();
    if (this.firebaseApp) {
      try {
        const { deleteApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
        await deleteApp(this.firebaseApp);
        console.log("Firebase App destroyed successfully.");
      } catch (e) {
        console.error("Error deleting Firebase app:", e);
      }
    }
    this.dbConfig = null;
    this.activeSpaceId = null;
    this.firestore = null;
    this.firebaseApp = null;
    this.supabaseClient = null;
  }

  async clearDbConfig() {
    await this.destroyApp();
    localStorage.removeItem("hb_db_config");
    localStorage.removeItem("hb_space_id");
    localStorage.removeItem("hb_user_role");
    this.triggerStatusChange();
  }

  saveSpaceId(spaceId) {
    this.activeSpaceId = spaceId;
    localStorage.setItem("hb_space_id", spaceId);
    this.triggerStatusChange();
  }

  isCloudMode() {
    if (!this.dbConfig) return false;
    const provider = this.dbConfig.provider || "firebase";
    if (provider === "supabase") {
      return !!(this.dbConfig.supabaseUrl && this.dbConfig.supabaseKey);
    }
    return !!(this.dbConfig.apiKey && this.dbConfig.projectId && this.dbConfig.appId);
  }

  getCloudProvider() {
    if (!this.isCloudMode()) return "sandbox";
    return this.dbConfig.provider || "firebase";
  }

  isPaired() {
    return !!this.activeSpaceId;
  }

  getConnectionStatus() {
    if (!this.isCloudMode()) return "sandbox";
    if (this.isCloudMode() && !this.isPaired()) return "cloud_connected";
    return "paired";
  }

  triggerStatusChange() {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(this.getConnectionStatus(), this.activeSpaceId);
    }
  }

  // --- CONNECTIVITY & PAIRING ---

  async initConnection(onStatusChange = null) {
    if (onStatusChange) {
      this.onStatusChangeCallback = onStatusChange;
    }

    this.unsubscribeAll();

    if (!this.isCloudMode()) {
      console.log("Heartbound operating in LOCAL SANDBOX MODE.");
      this.triggerStatusChange();
      return true;
    }

    const provider = this.getCloudProvider();

    if (provider === "firebase") {
      try {
        console.log("Initializing Firebase Firestore connection...");
        const config = {
          apiKey: this.dbConfig.apiKey,
          authDomain: `${this.dbConfig.projectId}.firebaseapp.com`,
          projectId: this.dbConfig.projectId,
          storageBucket: `${this.dbConfig.projectId}.appspot.com`,
          appId: this.dbConfig.appId
        };

        this.firebaseApp = initializeApp(config);
        this.firestore = getFirestore(this.firebaseApp);
        this.supabaseClient = null;
        console.log("Successfully connected to Firebase cloud database!");
        this.triggerStatusChange();
        return true;
      } catch (error) {
        console.error("Firebase connection initialization failed:", error);
        alert("Failed to connect to Firebase. Check your configurations in the sync panel.");
        this.clearDbConfig();
        return false;
      }
    } else if (provider === "supabase") {
      try {
        console.log("Initializing Supabase connection...");
        this.supabaseClient = createClient(this.dbConfig.supabaseUrl, this.dbConfig.supabaseKey);
        this.firebaseApp = null;
        this.firestore = null;
        console.log("Successfully connected to Supabase cloud database!");
        this.triggerStatusChange();
        return true;
      } catch (error) {
        console.error("Supabase connection initialization failed:", error);
        alert("Failed to connect to Supabase. Check your configurations in the sync panel.");
        this.clearDbConfig();
        return false;
      }
    }
  }

  unsubscribeAll() {
    Object.keys(this.subscriptions).forEach(key => {
      if (this.subscriptions[key]) {
        try {
          this.subscriptions[key]();
        } catch (e) {
          console.error("Unsubscribe error", e);
        }
        this.subscriptions[key] = null;
      }
    });
  }

  // Generate a random space code: love-xxxx-xxxx
  generateLoveCode() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const segment = () => Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `love-${segment()}-${segment()}`;
  }

  async createCloudSpace(profileData) {
    if (!this.isCloudMode()) return null;
    
    const newSpaceId = this.generateLoveCode();
    const provider = this.getCloudProvider();

    if (provider === "firebase") {
      try {
        const spaceDocRef = doc(this.firestore, "spaces", newSpaceId);
        const spacePayload = {
          partner1Name: profileData.partner1Name || profileData.userName || "Alex",
          partner1Avatar: profileData.partner1Avatar || profileData.userAvatar || "👤",
          partner2Name: profileData.partner2Name || profileData.partnerName || "Taylor",
          partner2Avatar: profileData.partner2Avatar || profileData.partnerAvatar || "💖",
          anniversaryDate: profileData.anniversaryDate || "",
          partner1Birthday: profileData.partner1Birthday || "",
          partner2Birthday: profileData.partner2Birthday || profileData.partnerBirthday || "",
          createdAt: serverTimestamp()
        };
        
        await setDoc(spaceDocRef, spacePayload);
        this.saveSpaceId(newSpaceId);
        return newSpaceId;
      } catch (e) {
        console.error("Error creating space doc in Firestore:", e);
        throw e;
      }
    } else if (provider === "supabase") {
      try {
        const spacePayload = {
          id: newSpaceId,
          partner1_name: profileData.partner1Name || profileData.userName || "Alex",
          partner1_avatar: profileData.partner1Avatar || profileData.userAvatar || "👤",
          partner2_name: profileData.partner2Name || profileData.partnerName || "Taylor",
          partner2_avatar: profileData.partner2Avatar || profileData.partnerAvatar || "💖",
          anniversary_date: profileData.anniversaryDate || "",
          partner1_birthday: profileData.partner1Birthday || "",
          partner2_birthday: profileData.partner2Birthday || profileData.partnerBirthday || ""
        };

        const { error } = await this.supabaseClient
          .from("spaces")
          .insert(spacePayload);

        if (error) throw error;
        
        this.saveSpaceId(newSpaceId);
        return newSpaceId;
      } catch (e) {
        console.error("Error creating space doc in Supabase:", e);
        throw e;
      }
    }
  }

  async pairExistingCloudSpace(targetSpaceId) {
    if (!this.isCloudMode()) return false;
    const provider = this.getCloudProvider();

    if (provider === "firebase") {
      try {
        const spaceDocRef = doc(this.firestore, "spaces", targetSpaceId);
        const spaceSnap = await getDoc(spaceDocRef);
        
        if (spaceSnap.exists()) {
          this.saveSpaceId(targetSpaceId);
          return true;
        } else {
          alert("Love Code not found. Please double-check it!");
          return false;
        }
      } catch (e) {
        console.error("Error pairing space in Firestore:", e);
        alert("Error searching for space code. Verify your credentials.");
        return false;
      }
    } else if (provider === "supabase") {
      try {
        const { data, error } = await this.supabaseClient
          .from("spaces")
          .select("id")
          .eq("id", targetSpaceId)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          this.saveSpaceId(targetSpaceId);
          return true;
        } else {
          alert("Love Code not found. Please double-check it!");
          return false;
        }
      } catch (e) {
        console.error("Error pairing space in Supabase:", e);
        alert("Error searching for space code. Verify your credentials.");
        return false;
      }
    }
  }

  async fetchSpace(spaceId = this.activeSpaceId) {
    if (!this.isCloudMode() || !spaceId) return null;
    const provider = this.getCloudProvider();
    if (provider === "firebase") {
      try {
        const spaceDocRef = doc(this.firestore, "spaces", spaceId);
        const snap = await getDoc(spaceDocRef);
        return snap.exists() ? mapSpaceData(snap.data()) : null;
      } catch (e) {
        console.error("fetchSpace Firebase error:", e);
        return null;
      }
    } else if (provider === "supabase") {
      try {
        const { data, error } = await this.supabaseClient
          .from("spaces")
          .select("*")
          .eq("id", spaceId)
          .maybeSingle();
        if (error) throw error;
        return data ? mapSpaceRow(data) : null;
      } catch (e) {
        console.error("fetchSpace Supabase error:", e);
        return null;
      }
    }
    return null;
  }

  // --- CRUD WRAPPERS ---

  // 1. Relationship Profile / Space Metadata
  subscribeSpaceInfo(onUpdate) {
    this.callbacks.space = onUpdate;
    if (!this.isPaired()) return;

    if (this.isCloudMode()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const spaceDocRef = doc(this.firestore, "spaces", this.activeSpaceId);
        this.subscriptions.space = onSnapshot(spaceDocRef, (snap) => {
          if (snap.exists()) {
            onUpdate(mapSpaceData(snap.data()));
          }
        }, (err) => {
          console.error("Space subscription error:", err);
        });
      } else if (provider === "supabase") {
        const fetchAndEmit = async () => {
          const { data, error } = await this.supabaseClient
            .from("spaces")
            .select("*")
            .eq("id", this.activeSpaceId)
            .maybeSingle();
          if (error) console.error("Error fetching space in Supabase", error);
          else if (data) onUpdate(mapSpaceRow(data));
        };

        fetchAndEmit();

        const channel = this.supabaseClient.channel("space-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: "spaces" }, (payload) => {
            const rowId = (payload.new && payload.new.id) || (payload.old && payload.old.id);
            if (!rowId || rowId === this.activeSpaceId) {
              fetchAndEmit();
            }
          })
          .subscribe();

        this.subscriptions.space = () => {
          this.supabaseClient.removeChannel(channel);
        };
      }
    } else {
      // Local sandbox watcher - we trigger manually
      const loadLocal = () => {
        const data = localStorage.getItem("hb_sandbox_profile");
        if (data) onUpdate(JSON.parse(data));
      };
      loadLocal();
      window.addEventListener("hb_local_profile_updated", loadLocal);
      this.subscriptions.space = () => window.removeEventListener("hb_local_profile_updated", loadLocal);
    }
  }

  async updateSpaceInfo(profileData) {
    const role = localStorage.getItem("hb_user_role") || "partner1";
    let p1Name = profileData.userName;
    let p1Avatar = profileData.userAvatar;
    let p2Name = profileData.partnerName;
    let p2Avatar = profileData.partnerAvatar;

    if (role === "partner2") {
      p1Name = profileData.partnerName;
      p1Avatar = profileData.partnerAvatar;
      p2Name = profileData.userName;
      p2Avatar = profileData.userAvatar;
    }

    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const spaceDocRef = doc(this.firestore, "spaces", this.activeSpaceId);
        await updateDoc(spaceDocRef, {
          partner1Name: p1Name,
          partner1Avatar: p1Avatar,
          partner2Name: p2Name,
          partner2Avatar: p2Avatar,
          anniversaryDate: profileData.anniversaryDate,
          partner1Birthday: profileData.partner1Birthday,
          partner2Birthday: profileData.partner2Birthday
        });
        await this.refreshSpaceInfo();
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("spaces")
          .update({
            partner1_name: p1Name,
            partner1_avatar: p1Avatar,
            partner2_name: p2Name,
            partner2_avatar: p2Avatar,
            anniversary_date: profileData.anniversaryDate,
            partner1_birthday: profileData.partner1Birthday,
            partner2_birthday: profileData.partner2Birthday
          })
          .eq("id", this.activeSpaceId);
        if (error) throw error;
        await this.refreshSpaceInfo();
      }
    } else {
      // Local
      const localProfile = {
        partner1Name: p1Name,
        partner1Avatar: p1Avatar,
        partner2Name: p2Name,
        partner2Avatar: p2Avatar,
        anniversaryDate: profileData.anniversaryDate,
        partner1Birthday: profileData.partner1Birthday,
        partner2Birthday: profileData.partner2Birthday
      };
      localStorage.setItem("hb_sandbox_profile", JSON.stringify(localProfile));
      window.dispatchEvent(new Event("hb_local_profile_updated"));
    }
  }

  async updatePartnerDetails(name, avatar) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const spaceDocRef = doc(this.firestore, "spaces", this.activeSpaceId);
        await updateDoc(spaceDocRef, {
          partner2Name: name,
          partner2Avatar: avatar
        });
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("spaces")
          .update({
            partner2_name: name,
            partner2_avatar: avatar
          })
          .eq("id", this.activeSpaceId);
        if (error) throw error;
        this.refreshSpaceInfo();
      }
    } else {
      // Local
      const data = localStorage.getItem("hb_sandbox_profile");
      if (data) {
        const profile = JSON.parse(data);
        profile.partner2Name = name;
        profile.partner2Avatar = avatar;
        localStorage.setItem("hb_sandbox_profile", JSON.stringify(profile));
        window.dispatchEvent(new Event("hb_local_profile_updated"));
      }
    }
  }

  // 2. Loves & Hates
  subscribeLovesHates(onUpdate) {
    this.callbacks.lovesHates = onUpdate;
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "loves_hates");
        this.subscriptions.lovesHates = onSnapshot(collRef, (snap) => {
          const items = [];
          snap.forEach(d => {
            const mapped = mapLoveHateData(d.id, d.data());
            if (mapped) items.push(mapped);
          });
          items.sort((a, b) => b.createdAt - a.createdAt);
          onUpdate(items);
        }, (err) => console.error("Firebase lovesHates onSnapshot error:", err));
      } else if (provider === "supabase") {
        const fetchAndEmit = async () => {
          const { data, error } = await this.supabaseClient
            .from("loves_hates")
            .select("*")
            .eq("space_id", this.activeSpaceId)
            .order("created_at", { ascending: false });
          if (error) console.error("Error fetching loves_hates from Supabase", error);
          else onUpdate(data.map(mapLoveHateRow));
        };

        fetchAndEmit();

        const channel = this.supabaseClient.channel("lh-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: "loves_hates" }, (payload) => {
            const rowSpaceId = (payload.new && payload.new.space_id) || (payload.old && payload.old.space_id);
            if (!rowSpaceId || rowSpaceId === this.activeSpaceId) {
              fetchAndEmit();
            }
          })
          .subscribe();

        this.subscriptions.lovesHates = () => {
          this.supabaseClient.removeChannel(channel);
        };
      }
    } else {
      // Local Sandbox
      const loadLocal = () => {
        const items = JSON.parse(localStorage.getItem("hb_sandbox_loves_hates")) || [];
        const mapped = items.map(item => ({
          ...item,
          targetRole: item.targetRole || "partner2"
        }));
        onUpdate(mapped);
      };
      loadLocal();
      window.addEventListener("hb_local_loves_hates_updated", loadLocal);
      this.subscriptions.lovesHates = () => window.removeEventListener("hb_local_loves_hates_updated", loadLocal);
    }
  }

  async addLoveHate(pref) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const payload = {
          type: pref.type, // "love" | "hate"
          item: pref.item,
          category: pref.category,
          notes: pref.notes,
          targetRole: pref.targetRole || "partner2",
          createdAt: serverTimestamp()
        };
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "loves_hates");
        await addDoc(collRef, payload);
        await this.refreshLovesHates();
      } else if (provider === "supabase") {
        const payload = {
          space_id: this.activeSpaceId,
          type: pref.type,
          item: pref.item,
          category: pref.category,
          notes: pref.notes,
          target_role: pref.targetRole || "partner2"
        };
        const { error } = await this.supabaseClient
          .from("loves_hates")
          .insert(payload);
        if (error) throw error;
        await this.refreshLovesHates();
      }
    } else {
      // Local
      const payload = {
        type: pref.type,
        item: pref.item,
        category: pref.category,
        notes: pref.notes,
        targetRole: pref.targetRole || "partner2",
        createdAt: Date.now()
      };
      const items = JSON.parse(localStorage.getItem("hb_sandbox_loves_hates")) || [];
      payload.id = "local_" + Date.now();
      items.unshift(payload);
      localStorage.setItem("hb_sandbox_loves_hates", JSON.stringify(items));
      window.dispatchEvent(new Event("hb_local_loves_hates_updated"));
    }
  }

  async deleteLoveHate(id) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "loves_hates", id);
        await deleteDoc(docRef);
        await this.refreshLovesHates();
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("loves_hates")
          .delete()
          .eq("id", id);
        if (error) throw error;
        await this.refreshLovesHates();
      }
    } else {
      // Local
      let items = JSON.parse(localStorage.getItem("hb_sandbox_loves_hates")) || [];
      items = items.filter(item => item.id !== id);
      localStorage.setItem("hb_sandbox_loves_hates", JSON.stringify(items));
      window.dispatchEvent(new Event("hb_local_loves_hates_updated"));
    }
  }

  // 3. Memory Lane
  subscribeMemories(onUpdate) {
    this.callbacks.memories = onUpdate;
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "memories");
        this.subscriptions.memories = onSnapshot(collRef, (snap) => {
          const memories = [];
          snap.forEach(d => {
            const mapped = mapMemoryData(d.id, d.data());
            if (mapped) memories.push(mapped);
          });
          memories.sort((a, b) => {
            const dA = a.date ? new Date(a.date).getTime() : 0;
            const dB = b.date ? new Date(b.date).getTime() : 0;
            return (isNaN(dB) ? 0 : dB) - (isNaN(dA) ? 0 : dA);
          });
          onUpdate(memories);
        }, (err) => console.error("Firebase memories onSnapshot error:", err));
      } else if (provider === "supabase") {
        const fetchAndEmit = async () => {
          const { data, error } = await this.supabaseClient
            .from("memories")
            .select("*")
            .eq("space_id", this.activeSpaceId)
            .order("date", { ascending: false });
          if (error) console.error("Error fetching memories from Supabase", error);
          else onUpdate(data.map(mapMemoryRow));
        };

        fetchAndEmit();

        const channel = this.supabaseClient.channel("mem-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: "memories" }, (payload) => {
            const rowSpaceId = (payload.new && payload.new.space_id) || (payload.old && payload.old.space_id);
            if (!rowSpaceId || rowSpaceId === this.activeSpaceId) {
              fetchAndEmit();
            }
          })
          .subscribe();

        this.subscriptions.memories = () => {
          this.supabaseClient.removeChannel(channel);
        };
      }
    } else {
      // Local Sandbox
      const loadLocal = () => {
        const memories = JSON.parse(localStorage.getItem("hb_sandbox_memories")) || [];
        // Sort chronologically by date
        memories.sort((a,b) => new Date(b.date) - new Date(a.date));
        onUpdate(memories);
      };
      loadLocal();
      window.addEventListener("hb_local_memories_updated", loadLocal);
      this.subscriptions.memories = () => window.removeEventListener("hb_local_memories_updated", loadLocal);
    }
  }

  async addMemory(memory) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const payload = {
          title: memory.title,
          description: memory.description,
          date: memory.date,
          feeling: memory.feeling,
          coverUrl: memory.coverUrl,
          heartsCount: 0,
          createdAt: serverTimestamp()
        };
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "memories");
        await addDoc(collRef, payload);
        await this.refreshMemories();
      } else if (provider === "supabase") {
        const payload = {
          space_id: this.activeSpaceId,
          title: memory.title,
          description: memory.description,
          date: memory.date,
          feeling: memory.feeling,
          cover_url: memory.coverUrl,
          hearts_count: 0
        };
        const { error } = await this.supabaseClient
          .from("memories")
          .insert(payload);
        if (error) throw error;
        await this.refreshMemories();
      }
    } else {
      // Local
      const payload = {
        title: memory.title,
        description: memory.description,
        date: memory.date,
        feeling: memory.feeling,
        coverUrl: memory.coverUrl,
        heartsCount: 0,
        createdAt: Date.now()
      };
      const memories = JSON.parse(localStorage.getItem("hb_sandbox_memories")) || [];
      payload.id = "local_" + Date.now();
      memories.unshift(payload);
      localStorage.setItem("hb_sandbox_memories", JSON.stringify(memories));
      window.dispatchEvent(new Event("hb_local_memories_updated"));
    }
  }

  async deleteMemory(id) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "memories", id);
        await deleteDoc(docRef);
        await this.refreshMemories();
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("memories")
          .delete()
          .eq("id", id);
        if (error) throw error;
        await this.refreshMemories();
      }
    } else {
      // Local
      let memories = JSON.parse(localStorage.getItem("hb_sandbox_memories")) || [];
      memories = memories.filter(item => item.id !== id);
      localStorage.setItem("hb_sandbox_memories", JSON.stringify(memories));
      window.dispatchEvent(new Event("hb_local_memories_updated"));
    }
  }

  async incrementMemoryHearts(id) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "memories", id);
        await updateDoc(docRef, {
          heartsCount: increment(1)
        });
        await this.refreshMemories();
      } else if (provider === "supabase") {
        const { data, error: selectErr } = await this.supabaseClient
          .from("memories")
          .select("hearts_count")
          .eq("id", id)
          .single();
        if (!selectErr && data) {
          const { error: updateErr } = await this.supabaseClient
            .from("memories")
            .update({ hearts_count: (data.hearts_count || 0) + 1 })
            .eq("id", id);
          if (updateErr) throw updateErr;
          await this.refreshMemories();
        }
      }
    } else {
      // Local
      const memories = JSON.parse(localStorage.getItem("hb_sandbox_memories")) || [];
      const index = memories.findIndex(m => m.id === id);
      if (index !== -1) {
        memories[index].heartsCount = (memories[index].heartsCount || 0) + 1;
        localStorage.setItem("hb_sandbox_memories", JSON.stringify(memories));
        window.dispatchEvent(new Event("hb_local_memories_updated"));
      }
    }
  }

  // 4. Adventures (Trips & Milestones)
  subscribeEvents(onUpdate) {
    this.callbacks.events = onUpdate;
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "celebrations");
        this.subscriptions.events = onSnapshot(collRef, (snap) => {
          const events = [];
          snap.forEach(docSnap => {
            const mapped = mapCelebrationData(docSnap.id, docSnap.data());
            if (mapped) events.push(mapped);
          });
          events.sort((a, b) => {
            const tA = a.date ? new Date(a.date).getTime() : 0;
            const tB = b.date ? new Date(b.date).getTime() : 0;
            return (isNaN(tA) ? 0 : tA) - (isNaN(tB) ? 0 : tB);
          });
          console.log("Firebase celebrations snapshot:", events.length, "events", events.map(e => e.title));
          onUpdate(events);
        }, (err) => console.error("Firebase events onSnapshot error:", err));
      } else if (provider === "supabase") {
        const fetchAndEmit = async () => {
          const { data, error } = await this.supabaseClient
            .from("celebrations")
            .select("*")
            .eq("space_id", this.activeSpaceId)
            .order("date", { ascending: true });
          if (error) console.error("Error fetching celebrations from Supabase", error);
          else onUpdate(data.map(mapCelebrationRow));
        };

        fetchAndEmit();

        const channel = this.supabaseClient.channel("cel-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: "celebrations" }, (payload) => {
            const rowSpaceId = (payload.new && payload.new.space_id) || (payload.old && payload.old.space_id);
            if (!rowSpaceId || rowSpaceId === this.activeSpaceId) {
              fetchAndEmit();
            }
          })
          .subscribe();

        this.subscriptions.events = () => {
          this.supabaseClient.removeChannel(channel);
        };
      }
    } else {
      // Local Sandbox
      const loadLocal = () => {
        const events = JSON.parse(localStorage.getItem("hb_sandbox_events")) || [];
        const mapped = events.map(e => ({
          ...e,
          targetRole: e.targetRole || "partner2",
          checklist: safeParseChecklist(e.checklist)
        }));
        // Sort chronologically ascending
        mapped.sort((a,b) => new Date(a.date) - new Date(b.date));
        onUpdate(mapped);
      };
      loadLocal();
      window.addEventListener("hb_local_events_updated", loadLocal);
      this.subscriptions.events = () => window.removeEventListener("hb_local_events_updated", loadLocal);
    }
  }

  async addEvent(evt) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const payload = {
          type: evt.type, // "birthday" | "trip"
          title: evt.title,
          date: evt.date,
          notes: evt.notes,
          checklist: evt.checklist || [],
          targetRole: evt.targetRole || "partner2",
          createdAt: serverTimestamp()
        };
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "celebrations");
        await addDoc(collRef, payload);
        await this.refreshEvents();
      } else if (provider === "supabase") {
        const payload = {
          space_id: this.activeSpaceId,
          type: evt.type,
          title: evt.title,
          date: evt.date,
          notes: evt.notes,
          checklist: evt.checklist || [],
          target_role: evt.targetRole || "partner2"
        };
        const { error } = await this.supabaseClient
          .from("celebrations")
          .insert(payload);
        if (error) throw error;
        await this.refreshEvents();
      }
    } else {
      // Local
      const payload = {
        type: evt.type, // "birthday" | "trip"
        title: evt.title,
        date: evt.date,
        notes: evt.notes,
        checklist: evt.checklist || [],
        targetRole: evt.targetRole || "partner2",
        createdAt: Date.now()
      };
      const events = JSON.parse(localStorage.getItem("hb_sandbox_events")) || [];
      payload.id = "local_" + Date.now();
      events.push(payload);
      localStorage.setItem("hb_sandbox_events", JSON.stringify(events));
      window.dispatchEvent(new Event("hb_local_events_updated"));
    }
  }

  async deleteEvent(id) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "celebrations", id);
        await deleteDoc(docRef);
        await this.refreshEvents();
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("celebrations")
          .delete()
          .eq("id", id);
        if (error) throw error;
        await this.refreshEvents();
      }
    } else {
      // Local
      let events = JSON.parse(localStorage.getItem("hb_sandbox_events")) || [];
      events = events.filter(item => item.id !== id);
      localStorage.setItem("hb_sandbox_events", JSON.stringify(events));
      window.dispatchEvent(new Event("hb_local_events_updated"));
    }
  }

  async updateEventChecklist(id, checklist) {
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "celebrations", id);
        await updateDoc(docRef, { checklist: checklist });
        await this.refreshEvents();
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("celebrations")
          .update({ checklist: checklist })
          .eq("id", id);
        if (error) throw error;
        await this.refreshEvents();
      }
    } else {
      // Local
      const events = JSON.parse(localStorage.getItem("hb_sandbox_events")) || [];
      const index = events.findIndex(e => e.id === id);
      if (index !== -1) {
        events[index].checklist = checklist;
        localStorage.setItem("hb_sandbox_events", JSON.stringify(events));
        window.dispatchEvent(new Event("hb_local_events_updated"));
      }
    }
  }

  // --- DIRECT REFRESH HELPER METHODS FOR DOUBLE-INSURANCE SYNC ---
  // These methods support BOTH Firebase (via getDoc/getDocs) AND Supabase re-fetch.
  
  async refreshSpaceInfo() {
    if (!this.callbacks.space || !this.isPaired()) return;
    if (!this.isCloudMode()) return;
    try {
      const provider = this.getCloudProvider();
      if (provider === "supabase") {
        const { data, error } = await this.supabaseClient
          .from("spaces")
          .select("*")
          .eq("id", this.activeSpaceId)
          .maybeSingle();
        if (error) { console.error("refreshSpaceInfo Supabase error:", error); return; }
        if (data) this.callbacks.space(mapSpaceRow(data));
      } else if (provider === "firebase") {
        const spaceDocRef = doc(this.firestore, "spaces", this.activeSpaceId);
        const snap = await getDoc(spaceDocRef);
        if (snap.exists()) this.callbacks.space(mapSpaceData(snap.data()));
      }
    } catch (e) {
      console.error("refreshSpaceInfo failed:", e);
    }
  }

  async refreshLovesHates() {
    if (!this.callbacks.lovesHates || !this.isPaired()) return;
    if (!this.isCloudMode()) return;
    try {
      const provider = this.getCloudProvider();
      if (provider === "supabase") {
        const { data, error } = await this.supabaseClient
          .from("loves_hates")
          .select("*")
          .eq("space_id", this.activeSpaceId)
          .order("created_at", { ascending: false });
        if (error) { console.error("refreshLovesHates Supabase error:", error); return; }
        if (data) this.callbacks.lovesHates(data.map(mapLoveHateRow));
      } else if (provider === "firebase") {
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "loves_hates");
        const snap = await getDocs(collRef);
        const items = [];
        snap.forEach(d => {
          const mapped = mapLoveHateData(d.id, d.data());
          if (mapped) items.push(mapped);
        });
        items.sort((a, b) => b.createdAt - a.createdAt);
        this.callbacks.lovesHates(items);
      }
    } catch (e) {
      console.error("refreshLovesHates failed:", e);
    }
  }

  async refreshMemories() {
    if (!this.callbacks.memories || !this.isPaired()) return;
    if (!this.isCloudMode()) return;
    try {
      const provider = this.getCloudProvider();
      if (provider === "supabase") {
        const { data, error } = await this.supabaseClient
          .from("memories")
          .select("*")
          .eq("space_id", this.activeSpaceId)
          .order("date", { ascending: false });
        if (error) { console.error("refreshMemories Supabase error:", error); return; }
        if (data) this.callbacks.memories(data.map(mapMemoryRow));
      } else if (provider === "firebase") {
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "memories");
        const snap = await getDocs(collRef);
        const items = [];
        snap.forEach(d => {
          const mapped = mapMemoryData(d.id, d.data());
          if (mapped) items.push(mapped);
        });
        items.sort((a, b) => {
          const dA = a.date ? new Date(a.date).getTime() : 0;
          const dB = b.date ? new Date(b.date).getTime() : 0;
          return (isNaN(dB) ? 0 : dB) - (isNaN(dA) ? 0 : dA);
        });
        this.callbacks.memories(items);
      }
    } catch (e) {
      console.error("refreshMemories failed:", e);
    }
  }

  async refreshEvents() {
    if (!this.callbacks.events || !this.isPaired()) return;
    if (!this.isCloudMode()) return;
    try {
      const provider = this.getCloudProvider();
      if (provider === "supabase") {
        const { data, error } = await this.supabaseClient
          .from("celebrations")
          .select("*")
          .eq("space_id", this.activeSpaceId)
          .order("date", { ascending: true });
        if (error) { console.error("refreshEvents Supabase error:", error); return; }
        if (data) this.callbacks.events(data.map(mapCelebrationRow));
      } else if (provider === "firebase") {
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "celebrations");
        const snap = await getDocs(collRef);
        const items = [];
        snap.forEach(d => {
          const mapped = mapCelebrationData(d.id, d.data());
          if (mapped) items.push(mapped);
        });
        items.sort((a, b) => {
          const tA = a.date ? new Date(a.date).getTime() : 0;
          const tB = b.date ? new Date(b.date).getTime() : 0;
          return (isNaN(tA) ? 0 : tA) - (isNaN(tB) ? 0 : tB);
        });
        console.log("refreshEvents Firebase:", items.length, "items", items.map(e => e.title));
        this.callbacks.events(items);
      }
    } catch (e) {
      console.error("refreshEvents failed:", e);
    }
  }

  // Nuclear refresh: re-fetch ALL collections from the active cloud provider
  async forceRefreshAll() {
    console.log("forceRefreshAll triggered — re-fetching all data nodes...");
    await Promise.allSettled([
      this.refreshSpaceInfo(),
      this.refreshLovesHates(),
      this.refreshMemories(),
      this.refreshEvents()
    ]);
    console.log("forceRefreshAll complete.");
  }

  generateInviteCode(role = "partner2") {
    if (!this.isCloudMode() || !this.isPaired()) return null;
    try {
      const provider = this.getCloudProvider();
      let payload = {
        p: provider,
        s: this.activeSpaceId,
        r: role
      };
      
      if (provider === "supabase") {
        payload.u = this.dbConfig.supabaseUrl;
        payload.k = this.dbConfig.supabaseKey;
      } else if (provider === "firebase") {
        payload.a = this.dbConfig.apiKey;
        payload.d = this.dbConfig.projectId;
        payload.i = this.dbConfig.appId;
      }
      
      const jsonStr = JSON.stringify(payload);
      const base64Str = btoa(unescape(encodeURIComponent(jsonStr)));
      if (role === "partner2") {
        return `hb_invite_partner_${base64Str}`;
      } else {
        return `hb_invite_creator_${base64Str}`;
      }
    } catch (e) {
      console.error("Failed to generate invite code:", e);
      return null;
    }
  }

  bootstrapFromInviteCode(encodedString) {
    try {
      let raw = encodedString.trim();
      if (raw.startsWith("hb_invite_partner_")) {
        raw = raw.replace("hb_invite_partner_", "");
      } else if (raw.startsWith("hb_invite_creator_")) {
        raw = raw.replace("hb_invite_creator_", "");
      } else if (raw.startsWith("hb_invite_")) {
        raw = raw.replace("hb_invite_", "");
      }
      // UTF-8 safe base64 decode
      const jsonStr = decodeURIComponent(escape(atob(raw)));
      const payload = JSON.parse(jsonStr);
      
      if (!payload.p || !payload.s) {
        throw new Error("Invalid invite payload structure");
      }
      
      let config = { provider: payload.p };
      
      if (payload.p === "supabase") {
        if (!payload.u || !payload.k) throw new Error("Missing Supabase credentials in invite payload");
        config.supabaseUrl = payload.u;
        config.supabaseKey = payload.k;
      } else if (payload.p === "firebase") {
        if (!payload.a || !payload.d || !payload.i) throw new Error("Missing Firebase credentials in invite payload");
        config.apiKey = payload.a;
        config.projectId = payload.d;
        config.appId = payload.i;
      } else {
        throw new Error("Unknown database provider in invite payload: " + payload.p);
      }
      
      // Save configuration
      localStorage.setItem("hb_db_config", JSON.stringify(config));
      localStorage.setItem("hb_space_id", payload.s);
      localStorage.setItem("hb_user_role", payload.r || "partner2"); // Active user is based on encoded role, defaulting to partner2
      
      this.dbConfig = config;
      this.activeSpaceId = payload.s;
      
      // Initialize connection and trigger UI callback
      this.initConnection();
      return true;
    } catch (e) {
      console.error("Failed to bootstrap from invite code:", e);
      return false;
    }
  }
}

export const db = new HeartboundDatabase();
