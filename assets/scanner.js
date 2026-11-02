/*
 * Tell scan, in the browser.
 *
 * A JavaScript port of scripts/tell_scan.py from the Wordsmith Workshop skill.
 * Keep the two in step: same patterns, same thresholds, same severities.
 * The JS version adds character offsets (start/end) to each finding so the
 * page can highlight hits in the text.
 *
 * It catches surface patterns only. It cannot tell whether a sentence is
 * generic, whether synonyms are cycling, or whether an interpretation is
 * earned. It is not an AI detector and its output is never a verdict on
 * authorship.
 */
(function (root) {
  "use strict";

  const R = String.raw;

  // ---------------------------------------------------------------------
  // Pattern table: [code, family, severity, label, regex source, fix]
  // ---------------------------------------------------------------------
  const PATTERNS = [
    // Family A: Inflation
    ["A1", "Inflation", "strong", "Significance / legacy puffing",
      R`\b(testament to|plays? an? (?:vital|crucial|pivotal|key|significant|important|central|integral) role` +
      R`|(?:marks?|marking|marked) (?:a|an|the) (?:pivotal|significant|new|important|turning|major|defining)` +
      R`|stands? as (?:a|an)\b|lasting legacy|enduring legacy|indelible mark|rich tapestry|tapestry of` +
      R`|broader (?:trends?|landscape|context|conversations?|debates?|movement)` +
      R`|continues? to (?:shape|inspire|resonate|influence|define)` +
      R`|(?:ever-evolving|ever-changing|fast-paced) (?:world|landscape|environment)` +
      R`|cultural heritage|deeply rooted|a reminder of the power of|speaks volumes)`,
      "Say what happened and let the reader judge its size."],
    ["A2", "Inflation", "moderate", "Brochure adjective",
      R`\b(vibrant|breathtaking|stunning|nestled|hidden gem|renowned|world-class|must-(?:see|visit|try)` +
      R`|seamless(?:ly)?|cutting-edge|unparalleled|state-of-the-art|commitment to excellence` +
      R`|rich (?:history|heritage|culture|traditions?))\b`,
      "Replace the adjective with the observation that earned it."],
    ["A3", "Inflation", "strong", "Recognition / coverage emphasis",
      R`\b(garner(?:ed|ing|s)? (?:attention|recognition|praise|acclaim|interest|a following)` +
      R`|widely (?:recognized|covered|acclaimed|praised)` +
      R`|has been (?:featured|covered|recognized|profiled|highlighted) (?:in|by)` +
      R`|active (?:social media )?presence` +
      R`|received (?:widespread|significant|considerable) (?:attention|coverage|acclaim|praise))`,
      "Say what the coverage said, or cut it."],
    ["A4", "Inflation", "strong", "'Despite challenges' formula",
      R`(\bdespite (?:its|their|his|her) [^.]{0,80}?\bfaces?\b` +
      R`|\bdespite (?:the|these|those|all the|many|some|our|its|their) (?:challenges|obstacles|setbacks|difficulties|hurdles)\b|\bfaces? (?:several|many|significant|numerous|a number of|ongoing) challenges` +
      R`|\bfuture prospects\b|\blooking ahead,|\bremains to be seen\b|\bonly time will tell\b)`,
      "Name the real problem plainly where it belongs, or drop the ritual."],

    // Family B: Vagueness
    ["B1", "Vagueness", "strong", "Superficial -ing tail",
      R`,\s(highlighting|underscoring|emphasizing|showcasing|reflecting|demonstrating|signaling|signalling` +
      R`|illustrating|cementing|solidifying|reinforcing|ensuring|fostering|contributing to|paving the way` +
      R`|marking|symbolizing|embodying|serving as a)\b`,
      "Delete the tail. If the point is true, give it its own sentence with evidence."],
    ["B2", "Vagueness", "strong", "Vague attribution",
      R`\b(experts? (?:say|believe|note|agree|suggest)|observers (?:say|note|have noted)` +
      R`|critics (?:say|argue|note|have)|many (?:believe|consider|argue|say|feel|agree)` +
      R`|it is widely (?:believed|accepted|regarded|known)|widely regarded` +
      R`|some (?:say|argue|believe|would say)|studies (?:show|suggest|have shown)` +
      R`|research (?:shows|suggests|has shown)|industry (?:reports|observers|experts)` +
      R`|according to (?:many|some|experts))\b`,
      "Name the source or own the opinion ('I think')."],
    ["B3", "Vagueness", "moderate", "Vague connection",
      R`\b(associated with|connected (?:to|with)|linked (?:to|with)|ventured into` +
      R`|began (?:his|her|their|my) career as|has been involved (?:in|with))\b`,
      "State the actual relationship: worked at, founded, taught, married."],
    ["B4", "Vagueness", "strong", "Hedging disclaimer / corrective framing",
      R`\b(it(?:'s|’s| is) (?:important|worth|crucial|essential) (?:to note|noting|to remember|to mention|to keep in mind)` +
      R`|it should be noted|should not be confused with|does not (?:necessarily )?(?:establish|confirm|prove)` +
      R`|not publicly (?:available|documented|disclosed)|maintains? a low profile` +
      R`|keeps? (?:his|her|their) personal (?:life|details) private` +
      R`|should be (?:treated|understood|read|viewed|seen) as [^.]{0,60}? rather than)\b`,
      "Cut the throat-clearing. Keep a real caveat as one plain sentence where it applies."],
    ["B5", "Vagueness", "strong", "Placeholder left in",
      R`(\[(?:[A-Z][A-Za-z' ]{1,30}|insert[^\]]*)\](?!\()|\b20\d\d-XX-XX\b|\bXX/XX\b|\((?:insert[^)]*|add (?:your|link|url|name|date|photo|address)[^)]*)\)` +
      R`|INSERT_[A-Z_]+|\{\{[^}]+\}\}|\bTBD\b|lorem ipsum)`,
      "Fill it or delete it, and tell the user what's missing."],

    // Family C: Mechanical rhythm
    ["C2", "Rhythm", "strong", "Negative parallelism",
      R`(\bnot (?:just|only|merely|simply) [^.;!?]{1,80}?,? but\b` +
      R`|\b(?:it|this|that|he|she|they)(?:'s|’s| is| was| are| were) not (?:just |only |merely |about )?[^.;!?]{1,60}?[,;—-]+ ?(?:it|this|that|he|she|they)(?:'s|’s| is| was| are| were)\b` +
      R`|\b(?:isn't|isn’t|wasn't|wasn’t|aren't|aren’t) (?:just |only |about )?[^.;!?]{1,60}?[,;—-]+ ?(?:it|this|that|he|she|they)(?:'s|’s| is| was| are| were)\b` +
      R`|\b(?:didn't|didn’t|did not|don't|don’t|doesn't|doesn’t|won't|won’t) (?:just|only|merely|simply) [^.;!?]{1,60}?[,;—-]+ ?(?:you|we|i|it|he|she|they)\b` +
      R`|\bno [^.,;!?]{1,30}, no [^.,;!?]{1,30}, just\b` +
      R`|\bless (?:about|a) [^.;!?]{1,40}? (?:and )?more (?:about|a)\b)`,
      "State the positive claim. Keep a real contrast once per piece at most."],
    ["C2x", "Rhythm", "strong", "Negative parallelism across sentences",
      R`\b(?:it|this|that)(?:'s|’s| is| was) not [^.!?]{1,60}[.!?]\s+(?:it|this|that)(?:'s|’s| is| was)\b`,
      "State the positive claim directly."],
    ["C2r", "Rhythm", "weak", "'Rather than' contrast",
      R`\brather than\b`,
      "Fine once. In clusters it reads as a corrective framing."],
    ["C3", "Rhythm", "moderate", "Copula avoidance",
      R`\b(serves? as|served as|serving as|stands? as|stood as|functions? as|acts? as an?|operates? as` +
      R`|represents? (?:a|an|the)|boasts?|boasted|refers to)\b`,
      "Use is, are, or has."],

    // Family D: Packaging
    ["D2", "Packaging", "strong", "Bold-label bullet",
      R`^\s*(?:[-*•●▪–]|\d+[.)])\s*\*\*[^*\n]{1,60}(?:\*\*\s*[:—-]|[:—-]\s*\*\*)`,
      "Use prose, or plain full-sentence list items."],
    ["D5", "Packaging", "strong", "Recap closer",
      R`(?:^|(?<=[.!?]\s)|\n)\s*(In (?:summary|conclusion|sum|essence)|To sum up|All in all)\b`,
      "The point already came first. End on the action or the image."],
    ["D5m", "Packaging", "moderate", "Soft recap opener",
      R`(?:^|(?<=[.!?]\s)|\n)\s*(Overall|Ultimately|At the end of the day|In short),`,
      "Check whether this sentence restates the piece. If so, cut it."],
    ["D6", "Packaging", "strong", "Chatbot residue",
      R`\b(certainly!|absolutely!|great question|i hope this (?:helps|message finds you well|email finds you well|finds you well)` +
      R`|would you like me to|let me know if you(?:'d|’d| would) like (?:me to|any|a)` +
      R`|feel free to (?:reach out|let me know|ask)|(?:please )?(?:don't|don’t|do not) hesitate to (?:reach out|contact|let|ask|call)|happy to help|as an ai\b` +
      R`|i(?:'ve|’ve| have) carefully reviewed|apologi[sz]e for any inconvenience` +
      R`|here(?:'s|’s| is) (?:a|an|the|your) (?:revised|polished|updated|refined|improved) (?:version|draft))`,
      "Cut it. Sound like a person who knows the reader."],
    ["D6m", "Packaging", "moderate", "Stock opener",
      R`\b(i hope you(?:'re|’re| are) (?:doing )?well|i wanted to reach out|i am writing to (?:express|inform|let)` +
      R`|just wanted to (?:quickly )?(?:reach out|touch base|follow up))\b`,
      "Open on the point, or on the user's own greeting."],
    ["D7", "Packaging", "moderate", "Procedural assurance",
      R`\b(while (?:preserving|maintaining|retaining|keeping) (?:the )?(?:original|existing|overall)` +
      R`|ensur(?:e|es|ed|ing) (?:clarity|consistency|accuracy|readability|a seamless)` +
      R`|for (?:clarity|readability) and (?:flow|consistency|concision))\b`,
      "Say concretely what changed."],

    // Plain-verb swaps (from 'signs of human writing')
    ["H1", "Plain verbs", "weak", "Stiff verb",
      R`\b(utiliz(?:e|es|ed|ing|ation)|commenc(?:e|es|ed|ing)|facilitat(?:e|es|ed|ing)` +
      R`|endeavou?r(?:s|ed)?|prior to|relocat(?:e|ed|ing)|authored|in regards? to)\b`,
      "Use the plain verb: use, start, help, try, before, move, wrote, about."],
  ];

  const TRANSITIONS = R`(Additionally|Moreover|Furthermore|Notably|Consequently|Importantly|Indeed|Thus|Hence)\b`;

  const VOCAB_DISTINCTIVE = {
    "delve": R`delv(?:e|es|ed|ing)`, "tapestry": R`tapestr(?:y|ies)`, "testament": R`testaments?`,
    "pivotal": R`pivotal`, "underscore": R`underscor(?:e|es|ed|ing)`, "intricate": R`intricate(?:ly)?|intricac(?:y|ies)`,
    "interplay": R`interplay`, "meticulous": R`meticulous(?:ly)?`, "garner": R`garner(?:s|ed|ing)?`,
    "boast": R`boast(?:s|ed|ing)?`, "bolster": R`bolster(?:s|ed|ing)?`, "vibrant": R`vibrant`,
    "enduring": R`enduring`, "showcase": R`showcas(?:e|es|ed|ing)`, "foster": R`foster(?:s|ed|ing)?`,
    "multifaceted": R`multifaceted`, "leverage": R`leverag(?:e|es|ed|ing)`, "quietly": R`quietly`,
    "universally": R`universally`, "align with": R`align(?:s|ed)? with`, "emphasizing": R`emphasizing`,
    "highlighting": R`highlighting`, "echoed": R`echoed`, "dependable": R`dependable`,
    "prioritize": R`prioritiz(?:e|es|ed|ing)`, "causal": R`causal`, "empirical": R`empirical(?:ly)?`,
    "correlate": R`correlat(?:e|es|ed|ing)`,
  };
  const VOCAB_COMMON = {
    "crucial": R`crucial`, "key (adj)": R`key(?= (?:role|step|part|factor|aspect|takeaway|insight|component|element|point|moment))`,
    "valuable": R`valuable`, "enhance": R`enhanc(?:e|es|ed|ing)`, "challenge": R`challeng(?:e|es)`,
    "clearer": R`clearer`, "practical": R`practical`, "matters": R`matters`, "steady": R`steady`,
    "landscape": R`landscape`,
  };
  const VOCAB_OTHER = {
    "journey": R`journey`, "navigate": R`navigat(?:e|es|ed|ing)`, "realm": R`realms?`,
    "resonate": R`resonat(?:e|es|ed|ing)`, "embark": R`embark(?:s|ed|ing)?`, "ever-evolving": R`ever-evolving`,
    "game-changer": R`game-?changer`, "unlock": R`unlock(?:s|ed|ing)?`, "elevate": R`elevat(?:e|es|ed|ing)`,
    "holistic": R`holistic`, "robust": R`robust`, "transformative": R`transformative`,
    "circle back": R`circle back`, "streamline": R`streamlin(?:e|es|ed|ing)`, "synergy": R`synerg(?:y|ies)`,
    "load-bearing": R`load-bearing`, "honestly": R`honestly`,
  };

  // Writing Without Bullshit (Josh Bernoff) checks, only with the wwb option.
  const WWB_PASSIVE = R`\b(?:am|is|are|was|were|be|been|being|get|gets|got|gotten|getting)\s+(?:\w+ly\s+)?` +
    R`(\w+ed|built|made|done|given|taken|seen|sent|paid|told|found|left|kept|held|brought|bought|` +
    R`caught|taught|known|shown|written|broken|chosen|driven|forgotten|hidden|stolen|spoken|sold|` +
    R`lost|won|hit|hurt|shut|put|set|cut|charged|billed|returned|received)\b(?:\s+by\b)?`;
  const WWB_NOT_PASSIVE = new Set(["tired", "interested", "excited", "worried", "scared", "married", "engaged", "supposed",
    "used", "allowed", "located", "based", "involved", "concerned", "bored", "pleased",
    "surprised", "confused", "disappointed", "relieved", "thrilled", "amazed", "stressed",
    "exhausted", "prepared", "finished", "done", "set", "related", "required", "needed",
    "closed", "opened", "booked", "packed", "parked", "scheduled", "retired", "divorced"]);
  const WWB_WEASEL = R`\b(most|many|few|several|various|numerous|countless|rarely|often|seldom|millions of|` +
    R`thousands of|hundreds of|a number of|a lot of|lots of|tons of|cheap|significant(?:ly)?|` +
    R`substantial(?:ly)?|considerable|considerably)\b`;
  const WWB_INTENSIFIER = R`\b(very|really|incredibly|truly|deeply|extremely|totally|absolutely|highly|hugely|` +
    R`super|so so|insanely|unbelievably)\b`;
  const WWB_JARGON = R`\b(bandwidth|circle back|action items?|deliverables?|touch base|going forward|` +
    R`low-hanging fruit|loop (?:you|me|them|him|her) in|synergy|leverage|per my last email|` +
    R`at your earliest convenience|please be advised|as per|moving forward|reach out)\b`;

  const EMOJI = R`[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}]`;
  const PRONOUN_STARTS = new Set(["you", "me", "us", "him", "her", "them", "it", "i", "we", "anything", "everything",
    "something", "thanks", "thank", "hi", "hey", "dear", "yes", "no", "ok", "okay", "well", "so"]);
  // Subject lines, greetings and sign-offs are frame, not prose; keep them out of rhythm stats.
  const FRAME_LINE = new RegExp(R`^(?:(?:subject|re|fwd?):.*|(?:hi|hey|hello|dear|good morning)\b[^.!?]{0,40}[,!]?|(?:thanks|thank you|thanks again|best|best regards|kind regards|regards|cheers|sincerely|warmly|love)[,.!]?|[A-Z][a-z]+(?: [A-Z][a-z]+)?)$`, "i");
  const SMALL_WORDS = new Set(["a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "at", "by",
    "vs", "as", "from", "into", "is", "nor", "so", "yet"]);

  const SEVERITY_ORDER = { strong: 0, moderate: 1, weak: 2 };

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  // Python's round(): nearest, with exact ties going to the even neighbour.
  function pyRound(x, n) {
    const m = Math.pow(10, n || 0);
    const y = x * m;
    const f = Math.floor(y);
    const diff = y - f;
    let r;
    if (diff === 0.5) r = (f % 2 === 0) ? f : f + 1;
    else r = Math.round(y);
    return r / m;
  }

  function findAll(src, flags, text) {
    const rx = new RegExp(src, flags.includes("g") ? flags : flags + "g");
    return Array.from(text.matchAll(rx));
  }

  function lineOf(text, idx) {
    let n = 1;
    for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  // Python counts characters by code point; JS strings count UTF-16 units.
  // These step by code point so an emoji counts as one character, as in Python.
  function isHigh(c) { return c >= 0xD800 && c <= 0xDBFF; }
  function isLow(c) { return c >= 0xDC00 && c <= 0xDFFF; }
  function stepBack(text, i, n) {
    while (n > 0 && i > 0) {
      i--;
      if (i > 0 && isLow(text.charCodeAt(i)) && isHigh(text.charCodeAt(i - 1))) i--;
      n--;
    }
    return i;
  }
  function stepForward(text, i, n) {
    while (n > 0 && i < text.length) {
      const c = text.charCodeAt(i);
      i += (isHigh(c) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) ? 2 : 1;
      n--;
    }
    return i;
  }

  function snippet(text, start, end, pad) {
    pad = pad === undefined ? 35 : pad;
    const a = stepBack(text, start, pad);
    const b = stepForward(text, end, pad);
    let s = text.slice(a, b).split("\n").join(" ");
    s = s.replace(/\s+/g, " ").trim();
    return (a > 0 ? "..." : "") + s + (b < text.length ? "..." : "");
  }

  function wordsIn(s) {
    return s.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
  }

  // Offsets of a match with surrounding whitespace trimmed, to mirror .strip().
  function trimmedSpan(m) {
    const raw = m[0];
    const lead = raw.length - raw.replace(/^\s+/, "").length;
    const trimmed = raw.trim();
    return { start: m.index + lead, end: m.index + lead + trimmed.length, text: trimmed };
  }

  function proseLines(text) {
    const out = [];
    for (const ln of text.split("\n")) {
      let raw = ln.trim();
      if (!raw || raw.startsWith("#") || raw.startsWith(">") || raw.startsWith("|") || FRAME_LINE.test(raw)) {
        out.push("");
        continue;
      }
      raw = raw.replace(/^(?:[-*•]|\d+[.)])\s+/, "");
      raw = raw.split("**").join("");
      out.push(raw);
    }
    return out.join("\n");
  }

  function sentences(text) {
    const body = proseLines(text);
    const chunks = body.split(/\n\s*\n|\n/);
    const sents = [];
    for (let ch of chunks) {
      ch = ch.trim();
      if (!ch) continue;
      const parts = ch.split(/(?<=[.!?])["'”’)]?\s+(?=["'“‘(]?[A-Z0-9])/);
      for (let p of parts) {
        p = p.trim();
        if (wordsIn(p).length >= 1) sents.push(p);
      }
    }
    return sents;
  }

  function mean(xs) {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  function pstdev(xs) {
    const mu = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - mu) * (x - mu), 0) / xs.length);
  }

  function count(text, ch) {
    return text.split(ch).length - 1;
  }

  // -------------------------------------------------------------------
  // The scan
  // -------------------------------------------------------------------

  function scan(text, options) {
    const wwb = !!(options && options.wwb);
    text = String(text || "").replace(/\r\n?/g, "\n");
    const findings = [];
    const totalWords = wordsIn(text).length;

    for (const [code, fam, sev, label, src, fix] of PATTERNS) {
      const flags = (code === "D5" || code === "D5m") ? "m" : "im";
      for (const m of findAll(src, flags, text)) {
        const span = trimmedSpan(m);
        findings.push({
          code, family: fam, severity: sev, label,
          line: lineOf(text, m.index), match: span.text,
          context: snippet(text, m.index, m.index + m[0].length), fix,
          start: span.start, end: span.end,
        });
      }
    }

    // Triplets: "X, Y, and Z" with exactly three items.
    // Oxford-comma lists may have short multi-word items; without the Oxford
    // comma only single-word items count, which avoids clause-chain false hits.
    const w = R`[\w'’-]+`;
    const tripSrcs = [
      R`\b(` + w + R`(?: ` + w + R`){0,2}), (` + w + R`(?: ` + w + R`){0,2}), (?:and|or) (` + w + R`(?: ` + w + R`){0,2})`,
      R`\b(` + w + R`), (` + w + R`) (?:and|or) (` + w + R`)\b`,
    ];
    const seen = [];
    const triplets = [];
    for (const src of tripSrcs) {
      for (const m of findAll(src, "", text)) {
        const before = text.slice(Math.max(0, m.index - 2), m.index);
        if (before.endsWith(", ") || seen.some((s) => Math.abs(m.index - s) < 40)) continue;
        const g1 = m[1].trim().split(/\s+/);
        const g3 = m[3].trim().split(/\s+/);
        const first = g1[0].toLowerCase();
        const last = g3[g3.length - 1].toLowerCase();
        // Direct address ("Thank you, Marcus and Jen") and "X or not" asides aren't lists.
        if ((g1.length === 1 && PRONOUN_STARTS.has(first)) || last === "not") continue;
        seen.push(m.index);
        triplets.push(m);
      }
    }
    const rate = totalWords ? triplets.length / totalWords * 100 : 0;
    const tripSev = (triplets.length >= 2 && rate >= 0.4) ? "moderate" : "weak";
    for (const m of triplets) {
      const span = trimmedSpan(m);
      findings.push({
        code: "C1", family: "Rhythm", severity: tripSev, label: "Rule of three",
        line: lineOf(text, m.index), match: span.text,
        context: snippet(text, m.index, m.index + m[0].length),
        fix: "Count what's true. Two strong items beat three padded ones.",
        start: span.start, end: span.end,
      });
    }

    // Transitions at sentence start
    const trans = findAll(R`(?:^|(?<=[.!?]\s)|\n)\s*` + TRANSITIONS, "m", text);
    const transSev = trans.length >= 2 ? "moderate" : "weak";
    for (const m of trans) {
      const start = m.index + m[0].length - m[1].length;
      findings.push({
        code: "C8", family: "Rhythm", severity: transSev, label: "Formulaic transition",
        line: lineOf(text, m.index), match: m[1],
        context: snippet(text, m.index, m.index + m[0].length),
        fix: "Cut the transition word; the sentence usually stands on its own.",
        start, end: start + m[1].length,
      });
    }

    // Em dashes
    const dashes = findAll(R`—|\s--\s|\s–\s`, "", text);
    const spaced = dashes.filter((d) => /^\s/.test(d[0]) || (d.index > 0 && text[d.index - 1] === " "));
    const dashRate = totalWords ? dashes.length / totalWords * 100 : 0;
    if (dashes.length) {
      const sev = (dashRate > 0.67 || spaced.length) ? "moderate" : "weak";
      for (const d of dashes) {
        const span = trimmedSpan(d);
        findings.push({
          code: "C6", family: "Rhythm", severity: sev, label: "Em dash",
          line: lineOf(text, d.index), match: span.text,
          context: snippet(text, d.index, d.index + d[0].length),
          fix: "Pick the punctuation that fits: comma, colon, parentheses, or a new sentence.",
          start: span.start, end: span.end,
        });
      }
    }

    // Bold overuse
    const bolds = text.match(/\*\*[^*\n]+\*\*/g) || [];
    if (bolds.length > 2) {
      findings.push({
        code: "D1", family: "Packaging", severity: "moderate", label: "Bold overuse",
        line: 0, match: bolds.length + " bold spans",
        context: bolds.slice(0, 6).map((b) => b.replace(/^\*+|\*+$/g, "")).join(", "),
        fix: "No bold in personal prose, or one item the reader can't miss.",
      });
    }

    // Title case headings
    for (const m of findAll(R`^#{1,6}\s+(.+)$`, "m", text)) {
      const hw = wordsIn(m[1]);
      const rest = hw.slice(1).filter((x) => !SMALL_WORDS.has(x.toLowerCase()));
      if (rest.length >= 2 && rest.every((x) => /[A-Z]/.test(x[0]))) {
        const span = trimmedSpan(m);
        findings.push({
          code: "D3", family: "Packaging", severity: "moderate", label: "Title Case heading",
          line: lineOf(text, m.index), match: m[1].trim(),
          context: span.text, fix: "Use sentence case, or drop the heading.",
          start: span.start, end: span.end,
        });
      }
    }

    // Emoji
    for (const m of findAll(R`^\s*(?:[-*•]\s*)?(?:#+\s*)?` + EMOJI, "mu", text)) {
      const span = trimmedSpan(m);
      findings.push({
        code: "D4", family: "Packaging", severity: "moderate", label: "Emoji as formatting",
        line: lineOf(text, m.index), match: span.text,
        context: snippet(text, m.index, m.index + m[0].length), fix: "Remove it.",
        start: span.start, end: span.end,
      });
    }

    // Exclamation points
    const excl = count(text, "!");
    if (excl > 2 && totalWords < 250) {
      findings.push({
        code: "X1", family: "Voice", severity: "weak", label: "Exclamation points",
        line: 0, match: excl + " exclamation points",
        context: "", fix: "The user's voice runs about one per message.",
      });
    }

    // Vocabulary
    const vocabSpans = [];
    function vocabHits(table) {
      const hits = {};
      for (const [name, src] of Object.entries(table)) {
        const ms = findAll(R`\b(?:` + src + R`)\b`, "i", text);
        if (ms.length) {
          hits[name] = ms.length;
          for (const m of ms) vocabSpans.push({ start: m.index, end: m.index + m[0].length });
        }
      }
      return hits;
    }
    const vDist = vocabHits(VOCAB_DISTINCTIVE);
    const vCommon = vocabHits(VOCAB_COMMON);
    const vOther = vocabHits(VOCAB_OTHER);
    const nDist = Object.keys(vDist).length;
    const nCommon = Object.keys(vCommon).length;
    const nOther = Object.keys(vOther).length;
    const distinctTotal = nDist + nCommon + nOther;
    const vocabCluster = (nDist + nOther >= 2) || distinctTotal >= 4;
    if (distinctTotal) {
      const merged = Object.assign({}, vDist, vOther, vCommon);
      findings.push({
        code: "C7", family: "Rhythm",
        severity: vocabCluster ? "strong" : "weak",
        label: "AI vocabulary" + (vocabCluster ? " cluster" : ""),
        line: 0,
        match: Object.entries(merged).map(([k, v]) => (v > 1 ? k + " (" + v + ")" : k)).join(", "),
        context: "", fix: "Replace each with the plain or specific word. See ai-tells.md section 7.",
        spans: vocabSpans,
      });
    }

    // Rhythm
    const sents = sentences(text);
    const lens = sents.map((s) => wordsIn(s).length);
    const rhythm = { sentences: lens.length };
    if (lens.length) {
      rhythm.mean = pyRound(mean(lens), 1);
      rhythm.spread = lens.length > 1 ? pyRound(pstdev(lens), 1) : 0.0;
      rhythm.shortest = Math.min.apply(null, lens);
      rhythm.longest = Math.max.apply(null, lens);
      rhythm.in_8_20_band_pct = pyRound(100 * lens.filter((n) => n >= 8 && n <= 20).length / lens.length, 0);
      if (lens.length >= 6 && rhythm.spread < 4.5 && rhythm.in_8_20_band_pct >= 75) {
        findings.push({
          code: "C5", family: "Rhythm", severity: "moderate", label: "Uniform sentence length",
          line: 0,
          match: "spread " + rhythm.spread + " words, " + rhythm.in_8_20_band_pct + "% of sentences in the 8-20 band",
          context: "", fix: "Vary on purpose: a short punch after a long sentence, a question, a fragment.",
        });
      }
      sents.forEach((s, i) => {
        const n = lens[i];
        if (n > 40) {
          const chars = Array.from(s);
          findings.push({
            code: "R1", family: "Rhythm", severity: "weak", label: "Long sentence (" + n + " words)",
            line: 0, match: chars.slice(0, 80).join("") + (chars.length > 80 ? "..." : ""),
            context: "", fix: "Check whether it splits cleanly.",
          });
        }
      });
    }

    // Punctuation variety
    const punct = {
      comma: count(text, ","), period: (text.match(/\.(?!\.)/g) || []).length,
      semicolon: count(text, ";"), colon: (text.match(/:(?!\))/g) || []).length,
      parens: count(text, "("), question: count(text, "?"),
      exclamation: excl, em_dash: dashes.length,
    };
    const varied = punct.semicolon + punct.colon + punct.parens + punct.question + punct.em_dash;
    if (totalWords >= 150 && varied === 0) {
      findings.push({
        code: "C5p", family: "Rhythm", severity: "moderate", label: "Flat punctuation",
        line: 0, match: "only commas and periods across the piece",
        context: "", fix: "Where it fits, use a colon, a question, or a parenthetical aside.",
      });
    }

    let wwbCounts = null;
    if (wwb) {
      wwbCounts = { passive_candidates: 0, weasel_words: 0, intensifiers: 0, jargon: 0 };
      for (const m of findAll(WWB_PASSIVE, "i", text)) {
        if (WWB_NOT_PASSIVE.has(m[1].toLowerCase())) continue;
        wwbCounts.passive_candidates += 1;
        const span = trimmedSpan(m);
        findings.push({
          code: "W1", family: "WWB", severity: "moderate", label: "Passive voice (candidate)",
          line: lineOf(text, m.index), match: span.text,
          context: snippet(text, m.index, m.index + m[0].length),
          fix: "Ask who acts and make them the subject. Keep it only if the actor truly doesn't matter.",
          start: span.start, end: span.end,
        });
      }
      const weasels = findAll(WWB_WEASEL, "i", text);
      wwbCounts.weasel_words = weasels.length;
      const wSev = (weasels.length >= 3 || (totalWords && weasels.length / totalWords * 100 >= 1)) ? "moderate" : "weak";
      for (const m of weasels) {
        findings.push({
          code: "W2", family: "WWB", severity: wSev, label: "Weasel word",
          line: lineOf(text, m.index), match: m[0],
          context: snippet(text, m.index, m.index + m[0].length),
          fix: "Replace with a number, a name, or a plain committed claim. Keep it if it's literally true and specific enough.",
          start: m.index, end: m.index + m[0].length,
        });
      }
      for (const m of findAll(WWB_INTENSIFIER, "i", text)) {
        wwbCounts.intensifiers += 1;
        findings.push({
          code: "W3", family: "WWB", severity: "moderate", label: "Intensifier",
          line: lineOf(text, m.index), match: m[0],
          context: snippet(text, m.index, m.index + m[0].length),
          fix: "Cut it, or replace it with the fact that justified it.",
          start: m.index, end: m.index + m[0].length,
        });
      }
      for (const m of findAll(WWB_JARGON, "i", text)) {
        wwbCounts.jargon += 1;
        findings.push({
          code: "W4", family: "WWB", severity: "moderate", label: "Jargon / stock phrase",
          line: lineOf(text, m.index), match: m[0],
          context: snippet(text, m.index, m.index + m[0].length),
          fix: "Say it the way you'd say it out loud to this person.",
          start: m.index, end: m.index + m[0].length,
        });
      }
      if (totalWords > 250) {
        findings.push({
          code: "W5", family: "WWB", severity: "moderate", label: "Over 250 words",
          line: 0, match: totalWords + " words",
          context: "", fix: "Bernoff's ceiling for email. Cut, or confirm the length is truly needed (a toast with a set length is exempt).",
        });
      }
    }

    findings.sort((a, b) =>
      (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
      (a.line - b.line) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

    const counts = { strong: 0, moderate: 0, weak: 0 };
    for (const f of findings) counts[f.severity] += 1;
    const density = totalWords ? pyRound((counts.strong + counts.moderate) / totalWords * 100, 2) : 0;

    return {
      words: totalWords,
      counts,
      strong_plus_moderate_per_100_words: density,
      rhythm,
      punctuation: punct,
      em_dash_per_100_words: pyRound(dashRate, 2),
      vocabulary: { distinctive: vDist, common: vCommon, other: vOther },
      writing_without_bullshit: wwbCounts,
      findings,
    };
  }

  const api = { scan };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TellScan = api;
})(typeof window !== "undefined" ? window : this);
