import {
  appAuthzConfig,
  mangaApiConfigLooksReady,
  mangaContentApiConfigLooksReady,
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
  contentCountByMangaId: new Map(),
  activeManga: null,
  mangaMode: "create",
  contentMode: "create",
  editingManga: null,
  editingContent: null,
};

const elements = {
  error: document.getElementById("adminError"),
  success: document.getElementById("adminSuccess"),
  searchInput: document.getElementById("searchInput"),
  refreshBtn: document.getElementById("refreshBtn"),
  addMangaBtn: document.getElementById("addMangaBtn"),
  mangaTableBody: document.getElementById("mangaTableBody"),
  resultsCount: document.getElementById("resultsCount"),
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
  coverUrlInput: document.getElementById("coverUrlInput"),
  keywordsInput: document.getElementById("keywordsInput"),
  synopsisInput: document.getElementById("synopsisInput"),
  bisacInput: document.getElementById("bisacInput"),
  salesRestrictionInput: document.getElementById("salesRestrictionInput"),
  copyrightInput: document.getElementById("copyrightInput"),

  contentDrawer: document.getElementById("contentDrawer"),
  drawerTitle: document.getElementById("drawerTitle"),
  drawerSubtitle: document.getElementById("drawerSubtitle"),
  closeDrawerBtn: document.getElementById("closeDrawerBtn"),
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

function showContentDrawerError(message) {
  elements.contentError.textContent = message;
  elements.contentError.classList.remove("hidden");
}

function clearContentDrawerError() {
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
    throw new Error(body?.message || `Request failed (${response.status})`);
  }
  return body;
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.session.accessToken}`,
  };
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
};

function setBusy(nextBusy) {
  state.busy = nextBusy;
  elements.refreshBtn.disabled = nextBusy;
  elements.addMangaBtn.disabled = nextBusy;
  elements.saveMangaBtn.disabled = nextBusy;
  elements.saveContentBtn.disabled = nextBusy;
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
  const data = await requestJson(endpoint.mangaGet, {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  state.mangaItems = items.map(normalizeManga).sort((a, b) => a.title.localeCompare(b.title));
}

async function fetchContentCountForManga(mangaId) {
  const url = new URL(endpoint.contentGet);
  url.searchParams.set("manga_id", mangaId);
  const data = await requestJson(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  return Number(data?.count || 0);
}

async function fetchAllContentCounts() {
  state.contentCountByMangaId.clear();
  await Promise.all(
    state.mangaItems.map(async (item) => {
      try {
        const count = await fetchContentCountForManga(item.manga_id);
        state.contentCountByMangaId.set(item.manga_id, count);
      } catch {
        state.contentCountByMangaId.set(item.manga_id, 0);
      }
    })
  );
}

function applyMangaFilters() {
  const search = String(elements.searchInput.value || "").trim().toLowerCase();
  state.filteredMangaItems = state.mangaItems.filter((item) => {
    if (!search) return true;
    const haystack = [item.manga_id, item.title, item.publisher, item.series].join(" ").toLowerCase();
    return haystack.includes(search);
  });
  renderMangaGrid();
}

function renderMangaGrid() {
  elements.mangaTableBody.innerHTML = "";
  if (!state.filteredMangaItems.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td class="admin-grid-empty" colspan="6">No manga records found.</td>';
    elements.mangaTableBody.appendChild(row);
    elements.resultsCount.textContent = "0 records";
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filteredMangaItems.forEach((item) => {
    const count = state.contentCountByMangaId.get(item.manga_id) ?? 0;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.manga_id)}</td>
      <td>${escapeHtml(item.title || "-")}</td>
      <td>${escapeHtml(item.publisher || "-")}</td>
      <td>${escapeHtml(item.series || "-")}</td>
      <td><button type="button" class="grid-link-btn" data-open-content="${escapeHtml(item.manga_id)}">${count}</button></td>
      <td>
        <div class="row-actions">
          <button type="button" class="row-action-btn" data-edit-manga="${escapeHtml(item.manga_id)}">Edit</button>
          <button type="button" class="danger-btn" data-delete-manga="${escapeHtml(item.manga_id)}">Delete</button>
        </div>
      </td>
    `;
    fragment.appendChild(row);
  });

  elements.mangaTableBody.appendChild(fragment);
  elements.resultsCount.textContent = `${state.filteredMangaItems.length} record${state.filteredMangaItems.length === 1 ? "" : "s"}`;
}

function openMangaModal(mode, item = null) {
  state.mangaMode = mode;
  state.editingManga = item;
  clearMangaModalError();
  elements.mangaModalTitle.textContent = mode === "update" ? "Edit Manga" : "Add Manga";

  elements.mangaIdInput.value = item?.manga_id || "";
  elements.mangaIdInput.readOnly = mode === "update";
  elements.titleInput.value = item?.title || "";
  elements.publisherInput.value = item?.publisher || "";
  elements.seriesInput.value = item?.series || "";
  elements.ageRatingInput.value = item?.age_rating || "";
  elements.japaneseTitleInput.value = item?.japanese_title || "";
  elements.coverUrlInput.value = item?.cover_url || "";
  elements.keywordsInput.value = Array.isArray(item?.keywords) ? item.keywords.join(", ") : "";
  elements.synopsisInput.value = item?.synopsis || "";
  elements.bisacInput.value = item?.bisac || "";
  elements.salesRestrictionInput.value = item?.sales_restriction || "";
  elements.copyrightInput.value = item?.copyright || "";

  elements.mangaModal.classList.remove("hidden");
  elements.mangaModal.setAttribute("aria-hidden", "false");
}

function closeMangaModal() {
  state.editingManga = null;
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
    cover_url: String(elements.coverUrlInput.value || "").trim(),
    keywords: keywordList,
    synopsis: String(elements.synopsisInput.value || "").trim(),
    bisac: String(elements.bisacInput.value || "").trim(),
    sales_restriction: String(elements.salesRestrictionInput.value || "").trim(),
    copyright: String(elements.copyrightInput.value || "").trim(),
  };
}

async function saveManga(event) {
  event.preventDefault();
  clearMangaModalError();

  const payload = buildMangaPayload();
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
    showSuccess(isCreate ? "Manga created." : "Manga updated.");
    closeMangaModal();
    await refreshMangaGrid();
  } catch (error) {
    showMangaModalError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function deleteManga(mangaId) {
  if (!window.confirm(`Delete manga ${mangaId}? This does not auto-delete child content.`)) {
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

async function openContentDrawer(mangaId) {
  const manga = state.mangaItems.find((item) => item.manga_id === mangaId);
  if (!manga) {
    showError("Manga not found.");
    return;
  }

  state.activeManga = manga;
  elements.drawerTitle.textContent = `Manga Content: ${manga.title || manga.manga_id}`;
  elements.drawerSubtitle.textContent = `manga_id: ${manga.manga_id}`;
  clearContentDrawerError();

  try {
    const url = new URL(endpoint.contentGet);
    url.searchParams.set("manga_id", manga.manga_id);
    const data = await requestJson(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${state.session.accessToken}` },
    });
    const items = Array.isArray(data?.items) ? data.items : [];
    state.contentItems = items.map(normalizeContent).sort((a, b) => a.content_key.localeCompare(b.content_key));
    renderContentGrid();
    elements.contentDrawer.classList.remove("hidden");
    elements.contentDrawer.setAttribute("aria-hidden", "false");
  } catch (error) {
    showContentDrawerError(error instanceof Error ? error.message : String(error));
  }
}

function closeContentDrawer() {
  state.activeManga = null;
  state.contentItems = [];
  elements.contentDrawer.classList.add("hidden");
  elements.contentDrawer.setAttribute("aria-hidden", "true");
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
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.content_key)}</td>
      <td>${escapeHtml(item.content_type || "-")}</td>
      <td>${escapeHtml(item.sequence_number || "-")}</td>
      <td>${escapeHtml(item.title || "-")}</td>
      <td>${escapeHtml(item.file_format || "-")}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="row-action-btn" data-edit-content="${escapeHtml(item.content_key)}">Edit</button>
          <button type="button" class="danger-btn" data-delete-content="${escapeHtml(item.content_key)}">Delete</button>
        </div>
      </td>
    `;
    fragment.appendChild(row);
  });
  elements.contentTableBody.appendChild(fragment);
}

function openContentModal(mode, item = null) {
  state.contentMode = mode;
  state.editingContent = item;
  clearContentModalError();

  const mangaId = state.activeManga?.manga_id || item?.manga_id || "";
  elements.contentModalTitle.textContent = mode === "update" ? "Edit MangaContent" : "Add MangaContent";
  elements.contentMangaIdInput.value = mangaId;
  elements.contentKeyInput.value = item?.content_key || "";
  elements.contentKeyInput.readOnly = mode === "update";
  elements.contentTypeInput.value = item?.content_type || "";
  elements.sequenceNumberInput.value = item?.sequence_number || "";
  elements.contentTitleInput.value = item?.title || "";
  elements.externalContentIdInput.value = item?.external_content_id || "";
  elements.contentAuthorInput.value = item?.author || "";
  elements.priceInput.value = item?.price || "";
  elements.fileFormatInput.value = item?.file_format || "";
  elements.contentCoverUrlInput.value = item?.cover_url || "";
  elements.fileUrlInput.value = item?.file_url || "";
  elements.contentSynopsisInput.value = item?.synopsis || "";

  elements.contentModal.classList.remove("hidden");
  elements.contentModal.setAttribute("aria-hidden", "false");
}

function closeContentModal() {
  state.editingContent = null;
  elements.contentModal.classList.add("hidden");
  elements.contentModal.setAttribute("aria-hidden", "true");
}

function buildContentPayload() {
  const payload = {
    manga_id: String(elements.contentMangaIdInput.value || "").trim(),
    content_key: String(elements.contentKeyInput.value || "").trim(),
    content_type: String(elements.contentTypeInput.value || "").trim().toLowerCase(),
    sequence_number: String(elements.sequenceNumberInput.value || "").trim(),
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

async function saveContent(event) {
  event.preventDefault();
  clearContentModalError();

  const payload = buildContentPayload();
  if (!payload.manga_id || !payload.content_key) {
    showContentModalError("manga_id and content_key are required.");
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
    showSuccess(isCreate ? "MangaContent created." : "MangaContent updated.");
    closeContentModal();
    await openContentDrawer(payload.manga_id);
    await refreshMangaGrid();
  } catch (error) {
    showContentModalError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function deleteContent(contentKey) {
  const mangaId = state.activeManga?.manga_id;
  if (!mangaId) return;
  if (!window.confirm(`Delete child ${contentKey}?`)) {
    return;
  }

  try {
    setBusy(true);
    await requestJson(endpoint.contentDelete, {
      method: "DELETE",
      headers: jsonHeaders(),
      body: JSON.stringify({ manga_id: mangaId, content_key: contentKey }),
    });
    showSuccess("MangaContent deleted.");
    await openContentDrawer(mangaId);
    await refreshMangaGrid();
  } catch (error) {
    showContentDrawerError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function refreshMangaGrid() {
  clearError();
  setBusy(true);
  try {
    await fetchMangaList();
    await fetchAllContentCounts();
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
    if (!(target instanceof HTMLElement)) return;

    const openBtn = target.closest("[data-open-content]");
    if (openBtn instanceof HTMLElement) {
      const mangaId = String(openBtn.getAttribute("data-open-content") || "").trim();
      void openContentDrawer(mangaId);
      return;
    }

    const editBtn = target.closest("[data-edit-manga]");
    if (editBtn instanceof HTMLElement) {
      const mangaId = String(editBtn.getAttribute("data-edit-manga") || "").trim();
      const item = state.mangaItems.find((entry) => entry.manga_id === mangaId);
      if (item) openMangaModal("update", item);
      return;
    }

    const deleteBtn = target.closest("[data-delete-manga]");
    if (deleteBtn instanceof HTMLElement) {
      const mangaId = String(deleteBtn.getAttribute("data-delete-manga") || "").trim();
      void deleteManga(mangaId);
    }
  });

  elements.contentTableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editBtn = target.closest("[data-edit-content]");
    if (editBtn instanceof HTMLElement) {
      const contentKey = String(editBtn.getAttribute("data-edit-content") || "").trim();
      const item = state.contentItems.find((entry) => entry.content_key === contentKey);
      if (item) openContentModal("update", item);
      return;
    }

    const deleteBtn = target.closest("[data-delete-content]");
    if (deleteBtn instanceof HTMLElement) {
      const contentKey = String(deleteBtn.getAttribute("data-delete-content") || "").trim();
      void deleteContent(contentKey);
    }
  });

  elements.mangaForm.addEventListener("submit", (event) => void saveManga(event));
  elements.contentForm.addEventListener("submit", (event) => void saveContent(event));

  elements.closeMangaModalBtn.addEventListener("click", closeMangaModal);
  elements.cancelMangaBtn.addEventListener("click", closeMangaModal);
  elements.closeDrawerBtn.addEventListener("click", closeContentDrawer);
  elements.addContentBtn.addEventListener("click", () => openContentModal("create"));
  elements.closeContentModalBtn.addEventListener("click", closeContentModal);
  elements.cancelContentBtn.addEventListener("click", closeContentModal);

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("[data-close-manga-modal='true']")) closeMangaModal();
    if (target.matches("[data-close-drawer='true']")) closeContentDrawer();
    if (target.matches("[data-close-content-modal='true']")) closeContentModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeContentModal();
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
  if (!mangaContentApiConfigLooksReady()) {
    showError("MangaContent API endpoints are not configured in auth-config.js.");
    return;
  }

  wireAccountIdentity();
  wireEvents();
  await refreshMangaGrid();
}

void init();