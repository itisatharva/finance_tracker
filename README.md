# Finance Tracker

A personal finance web application for tracking income, expenses, pending amounts, and spending patterns over time. Built with vanilla JavaScript and Firebase.

Live: [https://itisatharva-ft.web.app]

---

## Overview

Finance Tracker is a real-time, single-user web app that syncs data instantly to Firebase Firestore. It works in any modern browser on both desktop and mobile.

All data is private — Firestore security rules ensure each user can only access their own transactions, categories, and settings.

---

## Getting Started

### Creating an Account

Navigate to the app URL and you will land on the login page. You can sign up using:

- **Email and password** — enter your email, choose a password of at least 6 characters, and click Join.
- **Google** — click "Join with Google" and complete the Google sign-in flow.

After signing up, you will be taken to the category setup screen. This is a one-time step where you can review the default categories or customise them before continuing to the dashboard. You can always edit categories later from Settings.

### Signing In

On the login screen, enter your credentials or use Google Sign-In. Returning users are taken directly to the dashboard.

---

## Dashboard

The dashboard is the main screen of the app. It is divided into four sections.

### Stats Row

At the top of the dashboard, four cards display:

- **Income** — total income added in the current calendar month.
- **Expenses** — total expenses added in the current calendar month. Resets to zero at the start of each month.
- **Balance** — your all-time balance: starting balance plus all income minus all expenses minus pending amounts. This is designed to match your actual bank account.
- **Pending** — the sum of all currently uncleared pending amounts.

### Add Transaction

To add a transaction:

1. Select the date using the date picker. It defaults to today.
2. Select a category from the dropdown. The app automatically determines whether the transaction is income or expense based on the category type.
3. Enter the amount. Decimals are supported.
4. Optionally add a note to describe the transaction.
5. Click Add Transaction. The button will confirm with a green tick once saved.

Transactions are saved in real time to Firestore and appear immediately in the Recent Transactions list.

### Pending Amounts

Pending amounts represent money owed to or from someone that has not yet been settled. They are deducted from your balance so that your balance always reflects what is actually available.

To add a pending amount, enter a name or description and an amount, then click Add. To clear a pending amount once it has been settled, check the checkbox next to it. It will be removed and the balance will update automatically.

### Recent Transactions

The 20 most recent transactions are shown here, sorted by transaction date. Each entry shows the category, optional note, date, and amount. Income is shown in green and expenses in red.

Each transaction has two actions:

- **Edit** — opens a modal where you can change the date, category, amount, and note. Save to update.
- **Delete** — shows a confirmation dialog before deleting. You can check "Don't ask again" to skip the confirmation for future deletes in the same session.

---

## Transactions

The Transactions tab shows every transaction ever recorded, sorted by date descending. The total count is displayed at the top. Edit and delete work the same as on the dashboard.

---

## Analytics

The Analytics tab has four views selectable from the tab bar at the top.

### Daily

Select any date to see the total expenses for that day compared to the previous day. An arrow indicates whether spending went up or down. A doughnut chart breaks down expenses by category for the selected day.

### Monthly

Select a month and year to see:

- A summary showing total income and total expenses for that month.
- A doughnut chart breaking down expenses by category.
- A category breakdown list sorted from highest to lowest spend.

### Yearly

Enter a year to see a table of expense categories versus months. Each cell shows the total spent in that category for that month. The rightmost columns show the annual total and monthly average for each category.

### Cash Flow

Enter a year to see a month-by-month cash flow table showing income, expenses, net (income minus expenses), and a running balance that carries forward from your starting balance. The starting balance is set in Settings.

---

## Settings

The settings panel is accessible via the gear icon in the top right corner.

### Starting Balance

Enter your bank account balance as it was before you started tracking in this app. This is used as the base for the Balance stat and the Cash Flow running balance. It does not affect income or expense totals.

### Categories

Opens the category manager where you can:

- Add new income or expense categories with a custom name and colour.
- Change the colour of existing categories by clicking the colour swatch.
- Remove categories you no longer need.

Category changes take effect immediately for all future transactions. Existing transactions retain the category name they were saved with.

### Dark Mode

Toggles between light and dark theme. The preference is saved to the browser and applied on every subsequent visit.

### Sign Out

Signs you out of the current session and returns you to the login page.

---

## Data and Privacy

All data is stored in your Firebase Firestore database under your user account. No data is shared with any third party. Firestore security rules prevent any user from reading or writing another user's data. Deleting your account from Firebase will permanently remove all associated data.

---

## Technology

- Vanilla JavaScript, HTML, CSS — no frontend framework
- Firebase Authentication — email/password and Google sign-in
- Firebase Firestore — real-time database
- Firebase Hosting — deployment
- Chart.js — analytics charts

