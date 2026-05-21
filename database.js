/* Heartbound Database abstraction layer - Multi-Cloud (LocalStorage, Firebase & Supabase) */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
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

// --- ROW MAPPERS FOR SUPABASE TO JS SCHEMA ---
const mapSpaceRow = (row) => ({
  partner1Name: row.partner1_name,
  partner1Avatar: row.partner1_avatar,
  partner2Name: row.partner2_name,
  partner2Avatar: row.partner2_avatar,
  anniversaryDate: row.anniversary_date,
  partnerBirthday: row.partner_birthday
});

const mapLoveHateRow = (row) => ({
  id: row.id,
  type: row.type,
  item: row.item,
  category: row.category,
  notes: row.notes,
  createdAt: new Date(row.created_at).getTime()
});

const mapMemoryRow = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  date: row.date,
  feeling: row.feeling,
  coverUrl: row.cover_url,
  heartsCount: row.hearts_count,
  createdAt: new Date(row.created_at).getTime()
});

const mapCelebrationRow = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  date: row.date,
  notes: row.notes,
  checklist: Array.isArray(row.checklist) ? row.checklist : []
});

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

  clearDbConfig() {
    this.unsubscribeAll();
    this.dbConfig = null;
    this.activeSpaceId = null;
    this.firestore = null;
    this.firebaseApp = null;
    this.supabaseClient = null;
    localStorage.removeItem("hb_db_config");
    localStorage.removeItem("hb_space_id");
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
          partner1Name: profileData.userName || "Alex",
          partner1Avatar: profileData.userAvatar || "👤",
          partner2Name: profileData.partnerName || "Taylor",
          partner2Avatar: profileData.partnerAvatar || "💖",
          anniversaryDate: profileData.anniversaryDate || "",
          partnerBirthday: profileData.partnerBirthday || "",
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
          partner1_name: profileData.userName || "Alex",
          partner1_avatar: profileData.userAvatar || "👤",
          partner2_name: profileData.partnerName || "Taylor",
          partner2_avatar: profileData.partnerAvatar || "💖",
          anniversary_date: profileData.anniversaryDate || "",
          partner_birthday: profileData.partnerBirthday || ""
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
            onUpdate(snap.data());
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
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const spaceDocRef = doc(this.firestore, "spaces", this.activeSpaceId);
        await updateDoc(spaceDocRef, {
          partner1Name: profileData.userName,
          partner1Avatar: profileData.userAvatar,
          partner2Name: profileData.partnerName,
          partner2Avatar: profileData.partnerAvatar,
          anniversaryDate: profileData.anniversaryDate,
          partnerBirthday: profileData.partnerBirthday
        });
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("spaces")
          .update({
            partner1_name: profileData.userName,
            partner1_avatar: profileData.userAvatar,
            partner2_name: profileData.partnerName,
            partner2_avatar: profileData.partnerAvatar,
            anniversary_date: profileData.anniversaryDate,
            partner_birthday: profileData.partnerBirthday
          })
          .eq("id", this.activeSpaceId);
        if (error) throw error;
        this.refreshSpaceInfo();
      }
    } else {
      // Local
      localStorage.setItem("hb_sandbox_profile", JSON.stringify(profileData));
      window.dispatchEvent(new Event("hb_local_profile_updated"));
    }
  }

  // 2. Loves & Hates
  subscribeLovesHates(onUpdate) {
    this.callbacks.lovesHates = onUpdate;
    if (this.isCloudMode() && this.isPaired()) {
      const provider = this.getCloudProvider();
      if (provider === "firebase") {
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "loves_hates");
        const q = query(collRef, orderBy("createdAt", "desc"));
        this.subscriptions.lovesHates = onSnapshot(q, (snap) => {
          const items = [];
          snap.forEach(doc => {
            items.push({ id: doc.id, ...doc.data() });
          });
          onUpdate(items);
        });
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
        onUpdate(items);
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
          createdAt: serverTimestamp()
        };
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "loves_hates");
        await addDoc(collRef, payload);
      } else if (provider === "supabase") {
        const payload = {
          space_id: this.activeSpaceId,
          type: pref.type,
          item: pref.item,
          category: pref.category,
          notes: pref.notes
        };
        const { error } = await this.supabaseClient
          .from("loves_hates")
          .insert(payload);
        if (error) throw error;
        this.refreshLovesHates();
      }
    } else {
      // Local
      const payload = {
        type: pref.type,
        item: pref.item,
        category: pref.category,
        notes: pref.notes,
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
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("loves_hates")
          .delete()
          .eq("id", id);
        if (error) throw error;
        this.refreshLovesHates();
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
        const q = query(collRef, orderBy("date", "desc"));
        this.subscriptions.memories = onSnapshot(q, (snap) => {
          const memories = [];
          snap.forEach(doc => {
            memories.push({ id: doc.id, ...doc.data() });
          });
          onUpdate(memories);
        });
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
        this.refreshMemories();
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
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("memories")
          .delete()
          .eq("id", id);
        if (error) throw error;
        this.refreshMemories();
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
          this.refreshMemories();
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
        const q = query(collRef, orderBy("date", "asc"));
        this.subscriptions.events = onSnapshot(q, (snap) => {
          const events = [];
          snap.forEach(doc => {
            events.push({ id: doc.id, ...doc.data() });
          });
          onUpdate(events);
        });
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
        // Sort chronologically ascending
        events.sort((a,b) => new Date(a.date) - new Date(b.date));
        onUpdate(events);
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
          createdAt: serverTimestamp()
        };
        const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "celebrations");
        await addDoc(collRef, payload);
      } else if (provider === "supabase") {
        const payload = {
          space_id: this.activeSpaceId,
          type: evt.type,
          title: evt.title,
          date: evt.date,
          notes: evt.notes,
          checklist: evt.checklist || []
        };
        const { error } = await this.supabaseClient
          .from("celebrations")
          .insert(payload);
        if (error) throw error;
        this.refreshEvents();
      }
    } else {
      // Local
      const payload = {
        type: evt.type, // "birthday" | "trip"
        title: evt.title,
        date: evt.date,
        notes: evt.notes,
        checklist: evt.checklist || [],
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
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("celebrations")
          .delete()
          .eq("id", id);
        if (error) throw error;
        this.refreshEvents();
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
      } else if (provider === "supabase") {
        const { error } = await this.supabaseClient
          .from("celebrations")
          .update({ checklist: checklist })
          .eq("id", id);
        if (error) throw error;
        this.refreshEvents();
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
  
  async refreshSpaceInfo() {
    if (!this.callbacks.space || !this.isPaired()) return;
    if (this.isCloudMode()) {
      const provider = this.getCloudProvider();
      if (provider === "supabase") {
        const { data, error } = await this.supabaseClient
          .from("spaces")
          .select("*")
          .eq("id", this.activeSpaceId)
          .maybeSingle();
        if (!error && data) {
          this.callbacks.space(mapSpaceRow(data));
        }
      }
    }
  }

  async refreshLovesHates() {
    if (!this.callbacks.lovesHates || !this.isPaired()) return;
    if (this.isCloudMode()) {
      const provider = this.getCloudProvider();
      if (provider === "supabase") {
        const { data, error } = await this.supabaseClient
          .from("loves_hates")
          .select("*")
          .eq("space_id", this.activeSpaceId)
          .order("created_at", { ascending: false });
        if (!error && data) {
          this.callbacks.lovesHates(data.map(mapLoveHateRow));
        }
      }
    }
  }

  async refreshMemories() {
    if (!this.callbacks.memories || !this.isPaired()) return;
    if (this.isCloudMode()) {
      const provider = this.getCloudProvider();
      if (provider === "supabase") {
        const { data, error } = await this.supabaseClient
          .from("memories")
          .select("*")
          .eq("space_id", this.activeSpaceId)
          .order("date", { ascending: false });
        if (!error && data) {
          this.callbacks.memories(data.map(mapMemoryRow));
        }
      }
    }
  }

  async refreshEvents() {
    if (!this.callbacks.events || !this.isPaired()) return;
    if (this.isCloudMode()) {
      const provider = this.getCloudProvider();
      if (provider === "supabase") {
        const { data, error } = await this.supabaseClient
          .from("celebrations")
          .select("*")
          .eq("space_id", this.activeSpaceId)
          .order("date", { ascending: true });
        if (!error && data) {
          this.callbacks.events(data.map(mapCelebrationRow));
        }
      }
    }
  }
}

export const db = new HeartboundDatabase();
