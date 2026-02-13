const GOOGLE_ICON = `<svg width="17" height="17" viewBox="0 0 18 18" style="flex-shrink:0;display:block"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>`;

// Mobile browsers block popups — detect and use redirect flow instead
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// ── Handle Google redirect result (fires after returning from Google on mobile) ──
// Must run early, before firebase-config's onAuthStateChanged fires a redirect
window.getRedirectResult(window.auth)
  .then(result => {
    if (!result || !result.user) return;     // no redirect pending — normal page load
    const isNew = window.getAdditionalUserInfo(result).isNewUser;
    window._authHandled = true;
    window.location.replace(isNew ? 'category-setup.html' : 'index.html');
  })
  .catch(err => {
    console.error('Redirect result error:', err.code, err.message);
    const msg = ERR[err.code];
    if (msg !== null) showErr('signinErr', msg || `Sign-in failed (${err.code}).`);
  });

const ERR = {
  'auth/invalid-credential':      'Incorrect email or password.',
  'auth/user-not-found':          'No account found with that email.',
  'auth/wrong-password':          'Incorrect password.',
  'auth/email-already-in-use':    'That email is already registered.',
  'auth/invalid-email':           'Enter a valid email address.',
  'auth/weak-password':           'Password must be at least 6 characters.',
  'auth/too-many-requests':       'Too many attempts — please wait a moment.',
  'auth/network-request-failed':  'Network error — check your connection.',
  'auth/operation-not-allowed':   'This sign-in method is not enabled in Firebase Console.',
  'auth/unauthorized-domain':     'This domain is not authorised in Firebase Console.',
  'auth/cancelled-popup-request': null,
  'auth/popup-blocked':           'Popup blocked — please allow popups for this site.',
};

function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
}

function setLoading(btn, msg) {
  btn.disabled = true;
  btn.dataset.orig = btn.innerHTML;
  btn.innerHTML = `<span class="btn-spinner"></span>${msg}`;
}
function setSuccess(btn, msg) {
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
function resetGoogleBtn(btn, label) {
  btn.disabled = false;
  btn.innerHTML = GOOGLE_ICON + ' ' + label;
}

function redirect(url) {
  window._authHandled = true;
  window.location.replace(url);
}

// ── Card toggle ────────────────────────────────────────────────────────────
document.getElementById('goToSignup').addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('cardSignin').classList.add('auth-slide-out');
  document.getElementById('cardSignup').classList.remove('auth-slide-out');
});
document.getElementById('goToSignin').addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('cardSignup').classList.add('auth-slide-out');
  document.getElementById('cardSignin').classList.remove('auth-slide-out');
});

// ── Email sign-in ──────────────────────────────────────────────────────────
document.getElementById('signinForm').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('signinErr', '');
  const btn   = document.getElementById('signinBtn');
  const email = document.getElementById('siEmail').value.trim();
  const pass  = document.getElementById('siPass').value;
  if (!email || !pass) { showErr('signinErr', 'Please fill in both fields.'); return; }
  setLoading(btn, 'Signing in…');
  try {
    await window.signInWithEmailAndPassword(window.auth, email, pass);
    setSuccess(btn, 'Welcome back!');
    // Existing user always goes straight to the dashboard
    redirect('index.html');
  } catch (err) {
    showErr('signinErr', ERR[err.code] || 'Something went wrong. Please try again.');
    resetBtn(btn);
  }
});

// ── Email sign-up ──────────────────────────────────────────────────────────
document.getElementById('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('signupErr', '');
  const btn   = document.getElementById('signupBtn');
  const email = document.getElementById('suEmail').value.trim();
  const pass  = document.getElementById('suPass').value;
  const pass2 = document.getElementById('suPass2').value;
  if (!email || !pass)  { showErr('signupErr', 'Please fill in all fields.'); return; }
  if (pass !== pass2)   { showErr('signupErr', 'Passwords do not match.'); return; }
  if (pass.length < 6)  { showErr('signupErr', 'Password must be at least 6 characters.'); return; }
  setLoading(btn, 'Creating account…');
  try {
    await window.createUserWithEmailAndPassword(window.auth, email, pass);
    setSuccess(btn, 'Account created!');
    // Brand-new user always goes to category setup
    redirect('category-setup.html');
  } catch (err) {
    showErr('signupErr', ERR[err.code] || 'Something went wrong. Please try again.');
    resetBtn(btn);
  }
});

// ── Google sign-in (login card) ────────────────────────────────────────────
document.getElementById('signinGoogleBtn').addEventListener('click', async e => {
  showErr('signinErr', '');
  const btn = e.currentTarget;
  btn.disabled = true;
  if (isMobile) {
    btn.innerHTML = GOOGLE_ICON + ' Redirecting…';
    try {
      await window.signInWithRedirect(window.auth, new window.GoogleAuthProvider());
      // page navigates away — nothing below runs
    } catch (err) {
      const msg = ERR[err.code];
      if (msg !== null) showErr('signinErr', msg || `Sign-in failed (${err.code}).`);
      resetGoogleBtn(btn, 'Continue with Google');
    }
  } else {
    btn.innerHTML = GOOGLE_ICON + ' Connecting…';
    try {
      const result = await window.signInWithPopup(window.auth, new window.GoogleAuthProvider());
      const isNew  = window.getAdditionalUserInfo(result).isNewUser;
      btn.innerHTML = GOOGLE_ICON + ' ✓ Signed in!';
      redirect(isNew ? 'category-setup.html' : 'index.html');
    } catch (err) {
      const msg = ERR[err.code];
      if (err.code !== 'auth/popup-closed-by-user' && msg !== null) {
        showErr('signinErr', msg || `Sign-in failed (${err.code}).`);
      }
      resetGoogleBtn(btn, 'Continue with Google');
    }
  }
});

// ── Google sign-up (join card) ─────────────────────────────────────────────
document.getElementById('signupGoogleBtn').addEventListener('click', async e => {
  showErr('signupErr', '');
  const btn = e.currentTarget;
  btn.disabled = true;
  if (isMobile) {
    btn.innerHTML = GOOGLE_ICON + ' Redirecting…';
    try {
      await window.signInWithRedirect(window.auth, new window.GoogleAuthProvider());
      // page navigates away — nothing below runs
    } catch (err) {
      const msg = ERR[err.code];
      if (msg !== null) showErr('signupErr', msg || `Sign-in failed (${err.code}).`);
      resetGoogleBtn(btn, 'Join with Google');
    }
  } else {
    btn.innerHTML = GOOGLE_ICON + ' Connecting…';
    try {
      const result = await window.signInWithPopup(window.auth, new window.GoogleAuthProvider());
      const isNew  = window.getAdditionalUserInfo(result).isNewUser;
      btn.innerHTML = GOOGLE_ICON + ' ✓ Joined!';
      redirect(isNew ? 'category-setup.html' : 'index.html');
    } catch (err) {
      const msg = ERR[err.code];
      if (err.code !== 'auth/popup-closed-by-user' && msg !== null) {
        showErr('signupErr', msg || `Sign-in failed (${err.code}).`);
      }
      resetGoogleBtn(btn, 'Join with Google');
    }
  }
});