// Umblore background service worker.
// Handles the right-click menu, claim capture, and optional page snapshots.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Umblore: could not set panel behavior", error));

const MENU_SAVE = "umblore-save";
const MENU_SAVE_WITH_SNAPSHOT = "umblore-save-snapshot";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SAVE,
    title: "Save claim to Umblore",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: MENU_SAVE_WITH_SNAPSHOT,
    title: "Save claim + page snapshot",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_SAVE && info.menuItemId !== MENU_SAVE_WITH_SNAPSHOT) return;
  if (!tab || !tab.id) return;

  const claim = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: (info.selectionText || "").trim(),
    url: tab.url || "",
    title: tab.title || "",
    tag: "",
    note: "",
    snapshotFile: null,
    createdAt: new Date().toISOString()
  };

  if (!claim.text) return;

  if (info.menuItemId === MENU_SAVE_WITH_SNAPSHOT) {
    captureSnapshot(tab.id, claim, saveClaim);
  } else {
    saveClaim(claim);
  }
});

function captureSnapshot(tabId, claim, callback) {
  chrome.pageCapture.saveAsMHTML({ tabId }, (mhtml) => {
    if (chrome.runtime.lastError || !mhtml) {
      console.error("Umblore: snapshot failed", chrome.runtime.lastError);
      callback(claim);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const filename = `umblore-snapshots/${sanitizeFilename(claim.title || "page")}-${claim.id}.mhtml`;
      chrome.downloads.download({ url: reader.result, filename, saveAs: false }, () => {
        if (chrome.runtime.lastError) {
          console.error("Umblore: download failed", chrome.runtime.lastError);
        } else {
          claim.snapshotFile = filename;
        }
        callback(claim);
      });
    };
    reader.onerror = () => callback(claim);
    reader.readAsDataURL(mhtml);
  });
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "page";
}

function saveClaim(claim) {
  chrome.storage.local.get({ claims: [] }, ({ claims }) => {
    claims.unshift(claim);
    chrome.storage.local.set({ claims });
  });
}
