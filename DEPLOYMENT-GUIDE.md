# Atelier — Setup Guide (free, ~45–60 minutes)

This turns the app into a live, shared web app for you and your partner — same data on every phone and laptop, updating live. Everything here uses **free** plans. No credit card needed.

You'll do three things:
1. Create a free **Supabase** project (the cloud database + login)
2. Paste two values into the app's `config.js`
3. Put the app online for free with **Netlify** (drag-and-drop)

Take it one numbered step at a time. If a step's screen looks a little different (these services update their design), look for the button with the same wording.

---

## PART 1 — Supabase (database + login)  ~20 min

**1.** Go to **https://supabase.com** and click **Start your project** / **Sign in**. Sign up with your email (or Google). It's free.

**2.** Click **New project**.
- Give it a name: `atelier`
- Set a **database password** — write it down somewhere safe (you rarely need it, but don't lose it).
- Pick the region closest to you (e.g. an EU or Middle East region for Ethiopia).
- Click **Create new project**. Wait ~2 minutes while it sets up.

**3.** Create the data table. In the left sidebar click **SQL Editor** → **New query**. Open the file **`database-setup.sql`** (included in this folder) in any text editor, copy ALL of it, paste it into the box, and click **Run**. You should see "Success". This builds your shared table and security rules.

**4.** Get your two connection values. In the left sidebar click **Project Settings** (gear icon) → **API**. You'll see:
- **Project URL** — something like `https://abcdxyz.supabase.co`
- **Project API keys → `anon` `public`** — a long string starting with `eyJ...`

Keep this tab open; you'll copy these in Part 2.

**5.** Turn ON email/password login (it's on by default, but confirm). Sidebar → **Authentication** → **Sign In / Providers** (or **Providers**) → make sure **Email** is enabled.

> **Tip to avoid email-confirmation hassle for just two people:** In **Authentication → Sign In / Providers → Email**, you can turn **OFF** "Confirm email". Then you and your partner can create accounts and sign in immediately without clicking a confirmation link. (Fine for a private two-person app. Leave it on if you prefer the extra step.)

---

## PART 2 — Put your keys into the app  ~5 min

**6.** In this app folder, open the file **`config.js`** in any text editor (Notepad, TextEdit, VS Code — anything).

**7.** Replace the two placeholder values with the ones from Supabase step 4:

```js
window.ATELIER_CONFIG = {
  SUPABASE_URL: "https://abcdxyz.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi....your-long-key...."
};
```

Keep the quotes. Save the file. (It's safe to put the `anon` key here — it's designed to be public; your data is protected by the login + the security rules from the SQL file.)

---

## PART 3 — Put it online for free with Netlify  ~10 min

**8.** Go to **https://app.netlify.com** and sign up (free).

**9.** The easiest path: on the Netlify home page, find **"Deploy manually"** / **"Drag and drop your site folder here"** (sometimes under **Sites → Add new site → Deploy manually**).

**10.** Drag this **entire app folder** (the one containing `index.html`, `app.js`, `config.js`, etc.) onto that drop area. Netlify uploads it and gives you a live web address like `https://your-name-123.netlify.app`.

**11.** Open that address. You should see the Atelier **sign-in screen**. 🎉

> Want a nicer link? In Netlify: **Site configuration → Change site name** to make it e.g. `https://atelier-yourshop.netlify.app`.

---

## PART 4 — Create your two accounts & install on phones  ~10 min

**12.** On the live site, click **Create a new account**. Enter your email and a password (6+ characters). Do this once for **you** and once for **your partner** (each with your own email). Both accounts automatically share the same business data.

**13.** Sign in. Add a test order to confirm it saves. Then sign in on the other device/account — you should see the same data. That's live sync working.

**14.** Install it like an app:
- **iPhone (Safari):** open the site → tap the **Share** button → **Add to Home Screen**. An Atelier icon appears like a real app.
- **Android (Chrome):** menu (⋮) → **Add to Home screen / Install app**.
- **Laptop (Chrome/Edge):** an **Install** icon appears in the address bar.

---

## Updating the app later

If I give you improved files, just drag the updated folder onto your Netlify site again (Netlify → your site → **Deploys** → drag the folder). It replaces the old version. Your data is safe in Supabase and is untouched by redeploys.

---

## If something doesn't work

- **Sign-in screen says "Not configured yet"** → `config.js` still has the placeholder text, or wasn't saved. Re-check Part 2.
- **"Invalid login credentials"** → wrong email/password, or (if email confirmation is ON) you haven't confirmed via the email link yet. See the tip in step 5.
- **Data doesn't sync / errors saving** → the SQL from step 3 didn't run fully. Re-run `database-setup.sql` in the SQL Editor.
- **Came back after a week and it's slow to load once** → Supabase free projects "sleep" after 7 days of no use and take ~30 seconds to wake the first time. Just wait; it's normal. Using it regularly prevents this.
- **Anything else** → tell me the exact message on screen and which step, and I'll help.

---

## What it costs

Nothing, at your size. Supabase free tier: 500 MB database and up to 50,000 users — you won't get close. Netlify free hosting is ample for two people. You'd only ever pay if the business grew to very heavy use, which is a good problem for another day.
