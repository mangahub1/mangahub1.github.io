const MIN_ZOOM = 40;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
const DISPLAY_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 30000;
const PACKAGE_TIMEOUT_MS = 15000;
const SINGLE_PAGE_BREAKPOINT = 900;
const EPUB_BASE_SCALE = 1.0;
const PRIMARY_RENDER_OPTIONS = {
  width: "100%",
  height: "100%",
  flow: "paginated",
  spread: "auto",
  minSpreadWidth: SINGLE_PAGE_BREAKPOINT,
  manager: "default",
};
const FALLBACK_RENDER_OPTIONS = {
  width: "100%",
  height: "100%",
  flow: "scrolled-doc",
  manager: "continuous",
  spread: "none",
};

const state = {
  book: null,
  rendition: null,
  zoom: 100,
  direction: "rtl",
  locationReady: false,
  currentSpineIndex: 0,
  currentCfi: "",
  singlePageMode: window.innerWidth < SINGLE_PAGE_BREAKPOINT,
  activeSpreadMode: "",
};

const elements = {
  readerView: document.getElementById("readerView"),
  readerLoading: document.getElementById("readerLoading"),
  readerLoadingText: document.getElementById("readerLoadingText"),
  libraryLink: document.getElementById("libraryLink"),
  errorBanner: document.getElementById("errorBanner"),
  epubViewport: document.getElementById("epubViewport"),
  leftFallback: document.getElementById("leftFallback"),
  leftNav: document.getElementById("leftNav"),
  rightNav: document.getElementById("rightNav"),
  canvasStage: document.getElementById("canvasStage"),
  pageIndicator: document.getElementById("pageIndicator"),
  zoomOut: document.getElementById("zoomOut"),
  zoomIn: document.getElementById("zoomIn"),
  zoomValue: document.getElementById("zoomValue"),
  directionToggle: document.getElementById("directionToggle"),
  directionValue: document.getElementById("directionValue"),
  bookmarkToggle: document.getElementById("bookmarkToggle"),
};

function updateViewportSize() {
  const stageRect = elements.canvasStage?.getBoundingClientRect();
  const topbarHeight = document.querySelector(".topbar")?.getBoundingClientRect().height || 0;
  const pagerHeight = document.querySelector(".pager")?.getBoundingClientRect().height || 0;
  const viewportWidth = Math.max(320, Math.floor(window.innerWidth - 16));
  const viewportHeight = Math.max(320, Math.floor(window.innerHeight - topbarHeight - pagerHeight - 16));
  if (!stageRect) return { width: viewportWidth, height: viewportHeight };
  const width = Math.max(320, Math.floor(Math.max(stageRect.width - 16, viewportWidth)));
  const height = Math.max(320, Math.floor(Math.max(stageRect.height - 16, viewportHeight)));
  elements.epubViewport.style.width = `${width}px`;
  elements.epubViewport.style.height = `${height}px`;
  return { width, height };
}

function getSpineLength() {
  const items = state.book?.spine?.spineItems;
  if (Array.isArray(items) && items.length) return items.length;
  const altLength = Number(state.book?.spine?.length);
  return Number.isFinite(altLength) && altLength > 0 ? altLength : 1;
}

function getSpineItemAt(index) {
  const items = state.book?.spine?.spineItems;
  if (!Array.isArray(items)) return null;
  if (!Number.isFinite(index) || index < 0 || index >= items.length) return null;
  return items[index] || null;
}

function getCurrentSpineIndex() {
  const currentLocation = state.rendition?.currentLocation?.();
  const nextIndex = Number(currentLocation?.start?.index);
  if (Number.isFinite(nextIndex) && nextIndex >= 0) {
    return nextIndex;
  }
  return state.currentSpineIndex;
}

async function displaySpineIndex(index) {
  const item = getSpineItemAt(index);
  if (!item || !state.rendition) return false;
  const target = String(item.href || item.cfiBase || "").trim();
  if (!target) return false;
  await state.rendition.display(target);
  state.currentSpineIndex = index;
  return true;
}

function updateDirectionalLabels() {
  if (state.direction === "ltr") {
    elements.leftNav.querySelector(".pager-label").textContent = "Previous";
    elements.rightNav.querySelector(".pager-label").textContent = "Next";
  } else {
    elements.leftNav.querySelector(".pager-label").textContent = "Next";
    elements.rightNav.querySelector(".pager-label").textContent = "Previous";
  }
  elements.directionToggle?.setAttribute(
    "aria-label",
    `Toggle reading direction (currently ${state.direction.toUpperCase()})`
  );
}

function updatePagerState() {
  const total = getSpineLength();
  const current = Math.max(0, Math.min(total - 1, getCurrentSpineIndex()));
  const atStart = current <= 0;
  const atEnd = current >= total - 1;

  if (state.direction === "ltr") {
    elements.leftNav.disabled = atStart;
    elements.rightNav.disabled = atEnd;
  } else {
    elements.leftNav.disabled = atEnd;
    elements.rightNav.disabled = atStart;
  }

  elements.pageIndicator.textContent = `${current + 1} / ${Math.max(1, total)}`;
}

async function syncSpreadMode() {
  if (!state.rendition) return;
  const total = getSpineLength();
  const current = getCurrentSpineIndex();
  const atEdge = current <= 0 || current >= total - 1;
  const nextMode = state.singlePageMode || atEdge ? "none" : "auto";
  elements.epubViewport.classList.toggle("is-single-page", nextMode === "none");
  if (state.activeSpreadMode === nextMode) {
    return;
  }
  state.activeSpreadMode = nextMode;
  state.rendition.spread(nextMode);
  const target = String(state.currentCfi || "").trim();
  if (target) {
    await state.rendition.display(target);
  }
}

function setReaderLoading(isLoading, text = "Loading...") {
  elements.readerView.classList.toggle("is-loading", isLoading);
  elements.readerLoading.classList.toggle("hidden", !isLoading);
  elements.readerLoading.setAttribute("aria-hidden", isLoading ? "false" : "true");
  elements.readerLoadingText.textContent = text;
  elements.readerLoading.style.display = isLoading ? "grid" : "none";
  elements.readerLoading.style.visibility = isLoading ? "visible" : "hidden";
  elements.readerLoading.style.opacity = isLoading ? "1" : "0";
  elements.readerLoading.style.pointerEvents = isLoading ? "auto" : "none";
}

function withTimeout(promise, ms, message) {
  let timerId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = window.setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
  });
}

async function fetchEpubBuffer(epubUrl) {
  const response = await fetch(epubUrl, {
    method: "GET",
    cache: "no-store",
    mode: "cors",
  });
  if (!response.ok) {
    throw new Error(`Failed to download EPUB (HTTP ${response.status}).`);
  }
  return response.arrayBuffer();
}

function setError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("hidden");
}

function clearError() {
  elements.errorBanner.textContent = "";
  elements.errorBanner.classList.add("hidden");
}

function showPanelFallback(text) {
  elements.leftFallback.textContent = text;
  elements.leftFallback.classList.remove("hidden");
  elements.epubViewport.classList.add("hidden");
}

function hidePanelFallback() {
  elements.leftFallback.textContent = "";
  elements.leftFallback.classList.add("hidden");
  elements.epubViewport.classList.remove("hidden");
}

function setBackLinkFromQuery(params) {
  const source = String(params.get("source") || "").trim().toLowerCase();
  if (source === "admin") {
    elements.libraryLink.href = "./manga/admin/admin-manga.html";
  } else {
    elements.libraryLink.href = "./library.html";
  }
}

function updateZoomLabel() {
  elements.zoomValue.textContent = `${state.zoom}%`;
}

function applyZoom() {
  if (!state.rendition) return;
  const scale = Math.max(0.4, Math.min(2.5, (state.zoom / 100) * EPUB_BASE_SCALE));
  const container = elements.epubViewport.querySelector(".epub-container");
  if (container instanceof HTMLElement) {
    container.style.transformOrigin = "center top";
    container.style.transform = `scale(${scale})`;
    container.style.width = "";
    container.style.height = "";
  } else {
    state.rendition.themes.fontSize(`${state.zoom}%`);
  }
  updateZoomLabel();
}

function updateDirectionUi() {
  elements.directionValue.textContent = state.direction.toUpperCase();
}

function applyReadingDirection() {
  if (!state.rendition) return;
  try {
    state.rendition.direction(state.direction);
  } catch (_error) {
    // Some epub.js builds may not expose direction API reliably.
  }
}

function updatePageIndicator(location) {
  const spineIndex = Number(location?.start?.index);
  const spineTotal = getSpineLength();
  if (Number.isFinite(spineIndex) && spineTotal > 0) {
    const current = Math.max(1, Math.min(spineTotal, spineIndex + 1));
    elements.pageIndicator.textContent = `${current} / ${spineTotal}`;
    return;
  }

  elements.pageIndicator.textContent = `1 / ${spineTotal}`;
}

async function goNext() {
  if (!state.rendition) return;
  const before = getCurrentSpineIndex();
  const nextIndex = Math.min(getSpineLength() - 1, before + 1);
  if (nextIndex !== before) {
    await displaySpineIndex(nextIndex);
  }
}

async function goPrev() {
  if (!state.rendition) return;
  const before = getCurrentSpineIndex();
  const prevIndex = Math.max(0, before - 1);
  if (prevIndex !== before) {
    await displaySpineIndex(prevIndex);
  }
}

async function onLeftNav() {
  if (state.direction === "ltr") {
    await goPrev();
    return;
  }
  await goNext();
}

async function onRightNav() {
  if (state.direction === "ltr") {
    await goNext();
    return;
  }
  await goPrev();
}

async function onKeyboard(event) {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (state.direction === "ltr") {
      await goPrev();
    } else {
      await goNext();
    }
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (state.direction === "ltr") {
      await goNext();
    } else {
      await goPrev();
    }
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    state.zoom = Math.min(MAX_ZOOM, state.zoom + ZOOM_STEP);
    applyZoom();
    return;
  }

  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    state.zoom = Math.max(MIN_ZOOM, state.zoom - ZOOM_STEP);
    applyZoom();
  }
}

function wireEvents() {
  elements.leftNav.addEventListener("click", () => void onLeftNav());
  elements.rightNav.addEventListener("click", () => void onRightNav());

  elements.zoomIn.addEventListener("click", () => {
    state.zoom = Math.min(MAX_ZOOM, state.zoom + ZOOM_STEP);
    applyZoom();
  });

  elements.zoomOut.addEventListener("click", () => {
    state.zoom = Math.max(MIN_ZOOM, state.zoom - ZOOM_STEP);
    applyZoom();
  });

  elements.directionToggle.addEventListener("click", () => {
    state.direction = state.direction === "rtl" ? "ltr" : "rtl";
    applyReadingDirection();
    updateDirectionUi();
    updateDirectionalLabels();
    updatePagerState();
    const target = String(state.currentCfi || "").trim();
    if (target) {
      void state.rendition?.display(target);
    }
  });

  elements.bookmarkToggle.addEventListener("click", () => {
    const pressed = elements.bookmarkToggle.getAttribute("aria-pressed") === "true";
    elements.bookmarkToggle.setAttribute("aria-pressed", pressed ? "false" : "true");
  });

  window.addEventListener("keydown", (event) => {
    void onKeyboard(event);
  });

  window.addEventListener("resize", () => {
    state.singlePageMode = window.innerWidth < SINGLE_PAGE_BREAKPOINT;
    const { width, height } = updateViewportSize();
    state.rendition?.resize(width, height);
    void syncSpreadMode();
    updatePagerState();
  });
}

async function initReader(epubUrl, title) {
  if (!window.ePub || typeof window.ePub !== "function") {
    throw new Error("EPUB runtime failed to load.");
  }

  setReaderLoading(true, "Downloading EPUB...");
  const epubBuffer = await withTimeout(
    fetchEpubBuffer(epubUrl),
    DOWNLOAD_TIMEOUT_MS,
    "EPUB download timed out."
  );

  setReaderLoading(true, "Opening EPUB...");
  state.book = window.ePub(epubBuffer);
  await withTimeout(
    state.book.ready,
    PACKAGE_TIMEOUT_MS,
    "EPUB package took too long to initialize."
  );

  const attachRenditionEvents = (rendition) => {
    rendition.on("relocated", (location) => {
      const index = Number(location?.start?.index);
      if (Number.isFinite(index) && index >= 0) {
        state.currentSpineIndex = index;
      }
      state.currentCfi = String(location?.start?.cfi || "").trim();
      updatePageIndicator(location);
      void syncSpreadMode();
      updatePagerState();
      setReaderLoading(false);
      requestAnimationFrame(() => applyZoom());
    });
    rendition.on("rendered", () => {
      setReaderLoading(false);
      requestAnimationFrame(() => applyZoom());
    });
    rendition.on("displayError", (_section, error) => {
      setReaderLoading(false);
      setError(`EPUB display failed. ${error?.message || ""}`.trim());
    });
    rendition.on("renderError", (_section, error) => {
      setReaderLoading(false);
      setError(`EPUB render failed. ${error?.message || ""}`.trim());
    });
  };

  const renderWithOptions = async (options) => {
    const { width, height } = updateViewportSize();
    state.rendition = state.book.renderTo("epubViewport", options);
    attachRenditionEvents(state.rendition);
    applyReadingDirection();
    const firstSpineItem = state.book?.spine?.get?.(0) || state.book?.spine?.first?.();
    const firstTarget = String(firstSpineItem?.href || "").trim() || undefined;
    state.currentSpineIndex = 0;
    state.activeSpreadMode = "";
    setReaderLoading(true, "Rendering pages...");
    await withTimeout(
      state.rendition.display(firstTarget),
      DISPLAY_TIMEOUT_MS,
      "EPUB took too long to render."
    );
    state.rendition.resize(width, height);
    setReaderLoading(false);
  };

  try {
    await renderWithOptions(PRIMARY_RENDER_OPTIONS);
  } catch (_primaryError) {
    state.rendition?.destroy();
    await renderWithOptions(FALLBACK_RENDER_OPTIONS);
  }

  try {
    await state.book.ready;
    await state.book.locations.generate(1000);
    state.locationReady = true;
  } catch (_error) {
    state.locationReady = false;
  }

  document.title = `${title} - BluPetal`;
  applyZoom();
  updateDirectionUi();
  updateDirectionalLabels();
  updatePagerState();
  hidePanelFallback();
}

async function init() {
  wireEvents();
  updateZoomLabel();
  updateDirectionUi();
  updateDirectionalLabels();
  updatePagerState();

  const params = new URLSearchParams(window.location.search);
  const epubUrl = String(params.get("epub") || "").trim();
  const title = String(params.get("title") || "Preview").trim() || "Preview";

  setBackLinkFromQuery(params);

  if (!epubUrl) {
    setReaderLoading(false);
    showPanelFallback("EPUB file URL is missing.");
    setError("Missing \"epub\" query parameter.");
    return;
  }

  clearError();
  setReaderLoading(true, "Loading...");

  try {
    await initReader(epubUrl, title);
  } catch (error) {
    setReaderLoading(false);
    showPanelFallback("EPUB could not be loaded.");
    setError(error instanceof Error ? error.message : String(error));
    console.error(error);
  }
}

void init();
