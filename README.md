# 💖 Heartbound

> A premium, highly aesthetic relationship companion app designed to capture, cherish, and plan special memories with your significant other or loved ones.

Heartbound is built to go beyond generic utilities. It features a cozy, velvety glassmorphic interface, dark-rose and warm amber color palettes, micro-animations, and live tickers. It allows you to:
1. **Take notes of what they love and hate** (so you never forget their preferences, allergies, or details that make them smile).
2. **Timeline your memories** (create a beautiful visual log of sweet moments, journal notes, complete with emoji tags and animated heart bursts).
3. **Plan upcoming celebrations** (keep countdowns for birthdays, anniversaries, and big milestones).
4. **Organize adventures & trips** (track trip itineraries and packing checklists together in real time).

---

## 🚀 Three Modes of Operations

### 1. Local Sandbox Mode (Zero Setup)
By default, the app starts in **Local Sandbox Mode** storing all notes, trips, and settings inside your browser's local storage (`localStorage`). This is completely private, requires no internet connection, and lets you explore the entire app immediately!

### 2. Cloud Connected Mode: Firebase Firestore
Enter your **Firebase Firestore** configuration credentials in the app's settings dashboard to unlock cloud synchronization.

### 3. Cloud Connected Mode: Supabase (NEW!)
Connect your own free **Supabase** instance to back up your memories inside an elegant Postgres database with real-time replication and zero server fees.

* **Couple Pairing**: One partner connects the database and generates a secure **Love Code** (e.g., `love-a94f-b32c`). The other partner enters it on their device.
* **Instant Sync**: Once paired, any update (a checked checklist item, a newly added memory, or a new love/hate detail) is synced instantly across both of your devices in real-time without reloading the page!

---

## 🛠️ How to Deploy Remotely (Free!)

### Step 1: Push this Repository to GitHub
1. Create a new repository on [GitHub](https://github.com/new). Name it `heartbound`.
2. Open your terminal in this directory and run:
   ```bash
   git init
   git add .
   git commit -m "Initialize Heartbound App"
   git branch -M main
   git remote add origin https://github.com/<your-username>/heartbound.git
   git push -u origin main
   ```

### Step 2: Enable GitHub Pages (Free Hosting!)
1. Go to your repository settings on GitHub.
2. Under the **"Code and automation"** sidebar section, click on **"Pages"**.
3. Under **"Build and deployment"**, set the Source to **"Deploy from a branch"**.
4. Set the branch to `main` and directory to `/ (root)`. Click **Save**.
5. Your application will be live at `https://<your-username>.github.io/heartbound/` in about a minute!

---

## 🔥 Setting Up Your Private Shared Database (Free in 2 Mins)

Heartbound is built to put **you in full ownership of your data**. You don't need to pay for any servers. You can choose either Firebase or Supabase:

### Option A: Firebase Firestore Setup
1. Go to the [Firebase Console](https://console.firebase.google.com/) and click **Add Project**. Name it `heartbound`.
2. Disable Google Analytics (not needed) and click **Create Project**.
3. In the project dashboard, click the web icon (`</>`) to add a Web App. Name it `Heartbound App` and register it.
4. Firebase will show you a configuration object that looks like this:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "heartbound.firebaseapp.com",
     projectId: "heartbound",
     storageBucket: "heartbound.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456:web:abcd"
   };
   ```
5. Click **Build > Firestore Database** in the left menu, then click **Create Database**.
6. Select your location, choose **"Start in test mode"** (this allows reading and writing), and click **Create**.
7. Now, open your Heartbound web app, click the ⚙️ **Cloud Settings** icon in the header, paste your Firebase config parameters, and click **Connect**!
8. Share your generated **Love Code** with your partner, and enjoy real-time sharing!

---

### Option B: Supabase (PostgreSQL) Setup
Supabase is an open-source Firebase alternative based on PostgreSQL. To set it up:

1. Create a free account at [Supabase](https://supabase.com/).
2. Create a new project called `heartbound` and set a secure database password.
3. In the left panel of your Supabase Dashboard, click on **SQL Editor** -> **New Query**.
4. Paste the following SQL script into the query box and click **Run**:
   ```sql
   -- 1. Create Spaces Table
   CREATE TABLE IF NOT EXISTS spaces (
       id TEXT PRIMARY KEY,
       partner1_name TEXT DEFAULT 'Alex',
       partner1_avatar TEXT DEFAULT '👤',
       partner2_name TEXT DEFAULT 'Taylor',
       partner2_avatar TEXT DEFAULT '💖',
       anniversary_date TEXT,
       partner_birthday TEXT,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
   );

   -- 2. Create Loves & Hates Table
   CREATE TABLE IF NOT EXISTS loves_hates (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
       type TEXT CHECK (type IN ('love', 'hate')),
       item TEXT NOT NULL,
       category TEXT NOT NULL,
       notes TEXT,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
   );

   -- 3. Create Memories Table
   CREATE TABLE IF NOT EXISTS memories (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
       title TEXT NOT NULL,
       description TEXT NOT NULL,
       date DATE NOT NULL,
       feeling TEXT NOT NULL,
       cover_url TEXT,
       hearts_count INTEGER DEFAULT 0,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
   );

   -- 4. Create Celebrations Table
   CREATE TABLE IF NOT EXISTS celebrations (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
       type TEXT CHECK (type IN ('birthday', 'trip')),
       title TEXT NOT NULL,
       date DATE NOT NULL,
       notes TEXT,
       checklist JSONB DEFAULT '[]'::jsonb,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
   );

   -- Enable Realtime replication for all tables to sync devices instantly!
   ALTER PUBLICATION supabase_realtime ADD TABLE spaces;
   ALTER PUBLICATION supabase_realtime ADD TABLE loves_hates;
   ALTER PUBLICATION supabase_realtime ADD TABLE memories;
   ALTER PUBLICATION supabase_realtime ADD TABLE celebrations;
   ```
5. In the left panel, click on **Project Settings** -> **API**.
6. Copy your **Project URL** and the **`anon` `public` API Key**.
7. In your Heartbound web app, click the ⚙️ **Cloud Settings** icon, select **Supabase (PostgreSQL)**, paste your URL and Key, and click **Connect Database**!
8. Pair your spaces by sharing your **Love Code**, and start logging your memories together in real-time!
