import {
  appAuthzConfig,
  contentApiConfigLooksReady,
  contentUploadApiConfigLooksReady,
} from "../auth/auth-config.js";
import {
  clearAuthSession,
  getAuthSession,
  getJwtGivenName,
  getJwtPicture,
  isJwtExpired,
} from "../auth/auth-session.js";

const FALLBACK_THUMBNAIL = "../content/thumbnails/placeholder.svg";

const state = {
  items: [],
  filteredItems: [],
  contentTypes: [],
  session: null,
  busy: false,
  modalOpen: false,
  previewOpen: false,
  mode: "create",
  editingItem: null,
};

const MODEL_FIELDS = [
  "title",
  "publisher",
  "series",
  "age_rating",
  "release_date",
  "page_length",
  "contents_volume",
  "volume",
  "contents_name",
  "contents_id",
  "synopsis",
  "author",
  "price",
  "file_format",
  "concluded",
  "keywords",
  "copyright",
  "bisac",
  "sales_restriction",
  "japanese_title",
];

const elements = {
  error: document.getElementById("adminError"),
  success: document.getElementById("adminSuccess"),
  modalError: document.getElementById("contentModalError"),
  formError: document.getElementById("contentFormError"),
  searchInput: document.getElementById("searchInput"),
  contentTypeFilter: document.getElementById("contentTypeFilter"),
  refreshBtn: document.getElementById("refreshBtn"),
  addNewBtn: document.getElementById("addNewBtn"),
  tableBody: document.getElementById("contentTableBody"),
  resultsCount: document.getElementById("resultsCount"),
  signoutLinks: document.querySelectorAll(".settings-item.signout"),
  accountAvatar: document.getElementById("accountAvatar"),
  welcomeMessage: document.getElementById("welcomeMessage"),
  accountIconSvg: document.querySelector(".settings-trigger .library-icon-svg"),
  modal: document.getElementById("contentModal"),
  previewModal: document.getElementById("contentPreviewModal"),
  previewFrame: document.getElementById("contentPreviewFrame"),
  previewTitle: document.getElementById("contentPreviewTitle"),
  closePreviewBtn: document.getElementById("closePreviewBtn"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  saveBtn: document.getElementById("saveBtn"),
  modalTitle: document.getElementById("contentModalTitle"),
  form: document.getElementById("contentForm"),
  contentIdInput: document.getElementById("contentIdInput"),
  contentTypeInput: document.getElementById("contentTypeInput"),
  extraMetadataInput: document.getElementById("extraMetadataInput"),
  pdfFileInput: document.getElementById("pdfFileInput"),
  thumbnailFileInput: document.getElementById("thumbnailFileInput"),
  pdfUrlInput: document.getElementById("pdfUrlInput"),
  thumbnailUrlInput: document.getElementById("thumbnailUrlInput"),
};

MODEL_FIELDS.forEach((field) => {
  const id = `${field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Input`;
  elements[id] = document.getElementById(id);
});

function redirectTo(path) {
  window.location.replace(path);
}

function showError(message) {
  if (!elements.error) return;
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

function clearError() {
  if (!elements.error) return;
  elements.error.textContent = "";
  elements.error.classList.add("hidden");
}

function showFormError(message) {
  const errorEl = elements.modalError || elements.formError;
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
  if (elements.form && typeof elements.form.scrollTo === "function") {
    elements.form.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function clearFormError() {
  if (elements.modalError) {
    elements.modalError.textContent = "";
    elements.modalError.classList.add("hidden");
  }
  if (elements.formError) {
    elements.formError.textContent = "";
    elements.formError.classList.add("hidden");
  }
}

function showSuccess(message) {
  if (!elements.success) return;
  elements.success.textContent = message;
  elements.success.classList.remove("hidden");
  window.setTimeout(() => elements.success?.classList.add("hidden"), 2800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyDate(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString();
}

function normalizeConcluded(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(text) ? "1" : "0";
}

function toHttpAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;

  const match = raw.match(/^s3:\/\/([^/]+)\/(.+)$/i);
  if (!match) return raw;
  const bucket = match[1];
  const key = match[2]
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

function ensureAdminSession() {
  const session = getAuthSession();
  if (!session) {
    redirectTo("../index.html");
    return null;
  }

  const idToken = String(session.idToken || "").trim();
  const accessToken = String(session.accessToken || "").trim();
  const email = String(session.email || "").trim();
  const status = Number(session.status || 0);
  const isAdmin = Boolean(session.isAdmin || Number(session.admin || 0) === 1);

  if (!idToken || !accessToken || !email || status !== 1 || isJwtExpired(idToken)) {
    clearAuthSession();
    redirectTo("../index.html");
    return null;
  }

  if (!isAdmin) {
    redirectTo("../library.html");
    return null;
  }

  state.session = session;
  return session;
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  elements.refreshBtn.disabled = nextBusy;
  elements.addNewBtn.disabled = nextBusy;
  elements.saveBtn.disabled = nextBusy;
  elements.tableBody.querySelectorAll("[data-edit-content]").forEach((btn) => {
    if (btn instanceof HTMLButtonElement) btn.disabled = nextBusy;
  });
}

function wireAccountIdentity() {
  const idToken = String(state.session?.idToken || "").trim();
  const givenName = String(state.session?.givenName || getJwtGivenName(idToken) || "").trim();
  const image = String(state.session?.image || getJwtPicture(idToken) || "").trim();

  if (givenName && elements.welcomeMessage) {
    elements.welcomeMessage.textContent = `Welcome, ${givenName}`;
    elements.welcomeMessage.classList.remove("hidden");
  } else {
    elements.welcomeMessage?.classList.add("hidden");
  }

  if (image && elements.accountAvatar) {
    elements.accountAvatar.src = image;
    elements.accountAvatar.classList.remove("hidden");
    elements.accountIconSvg?.classList.add("hidden");
    elements.accountAvatar.onerror = () => {
      elements.accountAvatar?.classList.add("hidden");
      elements.accountIconSvg?.classList.remove("hidden");
    };
  } else {
    elements.accountAvatar?.classList.add("hidden");
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
    const err = new Error(body?.message || `Request failed (${response.status})`);
    err.fieldErrors = body?.field_errors || null;
    throw err;
  }
  return body;
}

function normalizeContentItem(item) {
  const normalized = { ...(item || {}) };
  normalized.content_id = String(item?.content_id || "").trim();
  normalized.content_type = String(item?.content_type || "manga").trim() || "manga";
  MODEL_FIELDS.forEach((field) => {
    normalized[field] = String(item?.[field] ?? "").trim();
  });
  normalized.concluded = normalizeConcluded(item?.concluded);
  normalized.pdf_url = String(item?.pdf_url || "").trim();
  normalized.thumbnail_url = String(item?.thumbnail_url || "").trim();
  normalized.created_at = String(item?.created_at || "").trim();
  normalized.updated_at = String(item?.updated_at || "").trim();
  return normalized;
}

async function fetchContent() {
  if (!state.session) return;
  if (!contentApiConfigLooksReady()) {
    throw new Error("Content API endpoints are not configured in auth-config.js.");
  }

  const data = await requestJson(appAuthzConfig.getContentEndpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });

  const items = Array.isArray(data?.items) ? data.items : [];
  state.items = items.map(normalizeContentItem);
  state.contentTypes = Array.from(
    new Set(state.items.map((item) => String(item.content_type || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

function renderTypeFilterOptions() {
  const current = String(elements.contentTypeFilter.value || "").trim();
  elements.contentTypeFilter.innerHTML = '<option value="">All</option>';
  state.contentTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    elements.contentTypeFilter.appendChild(option);
  });
  if (current && state.contentTypes.includes(current)) elements.contentTypeFilter.value = current;
}

function applyFilters() {
  const search = String(elements.searchInput.value || "").trim().toLowerCase();
  const contentType = String(elements.contentTypeFilter.value || "").trim().toLowerCase();

  state.filteredItems = state.items.filter((item) => {
    if (contentType && String(item.content_type || "").toLowerCase() !== contentType) return false;
    if (!search) return true;
    const haystack = [item.content_id, item.title, item.author, item.publisher, item.content_type, item.contents_id]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
  renderGrid();
}

function renderGrid() {
  elements.tableBody.innerHTML = "";
  if (!state.filteredItems.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "admin-grid-empty";
    cell.colSpan = 7;
    cell.textContent = "No records match the active filters.";
    row.appendChild(cell);
    elements.tableBody.appendChild(row);
    elements.resultsCount.textContent = "0 records";
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filteredItems.forEach((item) => {
    const thumbnail = toHttpAssetUrl(item.thumbnail_url) || FALLBACK_THUMBNAIL;
    const pdfUrl = toHttpAssetUrl(item.pdf_url);
    const canViewContent = Boolean(pdfUrl);
    const thumbTooltip = canViewContent ? "View Content" : "No Content To View";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <button
          type="button"
          class="content-thumb-btn"
          data-view-content="${escapeHtml(item.content_id)}"
          data-can-view="${canViewContent ? "1" : "0"}"
          title="${escapeHtml(thumbTooltip)}"
          aria-label="${escapeHtml(thumbTooltip)}"
          aria-disabled="${canViewContent ? "false" : "true"}"
          ${canViewContent ? "" : 'tabindex="-1"'}
        >
          <img class="content-thumb" src="${escapeHtml(thumbnail)}" alt="" loading="lazy" />
        </button>
      </td>
      <td>${escapeHtml(item.title || "-")}</td>
      <td>${escapeHtml(item.author || "-")}</td>
      <td>${escapeHtml(item.publisher || "-")}</td>
      <td>${escapeHtml(item.content_type || "manga")}</td>
      <td>${escapeHtml(prettyDate(item.updated_at || item.created_at))}</td>
      <td><button type="button" class="row-action-btn" data-edit-content="${escapeHtml(item.content_id)}">Update</button></td>
    `;
    fragment.appendChild(row);
  });
  elements.tableBody.appendChild(fragment);
  elements.resultsCount.textContent = `${state.filteredItems.length} record${state.filteredItems.length === 1 ? "" : "s"}`;
}

function getFieldInput(field) {
  const id = `${field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Input`;
  return elements[id];
}

function openModal(mode, item = null) {
  state.mode = mode;
  state.editingItem = item;
  state.modalOpen = true;
  elements.modal.classList.remove("hidden");
  elements.modal.setAttribute("aria-hidden", "false");

  elements.modalTitle.textContent = mode === "update" ? "Update Content" : "Add New Content";
  clearFormError();
  elements.contentIdInput.value = mode === "update" ? item?.content_id || "" : "";
  elements.contentTypeInput.value = mode === "update" ? item?.content_type || "manga" : "manga";

  MODEL_FIELDS.forEach((field) => {
    const input = getFieldInput(field);
    if (!input) return;
    if (mode === "update") {
      input.value = field === "concluded" ? normalizeConcluded(item?.[field]) : String(item?.[field] || "");
    } else {
      input.value = field === "concluded" ? "0" : "";
    }
  });

  elements.pdfUrlInput.value = mode === "update" ? item?.pdf_url || "" : "";
  elements.thumbnailUrlInput.value = mode === "update" ? item?.thumbnail_url || "" : "";

  const known = new Set(["content_id", "content_type", ...MODEL_FIELDS, "pdf_url", "thumbnail_url", "created_at", "updated_at"]);
  const extra = {};
  if (mode === "update" && item) {
    Object.entries(item).forEach(([key, value]) => {
      if (!known.has(key)) extra[key] = value;
    });
  }
  elements.extraMetadataInput.value = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : "";
  elements.pdfFileInput.value = "";
  elements.thumbnailFileInput.value = "";
}

function closeModal() {
  state.modalOpen = false;
  state.editingItem = null;
  elements.modal.classList.add("hidden");
  elements.modal.setAttribute("aria-hidden", "true");
}

function openPreview(item) {
  const pdfUrl = toHttpAssetUrl(item?.pdf_url);
  if (!pdfUrl || !elements.previewModal || !elements.previewFrame) {
    return;
  }
  const readerUrl = new URL("../library.html", window.location.href);
  readerUrl.searchParams.set("manga", String(item?.content_id || "preview").trim() || "preview");
  readerUrl.searchParams.set("pdf", pdfUrl);
  readerUrl.searchParams.set("title", String(item?.title || "Content Preview").trim() || "Content Preview");
  const thumbnailUrl = toHttpAssetUrl(item?.thumbnail_url);
  if (thumbnailUrl) {
    readerUrl.searchParams.set("thumbnail", thumbnailUrl);
  }

  state.previewOpen = true;
  elements.previewTitle.textContent = item?.title ? `Content Preview - ${item.title}` : "Content Preview";
  elements.previewFrame.src = readerUrl.toString();
  elements.previewModal.classList.remove("hidden");
  elements.previewModal.setAttribute("aria-hidden", "false");
}

function closePreview() {
  if (!elements.previewModal || !elements.previewFrame) {
    return;
  }
  state.previewOpen = false;
  elements.previewModal.classList.add("hidden");
  elements.previewModal.setAttribute("aria-hidden", "true");
  elements.previewFrame.src = "";
}

async function readFileAsBase64(file) {
  if (!(file instanceof File)) return null;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    content_type: file.type || "application/octet-stream",
    base64: dataUrl.includes(",") ? dataUrl.split(",")[1] : "",
  };
}

function generateGuid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function requestUploadUrl(file, fileKind, contentId) {
  return requestJson(appAuthzConfig.getContentUploadUrlEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.accessToken}`,
    },
    body: JSON.stringify({
      content_id: contentId,
      file_kind: fileKind,
      file_name: file.name,
      content_type: file.type || "application/octet-stream",
    }),
  });
}

async function uploadViaPresignedUrl(uploadUrl, file, contentType) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType || file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`S3 upload failed (${response.status}). ${raw || ""}`.trim());
  }
}

function buildPayload(extraMetadata, forcedContentId = "") {
  const normalizedForcedId = String(forcedContentId || "").trim();
  const normalizedExistingId = String(state.editingItem?.content_id || "").trim();
  const finalContentId = normalizedExistingId || normalizedForcedId;
  const payload = {
    ...(finalContentId ? { content_id: finalContentId } : {}),
    content_type: String(elements.contentTypeInput.value || "manga").trim() || "manga",
  };

  MODEL_FIELDS.forEach((field) => {
    const input = getFieldInput(field);
    if (!input) return;
    payload[field] = field === "concluded" ? normalizeConcluded(input.value) : String(input.value || "").trim();
  });

  return { ...payload, ...extraMetadata };
}

async function saveContent(payload) {
  return requestJson(appAuthzConfig.updateContentEndpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFormError();

  let extraMetadata = {};
  const rawExtra = String(elements.extraMetadataInput.value || "").trim();
  if (rawExtra) {
    try {
      const parsed = JSON.parse(rawExtra);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Additional Metadata must be a JSON object.");
      }
      extraMetadata = parsed;
    } catch (error) {
      showFormError(error instanceof Error ? error.message : "Invalid additional metadata JSON.");
      return;
    }
  }

  let contentIdForUpload = String(state.editingItem?.content_id || "").trim() || generateGuid();
  const payload = buildPayload(extraMetadata, contentIdForUpload);
  if (!payload.title) {
    showFormError("Title is required.");
    return;
  }

  try {
    setBusy(true);
    const pdfFile = elements.pdfFileInput.files?.[0] || null;
    const thumbnailFile = elements.thumbnailFileInput.files?.[0] || null;
    const useDirectUpload = contentUploadApiConfigLooksReady();
    const isCreateMode = state.mode === "create";
    let result;

    if (useDirectUpload && isCreateMode) {
      // Create metadata record first to avoid orphaning files when record creation fails.
      const createResult = await saveContent(payload);
      contentIdForUpload = String(createResult?.item?.content_id || payload.content_id || contentIdForUpload).trim();
      payload.content_id = contentIdForUpload;
      result = createResult;

      if (pdfFile) {
        const upload = await requestUploadUrl(pdfFile, "pdf", contentIdForUpload);
        await uploadViaPresignedUrl(upload.upload_url, pdfFile, upload.content_type);
        result = await saveContent({
          content_id: contentIdForUpload,
          pdf_url: String(upload.file_url || upload.s3_url || "").trim(),
        });
      }
      if (thumbnailFile) {
        const upload = await requestUploadUrl(thumbnailFile, "thumbnail", contentIdForUpload);
        await uploadViaPresignedUrl(upload.upload_url, thumbnailFile, upload.content_type);
        result = await saveContent({
          content_id: contentIdForUpload,
          thumbnail_url: String(upload.file_url || upload.s3_url || "").trim(),
        });
      }
    } else if (useDirectUpload) {
      if (pdfFile) {
        const upload = await requestUploadUrl(pdfFile, "pdf", contentIdForUpload);
        await uploadViaPresignedUrl(upload.upload_url, pdfFile, upload.content_type);
        contentIdForUpload = String(upload.content_id || contentIdForUpload).trim();
        payload.content_id = contentIdForUpload;
        payload.pdf_url = String(upload.file_url || upload.s3_url || "").trim();
      }
      if (thumbnailFile) {
        const upload = await requestUploadUrl(thumbnailFile, "thumbnail", contentIdForUpload);
        await uploadViaPresignedUrl(upload.upload_url, thumbnailFile, upload.content_type);
        payload.content_id = String(upload.content_id || contentIdForUpload).trim();
        payload.thumbnail_url = String(upload.file_url || upload.s3_url || "").trim();
      }
    } else {
      if (pdfFile) payload.pdf_file = await readFileAsBase64(pdfFile);
      if (thumbnailFile) payload.thumbnail_file = await readFileAsBase64(thumbnailFile);
      result = await saveContent(payload);
    }

    if (!result) {
      result = await saveContent(payload);
    }
    const generated = Boolean(result?.generated_thumbnail);
    const needsThumbnail = Boolean(result?.thumbnail_required);
    showSuccess(
      generated
        ? "Saved. Thumbnail was generated from the uploaded PDF."
        : needsThumbnail
        ? "Saved. PDF uploaded, but thumbnail generation was unavailable. Upload a thumbnail."
        : "Content record saved."
    );
    closeModal();
    await refreshGrid();
  } catch (error) {
    if (error instanceof Error && error.fieldErrors && typeof error.fieldErrors === "object") {
      const flat = Object.entries(error.fieldErrors)
        .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(", ") : String(messages)}`)
        .join(" | ");
      showFormError(flat || error.message);
    } else {
      showFormError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    setBusy(false);
  }
}

async function refreshGrid() {
  clearError();
  setBusy(true);
  try {
    await fetchContent();
    renderTypeFilterOptions();
    applyFilters();
  } finally {
    setBusy(false);
  }
}

function wireEvents() {
  elements.searchInput.addEventListener("input", applyFilters);
  elements.contentTypeFilter.addEventListener("change", applyFilters);
  elements.refreshBtn.addEventListener("click", () => void refreshGrid().catch((e) => showError(String(e))));
  elements.addNewBtn.addEventListener("click", () => openModal("create"));

  elements.tableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const previewBtn = target.closest("[data-view-content]");
    if (previewBtn instanceof HTMLElement) {
      const canView = String(previewBtn.getAttribute("data-can-view") || "0") === "1";
      if (!canView) return;
      const contentId = String(previewBtn.getAttribute("data-view-content") || "").trim();
      const item = state.items.find((entry) => entry.content_id === contentId);
      if (item && item.pdf_url) {
        openPreview(item);
      }
      return;
    }

    const editBtn = target.closest("[data-edit-content]");
    if (!(editBtn instanceof HTMLElement)) return;
    const contentId = String(editBtn.getAttribute("data-edit-content") || "").trim();
    const item = state.items.find((entry) => entry.content_id === contentId);
    if (!item) return showError("Content record not found in the current view.");
    openModal("update", item);
  });

  elements.closeModalBtn.addEventListener("click", closeModal);
  elements.closePreviewBtn?.addEventListener("click", closePreview);
  elements.cancelBtn.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches("[data-close-modal='true']")) closeModal();
  });
  elements.previewModal?.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches("[data-close-preview='true']")) closePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.previewOpen) {
      closePreview();
      return;
    }
    if (event.key === "Escape" && state.modalOpen) closeModal();
  });
  elements.form.addEventListener("submit", (event) => void handleSubmit(event));
  elements.signoutLinks.forEach((link) => link.addEventListener("click", () => clearAuthSession()));
}

async function init() {
  if (!ensureAdminSession()) return;
  wireAccountIdentity();
  wireEvents();
  try {
    await refreshGrid();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

void init();
