import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const CONTENT_DATA_PATH = "./content.json";
const FALLBACK_THUMBNAIL = "./assets/thumbnails/placeholder.svg";
const SINGLE_PAGE_BREAKPOINT = 900;
const MAX_ZOOM = 2;

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
  activeItem: null,
  eventsBound: false,
};

const elements = {
  libraryView: document.getElementById("libraryView"),
  libraryGrid: document.getElementById("libraryGrid"),
  libraryError: document.getElementById("libraryError"),
  readerView: document.getElementById("readerView"),
  libraryLink: document.getElementById("libraryLink"),
  pager: document.querySelector("footer.pager"),
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

function sanitizeContentItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = String(item.id || "").trim();
  const title = String(item.title || "").trim();
  const pdf = String(item.pdf || "").trim();
  const thumbnail = String(item.thumbnail || "").trim();
  const groups = Array.isArray(item.groups)
    ? item.groups
        .map((group) => String(group || "").trim())
        .filter((group) => group.length > 0)
    : [];
  const genres = Array.isArray(item.genres)
    ? item.genres
        .map((genre) => String(genre || "").trim())
        .filter((genre) => genre.length > 0)
    : [];

  if (!id || !title || !pdf) {
    return null;
  }

  return {
    id,
    title,
    pdf,
    thumbnail: thumbnail || FALLBACK_THUMBNAIL,
    groups,
    genres,
    description: String(item.description || "").trim(),
  };
}

function sanitizeSection(section) {
  if (!section || typeof section !== "object") {
    return null;
  }

  const id = String(section.id || "").trim();
  const title = String(section.title || "").trim();
  if (!id || !title) {
    return null;
  }

  return { id, title };
}

async function loadContent() {
  try {
    const response = await fetch(CONTENT_DATA_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawItems = Array.isArray(data?.manga) ? data.manga : [];
    const rawSections = Array.isArray(data?.sections) ? data.sections : [];
    const contentItems = rawItems.map(sanitizeContentItem).filter(Boolean);
    const sectionOrder = rawSections.map(sanitizeSection).filter(Boolean);

    if (!contentItems.length) {
      throw new Error("No valid manga entries found.");
    }

    const knownSectionIds = new Set(sectionOrder.map((section) => section.id));
    const discoveredSections = [];
    contentItems.forEach((item) => {
      item.groups.forEach((groupId) => {
        if (!knownSectionIds.has(groupId)) {
          knownSectionIds.add(groupId);
          discoveredSections.push({
            id: groupId,
            title: groupId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          });
        }
      });
    });

    state.contentItems = contentItems;
    state.librarySections = [...sectionOrder, ...discoveredSections];
    clearLibraryError();
  } catch (error) {
    state.contentItems = [];
    state.librarySections = [];
    showLibraryError(
      `Could not load library metadata from ${CONTENT_DATA_PATH}. ${error.message}`
    );
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
  cover.src = item.thumbnail;
  cover.alt = `${item.title} cover`;
  cover.loading = "lazy";
  cover.addEventListener("error", () => {
    if (cover.src !== new URL(FALLBACK_THUMBNAIL, window.location.href).href) {
      cover.src = FALLBACK_THUMBNAIL;
    }
  });

  const title = document.createElement("span");
  title.className = "manga-title";
  title.textContent = item.title;

  const meta = document.createElement("span");
  meta.className = "manga-meta";
  meta.textContent = item.genres.length ? item.genres.join(", ") : "Manga";

  card.append(cover, title, meta);
  card.addEventListener("click", () => {
    window.location.href = `./manga.html?manga=${encodeURIComponent(item.id)}`;
  });

  return card;
}

function renderLibrary() {
  elements.libraryGrid.innerHTML = "";
  if (!state.contentItems.length) {
    elements.libraryGrid.innerHTML =
      '<p class="library-empty">No manga available. Add entries to content.json.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  const sectionsToRender = state.librarySections.length
    ? state.librarySections
    : [{ id: "all", title: "All Manga" }];

  sectionsToRender.forEach((section) => {
    const itemsForSection =
      section.id === "all"
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
    sectionAction.textContent = "See All →";

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

function showLibraryView(pushState = false) {
  elements.libraryView.classList.remove("hidden");
  elements.readerView.classList.add("hidden");
  document.body.classList.remove("reader-active");
  document.body.classList.add("library-active");
  document.title = "BluPetal Library";

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
}

function updateReaderBackLink() {
  if (!elements.libraryLink) {
    return;
  }
  if (state.activeItem?.id) {
    elements.libraryLink.href = `./manga.html?manga=${encodeURIComponent(
      state.activeItem.id
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
    return;
  }

  elements.rightPanel.classList.toggle("hidden", isSingle);

  if (spread.type === "cover") {
    await renderPdfPageToPanel(spread.pages[0], "left");
    elements.rightPanel.style.width = "0px";
    elements.rightPanel.style.minWidth = "0px";
    elements.rightPanel.style.maxWidth = "0px";
    return;
  }

  const [first, second] = spread.pages;
  const leftPage = state.direction === "rtl" && second ? second : first;
  const rightPage = state.direction === "rtl" && second ? first : second;

  await renderPdfPageToPanel(leftPage, "left");

  if (!isSingle) {
    await renderPdfPageToPanel(rightPage, "right");
  }
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
    const mangaId = new URLSearchParams(window.location.search).get("manga");
    if (!mangaId) {
      showLibraryView(false);
      return;
    }
    void openMangaById(mangaId, false);
  });

  state.eventsBound = true;
}

async function loadPdfForItem(item) {
  state.activeItem = item;
  state.zoom = 1;
  state.currentSpread = 0;
  state.pendingSpread = null;
  state.renderInProgress = false;
  state.singlePageMode = window.innerWidth < SINGLE_PAGE_BREAKPOINT;

  clearError();
  showReaderView();
  updateReaderBackLink();
  document.title = `${item.title} - BluPetal`;

  try {
    const loadingTask = pdfjsLib.getDocument(item.pdf);
    state.pdfDoc = await loadingTask.promise;
    state.totalPdfPages = state.pdfDoc.numPages;
    state.spreads = buildSpreads(state.totalPdfPages, state.singlePageMode);
    state.currentSpread = 0;

    updateDirectionalLabels();
    applyPagerLayout();
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
      `Could not load ${item.pdf}. Verify the file exists and matches content.json.`
    );
    console.error(error);
  }
}

async function openMangaById(mangaId, pushState = false) {
  const item = state.contentItems.find((entry) => entry.id === mangaId);
  if (!item) {
    showLibraryView(false);
    showLibraryError(`Could not find manga id "${mangaId}" in content.json.`);
    return;
  }

  clearLibraryError();
  if (pushState) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("manga", item.id);
    window.history.pushState({}, "", nextUrl);
  }

  await loadPdfForItem(item);
}

async function init() {
  wireEvents();
  await loadContent();
  renderLibrary();

  const mangaId = new URLSearchParams(window.location.search).get("manga");
  if (!mangaId) {
    showLibraryView(false);
    return;
  }

  await openMangaById(mangaId, false);
}

void init();
