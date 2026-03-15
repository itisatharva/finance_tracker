// ── Finance Tracker NLP Engine ────────────────────────────────────────────────
// Runs TF-IDF + Logistic Regression entirely in the browser.
// No API key. No server. Works offline.

window.NLP = (() => {

  let model = null;
  let modelLoading = null;

  // ── Load model.json once ──────────────────────────────────────────────────
  async function loadModel() {
    if (model) return model;
    if (modelLoading) return modelLoading;
    modelLoading = fetch('/model.json')
      .then(r => r.json())
      .then(data => { model = data; return model; });
    return modelLoading;
  }

  // ── TF-IDF vectorizer (mirrors sklearn's TfidfVectorizer) ─────────────────
  function tokenize(text, ngramRange = [1, 2]) {
    const clean = text.toLowerCase().replace(/[^a-z0-9₹\s]/g, ' ').trim();
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    const tokens = [];
    // Unigrams
    if (ngramRange[0] <= 1) words.forEach(w => tokens.push(w));
    // Bigrams
    if (ngramRange[1] >= 2) {
      for (let i = 0; i < words.length - 1; i++) {
        tokens.push(words[i] + ' ' + words[i + 1]);
      }
    }
    return tokens;
  }

  function tfidfVector(text, vocab, idf, sublinear_tf = true) {
    const tokens = tokenize(text);
    // Count term frequencies
    const tf = {};
    tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    // Build sparse vector (only vocab terms)
    const vec = new Float32Array(idf.length); // all zeros
    for (const [term, count] of Object.entries(tf)) {
      const idx = vocab[term];
      if (idx !== undefined) {
        const tfVal = sublinear_tf ? (1 + Math.log(count)) : count;
        vec[idx] = tfVal * idf[idx];
      }
    }
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }

  // ── Logistic regression predict ───────────────────────────────────────────
  function softmax(logits) {
    const max = Math.max(...logits);
    const exps = logits.map(x => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / sum);
  }

  function predict(vec, coef, intercept) {
    // dot product: coef [n_classes x n_features] · vec [n_features]
    const logits = coef.map((classCoef, i) => {
      let dot = intercept[i];
      for (let j = 0; j < vec.length; j++) {
        if (vec[j] !== 0) dot += classCoef[j] * vec[j];
      }
      return dot;
    });
    return softmax(logits);
  }

  // ── Amount extractor ──────────────────────────────────────────────────────
  function extractAmounts(text) {
    const pattern = /(?<![.\d])(?:₹|rs\.?|inr\s*)?(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)(?!\d)/gi;
    const results = [];
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0) results.push(val);
    }
    return results;
  }

  // ── Date extractor ────────────────────────────────────────────────────────
  const WEEKDAYS = {monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:0};

  function extractDate(text) {
    const t = text.toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fmt = d => {
      const y = d.getFullYear();
      const mo = String(d.getMonth()+1).padStart(2,'0');
      const dy = String(d.getDate()).padStart(2,'0');
      return `${y}-${mo}-${dy}`;
    };

    if (/today|just now|right now/.test(t)) return fmt(today);
    if (/yesterday|last night/.test(t)) { const d = new Date(today); d.setDate(d.getDate()-1); return fmt(d); }
    if (/day before yesterday/.test(t)) { const d = new Date(today); d.setDate(d.getDate()-2); return fmt(d); }

    let m;
    m = t.match(/(\d+)\s+days?\s+ago/);
    if (m) { const d = new Date(today); d.setDate(d.getDate()-parseInt(m[1])); return fmt(d); }

    m = t.match(/(\d+)\s+weeks?\s+ago/);
    if (m) { const d = new Date(today); d.setDate(d.getDate()-parseInt(m[1])*7); return fmt(d); }

    m = t.match(/last\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/);
    if (m) {
      const target = WEEKDAYS[m[1]];
      const d = new Date(today);
      let diff = (today.getDay() - target + 7) % 7 || 7;
      d.setDate(d.getDate() - diff);
      return fmt(d);
    }

    m = t.match(/on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/);
    if (m) {
      const target = WEEKDAYS[m[1]];
      const d = new Date(today);
      let diff = (today.getDay() - target + 7) % 7 || 7;
      d.setDate(d.getDate() - diff);
      return fmt(d);
    }

    if (/this morning|this evening|this afternoon|tonight/.test(t)) return fmt(today);
    if (/last week/.test(t)) { const d = new Date(today); d.setDate(d.getDate()-7); return fmt(d); }
    if (/last month/.test(t)) {
      const d = new Date(today);
      d.setMonth(d.getMonth()-1);
      return fmt(d);
    }

    return fmt(today);
  }

  // ── Type detector ─────────────────────────────────────────────────────────
  const EXPENSE_WORDS = new Set(['paid','spent','bought','purchased','ordered','charged','swiped','paying','fee','bill','cost']);
  const INCOME_WORDS  = new Set(['received','got','credited','earned','income','salary','freelance','refund','cashback','bonus']);
  const INCOME_CATS   = new Set(['Salary','Freelance','Business','Investment','Gift','Other Income']);

  function detectType(text, category) {
    const words = text.toLowerCase().split(/\s+/);
    if (words.some(w => EXPENSE_WORDS.has(w))) return 'expense';
    if (words.some(w => INCOME_WORDS.has(w)))  return 'income';
    return INCOME_CATS.has(category) ? 'income' : 'expense';
  }

  // ── Note extractor ────────────────────────────────────────────────────────
  function extractNote(text) {
    let note = text;
    note = note.replace(/(?<![.\d])(?:₹|rs\.?|inr\s*)?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?(?!\d)/gi, ' ');
    note = note.replace(/^\s*(paid|spent|bought|received|got|credited|earned|ordered|charged|swiped)\s+/i, '');
    const timePatterns = [
      /\b(today|yesterday|last night|this morning|this evening|last week|last month|just now|right now|this month)\b/gi,
      /\b(two|three|four|five)\s+days?\s+ago\b/gi,
      /\b\d+\s+days?\s+ago\b/gi,
      /\b\d+\s+weeks?\s+ago\b/gi,
      /\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      /\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    ];
    timePatterns.forEach(p => { note = note.replace(p, ' '); });
    note = note.replace(/\s+/g, ' ').trim().replace(/^(for|on|at|from|to|and)\s+/i, '').trim().replace(/[,. ]+$/, '');
    return note.length > 2 ? note : '';
  }

  // ── Main parse function ───────────────────────────────────────────────────
  async function parse(text) {
    const m = await loadModel();
    const vec = tfidfVector(text, m.vocabulary, m.idf, m.sublinear_tf);
    const probs = predict(vec, m.coef, m.intercept);
    const maxProb = Math.max(...probs);
    const category = m.classes[probs.indexOf(maxProb)];
    const confidence = Math.round(maxProb * 100);
    const amounts = extractAmounts(text);
    const date = extractDate(text);
    const type = detectType(text, category);
    const note = extractNote(text);

    if (amounts.length > 1) {
      return amounts.map(amount => ({ amount, category, type, date, note, confidence }));
    }
    return [{ amount: amounts[0] || null, category, type, date, note, confidence }];
  }

  // ── Preload model in background ───────────────────────────────────────────
  function preload() { loadModel().catch(() => {}); }

  return { parse, preload, loadModel };
})();