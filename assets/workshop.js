/*
 * The workshop on the page: four steps, one at a time.
 *   1 Paste   the draft
 *   2 Review  what's holding it back, and the methods picked for it
 *   3 Fix     the rewrite, plus one card per line that still needs a change
 *   4 Send    the finished message, what changed, and a last read
 * The logic lives in assets/workshop-core.js. Everything runs locally.
 */
(function () {
  "use strict";

  const W = window.WorkshopCore;
  const TellScan = window.TellScan;
  const root = document.getElementById("ws");
  if (!root || !W || !TellScan) return;
  root.hidden = false;

  const $ = (id) => document.getElementById(id);
  const draftEl = $("ws-draft");
  const pasteHint = $("wz-paste-hint");
  const sentencesEl = $("wz-sentences");
  const flagsEl = $("wz-flags");
  const methodsEl = $("wz-methods");
  const preview = $("ws-preview");
  const cutsEl = $("ws-cuts");
  const taskEl = $("wz-task");
  const progressEl = $("wz-progress");
  const progressBar = $("wz-progress-bar");
  const progressText = $("wz-progress-text");
  const slotsEl = $("ws-slots");
  const finalEl = $("wz-final");
  const finalNote = $("wz-final-note");
  const winsEl = $("wz-wins");
  const asksEl = $("wz-asks");
  const allSet = $("wz-all-set");
  const statusEl = $("ws-status");
  const copyBtn = $("ws-copy");
  const panels = Array.from(root.querySelectorAll(".wz-panel"));
  const stepButtons = Array.from(root.querySelectorAll(".wz-step"));
  const STAGES = ["paste", "review", "fix", "send"];
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let reached = 0;               // the furthest step opened so far
  let parsed = W.parseDraft("");
  let methods = W.emptyState().methods;
  let state = W.emptyState();
  let seen = new Set();          // fix cards shown since the rewrite was made
  let skipped = new Set();
  let fixed = 0;
  let current = null;            // the key of the fix card on screen
  let flashPart = null;          // the part of the rewrite that just changed
  let exampleMethods = null;     // an example brings its own method
  let recsShown = [];
  let pointFrom = null;          // where the point sat in the draft, kept from the first pass
  let rewriteCuts = [];          // the stock phrases the first pass trimmed

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
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M9.5 16.2L5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/></svg>';
  const CROSS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5L12 10.5 17.5 5 19 6.5 13.5 12l5.5 5.5-1.5 1.5-5.5-5.5L6.5 19 5 17.5 10.5 12 5 6.5z"/></svg>';

  // ---------------------------------------------------------------------
  // Moving between steps
  // ---------------------------------------------------------------------

  function syncSteps(active) {
    const i = STAGES.indexOf(active);
    stepButtons.forEach((b, k) => {
      b.disabled = k > reached;
      b.classList.toggle("is-done", k < i || (k <= reached && k !== i && k < reached));
      if (k === i) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
  }

  function go(next, opts) {
    opts = opts || {};
    const i = STAGES.indexOf(next);
    if (i < 0 || i > reached) return;
    panels.forEach((p) => { p.hidden = p.dataset.stage !== next; });
    root.dataset.stage = next;
    syncSteps(next);
    if (next === "fix") renderFix();
    if (next === "send") renderSend();
    if (opts.focus !== false) {
      const section = document.getElementById("workshop");
      const heading = root.querySelector('.wz-panel[data-stage="' + next + '"] .wz-title');
      if (opts.scroll || root.getBoundingClientRect().top < 0) {
        section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function reach(next) { reached = Math.max(reached, STAGES.indexOf(next)); }

  stepButtons.forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  root.querySelectorAll(".wz-nav [data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

  // ---------------------------------------------------------------------
  // Step 1: paste
  // ---------------------------------------------------------------------

  function check(opts) {
    const text = draftEl.value;
    if (!W.wordCount(text)) {
      pasteHint.textContent = "Paste or type a draft first.";
      draftEl.focus();
      return;
    }
    pasteHint.textContent = "";
    parsed = W.parseDraft(text);
    const recs = W.recommend(parsed, text);
    methods = W.methodsFrom(exampleMethods || recs.map((r) => r.method));
    renderReview(exampleMethods ? exampleMethods.map((k) => ({ method: k, why: W.METHOD_JOBS[k], example: true })) : recs);
    reached = 1;
    go("review", opts);
  }

  function loadExample(key, opts) {
    const ex = W.EXAMPLES[key];
    if (!ex) return;
    draftEl.value = ex.text;
    grow(draftEl);
    exampleMethods = ex.methods.slice();
    check(opts);
    say("Loaded the " + ex.label.toLowerCase() + " example.");
  }

  $("wz-check").addEventListener("click", () => check());
  draftEl.addEventListener("input", () => {
    exampleMethods = null;
    pasteHint.textContent = "";
    grow(draftEl);
    // A changed draft needs a fresh review before the later steps mean anything.
    if (reached > 0) { reached = 0; syncSteps("paste"); }
  });
  draftEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); check(); }
  });
  root.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => loadExample(b.dataset.example)));
  document.querySelectorAll("[data-try]").forEach((b) => b.addEventListener("click", () => loadExample(b.dataset.try, { scroll: true })));

  // ---------------------------------------------------------------------
  // Step 2: review
  // ---------------------------------------------------------------------

  function markTells(text) {
    const hits = TellScan.scan(text, { wwb: methods.wwb }).findings.filter((f) => f.severity !== "weak" && typeof f.start === "number");
    hits.sort((a, b) => a.start - b.start);
    let html = "";
    let pos = 0;
    for (const f of hits) {
      if (f.start < pos) continue;
      html += esc(text.slice(pos, f.start)) + '<mark class="wz-tell" title="' + esc(f.label) + '">' + esc(text.slice(f.start, f.end)) + "</mark>";
      pos = f.end;
    }
    return html + esc(text.slice(pos));
  }

  function renderReview(recs) {
    if (recs) recsShown = recs;
    const d = W.diagnose(draftEl.value, parsed, methods);
    const fillerIds = new Set(parsed.pieces.filter((p) => p.flags.filler).map((p) => p.id));

    const voice = (text) => '<li class="wz-sent is-voice"><span class="wz-sent-n" aria-hidden="true"></span><span class="wz-sent-text">' +
      esc(text).replace(/\n/g, "<br>") + '</span><span class="wz-sent-tag">Kept as you wrote it</span></li>';
    let html = parsed.greeting ? voice(parsed.greeting) : "";
    let last = 0;
    for (const p of parsed.pieces) {
      const n = p.sentence !== last ? p.sentence : "";
      last = p.sentence;
      const isPoint = p.id === d.pointId;
      const isFiller = fillerIds.has(p.id);
      const tag = isPoint ? (p.sentence > 1 ? "Your point. It moves to the top." : "Your point") : isFiller ? "Filler: " + p.flags.filler.toLowerCase() : "";
      html += '<li class="wz-sent' + (isPoint ? " is-point" : isFiller ? " is-filler" : "") + '"><span class="wz-sent-n" aria-hidden="true">' + n + "</span>" +
        '<span class="wz-sent-text">' + (isFiller ? esc(p.text) : markTells(p.text)) + "</span>" +
        (tag ? '<span class="wz-sent-tag">' + esc(tag) + "</span>" : "") + "</li>";
    }
    if (parsed.signoff) html += voice(parsed.signoff);
    sentencesEl.innerHTML = html;

    flagsEl.innerHTML = d.flags.map((f) =>
      '<li class="wz-flag is-' + f.kind + '"><span class="wz-flag-icon" aria-hidden="true"></span><div>' +
      '<p class="wz-flag-title"><span class="sr-only">' + (f.kind === "good" ? "Good: " : "To fix: ") + "</span>" + esc(f.title) + "</p>" +
      '<p class="wz-flag-detail">' + esc(f.detail) + "</p>" +
      (f.quotes && f.quotes.length ? '<p class="wz-quotes ws-user">' + f.quotes.map((q) => "<q>" + esc(q) + "</q>").join(" ") + "</p>" : "") +
      "</div></li>").join("");

    const why = {};
    recsShown.forEach((r) => { why[r.method] = r.why; });
    if (recs) {
      methodsEl.innerHTML = '<ul class="wz-picked" id="wz-picked"></ul>' +
        '<details class="wz-change" id="wz-change"><summary>Change methods</summary><div class="wz-method-list">' +
        W.METHODS.map((k) => '<label class="wz-method"><input type="checkbox" data-method="' + k + '"' + (methods[k] ? " checked" : "") + ">" +
          '<span class="wz-method-body"><span class="wz-method-name">' + esc(W.METHOD_NAMES[k]) + "</span>" +
          '<span class="wz-method-job">' + esc(W.METHOD_JOBS[k]) + "</span></span></label>").join("") + "</div></details>";
    }
    const picked = ["pyramid"].concat(W.METHODS.filter((k) => methods[k]));
    $("wz-picked").innerHTML = picked.map((k) => '<li class="wz-pick-row"><span class="wz-pick-name">' + esc(W.METHOD_NAMES[k]) +
      (k === "pyramid" ? ' <span class="wz-method-tag">Always on</span>'
        : why[k] ? ' <span class="wz-method-tag is-picked">' + (recsShown.some((r) => r.method === k && r.example) ? "This example's method" : "Picked for you") + "</span>" : "") +
      '</span><span class="wz-pick-why">' + esc(why[k] || W.METHOD_JOBS[k]) + "</span></li>").join("");
  }

  methodsEl.addEventListener("change", (e) => {
    const k = e.target.dataset && e.target.dataset.method;
    if (!k) return;
    methods[k] = e.target.checked;
    renderReview();
    const again = methodsEl.querySelector('input[data-method="' + k + '"]');
    if (again) again.focus();
    reached = 1; // the rewrite has to be made again with the new methods
    syncSteps("review");
    say((methods[k] ? "Added " : "Removed ") + W.METHOD_NAMES[k] + ".");
  });

  $("wz-rewrite").addEventListener("click", () => {
    const first = W.suggest(parsed, methods);
    pointFrom = W.compare(draftEl.value, first, parsed).pointFrom;
    const baked = W.bakeTrims(first);
    state = baked.state;
    rewriteCuts = baked.cuts;
    seen = new Set();
    skipped = new Set();
    fixed = 0;
    current = null;
    reach("fix");
    renderSlots();
    go("fix");
  });

  // ---------------------------------------------------------------------
  // Step 3: fix
  // ---------------------------------------------------------------------

  function cardTitle(c) {
    const copy = W.slotCopy(state.methods);
    if (c.field === "support") return (state.methods.inverted ? "Detail line " : "Supporting line ") + (c.index + 1);
    if (c.field === "group-items") {
      const g = state.groups[c.index];
      return g && g.label.trim() ? "The " + g.label.trim() + " group" : "Group " + (c.index + 1);
    }
    if (c.field === "groups") return "Your groups";
    if (c.field === "general") return "The whole message";
    return (copy[c.field] && copy[c.field].label) || "This line";
  }

  function cardExample(c) {
    const copy = W.slotCopy(state.methods);
    return c.field === "groups" ? "" : (copy[c.field] && copy[c.field].example) || "";
  }

  function openTasks() {
    return W.tasks(state, parsed).filter((c) => !skipped.has(c.key));
  }

  function renderPreview() {
    const built = W.assemble(state);
    const scanned = TellScan.scan(built.text, { wwb: state.methods.wwb });
    const spans = [];
    scanned.findings.forEach((f) => {
      if (f.severity !== "weak" && typeof f.start === "number" && f.end > f.start) spans.push([f.start, f.end, "ws-hl ws-hl-" + f.severity, f.label]);
    });
    const fp = flashPart && built.parts.find((p) => p.field === flashPart.field && p.index === flashPart.index);
    if (fp) spans.push([fp.start, fp.end, "ws-new", "Just changed"]);
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let html = "";
    let pos = 0;
    for (const [a, b, cls, label] of spans) {
      if (a < pos) continue;
      html += esc(built.text.slice(pos, a)) + '<mark class="' + cls + '" title="' + esc(label) + '">' + esc(built.text.slice(a, b)) + "</mark>";
      pos = b;
    }
    html += esc(built.text.slice(pos));
    preview.innerHTML = built.text ? html : '<span class="ws-empty">Your rewrite shows up here.</span>';
    preview.dataset.text = built.text;
    flashPart = null;

    if (rewriteCuts.length) {
      const seenCut = new Set();
      const quotes = rewriteCuts.filter((x) => !seenCut.has(x.text.toLowerCase()) && seenCut.add(x.text.toLowerCase()))
        .map((x) => '<q class="ws-user">' + esc(x.text) + "</q>");
      cutsEl.innerHTML = "Trimmed " + plural(quotes.length, "stock phrase", "stock phrases") + ": " + quotes.join(", ") + ".";
      cutsEl.hidden = false;
    } else {
      cutsEl.hidden = true;
      cutsEl.textContent = "";
    }
  }

  function renderProgress(open) {
    open.forEach((c) => seen.add(c.key));
    const total = seen.size;
    const done = total - open.length;
    progressEl.setAttribute("aria-valuemax", String(Math.max(1, total)));
    progressEl.setAttribute("aria-valuenow", String(total ? done : 1));
    progressBar.style.width = (total ? Math.round((done / total) * 100) : 100) + "%";
    progressText.textContent = total ? done + " of " + total + " fixes done" : "Nothing to fix";
    progressEl.classList.toggle("is-complete", done === total);
  }

  function renderFix(note) {
    renderPreview();
    const open = openTasks();
    renderProgress(open);
    const card = open.find((c) => c.key === current) || open[0] || null;
    current = card ? card.key : null;
    if (!card) {
      taskEl.innerHTML = '<div class="wz-clear"><span class="wz-done-badge is-small" aria-hidden="true">' + CHECK_SVG + "</span>" +
        "<h4>" + (seen.size ? "All fixed. Nice work." : "Nothing to fix. It's in good shape.") + "</h4>" +
        "<p>Read the rewrite once more, then take it to the finish.</p>" +
        '<button type="button" class="btn btn-primary btn-big" data-action="finish">See it ready to send</button></div>';
      delete taskEl.dataset.key;
      delete taskEl.dataset.field;
      return;
    }
    const n = open.indexOf(card) + 1;
    const method = card.issues[0].method;
    let body = '<p class="wz-task-count">Fix ' + n + " of " + open.length + (note ? ' <span class="wz-task-note">' + esc(note) + "</span>" : "") + "</p>";
    body += '<div class="wz-task-head"><h4>' + esc(cardTitle(card)) + "</h4>" +
      (method && method !== "audit" ? '<span class="slot-owner m-' + method + '">' + esc(W.METHOD_NAMES[method]) + "</span>" : "") + "</div>";
    body += '<ul class="wz-issues">' + card.issues.map((i) =>
      '<li><p class="wz-issue-title">' + esc(i.title) + (i.quotes && i.quotes.length ? ' <span class="ws-user">' + i.quotes.map((q) => "<q>" + esc(q) + "</q>").join(" ") + "</span>" : "") + "</p>" +
      (i.detail ? '<p class="wz-issue-detail">' + esc(i.detail) + "</p>" : "") + "</li>").join("") + "</ul>";

    if (card.field === "groups") {
      body += groupsEditor("wz");
    } else if (card.field !== "general") {
      const ex = cardExample(card);
      const empty = !String(card.value || "").trim();
      body += '<label class="wz-input-label" for="wz-input">' + (empty ? "Write it here" : "Edit it here") + "</label>" +
        '<textarea class="slot-input wz-input" id="wz-input" rows="3"' + (ex ? ' aria-describedby="wz-example"' : "") + "></textarea>";
      if (ex) body += '<p class="wz-eg" id="wz-example">For example: ' + esc(ex.replace(/\n/g, " / ")) + "</p>";
      if (empty) {
        const used = W.usedPieces(state, parsed);
        const picks = parsed.pieces.filter((p) => !p.flags.filler && !used.has(p.id)).slice(0, 4);
        if (picks.length) {
          body += '<p class="wz-small">Or start from one of your sentences:</p><ul class="wz-picks ws-user">' +
            picks.map((p) => '<li><button type="button" class="wz-pick" data-pick="' + p.id + '">' + esc(p.text) + "</button></li>").join("") + "</ul>";
        }
      }
    }
    body += '<div class="wz-row">' + (card.field === "general"
      ? '<button type="button" class="btn btn-primary" data-action="skip">Got it</button>'
      : '<button type="button" class="btn btn-primary" data-action="apply">Apply fix</button><button type="button" class="btn btn-quiet" data-action="skip">Skip</button>') + "</div>";
    taskEl.innerHTML = body;
    taskEl.dataset.key = card.key;
    taskEl.dataset.field = card.field;
    taskEl.dataset.index = String(card.index);

    const input = $("wz-input");
    if (input) { input.value = card.value || ""; grow(input); }
    if (card.field === "groups") fillGroupsEditor("wz");
  }

  function onScreen() {
    return taskEl.dataset.field ? { key: taskEl.dataset.key, field: taskEl.dataset.field, index: Number(taskEl.dataset.index || 0) } : null;
  }

  function focusTask() {
    const target = taskEl.querySelector("#wz-input, .wz-group-label, [data-action]");
    if (target) target.focus();
  }

  function applyCard() {
    const card = onScreen();
    if (!card) { renderFix(); focusTask(); return; }
    if (card.field === "groups") readGroupsEditor("wz");
    else {
      const input = $("wz-input");
      if (input) W.setField(state, card.field, card.index, input.value);
    }
    flashPart = { field: card.field === "groups" ? "group-items" : card.field, index: card.index };
    const still = W.tasks(state, parsed).find((c) => c.key === card.key);
    renderSlots();
    if (still) {
      renderFix("Almost: " + plural(still.issues.length, "thing", "things") + " left on this one.");
      say("Applied. " + plural(still.issues.length, "thing is", "things are") + " still flagged on this line.");
      focusTask();
    } else {
      fixed += 1;
      current = null;
      renderFix();
      const open = openTasks();
      say("Fixed. " + (open.length ? plural(open.length, "fix", "fixes") + " to go." : "That was the last one."));
      focusTask();
    }
  }

  function skipCard() {
    if (!current) return;
    skipped.add(current);
    current = null;
    renderFix();
    say("Skipped.");
    focusTask();
  }

  function finish() {
    reach("send");
    go("send");
  }

  taskEl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.action === "apply") applyCard();
    else if (b.dataset.action === "skip") skipCard();
    else if (b.dataset.action === "finish") finish();
    else if (b.dataset.pick) {
      const p = parsed.pieces.find((x) => x.id === b.dataset.pick);
      const input = $("wz-input");
      if (p && input) {
        input.value = input.value.trim() ? input.value.replace(/\s+$/, "") + " " + p.text : p.text;
        grow(input);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }
    } else if (b.dataset.action === "add-group") {
      readGroupsEditor("wz");
      state.groups.push({ label: "", items: "", mode: "auto" });
      renderFix();
      const label = $("wz-glabel-" + (state.groups.length - 1));
      if (label) label.focus();
    } else if (b.dataset.action === "remove-group") {
      readGroupsEditor("wz");
      state.groups.splice(Number(b.dataset.index), 1);
      if (!state.groups.length) state.groups = [{ label: "", items: "", mode: "auto" }];
      renderFix();
      focusTask();
    }
  });

  // Typing in a card updates the rewrite as you go; Apply moves on.
  taskEl.addEventListener("input", (e) => {
    const card = onScreen();
    if (!card) return;
    if (e.target.id === "wz-input") {
      W.setField(state, card.field, card.index, e.target.value);
      grow(e.target);
    } else if (card.field === "groups") {
      readGroupsEditor("wz");
      if (e.target.tagName === "TEXTAREA") grow(e.target);
    }
    renderPreview();
  });
  taskEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); applyCard(); }
  });

  // MECE's groups as a small editor, used in a fix card and in "Edit every part".
  function groupsEditor(prefix) {
    return '<label class="slot-sublabel" for="' + prefix + '-rule">Sorting rule</label>' +
      '<input class="slot-input" id="' + prefix + '-rule" list="' + prefix + '-rules" placeholder="Example: By person">' +
      '<datalist id="' + prefix + '-rules"><option value="By person"><option value="By time"><option value="Settled vs. still needed"><option value="By option"><option value="By cost"></datalist>' +
      '<ol class="ws-groups">' + state.groups.map((g, i) => {
        const n = i + 1;
        return '<li class="ws-group"><div class="ws-group-head">' +
          '<label class="sr-only" for="' + prefix + "-glabel-" + i + '">Group ' + n + " name</label>" +
          '<input class="slot-input ws-group-label wz-group-label" id="' + prefix + "-glabel-" + i + '" placeholder="Group ' + n + ' name, like Ana or Settled">' +
          '<button type="button" class="icon-btn" data-action="remove-group" data-index="' + i + '" aria-label="Remove group ' + n + '">' + CROSS_SVG + "</button></div>" +
          '<label class="sr-only" for="' + prefix + "-gitems-" + i + '">Group ' + n + " items, one per line</label>" +
          '<textarea class="slot-input" id="' + prefix + "-gitems-" + i + '" rows="3" placeholder="One item per line"></textarea></li>';
      }).join("") + "</ol>" +
      '<button type="button" class="btn btn-small" data-action="add-group">Add a group</button>';
  }
  function fillGroupsEditor(prefix) {
    const rule = $(prefix + "-rule");
    if (rule) rule.value = state.rule;
    state.groups.forEach((g, i) => {
      const l = $(prefix + "-glabel-" + i);
      const t = $(prefix + "-gitems-" + i);
      if (l) l.value = g.label;
      if (t) { t.value = g.items; grow(t); }
    });
  }
  function readGroupsEditor(prefix) {
    const rule = $(prefix + "-rule");
    if (rule) state.rule = rule.value;
    state.groups.forEach((g, i) => {
      const l = $(prefix + "-glabel-" + i);
      const t = $(prefix + "-gitems-" + i);
      if (l) g.label = l.value;
      if (t) g.items = t.value;
    });
  }

  // "Edit every part": every slot at once, for anyone who wants it.
  function slotField(field, copy, rows) {
    const id = "ws-" + field;
    return '<div class="slot" data-slot="' + field + '"><div class="slot-head"><label class="slot-label" for="' + id + '">' + esc(copy.label) + "</label></div>" +
      (copy.hint ? '<p class="slot-hint" id="' + id + '-hint">' + esc(copy.hint) + "</p>" : "") +
      '<textarea class="slot-input" id="' + id + '" data-field="' + field + '" rows="' + (rows || 2) + '"' + (copy.hint ? ' aria-describedby="' + id + '-hint"' : "") +
      ' placeholder="' + esc("Example: " + copy.example.replace(/\n/g, " / ")) + '"></textarea></div>';
  }

  function renderSlots() {
    const m = state.methods;
    const copy = W.slotCopy(m);
    const focusId = document.activeElement && slotsEl.contains(document.activeElement) ? document.activeElement.id : null;
    let html = slotField("greeting", copy.greeting, 1);
    if (m.wwb) {
      html += '<div class="slot"><label class="toggle"><input type="checkbox" id="ws-is-email"' + (state.isEmail ? " checked" : "") + "><span>This is an email</span></label>" +
        (state.isEmail ? slotField("subject", copy.subject, 1) : "") + "</div>";
    }
    if (m.scqa && !m.inverted) {
      const opts = [["asc", "Answer first", "busy readers"], ["sca", "Situation first", "needs grounding"], ["csa", "Problem first", "urgent"]];
      html += '<fieldset class="slot slot-order"><legend class="slot-label">Opening order</legend><div class="ws-radios">' +
        opts.map(([v, l, d]) => '<label class="ws-radio"><input type="radio" name="ws-order" id="ws-order-' + v + '" value="' + v + '"' +
          (state.order === v ? " checked" : "") + "><span>" + l + " <small>" + d + "</small></span></label>").join("") + "</div></fieldset>";
    }
    html += slotField("point", copy.point, 2);
    if (m.scqa) html += slotField("situation", copy.situation, 2) + slotField("complication", copy.complication, 2);
    if (m.mece) {
      html += '<div class="slot"><div class="slot-head"><span class="slot-label">' + esc(copy.groups.label) + '</span></div><p class="slot-hint">' + esc(copy.groups.hint) + "</p>" +
        groupsEditor("ws") + "</div>";
    } else {
      const n = state.support.length;
      html += '<div class="slot"><div class="slot-head"><span class="slot-label">' + esc(copy.support.label) + "</span></div>" +
        '<p class="slot-hint">' + esc(copy.support.hint) + '</p><ol class="ws-items">' +
        state.support.map((t, i) => '<li class="ws-item"><label class="sr-only" for="ws-support-' + i + '">' + esc(copy.support.label) + ", line " + (i + 1) + "</label>" +
          '<textarea class="slot-input" id="ws-support-' + i + '" data-field="support" data-index="' + i + '" rows="2"></textarea>' +
          '<span class="ws-item-tools">' +
          '<button type="button" class="icon-btn" id="ws-up-' + i + '" data-action="up" data-index="' + i + '" aria-label="Move line ' + (i + 1) + ' up"' + (i === 0 ? " disabled" : "") + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6l-6 7h12z"/></svg></button>' +
          '<button type="button" class="icon-btn" id="ws-down-' + i + '" data-action="down" data-index="' + i + '" aria-label="Move line ' + (i + 1) + ' down"' + (i === n - 1 ? " disabled" : "") + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18l6-7H6z"/></svg></button>' +
          '<button type="button" class="icon-btn" id="ws-remove-' + i + '" data-action="remove" data-index="' + i + '" aria-label="Remove line ' + (i + 1) + '">' + CROSS_SVG + "</button>" +
          "</span></li>").join("") + '</ol><button type="button" class="btn btn-small" data-action="add-item">Add a line</button></div>';
    }
    if (m.inverted) html += slotField("background", copy.background, 2);
    html += slotField("close", copy.close, 2);
    html += slotField("signoff", copy.signoff, 2);
    slotsEl.innerHTML = html;
    slotsEl.querySelectorAll("[data-field]").forEach((el) => {
      const f = el.dataset.field;
      el.value = f === "support" ? state.support[Number(el.dataset.index)] || "" : state[f] || "";
      grow(el);
    });
    if (m.mece) fillGroupsEditor("ws");
    if (focusId && $(focusId)) $(focusId).focus();
  }

  slotsEl.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.field === "support") state.support[Number(el.dataset.index)] = el.value;
    else if (el.dataset.field) state[el.dataset.field] = el.value;
    else if (/^ws-(rule|glabel-|gitems-)/.test(el.id)) readGroupsEditor("ws");
    if (el.tagName === "TEXTAREA") grow(el);
    syncFromSlots();
  });
  slotsEl.addEventListener("change", (e) => {
    const el = e.target;
    if (el.name === "ws-order") { state.order = el.value; renderSlots(); syncFromSlots(); }
    else if (el.id === "ws-is-email") { state.isEmail = el.checked; renderSlots(); syncFromSlots(); }
  });
  slotsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-action]");
    if (!b) return;
    const i = Number(b.dataset.index || 0);
    const act = b.dataset.action;
    const n = state.support.length;
    let focusId = null;
    if (act === "add-item") { state.support.push(""); focusId = "ws-support-" + n; }
    else if (act === "remove") { state.support.splice(i, 1); if (!state.support.length) state.support = [""]; focusId = "ws-support-" + Math.max(0, i - 1); }
    else if (act === "up" && i > 0) {
      [state.support[i - 1], state.support[i]] = [state.support[i], state.support[i - 1]];
      focusId = i - 1 > 0 ? "ws-up-" + (i - 1) : "ws-support-" + (i - 1);
    } else if (act === "down" && i < n - 1) {
      [state.support[i + 1], state.support[i]] = [state.support[i], state.support[i + 1]];
      focusId = i + 1 < n - 1 ? "ws-down-" + (i + 1) : "ws-support-" + (i + 1);
    } else if (act === "add-group") { readGroupsEditor("ws"); state.groups.push({ label: "", items: "", mode: "auto" }); focusId = "ws-glabel-" + (state.groups.length - 1); }
    else if (act === "remove-group") { readGroupsEditor("ws"); state.groups.splice(i, 1); if (!state.groups.length) state.groups = [{ label: "", items: "", mode: "auto" }]; focusId = "ws-glabel-0"; }
    renderSlots();
    syncFromSlots();
    if (focusId && $(focusId)) $(focusId).focus();
    if (act === "up" || act === "down") say("Moved the line " + act + ".");
  });

  let slotTimer = 0;
  function syncFromSlots() {
    renderPreview();
    clearTimeout(slotTimer);
    // The fix card follows the slots, unless you're typing in it.
    slotTimer = setTimeout(() => { if (!taskEl.contains(document.activeElement)) renderFix(); }, 250);
  }

  $("wz-finish").addEventListener("click", finish);

  // ---------------------------------------------------------------------
  // Step 4: send
  // ---------------------------------------------------------------------

  function renderSend() {
    const built = W.assemble(state);
    finalEl.value = built.text;
    grow(finalEl);
    noteFinal();
    const c = W.compare(draftEl.value, state, parsed);
    const from = c.pointFrom || pointFrom;
    const wins = [];
    if (from && c.pointTo && from > c.pointTo) wins.push("Moved your point from sentence " + from + " to sentence " + c.pointTo);
    if (c.filler) wins.push("Cut " + plural(c.filler, "filler line", "filler lines"));
    if (rewriteCuts.length) wins.push("Trimmed " + plural(rewriteCuts.length, "stock phrase", "stock phrases"));
    if (fixed) wins.push("Made " + plural(fixed, "fix", "fixes") + " of your own");
    if (c.tells[0] > c.tells[1]) wins.push("Tells down from " + c.tells[0] + " to " + c.tells[1]);
    if (c.words[1] < c.words[0]) wins.push(c.words[0] + " words down to " + c.words[1] + ", " + Math.round(100 * (1 - c.words[1] / c.words[0])) + "% shorter");
    if (c.ratio && c.ratio[0] !== null && c.ratio[1] !== null && c.ratio[1] > c.ratio[0]) wins.push("Meaning ratio up from " + c.ratio[0] + "% to " + c.ratio[1] + "%");
    const used = ["Pyramid"].concat(W.METHODS.filter((k) => state.methods[k]).map((k) => W.METHOD_NAMES[k]));
    wins.push("Shaped with " + used.join(" + "));
    winsEl.innerHTML = wins.map((w) => '<li><span class="wz-win-icon" aria-hidden="true">' + CHECK_SVG + "</span><span>" + esc(w) + "</span></li>").join("");

    const asks = W.check(state, parsed).filter((x) => x.status === "self");
    asks.push({ title: "Read it aloud once", detail: "Change anything you wouldn't say to this person." });
    asksEl.innerHTML = asks.map((a, i) => '<li><label class="wz-ask" for="wz-ask-' + i + '"><input type="checkbox" id="wz-ask-' + i + '"><span><strong>' +
      esc(a.title) + "</strong> " + esc(a.detail) + "</span></label></li>").join("");
    allSet.hidden = true;
  }

  function noteFinal() {
    const r = TellScan.scan(finalEl.value, { wwb: state.methods.wwb });
    const hits = r.findings.filter((f) => f.severity !== "weak");
    finalNote.innerHTML = hits.length
      ? plural(hits.length, "phrase still reads", "phrases still read") + " as padded: " + hits.slice(0, 3).map((f) => '<q class="ws-user">' + esc(f.match || f.label) + "</q>").join(", ") + ". You can edit it right here."
      : "No tells found. You can still edit it right here.";
  }
  let finalTimer = 0;
  finalEl.addEventListener("input", () => { grow(finalEl); clearTimeout(finalTimer); finalTimer = setTimeout(noteFinal, 200); });

  asksEl.addEventListener("change", () => {
    const done = Array.from(asksEl.querySelectorAll("input")).every((b) => b.checked);
    if (done && allSet.hidden) say("All set. Go send it.");
    allSet.hidden = !done;
  });

  copyBtn.addEventListener("click", async () => {
    const text = finalEl.value;
    if (!text.trim()) { say("Nothing to copy yet."); return; }
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      finalEl.select();
      try { document.execCommand("copy"); } catch (e2) { /* the status line still reports it */ }
    }
    copyBtn.textContent = "Copied";
    copyBtn.classList.add("is-copied");
    setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("is-copied"); }, 1800);
    say("Copied your message.");
  });

  $("ws-to-scanner").addEventListener("click", () => {
    const input = document.getElementById("scan-input");
    if (!input) return;
    input.value = finalEl.value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("scanner").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    input.focus({ preventScroll: true });
    say("Opened your message in the scanner.");
  });

  $("wz-again").addEventListener("click", () => {
    draftEl.value = "";
    grow(draftEl);
    exampleMethods = null;
    reached = 0;
    go("paste");
    draftEl.focus();
  });

  const scanToWorkshop = document.getElementById("scan-to-workshop");
  if (scanToWorkshop) scanToWorkshop.addEventListener("click", () => {
    const input = document.getElementById("scan-input");
    draftEl.value = input ? input.value : "";
    grow(draftEl);
    exampleMethods = null;
    check({ scroll: true });
  });

  window.addEventListener("resize", () => {
    [draftEl, finalEl].forEach(grow);
    root.querySelectorAll("textarea.slot-input").forEach(grow);
  });

  go("paste", { focus: false });
})();
