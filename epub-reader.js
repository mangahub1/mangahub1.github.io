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
  gap: 0,
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
  leftPanel: document.getElementById("leftPanel"),
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

const coverCanvasState = {
  canvas: null,
  renderToken: 0,
  visible: false,
};

function ensureCoverCanvas() {
  if (coverCanvasState.canvas instanceof HTMLCanvasElement) {
    return coverCanvasState.canvas;
  }
  const canvas = document.createElement("canvas");
  canvas.id = "coverCanvas";
  canvas.className = "hidden";
  canvas.style.background = "#fff";
  canvas.style.borderRadius = "0.25rem";
  canvas.style.display = "none";
  canvas.style.maxWidth = "100%";
  canvas.style.height = "auto";
  canvas.style.marginLeft = "auto";
  canvas.style.marginRight = "auto";
  elements.leftPanel?.insertBefore(canvas, elements.leftFallback);
  coverCanvasState.canvas = canvas;
  return canvas;
}

function showCoverCanvas() {
  const canvas = ensureCoverCanvas();
  canvas.classList.remove("hidden");
  canvas.style.display = "block";
  coverCanvasState.visible = true;
  if (elements.leftPanel) {
    elements.leftPanel.style.display = "flex";
    elements.leftPanel.style.alignItems = "center";
    elements.leftPanel.style.justifyContent = "center";
  }
  elements.epubViewport.classList.add("hidden");
}

function hideCoverCanvas() {
  if (!(coverCanvasState.canvas instanceof HTMLCanvasElement)) return;
  coverCanvasState.canvas.classList.add("hidden");
  coverCanvasState.canvas.style.display = "none";
  coverCanvasState.visible = false;
  elements.epubViewport.classList.remove("hidden");
}

function extractCoverImageSource(iframe) {
  if (!(iframe instanceof HTMLIFrameElement)) return "";
  try {
    const doc = iframe.contentDocument;
    if (!doc) return "";
    const img = doc.querySelector("img");
    if (img instanceof HTMLImageElement && img.src) {
      return img.src;
    }
    const svgImage = doc.querySelector("image");
    if (svgImage) {
      const href = String(
        svgImage.getAttribute("href") ||
          svgImage.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
          ""
      ).trim();
      if (href) return href;
    }
  } catch (_error) {
    return "";
  }
  return "";
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load cover image source."));
    img.src = src;
  });
}

function findContentBounds(image) {
  const off = document.createElement("canvas");
  off.width = image.naturalWidth || image.width;
  off.height = image.naturalHeight || image.height;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: off.width, h: off.height };
  ctx.drawImage(image, 0, 0, off.width, off.height);
  const data = ctx.getImageData(0, 0, off.width, off.height).data;
  const width = off.width;
  const height = off.height;

  const isInk = (idx) => {
    const a = data[idx + 3];
    if (a < 10) return false;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = (r + g + b) / 3;
    return lum < 248 || max - min > 6;
  };

  let left = 0;
  let right = width - 1;
  let top = 0;
  let bottom = height - 1;

  const colHasInk = (x) => {
    for (let y = 0; y < height; y += 2) {
      const idx = (y * width + x) * 4;
      if (isInk(idx)) return true;
    }
    return false;
  };
  const rowHasInk = (y) => {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      if (isInk(idx)) return true;
    }
    return false;
  };

  while (left < right && !colHasInk(left)) left += 1;
  while (right > left && !colHasInk(right)) right -= 1;
  while (top < bottom && !rowHasInk(top)) top += 1;
  while (bottom > top && !rowHasInk(bottom)) bottom -= 1;

  const w = Math.max(1, right - left + 1);
  const h = Math.max(1, bottom - top + 1);
  return { x: left, y: top, w, h };
}

async function renderCoverCanvasIfNeeded() {
  const isSingle = elements.epubViewport.classList.contains("is-single-page");
  const isCover = state.currentSpineIndex === 0;
  if (!isSingle || !isCover) {
    hideCoverCanvas();
    return;
  }

  const container = elements.epubViewport.querySelector(".epub-container");
  const view = container?.querySelector?.(".epub-view");
  const iframe = view?.querySelector?.("iframe");
  if (!(iframe instanceof HTMLIFrameElement)) {
    // Keep a previously-rendered cover canvas instead of flashing back to white iframe.
    if (coverCanvasState.visible) return;
    hideCoverCanvas();
    return;
  }

  const src = extractCoverImageSource(iframe);
  if (!src) {
    if (coverCanvasState.visible) return;
    hideCoverCanvas();
    return;
  }

  const token = ++coverCanvasState.renderToken;
  try {
    const image = await loadImage(src);
    if (token !== coverCanvasState.renderToken) return;

    const bounds = findContentBounds(image);
    const canvas = ensureCoverCanvas();
    const viewportRect = elements.epubViewport.getBoundingClientRect();
    const fitScale = Math.min(
      viewportRect.width / bounds.w,
      viewportRect.height / bounds.h
    );
    const displayW = Math.max(1, Math.floor(bounds.w * fitScale));
    const displayH = Math.max(1, Math.floor(bounds.h * fitScale));

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(displayW * dpr));
    canvas.height = Math.max(1, Math.floor(displayH * dpr));
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      hideCoverCanvas();
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, displayW, displayH);
    ctx.drawImage(
      image,
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h,
      0,
      0,
      displayW,
      displayH
    );
    showCoverCanvas();
  } catch (_error) {
    // Avoid late white-layer fallback once cover canvas is successfully shown.
    if (!coverCanvasState.visible) {
      hideCoverCanvas();
    }
  }
}

function isBlankEpubView(view) {
  const iframe = view?.querySelector?.("iframe");
  if (!iframe) return true;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return false;
    const hasVisual = Boolean(doc.querySelector("img, svg, canvas, video, object"));
    const text = String(doc.body?.textContent || "").trim();
    return !hasVisual && text.length === 0;
  } catch (_error) {
    return false;
  }
}

function looksLikeDualPageInSingleIframe(iframe) {
  if (!(iframe instanceof HTMLIFrameElement)) return false;
  try {
    const doc = iframe.contentDocument;
    const root = doc?.documentElement;
    const body = doc?.body;
    const rootWidth = Number(root?.scrollWidth || 0);
    const bodyWidth = Number(body?.scrollWidth || 0);
    const viewportWidth = Number(iframe.clientWidth || 0);
    const contentWidth = Math.max(rootWidth, bodyWidth);
    if (contentWidth <= 0 || viewportWidth <= 0) return false;
    return contentWidth / viewportWidth > 1.4;
  } catch (_error) {
    return false;
  }
}

function normalizeSpreadSeam() {
  const container = elements.epubViewport?.querySelector?.(".epub-container");
  if (!(container instanceof HTMLElement)) return;

  const isSingle = elements.epubViewport.classList.contains("is-single-page");
  const allViews = Array.from(container.querySelectorAll(".epub-view"));
  if (!allViews.length) return;

  const usableViews = allViews.filter((view) => view instanceof HTMLElement && !isBlankEpubView(view));
  if (!usableViews.length) return;

  container.style.gap = "0px";
  container.style.columnGap = "0px";
  container.style.margin = "0";
  container.style.padding = "0";

  if (isSingle || usableViews.length <= 1) {
    container.style.position = "";
    container.style.display = "flex";
    container.style.justifyContent = "center";
    container.style.alignItems = "center";
    container.style.width = "100%";
    container.style.height = "100%";
    const primaryView = usableViews[0] instanceof HTMLElement ? usableViews[0] : null;
    for (const view of allViews) {
      if (!(view instanceof HTMLElement)) continue;
      view.style.position = "";
      view.style.flex = "";
      view.style.left = "";
      view.style.right = "";
      view.style.top = "";
      view.style.bottom = "";
      view.style.width = "";
      view.style.maxWidth = "";
      view.style.minWidth = "";
      view.style.height = "";
      view.style.display = view === primaryView ? "flex" : "none";
      view.style.alignItems = "center";
      view.style.justifyContent = "center";
      view.style.margin = "0";
      view.style.padding = "0";
      view.style.overflow = "visible";
      if (view === primaryView) {
        view.style.flex = "0 0 100%";
        view.style.width = "100%";
        view.style.maxWidth = "100%";
        view.style.minWidth = "100%";
        view.style.height = "100%";
      }
      const iframe = view.querySelector("iframe");
      if (iframe instanceof HTMLElement) {
        // Clear two-page constraints so cover/page-1 can render at natural fit.
        if (view === primaryView) {
          iframe.style.width = "100%";
          iframe.style.height = "100%";
          iframe.style.maxWidth = "100%";
          iframe.style.maxHeight = "100%";
          iframe.style.minWidth = "100%";
          iframe.style.marginLeft = "0";
          iframe.style.transform = "none";
          iframe.style.transformOrigin = "";
          if (state.currentSpineIndex === 0 || looksLikeDualPageInSingleIframe(iframe)) {
            try {
              const doc = iframe.contentDocument;
              if (doc) {
                let styleEl = doc.getElementById("cover-single-page-fix");
                if (!styleEl) {
                  styleEl = doc.createElement("style");
                  styleEl.id = "cover-single-page-fix";
                  doc.head?.appendChild(styleEl);
                }
                styleEl.textContent =
                  "html,body{margin:0!important;padding:0!important;width:100%!important;max-width:100%!important;overflow:hidden!important;}img,svg{display:block!important;max-width:100%!important;height:auto!important;}";
              }
            } catch (_error) {
              // Ignore inaccessible iframe documents.
            }
            // Crop synthetic spread to one page at a predictable scale.
            iframe.style.setProperty("width", "100%", "important");
            iframe.style.setProperty("max-width", "100%", "important");
            iframe.style.setProperty("min-width", "100%", "important");
            iframe.style.setProperty("margin-left", "0", "important");
            iframe.style.setProperty("transform", "translateX(0)", "important");

            // Keep cover panel full-width in single-page mode.
            view.style.setProperty("flex", "0 0 100%", "important");
            view.style.setProperty("width", "100%", "important");
            view.style.setProperty("max-width", "100%", "important");
            view.style.setProperty("min-width", "100%", "important");
          }
        } else {
          iframe.style.width = "";
          iframe.style.height = "";
          iframe.style.maxWidth = "";
          iframe.style.maxHeight = "";
          iframe.style.minWidth = "";
          iframe.style.marginLeft = "";
          iframe.style.transform = "";
          iframe.style.transformOrigin = "";
        }
      }
    }
    return;
  }

  const leftView = usableViews[0];
  const rightView = usableViews[1];

  container.style.position = "";
  container.style.display = "flex";
  container.style.justifyContent = "center";
  container.style.alignItems = "stretch";

  for (const view of allViews) {
    if (!(view instanceof HTMLElement)) continue;
    view.style.margin = "0";
    view.style.padding = "0";
    view.style.overflow = "hidden";
    if (view !== leftView && view !== rightView) {
      view.style.display = "none";
      continue;
    }
    view.style.display = "flex";
    view.style.position = "";
    view.style.left = "";
    view.style.height = "100%";
    view.style.flex = "0 0 50%";
    view.style.width = "50%";
    view.style.maxWidth = "50%";
    view.style.minWidth = "50%";
    view.style.alignItems = "center";
    const iframe = view.querySelector("iframe");
    if (iframe instanceof HTMLElement) {
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.display = "block";
    }
  }
  leftView.style.justifyContent = "flex-end";
  rightView.style.justifyContent = "flex-start";
}

function registerContentSeamOverrides(rendition) {
  if (!rendition?.hooks?.content?.register) return;
  rendition.hooks.content.register((contents) => {
    try {
      contents.addStylesheetRules({
        html: {
          margin: "0 !important",
          padding: "0 !important",
          "background-color": "#fff !important",
        },
        body: {
          margin: "0 !important",
          padding: "0 !important",
          "background-color": "#fff !important",
        },
        "img,svg,canvas": {
          margin: "0 !important",
          padding: "0 !important",
          display: "block !important",
        },
      });
    } catch (_error) {
      // Ignore malformed documents that reject rule injection.
    }
  });
}

function updateViewportSize() {
  const stageRect = elements.canvasStage?.getBoundingClientRect();
  const topbarHeight = document.querySelector(".topbar")?.getBoundingClientRect().height || 0;
  const pagerHeight = document.querySelector(".pager")?.getBoundingClientRect().height || 0;
  const viewportWidth = Math.max(320, Math.floor(window.innerWidth - 16));
  const viewportHeight = Math.max(320, Math.floor(window.innerHeight - topbarHeight - pagerHeight - 16));
  if (!stageRect) return { width: viewportWidth, height: viewportHeight };
  const stageWidth = Math.floor(stageRect.width - 16);
  const stageHeight = Math.floor(stageRect.height - 16);
  const width = Math.max(320, Number.isFinite(stageWidth) && stageWidth > 0 ? stageWidth : viewportWidth);
  const height = Math.max(320, Number.isFinite(stageHeight) && stageHeight > 0 ? stageHeight : viewportHeight);
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
    normalizeSpreadSeam();
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
  const total = getSpineLength();
  const inSpreadMode = state.activeSpreadMode === "auto";
  let nextIndex = before + 1;

  if (inSpreadMode && before > 0) {
    // In double-page mode, move by spreads: 2/3 -> 4/5 -> 6/7 ...
    const spreadStart = before % 2 === 0 ? before - 1 : before;
    nextIndex = spreadStart + 2;
  }

  nextIndex = Math.min(total - 1, nextIndex);
  if (nextIndex !== before) {
    await displaySpineIndex(nextIndex);
  }
}

async function goPrev() {
  if (!state.rendition) return;
  const before = getCurrentSpineIndex();
  const inSpreadMode = state.activeSpreadMode === "auto";
  let prevIndex = before - 1;

  if (inSpreadMode && before > 0) {
    const spreadStart = before % 2 === 0 ? before - 1 : before;
    prevIndex = spreadStart <= 1 ? 0 : spreadStart - 2;
  }

  prevIndex = Math.max(0, prevIndex);
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
    void renderCoverCanvasIfNeeded();
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
      requestAnimationFrame(() => {
        applyZoom();
        normalizeSpreadSeam();
        void renderCoverCanvasIfNeeded();
      });
    });
    rendition.on("rendered", () => {
      setReaderLoading(false);
      requestAnimationFrame(() => {
        applyZoom();
        normalizeSpreadSeam();
        void renderCoverCanvasIfNeeded();
      });
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
    registerContentSeamOverrides(state.rendition);
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
