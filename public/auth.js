// Authentication functions for login page

// Wait for Firebase to be ready
function waitForFirebase(callback) {
    if (window.auth && window.createUserWithEmailAndPassword) {
        callback();
    } else {
        setTimeout(() => waitForFirebase(callback), 100);
    }
}

// Show loading
function showLoading() {
    document.getElementById('pageLoader').classList.add('active');
}

// Hide loading
function hideLoading() {
    document.getElementById('pageLoader').classList.remove('active');
}

// Toggle between Sign In and Sign Up forms
function showSignUp() {
    document.getElementById('signInForm').classList.add('hidden');
    document.getElementById('signUpForm').classList.remove('hidden');
}

function showSignIn() {
    document.getElementById('signUpForm').classList.add('hidden');
    document.getElementById('signInForm').classList.remove('hidden');
}

// Sign In with Email/Password
async function signIn() {
    const email = document.getElementById('signInEmail').value;
    const password = document.getElementById('signInPassword').value;
    const btn = document.getElementById('signInBtn');

    if (!email || !password) {
        alert('Please enter both email and password');
        return;
    }

    // Show loading
    btn.classList.add('btn-loading');
    btn.textContent = '';
    showLoading();

    try {
        await window.signInWithEmailAndPassword(window.auth, email, password);
        // User will be automatically redirected by onAuthStateChanged in firebase-config.js
    } catch (error) {
        // Hide loading on error
        btn.classList.remove('btn-loading');
        btn.textContent = 'Sign In';
        hideLoading();

        if (error.code === 'auth/user-not-found') {
            alert('No account found with this email');
        } else if (error.code === 'auth/wrong-password') {
            alert('Incorrect password');
        } else if (error.code === 'auth/invalid-email') {
            alert('Invalid email address');
        } else if (error.code === 'auth/invalid-credential') {
            alert('Invalid email or password');
        } else {
            alert('Error: ' + error.message);
        }
    }
}

// Sign Up with Email/Password
async function signUp() {
    const email = document.getElementById('signUpEmail').value;
    const password = document.getElementById('signUpPassword').value;
    const btn = document.getElementById('signUpBtn');

    if (!email || !password) {
        alert('Please enter both email and password');
        return;
    }

    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }

    // Show loading
    btn.classList.add('btn-loading');
    btn.textContent = '';
    showLoading();

    try {
        await window.createUserWithEmailAndPassword(window.auth, email, password);
        // User is automatically signed in and will be redirected by onAuthStateChanged
    } catch (error) {
        // Hide loading on error
        btn.classList.remove('btn-loading');
        btn.textContent = 'Create Account';
        hideLoading();

        if (error.code === 'auth/email-already-in-use') {
            alert('Email already in use. Try signing in instead.');
        } else if (error.code === 'auth/invalid-email') {
            alert('Invalid email address');
        } else if (error.code === 'auth/weak-password') {
            alert('Password is too weak');
        } else {
            alert('Error: ' + error.message);
        }
    }
}

// Sign In with Google
async function signInWithGoogle() {
    // Show loading
    showLoading();

    try {
        await window.signInWithPopup(window.auth, window.googleProvider);
        // User will be automatically redirected by onAuthStateChanged in firebase-config.js
    } catch (error) {
        // Hide loading on error
        hideLoading();

        if (error.code === 'auth/popup-closed-by-user') {
            // User closed the popup, do nothing
            return;
        } else if (error.code === 'auth/cancelled-popup-request') {
            // Another popup was already open, do nothing
            return;
        } else {
            alert('Error signing in with Google: ' + error.message);
        }
    }
}

// Allow Enter key to submit
waitForFirebase(() => {
    // Sign In form Enter key
    const signInInputs = document.querySelectorAll('#signInEmail, #signInPassword');
    signInInputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                signIn();
            }
        });
    });

    // Sign Up form Enter key
    const signUpInputs = document.querySelectorAll('#signUpEmail, #signUpPassword');
    signUpInputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                signUp();
            }
        });
    });
});
