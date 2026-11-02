/* The workshop on the page: wires assets/workshop-core.js to the DOM. Runs locally. */
(function () {
  "use strict";

  const W = window.WorkshopCore;
  const TellScan = window.TellScan;
  const root = document.getElementById("ws");
  if (!root || !W || !TellScan) return;
  root.hidden = false;

  const $ = (id) => document.getElementById(id);
  const draftEl = $("ws-draft");
  const draftMeta = $("ws-draft-meta");
  const chipsEl = $("ws-chips");
  const trayHint = $("ws-tray-hint");
  const targetEl = $("ws-target");
  const slotsEl = $("ws-slots");
  const preview = $("ws-preview");
  const scoreEl = $("ws-score");
  const cutsEl = $("ws-cuts");
  const checksEl = $("ws-checks");
  const statusEl = $("ws-status");
  const fillBtn = $("ws-fill");
  const undoBtn = $("ws-undo");
  const copyBtn = $("ws-copy");
  const toScanner = $("ws-to-scanner");
  const trimEl = $("ws-trim");
  const methodInputs = Array.from(root.querySelectorAll("input[data-method]"));
  const exampleButtons = Array.from(root.querySelectorAll("[data-example]:not([data-example='clear'])"));
  const pressExample = (key) => exampleButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.example === key)));
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const METHOD_NAMES = {
    pyramid: "Pyramid", scqa: "SCQA", mece: "MECE", inverted: "Inverted Pyramid",
    wwb: "Writing Without Bullshit", data: "Storytelling with Data", audit: "Tell audit",
  };
  const STATUS_TEXT = { warn: "Fix", info: "Tip", self: "Ask yourself", pass: "Done" };
  const FIX_FOR_PAGE = {
    B5: "Fill it in or delete it.",
    C7: "Replace each one with the plain or specific word.",
    D6m: "Open on the point, or on your own greeting.",
  };

  let state = W.emptyState();
  let parsed = W.parseDraft("");
  let undoState = null;
  let active = { field: "point", index: 0 };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function say(msg) {
    statusEl.textContent = "";
    setTimeout(() => { statusEl.textContent = msg; }, 30);
  }
  function grow(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }

  // ---------------------------------------------------------------------
  // Slots
  // ---------------------------------------------------------------------

  function ownerOf(field) {
    const m = state.methods;
    if (field === "point") return m.inverted ? "inverted" : m.scqa ? "scqa" : m.data ? "data" : "pyramid";
    if (field === "situation" || field === "complication" || field === "order") return "scqa";
    if (field === "groups" || field === "rule") return "mece";
    if (field === "background") return "inverted";
    if (field === "subject") return "wwb";
    return "pyramid";
  }

  function slotHead(id, label, field, hint) {
    const owner = ownerOf(field);
    return '<div class="slot-head"><label class="slot-label" for="' + id + '">' + esc(label) + "</label>" +
      (field === "greeting" || field === "signoff" ? "" : '<span class="slot-owner m-' + owner + '">' + esc(METHOD_NAMES[owner]) + "</span>") +
      "</div>" + (hint ? '<p class="slot-hint" id="' + id + '-hint">' + esc(hint) + "</p>" : "");
  }

  function textSlot(field, copy, rows, extraClass) {
    const id = "ws-" + field;
    return '<div class="slot ' + (extraClass || "") + '" data-slot="' + field + '">' +
      slotHead(id, copy.label, field, copy.hint) +
      '<textarea class="slot-input" id="' + id + '" data-field="' + field + '" rows="' + (rows || 2) + '"' +
      (copy.hint ? ' aria-describedby="' + id + '-hint"' : "") +
      ' placeholder="' + esc("Example: " + copy.example) + '"></textarea></div>';
  }

  function renderSlots() {
    const m = state.methods;
    const copy = W.slotCopy(m);
    let html = "";
    html += '<div class="slot-row">' + textSlot("greeting", copy.greeting, 1, "slot-small") + "</div>";

    if (m.wwb) {
      html += '<div class="slot" data-slot="subject"><label class="toggle"><input type="checkbox" id="ws-is-email"' +
        (state.isEmail ? " checked" : "") + "><span>This is an email</span></label>" +
        (state.isEmail ? textSlot("subject", copy.subject, 1) : "") + "</div>";
    }

    const opening = [];
    const pointSlot = textSlot("point", copy.point, 2, "slot-point");
    if (m.scqa) {
      const S = textSlot("situation", copy.situation, 2);
      const C = textSlot("complication", copy.complication, 2);
      const order = m.inverted ? "asc" : state.order;
      if (order === "sca") opening.push(S, C, pointSlot);
      else if (order === "csa") opening.push(C, S, pointSlot);
      else opening.push(pointSlot, S, C);
    } else {
      opening.push(pointSlot);
    }
    if (m.scqa && !m.inverted) {
      const opts = [["asc", "Answer first", "busy readers"], ["sca", "Situation first", "needs grounding"], ["csa", "Problem first", "urgent"]];
      html += '<fieldset class="slot slot-order"><legend class="slot-label">Opening order <span class="slot-owner m-scqa">SCQA</span></legend><div class="ws-radios">' +
        opts.map(([v, l, d]) => '<label class="ws-radio"><input type="radio" name="ws-order" value="' + v + '"' +
          (state.order === v ? " checked" : "") + "><span>" + l + ' <small>' + d + "</small></span></label>").join("") +
        "</div></fieldset>";
    }
    html += '<div class="ws-opening">' + opening.join("") + "</div>";

    if (m.mece) {
      html += '<div class="slot" data-slot="groups"><div class="slot-head"><span class="slot-label">' + esc(copy.groups.label) +
        '</span><span class="slot-owner m-mece">MECE</span></div><p class="slot-hint" id="ws-groups-hint">' + esc(copy.groups.hint) + "</p>" +
        '<label class="slot-sublabel" for="ws-rule">' + esc(copy.rule.label) + "</label>" +
        '<input class="slot-input" id="ws-rule" data-field="rule" list="ws-rules" aria-describedby="ws-groups-hint" placeholder="Example: By person">' +
        '<datalist id="ws-rules"><option value="By person"><option value="By time"><option value="Settled vs. still needed"><option value="By option"><option value="By cost"></datalist>' +
        '<ol class="ws-groups">' + state.groups.map((g, i) => groupHtml(g, i)).join("") + "</ol>" +
        '<button type="button" class="btn btn-small" data-action="add-group">Add a group</button></div>';
    } else {
      const c = copy.support;
      html += '<div class="slot" data-slot="support">' + slotHead("ws-support-0", c.label, "support", c.hint) +
        '<ol class="ws-items">' + state.support.map((t, i) => itemHtml(i, c)).join("") + "</ol>" +
        '<button type="button" class="btn btn-small" data-action="add-item">Add a line</button></div>';
    }
    if (m.inverted) html += textSlot("background", copy.background, 2);
    html += textSlot("close", copy.close, 2);
    html += '<div class="slot-row">' + textSlot("signoff", copy.signoff, 2, "slot-small") + "</div>";
    slotsEl.innerHTML = html;

    // Values go in as properties, never as HTML.
    slotsEl.querySelectorAll("[data-field]").forEach((el) => {
      const f = el.dataset.field;
      const i = Number(el.dataset.index || 0);
      if (f === "support") el.value = state.support[i] || "";
      else if (f === "group-label") el.value = state.groups[i].label;
      else if (f === "group-items") el.value = state.groups[i].items;
      else if (f === "group-mode") el.value = state.groups[i].mode;
      else el.value = state[f] || "";
      if (el.tagName === "TEXTAREA") grow(el);
    });
    syncTarget();
  }

  function itemHtml(i, c) {
    const id = "ws-support-" + i;
    const n = state.support.length;
    return '<li class="ws-item"><label class="sr-only" for="' + id + '">' + esc(c.label) + ", line " + (i + 1) + "</label>" +
      '<textarea class="slot-input" id="' + id + '" data-field="support" data-index="' + i + '" rows="2"' +
      (i === 0 ? ' aria-describedby="ws-support-0-hint"' : "") + ' placeholder="' + esc(i === 0 ? "Example: " + c.example : "") + '"></textarea>' +
      '<span class="ws-item-tools">' +
      '<button type="button" class="icon-btn" data-action="up" data-index="' + i + '" aria-label="Move line ' + (i + 1) + ' up"' + (i === 0 ? " disabled" : "") + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6l-6 7h12z"/></svg></button>' +
      '<button type="button" class="icon-btn" data-action="down" data-index="' + i + '" aria-label="Move line ' + (i + 1) + ' down"' + (i === n - 1 ? " disabled" : "") + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18l6-7H6z"/></svg></button>' +
      '<button type="button" class="icon-btn" data-action="remove" data-index="' + i + '" aria-label="Remove line ' + (i + 1) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5L12 10.5 17.5 5 19 6.5 13.5 12l5.5 5.5-1.5 1.5-5.5-5.5L6.5 19 5 17.5 10.5 12 5 6.5z"/></svg></button>' +
      "</span></li>";
  }

  function groupHtml(g, i) {
    const n = i + 1;
    return '<li class="ws-group">' +
      '<div class="ws-group-head"><label class="sr-only" for="ws-glabel-' + i + '">Group ' + n + ' name</label>' +
      '<input class="slot-input ws-group-label" id="ws-glabel-' + i + '" data-field="group-label" data-index="' + i + '" placeholder="Group ' + n + ' name, like Ana or Settled">' +
      '<label class="sr-only" for="ws-gmode-' + i + '">Group ' + n + ' shows as</label>' +
      '<select class="ws-select" id="ws-gmode-' + i + '" data-field="group-mode" data-index="' + i + '">' +
      '<option value="auto">Auto</option><option value="sentence">A sentence</option><option value="list">A numbered list</option></select>' +
      '<button type="button" class="icon-btn" data-action="remove-group" data-index="' + i + '" aria-label="Remove group ' + n + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5L12 10.5 17.5 5 19 6.5 13.5 12l5.5 5.5-1.5 1.5-5.5-5.5L6.5 19 5 17.5 10.5 12 5 6.5z"/></svg></button></div>' +
      '<label class="sr-only" for="ws-gitems-' + i + '">Group ' + n + " items, one per line</label>" +
      '<textarea class="slot-input" id="ws-gitems-' + i + '" data-field="group-items" data-index="' + i + '" rows="3" placeholder="One item per line"></textarea></li>';
  }

  function labelFor(target) {
    const copy = W.slotCopy(state.methods);
    if (target.field === "support") return state.methods.inverted ? "Details" : "What backs it up";
    if (target.field === "group-items" || target.field === "group-label") {
      const g = state.groups[target.index];
      return g && g.label.trim() ? "the " + g.label.trim() + " group" : "group " + (target.index + 1);
    }
    return (copy[target.field] && copy[target.field].label) || "Your point";
  }

  function syncTarget() {
    const exists = (t) => {
      if (t.field === "support") return !state.methods.mece && t.index < state.support.length;
      if (t.field === "group-items" || t.field === "group-label") return state.methods.mece && t.index < state.groups.length;
      if (t.field === "situation" || t.field === "complication") return state.methods.scqa;
      if (t.field === "background") return state.methods.inverted;
      if (t.field === "subject") return state.methods.wwb && state.isEmail;
      return ["point", "close", "greeting", "signoff"].includes(t.field);
    };
    if (!exists(active)) active = { field: "point", index: 0 };
    if (active.field === "group-label") active = { field: "group-items", index: active.index };
    targetEl.textContent = labelFor(active);
  }

  // ---------------------------------------------------------------------
  // The draft and its sentences
  // ---------------------------------------------------------------------

  function renderChips() {
    if (!parsed.pieces.length) {
      chipsEl.innerHTML = "";
      trayHint.hidden = true;
      return;
    }
    trayHint.hidden = false;
    chipsEl.innerHTML = parsed.pieces.map((p) => {
      const f = p.flags;
      const tag = f.filler ? '<span class="ws-chip-tag">' + esc(f.filler) + "</span>" : "";
      return '<li><button type="button" class="ws-chip' + (f.filler ? " is-filler" : "") + '" data-piece="' + p.id + '">' +
        '<span class="ws-chip-text">' + esc(p.text) + "</span>" + tag +
        '<span class="sr-only ws-chip-state"></span></button></li>';
    }).join("");
    syncChips();
  }

  function syncChips() {
    const used = W.usedPieces(state, parsed);
    chipsEl.querySelectorAll(".ws-chip").forEach((b) => {
      const on = used.has(b.dataset.piece);
      b.classList.toggle("is-used", on);
      const p = parsed.pieces.find((x) => x.id === b.dataset.piece);
      b.querySelector(".ws-chip-state").textContent =
        (on ? " (in use)" : "") + (p && p.flags.filler ? " (likely filler)" : "");
    });
  }

  function renderDraftMeta() {
    const text = draftEl.value;
    const n = W.wordCount(text);
    if (!n) { draftMeta.textContent = ""; return; }
    const t = W.tellCount(text, state.methods.wwb);
    const bits = [n + (n === 1 ? " word" : " words"), parsed.pieces.length + (parsed.pieces.length === 1 ? " sentence" : " sentences")];
    const tells = t.strong + t.moderate;
    bits.push(tells + (tells === 1 ? " tell" : " tells"));
    draftMeta.textContent = bits.join(" · ");
  }

  // ---------------------------------------------------------------------
  // The rewrite, the score and the checks
  // ---------------------------------------------------------------------

  function marked(text, findings) {
    const spans = [];
    findings.forEach((f) => {
      if (f.severity === "weak") return;
      if (typeof f.start === "number" && f.end > f.start) spans.push([f.start, f.end, f.severity, f.label]);
      (f.spans || []).forEach((s) => { if (s.end > s.start) spans.push([s.start, s.end, f.severity, f.label]); });
    });
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let html = "";
    let pos = 0;
    for (const [a, b, sev, label] of spans) {
      if (a < pos) continue; // overlapping hits: the first one wins
      html += esc(text.slice(pos, a)) + '<mark class="ws-hl ws-hl-' + sev + '" title="' + esc(label) + '">' + esc(text.slice(a, b)) + "</mark>";
      pos = b;
    }
    return html + esc(text.slice(pos));
  }

  function renderOutput() {
    const built = W.assemble(state);
    const scanned = TellScan.scan(built.text, { wwb: state.methods.wwb });
    preview.innerHTML = built.text
      ? marked(built.text, scanned.findings)
      : '<span class="ws-empty">Your rewrite shows up here as you fill the slots.</span>';
    preview.dataset.text = built.text;

    const c = W.compare(draftEl.value, state, parsed);
    const rows = [];
    const nth = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
    if (c.pointFrom && c.pointFrom > 1) rows.push(["Point position", nth(c.pointFrom), "1st"]);
    if (c.words[0]) rows.push(["Words", c.words[0], c.words[1]]);
    if (c.words[0]) rows.push(["Tells", c.tells[0], c.tells[1]]);
    if (c.ratio && c.ratio[0] !== null) rows.push(["Meaning ratio", c.ratio[0] + "%", (c.ratio[1] === null ? "–" : c.ratio[1] + "%")]);
    scoreEl.innerHTML = rows.map(([k, a, b]) =>
      "<div><dt>" + esc(k) + '</dt><dd><span class="ws-was">' + esc(String(a)) + '</span><span class="ws-arrow" aria-label="now"> → </span><span class="ws-now">' + esc(String(b)) + "</span></dd></div>").join("");
    scoreEl.hidden = !rows.length;

    if (built.cuts.length && state.trim) {
      const seen = new Set();
      const quotes = built.cuts.filter((x) => !seen.has(x.text.toLowerCase()) && seen.add(x.text.toLowerCase()))
        .map((x) => '<q class="ws-user">' + esc(x.text) + "</q>");
      cutsEl.innerHTML = "Trimmed " + (quotes.length === 1 ? "one stock phrase" : quotes.length + " stock phrases") + ": " + quotes.join(", ") + ".";
      cutsEl.hidden = false;
    } else {
      cutsEl.hidden = true;
      cutsEl.textContent = "";
    }
    renderChecks(scanned);
  }

  function renderChecks(scanned) {
    const checks = W.check(state, parsed);
    const order = ["pyramid", "scqa", "mece", "inverted", "wwb", "data", "audit"];
    const rank = { warn: 0, info: 1, self: 2, pass: 3 };
    const toFix = checks.filter((c) => c.status === "warn").length;
    const passed = checks.filter((c) => c.status === "pass").length;
    let html = '<p class="ws-checks-sum"><strong>' + (toFix ? toFix + " to fix" : "Nothing to fix") + "</strong>" +
      (passed ? ", " + passed + " done" : "") + "</p>";
    for (const method of order) {
      const items = checks.filter((c) => c.method === method).sort((a, b) => rank[a.status] - rank[b.status]);
      if (!items.length) continue;
      html += '<div class="ws-check-group"><h4>' + esc(METHOD_NAMES[method]) + '</h4><ul class="ws-check-list">';
      for (const c of items) {
        html += '<li class="ws-check is-' + c.status + '" data-check="' + c.id + '">' +
          '<span class="ws-check-icon" aria-hidden="true"></span><div class="ws-check-body">' +
          '<p class="ws-check-title"><span class="sr-only">' + STATUS_TEXT[c.status] + ": </span>" + esc(c.title) + "</p>" +
          (c.detail ? '<p class="ws-check-detail">' + esc(c.detail) + "</p>" : "") +
          (c.quotes.length ? '<ul class="ws-quotes ws-user">' + c.quotes.map((q) => "<li><q>" + esc(q) + "</q></li>").join("") + "</ul>" : "");
        if (c.id === "tells" && c.status === "warn") {
          const hits = scanned.findings.filter((f) => f.severity !== "weak");
          html += '<ul class="ws-tells ws-user">' + hits.map((f) =>
            '<li class="sev-' + f.severity + '"><span class="code">' + esc(f.code) + "</span><span><strong>" + esc(f.label) + "</strong> " +
            (f.match ? "<q>" + esc(f.match) + "</q> " : "") + esc(FIX_FOR_PAGE[f.code] || f.fix) + "</span></li>").join("") + "</ul>";
        }
        html += "</div></li>";
      }
      html += "</ul></div>";
    }
    checksEl.innerHTML = html;
  }

  let timer = 0;
  function update(now) {
    clearTimeout(timer);
    const run = () => { renderOutput(); syncChips(); };
    if (now) run();
    else timer = setTimeout(run, 90);
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  function readMethods() {
    const m = W.emptyState().methods;
    methodInputs.forEach((i) => { m[i.dataset.method] = i.checked; });
    return m;
  }
  function writeMethods(m) {
    methodInputs.forEach((i) => { i.checked = !!m[i.dataset.method]; });
  }

  function fill(announce) {
    if (W.wordCount(draftEl.value)) undoState = JSON.parse(JSON.stringify(state));
    parsed = W.parseDraft(draftEl.value);
    const trim = state.trim;
    state = W.suggest(parsed, readMethods());
    state.trim = trim;
    active = { field: "point", index: 0 };
    renderChips();
    renderSlots();
    renderDraftMeta();
    update(true);
    undoBtn.hidden = !undoState;
    if (announce) say("Filled the slots from your draft. Check each one.");
  }

  function load(key, scroll, quiet) {
    const ex = W.EXAMPLES[key];
    if (!ex) return;
    draftEl.value = ex.text;
    grow(draftEl);
    writeMethods(W.methodsFrom(ex.methods));
    fill(false);
    undoState = null;
    undoBtn.hidden = true;
    pressExample(key);
    if (scroll) {
      document.getElementById("workshop").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      draftEl.focus({ preventScroll: true });
    }
    if (!quiet) say("Loaded the " + ex.label.toLowerCase() + " example" + (ex.methods.length ? " with " + ex.methods.map((m) => METHOD_NAMES[m]).join(" and ") : "") + ".");
  }

  function addToTarget(text) {
    const t = active;
    if (t.field === "support") {
      const cur = state.support[t.index] || "";
      if (!cur.trim()) state.support[t.index] = text;
      else { state.support.splice(t.index + 1, 0, text); active = { field: "support", index: t.index + 1 }; }
      renderSlots();
    } else if (t.field === "group-items") {
      const g = state.groups[t.index];
      g.items = g.items.trim() ? g.items.replace(/\s+$/, "") + "\n" + text : text;
      const el = $("ws-gitems-" + t.index);
      if (el) { el.value = g.items; grow(el); }
    } else {
      const cur = state[t.field] || "";
      state[t.field] = cur.trim() ? cur.replace(/\s+$/, "") + " " + text : text;
      const el = $("ws-" + t.field);
      if (el) { el.value = state[t.field]; grow(el); }
    }
    update(true);
    say("Added to " + labelFor(t) + ".");
  }

  // Draft typing: re-read the sentences; fill the slots the first time only.
  let draftTimer = 0;
  draftEl.addEventListener("input", () => {
    grow(draftEl);
    pressExample(null);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const empty = !W.wordCount(W.assemble(state).body);
      parsed = W.parseDraft(draftEl.value);
      if (empty) { fill(false); return; }
      renderChips();
      renderDraftMeta();
      update(true);
    }, 220);
  });

  fillBtn.addEventListener("click", () => fill(true));
  undoBtn.addEventListener("click", () => {
    if (!undoState) return;
    state = undoState;
    undoState = null;
    undoBtn.hidden = true;
    writeMethods(state.methods);
    renderSlots();
    update(true);
    say("Put the slots back the way they were.");
  });

  methodInputs.forEach((input) => input.addEventListener("change", () => {
    state = W.switchMethod(state, parsed, input.dataset.method, input.checked);
    renderSlots();
    renderDraftMeta();
    update(true);
    say((input.checked ? "Added " : "Removed ") + METHOD_NAMES[input.dataset.method] + ".");
  }));

  trimEl.addEventListener("change", () => { state.trim = trimEl.checked; update(true); });

  root.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.example === "clear") {
      draftEl.value = "";
      grow(draftEl);
      writeMethods(W.emptyState().methods);
      parsed = W.parseDraft("");
      const trim = state.trim;
      state = W.emptyState();
      state.trim = trim;
      undoState = null;
      undoBtn.hidden = true;
      renderChips();
      renderSlots();
      renderDraftMeta();
      update(true);
      pressExample(null);
      draftEl.focus();
      say("Cleared the workshop.");
      return;
    }
    load(b.dataset.example, false);
  }));

  // "Try it" buttons in the Methods section.
  document.querySelectorAll("[data-try]").forEach((b) => b.addEventListener("click", () => load(b.dataset.try, true)));

  chipsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".ws-chip");
    if (!b) return;
    const p = parsed.pieces.find((x) => x.id === b.dataset.piece);
    if (p) addToTarget(p.text);
  });

  slotsEl.addEventListener("focusin", (e) => {
    const f = e.target.dataset && e.target.dataset.field;
    if (!f || f === "rule" || f === "group-mode") return;
    active = { field: f === "group-label" ? "group-items" : f, index: Number(e.target.dataset.index || 0) };
    targetEl.textContent = labelFor(active);
  });

  slotsEl.addEventListener("input", (e) => {
    const el = e.target;
    const f = el.dataset.field;
    if (!f || f === "group-mode") return;
    const i = Number(el.dataset.index || 0);
    if (f === "support") state.support[i] = el.value;
    else if (f === "group-label") { state.groups[i].label = el.value; targetEl.textContent = labelFor(active); }
    else if (f === "group-items") state.groups[i].items = el.value;
    else state[f] = el.value;
    if (el.tagName === "TEXTAREA") grow(el);
    update(false);
  });

  slotsEl.addEventListener("change", (e) => {
    const el = e.target;
    if (el.name === "ws-order") { state.order = el.value; renderSlots(); update(true); return; }
    if (el.id === "ws-is-email") { state.isEmail = el.checked; renderSlots(); update(true); return; }
    if (el.dataset.field === "group-mode") { state.groups[Number(el.dataset.index)].mode = el.value; update(true); }
  });

  slotsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-action]");
    if (!b) return;
    const i = Number(b.dataset.index || 0);
    const act = b.dataset.action;
    let focusId = null;
    if (act === "add-item") { state.support.push(""); focusId = "ws-support-" + (state.support.length - 1); }
    else if (act === "remove") { state.support.splice(i, 1); if (!state.support.length) state.support = [""]; focusId = "ws-support-" + Math.max(0, i - 1); }
    else if (act === "up" && i > 0) { [state.support[i - 1], state.support[i]] = [state.support[i], state.support[i - 1]]; }
    else if (act === "down" && i < state.support.length - 1) { [state.support[i + 1], state.support[i]] = [state.support[i], state.support[i + 1]]; }
    else if (act === "add-group") { state.groups.push({ label: "", items: "", mode: "auto" }); focusId = "ws-glabel-" + (state.groups.length - 1); }
    else if (act === "remove-group") { state.groups.splice(i, 1); if (!state.groups.length) state.groups = [{ label: "", items: "", mode: "auto" }]; focusId = "ws-glabel-0"; }
    renderSlots();
    update(true);
    // Keep the keyboard where it was: on the moved line's button, or the new field.
    if (act === "up" || act === "down") {
      const j = act === "up" ? i - 1 : i + 1;
      const again = slotsEl.querySelector('button[data-action="' + act + '"][data-index="' + j + '"]') ||
        slotsEl.querySelector('#ws-support-' + j);
      if (again) again.focus();
      say("Moved the line " + act + ".");
    } else if (focusId && $(focusId)) {
      $(focusId).focus();
    }
  });

  copyBtn.addEventListener("click", async () => {
    const text = preview.dataset.text || "";
    if (!text) { say("Nothing to copy yet."); return; }
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e2) { /* the status below still tells them */ }
      ta.remove();
    }
    copyBtn.textContent = "Copied";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1600);
    say("Copied the rewrite.");
  });

  toScanner.addEventListener("click", () => {
    const input = document.getElementById("scan-input");
    if (!input) return;
    input.value = preview.dataset.text || "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("scanner").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    input.focus({ preventScroll: true });
    say("Opened your rewrite in the scanner.");
  });

  const scanToWorkshop = document.getElementById("scan-to-workshop");
  if (scanToWorkshop) scanToWorkshop.addEventListener("click", () => {
    const input = document.getElementById("scan-input");
    draftEl.value = input ? input.value : "";
    grow(draftEl);
    fill(false);
    pressExample(null);
    document.getElementById("workshop").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    draftEl.focus({ preventScroll: true });
    say("Brought the scanner's text into the workshop.");
  });

  window.addEventListener("resize", () => {
    grow(draftEl);
    slotsEl.querySelectorAll("textarea").forEach(grow);
  });

  load("pyramid", false, true);
})();
