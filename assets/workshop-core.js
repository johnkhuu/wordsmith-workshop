/*
 * The workshop's logic: no page code, so it runs in Node for the tests.
 *
 * Each method from the skill's guides (references/methods/*.md) becomes three
 * things here: slots (what you fill in), an order (how the slots assemble),
 * and checks (the guide's own checklist, automated where a rule can decide
 * and left as a prompt where only a person can). There's no AI: the first
 * pass only sorts the visitor's own sentences, and every slot stays editable.
 *
 * The page walks through four steps, and each has a function here:
 *   paste  -> parseDraft
 *   review -> diagnose + recommend (the skill's own rules for picking methods)
 *   fix    -> suggest (the first pass), assemble, tasks (one card per line to fix)
 *   send   -> compare (what changed) and the "ask yourself" checks
 */
(function (root) {
  "use strict";

  const TellScan = (typeof module !== "undefined" && module.exports)
    ? require("./scanner.js")
    : root.TellScan;

  const METHODS = ["scqa", "mece", "inverted", "wwb", "data"];
  const METHOD_NAMES = {
    pyramid: "Pyramid", scqa: "SCQA", mece: "MECE", inverted: "Inverted Pyramid",
    wwb: "Writing Without Bullshit", data: "Storytelling with Data", audit: "Tell audit",
    polish: "Clarity and tone",
  };
  // The editorial desk: each check belongs to the role that would raise it in
  // a publishing house. These are checks modeled on each role, not people.
  const DESKS = {
    structure: { name: "Structural editor", initials: "SE", job: "Puts the point first and gives the piece the right shape." },
    line: { name: "Line editor", initials: "LE", job: "Keeps sentences clear and plain, with a rhythm that varies." },
    copy: { name: "Copy editor", initials: "CE", job: "Catches doubled words, restated lines and anything written two ways." },
    facts: { name: "Fact-checker", initials: "FC", job: "Checks that every day matches its date." },
    copywriter: { name: "Copywriter", initials: "CW", job: "Makes the first line earn the second and the ending land, in the right tone." },
    tells: { name: "Tell auditor", initials: "TA", job: "Makes sure nothing reads as machine-made." },
  };
  const DESK_ORDER = ["structure", "line", "copy", "facts", "copywriter", "tells"];
  const POLISH_DESK = { P1: "copy", P2: "copy", P3: "copy", P4: "copy", P5: "line", P6: "line", P7: "line", P8: "line", P9: "copywriter", P10: "copy",
    T1: "copywriter", T2: "copywriter", T3: "copywriter", T4: "line", T5: "copywriter", T6: "copywriter",
    F1: "facts", K1: "copy", K2: "copy", K3: "copy", K4: "copy" };
  function deskForCheck(c) {
    if (c.desk) return c.desk;
    if (c.id === "minto-close" || c.id === "wwb-subject" || c.id === "cover-test") return "copywriter";
    if (c.id === "wwb-edit") return "line";
    if (c.id === "tells") return "tells";
    if (c.id === "draft-filler" || c.id === "draft-unused") return "line";
    return "structure";
  }

  // What each method does, in a line, for the method picker.
  const METHOD_JOBS = {
    pyramid: "Puts your point first, with the support under it.",
    scqa: "Opens with the situation and what changed, then your answer.",
    mece: "Sorts items into clean groups, with no overlaps.",
    inverted: "Puts the news first and the backstory last.",
    wwb: "Cuts padding, passive voice and vague words.",
    data: "Gives every number a comparison that makes it mean something.",
  };

  // The six examples are the "before" drafts from the Methods section, with
  // the method each one demonstrates.
  const EXAMPLES = {
    pyramid: {
      label: "Deck repair",
      methods: [],
      text: "Hi Mark, I hope you're doing well. Things have been a bit hectic on our end lately. Last week we talked about starting the deck on the 14th, and that could still work, but my in-laws are visiting that week and the yard will be pretty busy. Would it be possible to push it back?",
    },
    scqa: {
      label: "Thanksgiving",
      methods: ["scqa"],
      text: "Hey all, so we've been going back and forth a lot about the holidays and there are a lot of moving pieces, but after talking it through we've decided we'll do Thanksgiving at our place this year.",
    },
    mece: {
      label: "Trip plan",
      methods: ["mece"],
      text: "For the trip we still need to book the cabin, and someone should check the car, and we need groceries, and has anyone booked the cabin yet? Also snacks for the drive, and the car needs new wipers.",
    },
    inverted: {
      label: "Moving news",
      methods: ["inverted"],
      text: "So last weekend was a lot. After looking at a bunch of places and a few long nights talking it over, we finally signed a lease, so we're moving to Milwaukee in March!",
    },
    wwb: {
      label: "Double charge",
      methods: ["wwb"],
      text: "I just wanted to reach out to let you know that, unfortunately, it appears the invoice may have been charged twice, and I would really appreciate it if this could possibly be looked into at your earliest convenience.",
    },
    data: {
      label: "Phone plan",
      methods: ["data"],
      text: "The new phone plan is a lot cheaper and would save us a significant amount over the year compared to what we're paying now.",
    },
  };

  // ---------------------------------------------------------------------
  // Small text helpers
  // ---------------------------------------------------------------------

  const WORD = /[A-Za-z0-9À-ɏ$#%][A-Za-z0-9À-ɏ'’.,/$%#-]*/g;

  function words(s) {
    return (String(s || "").match(WORD) || []).filter((w) => /[A-Za-z0-9]/.test(w));
  }
  function wordCount(s) { return words(s).length; }

  function squash(s) { return String(s || "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim(); }

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'$%/ ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function capFirst(s) {
    return s.replace(/^([^A-Za-z0-9]*)([a-z])/, (m, pre, c) => pre + c.toUpperCase());
  }

  // Ends a sentence with a period unless it already has its own ending.
  function finish(s) {
    s = squash(s);
    if (!s) return "";
    if (/[.!?…:。]["'”’)\]]*$/.test(s) || /\p{Extended_Pictographic}️?$/u.test(s)) return s;
    return s.replace(/[,;]+$/, "") + ".";
  }

  function sentenceCase(s) { return capFirst(finish(s)); }

  // ---------------------------------------------------------------------
  // What a sentence is doing
  // ---------------------------------------------------------------------

  const RX = {
    ask: /\?["'”’)]*\s*$|\b(could you|can you|would you|will you|please|i'?d like|i would like|we'?d like|we would like|could we|can we|would it be possible|let me know|i need you|we need you|i'?d appreciate|i would (?:really )?appreciate|would appreciate it)\b/i,
    news: /\b(?:we'?re|we are|i'?m|i am|we'?ve|i'?ve|we have|i have)\s+(?:(?!been\b)\w+\s+)?(?:moving|going|getting|having|starting|leaving|decided|signed|booked|engaged|expecting|retiring|staying|skipping|hosting|doing|selling|buying|cancel+ing)\b|\b(?:we'?ll|we will)\s+(?:do|be|have|host|stay|move|skip)\b|\bdecided\b|\bit'?s official\b/i,
    date: /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}(?:st|nd|rd|th)\b|\b(?:jan(?:uary)?|feb(?:ruary)?|march|mar|apr(?:il)?|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bMay\s+\d|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:today|tomorrow|tonight|this weekend|next week|next month|this year|next year)\b/i,
    digit: /\d/,
    close: /\b(let me know|reply|rsvp|call me|text me|talk soon|see you|by (?:mon|tues|wednes|thurs|fri|satur|sun)day|by \d|by the \d|come by|welcome)\b/i,
    complication: /\b(but|however|unfortunately|now|changed?|won'?t|can'?t|isn'?t|aren'?t|wasn'?t|didn'?t|doesn'?t|broke|late|delayed|moved|cancel+ed|no longer|until|visiting|charged twice)\b/i,
    situation: /\b(usually|always|normally|traditionally|as planned|we planned|we talked|as you know|you know how|every (?:year|week|month|time)|last (?:week|month|year))\b/i,
    mood: /\b(hectic|crazy|chaotic|so busy|really busy|been busy|a lot going on|everything going on|with everything|moving pieces|back and forth|life gets|as (?:we all|you) know|been a while|it'?s been a (?:crazy|wild|long|busy)|was a lot|things have been)\b/i,
    vague: /\b(it|this|that|things?|stuff|everything|something)\b/i,
    need: /\?|\b(need|needs|should|someone|anyone|somebody|who can|has anyone|still have to|still need)\b/i,
  };

  // Scanner codes that mark a whole sentence as packaging rather than content.
  const FILLER_CODES = new Set(["D6", "D6m", "D5", "D5m", "D7"]);

  // Capitalized words that also appear mid-sentence are names.
  function namesIn(text) {
    const names = new Set(["I"]);
    const re = /(?<=[a-z0-9,;:'’)] )([A-Z][a-zA-Z'’-]+)/g;
    let m;
    while ((m = re.exec(String(text || "")))) names.add(m[1]);
    return names;
  }

  // Words that can lose their capital when an item moves into a list. Anything
  // else (a name, a day, a brand) keeps it: a wrong capital reads better than
  // "dan" or "saturday".
  const LOWERABLE = new Set(["the", "a", "an", "we", "our", "my", "it", "its", "this", "that", "these", "those",
    "there", "he", "she", "they", "their", "his", "her", "you", "your", "someone", "everyone", "anyone", "somebody",
    "everybody", "nobody", "all", "some", "both", "each", "one", "also", "and", "but", "so", "for", "to", "in", "on",
    "at", "with", "from", "by", "if", "when", "then", "still", "please", "has", "have", "is", "are", "can", "could",
    "ask", "book", "bring", "buy", "call", "check", "clean", "confirm", "cook", "drive", "email", "find", "fix", "get",
    "grab", "help", "make", "order", "pack", "pay", "pick", "plan", "print", "reply", "schedule", "send", "set", "sign",
    "take", "text", "food", "groceries", "snacks", "towels", "drinks", "dinner", "lunch", "breakfast", "gas", "tickets"]);

  function lowerFirst(s, names, known) {
    const m = /^([A-Z][a-zA-Z'’-]*)/.exec(s);
    if (!m) return s;
    const w = m[1];
    if (names.has(w) || w === "I" || /^I['’]/.test(w) || /^[A-Z]{2,}/.test(w)) return s;
    const lower = w.toLowerCase();
    if (LOWERABLE.has(lower) || (known && known.has(lower))) return lower + s.slice(w.length);
    return s;
  }

  function describe(text) {
    const t = squash(text);
    const scanned = TellScan.scan(t);
    const tell = scanned.findings.find((f) => f.severity !== "weak" && f.code !== "C5" && f.code !== "C5p") || null;
    const packaging = scanned.findings.find((f) => FILLER_CODES.has(f.code)) || null;
    const specific = RX.digit.test(t) || RX.date.test(t);
    const ask = RX.ask.test(t);
    const news = RX.news.test(t);
    const mood = RX.mood.test(t);
    let filler = null;
    if (!ask && !news && !specific) {
      const left = packaging ? wordCount(t.slice(0, packaging.start || 0) + " " + t.slice(packaging.end || t.length)) : 99;
      if (packaging && left < 5) filler = packaging.label;
      else if (mood) filler = "Mood, not a fact";
      else if (wordCount(t) <= 4 && /^(?:quick question|just checking in|checking in|following up|just following up|a quick note|just a quick note|touching base|just touching base|quick update)\b/i.test(t)) filler = "Announces, says nothing";
    }
    return {
      ask, news, mood, specific,
      number: RX.digit.test(t),
      date: RX.date.test(t),
      close: RX.close.test(t),
      complication: RX.complication.test(t),
      situation: RX.situation.test(t),
      need: RX.need.test(t),
      tell: tell ? { code: tell.code, label: tell.label } : null,
      filler,
    };
  }

  // ---------------------------------------------------------------------
  // Reading a draft
  // ---------------------------------------------------------------------

  const ABBR = /(?:^|[\s(])(?:mr|mrs|ms|dr|st|jr|sr|vs|etc|e\.g|i\.e|a\.m|p\.m|ave|apt|approx|inc|co|ltd|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.$/i;

  // In a text written all in lowercase, a sentence can start with a small letter.
  function splitSentences(par, lowerStyle) {
    const out = [];
    let start = 0;
    const re = /[.!?…。]+["'”’)\]]*(?=\s|$)|。/g;
    let m;
    while ((m = re.exec(par))) {
      const end = m.index + m[0].length;
      const rest = par.slice(end).replace(/^\s+/, "");
      if (m[0] === ".") {
        if (ABBR.test(par.slice(Math.max(0, m.index - 8), m.index + 1))) continue;
        if (/(?:^|\s)no$/i.test(par.slice(Math.max(0, m.index - 3), m.index)) && /^\d/.test(rest)) continue; // "No. 5"
      }
      const opensSentence = /^["'“‘(\[¿¡]?[A-Z0-9$#¿¡]/.test(rest) || (lowerStyle && /^[a-z]/.test(rest));
      if (rest && !opensSentence) continue;
      const s = par.slice(start, end).trim();
      if (s) out.push(s);
      start = end;
    }
    const tail = par.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }

  // A long sentence often carries two jobs ("we talked about the 14th, but my
  // in-laws are visiting"). Split it where the second job starts, so each part
  // can go to its own slot.
  const SUBJECT_START = /^(?:i|i'm|i'll|i've|i'd|we|we're|we'll|we've|you|you're|he|she|they|they're|it|it's|this|that|there|my|our|your|his|her|their|the|a|an|someone|anyone|everyone|has|have|is|are|can|could|would|will|do|does|did|after)\b/i;
  const NAME_START = /^[A-Z][a-z]+\b/;

  function splitClauses(s) {
    const n = wordCount(s);
    const parts = [];
    const cut = (re, minWords) => {
      const m = re.exec(s);
      if (!m) return false;
      const left = s.slice(0, m.index).trim();
      const right = s.slice(m.index + m[0].length).trim();
      if (wordCount(left) < 4 || wordCount(right) < 3) return false;
      if (n < minWords) return false;
      if (!SUBJECT_START.test(right) && !NAME_START.test(right)) return false;
      parts.push(...splitClauses(sentenceCase(left)), ...splitClauses(sentenceCase(right)));
      return true;
    };
    if (cut(/,\s+but\s+|;\s+but\s+/i, 14)) return parts;
    if (cut(/,\s+so\s+(?!that\b)/i, 14)) return parts;
    const ands = (s.match(/,\s+and\s+/gi) || []).length;
    if (ands >= 2 || n > 24) {
      if (cut(/,\s+and\s+/i, 0)) return parts;
    }
    return [s];
  }

  const LIST_MARK = /^\s*(?:[-*•●▪–—]|\d+[.)])\s+/;
  const GREET = "(?:[Hh]i|[Hh]ey|[Hh]ello|[Dd]ear|[Hh]iya|[Gg]reetings|[Gg]ood (?:morning|afternoon|evening))";
  const GREET_NAME = "(?:\\s+(?:and|&|all|everyone|guys|team|folks|y'all|there|[A-Z][\\w'’.-]*))";
  // A line that is only a greeting: "Hi Mark," or "Hey all!"
  const GREETING_LINE = new RegExp("^" + GREET + GREET_NAME + "{0,4}\\s*[,!:.]?\\s*$");
  // A greeting at the start of a line: "Hi Mark, I hope ..."
  const GREETING_LEAD = new RegExp("^(" + GREET + GREET_NAME + "{0,4}\\s*[,!:])\\s*");
  const CLOSER_HEAD = /^(thanks so much|thanks again|thanks|thank you so much|thank you|many thanks|best regards|kind regards|warm regards|best|regards|cheers|sincerely|warmly|love|talk soon|see you soon|xo+|take care)\b(.*)$/i;
  const NAME_LINE = /^(?:[-–—]\s*)?[A-Z][\w'’.-]*(?: [A-Z][\w'’.-]*){0,2}$/;
  const MAIL_FOOTER = /^(?:sent from my \w+|get outlook for \w+)/i;

  // "Thanks", "Thanks so much!", "Best, Sam" are closers; "Thanks for the flowers!" is a sentence.
  function isCloser(line) {
    const m = CLOSER_HEAD.exec(String(line || "").trim());
    if (!m) return false;
    const rest = m[2].trim();
    return rest === "" || /^[,.!]*\s*(?:[-–—]\s*)?(?:[A-Z][\w'’.-]*(?: [A-Z][\w'’.-]*)?)?[,.!]*$/.test(rest);
  }

  function parseDraft(text) {
    const src = String(text || "").replace(/\r\n?/g, "\n").trim();
    const out = { subject: "", greeting: "", signoff: "", pieces: [], sentences: 0 };
    if (!src) return out;

    let lines = src.split("\n").filter((l) => !MAIL_FOOTER.test(l.trim()));
    const sub = /^\s*subject:\s*(.+)$/i.exec(lines[0] || "");
    if (sub) { out.subject = sub[1].trim(); lines = lines.slice(1); }
    while (lines.length && !lines[0].trim()) lines.shift();

    if (lines.length) {
      const first = lines[0].trim();
      if (GREETING_LINE.test(first) && wordCount(first) <= 6) {
        out.greeting = first;
        lines = lines.slice(1);
      } else {
        const m = GREETING_LEAD.exec(first);
        if (m && wordCount(m[1]) <= 5 && first.length > m[0].length) {
          out.greeting = m[1].trim();
          lines[0] = first.slice(m[0].length);
        }
      }
    }

    // Sign-off: "Best,\nSam", "Thanks!\n– Sam", or a closer line on its own.
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const last = (lines[lines.length - 1] || "").trim();
    const prev = (lines[lines.length - 2] || "").trim();
    const hasBody = (k) => lines.slice(0, lines.length - k).some((l) => l.trim());
    if (lines.length >= 2 && NAME_LINE.test(last) && isCloser(prev) && hasBody(2)) {
      out.signoff = prev + "\n" + last;
      lines = lines.slice(0, -2);
    } else if (isCloser(last) && hasBody(1)) {
      out.signoff = last;
      lines = lines.slice(0, -1);
    }

    // Paragraphs, then sentences. List items stay one per line.
    const paras = lines.join("\n").split(/\n\s*\n/);
    const lowerStyle = !/[.!?]\s+[A-Z]/.test(lines.join(" ")) && /[.!?]\s+[a-z]/.test(lines.join(" "));
    let sentenceNo = 0;
    paras.forEach((para, p) => {
      const chunks = [];
      let buf = [];
      for (const line of para.split("\n")) {
        if (LIST_MARK.test(line)) {
          if (buf.length) { chunks.push(buf.join(" ")); buf = []; }
          chunks.push(line.replace(LIST_MARK, ""));
        } else if (line.trim()) {
          buf.push(line.trim());
        }
      }
      if (buf.length) chunks.push(buf.join(" "));
      for (const chunk of chunks) {
        for (const sentence of splitSentences(chunk, lowerStyle)) {
          sentenceNo += 1;
          for (const part of splitClauses(sentence)) {
            out.pieces.push({ id: "s" + out.pieces.length, raw: part.trim(), text: sentenceCase(part), para: p, sentence: sentenceNo });
          }
        }
      }
    });

    // A closing "Thanks!" or "Thanks, Jen" at the end of the last paragraph is
    // a sign-off, kept exactly as written. Not when it's the whole message.
    const tail = out.pieces[out.pieces.length - 1];
    if (!out.signoff && tail && out.pieces.length > 1 && isCloser(tail.raw) && wordCount(tail.raw) <= 4) {
      out.signoff = tail.raw;
      out.pieces.pop();
      sentenceNo = out.pieces.length ? out.pieces[out.pieces.length - 1].sentence : 0;
    }

    out.sentences = sentenceNo;
    for (const piece of out.pieces) piece.flags = describe(piece.text);
    return out;
  }

  // ---------------------------------------------------------------------
  // The state the slots hold
  // ---------------------------------------------------------------------

  function emptyState() {
    return {
      methods: { scqa: false, mece: false, inverted: false, wwb: false, data: false },
      isEmail: false,
      subject: "",
      greeting: "",
      signoff: "",
      point: "",
      situation: "",
      complication: "",
      order: "asc",
      support: [""],
      rule: "",
      groups: [{ label: "", items: "", mode: "auto" }],
      background: "",
      close: "",
      trim: true,
    };
  }

  function methodsFrom(list) {
    const m = emptyState().methods;
    for (const k of list || []) if (k in m) m[k] = true;
    return m;
  }

  // ---------------------------------------------------------------------
  // Picking methods: section 3 of references/methods.md, as rules
  // ---------------------------------------------------------------------

  const COMPANY = /\b(refunds?|invoices?|charged?|charges|bills?|billed|billing|accounts?|orders?|deposit|landlord|contractor|school|office|support|customer|insurance|claim|appointment|warranty|subscription|unfortunately|complain\w*|cancel\w*)\b/i;
  const DECISION = /\b(decided|decision|chose|chosen|we'?re going with|instead of|no longer|we'?ll do)\b/i;
  const NEWS_WORDS = /\b(we'?re moving|i'?m moving|moving to|moving out|engaged|expecting|new job|retiring|postponed|rescheduled|moved to|new date|cancel+ed|announce\w*|it'?s official|signed a lease)\b/i;
  const MONEY_TALK = /\b(cheaper|pricier|expensive|save|saves|saving|savings|cost|costs|price|budget|bill|pay|paying|spend)\b/i;

  function recommend(parsed, text) {
    const src = String(text || "");
    const recs = [];
    if (!wordCount(src) || !parsed || !parsed.pieces.length) return recs;
    const add = (method, why) => { if (!recs.some((r) => r.method === method)) recs.push({ method, why }); };
    const amounts = src.match(new RegExp(MONEY_OR_AMOUNT.source, "gi")) || [];
    if (NEWS_WORDS.test(src)) add("inverted", "It's news or a change of plan, so the news goes first.");
    if (amounts.length) add("data", "It has figures the reader needs to weigh.");
    else if (MONEY_TALK.test(src) && VAGUE_AMOUNT.test(src)) add("data", "It talks about money without the numbers.");
    const items = parsed.pieces.reduce((k, p) => k + Math.max(1, listItems(p.text).length), 0);
    const needs = parsed.pieces.reduce((k, p) => k + listItems(p.text).filter((t) => RX.need.test(t)).length, 0);
    if (needs >= 3 || items - parsed.pieces.length >= 2) add("mece", "It has several items or asks to sort.");
    if (DECISION.test(src) && !recs.some((r) => r.method === "inverted")) add("scqa", "It explains a decision that needs some context first.");
    if (COMPANY.test(src) || parsed.pieces.some((p) => p.flags.ask)) add("wwb", "It asks something of a busy reader.");
    return recs.slice(0, 2);
  }

  // ---------------------------------------------------------------------
  // The first pass: sort the draft's own sentences into the slots
  // ---------------------------------------------------------------------

  function scorePoint(piece, methods, index, total) {
    const f = piece.flags;
    if (f.filler) return -Infinity;
    let s = 0;
    if (f.ask) s += 3;
    if (/\?\s*$/.test(piece.text)) s += 1;
    if (f.news) s += methods.inverted ? 4 : 2;
    if (f.number || f.date) s += methods.data && f.number ? 2 : 1;
    if (f.situation) s -= 1;
    if (/^after\b/i.test(piece.text)) s -= 1;
    // In a buried-lede draft the point tends to be late; break ties toward it.
    s += (index / Math.max(1, total)) * 0.5;
    return s;
  }

  // MECE items: a run-on list ("we need groceries, and someone should check
  // the car, and ...") becomes one item per job.
  function listItems(text) {
    const parts = String(text).split(/,\s+(?:and\s+)?(?=(?:also\s+)?(?:i|we|you|he|she|they|someone|anyone|has|have|the|a|an|our|my|your|[A-Z][a-z]+)\b)|;\s+/);
    return parts
      .map((p) => p.trim().replace(/^(?:and|also|plus)\s+/i, "").replace(/[.;,]+$/, ""))
      .filter((p) => wordCount(p) >= 1)
      .map((p) => capFirst(p));
  }

  function pickPoint(parsed, methods) {
    let best = null;
    let bestScore = -Infinity;
    parsed.pieces.forEach((p, i) => {
      const sc = scorePoint(p, methods, i, parsed.pieces.length);
      if (sc > bestScore) { best = p; bestScore = sc; }
    });
    return { piece: best, score: bestScore };
  }

  function suggest(parsed, methods) {
    methods = methods || emptyState().methods;
    const st = emptyState();
    st.methods = Object.assign({}, methods);
    st.greeting = parsed.greeting;
    st.signoff = parsed.signoff;
    st.subject = parsed.subject;
    st.isEmail = !!parsed.subject;
    const used = new Set();
    const pieces = parsed.pieces;
    const live = pieces.filter((p) => !p.flags.filler);

    const { piece: best, score: bestScore } = pickPoint(parsed, methods);
    const weakPoint = !best || bestScore < 1;
    if (best && bestScore > -Infinity && !(methods.mece && weakPoint)) {
      st.point = best.text;
      used.add(best.id);
    }
    // With MECE, a list whose only "point" is one of its own items needs a
    // governing thought the visitor writes; leave the slot empty and say so.
    if (methods.mece && best && st.point && listItems(best.text).length > 1) {
      st.point = "";
      used.delete(best.id);
    }

    // The close: a late action line that isn't the point.
    const tailPieces = live.filter((p) => !used.has(p.id)).slice(-2);
    const closer = tailPieces.reverse().find((p) => p.flags.close && !p.flags.ask);
    if (closer) { st.close = closer.text; used.add(closer.id); }

    // SCQA: the situation and the complication.
    if (methods.scqa) {
      const rest = live.filter((p) => !used.has(p.id));
      const comp = rest.find((p) => p.flags.complication && !p.flags.situation) || null;
      if (comp) { st.complication = comp.text; used.add(comp.id); }
      const sit = rest.find((p) => !used.has(p.id) && p.flags.situation) ||
        (comp ? rest.slice(0, rest.indexOf(comp)).reverse().find((p) => !used.has(p.id)) : null);
      if (sit) { st.situation = sit.text; used.add(sit.id); }
    }

    let rest = live.filter((p) => !used.has(p.id));

    // Inverted Pyramid: backstory to the bottom, the rest by importance.
    if (methods.inverted) {
      const back = rest.filter((p) => p.flags.situation || /^(after|before|we'?ve been|i'?ve been|as some of you know)\b/i.test(p.text));
      st.background = back.map((p) => p.text).join(" ");
      back.forEach((p) => used.add(p.id));
      rest = rest.filter((p) => !used.has(p.id));
      const weight = (p) => (p.flags.ask || p.flags.close ? 3 : 0) + (p.flags.date ? 2 : 0) + (p.flags.number ? 1 : 0);
      rest = rest.map((p, i) => [p, i]).sort((a, b) => (weight(b[0]) - weight(a[0])) || (a[1] - b[1])).map((x) => x[0]);
    }

    if (methods.mece) {
      const items = [];
      rest.forEach((p) => { listItems(p.text).forEach((t) => items.push(t)); used.add(p.id); });
      if (best && !st.point && !best.flags.filler) {
        listItems(best.text).forEach((t) => { if (!items.includes(t)) items.unshift(t); });
        used.add(best.id);
      }
      const needs = items.filter((t) => RX.need.test(t));
      if (needs.length && needs.length < items.length && needs.length / items.length < 0.7) {
        st.rule = "Settled vs. still needed";
        st.groups = [
          { label: "Settled", items: items.filter((t) => !RX.need.test(t)).join("\n"), mode: "auto" },
          { label: "Still needed", items: needs.join("\n"), mode: "auto" },
        ];
      } else {
        st.groups = [{ label: "", items: items.join("\n"), mode: "auto" }];
      }
      st.support = [""];
    } else {
      st.support = rest.length ? rest.map((p) => p.text) : [""];
      rest.forEach((p) => used.add(p.id));
    }
    st.used = Array.from(used);
    return st;
  }

  // Switching methods: move content between slots instead of losing it, and
  // fill newly shown slots from unused pieces of the draft.
  function switchMethod(state, parsed, key, on) {
    const st = JSON.parse(JSON.stringify(state));
    st.methods[key] = on;
    const inUse = usedPieces(st, parsed);
    const free = (parsed ? parsed.pieces : []).filter((p) => !inUse.has(p.id) && !p.flags.filler);
    const lines = st.support.filter((s) => s.trim());
    if (key === "mece") {
      if (on) {
        const items = lines.flatMap(listItems);
        st.groups = [{ label: "", items: items.join("\n"), mode: "auto" }];
        st.support = [""];
      } else {
        const names = namesIn(st.groups.map((g) => g.items).join("\n"));
        const back = [];
        for (const g of st.groups) {
          const items = groupItems(g);
          if (!items.length) continue;
          const label = squash(g.label).replace(/[:.\s]+$/, "");
          if (label) back.push(finish(label + ": " + lowerFirst(joinItems(items, names), names)));
          else items.forEach((t) => back.push(finish(t)));
        }
        st.support = back.length ? back : [""];
        st.groups = [{ label: "", items: "", mode: "auto" }];
      }
    }
    if (key === "scqa") {
      if (on) {
        if (!st.complication.trim()) {
          const c = free.find((p) => p.flags.complication) ||
            lines.map((t) => ({ text: t, flags: describe(t) })).find((p) => p.flags.complication);
          if (c) { st.complication = c.text; st.support = dropText(st.support, c.text); }
        }
        if (!st.situation.trim()) {
          const s = free.find((p) => p.flags.situation && p.text !== st.complication);
          if (s) { st.situation = s.text; st.support = dropText(st.support, s.text); }
        }
      } else {
        const moved = [st.situation, st.complication].map(squash).filter(Boolean);
        if (moved.length) {
          if (st.methods.mece) {
            const g = st.groups[0];
            g.items = moved.concat(groupItems(g)).join("\n");
          } else {
            st.support = moved.concat(lines);
          }
        }
        st.situation = "";
        st.complication = "";
      }
    }
    if (key === "inverted" && !on && st.background.trim()) {
      if (st.methods.mece) st.groups[st.groups.length - 1].items += "\n" + st.background.trim();
      else st.support = st.support.filter((s) => s.trim()).concat([st.background.trim()]);
      st.background = "";
    }
    if (key === "wwb" && on && !st.isEmail && st.subject) st.isEmail = true;
    return st;
  }

  function dropText(list, text) {
    const out = list.filter((s) => s.trim() !== text.trim());
    return out.length ? out : [""];
  }

  // Which draft pieces a slot already holds (by text).
  function slotTexts(st) {
    const parts = [st.point, st.close, st.greeting, st.signoff, st.subject];
    if (st.methods.scqa) parts.push(st.situation, st.complication);
    if (st.methods.inverted) parts.push(st.background);
    if (st.methods.mece) st.groups.forEach((g) => parts.push(g.items, g.label));
    else parts.push(...st.support);
    return norm(parts.join(" \n "));
  }

  function usedPieces(st, parsed) {
    const hay = slotTexts(st);
    const used = new Set();
    for (const p of (parsed ? parsed.pieces : [])) {
      const n = norm(p.text);
      if (!n) continue;
      if (hay.includes(n)) { used.add(p.id); continue; }
      // MECE items are pieces of a piece; count it used if most of it is there.
      const ws = n.split(" ").filter((w) => w.length > 2);
      const found = ws.filter((w) => hay.includes(w)).length;
      if (ws.length >= 3 && found / ws.length >= 0.8) used.add(p.id);
    }
    return used;
  }

  // ---------------------------------------------------------------------
  // Assembling the rewrite
  // ---------------------------------------------------------------------

  // Mechanical cuts a careful editor makes on sight. Each one takes out a
  // whole phrase that leaves a complete sentence behind; anything riskier is
  // left in place for a fix card to point at. Every cut is listed.
  const TRIMS = [
    { re: /\bI (?:just )?wanted to (?:reach out|touch base|follow up)(?: and| to)? (?:let you know|say|ask|tell you)(?: that)?,?\s*/gi, why: "stock opener" },
    { re: /\bI hope (?:this (?:message|email|note) finds you well|you(?:'re|’re| are) (?:doing )?well|all is well)(?:[.!]+\s*|\s*$)/gi, why: "stock opener" },
    { re: /(^|[.!?]\s+)(?:In (?:summary|conclusion|sum|short)|To sum up|All in all|Overall|Ultimately|At the end of the day),\s*/g, keep: 1, why: "recap opener" },
    { re: /,?\s*at your earliest convenience/gi, why: "stock phrase" },
    { re: /(^|[.!?]\s+)(?:Please )?(?:don't|don’t|do not) hesitate to (?:reach out|contact (?:me|us)|ask)(?: if [^.!?]*)?[.!]?\s*/gi, keep: 1, why: "chatbot residue" },
    { re: /(?<!\bnot|n't|n’t)\s(?:very|really|truly|incredibly|extremely|totally|deeply|super) (?=[a-z])(?!(?:much|many|well|first|last|same|own|end|least|best|top|little|few)\b)/g, to: " ", why: "intensifier", wwb: true },
    { re: /^(?:Very|Really|Truly|Incredibly|Extremely|Totally|Deeply) (?=[a-z])(?!(?:much|many|well|first|last|same|own|end|least|best|top|little|few)\b)/g, why: "intensifier", wwb: true },
    { re: /\b(could|may|might|would) possibly\b/gi, to: "$1", why: "hedge", wwb: true },
    { re: /\bjust (?=(?:a quick|wanted|to let|checking))/gi, why: "filler", wwb: true },
  ];
  const MARK = "\u0001";

  function applyTrims(text, wwb) {
    const cut = [];
    let s = String(text);
    for (const t of TRIMS) {
      if (t.wwb && !wwb) continue;
      s = s.replace(t.re, function (m) {
        const groups = Array.prototype.slice.call(arguments, 1, -2);
        const lead = t.keep ? groups[t.keep - 1] || "" : "";
        cut.push({ text: m.slice(lead.length).trim().replace(/[,.!]+$/, ""), why: t.why });
        if (t.to) return t.to.replace("$1", groups[0] || "");
        return lead + MARK;
      });
    }
    // A cut at the start of a sentence leaves the next word to be capitalized.
    s = s.replace(new RegExp("(^|[.!?]\\s+)" + MARK + "+\\s*([a-z])", "g"), (m, a, c) => a + c.toUpperCase());
    s = s.split(MARK).join("");
    s = s.replace(/ {2,}/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/^[,\s]+/, "");
    return { text: capFirst(s.trim()), cut };
  }

  function joinItems(items, names, known) {
    const xs = items.map((t, i) => {
      const x = t.trim().replace(/[.;,!]+$/, "");
      return i === 0 ? x : lowerFirst(x, names, known);
    });
    if (xs.length <= 1) return xs.join("");
    if (xs.length === 2) return xs[0] + " and " + xs[1];
    return xs.slice(0, -1).join(", ") + ", and " + xs[xs.length - 1];
  }

  function groupItems(g) {
    return String(g.items || "").split("\n").map((s) => s.trim().replace(LIST_MARK, "")).filter(Boolean);
  }

  // Builds the text, and a map of which slot each stretch of it came from, so
  // a flagged phrase can be traced back to the line that holds it.
  function assemble(st) {
    const m = st.methods;
    const cuts = [];
    const tidy = (s) => {
      if (!squash(s)) return "";
      if (!st.trim) return sentenceCase(s);
      const r = applyTrims(squash(s), m.wwb);
      cuts.push(...r.cut);
      return r.text ? sentenceCase(r.text) : "";
    };
    const allText = [st.point, st.situation, st.complication, st.close, st.background]
      .concat(st.support, st.groups.map((g) => g.items + "\n" + g.label)).join("\n");
    const names = namesIn(allText);
    const known = new Set(allText.match(/\b[a-z][a-z'’-]+\b/g) || []);
    const seg = (text, field, index) => ({ text, field, index: index || 0 });
    const blocks = [];

    if (m.wwb && st.isEmail && squash(st.subject)) blocks.push({ head: true, join: "", segs: [seg("Subject: " + squash(st.subject), "subject")] });
    if (squash(st.greeting)) blocks.push({ head: true, join: "", segs: [seg(squash(st.greeting), "greeting")] });

    const point = seg(tidy(st.point), "point");
    const support = m.mece ? [] : st.support.map((t, i) => seg(tidy(t), "support", i)).filter((x) => x.text);
    let opening = [];
    if (m.scqa) {
      const S = seg(tidy(st.situation), "situation");
      const C = seg(tidy(st.complication), "complication");
      if (m.inverted) opening = [point, S, C];
      else if (st.order === "sca") opening = [S, C, point];
      else if (st.order === "csa") opening = [C, S, point];
      else opening = [point, S, C];
      opening = opening.filter((x) => x.text);
    } else {
      opening = point.text ? [point] : [];
      if (!m.mece && support.length && wordCount(support[0].text) <= 30) opening.push(support.shift());
    }
    if (opening.length) blocks.push({ join: " ", segs: opening });

    if (m.mece) {
      st.groups.forEach((g, gi) => {
        const items = groupItems(g).map((t) => {
          if (!st.trim) return t;
          const r = applyTrims(t, m.wwb);
          cuts.push(...r.cut);
          return r.text;
        }).filter(Boolean);
        if (!items.length) return;
        const label = squash(g.label).replace(/[:.\s]+$/, "");
        const asList = g.mode === "list" || (g.mode === "auto" && items.length >= 3);
        if (asList) {
          const segs = label ? [seg(label + ":", "group-label", gi)] : [];
          items.forEach((t, k) => segs.push(seg((k + 1) + ". " + sentenceCase(t), "group-items", gi)));
          blocks.push({ join: "\n", segs });
        } else {
          const joined = joinItems(items, names, known);
          blocks.push({ join: "", segs: [seg(label ? finish(label + ": " + lowerFirst(joined, names, known)) : sentenceCase(joined), "group-items", gi)] });
        }
      });
    } else {
      support.forEach((s) => blocks.push({ join: "", segs: [s] }));
    }
    if (m.inverted) {
      const b = tidy(st.background);
      if (b) blocks.push({ join: "", segs: [seg(b, "background")] });
    }
    const close = tidy(st.close);
    if (close) blocks.push({ join: "", segs: [seg(close, "close")] });
    if (squash(st.signoff)) blocks.push({ tail: true, join: "", segs: [seg(st.signoff.trim().replace(/[ \t]+/g, " "), "signoff")] });

    let text = "";
    const parts = [];
    let bodyStart = -1;
    let bodyEnd = 0;
    blocks.forEach((b, bi) => {
      if (bi) text += "\n\n";
      if (!b.head && !b.tail && bodyStart < 0) bodyStart = text.length;
      b.segs.forEach((s, si) => {
        if (si) text += b.join;
        const start = text.length;
        text += s.text;
        parts.push({ field: s.field, index: s.index, start, end: text.length });
      });
      if (!b.head && !b.tail) bodyEnd = text.length;
    });
    const body = bodyStart < 0 ? "" : text.slice(bodyStart, bodyEnd);
    return { text, body, bodyStart: Math.max(0, bodyStart), cuts, parts, opening: opening.length };
  }

  // Writes the trims into the slots themselves, so the text you edit is the
  // text you see. Returns what was cut; after this, nothing is trimmed silently.
  function bakeTrims(state) {
    const st = JSON.parse(JSON.stringify(state));
    const cuts = [];
    const bake = (v) => {
      if (!squash(v)) return v;
      const r = applyTrims(squash(v), st.methods.wwb);
      cuts.push(...r.cut);
      return r.text;
    };
    if (st.trim) {
      for (const f of ["point", "situation", "complication", "background", "close"]) st[f] = bake(st[f]);
      st.support = st.support.map(bake);
      st.groups.forEach((g) => { g.items = String(g.items || "").split("\n").map((t) => (t.trim() ? bake(t) : t)).join("\n"); });
      st.trim = false;
    }
    return { state: st, cuts };
  }

  function frameParts(built) {
    return built.parts.filter((p) => p.field === "greeting" || p.field === "signoff" || p.field === "subject").map((p) => [p.start, p.end]);
  }

  function partAt(built, offset) {
    return built.parts.find((p) => offset >= p.start && offset < p.end) || null;
  }

  // ---------------------------------------------------------------------
  // Measuring
  // ---------------------------------------------------------------------

  const WASTE_CODES = new Set(["W2", "W3", "W4", "D6", "D6m", "D5", "D5m", "D7", "B4"]);
  const FILLER_WORDS = /\b(just|actually|basically|simply|literally|honestly)\b/gi;

  // Typing in a slot re-scores the rewrite, not the draft: keep recent answers.
  function remember(fn) {
    const cache = new Map();
    return function (text, flag) {
      const key = (flag ? "1" : "0") + String(text || "");
      if (cache.has(key)) return cache.get(key);
      const value = fn(text, flag);
      if (cache.size >= 40) cache.delete(cache.keys().next().value);
      cache.set(key, value);
      return value;
    };
  }

  // Bernoff's meaning ratio, estimated: the share of words that aren't stock
  // phrases, intensifiers, weasel words, jargon or mood-only sentences.
  // Greetings and sign-offs count as meaningful, as the skill's guide says.
  const meaningRatio = remember(function (text) {
    const src = String(text || "");
    const total = wordCount(src);
    if (!total) return null;
    const r = TellScan.scan(src, { wwb: true });
    const spans = [];
    for (const f of r.findings) {
      if (!WASTE_CODES.has(f.code)) continue;
      if (typeof f.start === "number" && f.end > f.start) spans.push([f.start, f.end]);
      (f.spans || []).forEach((s) => spans.push([s.start, s.end]));
    }
    let m;
    FILLER_WORDS.lastIndex = 0;
    while ((m = FILLER_WORDS.exec(src))) spans.push([m.index, m.index + m[0].length]);
    // Mood-only sentences are waste, whole.
    const parsed = parseDraft(src);
    for (const p of parsed.pieces) {
      if (p.flags.filler !== "Mood, not a fact") continue;
      const core = p.raw.replace(/[.!?]+$/, "");
      const at = src.indexOf(core);
      if (at >= 0) spans.push([at, at + core.length]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const s of spans) {
      const lastSpan = merged[merged.length - 1];
      if (lastSpan && s[0] <= lastSpan[1]) lastSpan[1] = Math.max(lastSpan[1], s[1]);
      else merged.push(s.slice());
    }
    const waste = merged.reduce((n, [a, b]) => n + wordCount(src.slice(a, b)), 0);
    return Math.max(0, Math.min(100, Math.round(100 * (total - waste) / total)));
  });

  const tellCount = remember(function (text, wwb) {
    const r = TellScan.scan(String(text || ""), { wwb: !!wwb });
    return { strong: r.counts.strong, moderate: r.counts.moderate, findings: r.findings };
  });

  // The scanner's fix notes are written for Claude. These read better on the page.
  const FIX_FOR_PAGE = {
    B5: "Fill it in or delete it.",
    C7: "Swap each one for the plain or specific word.",
    D6: "Cut it. Say it the way you would to this person.",
    D6m: "Open on the point, or on your own greeting.",
    W1: "Say who did it: “you charged” instead of “was charged”.",
    W2: "Swap the vague amount for a number or a name.",
    W3: "Cut it. The fact underneath is stronger.",
    W4: "Say it in plain words, or cut it.",
  };
  function plainFix(f) { return FIX_FOR_PAGE[f.code] || f.fix; }

  const withSay = (say, fix) => Object.assign(fix, { say });
  const JARGON_SWAP = { "touch base": "talk", "circle back": "follow up", "going forward": "from now on", "moving forward": "from now on",
    "at your earliest convenience": "", "per my last email": "", "please be advised": "", "as per": "per", "action items": "next steps",
    "action item": "next step", "bandwidth": "time", "leverage": "use" };
  function scannerFix(f) {
    const m = (f.match || "").trim();
    if (!m) return null;
    if (f.code === "W3") return cut(m);
    if (f.code === "W4" && JARGON_SWAP[m.toLowerCase()] !== undefined) {
      const to = JARGON_SWAP[m.toLowerCase()];
      return to ? swap(m, matchCase(m, to)) : cut(m);
    }
    if (f.code === "C6") return Object.assign(swap(/\s*[—–]\s*/, ", "), { say: "Swap the dash for a comma" });
    if (f.code === "C8") return withSay("Cut “" + m + "”", cut(new RegExp("\\b" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ",?\\s*")));
    if (f.code === "D5" || f.code === "D5m") return withSay("Cut “" + m + "”", cut(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ",?\\s*")));
    if (f.code === "D6" || f.code === "D6m") return withSay("Cut “" + m + "”", cut(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[.!,]?\\s*", "i")));
    return null;
  }

  // Applying fixes. Find strings match exactly, then ignoring case; patterns
  // replace their first match (or every match, for a /g pattern).
  function applyPairs(text, pairs) {
    let out = String(text || "");
    for (const pr of pairs) {
      if (pr.find instanceof RegExp) { out = out.replace(pr.find, pr.replace); continue; }
      let at = out.indexOf(pr.find);
      if (at < 0) at = out.toLowerCase().indexOf(String(pr.find).toLowerCase());
      if (at < 0) continue;
      out = out.slice(0, at) + pr.replace + out.slice(at + pr.find.length);
    }
    // Tidy what a cut leaves behind.
    return out.replace(/ {2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/,\s*([.!?])/g, "$1").replace(/^[\s,;:]+/, "")
      .replace(/(^|[.!?]\s+)([a-z])/g, (x, a, c) => a + c.toUpperCase()).trim();
  }

  function contentFields(st) {
    const list = [["point", 0], ["situation", 0], ["complication", 0], ["background", 0], ["close", 0], ["subject", 0]];
    st.support.forEach((x, i) => list.push(["support", i]));
    st.groups.forEach((g, i) => list.push(["group-items", i]));
    return list;
  }

  // Applies a card's automatic fixes, and any choices the writer picked
  // ({ issueIndex: choiceIndex }). Returns the new state and how many changed.
  function applyFixes(state, card, picks) {
    const st = JSON.parse(JSON.stringify(state, (k, v) => (v instanceof RegExp ? undefined : v)));
    let applied = 0;
    card.issues.forEach((issue, k) => {
      let fix = issue.fix;
      if (!fix) return;
      if (fix.choices) {
        if (!picks || picks[k] === undefined) return;
        fix = fix.choices[picks[k]];
      }
      const fields = fix.scope === "all" ? contentFields(st) : [[card.field, card.index]];
      let changed = false;
      for (const [f, i] of fields) {
        const before = fieldValue(st, f, i);
        if (!before) continue;
        const after = applyPairs(before, fix.pairs);
        if (after !== before) { setField(st, f, i, after); changed = true; }
      }
      if (changed) applied += 1;
    });
    return { state: st, applied };
  }

  function autoFixes(card) {
    return card.issues.filter((i) => i.fix && i.fix.pairs).length;
  }

  // ---------------------------------------------------------------------
  // The checks, from each method guide's own checklist
  // ---------------------------------------------------------------------

  const MONEY_OR_AMOUNT = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|dollars|bucks|therms|hours?|minutes?|miles?|days?|weeks?|months?|years?|people|gb|kwh|lbs?|pounds|kg)\b/i;
  // A comparison, not just any small word: "up from $96", "$61 instead of $95",
  // "34 vs. 31 therms", "about one flight home".
  const COMPARISON = /\b(?:up from|down from|from \$?\d|than|vs\.?|versus|instead of|compared|more|less|fewer|higher|lower|cheaper|pricier|increase[ds]?|decrease[ds]?|rose|dropped|jumped|went (?:up|down)|last (?:month|year|week|time|bill)|previous|double|half|twice|triple|the same as|as much as|enough for|equal to|about (?:one|a|an|two|three|the cost of)|roughly)\b|%/i;
  const PRECISION = /\$\s?\d[\d,]*\.\d{2}\b|\b\d+\.\d{2,}\b/;
  const VAGUE_AMOUNT = /\b(a lot|lots|tons|way (?:more|less|cheaper)|much (?:more|less|cheaper|higher|lower)|significant(?:ly)?|substantial(?:ly)?|considerabl[ey]|huge|massive|a fortune|a bunch)\b/i;
  const BUILDUP = /^(?:so,?\s|well,?\s|big news|some (?:big |exciting )?news|guess what|as some of you know|it'?s been a)/i;
  const GENERIC_SUBJECT = /^(?:re:\s*)?(?:hi|hello|hey|question|quick question|following up|follow up|update|checking in|hello there|important|urgent|request)[!.?]*$/i;
  const RECAP = /^(?:in (?:summary|conclusion|short|sum)|to sum up|all in all|overall|again|as i said|so,? to recap)\b/i;
  const FEELING = /\b(stressed|overwhelmed|worried|frustrated|anxious|exhausted|swamped|upset)\b/i;

  function sentencesOf(text) {
    return String(text || "").split(/\n+/).flatMap((line) => splitSentences(line.replace(LIST_MARK, ""))).filter((s) => wordCount(s));
  }

  function stem(w) {
    return w.replace(/(?:ing|ed|es|s)$/, "");
  }
  const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "for", "on", "in", "at", "we", "i", "you", "it", "is", "are", "be", "our", "my", "your", "still", "need", "needs", "should", "someone", "anyone", "has", "have", "yet", "also", "new", "get", "with"]);
  function keyStems(t) {
    return new Set(norm(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
  }
  function overlap(a, b) {
    const A = keyStems(a);
    const B = keyStems(b);
    if (!A.size || !B.size) return 0;
    let n = 0;
    for (const x of A) if (B.has(x)) n += 1;
    return n / Math.min(A.size, B.size);
  }

  function bareNumbers(sentences) {
    return sentences.filter((s) => MONEY_OR_AMOUNT.test(s) && !COMPARISON.test(s));
  }

  function check(st, parsed) {
    const m = st.methods;
    const out = [];
    const add = (id, method, status, title, detail, quotes, desk) => {
      const item = { id, method, status, title, detail: detail || "", quotes: quotes || [] };
      item.desk = desk || deskForCheck(item);
      out.push(item);
    };
    const built = assemble(st);
    const point = squash(st.point);
    const bodySentences = sentencesOf(built.body);

    // Minto: always on.
    if (!point) {
      add("minto-point", "pyramid", "warn", "Write your point",
        m.mece ? "Say what the list is for, in one sentence. For example: Three jobs before Friday."
          : "The one sentence the message exists to deliver: the ask, the news, the decision, or the fix you want.");
    } else {
      const firstTwo = norm(bodySentences.slice(0, 2).join(" "));
      const shown = st.trim ? applyTrims(point, m.wwb).text : point;
      const pointFirst = sentencesOf(shown).map(norm).some((s) => s && firstTwo.includes(s.slice(0, 40)));
      if (pointFirst) add("minto-point", "pyramid", "pass", "Your point comes first");
      else add("minto-point", "pyramid", "info", "Your point lands after the setup",
        "That's fine when the reader needs grounding first. For a busy reader, choose Answer first.");

      const pointSentences = sentencesOf(point);
      const asks = (point.match(/\?/g) || []).length;
      if (pointSentences.length > 2 || asks > 1) {
        add("minto-one", "pyramid", "warn", "Two points are fighting for the lead",
          "Pick the one that leads and move the other into the support, or send it separately.");
      }
      const specific = RX.digit.test(point) || RX.date.test(point) || /(?<=[a-z0-9,;:'’)] )[A-Z][a-z]+/.test(point);
      if (RX.vague.test(point) && !specific) {
        add("minto-specific", "pyramid", "warn", "Your point leans on a vague word",
          "Name the thing and the date, so the point works on its own. Not: push it back. Instead: Could we move the deck start from 11/14 to 11/21?",
          [point.match(RX.vague)[0]]);
      } else {
        add("minto-specific", "pyramid", "pass", "Your point stands on its own");
      }
      const n = wordCount(point);
      if (!m.inverted && n > 40) {
        add("minto-length", "pyramid", "warn", "Your point runs " + n + " words",
          "Cut it to the one thing you want them to do or know. Move the reasons below it.");
      }
    }

    if (!m.mece) {
      const items = st.support.filter((s) => s.trim());
      if (!items.length) {
        add("minto-support", "pyramid", "info", "Add what backs your point",
          "A reason or a fact the reader needs. Skip it only if the point needs nothing else.");
      } else if (items.length > 4) {
        add("minto-support", "pyramid", "warn", "That's " + items.length + " supporting points",
          "Two to four is normal. Group them (try MECE) or cut the weakest.");
      } else {
        add("minto-support", "pyramid", "self", "Are your supporting points all the same kind?",
          "All reasons or all steps, with no overlaps.");
      }
    }

    const close = squash(st.close);
    if (close && (RECAP.test(close) || (point && overlap(close, point) >= 0.8 && wordCount(close) > 4))) {
      add("minto-close", "pyramid", "warn", "Your ending repeats the piece",
        "End on the next action, a date, or a final image. Never a recap.");
    }

    // The draft's leftovers.
    if (parsed && parsed.pieces.length) {
      const used = usedPieces(st, parsed);
      const unused = parsed.pieces.filter((p) => !used.has(p.id));
      const filler = unused.filter((p) => p.flags.filler);
      const real = unused.filter((p) => !p.flags.filler);
      if (real.length) {
        add("draft-unused", "pyramid", "info",
          real.length === 1 ? "One sentence from your draft isn't used" : real.length + " sentences from your draft aren't used",
          "Leave them out on purpose, or add them back.", real.map((p) => p.text));
      }
      if (filler.length) {
        add("draft-filler", "pyramid", "pass",
          "Left out " + (filler.length === 1 ? "one line" : filler.length + " lines") + " that read as filler",
          "Add any of them back if they do real work for this reader.", filler.map((p) => p.text));
      }
    }

    // SCQA.
    if (m.scqa) {
      const S = squash(st.situation);
      const C = squash(st.complication);
      if (!S) add("scqa-situation", "scqa", "warn", "Add the situation", "Something the reader already knows and agrees with. One fact. For example: Thanksgiving is usually at Mom's.");
      else if (RX.mood.test(S) && !(RX.digit.test(S) || RX.date.test(S))) add("scqa-situation", "scqa", "warn", "The situation is a mood, not a fact", "Swap it for something specific the reader already accepts.");
      else add("scqa-situation", "scqa", "self", "Would the reader agree with the situation without thinking?", "If it's arguable, it isn't the situation.");

      if (!C) add("scqa-complication", "scqa", "warn", "Add the complication", "What changed or went wrong, as a fact. For example: But her kitchen won't be finished until January.");
      else if ((FEELING.test(C) || RX.mood.test(C)) && !(RX.digit.test(C) || RX.date.test(C))) add("scqa-complication", "scqa", "warn", "The complication is a feeling", "Make it a fact, with a date if there is one.");
      else add("scqa-complication", "scqa", "pass", "The complication is a concrete change");

      const openingSentences = sentencesOf([st.point, S, C].join(" ")).length;
      if (openingSentences > 4) add("scqa-length", "scqa", "warn", "The opening runs " + openingSentences + " sentences", "Keep it to four or fewer. Move detail and history into the body.");
      add("scqa-answer", "scqa", "self", "Does your answer answer the question the complication raises?", "Not a neighboring question. If it needs “and”, you have two messages.");
    }

    // MECE.
    if (m.mece) {
      const groups = st.groups.filter((g) => groupItems(g).length);
      if (!squash(st.rule)) add("mece-rule", "mece", "warn", "Name your sorting rule", "One rule for every group: by person, by time, settled vs. still needed, by option, or by cost.");
      else add("mece-rule", "mece", "pass", "One sorting rule");
      if (groups.length < 2) add("mece-count", "mece", "warn", "Sort the items into groups", "Two to four groups, one rule. Each item fits exactly one group.");
      else if (groups.length > 4) add("mece-count", "mece", "warn", groups.length + " groups is a lot", "Five or more usually means two rules got mixed. Merge or pick one rule.");
      else add("mece-count", "mece", "pass", groups.length + " groups");
      if (groups.length > 1 && groups.some((g) => !squash(g.label))) add("mece-labels", "mece", "warn", "Name every group", "Use the reader's words: a name, a day, or Settled and Still needed.");

      const all = [];
      st.groups.forEach((g) => groupItems(g).forEach((t) => all.push(t)));
      let dup = null;
      for (let i = 0; i < all.length && !dup; i++) {
        for (let j = i + 1; j < all.length; j++) {
          if (overlap(all[i], all[j]) >= 0.6) { dup = [all[i], all[j]]; break; }
        }
      }
      if (dup) add("mece-overlap", "mece", "warn", "Two items say the same thing", "Keep one. If they really differ, say how.", dup);
      else if (all.length) add("mece-overlap", "mece", "pass", "No item appears twice");
      add("mece-kind", "mece", "self", "Are the groups the same kind of thing?", "All options, or all tasks. And is the order deliberate?");
    }

    // Inverted Pyramid.
    if (m.inverted && point) {
      const n = wordCount(point);
      if (n > 35) add("inv-lede", "inverted", "warn", "The lede runs " + n + " words", "Keep it under about 35. Move the how lower.");
      else add("inv-lede", "inverted", "pass", "The lede is short enough to read in one go");
      if (!RX.date.test(point)) add("inv-when", "inverted", "warn", "Say when in the lede", "A date, a day or a month. Readers who stop at the first line still need it.");
      else add("inv-when", "inverted", "pass", "The lede says when");
      if (BUILDUP.test(point)) add("inv-buildup", "inverted", "warn", "The lede opens with buildup", "Start on the news itself.");
      add("inv-cut", "inverted", "self", "Cut test: delete the last paragraph", "Does it still work? Keep cutting until only the lede is left.");
    }

    // Writing Without Bullshit.
    if (m.wwb) {
      if (st.isEmail) {
        const subject = squash(st.subject);
        if (!subject) add("wwb-subject", "wwb", "warn", "Write a subject line", "Make it useful even if it's the only thing read. Need a new pickup time for Ava starting 1/6 beats Question.");
        else if (GENERIC_SUBJECT.test(subject) || wordCount(subject) < 4) add("wwb-subject", "wwb", "warn", "The subject line won't work on its own", "Put the ask or the news in it, with a detail.");
        else add("wwb-subject", "wwb", "pass", "The subject line works on its own");
      }
      const n = wordCount(built.body);
      if (n > 250) add("wwb-length", "wwb", "warn", n + " words", "Bernoff's ceiling for email is 250. Cut, unless the length is truly needed.");
      else add("wwb-length", "wwb", "pass", n + " words, under Bernoff's 250");
      const r = TellScan.scan(built.text, { wwb: true });
      const w = r.writing_without_bullshit || {};
      const parts = [];
      if (w.passive_candidates) parts.push(w.passive_candidates + " passive");
      if (w.weasel_words) parts.push(w.weasel_words + " weasel");
      if (w.intensifiers) parts.push(w.intensifiers + " intensifier");
      if (w.jargon) parts.push(w.jargon + " jargon");
      if (parts.length) add("wwb-edit", "wwb", "warn", "Edit: " + parts.join(", "), "Say who did what and swap vague amounts for numbers. The highlights show where.");
      else add("wwb-edit", "wwb", "pass", "No passive voice, weasel words or jargon");
      add("wwb-first", "wwb", "self", "Delete your first sentence after the greeting", "If nothing is lost, leave it out. Keep going until meaning drops.");
    }

    // Storytelling with Data.
    if (m.data) {
      if (point && !RX.digit.test(point)) add("data-big-idea", "data", "warn", "Put the key number in your Big Idea", "Your point of view and what's at stake, with the number that proves it. For example: The new plan saves us $34 a month.");
      else if (point) add("data-big-idea", "data", "pass", "Your Big Idea carries a number");
      const bare = bareNumbers(bodySentences);
      if (bare.length) add("data-compare", "data", "warn", "Give every number a comparison", "Against last month, the estimate, the goal or another option. $241 is a fact; $241, up from $96 in October, is a point.", bare);
      else if (bodySentences.some((s) => MONEY_OR_AMOUNT.test(s))) add("data-compare", "data", "pass", "Every number has a comparison");
      const precise = bodySentences.filter((s) => PRECISION.test(s));
      if (precise.length) add("data-round", "data", "info", "Round unless the exact figure is the point", "$241.16 reads better as $241.", precise.map((s) => s.match(PRECISION)[0]));
      const vague = Array.from(new Set((built.body.match(new RegExp(VAGUE_AMOUNT.source, "gi")) || []).map((v) => v.toLowerCase())));
      if (vague.length) add("data-vague", "data", "warn", "Swap the vague amount for the number", "Words like a lot and significant ask the reader to take it on trust. The numbers don't.", vague);
      if (!squash(st.close)) add("data-action", "data", "info", "End on the action", "What should they do with the numbers?");
    }

    // The desks' own passes: always on.
    const frame = frameParts(built);
    const found = polish(built.text, frame);
    const deskLine = (desk, id, title, ok) => {
      const list = found.filter((f) => f.desk === desk);
      if (list.length) add(id, "polish", "warn", title(list.length, list), list.map((f) => f.label).filter((v, i, a) => a.indexOf(v) === i).join(". ") + ".", list.map((f) => f.match.trim()).filter(Boolean), desk);
      else if (wordCount(built.body)) add(id, "polish", "pass", ok, "", [], desk);
    };
    deskLine("copy", "copy-pass", (n) => n === 1 ? "One copy fix left" : n + " copy fixes left", "No doubled words, restated lines or mismatched spellings");
    deskLine("line", "line-pass", (n) => n === 1 ? "One line to tighten" : n + " lines to tighten", "Clear, plain sentences");
    deskLine("copywriter", "copywriter-pass", (n) => n === 1 ? "One spot could land wrong" : n + " spots could land wrong", "An even tone, and an opening that says something");
    deskLine("facts", "facts-pass", (n) => n === 1 ? "A date doesn't check out" : n + " dates don't check out", "Every day matches its date");
    // The cover test (craft.md): could this be anyone's message to anyone?
    const bodyOnly = built.body;
    const detail = RX.digit.test(bodyOnly) || RX.date.test(bodyOnly) || /(?<=[a-z0-9,;:'’)] )[A-Z][a-z]+/.test(bodyOnly);
    if (wordCount(bodyOnly) > 12) {
      if (detail) add("cover-test", "polish", "pass", "Has a detail only this message has", "", [], "copywriter");
      else add("cover-test", "polish", "warn", "No detail only this message has", "Hide the names: could this be anyone's message? Add a name or a number so it couldn't be.", [], "copywriter");
    }

    // The tell audit: always last.
    const t = tellCount(built.text, m.wwb);
    if (t.strong + t.moderate) add("tells", "audit", "warn", (t.strong + t.moderate) + (t.strong + t.moderate === 1 ? " tell left" : " tells left"), "Fix the highlighted phrases. Go back to the specific thing each one stood in for.");
    else if (wordCount(built.body)) add("tells", "audit", "pass", "No strong or moderate tells");

    return out;
  }

  // ---------------------------------------------------------------------
  // Clarity and tone: repeats, plain words and the reader's ear
  // ---------------------------------------------------------------------
  //
  // From the craft standard (references/craft.md): the second pass reads the
  // first words of each sentence, cuts restatements, lets verbs work and
  // commits instead of hedging, and the voice keeps one exclamation point.
  // Repeating the right word is fine; ai-tells.md calls that clarity, so a
  // word used often is never flagged on its own. Only doubled words, the
  // same sentence or phrase twice, and the same opener again and again are.

  // Each plain swap: the pattern, what to suggest, and the word to put in.
  const verbForm = (base, past, ing) => (m) => (/ing$/i.test(m) ? ing : /ed$/i.test(m) ? past : /es$/i.test(m) ? base + "s" : base);
  const PLAIN_WORDS = [
    [/\butiliz(?:e|es|ed|ing)\b/gi, "use", verbForm("use", "used", "using")],
    [/\bcommenc(?:e|es|ed|ing)\b/gi, "start", verbForm("start", "started", "starting")],
    [/\bin order to\b/gi, "to", "to"], [/\bprior to\b/gi, "before", "before"], [/\bsubsequent to\b/gi, "after", "after"],
    [/\bat this point in time\b|\bat the present time\b/gi, "now", "now"], [/\bdue to the fact that\b/gi, "because", "because"],
    [/\bin the event that\b/gi, "if", "if"], [/\bwith regards? to\b|\bin regards? to\b/gi, "about", "about"],
    [/\bin the near future\b/gi, "soon", "soon"], [/\b(?:was|were) able to\b/gi, "could, or just the verb", "could"],
    [/\bfor the purpose of\b/gi, "for", "for"], [/\bin spite of the fact that\b/gi, "although", "although"],
    [/\bendeavou?r(?:s|ed)? to\b/gi, "try to", "try to"], [/\bfacilitat(?:e|es|ed|ing)\b/gi, "help", verbForm("help", "helped", "helping")],
    [/\bascertain\b/gi, "find out", "find out"], [/\bkindly\b/gi, "please", "please"], [/\bat a later date\b/gi, "later", "later"],
  ];
  const DOUBLE_NEGATIVE = /(?:\b(\w+)n't|\bnot|\bnever)\s+(uncommon|unlike|unusual|unreasonable|unhappy|unimportant|insignificant|impossible|without|nothing|none|nobody|no)\b|\b(can|could)n't hardly\b/gi;
  const POSITIVE = { uncommon: "common", unlike: "like", unusual: "usual", unreasonable: "reasonable", unhappy: "happy",
    unimportant: "important", insignificant: "significant", impossible: "possible" };

  // A fix is a list of find-and-replace pairs on the line (or on every line,
  // for a consistency fix), or a choice of such lists when the writer has to
  // decide (which spelling, the day or the date).
  const matchCase = (src, rep) => (/^[A-Z](?![A-Z])/.test(src) && rep ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep);
  const swap = (find, replace, scope) => ({ pairs: [{ find, replace }], scope: scope || "line" });
  const cut = (find) => swap(find, "");
  const ANNOUNCING = /^(?:quick question|just checking in|checking in|following up|just following up|a quick note|just a quick note|touching base|just touching base)\b/i;
  const HEDGES = /\b(?:i think|i guess|i feel like|maybe|perhaps|possibly|kind of|sort of|a little|a bit|somewhat|just|might)\b/gi;
  const HARSH = /\b(?:you need to|you must|immediately|asap|unacceptable|ridiculous|obviously|i shouldn'?t have to|for the last time|i demand)\b/gi;
  const SNIPPY = /\b(?:per my (?:last|previous) (?:email|message|note)|as (?:i |previously )?(?:already )?(?:said|stated|mentioned)|friendly reminder|not sure if you saw|as you know)\b/gi;
  const APOLOGY = /\b(?:sorry|apologi[sz]e|apologies)\b/gi;
  const ACRONYMS = new Set(["ASAP", "RSVP", "HVAC", "NASA", "IKEA", "USPS", "FAQ", "HOA", "PDF", "DMV", "PTA", "LLC", "ATM", "PIN", "FYI", "TBD", "ETA", "NYC", "USA", "COVID", "HTML", "JPEG", "WIFI", "OK"]);
  const KEEP_DOUBLE = new Set(["that", "had", "very", "really", "so", "no", "bye", "ha", "knock", "is"]);

  // `mask` is a list of [start, end] ranges (greeting, sign-off) to leave out.
  function polish(text, mask) {
    const src = String(text || "");
    let body = src;
    for (const [a, b] of mask || []) body = body.slice(0, a) + " ".repeat(Math.max(0, b - a)) + body.slice(b);
    const out = [];
    const add = (code, kind, label, detail, start, end, fix) => out.push({ code, kind, label, detail, match: src.slice(start, end), start, end, fix: fix || null });
    let m;

    // Repeats.
    const dbl = /\b([A-Za-z]+)\s+\1\b/gi;
    while ((m = dbl.exec(body))) {
      if (KEEP_DOUBLE.has(m[1].toLowerCase()) && m[1].toLowerCase() !== "is") continue;
      add("P1", "repeat", "Doubled word", "Delete the extra one.", m.index, m.index + m[0].length, swap(m[0], m[1]));
    }
    const punct = /([,;:?])\1+|(?<![.])\.\.(?![.])/g;
    while ((m = punct.exec(body))) add("P2", "repeat", "Doubled punctuation", "Keep one.", m.index, m.index + m[0].length, swap(m[0], m[0].charAt(0)));

    // Sentences, with where each one starts.
    const sents = [];
    const sre = /[^.!?\n]+(?:[.!?]+["'”’)]*|$)/g;
    while ((m = sre.exec(body))) {
      const t = m[0].trim();
      if (wordCount(t) < 1) continue;
      const lead = m[0].length - m[0].replace(/^\s+/, "").length;
      sents.push({ text: t, start: m.index + lead, end: m.index + lead + t.length, n: wordCount(t) });
      if (sre.lastIndex === m.index) sre.lastIndex += 1;
    }
    const restated = new Set();
    for (let i = 0; i < sents.length; i++) {
      for (let j = i + 1; j < sents.length; j++) {
        if (keyStems(sents[i].text).size >= 3 && keyStems(sents[j].text).size >= 3 && overlap(sents[i].text, sents[j].text) >= 0.85) {
          add("P3", "repeat", "Says the same thing twice", "Keep the stronger sentence and cut the other.", sents[j].start, sents[j].end, cut(sents[j].text));
          restated.add(i); restated.add(j);
        }
      }
    }
    // The same four words twice, with real words in them (not "I would like to").
    const toks = [];
    const wre = /[A-Za-z0-9'’$]+/g;
    while ((m = wre.exec(body))) toks.push({ w: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length });
    const seenGram = new Map();
    const flaggedGram = new Set();
    let lastPhrase = null;
    for (let i = 0; i + 4 <= toks.length; i++) {
      const gram = toks.slice(i, i + 4);
      if (gram.filter((t) => !STOP.has(t.w) && t.w.length > 2 && !/^\d/.test(t.w)).length < 2) continue;
      const key = gram.map((t) => t.w).join(" ");
      if (!seenGram.has(key)) { seenGram.set(key, i); continue; }
      if (i - seenGram.get(key) < 4 || flaggedGram.has(key)) continue;
      const inRestated = sents.some((s, k) => restated.has(k) && gram[0].start >= s.start && gram[3].end <= s.end);
      if (inRestated) continue;
      flaggedGram.add(key);
      if (lastPhrase && gram[0].start <= lastPhrase.end) {
        // The same repeat, one word longer: grow it instead of flagging again.
        lastPhrase.end = gram[3].end;
        lastPhrase.match = src.slice(lastPhrase.start, lastPhrase.end);
        continue;
      }
      const lead = gram.find((t) => !STOP.has(t.w)) || gram[0];
      add("P4", "repeat", "Repeated phrase", "If it's a restatement, say it once. Repeating the same word for the same thing is fine.", lead.start, gram[3].end);
      lastPhrase = out[out.length - 1];
    }
    // Openers: the craft standard's "read only the first words of each sentence".
    if (sents.length >= 3) {
      const firsts = new Map();
      sents.forEach((s) => {
        const w = (s.text.match(/^[^A-Za-z]*([A-Za-z']+)/) || [])[1];
        if (!w) return;
        const k = w.toLowerCase();
        if (!firsts.has(k)) firsts.set(k, []);
        firsts.get(k).push(s);
      });
      for (const [w, list] of firsts) {
        if (list.length >= 3 && list.length / sents.length >= 0.4) {
          const third = list[2];
          const word = third.text.match(/^[^A-Za-z]*([A-Za-z']+)/)[1];
          add("P5", "repeat", list.length + " sentences start with “" + (w === "i" ? "I" : word) + "”", "Start one with the person or the thing instead.", third.start, third.start + third.text.indexOf(word) + word.length);
        }
      }
    }

    // Clarity.
    for (const s of sents) {
      if (s.n > 30) {
        const parts = splitClauses(s.text);
        add("P6", "clarity", "Long sentence (" + s.n + " words)", "Split it where the second idea starts.", s.start, Math.min(s.end, s.start + 60),
          parts.length > 1 ? Object.assign(swap(s.text, parts.join(" ")), { say: "Split it into " + parts.length + " sentences" }) : null);
      }
    }
    for (const [re, plain, to] of PLAIN_WORDS) {
      re.lastIndex = 0;
      while ((m = re.exec(body))) {
        const word = typeof to === "function" ? to(m[0]) : to;
        add("P7", "clarity", "Wordy phrase", "Use the plain word: " + plain + ".", m.index, m.index + m[0].length, swap(m[0], matchCase(m[0], word)));
      }
    }
    DOUBLE_NEGATIVE.lastIndex = 0;
    while ((m = DOUBLE_NEGATIVE.exec(body))) {
      let fix = null;
      if (m[3]) fix = swap(m[0], m[3] + " hardly");
      else if (POSITIVE[m[2].toLowerCase()]) fix = swap(m[0], matchCase(m[0], (m[1] ? m[1] + " " : "") + POSITIVE[m[2].toLowerCase()]));
      add("P8", "clarity", "Double negative", "Say it positively. Not “not uncommon” but “common”.", m.index, m.index + m[0].length, fix);
    }
    if (sents.length && ANNOUNCING.test(sents[0].text)) {
      const opener = sents[0].text.match(new RegExp(ANNOUNCING.source + "[\\s:,.!?]*", "i"))[0];
      add("P9", "clarity", "The first line announces instead of saying", "Lead with the question or the news itself.", sents[0].start, sents[0].start + sents[0].text.match(ANNOUNCING)[0].length,
        opener.trim().length < sents[0].text.trim().length ? cut(opener) : null);
    }
    const capitalized = /[.!?]\s+[A-Z]/.test(body) || /^[^a-z]*[A-Z]/.test(body.trim());
    const lowerI = /(?<![\w'’])i(?=\s|['’](?:m|ll|ve|d)\b)/g;
    if (capitalized) {
      while ((m = lowerI.exec(body))) {
        const ctx = body.slice(m.index, m.index + 4).match(/^i(?:['’](?:m|ll|ve|d))?\b/)[0];
        // Only a standalone "i" (or "i'm"), never the start of "it" or "is".
        add("P10", "clarity", "Lowercase “i”", "Capitalize it.", m.index, m.index + 1,
          Object.assign(swap(new RegExp("(^|\\s)i(?=['’]|\\s|$)", "g"), "$1I"), { say: "Capitalize “" + ctx + "”" }));
      }
    }

    // Tone.
    const caps = /\b[A-Z]{4,}\b/g;
    while ((m = caps.exec(body))) {
      if (ACRONYMS.has(m[0])) continue;
      const startsSentence = /(?:^|[.!?]\s+)$/.test(body.slice(0, m.index).replace(/\s+$/, " ").slice(-3)) || m.index === body.search(/\S/);
      const lower = m[0].toLowerCase();
      add("T1", "tone", "All caps reads as shouting", "Use normal case. A date or a number makes the point better.", m.index, m.index + m[0].length,
        swap(m[0], startsSentence ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower));
    }
    const bangs = /!{2,}|\?!|!\?/g;
    while ((m = bangs.exec(body))) add("T1", "tone", "Stacked punctuation reads as shouting", "One mark is enough.", m.index, m.index + m[0].length, swap(m[0], m[0].includes("?") ? "?" : "!"));
    const excl = [];
    const ere = /!+/g;
    while ((m = ere.exec(body))) excl.push(m.index);
    if (excl.length >= 2) {
      // Keep the last one, usually the warm one ("Thanks!"); the others become periods.
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pairs = excl.slice(0, -1).map((at) => {
        const prefix = body.slice(Math.max(0, at - 16), at).replace(/^\S*\s/, "");
        return { find: new RegExp(esc(prefix) + "!+"), replace: prefix + "." };
      });
      add("T2", "tone", "More than one exclamation point", "One is plenty. Let the words carry the energy.", excl[0], excl[0] + 1,
        { pairs, scope: "all", say: "Keep the last exclamation point and turn the others into periods" });
    }
    const sorry = [];
    APOLOGY.lastIndex = 0;
    while ((m = APOLOGY.exec(body))) sorry.push(m);
    if (sorry.length >= 2) add("T3", "tone", "Apologizes more than it needs to", "Once is enough, and none if it isn't your fault.", sorry[1].index, sorry[1].index + sorry[1][0].length);
    const hedges = [];
    HEDGES.lastIndex = 0;
    while ((m = HEDGES.exec(body))) hedges.push(m);
    if (hedges.length >= 3) {
      // Filler hedges go; the ones that report real doubt ("I think", "might") stay.
      const KEEP = /^(?:i think|might|possibly)$/i;
      for (const h of hedges) {
        add("T4", "tone", "Hedges pile up", "Commit. Keep a hedge that reports real doubt and cut the rest.", h.index, h.index + h[0].length,
          KEEP.test(h[0]) ? null : cut(h[0]));
      }
    }
    const SOFTER = { asap: "soon", immediately: "soon", "you need to": "please", "you must": "please", obviously: "", "for the last time": "" };
    HARSH.lastIndex = 0;
    while ((m = HARSH.exec(body))) {
      const soft = SOFTER[m[0].toLowerCase()];
      add("T5", "tone", "Could read as harsh", "Say what you need and by when, without the edge.", m.index, m.index + m[0].length,
        soft === undefined ? null : soft ? swap(m[0], matchCase(m[0], soft)) : cut(m[0]));
    }
    SNIPPY.lastIndex = 0;
    while ((m = SNIPPY.exec(body))) {
      const tail = body.slice(m.index + m[0].length).match(/^[,:;]?\s*/)[0];
      add("T6", "tone", "Could read as passive-aggressive", "Restate the ask plainly, as if for the first time.", m.index, m.index + m[0].length,
        /not sure if you saw/i.test(m[0]) ? null : cut(m[0] + tail));
    }

    out.push(...consistency(body), ...factCheck(body, polish.today));
    out.sort((a, b) => a.start - b.start);
    out.forEach((f) => { f.desk = POLISH_DESK[f.code] || "copy"; });
    return out;
  }

  // The fact-checker: a weekday next to a date has to be that date's weekday.
  // Without a year, the date is read as the nearest one: this year's, unless
  // that was more than six months ago.
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const DAY_RX = "(sun|mon|tues|wednes|thurs|fri|satur)day";
  const MONTH_RX = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";

  function weekdayOf(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // not a real date
    return dt.getUTCDay();
  }
  function resolveYear(m, d, today) {
    const y = today.getFullYear();
    const thisYear = Date.UTC(y, m - 1, d);
    const now = Date.UTC(y, today.getMonth(), today.getDate());
    return thisYear < now - 183 * 864e5 ? y + 1 : y;
  }

  function factCheck(text, today) {
    const src = String(text || "");
    today = today || new Date();
    const out = [];
    const forms = [
      [new RegExp("\\b" + DAY_RX + ",?\\s+(?:the\\s+)?(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\b", "gi"), (m) => [m[1], +m[2], +m[3], m[4]]],
      [new RegExp("\\b" + DAY_RX + ",?\\s+" + MONTH_RX + "\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b", "gi"), (m) => [m[1], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[3], m[4]]],
      [new RegExp("\\b(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\s*\\(\\s*" + DAY_RX + "\\s*\\)", "gi"), (m) => [m[4], +m[1], +m[2], m[3]]],
    ];
    for (const [re, read] of forms) {
      let m;
      while ((m = re.exec(src))) {
        const [dayWord, month, day, yearText] = read(m);
        if (!month || !day) continue;
        let year = yearText ? +yearText : resolveYear(month, day, today);
        if (year < 100) year += 2000;
        const wd = weekdayOf(year, month, day);
        if (wd === null) {
          out.push({ code: "F1", kind: "facts", label: "That date doesn't exist", detail: "Check the month and the day.", match: m[0], start: m.index, end: m.index + m[0].length });
          continue;
        }
        const said = DAYS.findIndex((x) => x.startsWith(dayWord.toLowerCase()));
        if (said !== wd) {
          const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
          const actual = cap(DAYS[wd]);
          const dayText = m[0].match(new RegExp(DAY_RX, "i"))[0];
          // Or keep the day and move the date to the nearest one that falls on it.
          const ahead = (said - wd + 7) % 7;
          const shift = ahead <= 3 ? ahead : ahead - 7;
          const moved = new Date(Date.UTC(year, month - 1, day + shift));
          const nm = moved.getUTCMonth() + 1;
          const nd = moved.getUTCDate();
          let newDate;
          if (/^\d/.test(m[0]) || /\d{1,2}\/\d{1,2}/.test(m[0])) {
            newDate = m[0].replace(/(\d{1,2})\/(\d{1,2})/, nm + "/" + nd);
          } else {
            const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            newDate = m[0].replace(new RegExp(MONTH_RX + "\\s+\\d{1,2}(st|nd|rd|th)?", "i"), names[nm - 1] + " " + nd);
          }
          out.push({ code: "F1", kind: "facts", label: "The day doesn't match the date",
            detail: "In " + year + ", " + month + "/" + day + " falls on a " + actual + ". Check which one you meant.",
            match: m[0], start: m.index, end: m.index + m[0].length,
            fix: { choices: [
              { label: "Make it " + actual, pairs: [{ find: m[0], replace: m[0].replace(dayText, matchCase(dayText, DAYS[wd])) }], scope: "all" },
              { label: "Keep " + cap(DAYS[said]) + ", move the date to " + nm + "/" + nd, pairs: [{ find: m[0], replace: newDate }], scope: "all" },
            ] } });
        }
      }
    }
    return out;
  }

  // The copy editor's consistency pass: one spelling, one style.
  const COMMON_CAPS = new Set(["The", "This", "That", "These", "Those", "There", "Thanks", "Thank", "Hope", "Hi", "Hey", "Hello", "Dear", "Best",
    "Well", "Will", "Can", "Could", "Would", "What", "When", "Where", "Who", "Why", "How", "Our", "Your", "Their", "Also", "And", "But", "So",
    "Please", "Just", "Let", "Here", "Sorry", "Yes", "Not", "Now", "Then", "Love", "Cheers"]);
  function editDistance1(a, b) {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, diffs = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diffs > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return diffs + (a.length - i) + (b.length - j) === 1;
  }

  function consistency(text) {
    const src = String(text || "");
    const out = [];
    const names = namesIn(src);
    const caps = new Map();
    let m;
    const cre = /\b[A-Z][a-z]{2,}\b/g;
    while ((m = cre.exec(src))) {
      const w = m[0];
      if (COMMON_CAPS.has(w) || DAYS.includes(w.toLowerCase()) || MONTHS.some((x) => w.toLowerCase().startsWith(x))) continue;
      if (!caps.has(w)) caps.set(w, m.index);
    }
    const list = Array.from(caps.keys());
    const done = new Set();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a[0] !== b[0] || Math.min(a.length, b.length) < 4 || !editDistance1(a, b)) continue;
        // A name is capitalized mid-sentence, or never appears in lowercase at all.
        const nameLike = (w) => names.has(w) || !new RegExp("\\b" + w.toLowerCase() + "\\b").test(src);
        if (!nameLike(a) || !nameLike(b)) continue;
        // In one sentence ("Dana and Dena"), they're two people, not a typo.
        const together = src.split(/[.!?\n]+/).some((sentence) => new RegExp("\\b" + a + "\\b").test(sentence) && new RegExp("\\b" + b + "\\b").test(sentence));
        if (together) continue;
        const key = [a, b].sort().join("/");
        if (done.has(key)) continue;
        done.add(key);
        const at = caps.get(b);
        const wordRe = (w) => new RegExp("\\b" + w + "\\b", "g");
        out.push({ code: "K1", kind: "repeat", label: "A name spelled two ways", detail: a + " and " + b + ". Pick one.", match: b, start: at, end: at + b.length,
          fix: { choices: [
            { label: "Use " + a, pairs: [{ find: wordRe(b), replace: a }], scope: "all" },
            { label: "Use " + b, pairs: [{ find: wordRe(a), replace: b }], scope: "all" },
          ] } });
      }
    }
    const styles = (patterns, code, label, restyle) => {
      const found = [];
      patterns.forEach((re, k) => { re.lastIndex = 0; let x; while ((x = re.exec(src))) found.push({ k, x }); });
      found.sort((p, q) => p.x.index - q.x.index);
      const kinds = new Set(found.map((f) => f.k));
      if (kinds.size > 1) {
        const second = found.find((f) => f.k !== found[0].k);
        // Match everything to the style used first.
        const pairs = restyle ? found.map((f) => {
          let replace = restyle(f.x[0], found[0].x[0]);
          // "8 p.m. I think" -> "8pm. I think": the period also ended the sentence.
          const after = src.slice(f.x.index + f.x[0].length);
          if (replace && /\.$/.test(f.x[0]) && !/\.$/.test(replace) && /^(?:\s+[A-Z]|\s*$)/.test(after)) replace += ".";
          return { find: f.x[0], replace };
        }).filter((pr) => pr.replace && pr.replace !== pr.find) : [];
        out.push({ code, kind: "repeat", label, detail: "Pick one style and use it throughout.", match: second.x[0], start: second.x.index, end: second.x.index + second.x[0].length,
          fix: pairs.length ? { pairs, scope: "all" } : null });
      }
    };
    const timeLike = (t, model) => {
      const m1 = /^(\d{1,2})(?::(\d{2}))?\s?(a\.?m\.?|p\.?m\.?)$/i.exec(t);
      const m2 = /^\d{1,2}(?::\d{2})?(\s?)(a\.m\.|p\.m\.|am|pm|AM|PM)$/.exec(model);
      if (!m1 || !m2) return null;
      const half = m1[3].toLowerCase().startsWith("a") ? "a" : "p";
      const suffix = m2[2] === "a.m." || m2[2] === "p.m." ? half + ".m." : /[AP]M/.test(m2[2]) ? half.toUpperCase() + "M" : half + "m";
      return m1[1] + (m1[2] ? ":" + m1[2] : "") + m2[1] + suffix;
    };
    // Amounts always take the standard style, with commas.
    const amountLike = (t) => t.replace(/\B(?=(\d{3})+(?!\d))/g, (x, y, i) => (/\./.test(t.slice(0, i)) ? "" : ","));
    styles([/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/g, /\b\d{1,2}(?::\d{2})?\s?(?:a\.m\.|p\.m\.)/g, /\b\d{1,2}(?::\d{2})?\s?(?:AM|PM)\b/g], "K2", "Times written two ways", timeLike);
    styles([/\$\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, /\$\d{4,}(?:\.\d+)?\b/g], "K3", "Amounts written two ways", amountLike);
    styles([/\b\d{1,2}\/\d{1,2}\b/g, new RegExp("\\b" + MONTH_RX + "\\s+\\d{1,2}(?:st|nd|rd|th)?\\b", "gi")], "K4", "Dates written two ways");
    // Dates: let the writer pick the style, then match every date to it.
    const k4 = out.find((f) => f.code === "K4");
    if (k4) {
      const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const slash = /\b(\d{1,2})\/(\d{1,2})\b/g;
      const named = new RegExp("\\b" + MONTH_RX + "\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b", "gi");
      const monthOf = (mo) => MONTHS.findIndex((name) => name.slice(0, 3).toLowerCase() === mo.slice(0, 3).toLowerCase());
      const toNamed = (x, mo, d) => (MONTHS[+mo - 1] ? MONTHS[+mo - 1] + " " + +d : x);
      const toSlash = (x, mo, d) => (monthOf(mo) >= 0 ? monthOf(mo) + 1 + "/" + +d : x);
      const fullName = (x, mo, d) => (monthOf(mo) >= 0 ? MONTHS[monthOf(mo)] + " " + +d : x);
      const first = (re) => { re.lastIndex = 0; const x = re.exec(src); re.lastIndex = 0; return x; };
      const a = first(slash);
      const b = first(named);
      if (a && b) {
        k4.fix = { choices: [
          { label: "Use " + toNamed(a[0], a[1], a[2]) + " style", pairs: [{ find: slash, replace: toNamed }, { find: named, replace: fullName }], scope: "all" },
          { label: "Use " + toSlash(b[0], b[1], b[2]) + " style", pairs: [{ find: named, replace: toSlash }], scope: "all" },
        ] };
      }
    }
    return out;
  }

  // The parts of a draft or a final message that are the writer's own frame.
  function frameMask(text) {
    const src = String(text || "");
    const p = parseDraft(src);
    const mask = [];
    const sub = /^\s*subject:.*$/im.exec(src);
    if (sub && sub.index < 3) mask.push([sub.index, sub.index + sub[0].length]);
    if (p.greeting) { const at = src.indexOf(p.greeting); if (at >= 0) mask.push([at, at + p.greeting.length]); }
    if (p.signoff) { const at = src.lastIndexOf(p.signoff); if (at >= 0) mask.push([at, at + p.signoff.length]); }
    return mask;
  }

  function polishText(text) {
    return polish(text, frameMask(text));
  }

  function polishSummary(found) {
    const by = { repeat: [], clarity: [], tone: [], facts: [] };
    found.forEach((f) => by[f.kind].push(f));
    return by;
  }

  // ---------------------------------------------------------------------
  // Step 2: what's wrong with the draft as written
  // ---------------------------------------------------------------------

  function diagnose(text, parsed, methods) {
    methods = methods || emptyState().methods;
    const flags = [];
    if (!parsed || !parsed.pieces.length) return { flags, pointId: null };
    const { piece, score } = pickPoint(parsed, methods);
    let point = piece && score > -Infinity ? piece : null;
    // With MECE, a list item isn't the point; the visitor writes one.
    if (methods.mece && point && listItems(point.text).length > 1) point = null;
    if (point && point.sentence > 1) {
      flags.push({ id: "buried", kind: "fix", title: "Your point is in sentence " + point.sentence + " of " + parsed.sentences,
        detail: "Readers decide how closely to read from the first line, so the rewrite moves it to the top.", pieces: [point.id] });
    } else if (methods.mece && !point) {
      flags.push({ id: "no-point", kind: "fix", title: "Nothing says what the list is for",
        detail: "You'll write that one line in the next step.", pieces: [] });
    } else if ((!point || score < 1) && parsed.pieces.filter((p) => !p.flags.filler).length > 1) {
      flags.push({ id: "no-point", kind: "fix", title: "There's no clear ask or news yet",
        detail: "You'll write the one sentence this message is for in the next step.", pieces: [] });
    }
    const filler = parsed.pieces.filter((p) => p.flags.filler);
    if (filler.length) {
      flags.push({ id: "filler", kind: "fix", title: filler.length === 1 ? "One line is filler" : filler.length + " lines are filler",
        detail: "Stock openers and moods tell the reader nothing they need. The rewrite leaves them out.", pieces: filler.map((p) => p.id) });
    }
    if (point && score >= 1 && RX.vague.test(point.text) && !(RX.digit.test(point.text) || RX.date.test(point.text))) {
      flags.push({ id: "vague", kind: "fix", title: "Your point leans on a vague word",
        detail: "The fix step asks you to name the thing and the date.", pieces: [point.id], quotes: [point.text.match(RX.vague)[0]] });
    }
    if (methods.scqa && !parsed.pieces.some((p) => !p.flags.filler && p.flags.complication)) {
      flags.push({ id: "no-change", kind: "fix", title: "It doesn't say what changed",
        detail: "SCQA opens with what the reader knows and what changed, so your decision makes sense.", pieces: [] });
    }
    if (methods.mece) {
      const items = parsed.pieces.filter((p) => !p.flags.filler).flatMap((p) => listItems(p.text));
      if (items.length >= 3) flags.push({ id: "list", kind: "fix", title: items.length + " items in one stretch of text", detail: "The rewrite sorts them into groups you can name.", pieces: [] });
      for (let i = 0; i < items.length; i++) {
        const j = items.findIndex((t, k) => k > i && overlap(items[i], t) >= 0.6);
        if (j > i) { flags.push({ id: "repeat", kind: "fix", title: "Two items say the same thing", detail: "You'll keep one of them.", pieces: [], quotes: [items[i], items[j]] }); break; }
      }
    }
    const money = String(text || "").match(new RegExp(VAGUE_AMOUNT.source, "gi"));
    if (money && (methods.data || MONEY_TALK.test(text))) {
      flags.push({ id: "vague-amount", kind: "fix", title: "It talks about money without the numbers", detail: "Storytelling with Data asks for the figure, next to what it compares with.", pieces: [], quotes: Array.from(new Set(money.map((x) => x.toLowerCase()))) });
    }
    const hits = TellScan.scan(String(text || ""), { wwb: methods.wwb }).findings.filter((f) => f.severity !== "weak" && f.code !== "W5");
    if (hits.length) {
      const quotes = Array.from(new Set(hits.map((f) => (f.match || "").trim()).filter(Boolean))).slice(0, 4);
      flags.push({ id: "tells", kind: "fix", title: hits.length === 1 ? "One phrase reads as padded or machine-made" : hits.length + " phrases read as padded or machine-made",
        detail: "The rewrite trims the stock ones and flags the rest for you.", pieces: [], quotes });
    }
    const n = wordCount(text);
    if (n > 250) flags.push({ id: "long", kind: "fix", title: "It runs " + n + " words", detail: "Most personal email works best well under 250.", pieces: [] });
    const found = polishText(text);
    const sample = (list) => Array.from(new Set(list.map((f) => f.match.trim()).filter(Boolean))).slice(0, 4);
    const labels = (list) => list.map((f) => f.label.replace(/ \(\d+ words\)/, "")).filter((v, i, a) => a.indexOf(v) === i).join(". ") + ".";
    const deskFlag = (desk, id, title) => {
      const list = found.filter((f) => f.desk === desk);
      if (list.length) flags.push({ id, kind: "fix", desk, title: title(list.length), detail: labels(list), pieces: [], quotes: sample(list) });
    };
    deskFlag("facts", "facts", (n) => n === 1 ? "A date doesn't check out" : n + " dates don't check out");
    deskFlag("copy", "copy", (n) => n === 1 ? "One copy fix" : n + " copy fixes");
    deskFlag("line", "line", (n) => n === 1 ? "One line to tighten" : n + " lines to tighten");
    deskFlag("copywriter", "copywriter", (n) => n === 1 ? "One spot could land wrong" : n + " spots could land wrong");
    const DIAG_DESK = { buried: "structure", "no-point": "structure", vague: "structure", list: "structure", repeat: "structure", "no-change": "structure", "vague-amount": "structure", long: "structure", filler: "line", tells: "tells" };
    flags.forEach((f) => { if (!f.desk) f.desk = DIAG_DESK[f.id] || "structure"; });
    if (!flags.length) flags.push({ id: "clean", kind: "good", desk: "structure", title: "This draft already leads with its point", detail: "The rewrite tidies the structure, and the checks confirm it.", pieces: [] });
    if (parsed.greeting || parsed.signoff) {
      const what = parsed.greeting && parsed.signoff ? "Your greeting and sign-off stay" : parsed.greeting ? "Your greeting stays" : "Your sign-off stays";
      flags.push({ id: "voice", kind: "good", desk: "copywriter", title: what + " as you wrote " + (parsed.greeting && parsed.signoff ? "them" : "it"), detail: "That's your voice, so the rewrite keeps it.", pieces: [] });
    }
    return { flags, pointId: point ? point.id : null };
  }

  // ---------------------------------------------------------------------
  // Step 3: one card per line that needs a fix
  // ---------------------------------------------------------------------

  const CARD_FOR_CHECK = {
    "minto-point": "point", "minto-one": "point", "minto-specific": "point", "minto-length": "point",
    "inv-lede": "point", "inv-when": "point", "inv-buildup": "point", "data-big-idea": "point",
    "scqa-situation": "situation", "scqa-complication": "complication", "scqa-length": "point",
    "minto-close": "close", "wwb-subject": "subject", "cover-test": "point",
    "mece-rule": "groups", "mece-count": "groups", "mece-labels": "groups", "mece-overlap": "groups",
  };
  const FIELD_ORDER = ["point", "situation", "complication", "groups", "group-items", "group-label", "support", "background", "close", "subject", "general"];

  function tasks(st, parsed) {
    const built = assemble(st);
    const cards = new Map();
    const card = (field, index) => {
      const f = field === "group-label" ? "group-items" : field;
      const key = f === "groups" ? "groups" : f + (f === "support" || f === "group-items" ? ":" + (index || 0) : "");
      if (!cards.has(key)) cards.set(key, { key, field: f, index: index || 0, issues: [] });
      return cards.get(key);
    };
    const checks = check(st, parsed).filter((c) => c.status === "warn");
    for (const c of checks) {
      const field = CARD_FOR_CHECK[c.id];
      if (field) card(field, 0).issues.push({ code: c.id, title: c.title, detail: c.detail, quotes: c.quotes, method: c.method, desk: c.desk });
    }
    // Phrase-level problems: trace each one to the line that holds it.
    const locate = (offset) => partAt(built, offset);
    const put = (part, issue) => {
      if (!part || part.field === "greeting" || part.field === "signoff") return;
      if (part.field === "subject" && !st.isEmail) return;
      const c = card(part.field, part.index);
      const same = c.issues.find((x) => x.title === issue.title && x.desk === issue.desk);
      if (same) {
        (issue.quotes || []).forEach((q) => { if (!same.quotes.includes(q)) same.quotes.push(q); });
        if (issue.fix && issue.fix.pairs) {
          if (same.fix && same.fix.pairs) same.fix = { pairs: same.fix.pairs.concat(issue.fix.pairs), scope: same.fix.scope };
          else if (!same.fix) same.fix = issue.fix;
        }
      } else c.issues.push(Object.assign({}, issue, { quotes: (issue.quotes || []).slice() }));
    };
    const scanned = TellScan.scan(built.text, { wwb: st.methods.wwb });
    for (const f of scanned.findings) {
      if (f.severity === "weak") continue;
      const issue = { code: f.code, title: f.label, detail: plainFix(f), quotes: f.match ? [f.match.trim()] : [], method: f.family === "WWB" ? "wwb" : "audit", desk: f.family === "WWB" ? "line" : "tells", fix: scannerFix(f) };
      if (typeof f.start === "number") put(locate(f.start), issue);
      else if (f.spans && f.spans.length) put(locate(f.spans[0].start), issue);
      else if (f.code !== "W5") card("general", 0).issues.push(Object.assign(issue, { desk: "line" }));
    }
    for (const f of polish(built.text, frameParts(built))) {
      put(locate(f.start), { code: f.code, title: f.label, detail: f.detail, quotes: f.match.trim() ? [f.match.trim()] : [], method: "polish", desk: f.desk, fix: f.fix || null });
    }
    if (st.methods.data) {
      const vague = new RegExp(VAGUE_AMOUNT.source, "gi");
      let m;
      while ((m = vague.exec(built.text))) {
        put(locate(m.index), { code: "data-vague-amount", title: "Vague amount", detail: "Swap it for the number, with a comparison.", quotes: [m[0]], method: "data", desk: "structure" });
      }
      for (const s of bareNumbers(sentencesOf(built.body))) {
        const at = built.text.indexOf(s);
        if (at >= 0) put(locate(at), { code: "data-bare", title: "A number with nothing to compare it to", detail: "Add what it's up or down from, or what it's worth in real terms.", quotes: [s.match(MONEY_OR_AMOUNT)[0]], method: "data", desk: "structure" });
      }
    }
    const list = Array.from(cards.values()).filter((c) => c.issues.length);
    for (const c of list) {
      c.issues.forEach((i) => { if (!i.desk) i.desk = "structure"; });
      c.desk = c.issues[0].desk;
    }
    list.sort((a, b) => (FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field)) || (a.index - b.index));
    for (const c of list) {
      c.value = fieldValue(st, c.field, c.index);
      c.issues.forEach((i) => { if (!i.fix || !i.fix.pairs) i.suggestions = recommendEdits(i, c, st, parsed); });
    }
    return list;
  }

  function fieldValue(st, field, index) {
    if (field === "support") return st.support[index] || "";
    if (field === "group-items") return (st.groups[index] || {}).items || "";
    if (field === "groups" || field === "general") return "";
    return st[field] || "";
  }

  function setField(st, field, index, value) {
    if (field === "support") st.support[index] = value;
    else if (field === "group-items") st.groups[index].items = value;
    else if (field !== "groups" && field !== "general") st[field] = value;
    return st;
  }

  // ---------------------------------------------------------------------
  // Recommended edits for the notes that need the writer's words
  // ---------------------------------------------------------------------
  //
  // Each recommendation is built from the writer's own draft and the method
  // guides' own examples. Where a fact only the writer knows is missing (a
  // number, a date), the recommendation leaves a blank, ___, to fill in.
  // Kinds: line (a new text for the card's line), split (point and the rest),
  // rule, regroup, labels, keep-item (MECE).

  const BLANK = "___";
  const IRREGULAR = { done: "do", made: "make", sent: "send", paid: "pay", given: "give", taken: "take", seen: "see", told: "tell",
    found: "find", left: "leave", kept: "keep", held: "hold", brought: "bring", bought: "buy", known: "know", shown: "show",
    written: "write", broken: "break", chosen: "choose", driven: "drive", hidden: "hide", stolen: "steal", spoken: "speak",
    sold: "sell", lost: "lose", won: "win", built: "build" };

  // "charged" -> "charge", "looked" -> "look", "stopped" -> "stop", "carried" -> "carry".
  function lemma(word) {
    const w = word.toLowerCase();
    if (IRREGULAR[w]) return IRREGULAR[w];
    if (!/ed$/.test(w)) return w;
    if (/ied$/.test(w)) return w.slice(0, -3) + "y";
    if (/([bdgklmnprt])\1ed$/.test(w)) return w.slice(0, -3);
    const stem = w.slice(0, -2);
    if (/[cgvz]$|[^aeiou]l$|(?:^|[^aeiou])[aeiou]s$|u$/.test(stem)) return stem + "e";
    return stem;
  }

  const THING_SKIP = new Set(["end", "way", "time", "week", "weekend", "month", "year", "day", "lot", "bit", "moment", "meantime",
    "past", "future", "one", "other", "same", "rest", "first", "last", "next", "most", "best", "thing", "things"]);

  // The thing the message is about, in the writer's words: "the deck", "the invoice".
  function salientThing(parsed, avoid) {
    const counts = new Map();
    const src = (parsed ? parsed.pieces : []).map((x) => x.text).join(" ");
    const re = /\b(the|our|my|your)\s+([a-z][a-z-]{2,})\b/gi;
    let m;
    while ((m = re.exec(src))) {
      const noun = m[2].toLowerCase();
      if (THING_SKIP.has(noun) || STOP.has(noun) || /ing$/.test(noun)) continue;
      const phrase = m[1].toLowerCase() + " " + noun;
      if (avoid && new RegExp("\\b" + noun + "\\b", "i").test(avoid)) continue;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
    let best = null;
    for (const [k, v] of counts) if (!best || v > counts.get(best)) best = k;
    return best;
  }

  // A capitalized topic in the point ("Thanksgiving"), or the salient thing.
  function topicOf(text, parsed) {
    const m = String(text || "").match(/(?<=[a-z0-9,;:'’)] )[A-Z][a-z]+/);
    if (m) return m[0];
    const t = salientThing(parsed);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
  }

  function datesIn(text) {
    const re = new RegExp("(?:\\bthe\\s+)?(?:" + RX.date.source + ")", "gi");
    return Array.from(new Set((String(text || "").match(re) || []).map((d) => d.trim())));
  }

  // Inserts text just before the line's closing punctuation.
  function beforeEnd(line, add) {
    const m = /([.?!]+["'”’)]*)\s*$/.exec(line);
    return m ? line.slice(0, m.index) + add + m[1] : line + add;
  }

  const reEsc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const VAGUE_TIME = /\b(?:sometime soon|soon|at some point|shortly|in the near future|at your earliest convenience|when you get a chance|whenever you can)\b/i;

  // Splits a long line where the second idea starts, nearest the middle.
  function looseSplit(text) {
    const t = String(text || "").trim();
    const parts = splitClauses(t);
    if (parts.length > 1) return parts;
    const re = /,\s+(?:and\s+|but\s+|so\s+)?(?:also\s+|then\s+)?(?=(?:we|i|you|they|he|she|it|my|our|the|this|that|there)\b)/gi;
    let best = null;
    let m;
    while ((m = re.exec(t))) {
      const left = t.slice(0, m.index);
      const right = t.slice(m.index + m[0].length);
      if (wordCount(left) < 5 || wordCount(right) < 4) continue;
      const d = Math.abs(wordCount(left) - wordCount(right));
      if (!best || d < best.d) best = { d, left, right };
    }
    return best ? [finish(best.left), sentenceCase(best.right)] : [t];
  }

  // Passive to active, for the two shapes personal writing uses most.
  function activeVoice(line) {
    const a = /\b(?:I would (?:really )?appreciate it if|I'?d appreciate it if|could|can|would)\s+(this|it|that|the [a-z]+(?: (?!could|can|would|may|might|has|have|was|were|is|are)[a-z]+)?)\s+(?:could |can |would )?(?:possibly )?be\s+(\w+)(\s+(?:into|at|over|after))?\b([^.?!]*)[.?!]?/i.exec(line);
    if (a && /ed$|^(?:done|made|sent|paid|fixed)$/i.test(a[2])) {
      const ask = "Could you " + lemma(a[2]) + (a[3] || "") + " " + a[1].toLowerCase() + (a[4] || "") + "?";
      return (line.slice(0, a.index) + ask + line.slice(a.index + a[0].length)).replace(/^\s+/, "").replace(/^[a-z]/, (c) => c.toUpperCase());
    }
    const b = /\b(the|my|our|your)\s+([a-z]+(?: (?!may|might|has|have|was|were)[a-z]+)?)\s+(may have been|might have been|has not been|hasn't been|have not been|haven't been|has been|have been|was not|wasn't|were not|weren't|was|were)\s+(\w+)\b/i.exec(line);
    if (b && /ed$|^(?:done|made|sent|paid|returned|charged)$/i.test(b[4])) {
      const aux = b[3].toLowerCase();
      const v = b[4].toLowerCase();
      const obj = b[1].toLowerCase() + " " + b[2];
      const active = /^(may|might) have been$/.test(aux) ? "you " + aux.split(" ")[0] + " have " + v + " " + obj
        : /^(has|have)( not|n't) been$|^(hasn't|haven't) been$/.test(aux) ? "you haven't " + v + " " + obj
        : /^(has|have) been$/.test(aux) ? "you have " + v + " " + obj
        : /^(was|were)( not|n't)$|^(wasn't|weren't)$/.test(aux) ? "you didn't " + lemma(v) + " " + obj
        : "you " + v + " " + obj;
      const out = line.slice(0, b.index) + active + line.slice(b.index + b[0].length);
      return b.index === 0 ? out.charAt(0).toUpperCase() + out.slice(1) : out;
    }
    return null;
  }

  const VOCAB_SWAP = { testament: "", vibrant: "lively", delve: "look", delves: "looks", leverage: "use", navigate: "handle", robust: "strong",
    seamless: "smooth", seamlessly: "smoothly", pivotal: "key", foster: "build", showcase: "show", tapestry: "", nestled: "set",
    breathtaking: "beautiful", boasts: "has", meticulous: "careful", meticulously: "carefully", embark: "start", realm: "area",
    landscape: "scene", underscore: "show", underscores: "shows", highlighting: "", crucial: "important", enhance: "improve" };
  const PUFF_SWAP = [[/\bstands? as a testament to\b/i, "shows"], [/\bis a testament to\b/i, "shows"], [/\bplays? a (?:vital|crucial|key|pivotal) role in\b/i, "helps"],
    [/\bmarks? a pivotal moment\b/i, "matters"], [/\bleaves? a lasting (?:impact|legacy)\b/i, "stays with people"]];
  const HARSH_SWAP = { unacceptable: ["not what we agreed", "a problem for us"], ridiculous: ["more than I expected", "hard to understand"],
    "i demand": ["I'd like", "I'm asking for"], "i shouldn't have to": ["I'd rather not have to", "I'd rather not have to"],
    "i shouldnt have to": ["I'd rather not have to", "I'd rather not have to"] };
  const COPULA_SWAP = [[/\b(?:serves|stands|functions|acts|operates) as\b/i, "is"], [/\b(?:serve|stand|function|act|operate) as\b/i, "are"],
    [/\b(?:served|stood|serving as|acted as)\b(?: as)?/i, "was"], [/\bboasts\b/i, "has"], [/\bboast\b/i, "have"], [/\bboasted\b/i, "had"],
    [/\brepresents\b/i, "is"], [/\brefers to\b/i, "means"]];
  const STIFF_SWAP = [[/\butiliz(?:e|ation)\b/i, "use"], [/\butilizes\b/i, "uses"], [/\butilized\b/i, "used"], [/\butilizing\b/i, "using"],
    [/\bcommences?\b/i, "starts"], [/\bcommence\b/i, "start"], [/\bcommenced\b/i, "started"], [/\bcommencing\b/i, "starting"],
    [/\bfacilitates\b/i, "helps"], [/\bfacilitate\b/i, "help"], [/\bfacilitated\b/i, "helped"], [/\bfacilitating\b/i, "helping"],
    [/\bendeavou?red\b/i, "tried"], [/\bendeavou?rs?\b/i, "try"], [/\bprior to\b/i, "before"], [/\brelocated\b/i, "moved"],
    [/\brelocating\b/i, "moving"], [/\brelocate\b/i, "move"], [/\bauthored\b/i, "wrote"], [/\bin regards? to\b/i, "about"]];

  function recommendEdits(issue, card, st, parsed) {
    const out = [];
    const line = String(card.value || "");
    const add = (sug) => { if (sug && !out.some((x) => x.text === sug.text && x.kind === sug.kind)) out.push(sug); };
    const lineSug = (text, label) => (text && text.trim() && text.trim() !== line.trim() ? add({ kind: "line", text: text.trim(), label: label || null }) : null);
    const blanks = (t) => t && t.includes(BLANK);
    const code = issue.code || "";
    const draftText = parsed ? parsed.pieces.map((x) => x.text).join(" ") : "";
    let unusedList = null;
    const unusedPieces = () => {
      if (!unusedList) {
        const used = parsed ? usedPieces(st, parsed) : new Set();
        unusedList = parsed ? parsed.pieces.filter((x) => !x.flags.filler && !used.has(x.id)) : [];
      }
      return unusedList;
    };

    // Name the thing the vague word stands for, then ask directly.
    const sharpen = () => {
      const thing = salientThing(parsed, line);
      const vague = Array.from(line.matchAll(/\b(it|this|that|things|stuff|everything|something)\b/gi))
        .filter((m) => !/^(would|is|was|will)\s+$/i.test(line.slice(Math.max(0, m.index - 6), m.index)) || m.index > 12)
        .filter((m) => !/^(?:it|that)$/i.test(m[0]) || !/^\s+(?:appears|seems|looks|is|was|would|could|be)\b/i.test(line.slice(m.index + m[0].length)) || /\bif\s+$|\bto\s+\w+\s+$/i.test(line.slice(0, m.index)));
      const target = vague[vague.length - 1];
      let named = line;
      if (thing && target) named = line.slice(0, target.index) + thing + line.slice(target.index + target[0].length);
      let direct = named
        .replace(/^(?:would|is) it be possible (?:for (?:us|me) )?to\s+/i, "Could we ")
        .replace(/^(?:would|is) it be possible for you to\s+/i, "Could you ")
        .replace(/^i was wondering if (you|we) could\s+/i, (x, who) => "Could " + who.toLowerCase() + " ");
      direct = activeVoice(direct) || direct;
      return { named, direct };
    };

    switch (code) {
      case "minto-specific": {
        // Name the thing, ask directly, and add the date if the draft has one.
        const { named, direct } = sharpen();
        if (named !== line) lineSug(named);
        else {
          const vague = line.match(/\b(?:things|stuff|everything|something)\b/i);
          if (vague) lineSug(line.replace(vague[0], BLANK), "Say what you mean");
        }
        if (VAGUE_TIME.test(direct)) lineSug(direct.replace(VAGUE_TIME, "by " + BLANK), "Name the day");
        if (direct !== named) lineSug(direct);
        const dates = datesIn(draftText).filter((d) => !line.includes(d));
        const base = direct !== line ? direct : named;
        if (dates.length && /\b(move|push|reschedule|change|shift|delay)\b/i.test(base)) lineSug(beforeEnd(base.replace(/\s+back\b/i, ""), " from " + dates[0] + " to " + BLANK));
        else if (/\?\s*$/.test(base)) lineSug(beforeEnd(base, " by " + BLANK));
        break;
      }
      case "W1": {
        const { named } = sharpen();
        lineSug(activeVoice(named) || activeVoice(line), "Say who did it");
        break;
      }
      case "W2": {
        const q = (issue.quotes || [])[0];
        if (q) lineSug(line.replace(new RegExp("\\b" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"), BLANK), "Put the number in");
        break;
      }
      case "data-big-idea":
      case "data-vague-amount":
      case "cover-test": {
        if (code === "cover-test") {
          // Bring back a short detail the draft had, or leave room for one.
          unusedPieces().filter((x) => (RX.digit.test(x.text) || RX.date.test(x.text) || /(?<=[a-z0-9,;:'’)] )[A-Z][a-z]+/.test(x.text)) && wordCount(x.text) <= 14)
            .slice(0, 2).forEach((x) => lineSug(line.replace(/\s*$/, " ") + x.text, "Bring back a detail"));
          const { direct } = sharpen();
          if (/\?\s*$/.test(direct)) { lineSug(beforeEnd(direct, " by " + BLANK), "Add the date"); break; }
          if (VAGUE_TIME.test(line)) { lineSug(line.replace(VAGUE_TIME, "by " + BLANK), "Name the day"); break; }
          if (/\blet me know\b/i.test(line)) { lineSug(line.replace(/\blet me know\b/i, (x) => x + " by " + BLANK), "Name the day"); break; }
          if (!VAGUE_AMOUNT.test(line)) { lineSug(beforeEnd(line, " on " + BLANK), "Add the date"); break; }
        }
        let swapped = line.replace(new RegExp(VAGUE_AMOUNT.source, "gi"), (v) => (/^(a lot|lots|tons|a bunch|a fortune)$/i.test(v) ? "$" + BLANK : "$" + BLANK));
        swapped = swapped.replace(/\$___ (cheaper|more|less|higher|lower)/g, "$$" + BLANK + " $1").replace(/a \$___ amount/g, "$$" + BLANK);
        lineSug(swapped, "Put the numbers in");
        const subject = (line.match(/^((?:the|our|my|your)\s+(?:[a-z]+\s){0,2}[a-z]+?)\s+(?:is|are|was|will|would|costs?|saves?)\b/i) || [])[1];
        if (subject) lineSug(subject.charAt(0).toUpperCase() + subject.slice(1) + " saves us $" + BLANK + " a month: $" + BLANK + " instead of $" + BLANK + ".", "Knaflic's Big Idea");
        break;
      }
      case "data-bare": {
        const n = (issue.quotes || [])[0];
        if (n && line.includes(n)) {
          lineSug(line.replace(n, n + " (up from " + BLANK + ")"), "Compare it");
          lineSug(line.replace(n, n + " (instead of " + BLANK + ")"), "Compare it");
        }
        break;
      }
      case "scqa-situation": {
        unusedPieces().filter((x) => x.flags.situation).slice(0, 2).forEach((x) => lineSug(x.text, "From your draft"));
        const topic = topicOf(st.point, parsed);
        if (topic) lineSug(topic + " is usually " + BLANK + ".");
        lineSug("Last time, " + BLANK + ".");
        break;
      }
      case "scqa-complication": {
        unusedPieces().filter((x) => x.flags.complication).slice(0, 2).forEach((x) => lineSug(x.text, "From your draft"));
        lineSug("But " + BLANK + " won't be ready until " + BLANK + ".");
        lineSug("But this year, " + BLANK + ".");
        break;
      }
      case "minto-point": {
        if (st.methods.mece) {
          const all = st.groups.flatMap(groupItems);
          const n = all.filter((t, k) => !all.slice(0, k).some((u) => overlap(t, u) >= 0.6)).length;
          const say = ["", "One thing", "Two things", "Three things", "Four things", "Five things", "Six things", "Seven things", "Eight things", "Nine things"][n] || n + " things";
          if (n) lineSug(say + " to sort out before " + BLANK + ".");
          lineSug("Here's who's doing what for " + BLANK + ".");
        } else {
          unusedPieces().filter((x) => x.flags.ask || x.flags.news).slice(0, 2).forEach((x) => lineSug(x.text, "From your draft"));
          lineSug("Could you " + BLANK + " by " + BLANK + "?");
        }
        break;
      }
      case "mece-rule": {
        const items = st.groups.flatMap(groupItems);
        const mixed = items.some((t) => RX.need.test(t)) && items.some((t) => !RX.need.test(t));
        (mixed ? ["Settled vs. still needed", "By person", "By time", "By option"] : ["By person", "By time", "Settled vs. still needed", "By option"])
          .forEach((r) => add({ kind: "rule", text: r }));
        break;
      }
      case "mece-count": {
        const items = st.groups.flatMap(groupItems);
        if (items.some((t) => RX.need.test(t)) && items.some((t) => !RX.need.test(t))) add({ kind: "regroup", text: "Sort into Settled and Still needed" });
        else if (items.length >= 2) add({ kind: "regroup", text: "Sort into Settled and Still needed", all: true });
        break;
      }
      case "mece-labels": {
        const rule = (st.rule || "").toLowerCase();
        const sets = /time/.test(rule) ? ["This week", "Next week", "Later"] : /option/.test(rule) ? ["Option A", "Option B", "Option C"] : ["Settled", "Still needed", "Later"];
        const n = st.groups.filter((g) => groupItems(g).length).length;
        add({ kind: "labels", labels: sets.slice(0, Math.max(2, Math.min(3, n))), text: "Name them " + sets.slice(0, Math.max(2, Math.min(3, n))).join(" / ") });
        break;
      }
      case "mece-overlap": {
        (issue.quotes || []).slice(0, 2).forEach((q, k, all) => add({ kind: "keep-item", drop: all[1 - k], text: "Keep “" + q + "”" }));
        break;
      }
      case "inv-when": {
        const dates = datesIn(draftText).filter((d) => !line.includes(d));
        dates.slice(0, 2).forEach((d) => lineSug(beforeEnd(line, " " + (/^\d|^the |^(?:mon|tues|wednes|thurs|fri|satur|sun)day/i.test(d) ? "on " : /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(d) ? "in " : "") + d), "Add the date from your draft"));
        if (VAGUE_TIME.test(line)) lineSug(line.replace(VAGUE_TIME, "by " + BLANK), "Name the day");
        else lineSug(beforeEnd(line, " on " + BLANK), "Add the date");
        break;
      }
      case "inv-buildup": {
        const m = line.match(/^(?:so,?\s+|well,?\s+)?(?:i was (?:just )?thinking(?: about)?|i wanted to (?:say|mention|let you know)(?: that)?|guess what[,!?.]*|big news[,!:.]*|some (?:big |exciting )?news[,!:.]*|as some of you know,?|it'?s been a [^,.]*[,.])\s*/i);
        if (m && m[0].trim().length < line.trim().length) lineSug(capFirst(line.slice(m[0].length)), "Start on the news");
        break;
      }
      case "P6":
      case "R1": {
        const sents = sentencesOf(line);
        const long = sents.find((x) => wordCount(x) > 25) || line;
        const parts = looseSplit(long);
        if (parts.length > 1) lineSug(line.replace(long, parts.join(" ")), "Split it in two");
        break;
      }
      case "inv-lede":
      case "minto-length":
      case "minto-one": {
        const parts = sentencesOf(line);
        const clauses = parts.length > 1 ? parts : looseSplit(line);
        if (clauses.length > 1) add({ kind: "split", first: clauses[0], rest: clauses.slice(1).join(" "), text: "Keep “" + clauses[0] + "” as the point and move the rest down" });
        break;
      }
      case "wwb-subject": {
        const ask = String(st.point || "").replace(/^(?:could|can|would|will) (?:you|we)\s+(?:please\s+)?|^please\s+/i, "").replace(/[?.!]+$/, "").trim();
        if (ask) {
          const short = ask.split(/\s+/).slice(0, 10).join(" ");
          lineSug(short.charAt(0).toUpperCase() + short.slice(1), "From your point");
          const d = datesIn(st.point)[0] || datesIn(draftText)[0];
          if (d && !short.includes(d)) lineSug(short.charAt(0).toUpperCase() + short.slice(1) + " by " + d, "From your point");
        }
        break;
      }
      case "minto-close":
        lineSug("Let me know by " + BLANK + ".");
        add({ kind: "line", text: "", label: "Cut the ending" });
        break;
      case "C2": {
        const m = /\b(?:it'?s|this is|that'?s)\s+not\s+(?:just\s+)?(?:about\s+)?[^,—–-]+[,—–-]+\s*(?:it'?s|this is|that'?s)\s+(?:about\s+)?([^.!?]+)/i.exec(line);
        if (m) lineSug(line.slice(0, m.index) + "It's about " + m[1].trim() + line.slice(m.index + m[0].length), "Keep the real point");
        break;
      }
      case "C7": case "A2": {
        if (code === "A2") {
          const q = ((issue.quotes || [])[0] || "").trim();
          if (q) lineSug(line.replace(new RegExp("\\b" + reEsc(q) + "\\b", "i"), BLANK), "Say what you saw");
        }
        let swapped = line;
        for (const q of issue.quotes || []) {
          for (const w of q.split(/,\s*/)) {
            const k = w.trim().toLowerCase();
            if (VOCAB_SWAP[k] === undefined) continue;
            swapped = swapped.replace(new RegExp("\\s*\\b" + k + "\\b", "i"), VOCAB_SWAP[k] ? " " + VOCAB_SWAP[k] : "");
          }
        }
        lineSug(applyPairs(swapped, []), "Plain words");
        break;
      }
      case "A1": {
        let swapped = line;
        for (const [re, to] of PUFF_SWAP) swapped = swapped.replace(re, to);
        lineSug(swapped, "Say what happened");
        break;
      }
      case "B1": {
        lineSug(line.replace(/,\s*\w+ing\b[^.!?]*([.!?])/, "$1"), "Cut the tail");
        break;
      }
      case "B2": {
        const q = (issue.quotes || [])[0];
        if (q) {
          const said = /(?:ed|have said|has shown|have shown|have noted)$/i.test(q) ? " said" : " says";
          lineSug(line.replace(new RegExp(reEsc(q), "i"), BLANK + said), "Name the source");
          lineSug(line.replace(new RegExp(reEsc(q), "i"), "I think"), "Own it");
        }
        break;
      }
      case "T3": {
        const cleaned = line.replace(/\b(?:I'?m\s+)?(?:so |really |very |truly )?sorry[,!.]\s+(?=(?:so |really |very |truly )?sorry)/i, "")
          .replace(/\b(?:so|really|very|truly) sorry\b/i, "sorry");
        lineSug(cleaned.charAt(0).toUpperCase() + cleaned.slice(1), "Apologize once");
        break;
      }
      case "T5": {
        // Every harsh word in the line, softened the same way.
        const harsh = Array.from(new Set((line.match(new RegExp(Object.keys(HARSH_SWAP).map(reEsc).join("|"), "gi")) || []).map((x) => x.toLowerCase().replace(/’/g, "'"))));
        for (const k of [0, 1]) {
          let soft = line;
          for (const q of harsh) {
            const to = (HARSH_SWAP[q] || HARSH_SWAP[q.replace("'", "")] || [])[k];
            if (to) soft = soft.replace(new RegExp(reEsc(q).replace("'", "['’]?"), "i"), (m) => (/^[A-Z]/.test(m) && m !== "I" && !/^I /.test(m) ? capFirst(to) : to));
          }
          lineSug(soft, "A calmer word");
        }
        break;
      }
      case "T6": {
        const m = /\bnot sure if you saw ([^,.!?]+)[,.!?]?\s*(?:but\s+)?(.*)$/i.exec(line);
        if (m) {
          const before = line.slice(0, m.index);
          const what = m[1].trim();
          lineSug(before + (m[2] ? "In case " + what + " got buried, " + m[2] : "Following up on " + what + "."), "Ask fresh");
        }
        break;
      }
      case "T4": {
        const q = ((issue.quotes || [])[0] || "").toLowerCase();
        if (/^(?:i think|possibly)$/.test(q)) lineSug(applyPairs(line.replace(new RegExp("\\b" + q + "\\b,?\\s*", "i"), ""), []), "Commit to it");
        break;
      }
      case "C3": {
        let swapped = line;
        for (const [re, to] of PUFF_SWAP) swapped = swapped.replace(re, to);
        for (const [re, to] of COPULA_SWAP) if (re.test(swapped)) { swapped = swapped.replace(re, to); break; }
        lineSug(swapped, "Use is or has");
        break;
      }
      case "H1": {
        let swapped = line;
        for (const [re, to] of STIFF_SWAP) swapped = swapped.replace(re, (m) => matchCase(m, to));
        lineSug(swapped, "The plain verb");
        break;
      }
      case "A4":
      case "B4":
      case "D7": {
        const q = (issue.quotes || [])[0];
        if (q) lineSug(applyPairs(line.replace(new RegExp(reEsc(q) + "(?:\\s+that)?[,:]?\\s*", "i"), ""), []), "Cut it");
        break;
      }
      case "B3": {
        const q = (issue.quotes || [])[0];
        if (q) lineSug(line.replace(new RegExp(reEsc(q), "i"), BLANK), "Say how they're connected");
        break;
      }
      case "B5": {
        const q = (issue.quotes || [])[0];
        if (q) {
          lineSug(line.replace(q, BLANK), "Fill it in");
          lineSug(applyPairs(line.replace(q, ""), []), "Cut it");
        }
        break;
      }
      case "P4": {
        const q = (issue.quotes || [])[0];
        if (q && /^(?:the|my|our|your|this|that)\s/i.test(q) && wordCount(q) <= 4) {
          const first = line.indexOf(q);
          const second = first >= 0 ? line.indexOf(q, first + q.length) : -1;
          const at = second > 0 ? second : first;
          if (at >= 0) lineSug(line.slice(0, at) + (at === 0 ? "It" : "it") + line.slice(at + q.length), "Say it once");
        }
        break;
      }
      case "P5": {
        // "I called. I left a note. I sent a text." -> "I called, left a note and sent a text."
        const ss = sentencesOf(line);
        const w = ((issue.quotes || [])[0] || "").split(/\s+/)[0];
        if (w && ss.length === 1 && new RegExp("^" + reEsc(w) + "\\b").test(line.trim())) {
          const rest = w === "I" ? line.trim() : line.trim().charAt(0).toLowerCase() + line.trim().slice(1);
          lineSug("Then " + rest, "Start it differently");
          lineSug("After that, " + rest, "Start it differently");
        }
        const same = ss.filter((x) => new RegExp("^" + reEsc(w) + "\\b").test(x));
        if (same.length >= 3 && w) {
          const rest = same.map((x, k) => (k === 0 ? x : x.replace(new RegExp("^" + w + "\\s+"), "")).replace(/[.!]+$/, ""));
          const joined = rest.slice(0, -1).join(", ") + " and " + rest[rest.length - 1] + ".";
          let out2 = line;
          same.forEach((x, k) => { out2 = out2.replace(x, k === 0 ? joined : ""); });
          lineSug(applyPairs(out2, []), "Combine them");
        }
        break;
      }
      case "F1": {
        const m = /(\d{1,2})\/(\d{1,2})/.exec((issue.quotes || [])[0] || "");
        if (m && /doesn't exist/.test(issue.title)) {
          const mo = +m[1];
          const last = new Date(Date.UTC((polish.today || new Date()).getFullYear(), mo, 0)).getUTCDate();
          lineSug(line.replace(m[0], mo + "/" + last), "The last day of that month");
          lineSug(line.replace(m[0], (mo % 12 + 1) + "/1"), "The first day of the next month");
        }
        break;
      }
      default:
        break;
    }
    // A vague-word note only gets edits that would clear it once the blanks are filled.
    const kept = code !== "minto-specific" ? out : out.filter((x) => {
      const f = sampleFill(x.text);
      return !RX.vague.test(f) || RX.digit.test(f) || RX.date.test(f);
    });
    kept.forEach((x) => { x.blank = x.kind === "line" && blanks(x.text); });
    return kept;
  }

  // What a blank will likely hold, to test an edit before the writer fills it.
  function sampleFill(text) {
    return String(text || "").replace(/\$___/g, "$40").replace(/\((up from|instead of) ___\)/g, "($1 $96)")
      .replace(/\b(by|on|until|before|from|to) ___/gi, "$1 Friday").replace(/___ (says|said)/g, "Consumer Reports $1").replace(/___/g, "the rent");
  }

  // Applies a recommended edit to the card it belongs to.
  function applySuggestion(state, card, sug) {
    const st = JSON.parse(JSON.stringify(state));
    if (sug.kind === "line") setField(st, card.field, card.index, sug.text);
    else if (sug.kind === "split") {
      st.point = finish(sug.first);
      if (st.methods.mece) st.groups[0].items = [sug.rest].concat(groupItems(st.groups[0])).join("\n");
      else st.support = [finish(sug.rest)].concat(st.support.filter((x) => x.trim()));
    } else if (sug.kind === "rule") {
      st.rule = sug.text;
      // "Settled vs. still needed" can sort the items on its own.
      if (/^settled/i.test(sug.text) && st.groups.filter((g) => groupItems(g).length).length < 2) return applySuggestion(st, card, { kind: "regroup" });
    } else if (sug.kind === "regroup") {
      const items = st.groups.flatMap(groupItems);
      const needs = items.filter((t) => RX.need.test(t));
      const settled = items.filter((t) => !RX.need.test(t));
      st.groups = settled.length && needs.length
        ? [{ label: "Settled", items: settled.join("\n"), mode: "auto" }, { label: "Still needed", items: needs.join("\n"), mode: "auto" }]
        : [{ label: "Settled", items: items.slice(0, Math.ceil(items.length / 2)).join("\n"), mode: "auto" }, { label: "Still needed", items: items.slice(Math.ceil(items.length / 2)).join("\n"), mode: "auto" }];
      st.rule = "Settled vs. still needed";
    } else if (sug.kind === "labels") {
      let k = 0;
      st.groups.forEach((g) => { if (groupItems(g).length && !squash(g.label) && sug.labels[k]) g.label = sug.labels[k++]; else if (groupItems(g).length) k++; });
    } else if (sug.kind === "keep-item") {
      let dropped = false;
      st.groups.forEach((g) => {
        g.items = groupItems(g).filter((t) => { if (!dropped && t === sug.drop) { dropped = true; return false; } return true; }).join("\n");
      });
    }
    return st;
  }

  // The sign-off board: each desk signs off when none of its checks fail.
  function deskReport(st, parsed) {
    const warns = check(st, parsed).filter((c) => c.status === "warn");
    return DESK_ORDER.map((key) => {
      const open = warns.filter((c) => c.desk === key);
      return { key, name: DESKS[key].name, initials: DESKS[key].initials, job: DESKS[key].job, signed: !open.length, open: open.map((c) => c.title) };
    });
  }

  // Before and after numbers for the finish line.
  function compare(draftText, st, parsed) {
    const built = assemble(st);
    const before = tellCount(draftText, st.methods.wwb);
    const after = tellCount(built.text, st.methods.wwb);
    let pointFrom = null;
    let pointTo = null;
    if (parsed && squash(st.point)) {
      const p = norm(st.point);
      const hit = parsed.pieces.find((x) => { const n = norm(x.text); return n && (p.includes(n) || n.includes(p)); });
      if (hit) pointFrom = hit.sentence;
      const part = built.parts.find((x) => x.field === "point");
      if (part) pointTo = sentencesOf(built.text.slice(built.bodyStart, part.start)).length + 1;
    }
    const filler = parsed ? parsed.pieces.filter((p) => p.flags.filler && !usedPieces(st, parsed).has(p.id)).length : 0;
    return {
      words: [wordCount(draftText), wordCount(built.text)],
      tells: [before.strong + before.moderate, after.strong + after.moderate],
      ratio: st.methods.wwb ? [meaningRatio(draftText), meaningRatio(built.text)] : null,
      pointFrom,
      pointTo,
      filler,
      cuts: built.cuts.length,
      polish: [polishText(draftText).length, polish(built.text, frameParts(built)).length],
    };
  }

  // Labels, hints and examples for each slot, which change with the methods.
  function slotCopy(methods) {
    const m = methods;
    const point = m.inverted
      ? { label: "Lede", hint: "What happened, to whom, when and where, in under 35 words. A reader who stops here has the story.", example: "We're moving to Milwaukee on March 15." }
      : m.scqa
        ? { label: "Answer", hint: "Your decision or your ask. It answers the question the complication raises.", example: "So this year it's at our place, same time: 2pm on the 26th." }
        : m.data
          ? { label: "Big Idea", hint: "Your point of view and what's at stake, in one sentence.", example: "The new plan saves us $34 a month." }
          : m.mece
            ? { label: "Your point", hint: "One sentence that says what the list is for.", example: "Three jobs before Friday." }
            : { label: "Your point", hint: "The one sentence the message exists to deliver: the ask, the news, the decision, or the fix you want.", example: "Could we move the deck start from 11/14 to 11/21?" };
    if (m.data && (m.inverted || m.scqa)) point.hint += " Put the key number in it.";
    return {
      point,
      situation: { label: "Situation", hint: "Something the reader already knows and agrees with. One fact, no mood.", example: "Thanksgiving is usually at Mom's." },
      complication: { label: "Complication", hint: "What changed or went wrong, as a fact. Add the date if there is one.", example: "But her kitchen won't be finished until January." },
      support: m.inverted
        ? { label: "Details, most important first", hint: "Actions and dates go high. Backstory goes low, or into Background.", example: "We signed the lease Saturday: a two-bedroom ten minutes from Tara's new job." }
        : { label: "What backs it up", hint: "Each line answers the question your point raises, such as why it matters to the reader." + (m.data ? " Give every number a comparison." : ""), example: m.data ? "That's $408 a year, about one flight home." : "My in-laws are staying with us that week and the yard will be full." },
      groups: { label: "Groups", hint: "Sort every item by one rule. Each item fits exactly one group, and nothing is missing.", example: "Book the cabin" },
      rule: { label: "Sorting rule", hint: "", example: "By person" },
      background: { label: "Background, cut first", hint: "Backstory the reader can skip. The piece must still work without it.", example: "We looked at six places before this one." },
      close: { label: "Next step", hint: m.data ? "End on the action: what should they do with the numbers?" : "The next action or the date. Never a recap.", example: "Anything from 11/21 through 11/30 works for us." },
      subject: { label: "Subject line", hint: "Make it useful even if it's the only thing read.", example: "Charged twice for invoice #4471: please refund $185" },
      greeting: { label: "Greeting", hint: "", example: "Hi Mark," },
      signoff: { label: "Sign-off", hint: "", example: "Thanks,\nJohn" },
    };
  }

  const api = {
    METHODS, METHOD_NAMES, METHOD_JOBS, EXAMPLES, TRIMS, DESKS, DESK_ORDER, deskReport, factCheck, consistency,
    words, wordCount, splitSentences, splitClauses, parseDraft, describe, listItems, isCloser,
    emptyState, methodsFrom, recommend, suggest, switchMethod, usedPieces,
    applyTrims, bakeTrims, assemble, partAt, applyPairs, applyFixes, autoFixes, recommendEdits, applySuggestion, sampleFill, activeVoice, lemma, meaningRatio, tellCount, plainFix, check, diagnose, tasks, fieldValue, setField,
    compare, slotCopy, overlap, polish, polishText, polishSummary, frameMask,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WorkshopCore = api;
})(typeof window !== "undefined" ? window : this);
