#!/usr/bin/env node

/**
 * Build script to generate firebase-config.js from .env file
 * This ensures Firebase credentials are not committed to the repository
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found!');
    console.error('Please copy .env.example to .env and fill in your Firebase credentials.');
    process.exit(1);
}

// Parse .env file
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};

envContent.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, value] = trimmedLine.split('=');
        if (key && value) {
            // Remove quotes if present
            envVars[key.trim()] = value.trim().replace(/^["']|["']$/g, '');
        }
    }
});

// Required Firebase config keys
const requiredKeys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MEASUREMENT_ID'
];

// Validate all required keys are present
const missingKeys = requiredKeys.filter(key => !envVars[key]);
if (missingKeys.length > 0) {
    console.error('Error: Missing required Firebase credentials in .env:');
    missingKeys.forEach(key => console.error(`  - ${key}`));
    process.exit(1);
}

// Generate firebase-config.js with SAFETY TIMEOUT
const configContent = `// Firebase Configuration and Initialization
// DO NOT COMMIT THIS FILE - It is generated from .env
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, serverTimestamp, setDoc, getDoc, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


const firebaseConfig = {
  apiKey: "${envVars['VITE_FIREBASE_API_KEY']}",
  authDomain: "${envVars['VITE_FIREBASE_AUTH_DOMAIN']}",
  projectId: "${envVars['VITE_FIREBASE_PROJECT_ID']}",
  storageBucket: "${envVars['VITE_FIREBASE_STORAGE_BUCKET']}",
  messagingSenderId: "${envVars['VITE_FIREBASE_MESSAGING_SENDER_ID']}",
  appId: "${envVars['VITE_FIREBASE_APP_ID']}",
  measurementId: "${envVars['VITE_FIREBASE_MEASUREMENT_ID']}"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Export Firebase services
window.auth = auth;
window.db = db;
window.googleProvider = googleProvider;

// Export Firestore functions
window.collection = collection;
window.addDoc = addDoc;
window.query = query;
window.orderBy = orderBy;
window.onSnapshot = onSnapshot;
window.deleteDoc = deleteDoc;
window.doc = doc;
window.serverTimestamp = serverTimestamp;
window.setDoc = setDoc;
window.getDoc = getDoc;
window.where = where;

// Export Auth functions
window.createUserWithEmailAndPassword = createUserWithEmailAndPassword;
window.signInWithEmailAndPassword = signInWithEmailAndPassword;
window.fbSignOut = signOut;           // ← app.js calls window.fbSignOut()
window.signOutFirebase = signOut;     // ← keep alias for backwards compat
window.onAuthStateChanged = onAuthStateChanged;
window.signInWithPopup = signInWithPopup;
window.GoogleAuthProvider = GoogleAuthProvider;  // ← auth.js uses new window.GoogleAuthProvider()

// Mark Firebase as initializing
window.firebaseInitialized = false;

// Create a promise that resolves when Firebase is ready
window.firebaseReady = new Promise((resolve) => {
    console.log('Creating firebaseReady promise...');
    
    function checkReady() {
        const authReady = window.auth && String(window.auth).includes('Auth');
        const signOutReady = window.signOutFirebase && typeof window.signOutFirebase === 'function';
        const dbReady = window.db && String(window.db).includes('Firestore');
        
        console.log('Firebase readiness check:', { authReady, signOutReady, dbReady });
        
        if (authReady && signOutReady && dbReady) {
            console.log('✓ Firebase is fully initialized and ready');
            window.firebaseInitialized = true;
            resolve(true);
            return true;
        }
        return false;
    }
    
    // Try immediately
    if (checkReady()) return;
    
    // Check periodically if not ready
    const interval = setInterval(() => {
        if (checkReady()) clearInterval(interval);
    }, 50);
    
    // Safety timeout - resolve after 10 seconds anyway
    setTimeout(() => {
        clearInterval(interval);
        if (!window.firebaseInitialized) {
            console.warn('⚠ Firebase initialization timeout - resolving anyway');
            window.firebaseInitialized = true;
        }
        resolve(true);
    }, 10000);
});

console.log('Firebase exports initialized, firebaseReady promise created');

// CRITICAL FIX: Safety fallback — redirect to login after 4s if auth hasn't resolved
// (Covers slow Firebase CDN loads, offline states, etc.)
let authStateReceived = false;
setTimeout(() => {
    if (!authStateReceived) {
        console.warn('⚠️ Auth state not received after 4 seconds — redirecting to login');
        const currentPage = window.location.pathname;
        if (!currentPage.includes('login.html')) {
            window.location.replace('login.html');
        } else {
            // Already on login, just unhide it
            document.documentElement.classList.remove('page-locked');
            const loader = document.getElementById('pageLoader');
            if (loader) loader.remove();
        }
    }
}, 4000);

// Auth state observer - redirects to appropriate page and protects routes
let authInitialized = false;

onAuthStateChanged(auth, async (user) => {
    authStateReceived = true; // Mark that we received auth state
    const currentPage = window.location.pathname;
    authInitialized = true;
    
    // Log for debugging
    console.log('Auth state changed:', user ? 'User logged in' : 'User logged out', 'Page:', currentPage);
    
    if (user) {
        // User is logged in
        // Show page content (hide loader)
        const pageLoader = document.getElementById('pageLoader');
        if (pageLoader) pageLoader.classList.remove('active');
        
        // Remove the page-locked class to show content
        document.documentElement.classList.remove('page-locked');
        
        if (currentPage.includes('login.html')) {
            // Check if user has completed category setup
            try {
                const categoriesDoc = await getDoc(doc(db, 'users', user.uid, 'settings', 'categories'));
                
                if (categoriesDoc.exists() && categoriesDoc.data().setupCompleted) {
                    // Setup completed, go to main app
                    console.log('Setup completed, redirecting to index.html');
                    window.location.href = 'index.html';
                } else {
                    // Setup not completed, go to category setup
                    console.log('Setup not completed, redirecting to category-setup.html');
                    window.location.href = 'category-setup.html';
                }
            } catch (error) {
                console.error('Error checking setup:', error);
                // If error, go to category setup to be safe
                window.location.href = 'category-setup.html';
            }
        } else if (currentPage.includes('category-setup.html')) {
            // Check if already completed setup
            try {
                const categoriesDoc = await getDoc(doc(db, 'users', user.uid, 'settings', 'categories'));
                if (categoriesDoc.exists() && categoriesDoc.data().setupCompleted) {
                    console.log('Setup already completed, redirecting to index.html');
                    window.location.href = 'index.html';
                }
            } catch (error) {
                console.error('Error:', error);
            }
        }
    } else {
        // User is not logged in
        if (!currentPage.includes('login.html')) {
            // Redirect to login for protected pages
            console.log('User not authenticated, redirecting to login.html');
            window.location.href = 'login.html';
        } else {
            // Login page is allowed, show content
            const pageLoader = document.getElementById('pageLoader');
            if (pageLoader) pageLoader.classList.remove('active');
            document.documentElement.classList.remove('page-locked');
        }
    }
});
`;

// Write firebase-config.js
const outputPath = path.join(__dirname, 'public', 'firebase-config.js');
fs.writeFileSync(outputPath, configContent);
console.log(`✓ firebase-config.js generated successfully at ${outputPath}`);
console.log('✓ Firebase credentials are secure (from .env file)');
console.log('✓ Safety timeout added for blank page fix');