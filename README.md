# Invoice Generator

A WYSIWYG invoice generator. Sign in with Google, click any text on the invoice to edit it, invoices sync to the cloud via Firebase.

## Featuress
- Sign in with Google — each user gets their own private workspace
- Click-to-edit fields anywhere on the invoice
- Multiple line items, auto-summing totals
- Logo upload, persistent business info / payment details
- Auto-incrementing invoice numbers (date-based, e.g. `140526-00001`)
- Duplicate any past invoice
- Export to PDF via the browser's print dialog
- Real-time sync across devices, with offline support

---

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in Firebase config values (see below)
npm run dev
```

You **must** complete Firebase setup before the app will run.

---

## Firebase setup (~5 min, one-time)

### 1. Create a Firebase project

1. Go to https://console.firebase.google.com
2. Click **Add project**, give it a name (e.g. `invoice-generator`), accept defaults
3. Wait ~30 seconds for it to provision

### 2. Enable Google sign-in

1. In the left sidebar, click **Build → Authentication**
2. Click **Get started**
3. Under the **Sign-in method** tab, click **Google**, toggle **Enable**, choose a support email, click **Save**

### 3. Create the Firestore database

1. In the left sidebar, click **Build → Firestore Database**
2. Click **Create database**
3. Choose a region close to you, leave the default in **Production mode**, click **Enable**

### 4. Paste the security rules

1. Still in Firestore, click the **Rules** tab
2. Replace the entire contents with what's in this repo's `firestore.rules` file
3. Click **Publish**

This restricts every user to only their own `/users/{their uid}/` path — no one can read or write anyone else's invoices.

### 5. Get your config keys

1. Click the gear icon (top left) → **Project settings**
2. Scroll to **Your apps**, click the **`</>`** (web) icon
3. Give the app a nickname (anything), do **not** check "Firebase Hosting", click **Register app**
4. You'll see a config block like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123:web:abc..."
   };
   ```

5. Copy each value into your `.env.local` file (use `.env.example` as the template)

These keys end up in the public JS bundle. That's fine — Firebase web config is not secret. Security comes from the Firestore rules in step 4.

### 6. Run it

```bash
npm run dev
```

Open the URL Vite prints, sign in with Google, you're in.

---

## Deploy to Vercel

```bash
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/invoice-generator.git
git push -u origin main
```

Then on vercel.com:

1. **Add New Project** → import the GitHub repo
2. Before deploying, click **Environment Variables** and paste in all six `VITE_FIREBASE_*` values from your `.env.local`
3. Click **Deploy**

After the deploy completes, **one more step**:

4. Back in Firebase Console: **Authentication → Settings → Authorized domains → Add domain**
5. Add your `*.vercel.app` URL (e.g. `invoice-generator-xyz.vercel.app`)

Without this last step, the Google sign-in popup will fail on the deployed site.

If you later set a custom domain in Vercel, add that to the authorized domains list too.

---

## Where your invoices live

Each user's data is at:

```
/users/{uid}/invoices/{invoiceId}     ← one document per invoice
/users/{uid}/meta/businessInfo        ← single doc for business defaults
```

Firestore caches everything locally, so the app works offline. Changes queue up and sync when you reconnect.

The free Firestore tier is far more than a personal invoice tool will ever use (50K reads, 20K writes per day).

---

## Tech
- React 18 + Vite 6
- Firebase 11 (Auth + Firestore with persistent offline cache)
- lucide-react for icons
- Plain CSS (no Tailwind), embedded in a `<style>` block in the component
- Google Fonts: Onest, JetBrains Mono
