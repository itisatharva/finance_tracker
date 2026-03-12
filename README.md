# Finance Tracker

A personal finance web app for tracking income, expenses, cash flow, and spending patterns — with full offline support and real-time sync.

**Live:** [https://itisatharva-ft.web.app](https://itisatharva-ft.web.app)

---

## Features

- **Real-time sync** via Firebase Firestore — changes appear instantly across devices
- **Offline-first PWA** — add transactions with no internet connection; they queue locally and sync automatically when you reconnect
- **Installable** — add to your home screen and launch like a native app, with no browser chrome
- **Analytics** — daily, monthly, yearly, and cash flow views with interactive Plotly charts
- **Monthly insights** — automatic analysis of spending trends, savings rate, top categories, and budget utilisation
- **Per-category budgets** — set monthly budget limits and track progress with visual bars and alerts
- **CSV import / export** — bulk import transactions from a spreadsheet or export your full history
- **Dark mode** — system-aware theme that persists across sessions

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript, HTML, CSS |
| Auth | Firebase Authentication (email + Google) |
| Database | Firebase Firestore (offline persistence enabled) |
| Hosting | Firebase Hosting |
| Charts | Plotly.js |
| Offline / PWA | Service Worker, Web App Manifest |

---

## Getting Started

### Sign Up

Visit the app URL and create an account with either:

- **Email and password** — minimum 6 characters
- **Google** — one-click sign-in via popup

New users are taken to a one-time **category setup screen** to review and customise default income and expense categories. This can be edited at any time from Settings.

### Sign In

Returning users land directly on the dashboard after authenticating.

---

## Dashboard

The main screen, divided into four sections.

### Stats Row

| Card | What it shows |
|---|---|
| **Income** | Total income for the current calendar month |
| **Expenses** | Total expenses for the current calendar month |
| **Balance** | Starting balance + all-time income − all-time expenses − pending amounts |
| **Pending** | Sum of all uncleared pending amounts |

### Add Transaction

1. Pick a date (defaults to today)
2. Select a category — the app infers income vs. expense automatically
3. Enter the amount (decimals supported)
4. Optionally add a note — the field suggests previous descriptions for the same category as you type
5. Click **Add Transaction**

When offline, the button shows an amber **"Saved offline — will sync"** state. Once reconnected, the transaction syncs automatically and the pill updates to **Synced**.

### Pending Amounts

Pending amounts represent unsettled money (e.g. a loan or split bill). They are deducted from your balance so it always reflects what is actually available. Check the checkbox next to a pending item to clear it once settled.

### Recent Transactions

The 5 most recent transactions, sorted by date. Each item shows category, optional note, date, and amount. Tap any row to open the **Transaction Detail panel** with full metadata. Edit and delete are available inline or from the detail panel.

**Deleting** shows an inline confirmation row. Check *"Don't ask again"* to skip confirmations for the rest of the session — this preference resets on sign-out.

---

## Transactions Tab

Every transaction ever recorded, sorted newest first. Supports:

- **Search** — filters by description or category (debounced for performance)
- **Category filter** — dropdown of all categories present in your data
- **Type filter** — income or expense only

The header shows a live count of results vs. total.

---

## Analytics

Four views, selectable from the tab bar.

### Daily

Pick any date to compare that day's expenses against the previous day. Includes a category breakdown pie chart.

### Monthly

Pick a month to see:

- Total income and expense summary with month-over-month comparison
- Category breakdown list sorted by spend, with optional budget progress bars
- Daily spending line chart for the selected month
- **Monthly Insights panel** — automatic cards covering total spending, net savings, income change, top category, biggest category jump, budget utilisation, daily average, and transaction count

Toggle between **Expense** and **Income** views.

### Yearly

Enter a year to see a table of all categories × months with totals and monthly averages per row. Toggle between expense and income.

### Cash Flow

Enter a year to see a month-by-month table: income, expenses, net, and a running balance carried forward from your starting balance. The opening balance for the selected year accounts for all prior transactions automatically.

---

## Settings

Accessible via the ⚙ icon (top right) or the bottom nav on mobile.

| Setting | Description |
|---|---|
| **Starting Balance** | Your account balance before you started tracking. Used as the base for Balance and Cash Flow. |
| **Categories** | Add, recolour, or remove income and expense categories. Set optional monthly budgets on expense categories. |
| **Profile Name** | Display name shown in the greeting header. Stored locally. |
| **Import CSV** | Bulk-import transactions. Expected format: `Date (MM/DD/YYYY), Type, Category, Amount, Description`. A preview step shows the first 10 rows before committing. Imports run in batches of 500 for reliability. |
| **Export CSV** | Downloads all transactions as a CSV file. |
| **Dark Mode** | Toggle light/dark theme. Saved to localStorage. |
| **Sign Out** | Ends the session and returns to the login page. |

---

## Offline Behaviour

Finance Tracker is a Progressive Web App with a service worker that:

- Caches all app shell assets on first load
- Serves the full app from cache when offline
- Queues Firestore writes locally (via Firestore's offline persistence)
- Syncs queued transactions automatically on reconnect
- Shows an offline indicator badge and per-transaction sync status pills

A versioned cache (stamped at build time by CI) ensures users always get the latest assets after a deploy, with an in-app update toast prompting a reload.

---

## CSV Import Format

```
Date,Type,Category,Amount,Description
03/15/2025,expense,Food & Dining,450,Lunch at Smoke House
03/16/2025,income,Salary,85000,March salary
```

- **Date** — MM/DD/YYYY
- **Type** — `income` or `expense` (case-insensitive)
- **Category** — must match an existing category name
- **Amount** — positive number
- **Description** — optional; wrap in quotes if it contains commas

---

## Privacy & Data

All data lives in your own Firebase Firestore project, partitioned by user ID. Firestore security rules prevent any user from reading or writing another user's data. No analytics, no ads, no third-party data sharing.

---

## Development & Deployment

The project is plain HTML/CSS/JS with no build step required.

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login and deploy
firebase login
firebase deploy
```

A GitHub Actions workflow automatically deploys on push to `main`. It also stamps the service worker cache version with the build timestamp so users always receive the latest assets.

### Folder structure

```
public/
├── index.html          # Main app shell
├── landing.html        # Marketing / landing page
├── login.html          # Auth page
├── category-setup.html # First-run category setup
├── 404.html
├── app.js              # Core application logic
├── auth.js             # Authentication handlers
├── category-setup.js   # Category setup logic
├── theme.js            # Theme initialisation
├── pwa.js              # Service worker registration, offline pill, install banner
├── sw.js               # Service worker (cache strategy)
├── styles.css          # All styles
├── manifest.json       # PWA manifest
└── icons/              # App icons (all sizes + maskable variants)