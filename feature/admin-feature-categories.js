
import {
  appAuthzConfig,
  featureCategoryAdminApiConfigLooksReady,
  mangaApiConfigLooksReady,
  mangaContentApiConfigLooksReady,
} from "../auth/auth-config.js";
import {
  clearAuthSession,
  getAuthSession,
  getJwtGivenName,
  getJwtPicture,
  isJwtExpired,
} from "../auth/auth-session.js";

const FALLBACK_COVER = "../content/manga/placeholder.svg";

const state = {
  session: null,
  busy: false,
  categories: [],
  filteredCategories: [],
  activeCategory: null,
  categoryMode: "create",
  categoryItems: [],
  mangaItems: [],
  mangaById: new Map(),
  contentByMangaId: new Map(),
  contentLibraryIndex: [],
  contentLibraryReady: false,
  pickerSelections: new Set(),
  pickerResultMap: new Map(),
  itemDisplayOrderSupported: null,
};

const elements = {
  error: document.getElementById("adminError"),
  success: document.getElementById("adminSuccess"),
  signoutLinks: document.querySelectorAll(".settings-item.signout"),
  accountAvatar: document.getElementById("accountAvatar"),
  welcomeMessage: document.getElementById("welcomeMessage"),
  accountIconSvg: document.querySelector(".settings-trigger .library-icon-svg"),

  refreshCategoriesBtn: document.getElementById("refreshCategoriesBtn"),
  newCategoryBtn: document.getElementById("newCategoryBtn"),
  categoriesTableBody: document.getElementById("categoriesTableBody"),

  categoryModal: document.getElementById("categoryModal"),
  categoryModalTitle: document.getElementById("categoryModalTitle"),
  closeCategoryModalBtn: document.getElementById("closeCategoryModalBtn"),
  categoryForm: document.getElementById("categoryForm"),
  categoryIdInput: document.getElementById("categoryIdInput"),
  categoryNameInput: document.getElementById("categoryNameInput"),
  categoryDisplayOrderInput: document.getElementById("categoryDisplayOrderInput"),
  categoryDescriptionInput: document.getElementById("categoryDescriptionInput"),
  cancelCategoryBtn: document.getElementById("cancelCategoryBtn"),
  saveCategoryBtn: document.getElementById("saveCategoryBtn"),

  selectedCategoryTitle: document.getElementById("selectedCategoryTitle"),
  itemsPanelDisabled: document.getElementById("itemsPanelDisabled"),
  itemsPanelContent: document.getElementById("itemsPanelContent"),
  itemsTableBody: document.getElementById("itemsTableBody"),
  openPickerBtn: document.getElementById("openPickerBtn"),

  pickerModal: document.getElementById("pickerModal"),
  closePickerModalBtn: document.getElementById("closePickerModalBtn"),
  pickerTypeSelect: document.getElementById("pickerTypeSelect"),
  pickerSearchInput: document.getElementById("pickerSearchInput"),
  pickerMangaFilterWrap: document.getElementById("pickerMangaFilterWrap"),
  pickerMangaFilter: document.getElementById("pickerMangaFilter"),
  pickerRefreshBtn: document.getElementById("pickerRefreshBtn"),
  pickerStatus: document.getElementById("pickerStatus"),
  pickerResultsBody: document.getElementById("pickerResultsBody"),
  submitPickerBtn: document.getElementById("submitPickerBtn"),
};

function redirectTo(path) {
  window.location.replace(path);
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function generateGuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
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
  window.setTimeout(() => {
    elements.success?.classList.add("hidden");
  }, 2500);
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  elements.refreshCategoriesBtn.disabled = nextBusy;
  elements.newCategoryBtn.disabled = nextBusy;
  elements.saveCategoryBtn.disabled = nextBusy;
  elements.openPickerBtn.disabled = nextBusy || !state.activeCategory;
  elements.pickerRefreshBtn.disabled = nextBusy || !state.activeCategory;
  elements.submitPickerBtn.disabled = nextBusy || state.pickerSelections.size === 0;
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
  const status = normalizeNumber(session.status, 0);
  const isAdmin = Boolean(session.isAdmin || normalizeNumber(session.admin, 0) === 1);

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
    throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
  }
  if (body && typeof body === "object" && body.success === false) {
    throw new Error(String(body.error || "Request failed."));
  }
  return body;
}

function responseData(body) {
  if (!body || typeof body !== "object") return {};
  if ("data" in body && typeof body.data === "object" && body.data) {
    return body.data;
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
    if (url.includes(fromText)) return url.replace(fromText, toText);
  }
  return url;
}
const endpoint = {
  get categoryGet() {
    return String(appAuthzConfig.getFeatureCategoryEndpoint || "").trim();
  },
  get categoryCreate() {
    return deriveEndpoint(this.categoryGet, [
      ["/get-feature-category", "/create-feature-category"],
      ["/feature-category", "/feature-category"],
    ]);
  },
  get categoryUpdate() {
    return String(appAuthzConfig.updateFeatureCategoryEndpoint || "").trim();
  },
  get categoryDelete() {
    return deriveEndpoint(this.categoryUpdate, [
      ["/update-feature-category", "/delete-feature-category"],
      ["/feature-category", "/feature-category"],
    ]);
  },
  get itemGet() {
    return String(appAuthzConfig.getFeatureCategoryItemEndpoint || "").trim();
  },
  get itemCreate() {
    return deriveEndpoint(this.itemGet, [
      ["/get-feature-category-item", "/create-feature-category-item"],
      ["/feature-category-item", "/feature-category-item"],
    ]);
  },
  get itemUpdate() {
    const configured = String(appAuthzConfig.updateFeatureCategoryItemEndpoint || "").trim();
    if (configured) return configured;
    return deriveEndpoint(this.itemGet, [
      ["/get-feature-category-item", "/update-feature-category-item"],
      ["/feature-category-item", "/feature-category-item"],
    ]);
  },
  get itemDelete() {
    return deriveEndpoint(this.itemUpdate, [
      ["/update-feature-category-item", "/delete-feature-category-item"],
      ["/feature-category-item", "/feature-category-item"],
    ]);
  },
  get mangaGet() {
    return String(appAuthzConfig.getMangaEndpoint || "").trim();
  },
  get contentGet() {
    return String(appAuthzConfig.getMangaContentEndpoint || "").trim();
  },
};

function normalizeCategory(item) {
  return {
    category_id: String(item?.category_id || "").trim(),
    name: String(item?.name || "").trim(),
    slug: String(item?.slug || "").trim(),
    description: String(item?.description || "").trim(),
    display_order: normalizeNumber(item?.display_order, 0),
  };
}

function normalizeCategoryItem(item) {
  return {
    category_id: String(item?.category_id || "").trim(),
    sort_key: String(item?.sort_key || "").trim(),
    display_order: normalizeNumber(item?.display_order, 0),
    item_type: String(item?.item_type || "").trim().toUpperCase(),
    manga_id: String(item?.manga_id || "").trim(),
    content_key: String(item?.content_key || "").trim(),
    title: String(item?.title || "").trim(),
    cover_url: String(item?.cover_url || "").trim(),
  };
}

function normalizeManga(item) {
  const keywords = Array.isArray(item?.keywords)
    ? item.keywords.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  return {
    manga_id: String(item?.manga_id || "").trim(),
    title: String(item?.title || "").trim(),
    cover_url: String(item?.cover_url || "").trim(),
    keywords,
  };
}

function normalizeMangaContent(item) {
  return {
    manga_id: String(item?.manga_id || "").trim(),
    content_key: String(item?.content_key || "").trim(),
    content_type: String(item?.content_type || "").trim().toLowerCase(),
    sequence_number: normalizeNumber(item?.sequence_number, 0),
    title: String(item?.title || "").trim(),
    cover_url: String(item?.cover_url || "").trim(),
  };
}

function isUnsupportedDisplayOrderError(error) {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  return message.includes("unsupported field: display_order");
}

function getCategoryModalOpen() {
  return !elements.categoryModal.classList.contains("hidden");
}

function getPickerModalOpen() {
  return !elements.pickerModal.classList.contains("hidden");
}

function syncBodyModalState() {
  const hasModal = getCategoryModalOpen() || getPickerModalOpen();
  document.body.style.overflow = hasModal ? "hidden" : "";
}

function openCategoryModal(mode, category = null) {
  state.categoryMode = mode;
  const maxOrder = state.categories.reduce((max, item) => Math.max(max, normalizeNumber(item.display_order, 0)), 0) + 1;
  elements.categoryDisplayOrderInput.setAttribute("max", String(maxOrder));
  if (mode === "update" && category) {
    elements.categoryModalTitle.textContent = "Edit Category";
    elements.categoryIdInput.value = category.category_id;
    elements.categoryNameInput.value = category.name;
    elements.categoryDisplayOrderInput.value = String(category.display_order || "");
    elements.categoryDescriptionInput.value = category.description;
  } else {
    elements.categoryModalTitle.textContent = "Add Category";
    elements.categoryIdInput.value = generateGuid();
    elements.categoryNameInput.value = "";
    elements.categoryDisplayOrderInput.value = "";
    elements.categoryDescriptionInput.value = "";
  }
  elements.categoryModal.classList.remove("hidden");
  syncBodyModalState();
  window.setTimeout(() => elements.categoryNameInput.focus(), 0);
}

async function closeCategoryModal({ reload = true } = {}) {
  elements.categoryModal.classList.add("hidden");
  syncBodyModalState();
  if (!reload) return;
  clearError();
  setBusy(true);
  try {
    await fetchCategories();
    applyCategoryFilter();
  } finally {
    setBusy(false);
  }
}

function openPickerModal() {
  if (!state.activeCategory) return;
  state.pickerSelections.clear();
  updatePickerSubmitState();
  elements.pickerModal.classList.remove("hidden");
  syncBodyModalState();
  void renderPickerResults();
}

function closePickerModal() {
  state.pickerSelections.clear();
  updatePickerSubmitState();
  elements.pickerModal.classList.add("hidden");
  syncBodyModalState();
}

async function fetchCategories() {
  const body = await requestJson(endpoint.categoryGet, {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  state.categories = items
    .map(normalizeCategory)
    .filter((item) => item.category_id)
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
}

function applyCategoryFilter() {
  state.filteredCategories = [...state.categories];
  renderCategories();
}

function renderCategories() {
  elements.categoriesTableBody.innerHTML = "";
  if (!state.filteredCategories.length) {
    elements.categoriesTableBody.innerHTML = '<tr><td class="admin-grid-empty" colspan="3">No categories found.</td></tr>';
    return;
  }
  const activeId = String(state.activeCategory?.category_id || "").trim();
  const fragment = document.createDocumentFragment();
  state.filteredCategories.forEach((item, index) => {
    const row = document.createElement("tr");
    const isFirst = index === 0;
    const isLast = index === state.filteredCategories.length - 1;
    if (item.category_id === activeId) row.classList.add("row-selected");
    row.innerHTML = `
      <td>${escapeHtml(item.name || "-")}</td>
      <td>
        <div class="category-order-control">
          <button
            type="button"
            class="icon-btn reorder-btn"
            data-category-move-down="${escapeHtml(item.category_id)}"
            aria-label="Move category down"
            title="Move category down"
            ${isLast ? "disabled" : ""}
          >
            <span class="reorder-glyph" aria-hidden="true">&darr;</span>
          </button>
          <span class="category-order-value">${escapeHtml(String(item.display_order ?? "-"))}</span>
          <button
            type="button"
            class="icon-btn reorder-btn"
            data-category-move-up="${escapeHtml(item.category_id)}"
            aria-label="Move category up"
            title="Move category up"
            ${isFirst ? "disabled" : ""}
          >
            <span class="reorder-glyph" aria-hidden="true">&uarr;</span>
          </button>
        </div>
      </td>
      <td>
        <div class="table-actions">
          <button type="button" class="icon-btn" data-manage-category="${escapeHtml(item.category_id)}" aria-label="Configure category items" title="Configure category items">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg>
          </button>
          <button type="button" class="icon-btn" data-edit-category="${escapeHtml(item.category_id)}" aria-label="Edit category" title="Edit category">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="m16.5 3.5 4 4L8 20H4v-4z"></path></svg>
          </button>
          <button type="button" class="icon-btn is-danger" data-delete-category="${escapeHtml(item.category_id)}" aria-label="Delete category" title="Delete category">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path></svg>
          </button>
        </div>
      </td>
    `;
    fragment.appendChild(row);
  });
  elements.categoriesTableBody.appendChild(fragment);
}

function buildCategoryPayload() {
  const payload = {
    category_id: String(elements.categoryIdInput.value || "").trim(),
    name: String(elements.categoryNameInput.value || "").trim(),
    description: String(elements.categoryDescriptionInput.value || "").trim(),
  };
  const orderRaw = String(elements.categoryDisplayOrderInput.value || "").trim();
  if (orderRaw) {
    const maxOrder = state.categories.reduce((max, item) => Math.max(max, normalizeNumber(item.display_order, 0)), 0) + 1;
    payload.display_order = Math.min(maxOrder, Math.max(1, normalizeNumber(orderRaw, 1)));
  }
  Object.keys(payload).forEach((key) => {
    if (payload[key] === "") delete payload[key];
  });
  return payload;
}

async function saveCategory() {
  const payload = buildCategoryPayload();
  if (!payload.category_id) throw new Error("category_id is required.");
  if (!payload.name) throw new Error("name is required.");
  const isCreate = state.categoryMode === "create";
  await requestJson(isCreate ? endpoint.categoryCreate : endpoint.categoryUpdate, {
    method: isCreate ? "POST" : "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  showSuccess(isCreate ? "Category created." : "Category updated.");

  await fetchCategories();
  applyCategoryFilter();
  const selected = state.categories.find((item) => item.category_id === payload.category_id);
  if (selected) {
    state.activeCategory = selected;
    updateRightPaneState();
    await refreshCategoryItems();
  }
  await closeCategoryModal({ reload: false });
}

async function deleteCategory(categoryId) {
  if (!window.confirm("Delete this category?")) return;
  await requestJson(endpoint.categoryDelete, {
    method: "DELETE",
    headers: jsonHeaders(),
    body: JSON.stringify({ category_id: categoryId }),
  });
  showSuccess("Category deleted.");
  if (String(state.activeCategory?.category_id || "") === categoryId) {
    state.activeCategory = null;
    state.categoryItems = [];
  }
  updateRightPaneState();
  await refreshCategories();
}

async function updateCategoryDisplayOrder(categoryId, displayOrder) {
  const safeOrder = Math.max(1, normalizeNumber(displayOrder, 1));
  await requestJson(endpoint.categoryUpdate, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({
      category_id: categoryId,
      display_order: safeOrder,
    }),
  });
}

function getSortedCategories() {
  return [...state.categories].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
}

async function moveCategory(categoryId, direction) {
  const categories = getSortedCategories();
  const index = categories.findIndex((item) => item.category_id === categoryId);
  if (index < 0) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= categories.length) return;
  await updateCategoryDisplayOrder(categoryId, targetIndex + 1);
}

async function refreshCategories() {
  clearError();
  setBusy(true);
  try {
    await fetchCategories();
    applyCategoryFilter();
  } finally {
    setBusy(false);
  }
}
async function fetchMangaLibrary() {
  const body = await requestJson(endpoint.mangaGet, {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  state.mangaItems = items
    .map(normalizeManga)
    .filter((item) => item.manga_id)
    .sort((a, b) => a.title.localeCompare(b.title));
  state.mangaById = new Map(state.mangaItems.map((item) => [item.manga_id, item]));
}

async function fetchContentByMangaId(mangaId) {
  const key = String(mangaId || "").trim();
  if (!key) return [];
  if (state.contentByMangaId.has(key)) return state.contentByMangaId.get(key);

  const url = new URL(endpoint.contentGet);
  url.searchParams.set("manga_id", key);
  const body = await requestJson(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  const normalized = items
    .map(normalizeMangaContent)
    .filter((item) => item.content_key)
    .sort((a, b) => a.sequence_number - b.sequence_number || a.content_key.localeCompare(b.content_key));
  state.contentByMangaId.set(key, normalized);
  return normalized;
}

async function ensureContentLibraryIndex() {
  if (state.contentLibraryReady) return;
  elements.pickerStatus.textContent = "Loading manga content index...";
  const combined = [];
  for (const manga of state.mangaItems) {
    try {
      const items = await fetchContentByMangaId(manga.manga_id);
      items.forEach((item) => {
        combined.push({
          ...item,
          parent_title: manga.title,
          parent_cover: manga.cover_url,
        });
      });
    } catch (_error) {
      // continue loading best-effort
    }
  }
  state.contentLibraryIndex = combined;
  state.contentLibraryReady = true;
  elements.pickerStatus.textContent = "";
}

function buildMangaFilterOptions() {
  const options = [
    '<option value="">All Manga</option>',
    ...state.mangaItems.map((item) => `<option value="${escapeHtml(item.manga_id)}">${escapeHtml(item.title || item.manga_id)}</option>`),
  ];
  elements.pickerMangaFilter.innerHTML = options.join("");
}

async function fetchCategoryItems(categoryId) {
  const url = new URL(endpoint.itemGet);
  url.searchParams.set("category_id", categoryId);
  const body = await requestJson(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${state.session.accessToken}` },
  });
  const data = responseData(body);
  const items = Array.isArray(data?.items) ? data.items : [];
  state.categoryItems = items
    .map(normalizeCategoryItem)
    .filter((item) => item.category_id && item.sort_key)
    .sort((a, b) => a.display_order - b.display_order || a.sort_key.localeCompare(b.sort_key));
}

function suggestNextSortSequence() {
  return state.categoryItems.reduce((max, item) => {
    const leading = String(item.sort_key || "").split("#")[0];
    return Math.max(max, normalizeNumber(leading, 0));
  }, 0) + 1;
}

function suggestNextItemOrder() {
  return state.categoryItems.reduce((max, item) => Math.max(max, normalizeNumber(item.display_order, 0)), 0) + 1;
}

function buildSortKeyForRecord(itemType, mangaId, contentKey) {
  const seq = String(suggestNextSortSequence()).padStart(4, "0");
  if (itemType === "MANGA_CONTENT") {
    return `${seq}#CONTENT#${mangaId}#${contentKey}`;
  }
  return `${seq}#MANGA#${mangaId}`;
}

function titleCaseWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatContentTypeLabel(contentType) {
  const normalized = String(contentType || "").trim().replace(/[_-]+/g, " ");
  if (!normalized) return "";
  return titleCaseWords(normalized);
}

function parseContentMetaFromKey(contentKey) {
  const value = String(contentKey || "").trim();
  if (!value) return { contentType: "", sequenceNumber: 0 };
  const [rawType = "", rawSequence = ""] = value.split("#", 2);
  const sequenceDigits = String(rawSequence).replace(/[^\d]/g, "");
  return {
    contentType: rawType,
    sequenceNumber: normalizeNumber(sequenceDigits, 0),
  };
}

function buildContentSubtitle(contentType, sequenceNumber) {
  const typeLabel = formatContentTypeLabel(contentType);
  const seq = normalizeNumber(sequenceNumber, 0);
  if (typeLabel && seq > 0) return `${typeLabel} #${seq}`;
  if (typeLabel) return typeLabel;
  if (seq > 0) return `#${seq}`;
  return "";
}

async function resolveCategoryItemViewModel(item) {
  if (item.item_type === "MANGA_CONTENT") {
    const contentList = await fetchContentByMangaId(item.manga_id);
    const content = contentList.find((entry) => entry.content_key === item.content_key);
    const parsedMeta = parseContentMetaFromKey(item.content_key);
    const name = item.title || content?.title || content?.content_key || item.content_key || "Untitled";
    const cover = item.cover_url || content?.cover_url || state.mangaById.get(item.manga_id)?.cover_url || FALLBACK_COVER;
    const subtitle = buildContentSubtitle(
      content?.content_type || parsedMeta.contentType,
      content?.sequence_number || parsedMeta.sequenceNumber
    );
    return { ...item, display_name: name, display_cover: cover, display_subtitle: subtitle };
  }
  const manga = state.mangaById.get(item.manga_id);
  const name = item.title || manga?.title || item.manga_id || "Untitled";
  const cover = item.cover_url || manga?.cover_url || FALLBACK_COVER;
  return { ...item, display_name: name, display_cover: cover, display_subtitle: "Series" };
}

async function renderCategoryItems() {
  elements.itemsTableBody.innerHTML = "";
  if (!state.activeCategory) return;
  if (!state.categoryItems.length) {
    elements.itemsTableBody.innerHTML = '<tr><td class="admin-grid-empty" colspan="4">No items in this category yet.</td></tr>';
    return;
  }

  const viewModels = await Promise.all(state.categoryItems.map(resolveCategoryItemViewModel));
  const fragment = document.createDocumentFragment();
  viewModels.forEach((item, index) => {
    const row = document.createElement("tr");
    const isFirst = index === 0;
    const isLast = index === viewModels.length - 1;
    const orderValue = item.display_order > 0 ? item.display_order : index + 1;
    row.innerHTML = `
      <td><img class="thumb" src="${escapeHtml(item.display_cover || FALLBACK_COVER)}" alt="" loading="lazy" decoding="async" /></td>
      <td>
        <div class="name-cell">
          <div class="name-main">${escapeHtml(item.display_name)}</div>
          ${item.display_subtitle ? `<div class="name-sub">${escapeHtml(item.display_subtitle)}</div>` : ""}
        </div>
      </td>
      <td>
        <div class="order-cell">
          <div class="category-order-control">
            <button
              type="button"
              class="icon-btn reorder-btn"
              data-move-down="${escapeHtml(item.sort_key)}"
              aria-label="Move down"
              title="Move down"
              ${isLast ? "disabled" : ""}
            >
              <span class="reorder-glyph" aria-hidden="true">&darr;</span>
            </button>
            <span class="category-order-value">${escapeHtml(String(orderValue))}</span>
            <button
              type="button"
              class="icon-btn reorder-btn"
              data-move-up="${escapeHtml(item.sort_key)}"
              aria-label="Move up"
              title="Move up"
              ${isFirst ? "disabled" : ""}
            >
              <span class="reorder-glyph" aria-hidden="true">&uarr;</span>
            </button>
          </div>
        </div>
      </td>
      <td>
        <button type="button" class="icon-btn is-danger" data-remove-item="${escapeHtml(item.sort_key)}" aria-label="Remove item" title="Remove item">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path></svg>
        </button>
      </td>
    `;
    fragment.appendChild(row);
  });
  elements.itemsTableBody.appendChild(fragment);
}

async function updateCategoryItemDisplayOrder(sortKey, displayOrder) {
  const categoryId = String(state.activeCategory?.category_id || "").trim();
  if (!categoryId) throw new Error("Select a category first.");
  const safeOrder = Math.max(1, normalizeNumber(displayOrder, 1));
  await requestJson(endpoint.itemUpdate, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({
      category_id: categoryId,
      sort_key: sortKey,
      display_order: safeOrder,
    }),
  });
}

function getSortedCategoryItems() {
  return [...state.categoryItems].sort((a, b) => a.display_order - b.display_order || a.sort_key.localeCompare(b.sort_key));
}

function buildLegacySortKey(item, sequence, nonce) {
  const seq = String(sequence).padStart(4, "0");
  const suffix = `#R#${nonce}`;
  if (item.item_type === "MANGA_CONTENT") {
    return `${seq}#CONTENT#${item.manga_id}#${item.content_key}${suffix}`;
  }
  return `${seq}#MANGA#${item.manga_id}${suffix}`;
}

function buildCategoryItemCreatePayload(record, sortKey, { includeDisplayOrder = true, displayOrder = 1 } = {}) {
  const payload = {
    category_id: String(state.activeCategory?.category_id || "").trim(),
    sort_key: sortKey,
    item_type: record.item_type,
    manga_id: record.manga_id,
    title: record.name || record.title || "",
    cover_url: record.cover || record.cover_url || "",
  };
  if (record.item_type === "MANGA_CONTENT") {
    payload.content_key = record.content_key;
  }
  if (includeDisplayOrder) {
    payload.display_order = Math.max(1, normalizeNumber(displayOrder, 1));
  }
  return payload;
}

async function resequenceCategoryItemsLegacy(orderedItems) {
  const categoryId = String(state.activeCategory?.category_id || "").trim();
  if (!categoryId) throw new Error("Select a category first.");
  const nonce = Date.now().toString(36);
  const remaps = orderedItems.map((item, index) => ({
    oldSortKey: item.sort_key,
    newSortKey: buildLegacySortKey(item, index + 1, nonce),
    item,
  }));

  for (const remap of remaps) {
    const payload = {
      category_id: categoryId,
      sort_key: remap.newSortKey,
      item_type: remap.item.item_type,
      manga_id: remap.item.manga_id,
      title: remap.item.title || "",
      cover_url: remap.item.cover_url || "",
    };
    if (remap.item.item_type === "MANGA_CONTENT") {
      payload.content_key = remap.item.content_key;
    }
    await requestJson(endpoint.itemCreate, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
  }

  for (const remap of remaps) {
    await requestJson(endpoint.itemDelete, {
      method: "DELETE",
      headers: jsonHeaders(),
      body: JSON.stringify({ category_id: categoryId, sort_key: remap.oldSortKey }),
    });
  }
}

async function reorderCategoryItemsLegacyByIndex(sortKey, targetIndex) {
  const items = getSortedCategoryItems();
  const currentIndex = items.findIndex((item) => item.sort_key === sortKey);
  if (currentIndex < 0) return;
  const bounded = Math.max(0, Math.min(targetIndex, items.length - 1));
  if (bounded === currentIndex) return;
  const [current] = items.splice(currentIndex, 1);
  items.splice(bounded, 0, current);
  await resequenceCategoryItemsLegacy(items);
}

async function moveCategoryItem(sortKey, direction) {
  if (state.itemDisplayOrderSupported === false) {
    const items = getSortedCategoryItems();
    const index = items.findIndex((item) => item.sort_key === sortKey);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    await reorderCategoryItemsLegacyByIndex(sortKey, targetIndex);
    return;
  }

  const items = getSortedCategoryItems();
  const index = items.findIndex((item) => item.sort_key === sortKey);
  if (index < 0) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return;

  const current = items[index];
  try {
    await updateCategoryItemDisplayOrder(current.sort_key, targetIndex + 1);
    state.itemDisplayOrderSupported = true;
  } catch (error) {
    if (!isUnsupportedDisplayOrderError(error)) throw error;
    state.itemDisplayOrderSupported = false;
    showSuccess("Reorder compatibility mode enabled.");
    await reorderCategoryItemsLegacyByIndex(sortKey, targetIndex);
  }
}

function updateRightPaneState() {
  const active = state.activeCategory;
  if (!active) {
    elements.selectedCategoryTitle.textContent = "Category Items";
    elements.itemsPanelDisabled.classList.remove("hidden");
    elements.itemsPanelContent.classList.add("hidden");
    elements.itemsTableBody.innerHTML = "";
    elements.openPickerBtn.disabled = true;
    return;
  }
  elements.selectedCategoryTitle.textContent = `Category Items - ${active.name || active.category_id}`;
  elements.itemsPanelDisabled.classList.add("hidden");
  elements.itemsPanelContent.classList.remove("hidden");
  elements.openPickerBtn.disabled = state.busy;
}

async function refreshCategoryItems() {
  const categoryId = String(state.activeCategory?.category_id || "").trim();
  if (!categoryId) return;
  clearError();
  setBusy(true);
  try {
    await fetchCategoryItems(categoryId);
    await renderCategoryItems();
    if (getPickerModalOpen()) {
      await renderPickerResults();
    }
  } finally {
    setBusy(false);
  }
}

function getPickerMode() {
  return String(elements.pickerTypeSelect.value || "MANGA").trim().toUpperCase();
}

function updatePickerModeUi() {
  const contentMode = getPickerMode() === "MANGA_CONTENT";
  elements.pickerMangaFilterWrap.classList.toggle("hidden", !contentMode);
}

function pickerRecordKey(record) {
  if (record.item_type === "MANGA_CONTENT") {
    return `MANGA_CONTENT::${record.manga_id}::${record.content_key}`;
  }
  return `MANGA::${record.manga_id}`;
}

async function getPickerResults() {
  const search = String(elements.pickerSearchInput.value || "").trim().toLowerCase();
  if (getPickerMode() === "MANGA_CONTENT") {
    await ensureContentLibraryIndex();
    const mangaFilter = String(elements.pickerMangaFilter.value || "").trim();
    return state.contentLibraryIndex
      .filter((item) => (mangaFilter ? item.manga_id === mangaFilter : true))
      .filter((item) => {
        if (!search) return true;
        return `${item.title} ${item.content_key} ${item.manga_id} ${item.parent_title}`.toLowerCase().includes(search);
      })
      .slice(0, 80)
      .map((item) => ({
        item_type: "MANGA_CONTENT",
        manga_id: item.manga_id,
        content_key: item.content_key,
        name: item.title || item.content_key,
        cover: item.cover_url || item.parent_cover || FALLBACK_COVER,
        content_type: item.content_type,
        sequence_number: item.sequence_number,
      }));
  }

  return state.mangaItems
    .filter((item) => {
      if (!search) return true;
      return `${item.title} ${item.manga_id}`.toLowerCase().includes(search);
    })
    .slice(0, 80)
    .map((item) => ({
      item_type: "MANGA",
      manga_id: item.manga_id,
      content_key: "",
      name: item.title || item.manga_id,
      cover: item.cover_url || FALLBACK_COVER,
      content_type: "",
      sequence_number: 0,
    }));
}
function updatePickerSubmitState() {
  const count = state.pickerSelections.size;
  elements.submitPickerBtn.disabled = state.busy || count === 0;
  elements.submitPickerBtn.textContent = count ? `Add Selected (${count})` : "Add Selected";
}

async function renderPickerResults() {
  elements.pickerResultsBody.innerHTML = "";
  state.pickerResultMap.clear();
  if (!state.activeCategory) return;

  const results = await getPickerResults();
  if (!results.length) {
    elements.pickerResultsBody.innerHTML = '<tr><td class="admin-grid-empty" colspan="5">No library matches found.</td></tr>';
    return;
  }

  const existingKeys = new Set(state.categoryItems.map((item) => pickerRecordKey(item)));

  const fragment = document.createDocumentFragment();
  results.forEach((record) => {
    const compoundKey = pickerRecordKey(record);
    state.pickerResultMap.set(compoundKey, record);

    if (existingKeys.has(compoundKey)) {
      state.pickerSelections.delete(compoundKey);
    }

    const checked = state.pickerSelections.has(compoundKey);
    const disabled = existingKeys.has(compoundKey);
    const contentType = formatContentTypeLabel(record.content_type);
    const sequenceNumber = normalizeNumber(record.sequence_number, 0);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="picker-select-wrap">
          <input
            type="checkbox"
            data-picker-select="${escapeHtml(compoundKey)}"
            ${checked ? "checked" : ""}
            ${disabled ? "disabled" : ""}
            aria-label="Select item"
          />
        </div>
      </td>
      <td><img class="thumb" src="${escapeHtml(record.cover || FALLBACK_COVER)}" alt="" loading="lazy" decoding="async" /></td>
      <td>
        <div class="name-cell">
          <div class="name-main">${escapeHtml(record.name)}</div>
        </div>
      </td>
      <td>${escapeHtml(contentType || "-")}</td>
      <td>${escapeHtml(sequenceNumber > 0 ? String(sequenceNumber) : "-")}</td>
    `;
    fragment.appendChild(row);
  });

  elements.pickerResultsBody.appendChild(fragment);
  updatePickerSubmitState();
}

async function addRecordToActiveCategory(record) {
  const categoryId = String(state.activeCategory?.category_id || "").trim();
  if (!categoryId) throw new Error("Select a category first.");

  const sortKey = buildSortKeyForRecord(record.item_type, record.manga_id, record.content_key);
  const payloadWithOrder = buildCategoryItemCreatePayload(record, sortKey, {
    includeDisplayOrder: state.itemDisplayOrderSupported !== false,
    displayOrder: suggestNextItemOrder(),
  });
  try {
    await requestJson(endpoint.itemCreate, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payloadWithOrder),
    });
    if (state.itemDisplayOrderSupported !== false) {
      state.itemDisplayOrderSupported = true;
    }
  } catch (error) {
    if (!isUnsupportedDisplayOrderError(error) || state.itemDisplayOrderSupported === false) {
      throw error;
    }
    state.itemDisplayOrderSupported = false;
    const payloadLegacy = buildCategoryItemCreatePayload(record, sortKey, { includeDisplayOrder: false });
    await requestJson(endpoint.itemCreate, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payloadLegacy),
    });
    showSuccess("Reorder compatibility mode enabled.");
  }
}

async function addSelectedRecordsToActiveCategory() {
  if (!state.activeCategory) throw new Error("Select a category first.");
  const keys = [...state.pickerSelections];
  if (!keys.length) return;

  for (const key of keys) {
    const record = state.pickerResultMap.get(key);
    if (!record) continue;
    await addRecordToActiveCategory(record);
  }

  showSuccess(`${keys.length} item(s) added to category.`);
  state.pickerSelections.clear();
  closePickerModal();
  await refreshCategoryItems();
}

async function removeCategoryItem(sortKey) {
  const categoryId = String(state.activeCategory?.category_id || "").trim();
  if (!categoryId) return;
  if (!window.confirm("Remove this item from category?")) return;

  await requestJson(endpoint.itemDelete, {
    method: "DELETE",
    headers: jsonHeaders(),
    body: JSON.stringify({ category_id: categoryId, sort_key: sortKey }),
  });
  showSuccess("Category item removed.");
  await refreshCategoryItems();
}

function selectCategory(categoryId) {
  state.activeCategory = state.categories.find((item) => item.category_id === categoryId) || null;
  updateRightPaneState();
  applyCategoryFilter();
  if (state.activeCategory) {
    void refreshCategoryItems();
  }
}

function wireEvents() {
  elements.signoutLinks.forEach((link) => {
    link.addEventListener("click", () => clearAuthSession());
  });

  elements.refreshCategoriesBtn.addEventListener("click", () => {
    void refreshCategories().catch((error) => showError(error instanceof Error ? error.message : String(error)));
  });

  elements.newCategoryBtn.addEventListener("click", () => openCategoryModal("create"));
  elements.closeCategoryModalBtn.addEventListener("click", () => {
    void closeCategoryModal().catch((error) => showError(error instanceof Error ? error.message : String(error)));
  });
  elements.cancelCategoryBtn.addEventListener("click", () => {
    void closeCategoryModal().catch((error) => showError(error instanceof Error ? error.message : String(error)));
  });

  document.querySelectorAll("[data-close-category-modal]").forEach((node) => {
    node.addEventListener("click", () => {
      void closeCategoryModal().catch((error) => showError(error instanceof Error ? error.message : String(error)));
    });
  });

  document.querySelectorAll("[data-close-picker-modal]").forEach((node) => {
    node.addEventListener("click", closePickerModal);
  });
  elements.closePickerModalBtn.addEventListener("click", closePickerModal);

  elements.categoryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();
    setBusy(true);
    void saveCategory()
      .catch((error) => showError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  });

  elements.categoriesTableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const moveUpBtn = target.closest("[data-category-move-up]");
    if (moveUpBtn) {
      const id = String(moveUpBtn.getAttribute("data-category-move-up") || "").trim();
      if (!id) return;
      clearError();
      setBusy(true);
      void moveCategory(id, "up")
        .then(() => refreshCategories())
        .catch((error) => showError(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
      return;
    }

    const moveDownBtn = target.closest("[data-category-move-down]");
    if (moveDownBtn) {
      const id = String(moveDownBtn.getAttribute("data-category-move-down") || "").trim();
      if (!id) return;
      clearError();
      setBusy(true);
      void moveCategory(id, "down")
        .then(() => refreshCategories())
        .catch((error) => showError(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
      return;
    }

    const manageBtn = target.closest("[data-manage-category]");
    if (manageBtn) {
      selectCategory(String(manageBtn.getAttribute("data-manage-category") || "").trim());
      return;
    }

    const editBtn = target.closest("[data-edit-category]");
    if (editBtn) {
      const id = String(editBtn.getAttribute("data-edit-category") || "").trim();
      const category = state.categories.find((item) => item.category_id === id);
      if (category) openCategoryModal("update", category);
      return;
    }

    const deleteBtn = target.closest("[data-delete-category]");
    if (deleteBtn) {
      const id = String(deleteBtn.getAttribute("data-delete-category") || "").trim();
      clearError();
      setBusy(true);
      void deleteCategory(id)
        .catch((error) => showError(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
    }
  });

  elements.itemsTableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const moveUpBtn = target.closest("[data-move-up]");
    if (moveUpBtn) {
      const sortKey = String(moveUpBtn.getAttribute("data-move-up") || "").trim();
      if (!sortKey) return;
      clearError();
      setBusy(true);
      void moveCategoryItem(sortKey, "up")
        .then(() => refreshCategoryItems())
        .catch((error) => showError(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
      return;
    }

    const moveDownBtn = target.closest("[data-move-down]");
    if (moveDownBtn) {
      const sortKey = String(moveDownBtn.getAttribute("data-move-down") || "").trim();
      if (!sortKey) return;
      clearError();
      setBusy(true);
      void moveCategoryItem(sortKey, "down")
        .then(() => refreshCategoryItems())
        .catch((error) => showError(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
      return;
    }

    const removeBtn = target.closest("[data-remove-item]");
    if (!removeBtn) return;
    const sortKey = String(removeBtn.getAttribute("data-remove-item") || "").trim();
    clearError();
    setBusy(true);
    void removeCategoryItem(sortKey)
      .catch((error) => showError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  });

  elements.openPickerBtn.addEventListener("click", openPickerModal);

  elements.pickerTypeSelect.addEventListener("change", () => {
    updatePickerModeUi();
    state.pickerSelections.clear();
    updatePickerSubmitState();
    void renderPickerResults();
  });

  elements.pickerSearchInput.addEventListener("input", () => {
    void renderPickerResults();
  });

  elements.pickerMangaFilter.addEventListener("change", () => {
    void renderPickerResults();
  });

  elements.pickerRefreshBtn.addEventListener("click", () => {
    state.contentLibraryReady = false;
    state.contentLibraryIndex = [];
    void renderPickerResults();
  });

  elements.pickerResultsBody.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches("[data-picker-select]")) return;

    const key = String(target.getAttribute("data-picker-select") || "").trim();
    if (!key) return;
    if (target.checked) {
      state.pickerSelections.add(key);
    } else {
      state.pickerSelections.delete(key);
    }
    updatePickerSubmitState();
  });

  elements.submitPickerBtn.addEventListener("click", () => {
    clearError();
    setBusy(true);
    void addSelectedRecordsToActiveCategory()
      .catch((error) => showError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  });
}

async function init() {
  if (!ensureAdminSession()) return;
  wireAccountIdentity();
  updateRightPaneState();
  updatePickerModeUi();
  wireEvents();

  if (!featureCategoryAdminApiConfigLooksReady()) {
    showError("Feature Category API endpoints are not configured in auth-config.js.");
    return;
  }
  if (!mangaApiConfigLooksReady()) {
    showError("Manga API endpoints are not configured in auth-config.js.");
    return;
  }
  if (!mangaContentApiConfigLooksReady()) {
    showError("Manga Content API endpoints are not configured in auth-config.js.");
    return;
  }

  setBusy(true);
  try {
    await Promise.all([fetchCategories(), fetchMangaLibrary()]);
    buildMangaFilterOptions();
    applyCategoryFilter();
    elements.pickerStatus.textContent = "Select one or more records, then click Add Selected.";
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

void init();
