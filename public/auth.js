// auth.js — handles sign-in and join (no firebaseReady needed, runs after firebase-config.js)

const GOOGLE_ICON = `<svg width="17" height="17" viewBox="0 0 18 18" style="flex-shrink:0;display:block"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>`;

// ── Error messages ─────────────────────────────────────────────────────────
const ERR = {
  'auth/invalid-credential':   'Incorrect email or password.',
  'auth/user-not-found':       'No account found with that email.',
  'auth/wrong-password':       'Incorrect password.',
  'auth/email-already-in-use': 'That email is already registered.',
  'auth/invalid-email':        'Enter a valid email address.',
  'auth/weak-password':        'Password must be at least 6 characters.',
  'auth/too-many-requests':    'Too many attempts — please wait a moment.',
  'auth/network-request-failed': 'Network error — check your connection.',
  'auth/operation-not-allowed': 'Google sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method.',
  'auth/unauthorized-domain':  'This domain is not authorised. Add it in Firebase Console → Authentication → Settings → Authorised domains.',
  'auth/cancelled-popup-request': null,   // suppress — user just opened a second popup
  'auth/popup-blocked':        'Popup was blocked by your browser. Please allow popups for this site.',
};

function err(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
}

// ── Card switching with slide animation ────────────────────────────────────
function showCard(card) {
  const signin = document.getElementById('cardSignin');
  const signup = document.getElementById('cardSignup');
  if (card === 'signin') {
    signup.classList.add('auth-slide-out');
    signin.classList.remove('auth-slide-out');
  } else {
    signin.classList.add('auth-slide-out');
    signup.classList.remove('auth-slide-out');
  }
}

document.getElementById('goToSignup').addEventListener('click', e => { e.preventDefault(); showCard('signup'); });
document.getElementById('goToSignin').addEventListener('click', e => { e.preventDefault(); showCard('signin'); });

// ── Button feedback helpers ────────────────────────────────────────────────
function setBtnLoading(btn, msg) {
  btn.disabled = true;
  btn.dataset.orig = btn.innerHTML;
  btn.innerHTML = `<span class="btn-spinner"></span>${msg}`;
}
function setBtnSuccess(btn, msg) {
  btn.innerHTML = `<span style="font-size:1.1em">✓</span> ${msg}`;
  btn.style.background = 'var(--green)';
  btn.style.color = '#fff';
}
function resetBtn(btn) {
  btn.disabled = false;
  btn.innerHTML = btn.dataset.orig || btn.textContent;
  btn.style.background = '';
  btn.style.color = '';
}
function resetGoogleBtn(btn, isJoin) {
  btn.disabled = false;
  btn.innerHTML = GOOGLE_ICON + (isJoin ? ' Join with Google' : ' Continue with Google');
}

// ── Sign-in form ──────────────────────────────────────────────────────────
document.getElementById('signinForm').addEventListener('submit', async e => {
  e.preventDefault();
  err('signinErr', '');
  const btn   = document.getElementById('signinBtn');
  const email = document.getElementById('siEmail').value.trim();
  const pass  = document.getElementById('siPass').value;

  if (!email || !pass) { err('signinErr', 'Please fill in both fields.'); return; }

  setBtnLoading(btn, 'Signing in…');
  try {
    await window.signInWithEmailAndPassword(window.auth, email, pass);
    setBtnSuccess(btn, 'Welcome back!');
    // firebase-config.js will redirect once onAuthStateChanged fires
  } catch (e) {
    err('signinErr', ERR[e.code] || 'Something went wrong. Please try again.');
    resetBtn(btn);
  }
});

// ── Sign-in Google ────────────────────────────────────────────────────────
document.getElementById('signinGoogleBtn').addEventListener('click', async e => {
  err('signinErr', '');
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.innerHTML = GOOGLE_ICON + ' Connecting…';
  try {
    await window.signInWithPopup(window.auth, new window.GoogleAuthProvider());
    btn.innerHTML = GOOGLE_ICON + ' ✓ Signed in!';
  } catch (er) {
    console.error('Google sign-in error:', er.code, er.message);
    const msg = ERR[er.code];
    // msg===null means suppress silently (e.g. cancelled popup request)
    if (er.code !== 'auth/popup-closed-by-user' && msg !== null) {
      err('signinErr', msg || `Sign-in failed (${er.code}). Check Firebase Console.`);
    }
    resetGoogleBtn(btn, false);
  }
});

// ── Join form ─────────────────────────────────────────────────────────────
document.getElementById('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  err('signupErr', '');
  const btn   = document.getElementById('signupBtn');
  const email = document.getElementById('suEmail').value.trim();
  const pass  = document.getElementById('suPass').value;
  const pass2 = document.getElementById('suPass2').value;

  if (!email || !pass)  { err('signupErr', 'Please fill in all fields.'); return; }
  if (pass !== pass2)   { err('signupErr', 'Passwords do not match.'); return; }
  if (pass.length < 6)  { err('signupErr', 'Password must be at least 6 characters.'); return; }

  setBtnLoading(btn, 'Creating account…');
  try {
    await window.createUserWithEmailAndPassword(window.auth, email, pass);
    setBtnSuccess(btn, 'Account created!');
  } catch (e) {
    err('signupErr', ERR[e.code] || 'Something went wrong. Please try again.');
    resetBtn(btn);
  }
});

// ── Join Google ────────────────────────────────────────────────────────────
document.getElementById('signupGoogleBtn').addEventListener('click', async e => {
  err('signupErr', '');
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.innerHTML = GOOGLE_ICON + ' Connecting…';
  try {
    await window.signInWithPopup(window.auth, new window.GoogleAuthProvider());
    btn.innerHTML = GOOGLE_ICON + ' ✓ Joined!';
  } catch (er) {
    console.error('Google sign-in error:', er.code, er.message);
    const msg = ERR[er.code];
    if (er.code !== 'auth/popup-closed-by-user' && msg !== null) {
      err('signupErr', msg || `Sign-in failed (${er.code}). Check Firebase Console.`);
    }
    resetGoogleBtn(btn, true);
  }
});