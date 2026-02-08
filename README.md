# Finance Tracker App

A simple, fast finance tracking application built with Firebase, HTML, CSS, and JavaScript.

## Features

✅ User authentication (Email/Password & Google Sign-In)
✅ Toggle between Sign In and Sign Up views
✅ **Category Setup** - Custom income and expense categories
✅ **Daily/Monthly/Yearly Views** - Filter transactions by period
✅ **Visual Charts** - Doughnut chart showing expense breakdown
✅ **Auto Date Selection** - Automatically selects today's date
✅ **Indian Rupees (₹)** - Currency formatted for India
✅ **Category Management** - Add/remove categories anytime
✅ Real-time data synchronization
✅ Add transactions with custom dates
✅ Automatic calculation of total income, expenses, and balance
✅ Delete transactions
✅ Secure - each user can only see their own data
✅ Fast and responsive UI with light/dark mode

## File Structure

```
finance-tracker/
│
├── login.html              # Login/Sign up page
├── category-setup.html     # Category selection page (first-time setup)
├── index.html              # Main app dashboard with tabs and charts
├── styles.css              # All styling with light/dark mode
├── firebase-config.js      # Firebase initialization and auth flow
├── auth.js                 # Authentication logic
├── category-setup.js       # Category setup logic
├── app.js                  # Main application logic with charts
└── theme.js                # Light/dark mode toggle
```

## Setup Instructions

### 1. Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing one
3. Click on "Web" icon (</>) to add a web app
4. Register your app and copy the Firebase configuration

### 2. Enable Firebase Services

**Enable Authentication:**
1. In Firebase Console, go to **Authentication**
2. Click **Get Started**
3. Select **Email/Password** under Sign-in providers
4. Enable it and click **Save**
5. Also enable **Google** sign-in provider:
   - Click on **Google** in the sign-in providers list
   - Toggle **Enable**
   - Add your email as Project support email
   - Click **Save**

**Create Firestore Database:**
1. In Firebase Console, go to **Firestore Database**
2. Click **Create Database**
3. Select **Production mode**
4. Choose a location and click **Enable**

### 3. Set Firestore Security Rules

1. Go to **Firestore Database** → **Rules**
2. Replace the rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/transactions/{transaction} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/settings/{setting} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Click **Publish**

### 4. Configure Your App

**Security Note:** Firebase credentials are kept private using environment variables.

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and replace the placeholder values with your Firebase config from [Firebase Console](https://console.firebase.google.com/) → Project Settings → Web App:
   ```
   VITE_FIREBASE_API_KEY=YOUR_API_KEY
   VITE_FIREBASE_AUTH_DOMAIN=YOUR_AUTH_DOMAIN
   VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
   VITE_FIREBASE_STORAGE_BUCKET=YOUR_STORAGE_BUCKET
   VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID
   VITE_FIREBASE_APP_ID=YOUR_APP_ID
   VITE_FIREBASE_MEASUREMENT_ID=YOUR_MEASUREMENT_ID
   ```

3. Install Node.js if not already installed from [nodejs.org](https://nodejs.org/)

4. Install dependencies:
   ```bash
   npm install
   ```

### 5. Run the App

**First, generate the Firebase config from your .env file:**
```bash
npm run build
```

This will create `public/firebase-config.js` from your `.env` file. *(This file is auto-generated and not committed to the repository for security.)*

#### Option A: Local Server (Recommended)
You need a local server because Firebase modules use ES6 imports.

**Using Node.js:**
```bash
npx serve
```

**Using Python:**
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

**Using VS Code:**
Install "Live Server" extension and click "Go Live"

Then open: `http://localhost:8000/login.html`

#### Option B: Deploy to Firebase Hosting
```bash
npm run deploy
```

This will build the Firebase config and deploy to your Firebase Hosting URL.

## Usage

1. **Sign In/Sign Up**: 
   - Default view shows Sign In form
   - Click "Don't have an account? Sign up" to switch to Sign Up form
   - Click "Already have an account? Sign in" to go back
   - Or use "Sign in with Google" button for quick access
   
2. **First-Time Setup**:
   - After signing in for the first time, you'll be taken to category setup
   - Select or add your preferred income and expense categories
   - Click "Continue" to save (or "Skip for Now" to use defaults)
   
3. **Switch Between Views**:
   - Use **Daily**, **Monthly**, or **Yearly** tabs to filter transactions
   - Stats and charts update automatically based on selected period
   
4. **Add Transaction**: 
   - Select type (Income/Expense) - categories update automatically
   - Enter amount in ₹ (Indian Rupees)
   - Select category from your custom categories
   - Date is auto-selected to today (you can change it)
   - Add optional description
   - Click "Add Transaction"
   
5. **View Analytics**: 
   - See total income, expenses, and balance at the top
   - View doughnut chart showing expense breakdown by category
   - All data filters based on selected period (Daily/Monthly/Yearly)
   
6. **Manage Categories**:
   - Click "Manage Categories" button in header
   - Add new categories or remove existing ones
   - Changes apply immediately to the transaction form
   
7. **Delete Transaction**: Click "Delete" button on any transaction

8. **Theme Toggle**: Click the sun/moon icon in top-right to switch between light/dark mode

9. **Sign Out**: Click "Sign Out" button in the header

## Data Structure

Each user's data is stored in Firestore as:

```
users/{userId}/
  transactions/{transactionId}
    - type: "income" | "expense"
    - amount: number
    - category: string
    - description: string
    - date: timestamp (when created)
    - selectedDate: timestamp (user-selected date)
    
  settings/
    categories/
      - income: ["Salary", "Freelance", ...]
      - expense: ["Food & Dining", "Transport", ...]
      - setupCompleted: boolean
```

## Security

- Each user can only access their own data
- Firebase Authentication ensures secure login
- Firestore security rules prevent unauthorized access
- All data is stored securely in Google Cloud

## Browser Compatibility

Works on all modern browsers:
- Chrome
- Firefox
- Safari
- Edge

## Troubleshooting

**"Firebase not defined" error:**
- Make sure you're running the app through a local server, not opening the HTML file directly

**Can't sign in/sign up:**
- Check that Email/Password authentication is enabled in Firebase Console
- Verify your Firebase config is correct

**Transactions not showing:**
- Check Firestore security rules are set correctly
- Check browser console for errors

## License

Free to use and modify for personal and commercial projects.
