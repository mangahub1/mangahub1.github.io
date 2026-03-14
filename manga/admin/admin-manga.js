import {
  appAuthzConfig,
  appUploadConfig,
  mangaApiConfigLooksReady,
  mangaContentApiConfigLooksReady,
  mangaContentUploadApiConfigLooksReady,
  mangaUploadApiConfigLooksReady,
} from "../../auth/auth-config.js";
import {
  clearAuthSession,
  getAuthSession,
  getJwtGivenName,
  getJwtPicture,
  isJwtExpired,
} from "../../auth/auth-session.js";

const state = {
  session: null,
  busy: false,
  mangaItems: [],
  filteredMangaItems: [],
  contentItems: [],
  activeManga: null,
  mangaMode: "create",
  contentMode: "create",
  editingManga: null,
  editingContent: null,
  selectedCoverImageFile: null,
  coverPreviewObjectUrl: null,
  selectedContentCoverImageFile: null,
  contentCoverPreviewObjectUrl: null,
  selectedContentFile: null,
  inlineContentRow: null,
  inlineContentHost: null,
};

const COVER_IMAGE_MAX_UPLOAD_BYTES = Number(appUploadConfig?.mangaCoverMaxUploadBytes || 3 * 1024 * 1024);
const CONTENT_COVER_IMAGE_MAX_UPLOAD_BYTES = Number(
  appUploadConfig?.mangaContentCoverMaxUploadBytes || COVER_IMAGE_MAX_UPLOAD_BYTES
);

const elements = {
  error: document.getElementById("adminError"),
  success: document.getElementById("adminSuccess"),
  searchInput: document.getElementById("searchInput"),
  refreshBtn: document.getElementById("refreshBtn"),
  addMangaBtn: document.getElementById("addMangaBtn"),
  adminGridShell: document.getElementById("adminGridShell"),
  mangaTableBody: document.getElementById("mangaTableBody"),
  signoutLinks: document.querySelectorAll(".settings-item.signout"),
  accountAvatar: document.getElementById("accountAvatar"),
  welcomeMessage: document.getElementById("welcomeMessage"),
  accountIconSvg: document.querySelector(".settings-trigger .library-icon-svg"),

  mangaModal: document.getElementById("mangaModal"),
  mangaModalTitle: document.getElementById("mangaModalTitle"),
  mangaModalError: document.getElementById("mangaModalError"),
  closeMangaModalBtn: document.getElementById("closeMangaModalBtn"),
  cancelMangaBtn: document.getElementById("cancelMangaBtn"),
  saveMangaBtn: document.getElementById("saveMangaBtn"),
  mangaForm: document.getElementById("mangaForm"),
  mangaIdInput: document.getElementById("mangaIdInput"),
  titleInput: document.getElementById("titleInput"),
  publisherInput: document.getElementById("publisherInput"),
  seriesInput: document.getElementById("seriesInput"),
  ageRatingInput: document.getElementById("ageRatingInput"),
  japaneseTitleInput: document.getElementById("japaneseTitleInput"),
  coverImageInput: document.getElementById("coverImageInput"),
  coverImageFileName: document.getElementById("coverImageFileName"),
  coverImageClearBtn: document.getElementById("coverImageClearBtn"),
  coverImagePreview: document.getElementById("coverImagePreview"),
  coverImagePlaceholder: document.getElementById("coverImagePlaceholder"),
  coverImageCurrentUrl: document.getElementById("coverImageCurrentUrl"),
  keywordsInput: document.getElementById("keywordsInput"),
  synopsisInput: document.getElementById("synopsisInput"),
  bisacInput: document.getElementById("bisacInput"),
  salesRestrictionInput: document.getElementById("salesRestrictionInput"),
  copyrightInput: document.getElementById("copyrightInput"),

  contentPanelStaging: document.getElementById("contentPanelStaging"),
  contentPanel: document.getElementById("contentPanel"),
  contentError: document.getElementById("contentError"),
  addContentBtn: document.getElementById("addContentBtn"),
  contentTableBody: document.getElementById("contentTableBody"),

  contentModal: document.getElementById("contentModal"),
  contentModalTitle: document.getElementById("contentModalTitle"),
  contentModalError: document.getElementById("contentModalError"),
  closeContentModalBtn: document.getElementById("closeContentModalBtn"),
  cancelContentBtn: document.getElementById("cancelContentBtn"),
  saveContentBtn: document.getElementById("saveContentBtn"),
  contentForm: document.getElementById("contentForm"),
  contentMangaIdInput: document.getElementById("contentMangaIdInput"),
  contentKeyInput: document.getElementById("contentKeyInput"),
  contentTypeInput: document.getElementById("contentTypeInput"),
  sequenceNumberInput: document.getElementById("sequenceNumberInput"),
  contentTitleInput: document.getElementById("contentTitleInput"),
  externalContentIdInput: document.getElementById("externalContentIdInput"),
  contentAuthorInput: document.getElementById("contentAuthorInput"),
  priceInput: document.getElementById("priceInput"),
  fileFormatInput: document.getElementById("fileFormatInput"),
  contentCoverUrlInput: document.getElementById("contentCoverUrlInput"),
  fileUrlInput: document.getElementById("fileUrlInput"),
  contentSynopsisInput: document.getElementById("contentSynopsisInput"),
  contentCoverImageInput: document.getElementById("contentCoverImageInput"),
  contentCoverImageFileName: document.getElementById("contentCoverImageFileName"),
  contentCoverImageClearBtn: document.getElementById("contentCoverImageClearBtn"),
  contentCoverImagePreview: document.getElementById("contentCoverImagePreview"),
  contentCoverImagePlaceholder: document.getElementById("contentCoverImagePlaceholder"),
  contentCoverImageCurrentUrl: document.getElementById("contentCoverImageCurrentUrl"),
  contentFileInput: document.getElementById("contentFileInput"),
  contentFileName: document.getElementById("contentFileName"),
  contentFileClearBtn: document.getElementById("contentFileClearBtn"),
  contentFileCurrentUrl: document.getElementById("contentFileCurrentUrl"),
};

function redirectTo(path) {
  window.location.replace(path);
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

function clearError() {
  elements.error.textContent = "";
  elements.error.classList.add("hidden");
}

function showSuccess(message) {
  elements.success.textContent = message;
  elements.success.classList.remove("hidden");
  window.setTimeout(() => elements.success?.classList.add("hidden"), 2800);
}

function showMangaModalError(message) {
  elements.mangaModalError.textContent = message;
  elements.mangaModalError.classList.remove("hidden");
}

function clearMangaModalError() {
  elements.mangaModalError.textContent = "";
  elements.mangaModalError.classList.add("hidden");
}

function showContentModalError(message) {
  elements.contentModalError.textContent = message;
  elements.contentModalError.classList.remove("hidden");
}

function clearContentModalError() {
  elements.contentModalError.textContent = "";
  elements.contentModalError.classList.add("hidden");
}

function showContentPanelError(message) {
  elements.contentError.textContent = message;
  elements.contentError.classList.remove("hidden");
}

function clearContentPanelError() {
  elements.contentError.textContent = "";
  elements.contentError.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCoverThumb(url, label) {
  const coverUrl = String(url || "").trim();
  const altText = escapeHtml(`${String(label || "Manga").trim() || "Manga"} cover`);
  const fallback = `
    <div class="cover-thumb-fallback" aria-hidden="true">
      <span class="cover-thumb-fallback-icon"></span>
      <span class="cover-thumb-fallback-text">No Cover</span>
    </div>
  `;
  if (!coverUrl) {
    return `<div class="cover-thumb is-missing">${fallback}</div>`;
  }
  return `
    <div class="cover-thumb">
      <img class="cover-thumb-img" data-cover-thumb="true" src="${escapeHtml(coverUrl)}" alt="${altText}" loading="lazy" decoding="async" />
      ${fallback}
    </div>
  `;
}

function bindCoverThumbFallbacks(scopeElement) {
  if (!(scopeElement instanceof Element)) return;
  const images = scopeElement.querySelectorAll('img[data-cover-thumb="true"]:not([data-cover-bound="true"])');
  images.forEach((img) => {
    img.setAttribute("data-cover-bound", "true");
    img.addEventListener("load", () => {
      img.classList.add("is-ready");
      const frame = img.closest(".cover-thumb");
      frame?.classList.remove("is-missing");
    });
    img.addEventListener(
      "error",
      () => {
        const frame = img.closest(".cover-thumb");
        frame?.classList.add("is-missing");
        img.removeAttribute("src");
      },
      { once: true }
    );
  });
}

function ensureAdminSession() {
  const session = getAuthSession();
  if (!session) {
    redirectTo("../../index.html");
    return null;
  }

  const idToken = String(session.idToken || "").trim();
  const accessToken = String(session.accessToken || "").trim();
  const email = String(session.email || "").trim();
  const status = Number(session.status || 0);
  const isAdmin = Boolean(session.isAdmin || Number(session.admin || 0) === 1);

  if (!idToken || !accessToken || !email || status !== 1 || isJwtExpired(idToken)) {
    clearAuthSession();
    redirectTo("../../index.html");
    return null;
  }

  if (!isAdmin) {
    redirectTo("../../library.html");
    return null;
  }

  state.session = session;
  return session;
}

function wireAccountIdentity() {
  const idToken = String(state.session?.idToken || "").trim();
  const givenName = String(state.session?.givenName || getJwtGivenName(idToken) || "").trim();
  const image = String(state.session?.image || getJwtPicture(idToken) || "").trim();

  if (givenName) {
    elements.welcomeMessage.textContent = `Welcome, ${givenName}`;
    elements.welcomeMessage.classList.remove("hidden");
  } else {
    elements.welcomeMessage.classList.add("hidden");
  }

  if (image) {
    elements.accountAvatar.src = image;
    elements.accountAvatar.classList.remove("hidden");
    elements.accountIconSvg?.classList.add("hidden");
    elements.accountAvatar.onerror = () => {
      elements.accountAvatar?.classList.add("hidden");
      elements.accountIconSvg?.classList.remove("hidden");
    };
  } else {
    elements.accountAvatar.classList.add("hidden");
    elements.accountIconSvg?.classList.remove("hidden");
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
  }
  return body;
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.session.accessToken}`,
  };
}

function responseData(body) {
  if (!body || typeof body !== "object") return {};
  if ("data" in body && typeof body.data === "object" && body.data) {
    return body.data;
  }
  return body;
}

function updateCoverImageUi(previewUrl, currentUrl) {
  const hasPreview = Boolean(previewUrl);
  elements.coverImagePreview.src = hasPreview ? previewUrl : "";
  elements.coverImagePreview.classList.toggle("hidden", !hasPreview);
  elements.coverImagePlaceholder.classList.toggle("hidden", hasPreview);

  const normalizedCurrentUrl = String(currentUrl || "").trim();
  if (!normalizedCurrentUrl) {
    elements.coverImageCurrentUrl.textContent = "";
    elements.coverImageCurrentUrl.classList.add("hidden");
    return;
  }

  elements.coverImageCurrentUrl.textContent = `Current image: ${normalizedCurrentUrl}`;
  elements.coverImageCurrentUrl.classList.remove("hidden");
}

function setCoverClearVisibility(isVisible) {
  elements.coverImageClearBtn.classList.toggle("hidden", !isVisible);
}

function setCoverFileName(name) {
  const nextName = String(name || "").trim();
  elements.coverImageFileName.textContent = nextName || "No file chosen";
}

function updateContentCoverImageUi(previewUrl, currentUrl) {
  const hasPreview = Boolean(previewUrl);
  elements.contentCoverImagePreview.src = hasPreview ? previewUrl : "";
  elements.contentCoverImagePreview.classList.toggle("hidden", !hasPreview);
  elements.contentCoverImagePlaceholder.classList.toggle("hidden", hasPreview);

  const normalizedCurrentUrl = String(currentUrl || "").trim();
  if (!normalizedCurrentUrl) {
    elements.contentCoverImageCurrentUrl.textContent = "";
    elements.contentCoverImageCurrentUrl.classList.add("hidden");
    return;
  }

  elements.contentCoverImageCurrentUrl.textContent = `Current image: ${normalizedCurrentUrl}`;
  elements.contentCoverImageCurrentUrl.classList.remove("hidden");
}

function setContentCoverClearVisibility(isVisible) {
  elements.contentCoverImageClearBtn.classList.toggle("hidden", !isVisible);
}

function setContentCoverFileName(name) {
  const nextName = String(name || "").trim();
  elements.contentCoverImageFileName.textContent = nextName || "No file chosen";
}

function setContentFileClearVisibility(isVisible) {
  elements.contentFileClearBtn.classList.toggle("hidden", !isVisible);
}

function setContentFileName(name) {
  const nextName = String(name || "").trim();
  elements.contentFileName.textContent = nextName || "No file chosen";
}

function updateContentFileUrlUi(currentUrl) {
  const normalizedCurrentUrl = String(currentUrl || "").trim();
  if (!normalizedCurrentUrl) {
    elements.contentFileCurrentUrl.textContent = "";
    elements.contentFileCurrentUrl.classList.add("hidden");
    return;
  }

  elements.contentFileCurrentUrl.textContent = `Current file: ${normalizedCurrentUrl}`;
  elements.contentFileCurrentUrl.classList.remove("hidden");
}

function clearContentCoverImageSelection() {
  if (state.contentCoverPreviewObjectUrl) {
    URL.revokeObjectURL(state.contentCoverPreviewObjectUrl);
    state.contentCoverPreviewObjectUrl = null;
  }
  state.selectedContentCoverImageFile = null;
  elements.contentCoverImageInput.value = "";
  setContentCoverFileName("");
  setContentCoverClearVisibility(false);
  const existingUrl = String(elements.contentCoverUrlInput.value || "").trim();
  updateContentCoverImageUi(existingUrl, existingUrl);
}

function clearContentFileSelection() {
  state.selectedContentFile = null;
  elements.contentFileInput.value = "";
  setContentFileName("");
  setContentFileClearVisibility(false);
  const existingUrl = String(elements.fileUrlInput.value || "").trim();
  updateContentFileUrlUi(existingUrl);
}

function clearCoverImageSelection() {
  if (state.coverPreviewObjectUrl) {
    URL.revokeObjectURL(state.coverPreviewObjectUrl);
    state.coverPreviewObjectUrl = null;
  }
  state.selectedCoverImageFile = null;
  elements.coverImageInput.value = "";
  setCoverFileName("");
  setCoverClearVisibility(false);
  const existingUrl = String(state.editingManga?.cover_url || "").trim();
  updateCoverImageUi(existingUrl, existingUrl);
}

function isSupportedCoverImage(file) {
  if (!(file instanceof File)) return false;
  const name = String(file.name || "").toLowerCase();
  const isSupportedByType = file.type === "image/jpeg" || file.type === "image/png";
  const isSupportedByExt = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
  return isSupportedByType || isSupportedByExt;
}

function isSupportedContentFile(file) {
  if (!(file instanceof File)) return false;
  const name = String(file.name || "").toLowerCase();
  const contentType = String(file.type || "").toLowerCase();
  const isPdf = name.endsWith(".pdf") || contentType === "application/pdf";
  const isEpub = name.endsWith(".epub") || contentType === "application/epub+zip";
  return isPdf || isEpub;
}

function deriveFileFormatFromName(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".pdf")) return "pdf";
  if (normalized.endsWith(".epub")) return "epub";
  return "";
}

function hasUploadedContentFile(item) {
  return Boolean(String(item?.file_url || "").trim());
}

function isPdfContentItem(item) {
  const fileUrl = String(item?.file_url || "").trim();
  if (!fileUrl) return false;
  const normalizedFormat = String(item?.file_format || "").trim().toLowerCase();
  if (normalizedFormat === "pdf") return true;
  const filePath = fileUrl.split("?")[0].split("#")[0].toLowerCase();
  return filePath.endsWith(".pdf");
}

function getContentFileStatusLabel(item) {
  const hasFile = hasUploadedContentFile(item);
  const format = String(item?.file_format || "").trim().toUpperCase();
  if (format) {
    return `${format} - ${hasFile ? "Uploaded" : "No file"}`;
  }
  return hasFile ? "Uploaded" : "No file";
}

function buildReaderPreviewUrl(item) {
  const pdfUrl = String(item?.file_url || "").trim();
  if (!pdfUrl) return "";

  const url = new URL("../../library.html", window.location.href);
  const title = String(item?.title || item?.content_key || "Preview").trim();
  if (title) {
    url.searchParams.set("title", title);
  }

  const coverUrl = String(item?.cover_url || "").trim();
  if (coverUrl) {
    url.searchParams.set("cover", coverUrl);
  }

  url.searchParams.set("source", "admin");
  url.searchParams.set("pdf", pdfUrl);
  return url.toString();
}

function openContentInReader(item) {
  const readerUrl = buildReaderPreviewUrl(item);
  if (!readerUrl) {
    showContentPanelError("This content does not have a file URL yet.");
    return;
  }

  window.location.assign(readerUrl);
}

function formatBytesAsMb(bytes) {
  const mb = Number(bytes) / (1024 * 1024);
  const rounded = Math.round(mb * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(1)}`;
}

function generateMangaId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function deriveEndpoint(base, map) {
  const url = String(base || "").trim();
  for (const [fromText, toText] of map) {
    if (url.includes(fromText)) {
      return url.replace(fromText, toText);
    }
  }
  return url;
}

const endpoint = {
  get mangaGet() {
    return String(appAuthzConfig.getMangaEndpoint || "").trim();
  },
  get mangaCreate() {
    return deriveEndpoint(this.mangaGet, [["/get-manga", "/create-manga"], ["/manga", "/manga"]]);
  },
  get mangaUpdate() {
    return String(appAuthzConfig.updateMangaEndpoint || "").trim();
  },
  get mangaUploadUrl() {
    return String(appAuthzConfig.getMangaUploadUrlEndpoint || "").trim();
  },
  get mangaDelete() {
    return deriveEndpoint(this.mangaUpdate, [["/update-manga", "/delete-manga"], ["/manga", "/manga"]]);
  },
  get contentGet() {
    return String(appAuthzConfig.getMangaContentEndpoint || "").trim();
  },
  get contentCreate() {
    return deriveEndpoint(this.contentGet, [["/get-manga-content", "/create-manga-content"], ["/manga-content", "/manga-content"]]);
  },
  get contentUpdate() {
    return String(appAuthzConfig.updateMangaContentEndpoint || "").trim();
  },
  get contentDelete() {
    return deriveEndpoint(this.contentUpdate, [["/update-manga-content", "/delete-manga-content"], ["/manga-content", "/manga-content"]]);
  },
  get contentUploadUrl() {
    return String(appAuthzConfig.getMangaContentUploadUrlEndpoint || "").trim();
  },
};

function ensureInlineContentRow(afterRow) {
  if (!(afterRow instanceof HTMLTableRowElement)) return null;
  if (!state.inlineContentRow) {
    const row = document.createElement("tr");
    row.className = "inline-content-row";
    row.innerHTML = '<td colspan="6"><div class="inline-content-host"></div></td>';
    state.inlineContentRow = row;
    state.inlineContentHost = row.querySelector(".inline-content-host");
  }
  if (state.inlineContentRow.parentElement !== elements.mangaTableBody) {
    elements.mangaTableBody.appendChild(state.inlineContentRow);
  }
  if (afterRow.nextSibling !== state.inlineContentRow) {
    afterRow.insertAdjacentElement("afterend", state.inlineContentRow);
  }
  return state.inlineContentRow;
}

function clearInlineActiveRowStyles() {
  const rows = elements.mangaTableBody.querySelectorAll("tr.is-content-active");
  rows.forEach((row) => row.classList.remove("is-content-active"));
  const buttons = elements.mangaTableBody.querySelectorAll("[data-open-content]");
  buttons.forEach((button) => {
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("title", "Expand Content");
    button.setAttribute("aria-label", "Expand Content");
    button.textContent = "\u25B8";
  });
}

function syncInlineContentPanelPlacement() {
  clearInlineActiveRowStyles();
  const activeMangaId = String(state.activeManga?.manga_id || "").trim();
  setParentGridLock(Boolean(activeMangaId));
  if (!activeMangaId) {
    if (state.inlineContentRow?.isConnected) {
      state.inlineContentRow.remove();
    }
    if (elements.contentPanel?.parentElement !== elements.contentPanelStaging) {
      elements.contentPanelStaging?.appendChild(elements.contentPanel);
    }
    syncParentRowInteractivity();
    return;
  }

  const row = elements.mangaTableBody.querySelector(`tr[data-manga-id="${CSS.escape(activeMangaId)}"]`);
  if (!(row instanceof HTMLTableRowElement)) {
    if (state.inlineContentRow?.isConnected) {
      state.inlineContentRow.remove();
    }
    if (elements.contentPanel?.parentElement !== elements.contentPanelStaging) {
      elements.contentPanelStaging?.appendChild(elements.contentPanel);
    }
    syncParentRowInteractivity();
    return;
  }
  row.classList.add("is-content-active");
  const activeToggle = row.querySelector("[data-open-content]");
  if (activeToggle) {
    activeToggle.setAttribute("aria-expanded", "true");
    activeToggle.setAttribute("title", "Collapse Content");
    activeToggle.setAttribute("aria-label", "Collapse Content");
    activeToggle.textContent = "\u25BE";
  }
  ensureInlineContentRow(row);
  if (state.inlineContentHost && elements.contentPanel) {
    state.inlineContentHost.appendChild(elements.contentPanel);
  }
  syncParentRowInteractivity();
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  const isParentLocked = Boolean(state.activeManga?.manga_id);
  elements.searchInput.disabled = isParentLocked;
  elements.refreshBtn.disabled = nextBusy || isParentLocked;
  elements.addMangaBtn.disabled = nextBusy || isParentLocked;
  elements.saveMangaBtn.disabled = nextBusy;
  elements.saveContentBtn.disabled = nextBusy;
}

function setParentGridLock(isLocked) {
  elements.adminGridShell?.classList.toggle("is-locked", isLocked);
  elements.searchInput.disabled = isLocked;
  elements.refreshBtn.disabled = state.busy || isLocked;
  elements.addMangaBtn.disabled = state.busy || isLocked;
}

function syncParentRowInteractivity() {
  const isLocked = Boolean(state.activeManga?.manga_id);
  const rows = elements.mangaTableBody.querySelectorAll(":scope > tr");
  rows.forEach((row) => {
    const isActive = row.classList.contains("is-content-active");
    const toggle = row.querySelector("[data-open-content]");
    if (toggle instanceof HTMLButtonElement) {
      toggle.disabled = isLocked && !isActive;
    }
    const editBtn = row.querySelector("[data-edit-manga]");
    if (editBtn instanceof HTMLButtonElement) {
      editBtn.disabled = isLocked;
    }
    const deleteBtn = row.querySelector("[data-delete-manga]");
    if (deleteBtn instanceof HTMLButtonElement) {
      deleteBtn.disabled = isLocked;
    }
  });
}

function normalizeManga(item) {
  return {
    manga_id: String(item?.manga_id || "").trim(),
    title: String(item?.title || "").trim(),
    publisher: String(item?.publisher || "").trim(),
    series: String(item?.series || "").trim(),
    age_rating: String(item?.age_rating || "").trim(),
    japanese_title: String(item?.japanese_title || "").trim(),
    cover_url: String(item?.cover_url || "").trim(),
    synopsis: String(item?.synopsis || "").trim(),
    bisac: String(item?.bisac || "").trim(),
    sales_restriction: String(item?.sales_restriction || "").trim(),
    copyright: String(item?.copyright || "").trim(),
    keywords: Array.isArray(item?.keywords) ? item.keywords.map((v) => String(v || "").trim()).filter(Boolean) : [],
  };
}

function normalizeContent(item) {
  return {
    manga_id: String(item?.manga_id || "").trim(),
    content_key: String(item?.content_key || "").trim(),
    content_type: String(item?.content_type || "").trim(),
    sequence_number: String(item?.sequence_number ?? "").trim(),
    title: String(item?.title || "").trim(),
    external_content_id: String(item?.external_content_id || "").trim(),
    synopsis: String(item?.synopsis || "").trim(),
    author: String(item?.author || "").trim(),
    price: String(item?.price || "").trim(),
    file_format: String(item?.file_format || "").trim(),
    cover_url: String(item?.cover_url || "").trim(),
    file_url: String(item?.file_url || "").trim(),
  };
}

async function fetchMangaList() {
  const body = await requestJson(endpoint.mangaGet, {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  state.mangaItems = items.map(normalizeManga).sort((a, b) => a.title.localeCompare(b.title));
}

function applyMangaFilters() {
  const search = String(elements.searchInput.value || "").trim().toLowerCase();
  state.filteredMangaItems = state.mangaItems.filter((item) => {
    if (!search) return true;
    const haystack = [item.manga_id, item.title, item.publisher, item.series].join(" ").toLowerCase();
    return haystack.includes(search);
  });
  if (state.activeManga?.manga_id) {
    const stillVisible = state.filteredMangaItems.some((item) => item.manga_id === state.activeManga?.manga_id);
    if (!stillVisible) {
      closeContentPanel();
    }
  }
  renderMangaGrid();
}

function renderMangaGrid() {
  elements.mangaTableBody.innerHTML = "";
  if (!state.filteredMangaItems.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td class="admin-grid-empty" colspan="6">No manga records found.</td>';
    elements.mangaTableBody.appendChild(row);
    return;
  }

  const fragment = document.createDocumentFragment();
  const isGridLocked = Boolean(state.activeManga?.manga_id);
  state.filteredMangaItems.forEach((item) => {
    const mangaId = String(item.manga_id || "").trim();
    const isActive = mangaId && mangaId === String(state.activeManga?.manga_id || "").trim();
    const expandTitle = isActive ? "Collapse Content" : "Expand Content";
    const canToggle = !isGridLocked || isActive;
    const expandIcon = isActive ? "\u25BE" : "\u25B8";
    const row = document.createElement("tr");
    row.setAttribute("data-manga-id", mangaId);
    if (isActive) {
      row.classList.add("is-content-active");
    }
    row.innerHTML = `
      <td class="col-expand-cell">
        <button
          type="button"
          class="expand-toggle-btn"
          data-open-content="${escapeHtml(item.manga_id)}"
          title="${expandTitle}"
          aria-label="${expandTitle}"
          aria-expanded="${isActive ? "true" : "false"}"
          ${canToggle ? "" : "disabled"}
        >${expandIcon}</button>
      </td>
      <td class="col-cover-cell">${renderCoverThumb(item.cover_url, item.title)}</td>
      <td>${escapeHtml(item.title || "-")}</td>
      <td>${escapeHtml(item.publisher || "-")}</td>
      <td>${escapeHtml(item.series || "-")}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="row-action-btn icon-action-btn" data-edit-manga="${escapeHtml(item.manga_id)}" title="Edit" aria-label="Edit" ${isGridLocked ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h4l10-10-4-4L4 16v4z"></path>
              <path d="M13 7l4 4"></path>
            </svg>
          </button>
          <button type="button" class="row-action-btn icon-action-btn icon-delete-btn" data-delete-manga="${escapeHtml(item.manga_id)}" title="Delete" aria-label="Delete" ${isGridLocked ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-.78 11.2A2 2 0 0 1 15.22 19H8.78a2 2 0 0 1-1.99-1.8L6 6H5a1 1 0 1 1 0-2h4zm2 0h2V3h-2v1zm-1 4a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1zm4 0a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z"></path>
            </svg>
          </button>
        </div>
      </td>
    `;
    fragment.appendChild(row);
  });

  elements.mangaTableBody.appendChild(fragment);
  syncInlineContentPanelPlacement();
  bindCoverThumbFallbacks(elements.mangaTableBody);
}

function openMangaModal(mode, item = null) {
  state.mangaMode = mode;
  state.editingManga = item;
  clearMangaModalError();
  elements.mangaModalTitle.textContent = mode === "update" ? "Edit Manga" : "Add Manga";

  elements.mangaIdInput.value = mode === "update" ? item?.manga_id || "" : generateMangaId();
  elements.mangaIdInput.readOnly = mode === "update";
  elements.titleInput.value = item?.title || "";
  elements.publisherInput.value = item?.publisher || "";
  elements.seriesInput.value = item?.series || "";
  elements.ageRatingInput.value = item?.age_rating || "";
  elements.japaneseTitleInput.value = item?.japanese_title || "";
  elements.keywordsInput.value = Array.isArray(item?.keywords) ? item.keywords.join(", ") : "";
  elements.synopsisInput.value = item?.synopsis || "";
  elements.bisacInput.value = item?.bisac || "";
  elements.salesRestrictionInput.value = item?.sales_restriction || "";
  elements.copyrightInput.value = item?.copyright || "";
  clearCoverImageSelection();
  const currentCoverUrl = String(item?.cover_url || "").trim();
  updateCoverImageUi(currentCoverUrl, currentCoverUrl);

  elements.mangaModal.classList.remove("hidden");
  elements.mangaModal.setAttribute("aria-hidden", "false");
}

function closeMangaModal() {
  state.editingManga = null;
  clearCoverImageSelection();
  elements.mangaModal.classList.add("hidden");
  elements.mangaModal.setAttribute("aria-hidden", "true");
}

function buildMangaPayload() {
  const mangaId = String(elements.mangaIdInput.value || "").trim();
  const keywordList = String(elements.keywordsInput.value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    manga_id: mangaId,
    title: String(elements.titleInput.value || "").trim(),
    publisher: String(elements.publisherInput.value || "").trim(),
    series: String(elements.seriesInput.value || "").trim(),
    age_rating: String(elements.ageRatingInput.value || "").trim(),
    japanese_title: String(elements.japaneseTitleInput.value || "").trim(),
    cover_url: String(state.editingManga?.cover_url || "").trim(),
    keywords: keywordList,
    synopsis: String(elements.synopsisInput.value || "").trim(),
    bisac: String(elements.bisacInput.value || "").trim(),
    sales_restriction: String(elements.salesRestrictionInput.value || "").trim(),
    copyright: String(elements.copyrightInput.value || "").trim(),
  };
}

async function uploadCoverImageAndPersist(mangaId, payloadBase, file) {
  const uploadResponse = await requestJson(endpoint.mangaUploadUrl, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      manga_id: mangaId,
      file_kind: "cover",
      file_name: file.name,
      content_type: file.type || "application/octet-stream",
      file_size: file.size,
      manga_slug: payloadBase.series || payloadBase.title || "",
    }),
  });
  const uploadData = responseData(uploadResponse);
  const uploadUrl = String(uploadData.upload_url || "").trim();
  const coverUrl = String(uploadData.file_url || uploadData.s3_url || "").trim();
  if (!uploadUrl || !coverUrl) {
    throw new Error("Upload URL response is missing required fields.");
  }

  const uploadResult = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!uploadResult.ok) {
    throw new Error(`Cover upload failed (${uploadResult.status}).`);
  }

  await requestJson(endpoint.mangaUpdate, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({
      manga_id: mangaId,
      cover_url: coverUrl,
    }),
  });

  return coverUrl;
}

async function saveManga(event) {
  event.preventDefault();
  clearMangaModalError();

  const payload = buildMangaPayload();
  const selectedCoverFile = state.selectedCoverImageFile;
  let metadataSaved = false;
  if (!payload.manga_id && state.mangaMode === "create") {
    payload.manga_id = generateMangaId();
    elements.mangaIdInput.value = payload.manga_id;
  }
  if (!payload.manga_id) {
    showMangaModalError("manga_id is required.");
    return;
  }

  const isCreate = state.mangaMode === "create";
  const method = isCreate ? "POST" : "PUT";
  const url = isCreate ? endpoint.mangaCreate : endpoint.mangaUpdate;

  try {
    setBusy(true);
    await requestJson(url, {
      method,
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    metadataSaved = true;
    if (selectedCoverFile) {
      const nextCoverUrl = await uploadCoverImageAndPersist(payload.manga_id, payload, selectedCoverFile);
      payload.cover_url = nextCoverUrl;
    }
    showSuccess(isCreate ? "Manga created." : "Manga updated.");
    closeMangaModal();
    await refreshMangaGrid();
  } catch (error) {
    if (metadataSaved && isCreate) {
      state.mangaMode = "update";
      elements.mangaModalTitle.textContent = "Edit Manga";
      elements.mangaIdInput.readOnly = true;
      state.editingManga = {
        ...payload,
      };
      await refreshMangaGrid();
    }
    showMangaModalError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function deleteManga(mangaId) {
  if (!window.confirm("Are you sure you want to delete this manga?")) {
    return;
  }
  try {
    setBusy(true);
    await requestJson(endpoint.mangaDelete, {
      method: "DELETE",
      headers: jsonHeaders(),
      body: JSON.stringify({ manga_id: mangaId }),
    });
    showSuccess("Manga deleted.");
    await refreshMangaGrid();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function openContentPanel(mangaId) {
  const manga = state.mangaItems.find((item) => item.manga_id === mangaId);
  if (!manga) {
    showError("Manga not found.");
    return;
  }

  state.activeManga = manga;
  setParentGridLock(true);
  clearInlineActiveRowStyles();
  const selectedRow = elements.mangaTableBody.querySelector(`tr[data-manga-id="${CSS.escape(manga.manga_id)}"]`);
  if (selectedRow instanceof HTMLTableRowElement) {
    selectedRow.classList.add("is-content-active");
    const selectedToggle = selectedRow.querySelector("[data-open-content]");
    if (selectedToggle) {
      selectedToggle.setAttribute("aria-expanded", "true");
      selectedToggle.setAttribute("title", "Collapse Content");
      selectedToggle.setAttribute("aria-label", "Collapse Content");
      selectedToggle.textContent = "\u25BE";
    }
  }
  clearContentPanelError();

  try {
    const url = new URL(endpoint.contentGet);
    url.searchParams.set("manga_id", manga.manga_id);
    const body = await requestJson(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${state.session.accessToken}` },
    });
    const data = responseData(body);
    const items = Array.isArray(data?.items) ? data.items : [];
    state.contentItems = items.map(normalizeContent).sort((a, b) => a.content_key.localeCompare(b.content_key));
    renderContentGrid();
    syncInlineContentPanelPlacement();
  } catch (error) {
    showContentPanelError(error instanceof Error ? error.message : String(error));
  }
}

function closeContentPanel() {
  state.activeManga = null;
  state.contentItems = [];
  setParentGridLock(false);
  clearInlineActiveRowStyles();
  if (state.inlineContentRow?.isConnected) {
    state.inlineContentRow.remove();
  }
  if (elements.contentPanel?.parentElement !== elements.contentPanelStaging) {
    elements.contentPanelStaging?.appendChild(elements.contentPanel);
  }
}

function renderContentGrid() {
  elements.contentTableBody.innerHTML = "";
  if (!state.contentItems.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td class="admin-grid-empty" colspan="6">No child content records.</td>';
    elements.contentTableBody.appendChild(row);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.contentItems.forEach((item) => {
    const contentKey = escapeHtml(item.content_key);
    const fileStatusLabel = getContentFileStatusLabel(item);
    const canViewInReader = isPdfContentItem(item);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="col-cover-cell">${renderCoverThumb(item.cover_url, item.title || item.content_key)}</td>
      <td>${escapeHtml(item.content_type || "-")}</td>
      <td>${escapeHtml(item.sequence_number || "-")}</td>
      <td>${escapeHtml(item.title || "-")}</td>
      <td>${escapeHtml(fileStatusLabel)}</td>
      <td class="col-action-cell">
        <div class="row-actions">
          ${
            canViewInReader
              ? `
          <button type="button" class="row-action-btn icon-action-btn" data-view-content="${contentKey}" title="View PDF" aria-label="View PDF">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          `
              : ""
          }
          <button type="button" class="row-action-btn icon-action-btn" data-edit-content="${contentKey}" title="Edit" aria-label="Edit">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h4l10-10-4-4L4 16v4z"></path>
              <path d="M13 7l4 4"></path>
            </svg>
          </button>
          <button type="button" class="row-action-btn icon-action-btn icon-delete-btn" data-delete-content="${contentKey}" title="Delete" aria-label="Delete">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-.78 11.2A2 2 0 0 1 15.22 19H8.78a2 2 0 0 1-1.99-1.8L6 6H5a1 1 0 1 1 0-2h4zm2 0h2V3h-2v1zm-1 4a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1zm4 0a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z"></path>
            </svg>
          </button>
        </div>
      </td>
    `;
    fragment.appendChild(row);
  });
  elements.contentTableBody.appendChild(fragment);
  bindCoverThumbFallbacks(elements.contentTableBody);
}

function openContentModal(mode, item = null) {
  state.contentMode = mode;
  state.editingContent = item;
  clearContentModalError();

  const mangaId = state.activeManga?.manga_id || item?.manga_id || "";
  elements.contentModalTitle.textContent = mode === "update" ? "Edit Content" : "Add Content";
  elements.contentMangaIdInput.value = mangaId;
  elements.contentKeyInput.value = item?.content_key || "";
  const existingType = String(item?.content_type || "").trim().toLowerCase();
  if (existingType === "volume") {
    elements.contentTypeInput.value = "Volume";
  } else if (existingType === "chapter") {
    elements.contentTypeInput.value = "Chapter";
  } else {
    elements.contentTypeInput.value = "Volume";
  }
  elements.contentTypeInput.disabled = mode === "update";
  elements.sequenceNumberInput.value = item?.sequence_number || "";
  elements.sequenceNumberInput.readOnly = mode === "update";
  elements.contentTitleInput.value = item?.title || "";
  elements.externalContentIdInput.value = item?.external_content_id || "";
  elements.contentAuthorInput.value = item?.author || "";
  elements.priceInput.value = item?.price || "";
  elements.fileFormatInput.value = item?.file_format || "";
  elements.contentCoverUrlInput.value = item?.cover_url || "";
  elements.fileUrlInput.value = item?.file_url || "";
  elements.contentSynopsisInput.value = item?.synopsis || "";
  clearContentCoverImageSelection();
  clearContentFileSelection();
  const currentCoverUrl = String(item?.cover_url || "").trim();
  updateContentCoverImageUi(currentCoverUrl, currentCoverUrl);
  updateContentFileUrlUi(String(item?.file_url || "").trim());

  elements.contentModal.classList.remove("hidden");
  elements.contentModal.setAttribute("aria-hidden", "false");
}

function closeContentModal() {
  state.editingContent = null;
  clearContentCoverImageSelection();
  clearContentFileSelection();
  elements.contentModal.classList.add("hidden");
  elements.contentModal.setAttribute("aria-hidden", "true");
}

function buildContentKey(contentType, sequenceNumber) {
  const normalizedType = String(contentType || "").trim();
  const normalizedSequence = Number(sequenceNumber);
  if (!normalizedType || !Number.isFinite(normalizedSequence) || normalizedSequence <= 0) {
    return "";
  }
  return `${normalizedType.toUpperCase()}#${String(Math.trunc(normalizedSequence)).padStart(4, "0")}`;
}

function buildContentPayload() {
  const normalizedType = String(elements.contentTypeInput.value || "").trim();
  const sequenceText = String(elements.sequenceNumberInput.value || "").trim();
  const parsedSequence = Number(sequenceText);
  let contentKey = String(elements.contentKeyInput.value || "").trim();
  if (state.contentMode === "create") {
    contentKey = buildContentKey(normalizedType, parsedSequence);
    elements.contentKeyInput.value = contentKey;
  }

  const payload = {
    manga_id: String(elements.contentMangaIdInput.value || "").trim(),
    content_key: contentKey,
    content_type: normalizedType,
    sequence_number: sequenceText,
    title: String(elements.contentTitleInput.value || "").trim(),
    external_content_id: String(elements.externalContentIdInput.value || "").trim(),
    synopsis: String(elements.contentSynopsisInput.value || "").trim(),
    author: String(elements.contentAuthorInput.value || "").trim(),
    price: String(elements.priceInput.value || "").trim(),
    file_format: String(elements.fileFormatInput.value || "").trim(),
    cover_url: String(elements.contentCoverUrlInput.value || "").trim(),
    file_url: String(elements.fileUrlInput.value || "").trim(),
  };

  if (!payload.sequence_number) {
    delete payload.sequence_number;
  } else {
    payload.sequence_number = Number(payload.sequence_number);
  }

  return payload;
}

async function uploadContentFileAndPersist(payloadBase, fileKind, file) {
  const uploadResponse = await requestJson(endpoint.contentUploadUrl, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      manga_id: payloadBase.manga_id,
      content_key: payloadBase.content_key,
      content_type: payloadBase.content_type,
      sequence_number: payloadBase.sequence_number,
      file_kind: fileKind,
      file_name: file.name,
      content_type: file.type || "application/octet-stream",
      file_size: file.size,
      manga_slug: state.activeManga?.series || state.activeManga?.title || "",
    }),
  });
  const uploadData = responseData(uploadResponse);
  const uploadUrl = String(uploadData.upload_url || "").trim();
  const fileUrl = String(uploadData.file_url || uploadData.s3_url || "").trim();
  if (!uploadUrl || !fileUrl) {
    throw new Error("Upload URL response is missing required fields.");
  }

  const uploadResult = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!uploadResult.ok) {
    throw new Error(`${fileKind === "cover" ? "Cover image" : "Content file"} upload failed (${uploadResult.status}).`);
  }

  const updatePayload = {
    manga_id: payloadBase.manga_id,
    content_key: payloadBase.content_key,
  };
  if (fileKind === "cover") {
    updatePayload.cover_url = fileUrl;
  } else {
    updatePayload.file_url = fileUrl;
    const currentFormat = String(payloadBase.file_format || "").trim();
    if (!currentFormat) {
      const inferred = deriveFileFormatFromName(file.name);
      if (inferred) {
        updatePayload.file_format = inferred;
      }
    }
  }

  await requestJson(endpoint.contentUpdate, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify(updatePayload),
  });

  return fileUrl;
}

async function saveContent(event) {
  event.preventDefault();
  clearContentModalError();

  const payload = buildContentPayload();
  const selectedCoverFile = state.selectedContentCoverImageFile;
  const selectedContentFile = state.selectedContentFile;
  let metadataSaved = false;
  if (!payload.manga_id || !payload.content_key) {
    showContentModalError("manga_id and content_key are required.");
    return;
  }
  if (payload.content_type !== "Volume" && payload.content_type !== "Chapter") {
    showContentModalError("Type is required. Select Volume or Chapter.");
    return;
  }

  const isCreate = state.contentMode === "create";
  const method = isCreate ? "POST" : "PUT";
  const url = isCreate ? endpoint.contentCreate : endpoint.contentUpdate;

  try {
    setBusy(true);
    await requestJson(url, {
      method,
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    metadataSaved = true;
    if (selectedCoverFile) {
      const nextCoverUrl = await uploadContentFileAndPersist(payload, "cover", selectedCoverFile);
      payload.cover_url = nextCoverUrl;
      elements.contentCoverUrlInput.value = nextCoverUrl;
    }
    if (selectedContentFile) {
      const nextFileUrl = await uploadContentFileAndPersist(payload, "file", selectedContentFile);
      payload.file_url = nextFileUrl;
      elements.fileUrlInput.value = nextFileUrl;
      if (!payload.file_format) {
        payload.file_format = deriveFileFormatFromName(selectedContentFile.name);
      }
    }
    showSuccess(isCreate ? "Content created." : "Content updated.");
    closeContentModal();
    await openContentPanel(payload.manga_id);
    await refreshMangaGrid();
  } catch (error) {
    if (metadataSaved && isCreate) {
      state.contentMode = "update";
      elements.contentModalTitle.textContent = "Edit Content";
      state.editingContent = {
        ...payload,
      };
    }
    showContentModalError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function deleteContent(contentKey) {
  const mangaId = state.activeManga?.manga_id;
  if (!mangaId) return;
  if (!window.confirm("Are you sure you want to delete this record?")) {
    return;
  }

  try {
    setBusy(true);
    await requestJson(endpoint.contentDelete, {
      method: "DELETE",
      headers: jsonHeaders(),
      body: JSON.stringify({ manga_id: mangaId, content_key: contentKey }),
    });
    showSuccess("Content deleted.");
    await openContentPanel(mangaId);
    await refreshMangaGrid();
  } catch (error) {
    showContentPanelError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function refreshMangaGrid() {
  clearError();
  setBusy(true);
  try {
    await fetchMangaList();
    if (state.activeManga?.manga_id) {
      const nextActive = state.mangaItems.find((item) => item.manga_id === state.activeManga?.manga_id) || null;
      if (!nextActive) {
        closeContentPanel();
      } else {
        state.activeManga = nextActive;
      }
    }
    applyMangaFilters();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

function wireEvents() {
  elements.searchInput.addEventListener("input", applyMangaFilters);
  elements.refreshBtn.addEventListener("click", () => void refreshMangaGrid());
  elements.addMangaBtn.addEventListener("click", () => openMangaModal("create"));

  elements.mangaTableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const openBtn = target.closest("[data-open-content]");
    if (openBtn instanceof Element) {
      const mangaId = String(openBtn.getAttribute("data-open-content") || "").trim();
      const isSameManga = mangaId && mangaId === String(state.activeManga?.manga_id || "").trim();
      if (isSameManga && state.inlineContentRow?.isConnected) {
        closeContentPanel();
        renderMangaGrid();
        return;
      }
      void openContentPanel(mangaId);
      return;
    }

    const editBtn = target.closest("[data-edit-manga]");
    if (editBtn instanceof Element) {
      const mangaId = String(editBtn.getAttribute("data-edit-manga") || "").trim();
      const item = state.mangaItems.find((entry) => entry.manga_id === mangaId);
      if (item) openMangaModal("update", item);
      return;
    }

    const deleteBtn = target.closest("[data-delete-manga]");
    if (deleteBtn instanceof Element) {
      const mangaId = String(deleteBtn.getAttribute("data-delete-manga") || "").trim();
      void deleteManga(mangaId);
    }
  });

  elements.contentTableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const viewBtn = target.closest("[data-view-content]");
    if (viewBtn instanceof Element) {
      const contentKey = String(viewBtn.getAttribute("data-view-content") || "").trim();
      const item = state.contentItems.find((entry) => entry.content_key === contentKey);
      if (item) {
        clearContentPanelError();
        openContentInReader(item);
      }
      return;
    }

    const editBtn = target.closest("[data-edit-content]");
    if (editBtn instanceof Element) {
      const contentKey = String(editBtn.getAttribute("data-edit-content") || "").trim();
      const item = state.contentItems.find((entry) => entry.content_key === contentKey);
      if (item) openContentModal("update", item);
      return;
    }

    const deleteBtn = target.closest("[data-delete-content]");
    if (deleteBtn instanceof Element) {
      const contentKey = String(deleteBtn.getAttribute("data-delete-content") || "").trim();
      void deleteContent(contentKey);
    }
  });

  elements.mangaForm.addEventListener("submit", (event) => void saveManga(event));
  elements.contentForm.addEventListener("submit", (event) => void saveContent(event));
  elements.coverImageInput.addEventListener("change", () => {
    const nextFile = elements.coverImageInput.files?.[0] || null;
    if (!nextFile) {
      state.selectedCoverImageFile = null;
      setCoverFileName("");
      setCoverClearVisibility(false);
      const existingUrl = String(state.editingManga?.cover_url || "").trim();
      updateCoverImageUi(existingUrl, existingUrl);
      return;
    }
    if (!isSupportedCoverImage(nextFile)) {
      state.selectedCoverImageFile = null;
      elements.coverImageInput.value = "";
      setCoverFileName("");
      setCoverClearVisibility(false);
      showMangaModalError("Cover Image must be a JPG or PNG file.");
      const existingUrl = String(state.editingManga?.cover_url || "").trim();
      updateCoverImageUi(existingUrl, existingUrl);
      return;
    }
    if (nextFile.size > COVER_IMAGE_MAX_UPLOAD_BYTES) {
      state.selectedCoverImageFile = null;
      elements.coverImageInput.value = "";
      setCoverFileName("");
      setCoverClearVisibility(false);
      showMangaModalError(
        `Cover Image must be ${formatBytesAsMb(COVER_IMAGE_MAX_UPLOAD_BYTES)} MB or smaller.`
      );
      const existingUrl = String(state.editingManga?.cover_url || "").trim();
      updateCoverImageUi(existingUrl, existingUrl);
      return;
    }

    clearMangaModalError();
    state.selectedCoverImageFile = nextFile;
    if (state.coverPreviewObjectUrl) {
      URL.revokeObjectURL(state.coverPreviewObjectUrl);
      state.coverPreviewObjectUrl = null;
    }
    const previewUrl = URL.createObjectURL(nextFile);
    state.coverPreviewObjectUrl = previewUrl;
    updateCoverImageUi(previewUrl, String(state.editingManga?.cover_url || "").trim());
    setCoverFileName(nextFile.name);
    setCoverClearVisibility(true);
  });
  elements.coverImageClearBtn.addEventListener("click", () => {
    clearMangaModalError();
    clearCoverImageSelection();
  });
  elements.contentCoverImageInput.addEventListener("change", () => {
    const nextFile = elements.contentCoverImageInput.files?.[0] || null;
    if (!nextFile) {
      state.selectedContentCoverImageFile = null;
      setContentCoverFileName("");
      setContentCoverClearVisibility(false);
      const existingUrl = String(elements.contentCoverUrlInput.value || "").trim();
      updateContentCoverImageUi(existingUrl, existingUrl);
      return;
    }
    if (!isSupportedCoverImage(nextFile)) {
      state.selectedContentCoverImageFile = null;
      elements.contentCoverImageInput.value = "";
      setContentCoverFileName("");
      setContentCoverClearVisibility(false);
      showContentModalError("Cover Image must be a JPG or PNG file.");
      const existingUrl = String(elements.contentCoverUrlInput.value || "").trim();
      updateContentCoverImageUi(existingUrl, existingUrl);
      return;
    }
    if (nextFile.size > CONTENT_COVER_IMAGE_MAX_UPLOAD_BYTES) {
      state.selectedContentCoverImageFile = null;
      elements.contentCoverImageInput.value = "";
      setContentCoverFileName("");
      setContentCoverClearVisibility(false);
      showContentModalError(
        `Cover Image must be ${formatBytesAsMb(CONTENT_COVER_IMAGE_MAX_UPLOAD_BYTES)} MB or smaller.`
      );
      const existingUrl = String(elements.contentCoverUrlInput.value || "").trim();
      updateContentCoverImageUi(existingUrl, existingUrl);
      return;
    }

    clearContentModalError();
    state.selectedContentCoverImageFile = nextFile;
    if (state.contentCoverPreviewObjectUrl) {
      URL.revokeObjectURL(state.contentCoverPreviewObjectUrl);
      state.contentCoverPreviewObjectUrl = null;
    }
    const previewUrl = URL.createObjectURL(nextFile);
    state.contentCoverPreviewObjectUrl = previewUrl;
    updateContentCoverImageUi(previewUrl, String(elements.contentCoverUrlInput.value || "").trim());
    setContentCoverFileName(nextFile.name);
    setContentCoverClearVisibility(true);
  });
  elements.contentCoverImageClearBtn.addEventListener("click", () => {
    clearContentModalError();
    clearContentCoverImageSelection();
  });
  elements.contentFileInput.addEventListener("change", () => {
    const nextFile = elements.contentFileInput.files?.[0] || null;
    if (!nextFile) {
      state.selectedContentFile = null;
      setContentFileName("");
      setContentFileClearVisibility(false);
      updateContentFileUrlUi(String(elements.fileUrlInput.value || "").trim());
      return;
    }
    if (!isSupportedContentFile(nextFile)) {
      state.selectedContentFile = null;
      elements.contentFileInput.value = "";
      setContentFileName("");
      setContentFileClearVisibility(false);
      showContentModalError("Content file must be a PDF or EPUB.");
      updateContentFileUrlUi(String(elements.fileUrlInput.value || "").trim());
      return;
    }

    clearContentModalError();
    state.selectedContentFile = nextFile;
    const inferredFormat = deriveFileFormatFromName(nextFile.name);
    if (inferredFormat && !String(elements.fileFormatInput.value || "").trim()) {
      elements.fileFormatInput.value = inferredFormat;
    }
    setContentFileName(nextFile.name);
    setContentFileClearVisibility(true);
    updateContentFileUrlUi(String(elements.fileUrlInput.value || "").trim());
  });
  elements.contentFileClearBtn.addEventListener("click", () => {
    clearContentModalError();
    clearContentFileSelection();
  });

  elements.closeMangaModalBtn.addEventListener("click", closeMangaModal);
  elements.cancelMangaBtn.addEventListener("click", closeMangaModal);
  elements.addContentBtn.addEventListener("click", () => openContentModal("create"));
  elements.closeContentModalBtn.addEventListener("click", closeContentModal);
  elements.cancelContentBtn.addEventListener("click", closeContentModal);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("[data-close-manga-modal='true']")) closeMangaModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeMangaModal();
  });

  elements.signoutLinks.forEach((link) => link.addEventListener("click", () => clearAuthSession()));
}

async function init() {
  if (!ensureAdminSession()) return;

  if (!mangaApiConfigLooksReady()) {
    showError("Manga API endpoints are not configured in auth-config.js.");
    return;
  }
  if (!mangaUploadApiConfigLooksReady()) {
    showError("Manga upload URL endpoint is not configured in auth-config.js.");
    return;
  }
  if (!mangaContentApiConfigLooksReady()) {
    showError("Content API endpoints are not configured in auth-config.js.");
    return;
  }
  if (!mangaContentUploadApiConfigLooksReady()) {
    showError("Content upload URL endpoint is not configured in auth-config.js.");
    return;
  }

  wireAccountIdentity();
  wireEvents();
  await refreshMangaGrid();
}

void init();
