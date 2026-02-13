import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const DEFAULT_PDF_PATH = "./pdfs/sample.pdf";

function resolvePdfPathFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const rawTitle = params.get("title");

  if (!rawTitle) {
    return DEFAULT_PDF_PATH;
  }

  const trimmedTitle = rawTitle.trim();
  const safeTitle = trimmedTitle.replace(/[^a-zA-Z0-9 _-]/g, "");
  if (!safeTitle) {
    return DEFAULT_PDF_PATH;
  }

  return `./pdfs/${encodeURIComponent(safeTitle)}.pdf`;
}

const state = {
  pdfDoc: null,
  totalPdfPages: 0,
  spreads: [],
  currentSpread: 0,
  direction: "rtl",
  zoom: 1,
  renderInProgress: false,
  pendingSpread: null,
};

const elements = {
  stage: document.getElementById("canvasStage"),
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
};

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
  const pagerHeight =
    document.querySelector(".pager")?.getBoundingClientRect().height || 0;
  const viewportInnerWidth = Math.max(1, window.innerWidth - stagePaddingX);
  const viewportInnerHeight = Math.max(
    1,
    window.innerHeight - topbarHeight - pagerHeight - stagePaddingY
  );

  // Use the larger of stage and viewport-derived dimensions to avoid undersized
  // first-paint fits caused by transient container measurements.
  const effectiveInnerWidth = Math.max(stageInnerWidth, viewportInnerWidth);
  const effectiveInnerHeight = Math.max(stageInnerHeight, viewportInnerHeight);

  const availableWidth = isSingleView
    ? effectiveInnerWidth
    : Math.max(1, (effectiveInnerWidth - columnGap) / 2);
  const availableHeight = effectiveInnerHeight;

  return { availableWidth, availableHeight };
}

function setError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("hidden");
}

function clearError() {
  elements.errorBanner.textContent = "";
  elements.errorBanner.classList.add("hidden");
}

function buildSpreads(totalPages) {
  const spreads = [];

  if (totalPages >= 1) {
    spreads.push({ type: "cover", pages: [1] });
  }

  let pageNumber = 2;
  while (pageNumber <= totalPages) {
    const left = pageNumber;
    const right = pageNumber + 1 <= totalPages ? pageNumber + 1 : null;
    spreads.push({ type: "spread", pages: [left, right] });
    pageNumber += 2;
  }

  spreads.push({ type: "end", pages: [] });
  return spreads;
}

function clampSpread(index) {
  const max = Math.max(0, state.spreads.length - 1);
  return Math.min(Math.max(index, 0), max);
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
  } else if (elements.directionToggle) {
    elements.directionToggle.textContent = `↔ ${state.direction.toUpperCase()}`;
  }

  elements.directionToggle?.setAttribute(
    "aria-label",
    `Toggle reading direction (currently ${state.direction.toUpperCase()})`
  );
}

function updatePager() {
  const total = state.spreads.length;
  const index = state.currentSpread;
  const display = index + 1;
  elements.pageIndicator.textContent = `${display} / ${total}`;

  const atStart = index === 0;
  const atEnd = index === total - 1;

  if (state.direction === "ltr") {
    // LTR: left button is Previous, right button is Next
    elements.leftNav.disabled = atStart;
    elements.rightNav.disabled = atEnd;
  } else {
    // RTL: left button is Next, right button is Previous
    elements.leftNav.disabled = atEnd;
    elements.rightNav.disabled = atStart;
  }

  elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
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

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

  const renderTask = page.render({ canvasContext: ctx, viewport });
  await renderTask.promise;
}

function renderEndPage(panelId) {
  const canvas = panelId === "left" ? elements.leftCanvas : elements.rightCanvas;
  showCanvas(panelId);

  const baseWidth = 900;
  const baseHeight = 1300;
  const { availableWidth, availableHeight } = measureAvailablePanelSize();
  const fitScale = Math.min(
    availableWidth / baseWidth,
    availableHeight / baseHeight
  );
  const displayWidth = Math.max(1, Math.floor(baseWidth * fitScale * state.zoom));
  const displayHeight = Math.max(1, Math.floor(baseHeight * fitScale * state.zoom));
  const outputScale = window.devicePixelRatio || 1;

  canvas.width = Math.floor(displayWidth * outputScale);
  canvas.height = Math.floor(displayHeight * outputScale);
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(outputScale * (displayWidth / baseWidth), 0, 0, outputScale * (displayHeight / baseHeight), 0, 0);
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

async function renderSpread(index) {
  const spread = state.spreads[index];
  if (!spread) {
    return;
  }

  const isSingle = spread.type === "cover" || spread.type === "end" || !spread.pages[1];
  elements.spread.classList.toggle("spread-single", isSingle);
  elements.spread.classList.toggle("spread-double", !isSingle);

  if (spread.type === "end") {
    renderEndPage("left");
    elements.rightPanel.classList.add("hidden");
    return;
  }

  elements.rightPanel.classList.toggle("hidden", isSingle);

  if (spread.type === "cover") {
    await renderPdfPageToPanel(spread.pages[0], "left");
    return;
  }

  const [first, second] = spread.pages;
  const leftPage = state.direction === "rtl" && second ? second : first;
  const rightPage = state.direction === "rtl" && second ? first : second;

  await renderPdfPageToPanel(leftPage, "left");

  if (isSingle) {
    return;
  }

  await renderPdfPageToPanel(rightPage, "right");
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
    state.zoom = Math.min(state.zoom + 0.1, 3);
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
    state.zoom = Math.min(state.zoom + 0.1, 3);
    updatePager();
    queueRender();
  });

  elements.zoomOut.addEventListener("click", () => {
    state.zoom = Math.max(state.zoom - 0.1, 0.4);
    updatePager();
    queueRender();
  });

  elements.directionToggle.addEventListener("click", () => {
    const progress =
      state.spreads.length > 1
        ? state.currentSpread / (state.spreads.length - 1)
        : 0;
    state.direction = state.direction === "ltr" ? "rtl" : "ltr";
    state.spreads = buildSpreads(state.totalPdfPages);
    state.currentSpread = clampSpread(
      Math.round(progress * Math.max(0, state.spreads.length - 1))
    );
    updateDirectionalLabels();
    updatePager();
    queueRender();
  });

  elements.bookmarkToggle?.addEventListener("click", () => {
    const pressed = elements.bookmarkToggle.getAttribute("aria-pressed") === "true";
    elements.bookmarkToggle.setAttribute("aria-pressed", pressed ? "false" : "true");
  });

  window.addEventListener("keydown", onKeyboard);

  window.addEventListener("resize", () => queueRender());
}

async function init() {
  wireEvents();
  updateDirectionalLabels();
  const pdfPath = resolvePdfPathFromQuery();

  try {
    const loadingTask = pdfjsLib.getDocument(pdfPath);
    state.pdfDoc = await loadingTask.promise;
    state.totalPdfPages = state.pdfDoc.numPages;
    state.spreads = buildSpreads(state.totalPdfPages);
    state.currentSpread = 0;

    clearError();
    updatePager();
    queueRender();
  } catch (error) {
    state.spreads = [{ type: "error", pages: [] }];
    state.currentSpread = 0;
    updatePager();
    elements.leftPanel.classList.remove("hidden");
    elements.rightPanel.classList.add("hidden");
    showPanelFallback("left", "PDF could not be loaded.");
    setError(
      `Could not load ${pdfPath}. Add a valid PDF file in /pdfs/ and reload the page.`
    );
    console.error(error);
  }
}

// TODO: add thumbnail strip with spread jump.
// TODO: add continuous scroll mode.
// TODO: add configurable double-page spread options.
// TODO: add touch gestures (swipe, pinch zoom).

void init();
