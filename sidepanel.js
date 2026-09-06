const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const searchEl = document.getElementById("search");
const tagRowEl = document.getElementById("tagRow");
const countEl = document.getElementById("count");
const mapViewEl = document.getElementById("mapView");
const mapEmptyEl = document.getElementById("mapEmpty");
const nodeDetailEl = document.getElementById("nodeDetail");
const canvas = document.getElementById("graph");
const viewListBtn = document.getElementById("viewList");
const viewMapBtn = document.getElementById("viewMap");
const themeBtn = document.getElementById("themeBtn");
const openTabBtn = document.getElementById("openTab");
const isFullPage = document.body.dataset.fullpage === "1";

let claims = [];
let searchTerm = "";
let activeTag = null;
let view = document.body.dataset.fullpage === "1" ? "map" : "list";

/* ---------- data helpers ---------- */

function load() {
  chrome.storage.local.get({ claims: [] }, (data) => {
    claims = data.claims;
    render();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.theme && !changes.claims) return;
  if (area === "local" && changes.claims) {
    claims = changes.claims.newValue || [];
    render();
  }
});

function saveClaims() {
  chrome.storage.local.set({ claims });
}

// Tags are stored as one comma-separated string, so older single-tag
// claims keep working without migration.
function tagsOf(claim) {
  return (claim.tag || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "unknown source";
  }
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function uniqueTags() {
  const set = new Set();
  claims.forEach((c) => tagsOf(c).forEach((t) => set.add(t)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function matchesFilters(claim) {
  const term = searchTerm.trim().toLowerCase();
  const matchesSearch =
    !term ||
    claim.text.toLowerCase().includes(term) ||
    (claim.title || "").toLowerCase().includes(term) ||
    (claim.note || "").toLowerCase().includes(term) ||
    (claim.tag || "").toLowerCase().includes(term);
  const matchesTag = !activeTag || tagsOf(claim).includes(activeTag);
  return matchesSearch && matchesTag;
}

function visibleClaims() {
  return claims.filter(matchesFilters);
}


/* ---------- topic suggestions ---------- */
// Suggests topics you've already used, based on word overlap with the
// claim's own text. Deliberately local and dumb: no model, no network.

const STOPWORDS = new Set(("a about after all also an and any are as at be because been before being " +
  "between both but by can could did do does doing down during each few for from further had has have " +
  "having he her here hers him his how i if in into is it its itself just me more most my no nor not of " +
  "off on once only or other our out over own same she should so some such than that the their them then " +
  "there these they this those through to too under until up very was we were what when where which while " +
  "who whom why will with would you your said says say new one two three first last year years time make " +
  "made many much may might must need needs used using use").split(" "));

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function claimTerms(claim) {
  return new Set(tokenize(`${claim.text} ${claim.title || ""} ${claim.note || ""}`));
}

// Inverse document frequency across all saved claims, so common words
// count for little and distinctive ones count for a lot.
function buildIdf() {
  const df = new Map();
  claims.forEach((c) => {
    claimTerms(c).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });
  const total = Math.max(claims.length, 1);
  const idf = new Map();
  df.forEach((n, term) => idf.set(term, Math.log(total / (1 + n)) + 1));
  return idf;
}

function suggestTopics(claim, max = 3) {
  const tags = uniqueTags();
  if (tags.length === 0) return [];

  const idf = buildIdf();
  const mine = claimTerms(claim);
  if (mine.size === 0) return [];

  const myWeight = Math.sqrt(
    Array.from(mine).reduce((s, t) => s + Math.pow(idf.get(t) || 1, 2), 0)
  ) || 1;

  const scored = tags.map((tag) => {
    const peers = claims.filter((c) => c.id !== claim.id && tagsOf(c).includes(tag));
    const theirs = new Set();
    peers.forEach((c) => claimTerms(c).forEach((t) => theirs.add(t)));
    tokenize(tag).forEach((t) => theirs.add(t)); // the topic name itself counts

    let dot = 0;
    theirs.forEach((t) => {
      if (mine.has(t)) dot += Math.pow(idf.get(t) || 1, 2);
    });
    const theirWeight = Math.sqrt(
      Array.from(theirs).reduce((s, t) => s + Math.pow(idf.get(t) || 1, 2), 0)
    ) || 1;

    return { tag, score: dot / (myWeight * theirWeight) };
  });

  return scored
    .filter((s) => s.score > 0.06)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.tag);
}

function addTopic(claim, tag) {
  const current = tagsOf(claim);
  if (!current.includes(tag)) current.push(tag);
  claim.tag = current.join(", ");
  saveClaims();
}

/* ---------- shared UI ---------- */

function renderTagRow() {
  const tags = uniqueTags();
  tagRowEl.innerHTML = "";
  if (tags.length === 0) return;

  const allChip = document.createElement("button");
  allChip.className = "tag-chip" + (activeTag === null ? " active" : "");
  allChip.textContent = "All";
  allChip.addEventListener("click", () => {
    activeTag = null;
    render();
  });
  tagRowEl.appendChild(allChip);

  tags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.className = "tag-chip" + (activeTag === tag ? " active" : "");
    chip.textContent = tag;
    chip.addEventListener("click", () => {
      activeTag = activeTag === tag ? null : tag;
      render();
    });
    tagRowEl.appendChild(chip);
  });
}

/* ---------- list view ---------- */

function buildClaimCard(claim) {
  const card = document.createElement("article");
  card.className = "claim";

  const text = document.createElement("p");
  text.className = "claim-text";
  text.textContent = `"${claim.text}"`;
  card.appendChild(text);

  const meta = document.createElement("div");
  meta.className = "claim-meta";

  const link = document.createElement("a");
  link.href = claim.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = domainOf(claim.url);
  meta.appendChild(link);

  const time = document.createElement("span");
  time.className = "dot";
  time.textContent = formatTime(claim.createdAt);
  meta.appendChild(time);

  if (claim.snapshotFile) {
    const snap = document.createElement("span");
    snap.className = "dot snapshot-note";
    snap.textContent = "page snapshot saved";
    meta.appendChild(snap);
  }

  card.appendChild(meta);

  const controls = document.createElement("div");
  controls.className = "claim-controls";

  const tagInput = document.createElement("input");
  tagInput.className = "tag-input";
  tagInput.placeholder = "Topics, comma separated";
  tagInput.value = claim.tag || "";
  tagInput.addEventListener("change", () => {
    claim.tag = tagInput.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .join(", ");
    saveClaims();
  });
  controls.appendChild(tagInput);

  const noteBtn = document.createElement("button");
  noteBtn.className = "icon-btn";
  noteBtn.textContent = claim.note ? "Edit note" : "Add note";
  controls.appendChild(noteBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "icon-btn danger";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => {
    claims = claims.filter((c) => c.id !== claim.id);
    saveClaims();
  });
  controls.appendChild(deleteBtn);

  card.appendChild(controls);

  if (tagsOf(claim).length === 0) {
    const suggestions = suggestTopics(claim);
    if (suggestions.length) {
      const wrap = document.createElement("div");
      wrap.className = "suggest-row";
      const label = document.createElement("span");
      label.className = "suggest-label";
      label.textContent = "Related topics:";
      wrap.appendChild(label);
      suggestions.forEach((tag) => {
        const chip = document.createElement("button");
        chip.className = "suggest-chip";
        chip.textContent = "+ " + tag;
        chip.title = "Tag this claim with " + tag;
        chip.addEventListener("click", () => addTopic(claim, tag));
        wrap.appendChild(chip);
      });
      card.appendChild(wrap);
    }
  }

  const noteArea = document.createElement("textarea");
  noteArea.className = "note-area";
  noteArea.placeholder = "Why this claim matters, or what to check next.";
  noteArea.value = claim.note || "";
  noteArea.hidden = !claim.note;
  noteArea.addEventListener("change", () => {
    claim.note = noteArea.value;
    saveClaims();
  });
  card.appendChild(noteArea);

  noteBtn.addEventListener("click", () => {
    noteArea.hidden = !noteArea.hidden;
    if (!noteArea.hidden) noteArea.focus();
  });

  return card;
}

/* ---------- map view ---------- */

let COLORS = readThemeColors();

function readThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (s.getPropertyValue(name) || "").trim() || fallback;
  return {
    ink: v("--ink", "#191424"),
    inkSoft: v("--ink-soft", "#5D5473"),
    line: v("--line", "#D7D1E3"),
    accent: v("--accent", "#6B4CA5"),
    nodeTag: v("--node-tag", "#A98BD9"),
    selected: v("--selected", "#3B8A68"),
    paper: v("--paper-raised", "#FBFAFD")
  };
}

let nodes = [];
let edges = [];
let selectedId = null;
let animFrame = null;
let dragNode = null;

function buildGraph() {
  const visible = visibleClaims();
  const tagNames = new Set();
  visible.forEach((c) => tagsOf(c).forEach((t) => tagNames.add(t)));

  const w = canvas.clientWidth || 360;
  const h = canvas.clientHeight || 380;

  const existing = new Map(nodes.map((n) => [n.id, n]));
  nodes = [];
  edges = [];

  const measure = canvas.getContext("2d");
  measure.font = "600 11px -apple-system, 'Segoe UI', sans-serif";

  Array.from(tagNames).forEach((tag, i, arr) => {
    const prev = existing.get("tag:" + tag);
    const angle = (i / Math.max(arr.length, 1)) * Math.PI * 2;
    nodes.push({
      id: "tag:" + tag,
      kind: "tag",
      label: tag,
      x: prev ? prev.x : w / 2 + Math.cos(angle) * 70,
      y: prev ? prev.y : h / 2 + Math.sin(angle) * 70,
      vx: 0,
      vy: 0,
      r: 7,
      halfLabel: measure.measureText(tag).width / 2 + 4
    });
  });

  visible.forEach((claim, i) => {
    const prev = existing.get("claim:" + claim.id);
    const angle = (i / Math.max(visible.length, 1)) * Math.PI * 2;
    nodes.push({
      id: "claim:" + claim.id,
      kind: "claim",
      claim,
      x: prev ? prev.x : w / 2 + Math.cos(angle) * 130,
      y: prev ? prev.y : h / 2 + Math.sin(angle) * 130,
      vx: 0,
      vy: 0,
      r: 5
    });
    tagsOf(claim).forEach((t) => {
      edges.push({ a: "claim:" + claim.id, b: "tag:" + t });
    });
  });
}

function tick() {
  const w = canvas.clientWidth || 360;
  const h = canvas.clientHeight || 380;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // a wider canvas should breathe, not clump in the middle
  const scale = Math.max(1, Math.min(Math.sqrt((w * h) / (360 * 380)), 2.6));
  const repulsion = 900 * scale * scale;
  const restLength = 58 * scale;

  // repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = 0.01;
      }
      const d = Math.sqrt(d2);
      const force = repulsion / d2;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // spring attraction along edges
  edges.forEach((e) => {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const force = (d - restLength) * 0.012;
    const fx = (dx / d) * force;
    const fy = (dy / d) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  });

  // gentle pull to centre + integrate
  nodes.forEach((n) => {
    n.vx += (w / 2 - n.x) * 0.0016;
    n.vy += (h / 2 - n.y) * 0.0016;
    n.vx *= 0.86;
    n.vy *= 0.86;
    if (n !== dragNode) {
      n.x += n.vx;
      n.y += n.vy;
    }
    // tag labels sit below and extend either side of the node, so the
    // clamp has to account for the text box, not just the circle
    const pad = n.r + 4;
    const padX = n.kind === "tag" ? Math.max(pad, n.halfLabel || pad) : pad;
    const padBottom = n.kind === "tag" ? n.r + 20 : pad;
    n.x = Math.max(padX, Math.min(w - padX, n.x));
    n.y = Math.max(pad, Math.min(h - padBottom, n.y));
  });
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 360;
  const h = canvas.clientHeight || 380;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const byId = new Map(nodes.map((n) => [n.id, n]));

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  edges.forEach((e) => {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  nodes.forEach((n) => {
    const isSelected = n.id === selectedId;
    ctx.beginPath();
    ctx.arc(n.x, n.y, isSelected ? n.r + 2 : n.r, 0, Math.PI * 2);
    if (n.kind === "tag") {
      ctx.fillStyle = COLORS.nodeTag;
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = isSelected ? COLORS.selected : COLORS.ink;
      ctx.fill();
    }
  });

  ctx.fillStyle = COLORS.ink;
  ctx.font = "600 11px -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  nodes.forEach((n) => {
    if (n.kind !== "tag") return;
    const tw = ctx.measureText(n.label).width;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(n.x - tw / 2 - 3, n.y + n.r + 2, tw + 6, 14);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(n.label, n.x, n.y + n.r + 4);
  });
}

function animate() {
  tick();
  draw();
  animFrame = requestAnimationFrame(animate);
}

function startAnimation() {
  if (animFrame === null) animate();
}

function stopAnimation() {
  if (animFrame !== null) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
}

function nodeAt(px, py) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const dx = px - n.x;
    const dy = py - n.y;
    if (dx * dx + dy * dy <= (n.r + 7) * (n.r + 7)) return n;
  }
  return null;
}

function pointerPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

canvas.addEventListener("pointerdown", (evt) => {
  const { x, y } = pointerPos(evt);
  const n = nodeAt(x, y);
  if (!n) {
    selectedId = null;
    renderNodeDetail();
    return;
  }
  if (n.kind === "claim") {
    selectedId = n.id;
    renderNodeDetail();
  } else {
    activeTag = activeTag === n.label ? null : n.label;
    selectedId = null;
    render();
    return;
  }
  dragNode = n;
  canvas.setPointerCapture(evt.pointerId);
});

canvas.addEventListener("pointermove", (evt) => {
  if (!dragNode) return;
  const { x, y } = pointerPos(evt);
  dragNode.x = x;
  dragNode.y = y;
  dragNode.vx = 0;
  dragNode.vy = 0;
});

canvas.addEventListener("pointerup", () => {
  dragNode = null;
});

function renderNodeDetail() {
  const node = nodes.find((n) => n.id === selectedId);
  if (!node || node.kind !== "claim") {
    nodeDetailEl.hidden = true;
    nodeDetailEl.innerHTML = "";
    draw();
    return;
  }
  const claim = node.claim;
  nodeDetailEl.hidden = false;
  nodeDetailEl.innerHTML = "";

  const text = document.createElement("p");
  text.className = "claim-text";
  text.textContent = `"${claim.text}"`;
  nodeDetailEl.appendChild(text);

  const meta = document.createElement("div");
  meta.className = "claim-meta";
  const link = document.createElement("a");
  link.href = claim.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = domainOf(claim.url);
  meta.appendChild(link);
  const time = document.createElement("span");
  time.className = "dot";
  time.textContent = formatTime(claim.createdAt);
  meta.appendChild(time);
  nodeDetailEl.appendChild(meta);

  if (claim.note) {
    const note = document.createElement("p");
    note.className = "snapshot-note";
    note.textContent = claim.note;
    nodeDetailEl.appendChild(note);
  }

  const tags = tagsOf(claim);
  if (tags.length) {
    const wrap = document.createElement("div");
    wrap.className = "detail-tags";
    tags.forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "detail-tag";
      chip.textContent = t;
      wrap.appendChild(chip);
    });
    nodeDetailEl.appendChild(wrap);
  }
  draw();
}

/* ---------- theme ---------- */

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2M12 20.5v2M3.4 3.4l1.5 1.5M19.1 19.1l1.5 1.5M1.5 12h2M20.5 12h2M3.4 20.6l1.5-1.5M19.1 4.9l1.5-1.5"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  // button shows what you'd switch TO
  themeBtn.innerHTML = theme === "dark" ? SUN : MOON;
  themeBtn.title = theme === "dark" ? "Switch to light" : "Switch to dark";
  COLORS = readThemeColors();
  if (view === "map") draw();
}

function initTheme() {
  chrome.storage.local.get({ theme: null }, ({ theme }) => {
    const prefersDark =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(theme || (prefersDark ? "dark" : "light"));
  });
}

if (openTabBtn) {
  openTabBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("map.html") });
  });
}

themeBtn.addEventListener("click", () => {
  const next =
    document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
});

/* ---------- view switching ---------- */

function setView(next) {
  view = next;
  viewListBtn.classList.toggle("active", view === "list");
  viewMapBtn.classList.toggle("active", view === "map");
  render();
}

viewListBtn.addEventListener("click", () => setView("list"));
viewMapBtn.addEventListener("click", () => setView("map"));

/* ---------- render ---------- */

function render() {
  renderTagRow();
  const visible = visibleClaims();
  const hasClaims = claims.length > 0;

  emptyEl.hidden = hasClaims;
  listEl.hidden = !hasClaims || view !== "list";
  mapViewEl.hidden = !hasClaims || view !== "map";

  if (view === "list") {
    stopAnimation();
    listEl.innerHTML = "";
    visible.forEach((claim) => listEl.appendChild(buildClaimCard(claim)));
  } else if (hasClaims) {
    const anyTags = uniqueTags().length > 0;
    canvas.hidden = !anyTags;
    mapEmptyEl.hidden = anyTags;
    if (anyTags) {
      buildGraph();
      if (!nodes.some((n) => n.id === selectedId)) selectedId = null;
      renderNodeDetail();
      startAnimation();
    } else {
      stopAnimation();
      nodeDetailEl.hidden = true;
    }
  }

  countEl.textContent = !hasClaims
    ? ""
    : `${visible.length} of ${claims.length} claim${claims.length === 1 ? "" : "s"}`;
}

/* ---------- export ---------- */

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportMarkdown() {
  const groups = new Map();
  claims.forEach((c) => {
    const tags = tagsOf(c);
    if (tags.length === 0) {
      if (!groups.has("Untagged")) groups.set("Untagged", []);
      groups.get("Untagged").push(c);
    } else {
      tags.forEach((t) => {
        if (!groups.has(t)) groups.set(t, []);
        groups.get(t).push(c);
      });
    }
  });

  let out = "# Claims\n\n";
  Array.from(groups.keys())
    .sort((a, b) => a.localeCompare(b))
    .forEach((tag) => {
      out += `## ${tag}\n\n`;
      groups.get(tag).forEach((c) => {
        out += `> ${c.text}\n\n`;
        out += `Source: [${c.title || domainOf(c.url)}](${c.url}) — ${formatTime(c.createdAt)}\n`;
        const others = tagsOf(c).filter((t) => t !== tag);
        if (others.length) out += `\nAlso tagged: ${others.join(", ")}\n`;
        if (c.note) out += `\nNote: ${c.note}\n`;
        out += "\n";
      });
    });

  triggerDownload(out, "umblore-export.md", "text/markdown");
}

function exportJson() {
  triggerDownload(JSON.stringify(claims, null, 2), "umblore-export.json", "application/json");
}

searchEl.addEventListener("input", () => {
  searchTerm = searchEl.value;
  render();
});

document.getElementById("exportMd").addEventListener("click", exportMarkdown);
document.getElementById("exportJson").addEventListener("click", exportJson);

viewListBtn.classList.toggle("active", view === "list");
viewMapBtn.classList.toggle("active", view === "map");
initTheme();
load();
