# 💰 Finance Tracker - Complete Fixed Version

A modern, feature-rich personal finance tracker with analytics, built with vanilla JavaScript and Firebase.

## ✨ Features

### Dashboard
- 📊 Real-time stats (Income, Expenses, Balance, Pending)
- ➕ Quick transaction entry
- 📝 Pending amounts tracking
- 📜 Recent transactions list with edit/delete
- ⚙️ Settings panel (account, theme, categories, sign out)

### Analytics
- 📅 **Daily**: Compare today vs yesterday spending with chart
- 📆 **Monthly**: Category breakdown in descending order with chart
- 📋 **Yearly**: Spreadsheet-style table (categories × months)

### Design
- 🎨 Beige/Black color scheme
- 🌙 Fully functional dark mode
- 📱 Responsive mobile design
- ⚡ Fast loading
- 🎯 Professional UI

### Smart Features
- 🤖 Auto-detect income/expense from category
- ✏️ Edit any transaction
- 📳 Haptic feedback on mobile
- 🎬 Loading animations
- 🎨 Custom category colors
- 💾 Real-time sync with Firebase

---

## 🚀 Quick Start

### 1. Clone or Download

```bash
git clone https://github.com/YOUR_USERNAME/finance-tracker.git
cd finance-tracker
```

### 2. Update Firebase Config

Edit `public/firebase-config.js`:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

Get these from: [Firebase Console](https://console.firebase.google.com/) → Your Project → Project Settings → Your apps

### 3. Set Up Firestore Rules

In Firebase Console → Firestore Database → Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/transactions/{transaction} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/settings/{setting} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/pending/{pendingId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 4. Deploy to Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize (select Hosting)
firebase init

# Deploy
firebase deploy
```

---

## 📁 File Structure

```
finance-tracker/
├── public/
│   ├── index.html          # Main app (Dashboard & Analytics)
│   ├── login.html          # Authentication page
│   ├── app.js             # Main application logic
│   ├── auth.js            # Login/signup logic
│   ├── styles.css         # All styles (light & dark mode)
│   ├── theme.js           # Theme toggle functionality
│   └── firebase-config.js # Firebase configuration
├── firebase.json          # Firebase config
├── .gitignore            # Git ignore file
└── README.md             # This file
```

---

## 🎯 How to Use

### First Time Setup
1. Open the app
2. Sign up with email/password
3. Categories are pre-configured
4. Start adding transactions!

### Adding Transactions
1. Select **Date**
2. Choose **Category** (auto-detects income/expense)
3. Enter **Amount**
4. Add optional **Note**
5. Click "Add Transaction"
6. See loading animation → "✓ Added!"

### Managing Pending Amounts
1. Enter person's name
2. Enter amount
3. Click "Add Pending"
4. Check off when cleared
5. Balance updates automatically

### Viewing Analytics

**Daily View:**
- Pick any date
- See comparison to yesterday
- View pie chart of expenses

**Monthly View:**
- Select month/year
- See pie chart
- View categories sorted high to low

**Yearly View:**
- Enter year
- See spreadsheet table
- Categories × Months with totals

### Settings
Click ⚙️ icon (top-right) to:
- View account info
- Toggle dark mode
- Manage categories
- Sign out

---

## 🎨 Color Scheme

### Light Mode
- Background: `#F5F3F0` (Light beige)
- Cards: `#FFFFFF` (White)
- Primary: `#2D2D2D` (Black)
- Accent: `#E8DED3` (Beige)

### Dark Mode
- Background: `#1a1a1a` (Dark)
- Cards: `#2a2a2a` (Dark gray)
- Primary: `#E8E6E1` (Light text)
- Accent: `#3a3a3a` (Dark beige)

### Data Colors
- Income: `#10b981` (Green)
- Expense: `#FF6B6B` (Red)
- Pending: `#FFA500` (Orange)

---

## 🔧 Customization

### Add New Categories

1. Click settings icon ⚙️
2. Click "Manage Categories"
3. Scroll to Income or Expense section
4. Enter category name
5. Pick color
6. Click "Add"

### Change Category Colors

1. Open "Manage Categories"
2. Click color box next to category
3. Pick new color
4. Saves automatically

---

## 📱 Mobile Experience

- Fully responsive design
- Touch-optimized buttons
- Haptic feedback (vibration)
- Swipe-friendly
- Bottom navigation
- Optimized for small screens

---

## 🐛 Troubleshooting

### Login page loads slowly
- Should be instant now
- Emergency 5-second timeout included
- Check internet connection

### Dark mode text not readable
- Fixed! All contrasts proper
- `--text-primary` always readable
- Test by toggling in settings

### Transactions not saving
- Check Firebase credentials
- Verify Firestore rules
- Check browser console for errors

### Charts not showing
- Need expense transactions
- Select correct date/month/year
- Check that period has data

---

## 🚀 Deployment

### Firebase Hosting

```bash
firebase deploy
```

### GitHub Pages

1. Push to GitHub
2. Go to Settings → Pages
3. Source: main branch / root
4. Save
5. Visit: https://YOUR_USERNAME.github.io/finance-tracker

---

## 📊 Data Structure

### Transactions
```javascript
{
  type: "expense",
  amount: 500,
  category: "Food & Dining",
  description: "Lunch",
  selectedDate: Date,
  createdAt: Timestamp
}
```

### Categories
```javascript
{
  income: [
    { name: "Salary", color: "#10b981" }
  ],
  expense: [
    { name: "Food & Dining", color: "#ef4444" }
  ]
}
```

### Pending
```javascript
{
  name: "John",
  amount: 5000,
  createdAt: Timestamp
}
```

---

## 🎉 Features Checklist

- [x] User authentication (email/password)
- [x] Add/Edit/Delete transactions
- [x] Auto-detect income/expense from category
- [x] Pending amounts tracking
- [x] Real-time stats
- [x] Daily analytics with comparison
- [x] Monthly analytics with breakdown
- [x] Yearly table view
- [x] Custom category colors
- [x] Dark mode
- [x] Settings panel
- [x] Account info
- [x] Loading animations
- [x] Haptic feedback
- [x] Responsive design
- [x] Fast loading
- [x] Proper error handling

---

## 📝 License

MIT License - Feel free to use for personal projects!

---

## 🙏 Credits

Built with:
- Vanilla JavaScript
- Firebase (Auth + Firestore)
- Chart.js
- Love ❤️

---

## 📞 Support

Having issues? Check:
1. Firebase credentials are correct
2. Firestore rules are set
3. Browser console for errors
4. Internet connection

---

**Enjoy tracking your finances!** 💰✨
