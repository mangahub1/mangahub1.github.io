import {
  appAuthzConfig,
  appUploadConfig,
  mangaApiConfigLooksReady,
  mangaContentApiConfigLooksReady,
  mangaContentUploadApiConfigLooksReady,
  mangaTaxonomyApiConfigLooksReady,
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
  categoryOptions: [],
  genreOptions: [],
  categoryNameById: new Map(),
  genreNameById: new Map(),
  searchQuery: "",
  searchGenreId: "",
  searchCategoryId: "",
  contentItems: [],
  contentItemsByManga: new Map(),
  expandedMangaIds: new Set(),
  loadingContentMangaIds: new Set(),
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
  searchGenreInput: document.getElementById("searchGenreInput"),
  searchCategoryInput: document.getElementById("searchCategoryInput"),
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
  ageRatingInput: document.getElementById("ageRatingInput"),
  japaneseTitleInput: document.getElementById("japaneseTitleInput"),
  coverImageInput: document.getElementById("coverImageInput"),
  coverImageFileName: document.getElementById("coverImageFileName"),
  coverImageClearBtn: document.getElementById("coverImageClearBtn"),
  coverImagePreview: document.getElementById("coverImagePreview"),
  coverImagePlaceholder: document.getElementById("coverImagePlaceholder"),
  coverImageCurrentUrl: document.getElementById("coverImageCurrentUrl"),
  categoryIdsInput: document.getElementById("categoryIdsInput"),
  genreIdsInput: document.getElementById("genreIdsInput"),
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

let searchRefreshTimer = 0;
const SEARCH_INPUT_DEBOUNCE_MS = 1000;

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

function normalizeIdList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (value === null || value === undefined || value === "") {
    return [];
  }
  return [String(value).trim()].filter(Boolean);
}

function selectedOptionsAsIds(selectElement) {
  if (!(selectElement instanceof HTMLSelectElement)) return [];
  return Array.from(selectElement.selectedOptions)
    .map((option) => String(option.value || "").trim())
    .filter(Boolean);
}

function setMultiSelectValues(selectElement, values) {
  if (!(selectElement instanceof HTMLSelectElement)) return;
  const wanted = new Set(normalizeIdList(values));
  Array.from(selectElement.options).forEach((option) => {
    option.selected = wanted.has(option.value);
  });
}

function renderLookupSelect(selectElement, items, placeholder) {
  if (!(selectElement instanceof HTMLSelectElement)) return;
  const safeItems = Array.isArray(items) ? items : [];
  const hasItems = safeItems.length > 0;
  const optionsMarkup = hasItems
    ? safeItems
        .map(
          (item) =>
            `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)}</option>`
        )
        .join("")
    : `<option value="" disabled>${escapeHtml(placeholder)}</option>`;
  selectElement.innerHTML = optionsMarkup;
  selectElement.disabled = !hasItems;
}

function renderSearchLookupSelect(selectElement, items, allLabel, selectedValue = "") {
  if (!(selectElement instanceof HTMLSelectElement)) return;
  const safeItems = Array.isArray(items) ? items : [];
  const optionsMarkup =
    `<option value="">${escapeHtml(allLabel)}</option>` +
    safeItems
      .map(
        (item) =>
          `<option value="${escapeHtml(item.id)}"${item.id === selectedValue ? " selected" : ""}>${escapeHtml(item.name || item.id)}</option>`
      )
      .join("");
  selectElement.innerHTML = optionsMarkup;
}

function idsToLabel(ids, nameById) {
  const values = normalizeIdList(ids);
  if (!values.length) return "-";
  const labels = values.map((id) => nameById.get(id) || id);
  return labels.join(", ");
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

function detectContentFileFormat(item) {
  const fileUrl = String(item?.file_url || "").trim();
  if (!fileUrl) return "";
  const normalizedFormat = String(item?.file_format || "").trim().toLowerCase();
  if (normalizedFormat === "pdf" || normalizedFormat === "epub") {
    return normalizedFormat;
  }
  const filePath = fileUrl.split("?")[0].split("#")[0].toLowerCase();
  if (filePath.endsWith(".pdf")) return "pdf";
  if (filePath.endsWith(".epub")) return "epub";
  return "";
}

function isReadableContentItem(item) {
  const format = detectContentFileFormat(item);
  return format === "pdf" || format === "epub";
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
  const fileUrl = String(item?.file_url || "").trim();
  if (!fileUrl) return "";
  const format = detectContentFileFormat(item);
  if (!format) return "";

  const url = new URL(format === "epub" ? "../../epub-reader.html" : "../../library.html", window.location.href);
  const title = String(item?.title || item?.content_key || "Preview").trim();
  if (title) {
    url.searchParams.set("title", title);
  }

  const coverUrl = String(item?.cover_url || "").trim();
  if (coverUrl) {
    url.searchParams.set("cover", coverUrl);
  }

  url.searchParams.set("source", "admin");
  url.searchParams.set(format, fileUrl);
  return url.toString();
}

function openContentInReader(item) {
  const readerUrl = buildReaderPreviewUrl(item);
  if (!readerUrl) {
    showError("This content does not have a file URL yet.");
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
  get categoryGet() {
    return String(appAuthzConfig.getCategoryEndpoint || "").trim();
  },
  get genreGet() {
    return String(appAuthzConfig.getGenreEndpoint || "").trim();
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

function setBusy(nextBusy, options = {}) {
  const keepSearchEnabled = Boolean(options.keepSearchEnabled);
  state.busy = nextBusy;
  elements.searchInput.disabled = keepSearchEnabled ? false : nextBusy;
  elements.searchGenreInput.disabled = keepSearchEnabled ? false : nextBusy;
  elements.searchCategoryInput.disabled = keepSearchEnabled ? false : nextBusy;
  elements.refreshBtn.disabled = nextBusy;
  elements.addMangaBtn.disabled = nextBusy;
  elements.saveMangaBtn.disabled = nextBusy;
  elements.saveContentBtn.disabled = nextBusy;
}

function setActiveMangaById(mangaId) {
  const normalized = String(mangaId || "").trim();
  state.activeManga = state.mangaItems.find((item) => item.manga_id === normalized) || null;
  return state.activeManga;
}

async function fetchContentForManga(mangaId) {
  const manga = state.mangaItems.find((item) => item.manga_id === mangaId);
  if (!manga) {
    throw new Error("Manga not found.");
  }
  const url = new URL(endpoint.contentGet);
  url.searchParams.set("manga_id", manga.manga_id);
  const body = await requestJson(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map(normalizeContent).sort((a, b) => a.content_key.localeCompare(b.content_key));
}

function renderInlineContentRow(mangaId) {
  const row = document.createElement("tr");
  row.className = "inline-content-row";
  row.setAttribute("data-inline-content-for", mangaId);

  const isLoading = state.loadingContentMangaIds.has(mangaId);
  const contentItems = state.contentItemsByManga.get(mangaId) || [];
  const contentRows = isLoading
    ? '<tr><td class="admin-grid-empty" colspan="6">Loading child content...</td></tr>'
    : !contentItems.length
      ? '<tr><td class="admin-grid-empty" colspan="6">No child content records.</td></tr>'
      : contentItems
          .map((item) => {
            const contentKey = escapeHtml(item.content_key);
            const fileStatusLabel = getContentFileStatusLabel(item);
            const fileFormat = detectContentFileFormat(item);
            const canViewInReader = isReadableContentItem(item);
            const viewLabel = fileFormat ? `View ${fileFormat.toUpperCase()}` : "View";
            return `
              <tr>
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
                    <button type="button" class="row-action-btn icon-action-btn" data-view-content="${contentKey}" data-content-manga-id="${escapeHtml(mangaId)}" title="${escapeHtml(viewLabel)}" aria-label="${escapeHtml(viewLabel)}">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    </button>
                    `
                        : ""
                    }
                    <button type="button" class="row-action-btn icon-action-btn" data-edit-content="${contentKey}" data-content-manga-id="${escapeHtml(mangaId)}" title="Edit" aria-label="Edit">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20h4l10-10-4-4L4 16v4z"></path>
                        <path d="M13 7l4 4"></path>
                      </svg>
                    </button>
                    <button type="button" class="row-action-btn icon-action-btn icon-delete-btn" data-delete-content="${contentKey}" data-content-manga-id="${escapeHtml(mangaId)}" title="Delete" aria-label="Delete">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-.78 11.2A2 2 0 0 1 15.22 19H8.78a2 2 0 0 1-1.99-1.8L6 6H5a1 1 0 1 1 0-2h4zm2 0h2V3h-2v1zm-1 4a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1zm4 0a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z"></path>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("");

  row.innerHTML = `
    <td colspan="7">
      <div class="content-inline-panel" role="region" aria-label="Content">
        <section class="drawer-controls">
          <button type="button" class="admin-btn" data-add-content-for="${escapeHtml(mangaId)}" title="Add New Manga Content" aria-label="Add New Manga Content">Add New</button>
        </section>
        <div class="admin-grid-wrap">
          <table class="admin-grid child-grid">
            <thead>
              <tr>
                <th class="col-cover">&nbsp;</th>
                <th>Type</th>
                <th>Seq</th>
                <th>Title</th>
                <th>Format</th>
                <th class="col-action">&nbsp;</th>
              </tr>
            </thead>
            <tbody>${contentRows}</tbody>
          </table>
        </div>
      </div>
    </td>
  `;

  return row;
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
    category_ids: normalizeIdList(item?.category_ids),
    genre_ids: normalizeIdList(item?.genre_ids),
  };
}

function normalizeLookupItem(item, idKey) {
  const id = String(item?.[idKey] || "").trim();
  const name = String(item?.name || "").trim();
  if (!id) return null;
  return { id, name: name || id };
}

async function fetchCategoryList() {
  const body = await requestJson(endpoint.categoryGet, {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  const normalized = items
    .map((item) => normalizeLookupItem(item, "category_id"))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  state.categoryOptions = normalized;
  state.categoryNameById = new Map(normalized.map((item) => [item.id, item.name]));
  renderLookupSelect(elements.categoryIdsInput, normalized, "No categories found");
  renderSearchLookupSelect(
    elements.searchCategoryInput,
    normalized,
    "All Categories",
    state.searchCategoryId
  );
}

async function fetchGenreList() {
  const body = await requestJson(endpoint.genreGet, {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  const normalized = items
    .map((item) => normalizeLookupItem(item, "genre_id"))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  state.genreOptions = normalized;
  state.genreNameById = new Map(normalized.map((item) => [item.id, item.name]));
  renderLookupSelect(elements.genreIdsInput, normalized, "No genres found");
  renderSearchLookupSelect(
    elements.searchGenreInput,
    normalized,
    "All Genres",
    state.searchGenreId
  );
}

async function refreshTaxonomyOptions() {
  await Promise.all([fetchCategoryList(), fetchGenreList()]);
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
    file_format: String(item?.file_format || "").trim(),
    cover_url: String(item?.cover_url || "").trim(),
    file_url: String(item?.file_url || "").trim(),
  };
}

async function fetchMangaList() {
  const url = new URL(endpoint.mangaGet);
  const query = String(state.searchQuery || "").trim();
  if (query) {
    url.searchParams.set("query", query);
  }
  if (state.searchGenreId) {
    url.searchParams.set("genre_id", state.searchGenreId);
  }
  if (state.searchCategoryId) {
    url.searchParams.set("category_id", state.searchCategoryId);
  }

  const body = await requestJson(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  state.mangaItems = items.map(normalizeManga).sort((a, b) => a.title.localeCompare(b.title));
}

function renderMangaGrid() {
  elements.mangaTableBody.innerHTML = "";
  if (!state.mangaItems.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td class="admin-grid-empty" colspan="7">No manga records found.</td>';
    elements.mangaTableBody.appendChild(row);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.mangaItems.forEach((item) => {
    const mangaId = String(item.manga_id || "").trim();
    const isActive = mangaId && state.expandedMangaIds.has(mangaId);
    const expandTitle = isActive ? "Collapse Content" : "Expand Content";
    const expandIcon = isActive ? "-" : "+";
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
        >${expandIcon}</button>
      </td>
      <td class="col-cover-cell">${renderCoverThumb(item.cover_url, item.title)}</td>
      <td>${escapeHtml(item.title || "-")}</td>
      <td>${escapeHtml(idsToLabel(item.category_ids, state.categoryNameById))}</td>
      <td>${escapeHtml(idsToLabel(item.genre_ids, state.genreNameById))}</td>
      <td>${escapeHtml(item.publisher || "-")}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="row-action-btn icon-action-btn" data-edit-manga="${escapeHtml(item.manga_id)}" title="Edit" aria-label="Edit">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h4l10-10-4-4L4 16v4z"></path>
              <path d="M13 7l4 4"></path>
            </svg>
          </button>
          <button type="button" class="row-action-btn icon-action-btn icon-delete-btn" data-delete-manga="${escapeHtml(item.manga_id)}" title="Delete" aria-label="Delete">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-.78 11.2A2 2 0 0 1 15.22 19H8.78a2 2 0 0 1-1.99-1.8L6 6H5a1 1 0 1 1 0-2h4zm2 0h2V3h-2v1zm-1 4a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1zm4 0a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1z"></path>
            </svg>
          </button>
        </div>
      </td>
    `;
    fragment.appendChild(row);
    if (isActive) {
      fragment.appendChild(renderInlineContentRow(mangaId));
    }
  });

  elements.mangaTableBody.appendChild(fragment);
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
  elements.ageRatingInput.value = item?.age_rating || "";
  elements.japaneseTitleInput.value = item?.japanese_title || "";
  setMultiSelectValues(elements.categoryIdsInput, item?.category_ids);
  setMultiSelectValues(elements.genreIdsInput, item?.genre_ids);
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

  return {
    manga_id: mangaId,
    title: String(elements.titleInput.value || "").trim(),
    publisher: String(elements.publisherInput.value || "").trim(),
    age_rating: String(elements.ageRatingInput.value || "").trim(),
    japanese_title: String(elements.japaneseTitleInput.value || "").trim(),
    cover_url: String(state.editingManga?.cover_url || "").trim(),
    category_ids: selectedOptionsAsIds(elements.categoryIdsInput),
    genre_ids: selectedOptionsAsIds(elements.genreIdsInput),
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
  if (!payload.title) {
    showMangaModalError("Title is required.");
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
  const normalized = String(mangaId || "").trim();
  if (!normalized) return;
  const manga = setActiveMangaById(normalized);
  if (!manga) {
    showError("Manga not found.");
    return;
  }

  state.expandedMangaIds.add(normalized);
  state.loadingContentMangaIds.add(normalized);
  renderMangaGrid();
  try {
    const items = await fetchContentForManga(normalized);
    state.contentItemsByManga.set(normalized, items);
  } catch (error) {
    state.expandedMangaIds.delete(normalized);
    state.contentItemsByManga.delete(normalized);
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    state.loadingContentMangaIds.delete(normalized);
    renderMangaGrid();
  }
}

function closeContentPanel(mangaId) {
  const normalized = String(mangaId || "").trim();
  if (!normalized) return;
  state.expandedMangaIds.delete(normalized);
  state.loadingContentMangaIds.delete(normalized);
  renderMangaGrid();
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
  if (!payload.title) {
    showContentModalError("Title is required.");
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
    state.expandedMangaIds.add(payload.manga_id);
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

async function deleteContent(mangaId, contentKey) {
  const normalizedMangaId = String(mangaId || "").trim();
  if (!normalizedMangaId) return;
  setActiveMangaById(normalizedMangaId);
  if (!window.confirm("Are you sure you want to delete this record?")) {
    return;
  }

  try {
    setBusy(true);
    await requestJson(endpoint.contentDelete, {
      method: "DELETE",
      headers: jsonHeaders(),
      body: JSON.stringify({ manga_id: normalizedMangaId, content_key: contentKey }),
    });
    showSuccess("Content deleted.");
    state.expandedMangaIds.add(normalizedMangaId);
    await refreshMangaGrid();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

function syncSearchStateFromControls() {
  state.searchQuery = String(elements.searchInput.value || "").trim();
  state.searchGenreId = String(elements.searchGenreInput?.value || "").trim();
  state.searchCategoryId = String(elements.searchCategoryInput?.value || "").trim();
}

function scheduleSearchRefresh(delayMs = SEARCH_INPUT_DEBOUNCE_MS) {
  if (searchRefreshTimer) {
    window.clearTimeout(searchRefreshTimer);
  }
  searchRefreshTimer = window.setTimeout(() => {
    searchRefreshTimer = 0;
    syncSearchStateFromControls();
    void refreshMangaGrid({ refreshTaxonomy: false });
  }, delayMs);
}

async function refreshMangaGrid({ refreshTaxonomy = false } = {}) {
  clearError();
  setBusy(true, { keepSearchEnabled: true });
  try {
    if (refreshTaxonomy) {
      await refreshTaxonomyOptions();
    }
    await fetchMangaList();
    const validMangaIds = new Set(state.mangaItems.map((item) => item.manga_id));
    const nextExpanded = new Set(
      [...state.expandedMangaIds].filter((mangaId) => validMangaIds.has(mangaId))
    );
    state.expandedMangaIds = nextExpanded;
    state.loadingContentMangaIds = new Set(nextExpanded);
    state.contentItemsByManga = new Map(
      [...state.contentItemsByManga.entries()].filter(([mangaId]) => nextExpanded.has(mangaId))
    );
    await Promise.all(
      [...nextExpanded].map(async (mangaId) => {
        try {
          const items = await fetchContentForManga(mangaId);
          state.contentItemsByManga.set(mangaId, items);
        } catch {
          state.contentItemsByManga.set(mangaId, []);
        } finally {
          state.loadingContentMangaIds.delete(mangaId);
        }
      })
    );
    renderMangaGrid();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false, { keepSearchEnabled: true });
  }
}

function wireEvents() {
  elements.searchInput.addEventListener("input", () => {
    syncSearchStateFromControls();
    scheduleSearchRefresh(SEARCH_INPUT_DEBOUNCE_MS);
  });
  elements.searchGenreInput.addEventListener("change", () => {
    syncSearchStateFromControls();
    scheduleSearchRefresh(80);
  });
  elements.searchCategoryInput.addEventListener("change", () => {
    syncSearchStateFromControls();
    scheduleSearchRefresh(80);
  });
  elements.refreshBtn.addEventListener("click", () => void refreshMangaGrid({ refreshTaxonomy: true }));
  elements.addMangaBtn.addEventListener("click", () => openMangaModal("create"));

  elements.mangaTableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const openBtn = target.closest("[data-open-content]");
    if (openBtn instanceof Element) {
      const mangaId = String(openBtn.getAttribute("data-open-content") || "").trim();
      if (mangaId && state.expandedMangaIds.has(mangaId)) {
        closeContentPanel(mangaId);
        return;
      }
      void openContentPanel(mangaId);
      return;
    }

    const addContentBtn = target.closest("[data-add-content-for]");
    if (addContentBtn instanceof Element) {
      const mangaId = String(addContentBtn.getAttribute("data-add-content-for") || "").trim();
      if (setActiveMangaById(mangaId)) {
        openContentModal("create");
      }
      return;
    }

    const viewContentBtn = target.closest("[data-view-content]");
    if (viewContentBtn instanceof Element) {
      const mangaId = String(viewContentBtn.getAttribute("data-content-manga-id") || "").trim();
      const contentKey = String(viewContentBtn.getAttribute("data-view-content") || "").trim();
      const items = state.contentItemsByManga.get(mangaId) || [];
      const item = items.find((entry) => entry.content_key === contentKey);
      if (item) {
        setActiveMangaById(mangaId);
        clearError();
        openContentInReader(item);
      }
      return;
    }

    const editContentBtn = target.closest("[data-edit-content]");
    if (editContentBtn instanceof Element) {
      const mangaId = String(editContentBtn.getAttribute("data-content-manga-id") || "").trim();
      const contentKey = String(editContentBtn.getAttribute("data-edit-content") || "").trim();
      const items = state.contentItemsByManga.get(mangaId) || [];
      const item = items.find((entry) => entry.content_key === contentKey);
      if (item) {
        setActiveMangaById(mangaId);
        openContentModal("update", item);
      }
      return;
    }

    const deleteContentBtn = target.closest("[data-delete-content]");
    if (deleteContentBtn instanceof Element) {
      const mangaId = String(deleteContentBtn.getAttribute("data-content-manga-id") || "").trim();
      const contentKey = String(deleteContentBtn.getAttribute("data-delete-content") || "").trim();
      void deleteContent(mangaId, contentKey);
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
  if (!mangaTaxonomyApiConfigLooksReady()) {
    showError("Category and Genre API endpoints are not configured in auth-config.js.");
    return;
  }

  wireAccountIdentity();
  wireEvents();
  syncSearchStateFromControls();
  await refreshMangaGrid({ refreshTaxonomy: true });
}

void init();

