// Firebase Configuration and Initialization
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, serverTimestamp, setDoc, getDoc, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


const firebaseConfig = {
  apiKey: "REDACTED",
  authDomain: "itisatharva-ft.firebaseapp.com",
  projectId: "itisatharva-ft",
  storageBucket: "itisatharva-ft.firebasestorage.app",
  messagingSenderId: "1038076060696",
  appId: "1:1038076060696:web:4eabd0a57666554e7d4f6d",
  measurementId: "G-4T05PGMBCK"
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
window.signOutFirebase = signOut;
window.onAuthStateChanged = onAuthStateChanged;
window.signInWithPopup = signInWithPopup;

// Auth state observer - redirects to appropriate page
onAuthStateChanged(auth, async (user) => {
    const currentPage = window.location.pathname;
    
    if (user) {
        // User is logged in
        if (currentPage.includes('login.html')) {
            // Check if user has completed category setup
            try {
                const categoriesDoc = await getDoc(doc(db, 'users', user.uid, 'settings', 'categories'));
                
                if (categoriesDoc.exists() && categoriesDoc.data().setupCompleted) {
                    // Setup completed, go to main app
                    window.location.href = 'index.html';
                } else {
                    // Setup not completed, go to category setup
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
                    window.location.href = 'index.html';
                }
            } catch (error) {
                console.error('Error:', error);
            }
        }
    } else {
        // User is not logged in
        if (!currentPage.includes('login.html')) {
            window.location.href = 'login.html';
        }
    }
});
