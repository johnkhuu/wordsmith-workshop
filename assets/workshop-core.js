/*
 * The workshop's logic: no page code, so it runs in Node for the tests.
 *
 * Each method from the skill's guides (references/methods/*.md) becomes three
 * things here: slots (what you fill in), an order (how the slots assemble),
 * and checks (the guide's own checklist, automated where a rule can decide
 * and left as a prompt where only a person can). There's no AI: the first
 * pass only sorts the visitor's own sentences, and every slot stays editable.
 */
(function (root) {
  "use strict";

  const TellScan = (typeof module !== "undefined" && module.exports)
    ? require("./scanner.js")
    : root.TellScan;

  const METHODS = ["scqa", "mece", "inverted", "wwb", "data"];

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
    return s.replace(/^(\W*)([a-z])/, (m, pre, c) => pre + c.toUpperCase());
  }

  // Ends a sentence with a period unless it already has its own ending.
  function finish(s) {
    s = squash(s);
    if (!s) return "";
    if (/[.!?…:]["'”’)\]]*$/.test(s)) return s;
    return s.replace(/[,;]+$/, "") + ".";
  }

  function sentenceCase(s) { return capFirst(finish(s)); }

  // ---------------------------------------------------------------------
  // What a sentence is doing
  // ---------------------------------------------------------------------

  const RX = {
    ask: /\?\s*["'”’)]*\s*$|\b(could you|can you|would you|will you|please|i'?d like|i would like|we'?d like|we would like|could we|can we|would it be possible|let me know|i need you|we need you|i'?d appreciate|i would (?:really )?appreciate|would appreciate it)\b/i,
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

  // Capitalized words that also appear mid-sentence are names. Used so that
  // joining "Dan is driving" into a list keeps the capital D.
  function namesIn(text) {
    const names = new Set(["I"]);
    const re = /(?<=[a-z0-9,;:'’)] )([A-Z][a-zA-Z'’-]+)/g;
    let m;
    while ((m = re.exec(String(text || "")))) names.add(m[1]);
    return names;
  }

  // Words that open a sentence without being names.
  const FUNCTION_WORDS = new Set(["the", "a", "an", "we", "our", "my", "it", "its", "this", "that", "these", "those",
    "there", "he", "she", "they", "their", "his", "her", "you", "your", "someone", "everyone", "anyone", "somebody",
    "everybody", "nobody", "all", "some", "both", "each", "one", "also", "and", "but", "so", "for", "to", "in", "on",
    "at", "with", "from", "by", "if", "when", "then", "still", "please", "has", "have", "is", "are", "can", "could"]);

  function lowerFirst(s, names) {
    const m = /^([A-Z][a-zA-Z'’-]*)\s*(\S*)/.exec(s);
    if (!m) return s;
    const w = m[1];
    const next = m[2] || "";
    if (names.has(w) || w === "I" || /^I['’]/.test(w) || /^[A-Z]{2,}/.test(w)) return s;
    if (!FUNCTION_WORDS.has(w.toLowerCase())) {
      // "Dan is driving", "Maya has games", "Dan's car": a name, so it keeps its capital.
      if (/['’]s$/.test(w)) return s;
      if (/^(?:is|are|was|were|will|has|have|had|can|could|should|would|said|says|and|&|or)$/i.test(next)) return s;
    }
    return w.charAt(0).toLowerCase() + s.slice(1);
  }

  function describe(text) {
    const t = text;
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

  const ABBR = /(?:^|[\s(])(?:mr|mrs|ms|dr|st|jr|sr|vs|etc|e\.g|i\.e|a\.m|p\.m|no|ave|apt|approx|inc|co|ltd|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.$/i;

  function splitSentences(par) {
    const out = [];
    let start = 0;
    const re = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
    let m;
    while ((m = re.exec(par))) {
      const end = m.index + m[0].length;
      if (m[0] === "." && ABBR.test(par.slice(Math.max(0, m.index - 8), m.index + 1))) continue;
      const rest = par.slice(end).replace(/^\s+/, "");
      if (rest && !/^["'“‘(\[]?[A-Z0-9$#]/.test(rest)) continue;
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

  const LIST_MARK = /^\s*(?:[-*•●▪–]|\d+[.)])\s+/;
  const GREETING_LINE = /^(?:hi|hey|hello|dear|hiya|greetings|good (?:morning|afternoon|evening))\b[^.!?\n]{0,40}[,!:]?\s*$/i;
  const GREETING_LEAD = /^((?:hi|hey|hello|dear|hiya)\b(?:\s+(?:and|&|all|everyone|guys|team|folks|y'all|there|[A-Z][\w'’.-]*)){0,4}\s*[,!:])\s*/i;
  const CLOSER = /^(?:thanks|thank you|thanks again|thanks so much|many thanks|best|best regards|kind regards|warm regards|regards|cheers|sincerely|warmly|love|talk soon|see you soon|xo+|take care)\b[^.?\n]{0,20}[,.!]?\s*$/i;
  const NAME_LINE = /^[A-Z][\w'’.-]*(?: [A-Z][\w'’.-]*){0,2}$/;

  function parseDraft(text) {
    let src = String(text || "").replace(/\r\n?/g, "\n").trim();
    const out = { subject: "", greeting: "", signoff: "", pieces: [], sentences: 0 };
    if (!src) return out;

    let lines = src.split("\n");
    const sub = /^\s*subject:\s*(.+)$/i.exec(lines[0]);
    if (sub) { out.subject = sub[1].trim(); lines = lines.slice(1); }
    while (lines.length && !lines[0].trim()) lines.shift();

    if (lines.length) {
      const first = lines[0].trim();
      if (GREETING_LINE.test(first) && wordCount(first) <= 6) {
        out.greeting = first;
        lines = lines.slice(1);
      } else {
        const m = GREETING_LEAD.exec(first);
        if (m && wordCount(m[1]) <= 5) {
          out.greeting = m[1].trim();
          lines[0] = first.slice(m[0].length);
        }
      }
    }

    // Sign-off: "Best,\nSam", or a closer line on its own.
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const last = (lines[lines.length - 1] || "").trim();
    const prev = (lines[lines.length - 2] || "").trim();
    if (lines.length >= 2 && NAME_LINE.test(last) && CLOSER.test(prev)) {
      out.signoff = prev + "\n" + last;
      lines = lines.slice(0, -2);
    } else if (CLOSER.test(last)) {
      out.signoff = last;
      lines = lines.slice(0, -1);
    }

    // Paragraphs, then sentences. List items stay one per line.
    const paras = lines.join("\n").split(/\n\s*\n/);
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
        for (const sentence of splitSentences(chunk)) {
          sentenceNo += 1;
          for (const part of splitClauses(sentence)) {
            out.pieces.push({ id: "s" + out.pieces.length, text: sentenceCase(part), para: p, sentence: sentenceNo });
          }
        }
      }
    });

    // A closing "Thanks!" at the end of the last paragraph is a sign-off.
    const tail = out.pieces[out.pieces.length - 1];
    if (!out.signoff && tail && CLOSER.test(tail.text) && wordCount(tail.text) <= 4) {
      out.signoff = tail.text;
      out.pieces.pop();
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
      .filter((p) => wordCount(p) >= 2)
      .map((p) => capFirst(p));
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

    // The point.
    let best = null;
    let bestScore = -Infinity;
    pieces.forEach((p, i) => {
      const sc = scorePoint(p, methods, i, pieces.length);
      if (sc > bestScore) { best = p; bestScore = sc; }
    });
    const weakPoint = !best || bestScore < 1;
    if (best && !(methods.mece && weakPoint)) {
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
      if (best && !st.point && !items.length) items.push(...listItems(best.text));
      if (best && !st.point) { listItems(best.text).forEach((t) => { if (!items.includes(t)) items.unshift(t); }); used.add(best.id); }
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

  // Switching methods on or off after the first pass: move content between
  // slots instead of losing it, and fill newly shown slots from unused pieces.
  function switchMethod(state, parsed, key, on) {
    const st = JSON.parse(JSON.stringify(state));
    st.methods[key] = on;
    const inUse = usedPieces(st, parsed);
    const free = (parsed ? parsed.pieces : []).filter((p) => !inUse.has(p.id) && !p.flags.filler);
    if (key === "mece") {
      if (on) {
        const items = st.support.filter((s) => s.trim()).flatMap(listItems);
        st.groups = [{ label: "", items: items.join("\n"), mode: "auto" }];
        st.support = [""];
      } else {
        const items = st.groups.flatMap((g) => g.items.split("\n")).map((s) => s.trim()).filter(Boolean).map(finish);
        st.support = items.length ? items : [""];
        st.groups = [{ label: "", items: "", mode: "auto" }];
        st.rule = "";
      }
    }
    if (key === "scqa" && on) {
      if (!st.complication.trim()) {
        const c = free.find((p) => p.flags.complication) ||
          st.support.map((t) => ({ text: t, flags: describe(t) })).find((p) => p.text.trim() && p.flags.complication);
        if (c) { st.complication = c.text; st.support = dropText(st.support, c.text); }
      }
      if (!st.situation.trim()) {
        const s = free.find((p) => p.flags.situation && p.text !== st.complication);
        if (s) { st.situation = s.text; st.support = dropText(st.support, s.text); }
      }
    }
    if (key === "inverted" && !on && st.background.trim()) {
      st.support = st.support.filter((s) => s.trim()).concat([st.background.trim()]);
      st.background = "";
    }
    if (key === "wwb" && on && !st.isEmail && st.subject) st.isEmail = true;
    return st;
  }

  function dropText(list, text) {
    const out = list.filter((s) => s.trim() !== text.trim());
    return out.length ? out : [""];
  }

  // Which draft pieces a slot already holds (by text), so chips can show it.
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

  // Mechanical cuts a careful editor makes on sight. The stock openers and
  // recaps go in every rewrite; the Writing Without Bullshit edit adds the
  // intensifiers and hedges. Each cut is listed so nothing vanishes silently.
  const TRIMS = [
    { re: /\bI (?:just )?wanted to (?:reach out|touch base|follow up)(?: (?:to let you know|to say|to ask|to tell you))?(?: that)?,?\s*/gi, why: "stock opener" },
    { re: /\bI hope (?:this (?:message|email|note) finds you well|you(?:'re|’re| are) (?:doing )?well|all is well)[.!]?\s*/gi, why: "stock opener" },
    { re: /\b(?:In (?:summary|conclusion|sum|short)|To sum up|All in all|Overall|Ultimately|At the end of the day),\s*/g, why: "recap opener" },
    { re: /,?\s*at your earliest convenience/gi, why: "stock phrase" },
    { re: /(?:Please )?(?:don't|don’t|do not) hesitate to (?:reach out|contact (?:me|us)|ask)(?: if [^.!?]*)?[.!]?\s*/gi, why: "chatbot residue" },
    { re: /\b(?:very|really|truly|incredibly|extremely|totally|absolutely|deeply|super) (?=[a-z])/gi, why: "intensifier", wwb: true },
    { re: /\b(could|may|might|would) possibly\b/gi, to: "$1", why: "hedge", wwb: true },
    { re: /\bjust (?=(?:a quick|wanted|to let|checking))/gi, why: "filler", wwb: true },
  ];

  function applyTrims(text, wwb) {
    const cut = [];
    let s = text;
    for (const t of TRIMS) {
      if (t.wwb && !wwb) continue;
      s = s.replace(t.re, (m, g1) => {
        cut.push({ text: m.trim().replace(/[,.!]+$/, ""), why: t.why });
        return t.to ? t.to.replace("$1", g1) : "";
      });
    }
    s = s.replace(/ {2,}/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/^[,\s]+/, "");
    return { text: capFirst(s.trim()), cut };
  }

  function joinItems(items, names) {
    const xs = items.map((t, i) => {
      const x = t.trim().replace(/[.;,!]+$/, "");
      return i === 0 ? x : lowerFirst(x, names);
    });
    if (xs.length <= 1) return xs.join("");
    if (xs.length === 2) return xs[0] + " and " + xs[1];
    return xs.slice(0, -1).join(", ") + ", and " + xs[xs.length - 1];
  }

  function groupItems(g) {
    return String(g.items || "").split("\n").map((s) => s.trim().replace(LIST_MARK, "")).filter(Boolean);
  }

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
    const names = namesIn([st.point, st.situation, st.complication, st.close, st.background]
      .concat(st.support, st.groups.map((g) => g.items + "\n" + g.label)).join("\n"));
    const paras = [];
    const head = [];

    if (m.wwb && st.isEmail && squash(st.subject)) head.push("Subject: " + squash(st.subject));
    if (squash(st.greeting)) head.push(squash(st.greeting));

    const point = tidy(st.point);
    const support = m.mece ? [] : st.support.map(tidy).filter(Boolean);
    let opening = [];
    if (m.scqa) {
      const S = tidy(st.situation);
      const C = tidy(st.complication);
      if (m.inverted) opening = [point, S, C];
      else if (st.order === "sca") opening = [S, C, point];
      else if (st.order === "csa") opening = [C, S, point];
      else opening = [point, S, C];
      opening = opening.filter(Boolean);
    } else {
      opening = point ? [point] : [];
      if (!m.mece && support.length && wordCount(support[0]) <= 30) opening.push(support.shift());
    }
    if (opening.length) paras.push(opening.join(" "));

    if (m.mece) {
      for (const g of st.groups) {
        const items = groupItems(g).map((t) => {
          if (!st.trim) return t;
          const r = applyTrims(t, m.wwb);
          cuts.push(...r.cut);
          return r.text;
        }).filter(Boolean);
        if (!items.length) continue;
        const label = squash(g.label).replace(/[:.\s]+$/, "");
        const asList = g.mode === "list" || (g.mode === "auto" && items.length >= 3);
        if (asList) {
          const lines = items.map((t, i) => (i + 1) + ". " + sentenceCase(t));
          paras.push((label ? label + ":\n" : "") + lines.join("\n"));
        } else {
          const joined = joinItems(items, names);
          paras.push(label ? finish(label + ": " + lowerFirst(joined, names)) : sentenceCase(joined));
        }
      }
    } else {
      paras.push(...support);
    }
    if (m.inverted) {
      const b = tidy(st.background);
      if (b) paras.push(b);
    }
    const close = tidy(st.close);
    if (close) paras.push(close);

    const body = paras.filter(Boolean);
    const blocks = [];
    if (head.length) blocks.push(...head);
    blocks.push(...body);
    if (squash(st.signoff)) blocks.push(st.signoff.trim().replace(/[ \t]+/g, " "));
    return { text: blocks.join("\n\n"), body: body.join("\n\n"), cuts, opening: opening.length };
  }

  // ---------------------------------------------------------------------
  // Measuring
  // ---------------------------------------------------------------------

  const WASTE_CODES = new Set(["W2", "W3", "W4", "D6", "D6m", "D5", "D5m", "D7", "B4"]);
  const FILLER_WORDS = /\b(just|actually|basically|simply|literally|honestly)\b/gi;

  // Bernoff's meaning ratio, estimated: the share of words that aren't stock
  // phrases, intensifiers, weasel words, jargon or mood-only sentences.
  // Greetings and sign-offs count as meaningful, as the skill's guide says.
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
      const core = p.text.replace(/[.!?]+$/, "");
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

  // ---------------------------------------------------------------------
  // The checks, from each method guide's own checklist
  // ---------------------------------------------------------------------

  const MONEY_OR_AMOUNT = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|dollars|bucks|therms|hours?|minutes?|miles?|days?|weeks?|months?|years?|people|gb|kwh|lbs?|pounds|kg)\b/i;
  const COMPARISON = /\b(from|to|than|vs\.?|versus|instead|compared|up|down|more|less|fewer|higher|lower|over|under|last|before|after|per|a (?:month|year|week|day)|every|each|about|like|same|enough|worth|double|half|twice)\b|%/i;
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
  const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "for", "on", "in", "at", "we", "i", "you", "it", "is", "are", "be", "our", "my", "your", "still", "need", "needs", "should", "someone", "anyone", "has", "have", "yet", "also", "new", "get", "for", "with"]);
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
          "Leave them out on purpose, or click them into a slot.", real.map((p) => p.text));
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
      const bare = bodySentences.filter((s) => MONEY_OR_AMOUNT.test(s) && !COMPARISON.test(s.replace(MONEY_OR_AMOUNT, "")));
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

  // Before and after numbers for the scoreboard.
  function compare(draftText, st, parsed) {
    const built = assemble(st);
    const before = tellCount(draftText, st.methods.wwb);
    const after = tellCount(built.text, st.methods.wwb);
    let pointFrom = null;
    if (parsed && squash(st.point)) {
      const p = norm(st.point);
      const hit = parsed.pieces.find((x) => { const n = norm(x.text); return n && (p.includes(n) || n.includes(p)); });
      if (hit) pointFrom = hit.sentence;
    }
    return {
      words: [wordCount(draftText), wordCount(built.text)],
      tells: [before.strong + before.moderate, after.strong + after.moderate],
      ratio: st.methods.wwb ? [meaningRatio(draftText), meaningRatio(built.text)] : null,
      pointFrom,
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
    METHODS, EXAMPLES, TRIMS,
    words, wordCount, splitSentences, splitClauses, parseDraft, describe, listItems,
    emptyState, methodsFrom, suggest, switchMethod, usedPieces,
    applyTrims, assemble, meaningRatio, tellCount, check, compare, slotCopy, overlap,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WorkshopCore = api;
})(typeof window !== "undefined" ? window : this);
