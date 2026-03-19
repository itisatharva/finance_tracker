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
  // ── Semantic keyword map ──────────────────────────────────────────────────
  // Each model class maps to keywords that may appear in:
  //   (a) raw user input  e.g. "bought medicines" → Healthcare
  //   (b) user-defined category names  e.g. "Medical Expenses" → Healthcare
  // Keep these exhaustive — the raw-text path depends entirely on this map.
  const SEMANTIC_GROUPS = {
    'Food & Dining':     [
      'food','dining','eat','eating','ate','restaurant','meal','meals','lunch','dinner',
      'breakfast','brunch','cafe','cafeteria','snack','snacks','grocery','groceries',
      'kitchen','canteen','tiffin','dhaba','chai','coffee','tea','bakery','sweets',
      'mithai','dabba','hotel','mess','bhojan','thali','biryani','pizza','burger',
      'sandwich','noodles','pasta','juice','smoothie','icecream','dessert','zomato',
      'swiggy','food delivery','ordering food','dominos','mcdonalds','kfc','subway',
    ],
    'Transport':         [
      'transport','transportation','commute','commuting','uber','ola','taxi','cab',
      'bus','auto','autorickshaw','rickshaw','metro','train','railway','fuel','petrol',
      'diesel','cng','vehicle','bike','bicycle','cycle','scooter','car','parking',
      'toll','fare','ticket','tickets','rapido','shuttle','carpool','ride','rides',
      'irctc','redbus','vehicle service','service center',
    ],
    'Shopping':          [
      'shop','shopping','shopped','bought','clothes','clothing','dress','shirt','pants',
      'shoes','footwear','accessories','bag','bags','amazon','flipkart','purchase',
      'purchased','mall','market','fashion','apparel','gadget','electronics','laptop',
      'mobile','phone','myntra','meesho','ajio','nykaa','boutique','retail','store',
      'online shopping','cloth','outfit','watch','jewellery','jewelry','sunglasses',
    ],
    'Bills & Utilities': [
      'bill','bills','utility','utilities','electricity','electric','power','water',
      'gas','lpg','cylinder','internet','broadband','wifi','wi-fi','phone bill',
      'mobile bill','recharge','subscription','subscriptions','rent','emi','insurance',
      'maintenance','society','postpaid','prepaid','netflix','prime','hotstar','jio',
      'airtel','vodafone','vi','bsnl','dth','cable','piped gas','water bill',
    ],
    'Entertainment':     [
      'entertainment','movie','movies','film','films','cinema','netflix','prime video',
      'hotstar','disney','zee5','sonyliv','game','gaming','games','fun','outing',
      'party','parties','music','concert','concerts','sport','sports','cricket','match',
      'event','events','theatre','theater','pub','bar','drinks','bowling','arcade',
      'amusement','theme park','standup','comedy',
    ],
    'Healthcare':        [
      'health','healthcare','medical','medicine','medicines','medic','medication',
      'medications','meds','drug','drugs','tablet','tablets','capsule','capsules',
      'pill','pills','syrup','injection','doctor','doctors','doc','physician',
      'specialist','dentist','dental','optician','ophthalmologist','hospital','clinic',
      'lab','laboratory','test','tests','blood test','scan','xray','x-ray','mri',
      'ultrasound','pharmacy','chemist','pharmacist','prescription','wellness','gym',
      'fitness','yoga','physiotherapy','physio','ayurveda','homeopathy','diagnostic',
      'diagnostics','health checkup','checkup','ambulance','nursing','nursing home',
      'health insurance','mediclaim','first aid','bandage','thermometer',
    ],
    'Education':         [
      'education','school','college','university','course','courses','book','books',
      'tuition','fee','fees','study','studying','learn','learning','class','classes',
      'coaching','training','online course','udemy','coursera','skillshare','unacademy',
      'byjus','toppr','certification','exam','exams','workshop','degree','semester',
      'library','stationery','pen','pencil','notebook','uniform','admission','hostel',
      'college fee','school fee',
    ],
    'Travel':            [
      'travel','travelling','traveling','trip','trips','vacation','holiday','holidays',
      'tour','touring','flight','flights','airline','airport','hotel','resort','airbnb',
      'oyo','makemytrip','yatra','goibibo','booking','passport','visa','itinerary',
      'sightseeing','trekking','trek','hill station','beach','cruise','honeymoon',
      'backpacking','train ticket','bus ticket','cab booking','travel insurance',
    ],
    'Other Expenses':    [
      'other','misc','miscellaneous','expense','expenses','sundry','general','random',
      'unknown','various','assorted',
    ],
    'Salary':            [
      'salary','salaries','wage','wages','pay','paycheck','stipend','ctc','hike',
      'increment','monthly pay','basic pay','in-hand','payday','payroll',
      'compensation','remuneration','allowance','da','hra','ta',
    ],
    'Freelance':         [
      'freelance','freelancing','freelanced','contract','gig','gigs','project',
      'projects','consulting','consult','client','invoice','invoiced','side income',
      'fiverr','upwork','toptal','remote work','part-time','part time','contract work',
    ],
    'Business':          [
      'business','profit','revenue','sales','sale','shop income','commission',
      'trader','trading','vendor','wholesale','enterprise','startup','b2b','b2c',
      'turnover','gross income','business income','rental income',
    ],
    'Investment':        [
      'investment','invest','invested','dividend','dividends','return','returns',
      'stock','stocks','shares','mutual fund','mutual funds','interest','sip',
      'equity','nifty','sensex','crypto','bitcoin','ethereum','fd','fixed deposit',
      'ppf','nps','elss','zerodha','groww','kuvera','smallcase','portfolio','bond',
      'bonds','gold','sovereign gold','sgb','nsc',
    ],
    'Gift':              [
      'gift','gifts','gifted','present','presents','bonus','reward','rewards',
      'cashback','refund','refunded','lucky','win','won','prize','prizes','diwali',
      'birthday','festival','rakhi','voucher','vouchers','coupon','coupons',
      'cash gift','money gift','hamper',
    ],
    'Other Income':      [
      'other income','misc income','extra income','side income','additional income',
      'miscellaneous income','random income','extra','additional','windfall',
    ],
  };

  // Build reverse lookup: keyword → canonical class name (for raw-text scanning)
  const _KEYWORD_TO_CLASS = new Map();
  for (const [cls, words] of Object.entries(SEMANTIC_GROUPS)) {
    for (const w of words) _KEYWORD_TO_CLASS.set(w, cls);
  }

  function _wordSet(str) {
    return new Set(
      str.toLowerCase()
         .replace(/[^a-z0-9\s]/g, ' ')
         .split(/\s+/)
         .filter(w => w.length > 1)
    );
  }

  function _jaccardWords(a, b) {
    const wa = _wordSet(a), wb = _wordSet(b);
    let inter = 0;
    wa.forEach(w => { if (wb.has(w)) inter++; });
    const union = new Set([...wa, ...wb]).size;
    return union === 0 ? 0 : inter / union;
  }

  // Score how well a *predicted class name* maps to a *user category name*
  function _semanticScore(predicted, catName) {
    let score = _jaccardWords(predicted, catName);

    const pl = predicted.toLowerCase();
    const cl = catName.toLowerCase();

    if (cl.includes(pl) || pl.includes(cl)) score = Math.max(score, 0.72);

    const predWords = _wordSet(predicted);
    const catWords  = _wordSet(catName);

    predWords.forEach(pw => {
      if (pw.length > 3 && catWords.has(pw)) score = Math.max(score, 0.60);
    });

    const keywords = SEMANTIC_GROUPS[predicted] || [];
    catWords.forEach(w => {
      if (keywords.includes(w)) score = Math.max(score, 0.62);
    });

    predWords.forEach(pw => {
      if (catWords.has(pw) && pw.length > 2) score = Math.max(score, 0.55);
    });

    return Math.min(1, score);
  }

  /**
   * Score how well the *raw user input text* maps to a *user category name*.
   *
   * Strategy:
   *   1. Extract words from the raw input.
   *   2. For each word check the _KEYWORD_TO_CLASS reverse map → get canonical class.
   *   3. Score that (canonical class → userCatName) pair via _semanticScore.
   *   4. Also directly match input words against the user category name itself.
   *
   * This is the fix for "700 for medicines" → model says "Entertainment" but
   * raw text contains "medicines" → _KEYWORD_TO_CLASS["medicines"] = "Healthcare"
   * → _semanticScore("Healthcare", "Healthcare") = 1.0
   */
  function _rawTextScore(rawText, catName) {
    const inputWords = _wordSet(rawText);
    let best = 0;

    // 1. Bigrams from input (catches "blood test", "fixed deposit" etc.)
    const wArr = Array.from(inputWords);
    const allTokens = [...wArr];
    for (let i = 0; i < wArr.length - 1; i++) allTokens.push(wArr[i] + ' ' + wArr[i+1]);

    for (const token of allTokens) {
      const cls = _KEYWORD_TO_CLASS.get(token);
      if (cls) {
        const s = _semanticScore(cls, catName);
        if (s > best) best = s;
      }
    }

    // 2. Direct word overlap between raw input and user category name
    const catWords = _wordSet(catName);
    inputWords.forEach(w => {
      if (w.length > 3 && catWords.has(w)) best = Math.max(best, 0.68);
    });
    // Partial: input word is a substring of a cat word or vice versa
    inputWords.forEach(iw => {
      if (iw.length < 4) return;
      catWords.forEach(cw => {
        if (cw.length < 4) return;
        if (cw.includes(iw) || iw.includes(cw)) best = Math.max(best, 0.60);
      });
    });

    return Math.min(1, best);
  }

  /**
   * Match NLP output against a user's actual category lists.
   *
   * Two independent signals, winner takes all:
   *   A) Predicted class  → user cat  (via _semanticScore)
   *   B) Raw input text   → user cat  (via _rawTextScore)   ← fixes mispredictions
   *
   * @param {string}  predicted   - model output class, e.g. "Entertainment"
   * @param {string}  type        - 'expense' | 'income'
   * @param {Array}   expenseCats - user expense categories
   * @param {Array}   incomeCats  - user income categories
   * @param {string}  [rawText]   - original user input, e.g. "700 for medicines"
   */
  function matchToUserCategories(predicted, type, expenseCats, incomeCats, rawText) {
    const expPool = (expenseCats || []).map(c => ({
      name: typeof c === 'string' ? c : c.name,
      type: 'expense',
      raw:  c,
    }));
    const incPool = (incomeCats || []).map(c => ({
      name: typeof c === 'string' ? c : c.name,
      type: 'income',
      raw:  c,
    }));

    // Search the type-appropriate pool first so ties break correctly
    const ordered = type === 'income'
      ? [...incPool, ...expPool]
      : [...expPool, ...incPool];

    let best = null, bestScore = 0;

    for (const item of ordered) {
      // Signal A — predicted class vs category name
      const scoreA = _semanticScore(predicted, item.name);
      // Signal B — raw input text vs category name (higher weight: overrides bad predictions)
      const scoreB = rawText ? _rawTextScore(rawText, item.name) : 0;
      // Take the stronger signal; raw-text gets a 5% bonus to break ties vs mispredictions
      const combined = Math.max(scoreA, scoreB > 0 ? scoreB + 0.05 : 0);

      if (combined > bestScore) { bestScore = combined; best = item; }
    }

    // Derive the suggestedName from the raw text too — prefer the class that raw text
    // actually implies rather than the (possibly wrong) model prediction
    let suggestedName = predicted;
    if (rawText) {
      const inputWords = _wordSet(rawText);
      const wArr = Array.from(inputWords);
      const allTokens = [...wArr];
      for (let i = 0; i < wArr.length - 1; i++) allTokens.push(wArr[i] + ' ' + wArr[i+1]);
      let bestCls = null, bestClsCount = 0;
      const clsCounts = {};
      for (const token of allTokens) {
        const cls = _KEYWORD_TO_CLASS.get(token);
        if (cls) { clsCounts[cls] = (clsCounts[cls] || 0) + 1; }
      }
      for (const [cls, cnt] of Object.entries(clsCounts)) {
        if (cnt > bestClsCount) { bestClsCount = cnt; bestCls = cls; }
      }
      if (bestCls) suggestedName = bestCls;
    }

    return {
      matched:       bestScore >= 0.51,
      category:      best ? best.raw  : null,
      categoryName:  best ? best.name : null,
      categoryType:  best ? best.type : type,
      score:         Math.min(1, bestScore),
      suggestedName,
      suggestedType: type,
    };
  }

  return { parse, preload, loadModel, matchToUserCategories };
})();