#!/usr/bin/env node

/**
 * Build script — generates public/firebase-config.js from .env
 */

const fs   = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('Error: .env file not found!');
  process.exit(1);
}

const envVars = {};
fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      envVars[key] = val;
    }
  }
});

const required = [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_MEASUREMENT_ID'
];
const missing = required.filter(k => !envVars[k]);
if (missing.length) {
  console.error('Missing required keys in .env:', missing.join(', '));
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// THIS IS THE FILE THAT GETS DEPLOYED.
// DO NOT use onAuthStateChanged for routing — it fires on every token refresh
// (every hour), causing a redirect loop. Use auth.authStateReady() instead:
// it resolves EXACTLY ONCE after the persisted session is read from IndexedDB.
// ─────────────────────────────────────────────────────────────────────────────
const configContent = `import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult,
  GoogleAuthProvider, signOut as fbSignOut, getAdditionalUserInfo
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "${envVars['VITE_FIREBASE_API_KEY']}",
  authDomain:        "${envVars['VITE_FIREBASE_AUTH_DOMAIN']}",
  projectId:         "${envVars['VITE_FIREBASE_PROJECT_ID']}",
  storageBucket:     "${envVars['VITE_FIREBASE_STORAGE_BUCKET']}",
  messagingSenderId: "${envVars['VITE_FIREBASE_MESSAGING_SENDER_ID']}",
  appId:             "${envVars['VITE_FIREBASE_APP_ID']}",
  measurementId:     "${envVars['VITE_FIREBASE_MEASUREMENT_ID']}"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

window.auth = auth;
window.db   = db;
window.onAuthStateChanged             = onAuthStateChanged;
window.signInWithEmailAndPassword     = signInWithEmailAndPassword;
window.createUserWithEmailAndPassword = createUserWithEmailAndPassword;
window.signInWithPopup                = signInWithPopup;
window.signInWithRedirect             = signInWithRedirect;
window.getRedirectResult              = getRedirectResult;
window.GoogleAuthProvider             = GoogleAuthProvider;
window.getAdditionalUserInfo          = getAdditionalUserInfo;
window.fbSignOut                      = fbSignOut;
window.signOutFirebase                = fbSignOut;
window.collection    = collection;   window.doc         = doc;
window.getDoc        = getDoc;       window.setDoc      = setDoc;
window.addDoc        = addDoc;       window.deleteDoc   = deleteDoc;
window.query         = query;        window.orderBy     = orderBy;
window.onSnapshot    = onSnapshot;   window.serverTimestamp = serverTimestamp;
window.firebaseReady = Promise.resolve();

const _path       = window.location.pathname;
const onLoginPage = _path.includes('login');
const onSetupPage = _path.includes('category-setup');
const onAppPage   = !onLoginPage && !onSetupPage;

window._authHandled = false;

let _initialDone = false;

auth.authStateReady().then(() => {
  _initialDone = true;
  if (window._authHandled) return;

  const user = auth.currentUser;

  if (!user) {
    if (onAppPage || onSetupPage) {
      window._authHandled = true;
      window.location.replace('login.html');
      return;
    }
    hideLoader();
    return;
  }

  if (onLoginPage) {
    window._authHandled = true;
    window.location.replace('index.html');
    return;
  }

  hideLoader();

}).catch(err => {
  console.warn('authStateReady error:', err);
  _initialDone = true;
  if (!window._authHandled) {
    if (onAppPage || onSetupPage) {
      window._authHandled = true;
      window.location.replace('login.html');
    } else {
      hideLoader();
    }
  }
});

onAuthStateChanged(auth, user => {
  if (!_initialDone) return;
  if (window._authHandled) return;
  if (!user && onAppPage) {
    window._authHandled = true;
    window.location.replace('login.html');
  }
});

setTimeout(() => {
  if (!document.getElementById('pageLoader')) return;
  console.warn('Safety timeout: force-removing loader');
  hideLoader();
  if (!_initialDone && (onAppPage || onSetupPage)) {
    window.location.replace('login.html');
  }
}, 6000);

function hideLoader() {
  const l = document.getElementById('pageLoader');
  if (l) { l.style.opacity = '0'; setTimeout(() => l.remove(), 300); }
  document.documentElement.classList.remove('page-locked');
}
`;

const outputPath = path.join(__dirname, 'public', 'firebase-config.js');
fs.writeFileSync(outputPath, configContent);
console.log('✓ firebase-config.js generated successfully');

// ── Cache-bust HTML files ─────────────────────────────────────────────────────
// Appends ?v=TIMESTAMP to all local JS and CSS refs in every HTML file.
// This forces browsers (especially mobile Safari) to fetch fresh assets
// on every deploy without requiring manual cache clearing.
const version  = Date.now();
const htmlFiles = ['index.html', 'login.html', 'category-setup.html'];
htmlFiles.forEach(filename => {
  const htmlPath = path.join(__dirname, 'public', filename);
  if (!fs.existsSync(htmlPath)) return;
  let html = fs.readFileSync(htmlPath, 'utf-8');
  // Strip any existing ?v=... then add the new one — local files only
  html = html.replace(/(src|href)="([^"]+\.(js|css))(\?v=[^"]*)?"/g, (m, attr, file) => {
    if (file.startsWith('http') || file.startsWith('//')) return m;
    return `${attr}="${file}?v=${version}"`;
  });
  fs.writeFileSync(htmlPath, html);
  console.log(`✓ ${filename} cache-busted with ?v=${version}`);
});