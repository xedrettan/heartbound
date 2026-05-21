/* Heartbound Database abstraction layer - Dual Mode (LocalStorage & Firebase Firestore) */

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

class HeartboundDatabase {
  constructor() {
    this.firebaseApp = null;
    this.firestore = null;
    this.activeSpaceId = null;
    this.dbConfig = null;
    this.onStatusChangeCallback = null;
    
    // Firestore subscriptions storage to permit quick cleanup
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
    return !!(this.dbConfig && this.dbConfig.apiKey && this.dbConfig.projectId && this.dbConfig.appId);
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
      console.log("Successfully connected to cloud database!");
      this.triggerStatusChange();
      return true;
    } catch (error) {
      console.error("Firebase connection initialization failed:", error);
      alert("Failed to connect to Firebase. Check your configurations in the sync panel.");
      this.clearDbConfig();
      return false;
    }
  }

  unsubscribeAll() {
    Object.keys(this.subscriptions).forEach(key => {
      if (this.subscriptions[key]) {
        this.subscriptions[key]();
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
      console.error("Error creating space doc in firestore:", e);
      throw e;
    }
  }

  async pairExistingCloudSpace(targetSpaceId) {
    if (!this.isCloudMode()) return false;
    
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
      console.error("Error pairing space:", e);
      alert("Error searching for space code. Verify your credentials.");
      return false;
    }
  }

  // --- CRUD WRAPPERS ---

  // 1. Relationship Profile / Space Metadata
  subscribeSpaceInfo(onUpdate) {
    if (!this.isPaired()) return;

    if (this.isCloudMode()) {
      const spaceDocRef = doc(this.firestore, "spaces", this.activeSpaceId);
      this.subscriptions.space = onSnapshot(spaceDocRef, (snap) => {
        if (snap.exists()) {
          onUpdate(snap.data());
        }
      }, (err) => {
        console.error("Space subscription error:", err);
      });
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
      const spaceDocRef = doc(this.firestore, "spaces", this.activeSpaceId);
      await updateDoc(spaceDocRef, {
        partner1Name: profileData.userName,
        partner1Avatar: profileData.userAvatar,
        partner2Name: profileData.partnerName,
        partner2Avatar: profileData.partnerAvatar,
        anniversaryDate: profileData.anniversaryDate,
        partnerBirthday: profileData.partnerBirthday
      });
    } else {
      // Local
      localStorage.setItem("hb_sandbox_profile", JSON.stringify(profileData));
      window.dispatchEvent(new Event("hb_local_profile_updated"));
    }
  }

  // 2. Loves & Hates
  subscribeLovesHates(onUpdate) {
    if (this.isCloudMode() && this.isPaired()) {
      const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "loves_hates");
      const q = query(collRef, orderBy("createdAt", "desc"));
      this.subscriptions.lovesHates = onSnapshot(q, (snap) => {
        const items = [];
        snap.forEach(doc => {
          items.push({ id: doc.id, ...doc.data() });
        });
        onUpdate(items);
      });
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
    const payload = {
      type: pref.type, // "love" | "hate"
      item: pref.item,
      category: pref.category,
      notes: pref.notes,
      createdAt: this.isCloudMode() ? serverTimestamp() : Date.now()
    };

    if (this.isCloudMode() && this.isPaired()) {
      const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "loves_hates");
      await addDoc(collRef, payload);
    } else {
      // Local
      const items = JSON.parse(localStorage.getItem("hb_sandbox_loves_hates")) || [];
      payload.id = "local_" + Date.now();
      items.unshift(payload);
      localStorage.setItem("hb_sandbox_loves_hates", JSON.stringify(items));
      window.dispatchEvent(new Event("hb_local_loves_hates_updated"));
    }
  }

  async deleteLoveHate(id) {
    if (this.isCloudMode() && this.isPaired()) {
      const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "loves_hates", id);
      await deleteDoc(docRef);
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
    if (this.isCloudMode() && this.isPaired()) {
      const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "memories");
      const q = query(collRef, orderBy("date", "desc"));
      this.subscriptions.memories = onSnapshot(q, (snap) => {
        const memories = [];
        snap.forEach(doc => {
          memories.push({ id: doc.id, ...doc.data() });
        });
        onUpdate(memories);
      });
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
    const payload = {
      title: memory.title,
      description: memory.description,
      date: memory.date,
      feeling: memory.feeling,
      coverUrl: memory.coverUrl,
      heartsCount: 0,
      createdAt: this.isCloudMode() ? serverTimestamp() : Date.now()
    };

    if (this.isCloudMode() && this.isPaired()) {
      const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "memories");
      await addDoc(collRef, payload);
    } else {
      // Local
      const memories = JSON.parse(localStorage.getItem("hb_sandbox_memories")) || [];
      payload.id = "local_" + Date.now();
      memories.unshift(payload);
      localStorage.setItem("hb_sandbox_memories", JSON.stringify(memories));
      window.dispatchEvent(new Event("hb_local_memories_updated"));
    }
  }

  async deleteMemory(id) {
    if (this.isCloudMode() && this.isPaired()) {
      const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "memories", id);
      await deleteDoc(docRef);
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
      const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "memories", id);
      await updateDoc(docRef, {
        heartsCount: increment(1)
      });
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
    if (this.isCloudMode() && this.isPaired()) {
      const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "celebrations");
      const q = query(collRef, orderBy("date", "asc"));
      this.subscriptions.events = onSnapshot(q, (snap) => {
        const events = [];
        snap.forEach(doc => {
          events.push({ id: doc.id, ...doc.data() });
        });
        onUpdate(events);
      });
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
    const payload = {
      type: evt.type, // "birthday" | "trip"
      title: evt.title,
      date: evt.date,
      notes: evt.notes,
      checklist: evt.checklist || [],
      createdAt: this.isCloudMode() ? serverTimestamp() : Date.now()
    };

    if (this.isCloudMode() && this.isPaired()) {
      const collRef = collection(this.firestore, "spaces", this.activeSpaceId, "celebrations");
      await addDoc(collRef, payload);
    } else {
      // Local
      const events = JSON.parse(localStorage.getItem("hb_sandbox_events")) || [];
      payload.id = "local_" + Date.now();
      events.push(payload);
      localStorage.setItem("hb_sandbox_events", JSON.stringify(events));
      window.dispatchEvent(new Event("hb_local_events_updated"));
    }
  }

  async deleteEvent(id) {
    if (this.isCloudMode() && this.isPaired()) {
      const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "celebrations", id);
      await deleteDoc(docRef);
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
      const docRef = doc(this.firestore, "spaces", this.activeSpaceId, "celebrations", id);
      await updateDoc(docRef, { checklist: checklist });
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
}

export const db = new HeartboundDatabase();
