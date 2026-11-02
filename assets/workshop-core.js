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
  };
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
    const add = (id, method, status, title, detail, quotes) => out.push({ id, method, status, title, detail: detail || "", quotes: quotes || [] });
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
      const specific = RX.digit.test(point) || RX.date.test(point) || /(?<=\S\s)[A-Z][a-z]+/.test(point);
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

    // The tell audit: always last.
    const t = tellCount(built.text, m.wwb);
    if (t.strong + t.moderate) add("tells", "audit", "warn", (t.strong + t.moderate) + (t.strong + t.moderate === 1 ? " tell left" : " tells left"), "Fix the highlighted phrases. Go back to the specific thing each one stood in for.");
    else if (wordCount(built.body)) add("tells", "audit", "pass", "No strong or moderate tells");

    return out;
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
    if (!flags.length) flags.push({ id: "clean", kind: "good", title: "This draft already leads with its point", detail: "The rewrite tidies the structure, and the checks confirm it.", pieces: [] });
    if (parsed.greeting || parsed.signoff) {
      const what = parsed.greeting && parsed.signoff ? "Your greeting and sign-off stay" : parsed.greeting ? "Your greeting stays" : "Your sign-off stays";
      flags.push({ id: "voice", kind: "good", title: what + " as you wrote " + (parsed.greeting && parsed.signoff ? "them" : "it"), detail: "That's your voice, so the rewrite keeps it.", pieces: [] });
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
    "minto-close": "close", "wwb-subject": "subject",
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
      if (field) card(field, 0).issues.push({ title: c.title, detail: c.detail, quotes: c.quotes, method: c.method });
    }
    // Phrase-level problems: trace each one to the line that holds it.
    const locate = (offset) => partAt(built, offset);
    const put = (part, issue) => {
      if (!part || part.field === "greeting" || part.field === "signoff") return;
      if (part.field === "subject" && !st.isEmail) return;
      const c = card(part.field, part.index);
      if (!c.issues.some((x) => x.title === issue.title && String(x.quotes) === String(issue.quotes))) c.issues.push(issue);
    };
    const scanned = TellScan.scan(built.text, { wwb: st.methods.wwb });
    for (const f of scanned.findings) {
      if (f.severity === "weak") continue;
      const issue = { title: f.label, detail: plainFix(f), quotes: f.match ? [f.match.trim()] : [], method: f.family === "WWB" ? "wwb" : "audit" };
      if (typeof f.start === "number") put(locate(f.start), issue);
      else if (f.spans && f.spans.length) put(locate(f.spans[0].start), issue);
      else if (f.code !== "W5") card("general", 0).issues.push(issue);
    }
    if (st.methods.data) {
      const vague = new RegExp(VAGUE_AMOUNT.source, "gi");
      let m;
      while ((m = vague.exec(built.text))) {
        put(locate(m.index), { title: "Vague amount", detail: "Swap it for the number, with a comparison.", quotes: [m[0]], method: "data" });
      }
      for (const s of bareNumbers(sentencesOf(built.body))) {
        const at = built.text.indexOf(s);
        if (at >= 0) put(locate(at), { title: "A number with nothing to compare it to", detail: "Add what it's up or down from, or what it's worth in real terms.", quotes: [s.match(MONEY_OR_AMOUNT)[0]], method: "data" });
      }
    }
    const list = Array.from(cards.values()).filter((c) => c.issues.length);
    list.sort((a, b) => (FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field)) || (a.index - b.index));
    for (const c of list) c.value = fieldValue(st, c.field, c.index);
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
    METHODS, METHOD_NAMES, METHOD_JOBS, EXAMPLES, TRIMS,
    words, wordCount, splitSentences, splitClauses, parseDraft, describe, listItems, isCloser,
    emptyState, methodsFrom, recommend, suggest, switchMethod, usedPieces,
    applyTrims, bakeTrims, assemble, partAt, meaningRatio, tellCount, plainFix, check, diagnose, tasks, fieldValue, setField,
    compare, slotCopy, overlap,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WorkshopCore = api;
})(typeof window !== "undefined" ? window : this);
