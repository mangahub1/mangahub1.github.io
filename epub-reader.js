const MIN_ZOOM = 40;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
const DISPLAY_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 30000;
const PACKAGE_TIMEOUT_MS = 15000;
const SINGLE_PAGE_BREAKPOINT = 900;
const EPUB_BASE_SCALE = 1.0;
const TAP_MAX_MOVE_PX = 12;
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
  spreads: [],
  currentSpread: 0,
  syncingSpread: false,
  coverImageSrc: "",
  coverSessionActive: true,
  initializingCover: true,
  hasUserNavigated: false,
  correctingCoverRelocation: false,
  navigationInProgress: false,
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
  spreadContainer: document.getElementById("spreadContainer"),
};

function syncAppViewportHeight() {
  const viewportHeight =
    window.visualViewport?.height && Number.isFinite(window.visualViewport.height)
      ? window.visualViewport.height
      : window.innerHeight;
  document.documentElement.style.setProperty("--app-vh", `${viewportHeight * 0.01}px`);
}

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
  if (elements.leftPanel) {
    elements.leftPanel.style.display = "";
    elements.leftPanel.style.alignItems = "";
    elements.leftPanel.style.justifyContent = "";
  }
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
  if (!state.coverSessionActive) {
    hideCoverCanvas();
    return;
  }

  let src = String(state.coverImageSrc || "").trim();
  if (!src) {
    const container = elements.epubViewport.querySelector(".epub-container");
    const view = container?.querySelector?.(".epub-view");
    const iframe = view?.querySelector?.("iframe");
    src = extractCoverImageSource(iframe);
    if (src) {
      state.coverImageSrc = src;
    }
  }
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
    const panelRect = elements.leftPanel?.getBoundingClientRect?.();
    const viewportWidth =
      viewportRect.width > 24
        ? viewportRect.width
        : panelRect && panelRect.width > 24
          ? panelRect.width
          : elements.canvasStage?.getBoundingClientRect?.().width || 0;
    const viewportHeight =
      viewportRect.height > 24
        ? viewportRect.height
        : panelRect && panelRect.height > 24
          ? panelRect.height
          : elements.canvasStage?.getBoundingClientRect?.().height || 0;

    // Avoid overwriting a good cover render with a 1x1 canvas when hidden.
    if (viewportWidth <= 24 || viewportHeight <= 24) {
      return;
    }

    const fitScale = Math.min(
      viewportWidth / bounds.w,
      viewportHeight / bounds.h
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
  const isMobileSingle = state.singlePageMode && window.innerWidth < SINGLE_PAGE_BREAKPOINT;

  const views = Array.from(container.querySelectorAll(".epub-view")).filter(
    (view) => view instanceof HTMLElement
  );

  container.style.gap = "0px";
  container.style.columnGap = "0px";
  container.style.rowGap = "0px";
  container.style.margin = "0";
  container.style.padding = "0";
  container.style.height = "100%";
  container.style.minHeight = "100%";
  container.style.justifyContent = "center";
  container.style.alignItems = "stretch";
  for (const view of views) {
    if (!(view instanceof HTMLElement)) continue;
    view.style.display = "block";
    view.style.margin = "0";
    view.style.marginLeft = "0";
    view.style.marginRight = "0";
    view.style.padding = "0";
    view.style.height = "100%";
    view.style.minHeight = "100%";
    view.style.overflow = "hidden";
    view.style.background = isMobileSingle ? "transparent" : "#fff";
    view.style.borderLeft = "";
    const iframe = view.querySelector("iframe");
    if (iframe instanceof HTMLElement) {
      iframe.style.margin = "0";
      iframe.style.padding = "0";
      iframe.style.border = "0";
      iframe.style.display = "block";
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.background = isMobileSingle ? "transparent" : "#fff";
    }
  }

  // In desktop spread mode, collapse any residual seam gap and draw a thin spine.
  if (!state.singlePageMode && views.length >= 2) {
    const second = views[1];
    second.style.marginLeft = "-1px";
    second.style.borderLeft = "1px solid rgba(20, 24, 34, 0.35)";
  }
}

function registerContentSeamOverrides(rendition) {
  if (!rendition?.hooks?.content?.register) return;
  rendition.hooks.content.register((contents) => {
    try {
      contents.addStylesheetRules({
        html: {
          margin: "0 !important",
          padding: "0 !important",
          "background-color": "transparent !important",
        },
        body: {
          margin: "0 !important",
          padding: "0 !important",
          "background-color": "transparent !important",
        },
        "img,svg,canvas": {
          margin: "0 !important",
          padding: "0 !important",
          display: "block !important",
        },
        ".main,svg": {
          "background-color": "transparent !important",
        },
      });

      const doc = contents?.document;
      if (doc) {
        const applyMobileInlineCentering = () => {
          const isMobileSingle = window.innerWidth < SINGLE_PAGE_BREAKPOINT && state.singlePageMode;
          let styleEl = doc.getElementById("mobile-inline-centering-style");
          if (!styleEl) {
            styleEl = doc.createElement("style");
            styleEl.id = "mobile-inline-centering-style";
            doc.head?.appendChild(styleEl);
          }
          styleEl.textContent = isMobileSingle
            ? `
html, body {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  background: transparent !important;
}
body {
  transform: none !important;
  transform-origin: center center !important;
  display: grid !important;
  place-items: center !important;
}
.main {
  width: 100% !important;
  height: 100% !important;
  display: grid !important;
  place-items: center !important;
  background: transparent !important;
}
svg, img, canvas {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
}
`
            : "";
        };

        applyMobileInlineCentering();

        let pointerDown = null;

        doc.addEventListener("pointerdown", (event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          pointerDown = {
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
          };
        });

        doc.addEventListener("pointerup", (event) => {
          if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
          const movedX = Math.abs(event.clientX - pointerDown.x);
          const movedY = Math.abs(event.clientY - pointerDown.y);
          pointerDown = null;
          if (movedX > TAP_MAX_MOVE_PX || movedY > TAP_MAX_MOVE_PX) return;
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("a,button,input,textarea,select,label")) return;
          if (elements.readerView.classList.contains("is-loading")) return;
          void goNext();
        });

        doc.addEventListener("pointercancel", () => {
          pointerDown = null;
        });
      }
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

function scheduleRenditionReflow() {
  if (!state.rendition) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const { width, height } = updateViewportSize();
      state.rendition?.resize(width, height);
    });
  });
}

function scheduleFixedLayoutCentering() {
  void 0;
}

function centerFixedLayoutFrames() {
  void 0;
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

function buildSpreads(totalPages, singlePageMode = false) {
  const spreads = [];
  if (totalPages >= 1) {
    spreads.push({ type: "cover", pages: [0, null] });
  }

  if (singlePageMode) {
    for (let pageIndex = 1; pageIndex < totalPages; pageIndex += 1) {
      spreads.push({ type: "spread", pages: [pageIndex, null] });
    }
  } else {
    for (let pageIndex = 1; pageIndex < totalPages; pageIndex += 2) {
      const right = pageIndex + 1 < totalPages ? pageIndex + 1 : null;
      spreads.push({ type: "spread", pages: [pageIndex, right] });
    }
  }

  return spreads;
}

function clampSpread(index) {
  const max = Math.max(0, state.spreads.length - 1);
  return Math.max(0, Math.min(max, index));
}

function getActiveSpread() {
  return state.spreads[state.currentSpread] || { type: "cover", pages: [0, null] };
}

function getActiveAnchorSpineIndex() {
  const spread = getActiveSpread();
  const page = Array.isArray(spread.pages) ? spread.pages.find((p) => Number.isInteger(p)) : 0;
  return Number.isInteger(page) ? page : 0;
}

function findSpreadIndexForSpine(spineIndex) {
  if (!Number.isInteger(spineIndex) || spineIndex < 0) return 0;
  const idx = state.spreads.findIndex((spread) => Array.isArray(spread.pages) && spread.pages.includes(spineIndex));
  return idx >= 0 ? idx : 0;
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
  const current = Math.max(0, Math.min(total - 1, getActiveAnchorSpineIndex()));
  const atStart = state.currentSpread <= 0;
  const atEnd = state.currentSpread >= Math.max(0, state.spreads.length - 1);

  if (state.direction === "ltr") {
    elements.leftNav.disabled = atStart;
    elements.rightNav.disabled = atEnd;
  } else {
    elements.leftNav.disabled = atEnd;
    elements.rightNav.disabled = atStart;
  }

  if (state.singlePageMode) {
    const displayPage = current + 1;
    elements.pageIndicator.textContent = `${displayPage} / ${Math.max(1, total)}`;
    return;
  }

  const spreadTotal = Math.max(1, state.spreads.length || Math.ceil(Math.max(1, total) / 2));
  const spreadDisplay = Math.max(1, Math.min(spreadTotal, state.currentSpread + 1));
  elements.pageIndicator.textContent = `${spreadDisplay} / ${spreadTotal}`;
}

function ensureSinglePageModeMatchesViewport() {
  const nextSinglePageMode = window.innerWidth < SINGLE_PAGE_BREAKPOINT;
  if (nextSinglePageMode === state.singlePageMode) {
    return;
  }

  const anchor = getActiveAnchorSpineIndex();
  state.singlePageMode = nextSinglePageMode;
  state.spreads = buildSpreads(getSpineLength(), state.singlePageMode);
  state.currentSpread = clampSpread(findSpreadIndexForSpine(anchor));
}

async function syncSpreadMode() {
  if (!state.rendition || state.syncingSpread) return;
  ensureSinglePageModeMatchesViewport();
  const spread = getActiveSpread();
  const left = Number.isInteger(spread.pages?.[0]) ? spread.pages[0] : 0;
  const right = Number.isInteger(spread.pages?.[1]) ? spread.pages[1] : null;
  const isCoverSpread = state.currentSpread === 0;
  const nextMode = right === null ? "none" : "auto";
  elements.epubViewport.classList.toggle("is-single-page", nextMode === "none");
  elements.spreadContainer?.classList.toggle("spread-single", nextMode === "none");
  elements.spreadContainer?.classList.toggle("spread-double", nextMode !== "none");
  state.coverSessionActive = state.currentSpread === 0;
  if (state.coverSessionActive && coverCanvasState.canvas instanceof HTMLCanvasElement) {
    showCoverCanvas();
  }

  const applySpreadMode = state.activeSpreadMode !== nextMode;
  const current = getCurrentSpineIndex();
  const shouldDisplayTarget = current !== left || applySpreadMode;

  state.syncingSpread = true;
  try {
    if (applySpreadMode) {
      state.activeSpreadMode = nextMode;
      state.rendition.spread(nextMode);
    }

    if (isCoverSpread) {
      // Cover is driven by rendered cover canvas, not by spine relocation.
      // Avoid display() here to prevent late jumps to page 1.
      state.currentSpineIndex = 0;
      void renderCoverCanvasIfNeeded();
      return;
    }

    if (shouldDisplayTarget) {
      const displayIndex = left;
      const target = String(
        getSpineItemAt(displayIndex)?.href || getSpineItemAt(displayIndex)?.cfiBase || ""
      ).trim();
      if (target) {
        await state.rendition.display(target);
        if (applySpreadMode && nextMode === "auto") {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await state.rendition.display(target);
        }
        const { width, height } = updateViewportSize();
        state.rendition.resize(width, height);
        state.currentSpineIndex = displayIndex;
      }
    }
  } finally {
    state.syncingSpread = false;
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
    container.style.transformOrigin = "center center";
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
  void location;
  const spineTotal = getSpineLength();
  if (state.singlePageMode) {
    const current = Math.max(1, Math.min(spineTotal, getActiveAnchorSpineIndex() + 1));
    elements.pageIndicator.textContent = `${current} / ${Math.max(1, spineTotal)}`;
    return;
  }

  const spreadTotal = Math.max(1, state.spreads.length || Math.ceil(Math.max(1, spineTotal) / 2));
  const spreadDisplay = Math.max(1, Math.min(spreadTotal, state.currentSpread + 1));
  elements.pageIndicator.textContent = `${spreadDisplay} / ${spreadTotal}`;
}

async function goNext() {
  if (!state.rendition) return;
  const nextSpread = clampSpread(state.currentSpread + 1);
  if (nextSpread !== state.currentSpread) {
    state.hasUserNavigated = true;
    state.initializingCover = false;
    state.currentSpread = nextSpread;
    if (nextSpread > 0) {
      state.navigationInProgress = true;
      hideCoverCanvas();
    }
    await syncSpreadMode();
    updatePagerState();
    scheduleFixedLayoutCentering();
  }
}

async function goPrev() {
  if (!state.rendition) return;
  const prevSpread = clampSpread(state.currentSpread - 1);
  if (prevSpread !== state.currentSpread) {
    state.hasUserNavigated = true;
    state.initializingCover = false;
    state.currentSpread = prevSpread;
    if (prevSpread === 0) {
      state.navigationInProgress = false;
      state.coverSessionActive = true;
      state.activeSpreadMode = "none";
      try {
        state.rendition.spread("none");
      } catch (_error) {
        // Ignore spread-mode errors from inconsistent epub.js builds.
      }
      if (coverCanvasState.canvas instanceof HTMLCanvasElement) {
        showCoverCanvas();
      }
      await renderCoverCanvasIfNeeded();
      updatePagerState();
      return;
    }
    state.navigationInProgress = true;
    await syncSpreadMode();
    updatePagerState();
    scheduleFixedLayoutCentering();
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
  let stagePointerDown = null;

  elements.leftNav.addEventListener("click", () => void onLeftNav());
  elements.rightNav.addEventListener("click", () => void onRightNav());

  elements.canvasStage?.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    stagePointerDown = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  });

  elements.canvasStage?.addEventListener("pointerup", (event) => {
    if (!stagePointerDown || stagePointerDown.pointerId !== event.pointerId) return;
    const movedX = Math.abs(event.clientX - stagePointerDown.x);
    const movedY = Math.abs(event.clientY - stagePointerDown.y);
    stagePointerDown = null;
    if (movedX > TAP_MAX_MOVE_PX || movedY > TAP_MAX_MOVE_PX) return;
    if (elements.readerView.classList.contains("is-loading")) return;
    void goNext();
  });

  elements.canvasStage?.addEventListener("pointercancel", () => {
    stagePointerDown = null;
  });

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
    syncAppViewportHeight();
    const nextSinglePageMode = window.innerWidth < SINGLE_PAGE_BREAKPOINT;
    if (nextSinglePageMode !== state.singlePageMode) {
      const anchor = getActiveAnchorSpineIndex();
      state.singlePageMode = nextSinglePageMode;
      state.spreads = buildSpreads(getSpineLength(), state.singlePageMode);
      state.currentSpread = clampSpread(findSpreadIndexForSpine(anchor));
    }
    const { width, height } = updateViewportSize();
    state.rendition?.resize(width, height);
    void syncSpreadMode();
    updatePagerState();
    void renderCoverCanvasIfNeeded();
  });

  window.visualViewport?.addEventListener("resize", syncAppViewportHeight);
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
  try {
    if (typeof state.book.coverUrl === "function") {
      const coverUrl = await state.book.coverUrl();
      state.coverImageSrc = String(coverUrl || "").trim();
    } else {
      state.coverImageSrc = "";
    }
  } catch (_error) {
    state.coverImageSrc = "";
  }

  const attachRenditionEvents = (rendition) => {
    rendition.on("click", (event) => {
      const target = event?.target instanceof Element ? event.target : null;
      if (target?.closest("a,button,input,textarea,select,label")) {
        return;
      }
      if (elements.readerView.classList.contains("is-loading")) {
        return;
      }
      void goNext();
    });

    rendition.on("relocated", (location) => {
      const index = Number(location?.start?.index);
      if (state.initializingCover && !state.hasUserNavigated) {
        state.currentSpread = 0;
        state.coverSessionActive = true;
        if (state.activeSpreadMode !== "none") {
          state.activeSpreadMode = "none";
          state.rendition?.spread("none");
        }
        state.currentSpineIndex = 0;
        state.currentCfi = String(location?.start?.cfi || "").trim();
        updatePageIndicator(location);
        updatePagerState();
        applyZoom();
        normalizeSpreadSeam();
        if (!state.navigationInProgress) {
          centerFixedLayoutFrames();
        }
        setReaderLoading(false);
        void renderCoverCanvasIfNeeded();
        return;
      }

      // When user navigates back to cover, keep cover state stable and ignore
      // late relocation indices that can point to page 1 in the same section.
      if (state.coverSessionActive && state.currentSpread === 0 && state.hasUserNavigated) {
        if (coverCanvasState.canvas instanceof HTMLCanvasElement) {
          showCoverCanvas();
        }
        state.navigationInProgress = false;
        state.currentSpread = 0;
        state.coverSessionActive = true;
        state.currentSpineIndex = 0;
        state.currentCfi = String(location?.start?.cfi || "").trim();
        updatePagerState();
        applyZoom();
        normalizeSpreadSeam();
        if (!state.navigationInProgress) {
          centerFixedLayoutFrames();
        }
        setReaderLoading(false);
        void renderCoverCanvasIfNeeded();
        return;
      }

      if (Number.isFinite(index) && index >= 0) {
        state.currentSpineIndex = index;
        if (state.hasUserNavigated && state.currentSpread !== 0) {
          state.currentSpread = clampSpread(findSpreadIndexForSpine(index));
        }
      }
      if (state.hasUserNavigated) {
        state.coverSessionActive = state.currentSpread === 0;
      }
      state.currentCfi = String(location?.start?.cfi || "").trim();
      updatePageIndicator(location);
      updatePagerState();
      applyZoom();
      normalizeSpreadSeam();
      state.navigationInProgress = false;
      setReaderLoading(false);
      void renderCoverCanvasIfNeeded();
    });
    rendition.on("rendered", () => {
      applyZoom();
      normalizeSpreadSeam();
      state.navigationInProgress = false;
      setReaderLoading(false);
      void renderCoverCanvasIfNeeded();
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
    state.spreads = buildSpreads(getSpineLength(), state.singlePageMode);
    state.currentSpread = 0;
    state.activeSpreadMode = "";
    state.coverImageSrc = String(state.coverImageSrc || "").trim();
    state.coverSessionActive = true;
    state.initializingCover = true;
    state.hasUserNavigated = false;
    state.correctingCoverRelocation = false;
    state.syncingSpread = false;
    setReaderLoading(true, "Rendering pages...");
    await withTimeout(
      state.rendition.display(firstTarget),
      DISPLAY_TIMEOUT_MS,
      "EPUB took too long to render."
    );
    state.rendition.resize(width, height);
    scheduleRenditionReflow();
    setReaderLoading(false);
  };

  try {
    await renderWithOptions(PRIMARY_RENDER_OPTIONS);
  } catch (_primaryError) {
    state.rendition?.destroy();
    await renderWithOptions(FALLBACK_RENDER_OPTIONS);
  }

  // Intentionally skip locations.generate() on initial load.
  // It can trigger late relocations that split cover/startup spread state.
  state.locationReady = false;

  document.title = `${title} - BluPetal`;
  applyZoom();
  scheduleRenditionReflow();
  updateDirectionUi();
  updateDirectionalLabels();
  updatePagerState();
  hidePanelFallback();
}

async function init() {
  syncAppViewportHeight();
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
