/* Wires the tell scanner (assets/scanner.js) to the page. Everything runs locally. */
(function () {
  "use strict";

  const SAMPLES = {
    before: [
      "Hi Dana,",
      "",
      "I hope this message finds you well! I wanted to reach out to say thank you for watching Biscuit last weekend. Your kindness truly stands as a testament to the vibrant community we've built on Maple Street, highlighting what makes this neighborhood so special.",
      "",
      "It's not just about feeding a dog — it's about trust, generosity, and care. Additionally, the fresh tomatoes you left on the porch were a delightful surprise. Moreover, Biscuit clearly had a wonderful time.",
      "",
      "In summary, we are incredibly grateful. Please don't hesitate to reach out if there's ever anything we can do!",
      "",
      "Best,",
      "Sam",
    ].join("\n"),
    after: [
      "Hi Dana,",
      "",
      "Thanks for watching Biscuit last weekend. He came home tired and happy, and I don't think he missed us once.",
      "",
      "The tomatoes on the porch were a great surprise too. We had them on toast Sunday morning.",
      "",
      "If you ever need someone to grab your mail or water the plants, we're two doors down.",
      "",
      "Best,",
      "Sam",
    ].join("\n"),
  };

  // The scanner's fix notes are written for Claude. A few read better here in the second person.
  const FIX_FOR_PAGE = {
    B5: "Fill it in or delete it.",
    C7: "Replace each one with the plain or specific word.",
    D6m: "Open on the point, or on your own greeting.",
    X1: "One per message is plenty.",
  };

  const GROUPS = [
    ["strong", "Strong", "always fix"],
    ["moderate", "Moderate", "fix unless it's deliberate"],
    ["weak", "Weak", "only counts in a cluster"],
  ];
  const RANK = { strong: 0, moderate: 1, weak: 2 };

  const input = document.getElementById("scan-input");
  const backdrop = document.getElementById("scan-backdrop");
  const wwb = document.getElementById("wwb");
  const summary = document.getElementById("summary");
  const list = document.getElementById("findings");
  const sampleButtons = {
    before: document.getElementById("load-before"),
    after: document.getElementById("load-after"),
  };
  const clearButton = document.getElementById("clear-text");
  if (!input || !window.TellScan) return;

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current = null;

  function esc(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  // Pick non-overlapping spans to highlight, giving stronger hits first claim.
  function highlightSpans(result) {
    const spans = [];
    result.findings.forEach((f, i) => {
      if (typeof f.start === "number" && f.end > f.start) spans.push({ start: f.start, end: f.end, sev: f.severity, i });
      if (f.spans) f.spans.forEach((s) => spans.push({ start: s.start, end: s.end, sev: f.severity, i }));
    });
    spans.sort((a, b) => RANK[a.sev] - RANK[b.sev] || a.start - b.start);
    const kept = [];
    for (const s of spans) {
      if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  function renderBackdrop(text, result) {
    let html = "";
    let pos = 0;
    for (const s of highlightSpans(result)) {
      html += esc(text.slice(pos, s.start));
      html += '<mark class="hl hl-' + s.sev + '" data-i="' + s.i + '">' + esc(text.slice(s.start, s.end)) + "</mark>";
      pos = s.end;
    }
    html += esc(text.slice(pos));
    // A trailing newline needs a character after it to take up a line.
    if (text.endsWith("\n")) html += " ";
    backdrop.innerHTML = html;
  }

  function verdict(c, words) {
    if (!words) return "Paste or type something to scan it.";
    if (c.strong) {
      return plural(c.strong, "strong hit") + ". Fix those first: go back to the specific thing each phrase was standing in for.";
    }
    if (c.moderate) return "No strong hits. Look at the moderate ones and keep any that are deliberate.";
    return "No strong or moderate hits. The scanner only sees patterns, so read it once more for sentences that could be anyone's.";
  }

  function renderSummary(r) {
    const c = r.counts;
    const rh = r.rhythm;
    const tiles = GROUPS.map(([key, name]) =>
      '<div class="tile sev-' + key + (c[key] ? " is-nonzero" : "") + '">' +
      '<span class="tile-n">' + c[key] + "</span>" +
      '<span class="tile-l"><span class="dot" aria-hidden="true"></span>' + name + "</span></div>").join("");

    const stats = [
      ["Words", r.words],
      ["Sentences", rh.sentences || 0],
      ["Strong + moderate per 100 words", r.strong_plus_moderate_per_100_words],
      ["Em dashes", r.punctuation.em_dash],
    ];
    if (rh.sentences) {
      stats.push(["Sentence length", rh.shortest + "–" + rh.longest + " words, mean " + rh.mean]);
      stats.push(["Spread", rh.spread + " (" + rh.in_8_20_band_pct + "% in the 8–20 band)"]);
    }
    const w = r.writing_without_bullshit;
    if (w) {
      stats.push(["Passive voice (candidates)", w.passive_candidates]);
      stats.push(["Weasel words", w.weasel_words]);
      stats.push(["Intensifiers", w.intensifiers]);
      stats.push(["Jargon", w.jargon]);
    }

    summary.innerHTML =
      '<div class="tally">' + tiles + "</div>" +
      '<p class="verdict">' + esc(verdict(c, r.words)) + "</p>" +
      '<dl class="stats">' + stats.map(([k, v]) =>
        "<div><dt>" + esc(k) + "</dt><dd>" + esc(String(v)) + "</dd></div>").join("") + "</dl>";
  }

  function renderFindings(r) {
    if (!r.findings.length) {
      list.innerHTML = r.words ? '<p class="empty">Nothing flagged.</p>' : "";
      return;
    }
    let html = "";
    for (const [key, name, note] of GROUPS) {
      const items = r.findings.map((f, i) => [f, i]).filter(([f]) => f.severity === key);
      if (!items.length) continue;
      html += '<div class="group sev-' + key + '">';
      html += '<p class="group-head"><span class="dot" aria-hidden="true"></span>' + name +
        ' <span class="note">' + note + " (" + items.length + ")</span></p>";
      html += '<ul class="finding-list">';
      for (const [f, i] of items) {
        const located = typeof f.start === "number" || (f.spans && f.spans.length);
        const tag = located ? "button" : "div";
        const attrs = located ? ' type="button" data-i="' + i + '"' : "";
        const fix = FIX_FOR_PAGE[f.code] || f.fix;
        html += "<li>" +
          "<" + tag + ' class="finding"' + attrs + ">" +
          '<span class="code">' + esc(f.code) + "</span>" +
          '<span class="f-body">' +
          '<span class="f-label">' + esc(f.label) + "</span>" +
          '<span class="f-match">' + esc(f.match) + "</span>" +
          '<span class="f-fix">' + esc(fix) + "</span>" +
          (f.line ? '<span class="f-line">Line ' + f.line + "</span>" : "") +
          "</span></" + tag + "></li>";
      }
      html += "</ul></div>";
    }
    list.innerHTML = html;
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
  }

  function run() {
    const text = input.value.replace(/\r\n?/g, "\n");
    current = window.TellScan.scan(text, { wwb: wwb.checked });
    renderBackdrop(text, current);
    renderSummary(current);
    renderFindings(current);
    autosize();
    for (const key of Object.keys(sampleButtons)) {
      sampleButtons[key].setAttribute("aria-pressed", String(text === SAMPLES[key]));
    }
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  }

  function marksFor(i) {
    return backdrop.querySelectorAll('mark[data-i="' + i + '"]');
  }

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("button.finding");
    if (!btn) return;
    const marks = marksFor(btn.dataset.i);
    if (!marks.length) return;
    marks[0].scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    marks.forEach((m) => {
      m.classList.remove("is-flash");
      void m.offsetWidth; // restart the animation
      m.classList.add("is-flash");
    });
  });

  function setHot(e, on) {
    const btn = e.target.closest("button.finding");
    if (!btn) return;
    marksFor(btn.dataset.i).forEach((m) => m.classList.toggle("is-hot", on));
  }
  list.addEventListener("mouseover", (e) => setHot(e, true));
  list.addEventListener("mouseout", (e) => setHot(e, false));
  list.addEventListener("focusin", (e) => setHot(e, true));
  list.addEventListener("focusout", (e) => setHot(e, false));

  sampleButtons.before.addEventListener("click", () => { input.value = SAMPLES.before; run(); });
  sampleButtons.after.addEventListener("click", () => { input.value = SAMPLES.after; run(); });
  clearButton.addEventListener("click", () => { input.value = ""; run(); input.focus(); });
  input.addEventListener("input", schedule);
  wwb.addEventListener("change", run);

  // Wrapping changes with width and once the web fonts arrive.
  window.addEventListener("resize", autosize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(autosize);

  input.value = SAMPLES.before;
  run();
})();
