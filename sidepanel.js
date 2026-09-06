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
const fitBtn = document.getElementById("fitBtn");
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
// camera over the graph: k is zoom, x/y is the pan offset in screen pixels
let cam = { x: 0, y: 0, k: 1 };
let panFrom = null;
let needsFit = true;
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

// The layout runs in its own coordinate space, sized to the number of
// nodes rather than to the viewport, so a big graph simply gets a bigger
// world and you pan around it instead of everything being crushed together.
function worldSize() {
  const w = canvas.clientWidth || 360;
  const h = canvas.clientHeight || 380;
  const span = Math.sqrt(Math.max(nodes.length, 1)) * 115;
  return { w: Math.max(w, span), h: Math.max(h, span) };
}

function tick() {
  const world = worldSize();
  const w = world.w;
  const h = world.h;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Fruchterman-Reingold style constants: k is the ideal distance between
  // nodes for this many nodes in this much space, so the layout stays sane
  // whether there are 10 claims or 500.
  const k = Math.sqrt((w * h) / Math.max(nodes.length, 1));
  const repulsion = k * k;
  const restLength = k;
  const maxSpeed = k * 0.22;

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
    n.vx += (w / 2 - n.x) * 0.0022;
    n.vy += (h / 2 - n.y) * 0.0022;
    n.vx *= 0.86;
    n.vy *= 0.86;
    const speed = Math.hypot(n.vx, n.vy);
    if (speed > maxSpeed) {
      n.vx = (n.vx / speed) * maxSpeed;
      n.vy = (n.vy / speed) * maxSpeed;
    }
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

  // Nodes and labels are drawn at a constant screen size; zooming changes
  // how far apart things are, not how big they are, so a claim stays
  // clickable and readable however far out you zoom.
  const sx = (n) => n.x * cam.k + cam.x;
  const sy = (n) => n.y * cam.k + cam.y;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  edges.forEach((e) => {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(sx(a), sy(a));
    ctx.lineTo(sx(b), sy(b));
    ctx.stroke();
  });

  nodes.forEach((n) => {
    const isSelected = n.id === selectedId;
    ctx.beginPath();
    ctx.arc(sx(n), sy(n), isSelected ? n.r + 2 : n.r, 0, Math.PI * 2);
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

  ctx.font = "600 11px -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  nodes.forEach((n) => {
    if (n.kind !== "tag") return;
    const x = sx(n);
    const y = sy(n);
    if (x < -60 || y < -20 || x > w + 60 || y > h + 20) return; // offscreen
    const tw = ctx.measureText(n.label).width;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(x - tw / 2 - 3, y + n.r + 2, tw + 6, 14);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(n.label, x, y + n.r + 4);
  });
}

let settleTicks = 0;

function animate() {
  tick();
  // let the layout relax, then frame it once
  if (needsFit && ++settleTicks > 90) {
    fitToContent();
    needsFit = false;
  }
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
  // nodes are drawn at constant screen size, so compare in screen space
  let best = null;
  let bestD = Infinity;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const dx = px - (n.x * cam.k + cam.x);
    const dy = py - (n.y * cam.k + cam.y);
    const d2 = dx * dx + dy * dy;
    const reach = n.r + 7;
    if (d2 <= reach * reach && d2 < bestD) {
      best = n;
      bestD = d2;
    }
  }
  return best;
}

function pointerPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

// screen pixels -> graph coordinates
function toWorld(px, py) {
  return { x: (px - cam.x) / cam.k, y: (py - cam.y) / cam.k };
}

// Frame the whole graph in the viewport.
function fitToContent() {
  if (!nodes.length) return;
  const w = canvas.clientWidth || 360;
  const h = canvas.clientHeight || 380;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  });
  const margin = 46; // screen px kept clear for labels at the edges
  const gw = Math.max(maxX - minX, 1);
  const gh = Math.max(maxY - minY, 1);
  cam.k = Math.max(
    0.05,
    Math.min(Math.min((w - margin * 2) / gw, (h - margin * 2) / gh), 1.6)
  );
  cam.x = w / 2 - ((minX + maxX) / 2) * cam.k;
  cam.y = h / 2 - ((minY + maxY) / 2) * cam.k;
}

canvas.addEventListener("pointerdown", (evt) => {
  const { x, y } = pointerPos(evt);
  const n = nodeAt(x, y);
  if (!n) {
    selectedId = null;
    panFrom = { x: evt.clientX, y: evt.clientY, camX: cam.x, camY: cam.y };
    canvas.setPointerCapture(evt.pointerId);
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
  if (panFrom) {
    cam.x = panFrom.camX + (evt.clientX - panFrom.x);
    cam.y = panFrom.camY + (evt.clientY - panFrom.y);
    return;
  }
  if (!dragNode) return;
  const { x, y } = pointerPos(evt);
  const p = toWorld(x, y);
  dragNode.x = p.x;
  dragNode.y = p.y;
  dragNode.vx = 0;
  dragNode.vy = 0;
});

canvas.addEventListener("pointerup", () => {
  dragNode = null;
  panFrom = null;
});

canvas.addEventListener("pointercancel", () => {
  dragNode = null;
  panFrom = null;
});

fitBtn.addEventListener("click", () => fitToContent());

// The canvas changes height when the detail panel opens or the window
// resizes. Shift the camera by half the delta so whatever you were
// looking at stays put instead of sliding out of frame.
let lastCanvasSize = null;
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (lastCanvasSize) {
      cam.x += (w - lastCanvasSize.w) / 2;
      cam.y += (h - lastCanvasSize.h) / 2;
    }
    lastCanvasSize = { w, h };
  }).observe(canvas);
}

// Scroll to zoom, keeping the point under the cursor fixed.
canvas.addEventListener("wheel", (evt) => {
  evt.preventDefault();
  const { x, y } = pointerPos(evt);
  const before = toWorld(x, y);
  const factor = Math.exp(-evt.deltaY * 0.0015);
  cam.k = Math.max(0.1, Math.min(cam.k * factor, 4));
  cam.x = x - before.x * cam.k;
  cam.y = y - before.y * cam.k;
}, { passive: false });

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
      needsFit = true;
      settleTicks = 0;
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
