// auth.js — Login / Sign-up logic
let isSignUp = false;

window.firebaseReady.then(() => {
  const form     = document.getElementById('authForm');
  const emailEl  = document.getElementById('emailInput');
  const passEl   = document.getElementById('passwordInput');
  const btn      = document.getElementById('authBtn');
  const btnText  = document.getElementById('authBtnText');
  const errEl    = document.getElementById('authErr');
  const subtitle = document.getElementById('authSubtitle');
  const toggleMsg  = document.getElementById('toggleMsg');
  const toggleLink = document.getElementById('toggleLink');
  const googleBtn  = document.getElementById('googleBtn');

  function setError(msg) {
    errEl.textContent = msg;
    errEl.classList.toggle('show', !!msg);
  }

  function setLoading(on) {
    btn.disabled = on;
    btnText.textContent = on ? 'Please wait…' : (isSignUp ? 'Sign Up' : 'Sign In');
  }

  // Toggle mode
  toggleLink.addEventListener('click', e => {
    e.preventDefault();
    isSignUp = !isSignUp;
    setError('');
    if (isSignUp) {
      subtitle.textContent   = 'Create a new account';
      btnText.textContent    = 'Sign Up';
      toggleMsg.textContent  = 'Already have an account?';
      toggleLink.textContent = ' Sign In';
    } else {
      subtitle.textContent   = 'Sign in to your account';
      btnText.textContent    = 'Sign In';
      toggleMsg.textContent  = "Don't have an account?";
      toggleLink.textContent = ' Sign Up';
    }
  });

  // Google sign-in
  googleBtn.addEventListener('click', async () => {
    setError('');
    googleBtn.disabled = true;
    googleBtn.textContent = 'Signing in…';
    try {
      const provider = new window.GoogleAuthProvider();
      await window.signInWithPopup(window.auth, provider);
      // firebase-config.js auth guard will redirect
    } catch (err) {
      console.error(err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setError('Google sign-in failed. Please try again.');
      }
      googleBtn.disabled = false;
      googleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg> Continue with Google`;
    }
  });

  // Email/password submit
  form.addEventListener('submit', async e => {
    e.preventDefault();
    setError('');
    const email = emailEl.value.trim();
    const pass  = passEl.value;

    if (!email || !pass) { setError('Please fill in all fields.'); return; }

    setLoading(true);
    try {
      if (isSignUp) {
        await window.createUserWithEmailAndPassword(window.auth, email, pass);
      } else {
        await window.signInWithEmailAndPassword(window.auth, email, pass);
      }
    } catch (err) {
      const msgs = {
        'auth/email-already-in-use': 'That email is already registered.',
        'auth/invalid-email':        'Please enter a valid email.',
        'auth/weak-password':        'Password must be at least 6 characters.',
        'auth/user-not-found':       'No account found with that email.',
        'auth/wrong-password':       'Incorrect password.',
        'auth/invalid-credential':   'Incorrect email or password.',
        'auth/too-many-requests':    'Too many attempts — try again later.',
      };
      setError(msgs[err.code] || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  });

  // Check auth state
  window.onAuthStateChanged(window.auth, (user) => {
    if (user) window.location.replace('index.html');
  });
});