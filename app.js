import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import { appAuthzConfig } from "./auth/auth-config.js";
import { getAuthSession, getJwtGivenName, getJwtPicture } from "./auth/auth-session.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const FALLBACK_COVER = "./content/manga/placeholder.svg";
const SINGLE_PAGE_BREAKPOINT = 900;
const MAX_ZOOM = 2;

function endpointLooksConfigured(value) {
  return String(value || "").trim().startsWith("https://");
}

function endpointFromMangaBase(pathname) {
  const mangaEndpoint = String(appAuthzConfig?.getMangaEndpoint || "").trim();
  if (!endpointLooksConfigured(mangaEndpoint)) {
    return "";
  }
  try {
    const url = new URL(mangaEndpoint);
    url.pathname = pathname;
    url.search = "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

const endpoint = {
  featureCategoryGet:
    String(appAuthzConfig?.getFeatureCategoryEndpoint || "").trim() ||
    endpointFromMangaBase("/feature-category"),
  featureCategoryItemGet:
    String(appAuthzConfig?.getFeatureCategoryItemEndpoint || "").trim() ||
    endpointFromMangaBase("/feature-category-item"),
  mangaContentGet:
    String(appAuthzConfig?.getMangaContentEndpoint || "").trim() ||
    endpointFromMangaBase("/manga-content"),
};

const state = {
  pdfDoc: null,
  totalPdfPages: 0,
  spreads: [],
  currentSpread: 0,
  direction: "rtl",
  zoom: 1,
  renderInProgress: false,
  pendingSpread: null,
  singlePageMode: window.innerWidth < SINGLE_PAGE_BREAKPOINT,
  contentItems: [],
  librarySections: [],
  availableGenres: [],
  availableStatuses: [],
  libraryViewMode: "home",
  searchQuery: "",
  searchGenre: "",
  searchCategory: "",
  searchStatus: "",
  searchSort: "relevance",
  activeItem: null,
  eventsBound: false,
  awaitingFirstRender: false,
};

const elements = {
  libraryView: document.getElementById("libraryView"),
  libraryGrid: document.getElementById("libraryGrid"),
  libraryError: document.getElementById("libraryError"),
  readerView: document.getElementById("readerView"),
  libraryLink: document.getElementById("libraryLink"),
  pager: document.querySelector("footer.pager"),
  stage: document.getElementById("canvasStage"),
  readerLoading: document.getElementById("readerLoading"),
  readerLoadingText: document.getElementById("readerLoadingText"),
  spread: document.getElementById("spreadContainer"),
  leftPanel: document.getElementById("leftPanel"),
  rightPanel: document.getElementById("rightPanel"),
  leftCanvas: document.getElementById("leftCanvas"),
  rightCanvas: document.getElementById("rightCanvas"),
  leftFallback: document.getElementById("leftFallback"),
  rightFallback: document.getElementById("rightFallback"),
  errorBanner: document.getElementById("errorBanner"),
  leftNav: document.getElementById("leftNav"),
  rightNav: document.getElementById("rightNav"),
  pageIndicator: document.getElementById("pageIndicator"),
  zoomOut: document.getElementById("zoomOut"),
  zoomIn: document.getElementById("zoomIn"),
  zoomValue: document.getElementById("zoomValue"),
  bookmarkToggle: document.getElementById("bookmarkToggle"),
  directionToggle: document.getElementById("directionToggle"),
  directionValue: document.getElementById("directionValue"),
  adminPortalGroup: document.getElementById("adminPortalGroup"),
  accountAvatar: document.getElementById("accountAvatar"),
  welcomeMessage: document.getElementById("welcomeMessage"),
  accountIconSvg: document.querySelector(".settings-trigger .library-icon-svg"),
  openSearchView: document.getElementById("openSearchView"),
  openHomeView: document.getElementById("openHomeView"),
  librarySearchView: document.getElementById("librarySearchView"),
  librarySearchInput: document.getElementById("librarySearchInput"),
  librarySortSelect: document.getElementById("librarySortSelect"),
  libraryGenreSelect: document.getElementById("libraryGenreSelect"),
  libraryCategorySelect: document.getElementById("libraryCategorySelect"),
  libraryStatusSelect: document.getElementById("libraryStatusSelect"),
  librarySearchCount: document.getElementById("librarySearchCount"),
  librarySearchResults: document.getElementById("librarySearchResults"),
};

function wireAdminMenu() {
  const session = getAuthSession();
  const isAdmin = Boolean(session?.isAdmin || Number(session?.admin || 0) === 1);
  if (isAdmin) {
    elements.adminPortalGroup?.classList.remove("hidden");
  } else {
    elements.adminPortalGroup?.classList.add("hidden");
  }
}

function wireAccountIdentity() {
  const session = getAuthSession();
  const idToken = String(session?.idToken || "").trim();
  const givenName = String(session?.givenName || getJwtGivenName(idToken) || "").trim();
  const image = String(session?.image || getJwtPicture(idToken) || "").trim();

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

function showLibraryError(message) {
  elements.libraryError.textContent = message;
  elements.libraryError.classList.remove("hidden");
}

function clearLibraryError() {
  elements.libraryError.textContent = "";
  elements.libraryError.classList.add("hidden");
}

function setError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("hidden");
}

function clearError() {
  elements.errorBanner.textContent = "";
  elements.errorBanner.classList.add("hidden");
}

function responseData(payload) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

async function requestJson(url, options = {}) {
  if (!endpointLooksConfigured(url)) {
    throw new Error("API endpoint is not configured.");
  }
  const session = getAuthSession();
  const token = String(session?.accessToken || "").trim();
  const headers = {
    ...(options.headers || {}),
  };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.method && options.method.toUpperCase() !== "GET" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers,
    cache: "no-store",
  });
  const raw = await response.text();
  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      parsed = { raw };
    }
  }

  if (!response.ok) {
    const errorMessage = String(parsed?.error || parsed?.message || raw || "").trim();
    throw new Error(`HTTP ${response.status}${errorMessage ? `: ${errorMessage}` : ""}`);
  }
  if (parsed && typeof parsed === "object" && parsed.success === false) {
    throw new Error(String(parsed.error || "API request failed."));
  }
  return parsed;
}

function normalizeCategory(category) {
  const categoryId = String(category?.category_id || "").trim();
  const name = String(category?.name || "").trim();
  if (!categoryId || !name) {
    return null;
  }
  const displayOrder = Number(category?.display_order);
  return {
    id: categoryId,
    title: name,
    order: Number.isFinite(displayOrder) ? displayOrder : Number.MAX_SAFE_INTEGER,
  };
}

function titleCaseWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function parseContentMetaFromKey(contentKey) {
  const value = String(contentKey || "").trim();
  if (!value) {
    return { contentType: "", sequenceNumber: 0 };
  }
  const [rawType = "", rawSequence = ""] = value.split("#", 2);
  const sequenceDigits = String(rawSequence).replace(/[^\d]/g, "");
  return {
    contentType: rawType,
    sequenceNumber: sequenceDigits ? Number(sequenceDigits) : 0,
  };
}

function formatContentTypeLabel(contentType) {
  const normalized = String(contentType || "").trim().replace(/[_-]+/g, " ");
  if (!normalized) {
    return "";
  }
  return titleCaseWords(normalized);
}

function normalizeCategoryItem(item) {
  const categoryId = String(item?.category_id || "").trim();
  const mangaId = String(item?.manga_id || "").trim();
  const itemType = String(item?.item_type || "").trim().toUpperCase();
  const contentKey = String(item?.content_key || "").trim();
  if (!categoryId || !mangaId || !itemType) {
    return null;
  }

  const itemId = itemType === "MANGA_CONTENT" && contentKey
    ? `${mangaId}::${contentKey}`
    : mangaId;
  const title = String(item?.title || mangaId).trim();
  const cover = String(item?.cover_url || "").trim() || FALLBACK_COVER;
  const tags = Array.isArray(item?.tags)
    ? item.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
  const rawContentType = String(item?.content_type || "").trim();
  const parsedContentMeta = parseContentMetaFromKey(contentKey);
  const contentType = rawContentType || parsedContentMeta.contentType;
  const parsedSequenceNumber = Number(item?.sequence_number);
  const sequenceNumber = Number.isFinite(parsedSequenceNumber) && parsedSequenceNumber > 0
    ? parsedSequenceNumber
    : parsedContentMeta.sequenceNumber;

  return {
    id: itemId,
    mangaId,
    contentKey,
    itemType,
    title,
    cover,
    pdf: "",
    groups: [categoryId],
    genres: tags,
    description: "",
    status: String(item?.status || "").trim(),
    contentType,
    sequenceNumber,
  };
}

function inferItemStatus(item) {
  const explicit = String(item?.status || "").trim();
  if (explicit) {
    return explicit;
  }

  const haystack = [
    item?.description,
    ...(Array.isArray(item?.genres) ? item.genres : []),
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (!haystack) {
    return "Unknown";
  }
  if (haystack.includes("complete") || haystack.includes("completed")) {
    return "Completed";
  }
  if (haystack.includes("ongoing")) {
    return "Ongoing";
  }
  if (haystack.includes("hiatus")) {
    return "Hiatus";
  }
  return "Unknown";
}

function buildQueryPreviewItem(params) {
  const pdf = String(params.get("pdf") || "").trim();
  if (!pdf) {
    return null;
  }

  const id = String(params.get("manga") || "preview").trim() || "preview";
  const title = String(params.get("title") || "Preview").trim() || "Preview";
  const cover = String(params.get("cover") || params.get("thumbnail") || "").trim();

  return {
    id,
    mangaId: id,
    contentKey: String(params.get("content_key") || "").trim(),
    itemType: "MANGA_CONTENT",
    title,
    pdf,
    cover: cover || FALLBACK_COVER,
    groups: [],
    genres: [],
    description: "",
  };
}

async function loadContent() {
  try {
    if (!endpointLooksConfigured(endpoint.featureCategoryGet)) {
      throw new Error("FeatureCategory GET endpoint is not configured.");
    }
    if (!endpointLooksConfigured(endpoint.featureCategoryItemGet)) {
      throw new Error("FeatureCategoryItem GET endpoint is not configured.");
    }

    const categoriesResponse = await requestJson(endpoint.featureCategoryGet, { method: "GET" });
    const categoriesData = responseData(categoriesResponse);
    const categories = Array.isArray(categoriesData?.items)
      ? categoriesData.items.map(normalizeCategory).filter(Boolean)
      : [];

    if (!categories.length) {
      throw new Error("No active feature categories were returned.");
    }

    categories.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    const itemResponseList = await Promise.all(
      categories.map(async (category) => {
        const url = new URL(endpoint.featureCategoryItemGet);
        url.searchParams.set("category_id", category.id);
        const response = await requestJson(url.toString(), { method: "GET" });
        const data = responseData(response);
        const items = Array.isArray(data?.items)
          ? data.items.map(normalizeCategoryItem).filter(Boolean)
          : [];
        return { categoryId: category.id, items };
      })
    );

    const itemById = new Map();
    itemResponseList.forEach(({ categoryId, items }) => {
      items.forEach((item) => {
        const existing = itemById.get(item.id);
        if (!existing) {
          itemById.set(item.id, item);
          return;
        }
        const mergedGroups = Array.from(new Set([...(existing.groups || []), categoryId]));
        const mergedGenres = Array.from(new Set([...(existing.genres || []), ...(item.genres || [])]));
        existing.groups = mergedGroups;
        existing.genres = mergedGenres;
      });
    });

    const contentItems = Array.from(itemById.values());
    if (!contentItems.length) {
      throw new Error("No active feature category items were returned.");
    }

    state.contentItems = contentItems;
    state.librarySections = categories.map((category) => ({ id: category.id, title: category.title }));
    state.availableGenres = Array.from(
      new Set(
        contentItems.flatMap((item) =>
          Array.isArray(item.genres) ? item.genres : []
        )
      )
    ).sort((a, b) => a.localeCompare(b));
    state.availableStatuses = Array.from(
      new Set(contentItems.map((item) => inferItemStatus(item)))
    ).sort((a, b) => a.localeCompare(b));
    clearLibraryError();
  } catch (error) {
    state.contentItems = [];
    state.librarySections = [];
    state.availableGenres = [];
    state.availableStatuses = [];
    showLibraryError(`Could not load library from API. ${error.message}`);
    console.error(error);
  }
}

function createMangaCard(item) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "manga-card";
  card.setAttribute("data-manga-id", item.id);
  card.setAttribute("aria-label", `Open ${item.title}`);

  const cover = document.createElement("img");
  cover.className = "manga-thumb";
  cover.src = item.cover;
  cover.alt = `${item.title} cover`;
  cover.loading = "lazy";
  cover.addEventListener("error", () => {
    if (cover.src !== new URL(FALLBACK_COVER, window.location.href).href) {
      cover.src = FALLBACK_COVER;
    }
  });

  const title = document.createElement("span");
  title.className = "manga-title";
  title.textContent = item.title;

  const meta = document.createElement("span");
  meta.className = "manga-meta";
  meta.textContent = buildLibraryItemMetaLabel(item);

  card.append(cover, title, meta);
  card.addEventListener("click", () => {
    const itemType = String(item.itemType || "").trim().toUpperCase();
    if (itemType === "MANGA_CONTENT") {
      void openMangaById(item.mangaId || item.id, true, null, item.contentKey || "");
      return;
    }
    window.location.href = `./manga/manga.html?manga=${encodeURIComponent(item.mangaId || item.id)}`;
  });

  return card;
}

function buildLibraryItemMetaLabel(item) {
  const itemType = String(item?.itemType || "").trim().toUpperCase();
  if (itemType !== "MANGA_CONTENT") {
    return "Series";
  }

  const fallbackMeta = parseContentMetaFromKey(item?.contentKey || "");
  const contentType = formatContentTypeLabel(item?.contentType || fallbackMeta.contentType);
  const sequenceFromItem = Number(item?.sequenceNumber);
  const sequenceNumber = Number.isFinite(sequenceFromItem) && sequenceFromItem > 0
    ? sequenceFromItem
    : fallbackMeta.sequenceNumber;

  if (contentType && sequenceNumber > 0) {
    return `${contentType} ${sequenceNumber}`;
  }
  if (contentType) {
    return contentType;
  }
  if (sequenceNumber > 0) {
    return `#${sequenceNumber}`;
  }
  return "Series";
}

function renderGroupedLibrary() {
  elements.libraryGrid.innerHTML = "";
  if (!state.contentItems.length) {
    elements.libraryGrid.innerHTML =
      '<p class="library-empty">No manga available in feature categories.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  const sectionsToRender = state.librarySections.length
    ? state.librarySections
    : [{ id: "all", title: "All Manga" }];

  sectionsToRender.forEach((section) => {
    const itemsForSection = section.id === "all"
      ? state.contentItems
      : state.contentItems.filter((item) => item.groups.includes(section.id));

    if (!itemsForSection.length) {
      return;
    }

    const sectionWrap = document.createElement("section");
    sectionWrap.className = "library-section";

    const sectionHeader = document.createElement("div");
    sectionHeader.className = "library-section-header";

    const heading = document.createElement("h2");
    heading.className = "library-section-title";
    heading.textContent = section.title;

    const sectionAction = document.createElement("button");
    sectionAction.type = "button";
    sectionAction.className = "library-section-action";
    sectionAction.textContent = "See All >";
    sectionAction.addEventListener("click", () => {
      state.searchCategory = section.id === "all" ? "" : section.title;
      state.searchQuery = "";
      state.searchGenre = "";
      state.searchStatus = "";
      state.searchSort = "relevance";
      setLibraryViewMode("search");
    });

    const row = document.createElement("div");
    row.className = "library-row";

    itemsForSection.forEach((item) => {
      row.appendChild(createMangaCard(item));
    });

    sectionHeader.append(heading, sectionAction);
    sectionWrap.append(sectionHeader, row);
    fragment.appendChild(sectionWrap);
  });

  elements.libraryGrid.appendChild(fragment);
}

function toNormalizedLower(value) {
  return String(value || "").trim().toLowerCase();
}

function scoreItemRelevance(item, normalizedQuery, categoryTitle) {
  if (!normalizedQuery) {
    return 0;
  }
  let score = 0;
  const title = toNormalizedLower(item.title);
  const genres = (Array.isArray(item.genres) ? item.genres : []).map(toNormalizedLower);
  const category = toNormalizedLower(categoryTitle);

  if (title === normalizedQuery) {
    score += 120;
  } else if (title.startsWith(normalizedQuery)) {
    score += 95;
  } else if (title.includes(normalizedQuery)) {
    score += 70;
  }

  if (genres.some((genre) => genre === normalizedQuery)) {
    score += 45;
  } else if (genres.some((genre) => genre.includes(normalizedQuery))) {
    score += 30;
  }

  if (category === normalizedQuery) {
    score += 24;
  } else if (category.includes(normalizedQuery)) {
    score += 14;
  }

  return score;
}

function itemPrimaryCategory(item) {
  const categoryId = Array.isArray(item.groups) && item.groups.length ? item.groups[0] : "";
  if (!categoryId) {
    return "";
  }
  const category = state.librarySections.find((section) => section.id === categoryId);
  return category?.title || "";
}

function buildSearchFilteredItems() {
  const normalizedQuery = toNormalizedLower(state.searchQuery);

  return state.contentItems
    .map((item) => {
      const primaryCategory = itemPrimaryCategory(item);
      const status = inferItemStatus(item);
      const relevance = scoreItemRelevance(item, normalizedQuery, primaryCategory);
      return { item, primaryCategory, status, relevance };
    })
    .filter(({ item, primaryCategory, status, relevance }) => {
      const matchesQuery = !normalizedQuery || relevance > 0;
      const matchesGenre = !state.searchGenre || item.genres.includes(state.searchGenre);
      const matchesCategory = !state.searchCategory || primaryCategory === state.searchCategory;
      const matchesStatus = !state.searchStatus || status === state.searchStatus;
      return matchesQuery && matchesGenre && matchesCategory && matchesStatus;
    })
    .sort((left, right) => {
      if (state.searchSort === "title_asc") {
        return left.item.title.localeCompare(right.item.title);
      }
      if (state.searchSort === "title_desc") {
        return right.item.title.localeCompare(left.item.title);
      }
      if (state.searchSort === "sequence_desc") {
        const leftSeq = Number(left.item.sequenceNumber) || 0;
        const rightSeq = Number(right.item.sequenceNumber) || 0;
        if (leftSeq !== rightSeq) {
          return rightSeq - leftSeq;
        }
        return left.item.title.localeCompare(right.item.title);
      }
      if (state.searchSort === "sequence_asc") {
        const leftSeq = Number(left.item.sequenceNumber) || Number.MAX_SAFE_INTEGER;
        const rightSeq = Number(right.item.sequenceNumber) || Number.MAX_SAFE_INTEGER;
        if (leftSeq !== rightSeq) {
          return leftSeq - rightSeq;
        }
        return left.item.title.localeCompare(right.item.title);
      }
      if (right.relevance !== left.relevance) {
        return right.relevance - left.relevance;
      }
      return left.item.title.localeCompare(right.item.title);
    });
}

function populateSelectOptions(selectElement, options, activeValue = "") {
  if (!(selectElement instanceof HTMLSelectElement)) {
    return;
  }
  selectElement.innerHTML = "";
  options.forEach((option) => {
    const nextOption = document.createElement("option");
    nextOption.value = option.value;
    nextOption.textContent = option.label;
    if (option.value === activeValue) {
      nextOption.selected = true;
    }
    selectElement.appendChild(nextOption);
  });
}

function renderSearchControls() {
  const sortOptions = [
    { value: "relevance", label: "Relevance" },
    { value: "title_asc", label: "Title A-Z" },
    { value: "title_desc", label: "Title Z-A" },
    { value: "sequence_desc", label: "Newest Content" },
    { value: "sequence_asc", label: "Oldest Content" },
  ];
  populateSelectOptions(elements.librarySortSelect, sortOptions, state.searchSort);

  const genreOptions = [{ value: "", label: "All Genres" }].concat(
    state.availableGenres.map((genre) => ({ value: genre, label: genre }))
  );
  populateSelectOptions(elements.libraryGenreSelect, genreOptions, state.searchGenre);

  const categoryOptions = [{ value: "", label: "All Categories" }].concat(
    state.librarySections.map((section) => ({ value: section.title, label: section.title }))
  );
  populateSelectOptions(elements.libraryCategorySelect, categoryOptions, state.searchCategory);

  const statusOptions = [{ value: "", label: "All" }].concat(
    state.availableStatuses.map((status) => ({ value: status, label: status }))
  );
  populateSelectOptions(elements.libraryStatusSelect, statusOptions, state.searchStatus);

  if (elements.librarySearchInput) {
    elements.librarySearchInput.value = state.searchQuery;
  }
}

function renderSearchLibrary() {
  if (!elements.librarySearchResults) {
    return;
  }
  elements.librarySearchResults.innerHTML = "";

  if (!state.contentItems.length) {
    elements.librarySearchResults.innerHTML = '<p class="library-empty">No manga available in feature categories.</p>';
    if (elements.librarySearchCount) {
      elements.librarySearchCount.textContent = "0 results";
    }
    return;
  }

  const matches = buildSearchFilteredItems();
  const searchTermLabel = String(state.searchQuery || "").trim();
  const countText = `${matches.length} result${matches.length === 1 ? "" : "s"}${searchTermLabel ? ` for "${searchTermLabel}"` : ""}`;
  if (elements.librarySearchCount) {
    elements.librarySearchCount.textContent = countText;
  }

  if (!matches.length) {
    elements.librarySearchResults.innerHTML = '<p class="library-empty">No matches found. Try different filters.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  matches.forEach(({ item }) => {
    fragment.appendChild(createMangaCard(item));
  });
  elements.librarySearchResults.appendChild(fragment);
}

function setLibraryViewMode(mode) {
  state.libraryViewMode = mode === "search" ? "search" : "home";
  const inSearchMode = state.libraryViewMode === "search";
  elements.librarySearchView?.classList.toggle("hidden", !inSearchMode);
  elements.libraryGrid?.classList.toggle("hidden", inSearchMode);
  elements.openSearchView?.classList.toggle("hidden", inSearchMode);
  elements.openHomeView?.classList.toggle("hidden", !inSearchMode);

  if (inSearchMode) {
    renderSearchControls();
    renderSearchLibrary();
    window.requestAnimationFrame(() => elements.librarySearchInput?.focus());
  } else {
    renderGroupedLibrary();
  }
}

function renderLibrary() {
  if (state.libraryViewMode === "search") {
    renderSearchControls();
    renderSearchLibrary();
    return;
  }
  renderGroupedLibrary();
}

function showLibraryView(pushState = false) {
  elements.libraryView.classList.remove("hidden");
  elements.readerView.classList.add("hidden");
  document.body.classList.remove("reader-active");
  document.body.classList.add("library-active");
  document.title = "BluPetal Library";
  setReaderLoading(false);

  if (pushState) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("manga");
    window.history.pushState({}, "", nextUrl);
  }
}

function showReaderView() {
  elements.libraryView.classList.add("hidden");
  elements.readerView.classList.remove("hidden");
  document.body.classList.add("reader-active");
  document.body.classList.remove("library-active");
  setReaderLoading(true, "Loading...");
}

function setReaderLoading(isLoading, message = "Loading...") {
  if (!elements.readerView) {
    return;
  }
  elements.readerView.classList.toggle("is-loading", Boolean(isLoading));
  elements.stage.classList.toggle("is-loading", Boolean(isLoading));
  if (elements.readerLoading) {
    elements.readerLoading.setAttribute("aria-hidden", isLoading ? "false" : "true");
  }
  if (elements.readerLoadingText && message) {
    elements.readerLoadingText.textContent = String(message);
  }
}

function updateReaderBackLink() {
  if (!elements.libraryLink) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const source = String(params.get("source") || "").trim().toLowerCase();
  if (source === "admin") {
    elements.libraryLink.href = "./manga/admin/admin-manga.html";
    elements.libraryLink.setAttribute("aria-label", "Back to manga admin");
    return;
  }

  const activeId = String(state.activeItem?.id || "").trim();
  const activeMangaId = String(state.activeItem?.mangaId || activeId).trim();
  const isCatalogItem =
    Boolean(activeId) &&
    state.contentItems.some((entry) => entry.id === activeId || entry.mangaId === activeMangaId);
  if (isCatalogItem) {
    elements.libraryLink.href = `./manga/manga.html?manga=${encodeURIComponent(
      activeMangaId
    )}`;
    elements.libraryLink.setAttribute("aria-label", `Back to ${state.activeItem.title}`);
  } else {
    elements.libraryLink.href = "./library.html";
    elements.libraryLink.setAttribute("aria-label", "Back to library");
  }
}

function buildSpreads(totalPages, singlePageMode = false) {
  const spreads = [];

  if (totalPages >= 1) {
    spreads.push({ type: "cover", pages: [1] });
  }

  if (singlePageMode) {
    for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
      spreads.push({ type: "spread", pages: [pageNumber, null] });
    }
  } else {
    let pageNumber = 2;
    while (pageNumber <= totalPages) {
      const left = pageNumber;
      const right = pageNumber + 1 <= totalPages ? pageNumber + 1 : null;
      spreads.push({ type: "spread", pages: [left, right] });
      pageNumber += 2;
    }
  }

  spreads.push({ type: "end", pages: [] });
  return spreads;
}

function clampSpread(index) {
  const max = Math.max(0, state.spreads.length - 1);
  return Math.min(Math.max(index, 0), max);
}

function getCurrentAnchorPage() {
  const spread = state.spreads[state.currentSpread];
  if (!spread || spread.type === "end") {
    return null;
  }
  return spread.pages.find((page) => Number.isInteger(page)) ?? null;
}

function findSpreadIndexForPage(pageNumber) {
  if (!Number.isInteger(pageNumber)) {
    return 0;
  }
  const idx = state.spreads.findIndex((spread) =>
    Array.isArray(spread.pages) && spread.pages.includes(pageNumber)
  );
  return idx >= 0 ? idx : 0;
}

function syncSpreadModeAndRebuildIfNeeded() {
  const nextSinglePageMode = window.innerWidth < SINGLE_PAGE_BREAKPOINT;
  if (nextSinglePageMode === state.singlePageMode) {
    return false;
  }

  const anchorPage = getCurrentAnchorPage();
  state.singlePageMode = nextSinglePageMode;
  state.spreads = buildSpreads(state.totalPdfPages, state.singlePageMode);
  state.currentSpread = clampSpread(findSpreadIndexForPage(anchorPage));
  return true;
}

function updateDirectionalLabels() {
  const buildArrowSvg = (dir) =>
    dir === "left"
      ? '<svg class="pager-arrow-icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="14,6 8,12 14,18"></polyline></svg>'
      : '<svg class="pager-arrow-icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="10,6 16,12 10,18"></polyline></svg>';

  const setNavContent = (button, label, arrowDir, arrowAtStart) => {
    if (!button) {
      return;
    }

    const arrow = buildArrowSvg(arrowDir);
    button.innerHTML = arrowAtStart
      ? `<span class="pager-arrow" aria-hidden="true">${arrow}</span><span class="pager-label">${label}</span>`
      : `<span class="pager-label">${label}</span><span class="pager-arrow" aria-hidden="true">${arrow}</span>`;
    button.setAttribute("aria-label", label);
  };

  if (state.direction === "ltr") {
    setNavContent(elements.leftNav, "Previous", "left", true);
    setNavContent(elements.rightNav, "Next", "right", false);
  } else {
    setNavContent(elements.leftNav, "Next", "left", true);
    setNavContent(elements.rightNav, "Previous", "right", false);
  }

  if (elements.directionValue) {
    elements.directionValue.textContent = state.direction.toUpperCase();
  }

  elements.directionToggle?.setAttribute(
    "aria-label",
    `Toggle reading direction (currently ${state.direction.toUpperCase()})`
  );
  applyPagerLayout();
}

function updatePager() {
  const total = state.spreads.length;
  const index = state.currentSpread;
  const display = index + 1;
  elements.pageIndicator.textContent = `${display} / ${total}`;

  const atStart = index === 0;
  const atEnd = index === total - 1;

  if (state.direction === "ltr") {
    elements.leftNav.disabled = atStart;
    elements.rightNav.disabled = atEnd;
  } else {
    elements.leftNav.disabled = atEnd;
    elements.rightNav.disabled = atStart;
  }

  elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function applyPagerLayout() {
  if (!elements.pager || elements.readerView.classList.contains("hidden")) {
    return;
  }

  const compact = window.innerWidth < SINGLE_PAGE_BREAKPOINT;

  if (compact) {
    elements.pager.style.display = "flex";
    elements.pager.style.flexDirection = "row";
    elements.pager.style.flexWrap = "nowrap";
    elements.pager.style.alignItems = "center";
    elements.pager.style.justifyContent = "space-between";
    elements.pager.style.gap = "0.45rem";

    elements.leftNav.style.width = "auto";
    elements.leftNav.style.flex = "0 1 auto";
    elements.leftNav.style.minWidth = "0";
    elements.leftNav.style.display = "inline-flex";

    elements.pageIndicator.style.width = "auto";
    elements.pageIndicator.style.flex = "0 0 auto";
    elements.pageIndicator.style.margin = "0 auto";
    elements.pageIndicator.style.minWidth = "0";

    elements.rightNav.style.width = "auto";
    elements.rightNav.style.flex = "0 1 auto";
    elements.rightNav.style.minWidth = "0";
    elements.rightNav.style.display = "inline-flex";
    return;
  }

  elements.pager.style.display = "";
  elements.pager.style.flexDirection = "";
  elements.pager.style.flexWrap = "";
  elements.pager.style.alignItems = "";
  elements.pager.style.justifyContent = "";
  elements.pager.style.gap = "";

  elements.leftNav.style.width = "";
  elements.leftNav.style.flex = "";
  elements.leftNav.style.minWidth = "";
  elements.leftNav.style.display = "";

  elements.pageIndicator.style.width = "";
  elements.pageIndicator.style.flex = "";
  elements.pageIndicator.style.margin = "";
  elements.pageIndicator.style.minWidth = "";

  elements.rightNav.style.width = "";
  elements.rightNav.style.flex = "";
  elements.rightNav.style.minWidth = "";
  elements.rightNav.style.display = "";
}

function measureAvailablePanelSize() {
  const stagePaddingX = 16;
  const stagePaddingY = 16;
  const stageRect = elements.stage.getBoundingClientRect();
  const isSingleView =
    elements.spread.classList.contains("spread-single") ||
    elements.rightPanel.classList.contains("hidden");

  const spreadStyles = window.getComputedStyle(elements.spread);
  const columnGap = parseFloat(spreadStyles.columnGap || spreadStyles.gap || "0") || 0;

  const stageInnerWidth = Math.max(1, stageRect.width - stagePaddingX);
  const stageInnerHeight = Math.max(1, stageRect.height - stagePaddingY);

  const topbarHeight =
    document.querySelector(".topbar")?.getBoundingClientRect().height || 0;
  const pagerHeight = document.querySelector(".pager")?.getBoundingClientRect().height || 0;
  const viewportInnerWidth = Math.max(1, window.innerWidth - stagePaddingX);
  const viewportInnerHeight = Math.max(
    1,
    window.innerHeight - topbarHeight - pagerHeight - stagePaddingY
  );

  const effectiveInnerWidth = Math.max(stageInnerWidth, viewportInnerWidth);
  const effectiveInnerHeight = Math.max(stageInnerHeight, viewportInnerHeight);

  const availableWidth = isSingleView
    ? effectiveInnerWidth
    : Math.max(1, (effectiveInnerWidth - columnGap) / 2);
  const availableHeight = effectiveInnerHeight;

  return { availableWidth, availableHeight };
}

function clearCanvas(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function showPanelFallback(panelId, text) {
  if (panelId === "left") {
    elements.leftCanvas.classList.add("hidden");
    elements.leftFallback.classList.remove("hidden");
    elements.leftFallback.textContent = text;
    return;
  }

  elements.rightCanvas.classList.add("hidden");
  elements.rightFallback.classList.remove("hidden");
  elements.rightFallback.textContent = text;
}

function showCanvas(panelId) {
  if (panelId === "left") {
    elements.leftCanvas.classList.remove("hidden");
    elements.leftFallback.classList.add("hidden");
    elements.leftFallback.textContent = "";
    return;
  }

  elements.rightCanvas.classList.remove("hidden");
  elements.rightFallback.classList.add("hidden");
  elements.rightFallback.textContent = "";
}

async function renderPdfPageToPanel(pageNumber, panelId) {
  const panel = panelId === "left" ? elements.leftPanel : elements.rightPanel;
  const canvas = panelId === "left" ? elements.leftCanvas : elements.rightCanvas;

  if (!pageNumber) {
    showPanelFallback(panelId, "No page");
    clearCanvas(canvas);
    return;
  }

  showCanvas(panelId);

  const page = await state.pdfDoc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const { availableWidth, availableHeight } = measureAvailablePanelSize();

  const fitScale = Math.min(
    availableWidth / baseViewport.width,
    availableHeight / baseViewport.height
  );
  const viewport = page.getViewport({
    scale: Math.max(0.01, fitScale * state.zoom),
  });
  const outputScale = window.devicePixelRatio || 1;

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  panel.style.width = canvas.style.width;
  panel.style.minWidth = canvas.style.width;
  panel.style.maxWidth = canvas.style.width;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;
}

function renderEndPage(panelId) {
  const canvas = panelId === "left" ? elements.leftCanvas : elements.rightCanvas;
  const panel = panelId === "left" ? elements.leftPanel : elements.rightPanel;
  showCanvas(panelId);

  const baseWidth = 900;
  const baseHeight = 1300;
  const { availableWidth, availableHeight } = measureAvailablePanelSize();
  const fitScale = Math.min(availableWidth / baseWidth, availableHeight / baseHeight);
  const displayWidth = Math.max(1, Math.floor(baseWidth * fitScale * state.zoom));
  const displayHeight = Math.max(1, Math.floor(baseHeight * fitScale * state.zoom));
  const outputScale = window.devicePixelRatio || 1;

  canvas.width = Math.floor(displayWidth * outputScale);
  canvas.height = Math.floor(displayHeight * outputScale);
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  panel.style.width = canvas.style.width;
  panel.style.minWidth = canvas.style.width;
  panel.style.maxWidth = canvas.style.width;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(
    outputScale * (displayWidth / baseWidth),
    0,
    0,
    outputScale * (displayHeight / baseHeight),
    0,
    0
  );
  ctx.fillStyle = "#dbd6de";
  ctx.fillRect(0, 0, baseWidth, baseHeight);

  ctx.fillStyle = "#4e1a8a";
  ctx.font = "700 72px 'Segoe UI', Tahoma, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("To Be Continued...", baseWidth / 2, baseHeight / 2 - 40);

  ctx.fillStyle = "#7f2bff";
  ctx.font = "500 36px 'Segoe UI', Tahoma, sans-serif";
  ctx.fillText("Continue reading in Volume 2", baseWidth / 2, baseHeight / 2 + 70);
}

function completeInitialRenderIfNeeded() {
  if (!state.awaitingFirstRender) {
    return;
  }
  state.awaitingFirstRender = false;
  setReaderLoading(false);
}

async function renderSpread(index) {
  const spread = state.spreads[index];
  if (!spread) {
    return;
  }

  const isSingle = spread.type === "cover" || spread.type === "end" || !spread.pages[1];
  elements.spread.classList.toggle("spread-single", isSingle);
  elements.spread.classList.toggle("spread-double", !isSingle);

  elements.spread.style.display = "flex";
  elements.spread.style.alignItems = "center";
  elements.spread.style.justifyContent = "center";
  elements.spread.style.gap = "0px";

  elements.leftPanel.style.display = "flex";
  elements.leftPanel.style.alignItems = "center";
  elements.leftPanel.style.justifyContent = "center";
  elements.leftPanel.style.flex = "0 0 auto";

  elements.rightPanel.style.display = "flex";
  elements.rightPanel.style.alignItems = "center";
  elements.rightPanel.style.justifyContent = "center";
  elements.rightPanel.style.flex = "0 0 auto";

  if (spread.type === "end") {
    renderEndPage("left");
    elements.rightPanel.classList.add("hidden");
    elements.rightPanel.style.width = "0px";
    elements.rightPanel.style.minWidth = "0px";
    elements.rightPanel.style.maxWidth = "0px";
    completeInitialRenderIfNeeded();
    return;
  }

  elements.rightPanel.classList.toggle("hidden", isSingle);

  if (spread.type === "cover") {
    await renderPdfPageToPanel(spread.pages[0], "left");
    elements.rightPanel.style.width = "0px";
    elements.rightPanel.style.minWidth = "0px";
    elements.rightPanel.style.maxWidth = "0px";
    completeInitialRenderIfNeeded();
    return;
  }

  const [first, second] = spread.pages;
  const leftPage = state.direction === "rtl" && second ? second : first;
  const rightPage = state.direction === "rtl" && second ? first : second;

  await renderPdfPageToPanel(leftPage, "left");

  if (!isSingle) {
    await renderPdfPageToPanel(rightPage, "right");
  }

  completeInitialRenderIfNeeded();
}

function queueRender(index = state.currentSpread) {
  if (state.renderInProgress) {
    state.pendingSpread = index;
    return;
  }

  state.renderInProgress = true;
  void (async () => {
    try {
      await renderSpread(index);
    } catch (error) {
      completeInitialRenderIfNeeded();
      setError(`Render failed: ${error.message}`);
      console.error(error);
    } finally {
      state.renderInProgress = false;
      if (state.pendingSpread !== null) {
        const nextIndex = state.pendingSpread;
        state.pendingSpread = null;
        queueRender(nextIndex);
      }
    }
  })();
}

function goNext() {
  const nextIndex = clampSpread(state.currentSpread + 1);
  if (nextIndex === state.currentSpread) {
    return;
  }
  state.currentSpread = nextIndex;
  updatePager();
  queueRender();
}

function goPrev() {
  const nextIndex = clampSpread(state.currentSpread - 1);
  if (nextIndex === state.currentSpread) {
    return;
  }
  state.currentSpread = nextIndex;
  updatePager();
  queueRender();
}

function onKeyboard(event) {
  if (elements.readerView.classList.contains("hidden")) {
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (state.direction === "ltr") {
      goPrev();
    } else {
      goNext();
    }
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (state.direction === "ltr") {
      goNext();
    } else {
      goPrev();
    }
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    state.zoom = Math.min(state.zoom + 0.1, MAX_ZOOM);
    updatePager();
    queueRender();
  }

  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    state.zoom = Math.max(state.zoom - 0.1, 0.4);
    updatePager();
    queueRender();
  }
}

function wireEvents() {
  if (state.eventsBound) {
    return;
  }

  elements.leftNav.addEventListener("click", () => {
    if (state.direction === "ltr") {
      goPrev();
    } else {
      goNext();
    }
  });

  elements.rightNav.addEventListener("click", () => {
    if (state.direction === "ltr") {
      goNext();
    } else {
      goPrev();
    }
  });

  elements.zoomIn.addEventListener("click", () => {
    state.zoom = Math.min(state.zoom + 0.1, MAX_ZOOM);
    updatePager();
    queueRender();
  });

  elements.zoomOut.addEventListener("click", () => {
    state.zoom = Math.max(state.zoom - 0.1, 0.4);
    updatePager();
    queueRender();
  });

  elements.directionToggle.addEventListener("click", () => {
    const anchorPage = getCurrentAnchorPage();
    state.direction = state.direction === "ltr" ? "rtl" : "ltr";
    state.spreads = buildSpreads(state.totalPdfPages, state.singlePageMode);
    state.currentSpread = clampSpread(findSpreadIndexForPage(anchorPage));
    updateDirectionalLabels();
    updatePager();
    queueRender();
  });

  elements.bookmarkToggle?.addEventListener("click", () => {
    const pressed = elements.bookmarkToggle.getAttribute("aria-pressed") === "true";
    elements.bookmarkToggle.setAttribute("aria-pressed", pressed ? "false" : "true");
  });

  window.addEventListener("keydown", onKeyboard);

  window.addEventListener("resize", () => {
    if (elements.readerView.classList.contains("hidden")) {
      return;
    }
    const rebuilt = syncSpreadModeAndRebuildIfNeeded();
    applyPagerLayout();
    updatePager();
    queueRender(rebuilt ? state.currentSpread : undefined);
  });

  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const mangaId = params.get("manga");
    const contentKey = String(params.get("content_key") || "").trim();
    const fallbackItem = buildQueryPreviewItem(params);
    if (!mangaId) {
      if (fallbackItem) {
        void loadPdfForItem(fallbackItem);
        return;
      }
      showLibraryView(false);
      return;
    }
    void openMangaById(mangaId, false, fallbackItem, contentKey);
  });

  elements.openSearchView?.addEventListener("click", () => {
    setLibraryViewMode("search");
  });

  elements.openHomeView?.addEventListener("click", () => {
    setLibraryViewMode("home");
  });

  elements.librarySearchInput?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    state.searchQuery = target.value;
    renderSearchLibrary();
  });

  elements.librarySortSelect?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    state.searchSort = target.value || "relevance";
    renderSearchLibrary();
  });

  elements.libraryGenreSelect?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    state.searchGenre = target.value || "";
    renderSearchLibrary();
  });

  elements.libraryCategorySelect?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    state.searchCategory = target.value || "";
    renderSearchLibrary();
  });

  elements.libraryStatusSelect?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    state.searchStatus = target.value || "";
    renderSearchLibrary();
  });

  state.eventsBound = true;
}

async function loadFirstPdfForManga(mangaId, preferredContentKey = "") {
  const cleanMangaId = String(mangaId || "").trim();
  const cleanPreferredContentKey = String(preferredContentKey || "").trim();
  if (!cleanMangaId || !endpointLooksConfigured(endpoint.mangaContentGet)) {
    return "";
  }

  const url = new URL(endpoint.mangaContentGet);
  url.searchParams.set("manga_id", cleanMangaId);
  const response = await requestJson(url.toString(), { method: "GET" });
  const data = responseData(response);
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    return "";
  }

  const withFile = items
    .map((item) => ({
      sequenceNumber: Number(item?.sequence_number),
      contentKey: String(item?.content_key || "").trim(),
      fileUrl: String(item?.file_url || "").trim(),
    }))
    .filter((entry) => entry.fileUrl);

  if (!withFile.length) {
    return "";
  }

  withFile.sort((a, b) => {
    const aSeq = Number.isFinite(a.sequenceNumber) ? a.sequenceNumber : Number.MAX_SAFE_INTEGER;
    const bSeq = Number.isFinite(b.sequenceNumber) ? b.sequenceNumber : Number.MAX_SAFE_INTEGER;
    if (aSeq !== bSeq) {
      return aSeq - bSeq;
    }
    return a.contentKey.localeCompare(b.contentKey);
  });
  if (cleanPreferredContentKey) {
    const preferred = withFile.find((entry) => entry.contentKey === cleanPreferredContentKey);
    if (preferred?.fileUrl) {
      return preferred.fileUrl;
    }
  }
  return withFile[0].fileUrl;
}

async function ensureItemHasPdf(item, preferredContentKey = "") {
  if (!item || typeof item !== "object") {
    return item;
  }
  const existingPdf = String(item.pdf || "").trim();
  if (existingPdf) {
    return item;
  }
  try {
    const pdf = await loadFirstPdfForManga(
      item.mangaId || item.id,
      preferredContentKey || item.contentKey
    );
    if (!pdf) {
      return item;
    }
    item.pdf = pdf;
    return item;
  } catch (error) {
    console.error("Failed to fetch manga content for reader:", error);
    return item;
  }
}

async function loadPdfForItem(item, preferredContentKey = "") {
  const nextItem = await ensureItemHasPdf(item, preferredContentKey);
  const pdfUrl = String(nextItem?.pdf || "").trim();
  if (!pdfUrl) {
    state.awaitingFirstRender = false;
    setReaderLoading(false);
    setError("No readable manga file found for this title.");
    showReaderView();
    return;
  }

  state.activeItem = nextItem;
  state.zoom = 1;
  state.currentSpread = 0;
  state.pendingSpread = null;
  state.renderInProgress = false;
  state.singlePageMode = window.innerWidth < SINGLE_PAGE_BREAKPOINT;

  clearError();
  showReaderView();
  setReaderLoading(true, "Loading...");
  state.awaitingFirstRender = true;
  updateReaderBackLink();
  document.title = `${nextItem.title} - BluPetal`;

  try {
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    state.pdfDoc = await loadingTask.promise;
    state.totalPdfPages = state.pdfDoc.numPages;
    state.spreads = buildSpreads(state.totalPdfPages, state.singlePageMode);
    state.currentSpread = 0;

    updateDirectionalLabels();
    applyPagerLayout();
    updatePager();
    queueRender();
  } catch (error) {
    state.awaitingFirstRender = false;
    setReaderLoading(false);
    state.spreads = [{ type: "error", pages: [] }];
    state.currentSpread = 0;
    updatePager();
    elements.leftPanel.classList.remove("hidden");
    elements.rightPanel.classList.add("hidden");
    showPanelFallback("left", "PDF could not be loaded.");
    setError(`Could not load ${pdfUrl}. Verify the manga-content file URL is valid.`);
    console.error(error);
  }
}

async function openMangaById(
  mangaId,
  pushState = false,
  fallbackItem = null,
  preferredContentKey = ""
) {
  const cleanPreferredContentKey = String(preferredContentKey || "").trim();
  let item = cleanPreferredContentKey
    ? state.contentItems.find(
        (entry) => entry.mangaId === mangaId && entry.contentKey === cleanPreferredContentKey
      )
    : null;
  if (!item) {
    item = state.contentItems.find((entry) => entry.id === mangaId);
  }
  if (!item) {
    item = state.contentItems.find((entry) => entry.mangaId === mangaId);
  }
  if (!item && fallbackItem && fallbackItem.id === mangaId) {
    item = fallbackItem;
  }
  if (!item) {
    showLibraryView(false);
    showLibraryError(`Could not find manga id "${mangaId}" in feature categories.`);
    return;
  }

  clearLibraryError();
  if (pushState) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("manga", item.mangaId || item.id);
    if (cleanPreferredContentKey) {
      nextUrl.searchParams.set("content_key", cleanPreferredContentKey);
    } else {
      nextUrl.searchParams.delete("content_key");
    }
    if (fallbackItem && fallbackItem.id === item.id) {
      nextUrl.searchParams.set("pdf", fallbackItem.pdf);
      nextUrl.searchParams.set("title", fallbackItem.title || "Preview");
      if (fallbackItem.cover) {
        nextUrl.searchParams.set("cover", fallbackItem.cover);
      }
    } else {
      nextUrl.searchParams.delete("pdf");
      nextUrl.searchParams.delete("title");
      nextUrl.searchParams.delete("cover");
      nextUrl.searchParams.delete("thumbnail");
    }
    window.history.pushState({}, "", nextUrl);
  }

  await loadPdfForItem(item, cleanPreferredContentKey);
}

async function init() {
  wireAdminMenu();
  wireAccountIdentity();
  wireEvents();
  await loadContent();
  renderSearchControls();
  setLibraryViewMode("home");

  const params = new URLSearchParams(window.location.search);
  const mangaId = params.get("manga");
  const contentKey = String(params.get("content_key") || "").trim();
  const fallbackItem = buildQueryPreviewItem(params);
  const hasReaderTarget = Boolean(mangaId) || Boolean(fallbackItem);

  if (hasReaderTarget) {
    showReaderView();
  } else {
    showLibraryView(false);
  }

  renderLibrary();

  if (!mangaId && fallbackItem) {
    await loadPdfForItem(fallbackItem);
    return;
  }
  if (!mangaId) {
    return;
  }

  await openMangaById(mangaId, false, fallbackItem, contentKey);
}

void init();




