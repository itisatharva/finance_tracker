// ── Finance Tracker NLP Engine ────────────────────────────────────────────────
// Runs TF-IDF + Logistic Regression entirely in the browser.
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
  function stripDateTokens(text) {
    // Remove date-like tokens so their digits aren't picked up as amounts
    // dd/mm/yy, dd/mm/yyyy, dd-mm-yy etc.
    let t = text.replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, ' ');
    // dd/mm or mm/dd without year — only strip if surrounded by non-digit
    t = t.replace(/\b\d{1,2}[\/-]\d{1,2}\b/g, ' ');
    // "16th feb", "feb 16", month name patterns
    const MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
    t = t.replace(new RegExp('\\d{1,2}(?:st|nd|rd|th)?\\s+(?:' + MON + ')', 'gi'), ' ');
    t = t.replace(new RegExp('(?:' + MON + ')\\s+\\d{1,2}(?:st|nd|rd|th)?', 'gi'), ' ');
    return t;
  }

  function extractAmounts(text) {
    const cleaned = stripDateTokens(text);
    const pattern = /(?<![.\d])(?:₹|rs\.?|inr\s*)?(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)(?!\d)/gi;
    const results = [];
    let m;
    while ((m = pattern.exec(cleaned)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0) results.push(val);
    }
    return results;
  }

  // ── Date extractor ────────────────────────────────────────────────────────
  const WEEKDAYS = {monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:0};
  const MONTHS = {
    jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,
    jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,
    oct:10,october:10,nov:11,november:11,dec:12,december:12
  };

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

    const tryDate = (yr, mon, day) => {
      const d = new Date(yr, mon-1, day);
      if (d.getMonth() !== mon-1) return null; // invalid date
      return d;
    };

    // Relative keywords
    if (/today|just now|right now/.test(t)) return fmt(today);
    if (/yesterday|last night/.test(t)) { const d = new Date(today); d.setDate(d.getDate()-1); return fmt(d); }
    if (/day before yesterday/.test(t)) { const d = new Date(today); d.setDate(d.getDate()-2); return fmt(d); }

    let m;
    m = t.match(/(\d+)\s+days?\s+ago/);
    if (m) { const d = new Date(today); d.setDate(d.getDate()-parseInt(m[1])); return fmt(d); }
    m = t.match(/(\d+)\s+weeks?\s+ago/);
    if (m) { const d = new Date(today); d.setDate(d.getDate()-parseInt(m[1])*7); return fmt(d); }

    if (/this morning|this evening|this afternoon|tonight/.test(t)) return fmt(today);
    if (/last week/.test(t)) { const d = new Date(today); d.setDate(d.getDate()-7); return fmt(d); }
    if (/last month/.test(t)) { const d = new Date(today); d.setMonth(d.getMonth()-1); return fmt(d); }

    // Weekday names: "last friday", "on monday"
    m = t.match(/(?:last|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/);
    if (m) {
      const target = WEEKDAYS[m[1]];
      const d = new Date(today);
      const diff = (today.getDay() - target + 7) % 7 || 7;
      d.setDate(d.getDate() - diff);
      return fmt(d);
    }

    const MON_PAT = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

    // "16th feb", "3rd march"
    m = t.match(new RegExp('(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MON_PAT));
    if (m) {
      const day = parseInt(m[1]);
      const mon = MONTHS[m[2].slice(0,3)];
      if (mon) {
        let d = tryDate(today.getFullYear(), mon, day);
        if (d && d > today) d = tryDate(today.getFullYear()-1, mon, day);
        if (d) return fmt(d);
      }
    }

    // "feb 16", "march 5th"
    m = t.match(new RegExp(MON_PAT + '\\s+(\\d{1,2})(?:st|nd|rd|th)?'));
    if (m) {
      const mon = MONTHS[m[1].slice(0,3)];
      const day = parseInt(m[2]);
      if (mon) {
        let d = tryDate(today.getFullYear(), mon, day);
        if (d && d > today) d = tryDate(today.getFullYear()-1, mon, day);
        if (d) return fmt(d);
      }
    }

    // "16/2", "16-02", optionally with year
    m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (m) {
      const a = parseInt(m[1]), b = parseInt(m[2]);
      let yr = today.getFullYear();
      if (m[3]) { yr = parseInt(m[3]); if (yr < 100) yr += 2000; }
      let d = tryDate(yr, b, a); // dd/mm
      if (!d) d = tryDate(yr, a, b); // mm/dd
      if (d) return fmt(d);
    }

    return fmt(today);
  }

  // ── Type detector ─────────────────────────────────────────────────────────
  const EXPENSE_WORDS = new Set(['paid','spent','bought','purchased','ordered','charged','swiped','paying','fee','bill','cost']);
  const INCOME_WORDS  = new Set(['received','got','credited','earned','income','salary','freelance','refund','cashback','bonus']);
  const INCOME_CATS   = new Set(['Salary','Freelance','Business','Investment','Gift','Other Income','Baba']);

  function detectType(text, category) {
    const words = text.toLowerCase().split(/\s+/);
    if (words.some(w => EXPENSE_WORDS.has(w))) return 'expense';
    if (words.some(w => INCOME_WORDS.has(w)))  return 'income';
    return INCOME_CATS.has(category) ? 'income' : 'expense';
  }

  // ── Note extractor ────────────────────────────────────────────────────────
  function extractNote(text) {
    let note = text;
    // Strip date tokens first (dd/mm/yy, 16th feb, feb 16, etc.)
    note = note.replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, ' ');
    note = note.replace(/\b\d{1,2}[\/-]\d{1,2}\b/g, ' ');
    const MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
    note = note.replace(new RegExp('\\d{1,2}(?:st|nd|rd|th)?\\s+(?:' + MON + ')', 'gi'), ' ');
    note = note.replace(new RegExp('(?:' + MON + ')\\s+\\d{1,2}(?:st|nd|rd|th)?', 'gi'), ' ');
    // Strip amounts
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
    note = note.replace(/\brs\.?\b/gi, ' ').replace(/\s+/g, ' ').trim().replace(/^(for|on|at|from|to|and)\s+/i, '').trim().replace(/[,. ]+$/, '');
    return note.length > 2 ? note : '';
  }

  // ── Split comma/"and"-separated items into per-item segments ───────────────
  function splitItems(text) {
    const parts = text.split(/\s*,\s*|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
    const valid = parts.filter(p => extractAmounts(p).length > 0);
    return valid.length > 1 ? valid : [text];
  }

  // ── Classify a single short segment ──────────────────────────────────────────
  // date is passed as fallback; segment gets its own date if it contains one
  function classifySegment(seg, m, fallbackDate) {
    const vec        = tfidfVector(seg, m.vocabulary, m.idf, m.sublinear_tf);
    const probs      = predict(vec, m.coef, m.intercept);
    const maxProb    = Math.max(...probs);
    const category   = m.classes[probs.indexOf(maxProb)];
    const confidence = Math.round(maxProb * 100);
    const amounts    = extractAmounts(seg);
    const type       = detectType(seg, category);
    const note       = extractNote(seg);
    // Each segment extracts its own date so "yesterday and today" splits correctly
    const date       = extractDate(seg) || fallbackDate;
    return { amount: amounts[0] || null, category, type, date, note, confidence };
  }

  // ── Main parse function ───────────────────────────────────────────────────
  async function parse(text) {
    const m    = await loadModel();
    const date = extractDate(text);

    // Split comma/"and"-separated items and classify each independently
    // Each segment extracts its own date; today is the fallback
    const segments = splitItems(text);
    if (segments.length > 1) {
      const today = new Date(); today.setHours(0,0,0,0);
      const todayFmt = String(today.getFullYear()) + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
      return segments.map(seg => classifySegment(seg, m, todayFmt));
    }

    // Single-item path
    const vec        = tfidfVector(text, m.vocabulary, m.idf, m.sublinear_tf);
    const probs      = predict(vec, m.coef, m.intercept);
    const maxProb    = Math.max(...probs);
    const category   = m.classes[probs.indexOf(maxProb)];
    const confidence = Math.round(maxProb * 100);
    const amounts    = extractAmounts(text);
    const type       = detectType(text, category);
    const note       = extractNote(text);

    if (amounts.length > 1) {
      return amounts.map(amount => ({ amount, category, type, date, note, confidence }));
    }
    return [{ amount: amounts[0] || null, category, type, date, note, confidence }];
  }

  // ── Preload model in background ───────────────────────────────────────────
  function preload() { loadModel().catch(() => {}); }

  // ── Category matcher ──────────────────────────────────────────────────────
  // Maps each of the model's 15 trained classes to a broad set of synonyms,
  // merchant keywords, and related words that users put in custom category names.
  const SEMANTIC_GROUPS = {
    'Food & Dining':     ['food','dining','eat','eating','restaurant','meal','lunch','dinner','breakfast','cafe','snack','grocery','groceries','kitchen','canteen','tiffin','dhaba','chai','coffee','tea','bakery','sweets','mithai','dabba','hotel','mess','bhojan','thali'],
    'Transport':         ['transport','travel','uber','ola','taxi','bus','auto','cab','fuel','petrol','diesel','metro','train','commute','vehicle','bike','rickshaw','ticket','fare','rapido','parking','toll','shuttle','carpool','bsnl'],
    'Shopping':          ['shop','shopping','clothes','clothing','amazon','flipkart','buy','purchase','mall','market','fashion','apparel','shoes','accessories','gadget','electronics','myntra','meesho','ajio','nykaa','boutique','retail','store'],
    'Bills & Utilities': ['bill','utility','electricity','water','gas','internet','wifi','phone','mobile','recharge','subscription','rent','emi','insurance','maintenance','society','broadband','postpaid','prepaid','netflix','prime','hotstar','jio','airtel','bsnl','dth','cable'],
    'Entertainment':     ['entertainment','movie','film','netflix','prime','hotstar','zee5','game','gaming','fun','outing','party','music','concert','sport','cricket','match','event','theatre','books','kindle','sports','pub','bar','drinks'],
    'Healthcare':        ['health','medical','doctor','medicine','pharmacy','hospital','clinic','dentist','lab','test','prescription','wellness','gym','fitness','yoga','tablet','capsule','healthcare','physiotherapy','ayurveda','blood','diagnostic'],
    'Education':         ['education','school','college','course','book','tuition','fee','study','learn','class','coaching','training','online','udemy','coursera','certification','exam','workshop','degree','semester','library','stationery'],
    'Travel':            ['travel','trip','vacation','hotel','flight','tour','holiday','airbnb','oyo','booking','passport','visa','itinerary','resort','beach','hill','station','airport','bus stand','tour','sightseeing'],
    'Other Expenses':    ['other','misc','miscellaneous','expense','sundry','general','random','unknown'],
    'Salary':            ['salary','wage','wages','pay','paycheck','stipend','ctc','hike','monthly pay','basic','in-hand','payday','payroll','compensation'],
    'Freelance':         ['freelance','freelancing','contract','gig','project','consulting','client','invoice','side income','fiverr','upwork','toptal','remote'],
    'Business':          ['business','profit','revenue','sales','shop income','commission','trader','vendor','wholesale','enterprise','startup'],
    'Investment':        ['investment','dividend','return','stock','mutual','fund','interest','sip','equity','trading','nifty','sensex','crypto','bitcoin','fd','fixed deposit','ppf','nps','zerodha','groww'],
    'Gift':              ['gift','gifted','present','bonus','reward','cashback','refund','lucky','win','prize','diwali','birthday','festival','rakhi','voucher','coupon'],
    'Other Income':      ['other income','misc income','extra income','side','random','extra','additional','miscellaneous income'],
  };

  function _wordSet(str) {
    return new Set(str.toLowerCase().split(/[\s&_\-\/,.()+]+/).filter(w => w.length > 1));
  }

  function _jaccardWords(a, b) {
    const wa = _wordSet(a), wb = _wordSet(b);
    let inter = 0;
    wa.forEach(w => { if (wb.has(w)) inter++; });
    const union = new Set([...wa, ...wb]).size;
    return union === 0 ? 0 : inter / union;
  }

  function _semanticScore(predicted, catName) {
    let score = _jaccardWords(predicted, catName);

    const pl = predicted.toLowerCase();
    const cl = catName.toLowerCase();

    // Substring containment gives a strong signal
    if (cl.includes(pl) || pl.includes(cl)) score = Math.max(score, 0.72);

    // Shared individual word (length > 3 to avoid noise)
    const predWords = _wordSet(predicted);
    const catWords  = _wordSet(catName);
    predWords.forEach(pw => {
      if (pw.length > 3 && catWords.has(pw)) score = Math.max(score, 0.60);
    });

    // Semantic keyword lookup: does any word in the user category name
    // appear in the synonym list for the predicted model class?
    const keywords = SEMANTIC_GROUPS[predicted] || [];
    catWords.forEach(w => {
      if (keywords.includes(w)) score = Math.max(score, 0.62);
    });

    // Reverse: does any word of the predicted class appear in the user cat name?
    predWords.forEach(pw => {
      if (catWords.has(pw) && pw.length > 2) score = Math.max(score, 0.55);
    });

    return Math.min(1, score);
  }

  /**
   * Match a model-predicted class name against a user's actual category lists.
   *
   * @param {string}   predicted    - e.g. "Food & Dining" (model output)
   * @param {string}   type         - 'expense' | 'income' (model's guess)
   * @param {Array}    expenseCats  - user's expense categories (string or {name,...})
   * @param {Array}    incomeCats   - user's income categories
   * @returns {{matched, category, categoryName, categoryType, score, suggestedName, suggestedType}}
   */
  function matchToUserCategories(predicted, type, expenseCats, incomeCats) {
    const expPool = (expenseCats || []).map(c => ({
      name: typeof c === 'string' ? c : c.name,
      type: 'expense',
      raw: c,
    }));
    const incPool = (incomeCats || []).map(c => ({
      name: typeof c === 'string' ? c : c.name,
      type: 'income',
      raw: c,
    }));

    // Search type-appropriate pool first, then the other
    const ordered = type === 'income'
      ? [...incPool, ...expPool]
      : [...expPool, ...incPool];

    let best = null, bestScore = 0;
    for (const item of ordered) {
      const s = _semanticScore(predicted, item.name);
      if (s > bestScore) { bestScore = s; best = item; }
    }

    return {
      matched:       bestScore >= 0.51,
      category:      best ? best.raw : null,
      categoryName:  best ? best.name : null,
      categoryType:  best ? best.type : type,
      score:         bestScore,
      suggestedName: predicted,
      suggestedType: type,
    };
  }

  return { parse, preload, loadModel, matchToUserCategories };
})();