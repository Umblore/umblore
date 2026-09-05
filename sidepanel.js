const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const searchEl = document.getElementById("search");
const tagRowEl = document.getElementById("tagRow");
const countEl = document.getElementById("count");

let claims = [];
let searchTerm = "";
let activeTag = null;

function load() {
  chrome.storage.local.get({ claims: [] }, (data) => {
    claims = data.claims;
    render();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.claims) {
    claims = changes.claims.newValue || [];
    render();
  }
});

function saveClaims() {
  chrome.storage.local.set({ claims });
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
  claims.forEach((c) => {
    if (c.tag && c.tag.trim()) set.add(c.tag.trim());
  });
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
  const matchesTag = !activeTag || (claim.tag || "").trim() === activeTag;
  return matchesSearch && matchesTag;
}

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
  tagInput.placeholder = "Add a topic";
  tagInput.value = claim.tag || "";
  tagInput.addEventListener("change", () => {
    claim.tag = tagInput.value.trim();
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

function render() {
  renderTagRow();
  const visible = claims.filter(matchesFilters);

  listEl.innerHTML = "";
  visible.forEach((claim) => listEl.appendChild(buildClaimCard(claim)));

  emptyEl.hidden = claims.length > 0;
  listEl.hidden = claims.length === 0;

  countEl.textContent =
    claims.length === 0
      ? ""
      : `${visible.length} of ${claims.length} claim${claims.length === 1 ? "" : "s"}`;
}

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
    const key = (c.tag || "").trim() || "Untagged";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });

  let out = "# Claims\n\n";
  Array.from(groups.keys())
    .sort((a, b) => a.localeCompare(b))
    .forEach((tag) => {
      out += `## ${tag}\n\n`;
      groups.get(tag).forEach((c) => {
        out += `> ${c.text}\n\n`;
        out += `Source: [${c.title || domainOf(c.url)}](${c.url}) — ${formatTime(c.createdAt)}\n`;
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

load();
