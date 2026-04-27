# Lynwood Minutes Generator — Netlify Deployment Guide

A small web app that takes a meeting transcript (`.txt`) and a short agenda
(`.pdf`), runs them through Anthropic's Claude API, and downloads three
draft Word documents (Closed Session, Regular Meeting, Successor Agency / etc.)
formatted to match the City Clerk's existing style.

## Architecture at a glance

```
┌─────────────────┐    HTTPS+JWT     ┌──────────────────────┐    HTTPS    ┌──────────────────┐
│  Browser (UI)   │  ───────────────▶│ Netlify Function     │ ──────────▶ │ Anthropic API    │
│  - file uploads │   ←─── stream ───│  - verifies JWT      │ ◀── stream ─│  (Claude)        │
│  - JWT auth     │                  │  - email whitelist   │             └──────────────────┘
│  - builds .docx │                  │  - holds API KEY     │
└─────────────────┘                  └──────────────────────┘
```

**The Anthropic API key is stored ONLY as a Netlify environment variable.**
It is never sent to the browser, never committed to Git, and never appears
in any HTTP response.

---

## One-time setup (≈ 30 minutes for IT)

### Prerequisites

- A GitHub (or GitLab/Bitbucket) account
- A Netlify account — sign up free at https://app.netlify.com
- An Anthropic API key — create one at https://console.anthropic.com/

### Step 1 — Push this folder to a Git repository

```bash
cd netlify-app
git init
git add .
git commit -m "Initial commit"
# Create an empty repo on GitHub, then:
git remote add origin git@github.com:YOUR_ORG/lynwood-minutes-app.git
git push -u origin main
```

### Step 2 — Create a Netlify site

1. https://app.netlify.com → **Add new site → Import an existing project**
2. Connect to your Git provider, pick the repo, accept the defaults — Netlify
   reads `netlify.toml` and builds automatically.
3. After the first deploy you'll get a URL like `https://wonderful-name-12345.netlify.app`.

### Step 3 — Set environment variables (this is where the API key lives)

In Netlify: **Site configuration → Environment variables → Add a variable**.
Add the following:

| Key                 | Value                                     | Notes                          |
|---------------------|-------------------------------------------|--------------------------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (from console.anthropic.com) | Mark as **Secret**             |
| `ALLOWED_EMAILS`    | `clerk@lynwoodca.gov,deputy@lynwoodca.gov` | Comma-separated, lowercase     |
| `ANTHROPIC_MODEL`   | `claude-sonnet-4-6` (optional)            | Override the default model     |

After saving, go to **Deploys → Trigger deploy → Clear cache and deploy site**
so the function picks up the new variables.

### Step 4 — Turn on Netlify Identity (the auth gate)

1. **Site configuration → Identity → Enable Identity**
2. Under **Registration preferences**, switch to **Invite only** — this is
   essential, otherwise anyone could create an account and use the function.
3. (Optional but recommended) Under **External providers**, add Google or
   Microsoft 365 if you want staff to sign in with their existing work account.

### Step 5 — Invite your staff

In **Identity → Invite users**, enter the same emails you put in
`ALLOWED_EMAILS` above. They'll receive an email with a sign-up link.

> **Defense in depth:** The function checks both that the user is signed in
> via Identity *and* that their email is in `ALLOWED_EMAILS`. Even if someone
> were accidentally invited to Identity but not added to the env-var list,
> they would still be rejected by the function.

### Step 6 — (Recommended) Set a custom domain

**Site configuration → Domain management → Add a domain** (e.g.
`minutes.lynwoodca.gov`). Netlify provisions HTTPS automatically.

---

## Daily usage (for the Clerk's office)

1. Visit the site URL (or custom domain).
2. Sign in.
3. Choose the meeting transcript (`.txt`) and short agenda (`.pdf`).
4. Click **Generate**. The status panel shows progress as Claude streams.
5. When done, the three Word files appear as download links.
6. Open in Word, verify movers/seconders against the audio using the
   embedded `[HH:MM:SS]` timestamps, fill in real resolution numbers, save.

---

## Local development

```bash
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY and ALLOWED_EMAILS in .env

npx netlify dev   # starts http://localhost:8888 with the function bound
```

Note: Netlify Identity requires the site to be deployed at least once for the
JWT issuer to be available. For local-only smoke testing, you can temporarily
comment out the auth check in `netlify/functions/generate.mjs` — but **never
deploy that to production**.

---

## Customizing the output style

The Word formatting (fonts, indentation, bold/underline rules, tab stops)
lives entirely in `public/docx-builder.js`. To change how the documents
look, edit there — no server redeploy needed for cosmetic tweaks (it's a
static asset).

The instructions Claude follows when extracting content from the transcript
live in the `SYSTEM_PROMPT` constant at the top of
`netlify/functions/generate.mjs`. To teach Claude about a new sub-meeting
type or a new agenda format, edit there.

---

## Cost

| Component        | Cost                                                       |
|------------------|------------------------------------------------------------|
| Netlify hosting  | Free tier (125K function calls/mo, 100GB bandwidth)        |
| Anthropic API    | Per token. ~$0.10–$0.50 per meeting at this transcript size |
| Custom domain    | Whatever you pay your registrar                            |

For two meetings a month, expect ≤ $5/month total.

---

## Security checklist

- [x] API key stored as Netlify environment variable (server-side only)
- [x] `.env` excluded by `.gitignore`
- [x] Function rejects requests without a valid Netlify Identity JWT
- [x] Function rejects emails not in `ALLOWED_EMAILS` (defense in depth)
- [x] Identity registration is **invite-only** (Step 4.2 above)
- [x] HTTPS enforced by Netlify
- [x] No third-party scripts other than Netlify Identity and the docx UMD
       bundle (CDN'd from unpkg)

If you want to remove the unpkg CDN dependency, `npm install docx` and bundle
`docx-builder.js` with esbuild, then change the `<script src=...>` tag in
`index.html` accordingly.
