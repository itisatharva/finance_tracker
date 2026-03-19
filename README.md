# Finance Tracker

A personal finance web app for tracking income, expenses, cash flow, and spending patterns — built with a custom on-device NLP engine, real-time Firestore sync, and full offline support.

**Live:** [https://itisatharva-ft.web.app](https://itisatharva-ft.web.app)

---

## What Makes This Different

Most finance apps require you to fill out forms. Finance Tracker lets you just describe what happened in plain English:

> *"paid 450 for lunch and bought groceries for 1200"*

The app parses that sentence, extracts two separate transactions, classifies each to the right category, and logs both — no dropdowns, no type selection, no fuss. The NLP model runs entirely in the browser, with zero server calls, zero latency, and full offline support.

---

## NLP Engine

### Architecture

The natural language transaction parser is a fully custom pipeline built from scratch and trained on personal spending data. It runs entirely client-side via a compact model loaded as `model.json` and interpreted by `nlp.js`.

**Pipeline stages:**

1. **Sentence splitting** — multi-item inputs like *"rent 15000 and dinner 600"* are split into individual transaction candidates before processing, preserving context across conjunctions and delimiters.

2. **Tokenisation & currency extraction** — amounts are extracted with support for Indian number formatting (lakhs, k-suffixes), decimal values, and currency symbols. Orphaned currency tokens are cleaned to prevent misclassification.

3. **Intent classification** — each candidate sentence is classified as `income`, `expense`, or `unknown` using a bag-of-words model with TF-IDF weighting trained on labelled personal transaction data.

4. **Category classification** — a second classifier maps the sentence to one of 15 personal spending categories using the same training corpus. This is where most of the model's personality comes from — it has been trained specifically on the user's vocabulary, shorthand, and recurring descriptions rather than generic financial corpora.

5. **Confidence thresholding** — predictions below a confidence threshold surface a **New Category Detected** prompt instead of silently misfiling the transaction. The user can confirm, rename, recolour, and save the new category — which is then immediately available for future predictions.

### Training

The model is retrained from a personal CSV export using `retrain_from_csv.py`. The training set is built from real historical transactions, giving the classifier strong priors for recurring merchants, payment methods, and description patterns that generic models cannot replicate.

**Current model stats:**
- ~97% classification accuracy across 15 personal categories
- Trained on hundreds of real transactions
- Weights serialised to `model.json` and loaded synchronously on first use

### Why On-Device

Running inference in the browser rather than calling a cloud API means:

- **No latency** — classification is instant, even mid-sentence
- **No privacy leakage** — transaction descriptions never leave the device
- **Offline capable** — the model is part of the service worker cache and works with no network
- **No API costs** — zero marginal cost per classification

---

## Features

### Core

- **Natural language entry** — type a description in plain English; the NLP engine extracts amount, category, and type automatically
- **Multi-item parsing** — a single input can describe multiple transactions separated by conjunctions or punctuation
- **Real-time sync** via Firebase Firestore — changes propagate instantly across devices
- **Offline-first PWA** — transactions added with no connection are queued locally and synced automatically on reconnect
- **Installable** — add to home screen and launch as a standalone app with no browser chrome

### Analytics

- **Daily view** — compare a selected day against the previous day, with category breakdown
- **Monthly view** — income/expense summary, category breakdown with budget bars, daily spending chart, and automatic insights (savings rate, top category, biggest jump, budget utilisation, daily average)
- **Yearly view** — full category × month matrix with row totals and monthly averages
- **Cash Flow** — month-by-month income, expense, net, and running balance for any year

### Categories & Budgets

- **Per-category budgets** — set monthly limits on expense categories and track progress with visual bars
- **Custom colour picker** — compact circle button per category that opens a floating popover with vivid swatches, pastel swatches, hex input with live preview, and a native OS colour wheel — all without leaving the page
- **Category suggestions** — when the NLP model detects a category that doesn't exist yet, a modal prompts the user to add it with a suggested name, type, colour, and optional budget, then immediately uses it for the current transaction

### Data Management

- **CSV import** — bulk import from a spreadsheet (`Date, Type, Category, Amount, Description`); preview the first 10 rows before committing; imports run in batches of 500
- **CSV export** — full transaction history as a downloadable file
- **Pending amounts** — track unsettled money (loans, split bills) that is deducted from the balance until cleared

### UX

- **Description autocomplete** — the note field suggests previous descriptions for the same category as you type
- **Undo delete** — a 4-second snackbar window lets you recover a deleted transaction before it is removed from Firestore
- **Sync status pills** — each transaction shows a live indicator (Pending → Synced) reflecting Firestore write state
- **Dark mode** — system-aware theme persisted to localStorage
- **Drag to dismiss** — bottom sheets on mobile support a swipe-down gesture

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript, HTML, CSS — no framework, no build step |
| NLP | Custom bag-of-words classifier — `nlp.js` + `model.json` |
| Auth | Firebase Authentication (email + Google OAuth) |
| Database | Firebase Firestore with offline persistence |
| Hosting | Firebase Hosting |
| Charts | Plotly.js |
| Offline / PWA | Service Worker, Web App Manifest |

The deliberate choice of zero frontend dependencies keeps the bundle small, the service worker cache efficient, and the codebase straightforward to audit and extend.

---

## Getting Started

### Sign Up

Visit the app and create an account with either:

- **Email and password** — minimum 6 characters
- **Google** — one-click sign-in via popup

New users land on a **category setup screen** to review and customise the default income and expense categories, assign colours, and set optional monthly budgets. This can be revisited at any time from Settings.

### Adding a Transaction

**Natural language (recommended)**

Type a description in the input field:

```
coffee 80
paid rent 15000
groceries 1200 and petrol 500
received salary 85000
```

The NLP engine fills in category, type, and amount automatically. Review the parsed result, adjust if needed, and hit **Add**.

**Manual form**

Pick a date, select a category from the dropdown, enter an amount, and optionally add a note.

---

## Offline Behaviour

Finance Tracker is a Progressive Web App with a service worker that:

- Caches all app shell assets (HTML, CSS, JS, model weights) on first load
- Serves the full app — including the NLP model — from cache when offline
- Queues Firestore writes locally via Firestore's built-in offline persistence
- Syncs queued transactions automatically on reconnect with per-transaction status feedback
- Shows an offline badge and an in-app update toast after deploys

The service worker cache is versioned by build timestamp via a GitHub Actions CI step, ensuring users always receive fresh assets after a deploy without manual cache busting.

---

## CSV Import Format

```csv
Date,Type,Category,Amount,Description
03/15/2025,expense,Food & Dining,450,Lunch
03/16/2025,income,Salary,85000,March salary
```

| Column | Format |
|---|---|
| Date | MM/DD/YYYY |
| Type | `income` or `expense` (case-insensitive) |
| Category | Must match an existing category name exactly |
| Amount | Positive number |
| Description | Optional; quote if it contains commas |

---

## Privacy & Data

All data lives in your own Firebase Firestore project, partitioned by user ID. Firestore security rules ensure no user can read or write another user's data. The NLP model runs entirely on-device — transaction descriptions are never sent to any server. No analytics, no ads, no third-party data sharing.

---

## Development & Deployment

No build step required. The project is plain HTML/CSS/JS.

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login and deploy
firebase login
firebase deploy
```

A GitHub Actions workflow automatically deploys on push to `main` and stamps the service worker cache version with the build timestamp.

### Project Structure

```
public/
├── index.html            # Main app shell
├── landing.html          # Landing / marketing page
├── login.html            # Authentication page
├── category-setup.html   # First-run category setup
├── 404.html
├── app.js                # Core application logic, NLP integration, UI
├── auth.js               # Authentication flow handlers
├── category-setup.js     # Category setup page logic
├── nlp.js                # On-device NLP inference engine
├── model.json            # Trained classifier weights
├── theme.js              # Theme initialisation (runs before paint)
├── pwa.js                # SW registration, offline pill, install banner
├── sw.js                 # Service worker — cache strategy and asset list
├── styles.css            # All styles (CSS custom properties, dark mode)
├── manifest.json         # PWA manifest
└── icons/                # App icons — all sizes, any + maskable variants
```

### Retraining the NLP Model

```bash
python retrain_from_csv.py --input transactions.csv --output public/model.json
```

The script reads a labelled CSV of historical transactions, computes TF-IDF weights per category, and writes the updated model weights to `model.json`. Deploy as normal after retraining — the service worker will serve the updated model on next load.