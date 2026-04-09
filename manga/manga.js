import { appAuthzConfig } from "../auth/auth-config.js";
import {
  clearAuthSession,
  getAuthSession,
  getJwtGivenName,
  getJwtPicture,
} from "../auth/auth-session.js";

const FALLBACK_COVER = "../content/manga/placeholder.svg";

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
  mangaGet: String(appAuthzConfig?.getMangaEndpoint || "").trim() || endpointFromMangaBase("/manga"),
  userLibrary:
    String(appAuthzConfig?.userLibraryEndpoint || "").trim() ||
    endpointFromMangaBase("/user-library"),
  genreGet: String(appAuthzConfig?.getGenreEndpoint || "").trim() || endpointFromMangaBase("/genre"),
  mangaContentGet:
    String(appAuthzConfig?.getMangaContentEndpoint || "").trim() ||
    endpointFromMangaBase("/manga-content"),
};

const elements = {
  mangaPage: document.getElementById("mangaPage"),
  mangaLayout: document.getElementById("mangaLayout"),
  mangaError: document.getElementById("mangaError"),
  mangaCover: document.getElementById("mangaCover"),
  mangaTitle: document.getElementById("mangaTitle"),
  breadcrumbTitle: document.getElementById("breadcrumbTitle"),
  heroMetaLine: document.getElementById("heroMetaLine"),
  mangaDescription: document.getElementById("mangaDescription"),
  metaAuthor: document.getElementById("metaAuthor"),
  metaCategories: document.getElementById("metaCategories"),
  metaGenres: document.getElementById("metaGenres"),
  metaAge: document.getElementById("metaAge"),
  metaStatus: document.getElementById("metaStatus"),
  metaRating: document.getElementById("metaRating"),
  metaVolumeCount: document.getElementById("metaVolumeCount"),
  volumeCountLabel: document.getElementById("volumeCountLabel"),
  volumeList: document.getElementById("volumeList"),
  moreLikeThisSection: document.getElementById("moreLikeThisSection"),
  moreLikeList: document.getElementById("moreLikeList"),
  startReadingBtn: document.getElementById("startReadingBtn"),
  addLibraryBtn: document.getElementById("addLibraryBtn"),
  readingProgressText: document.getElementById("readingProgressText"),
  readingProgressFill: document.getElementById("readingProgressFill"),
  accountAvatar: document.getElementById("accountAvatar"),
  welcomeMessage: document.getElementById("welcomeMessage"),
  accountIconSvg: document.querySelector(".settings-trigger .library-icon-svg"),
  adminPortalGroup: document.getElementById("adminPortalGroup"),
  signoutLink: document.querySelector(".settings-item.signout"),
};

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

function wireAccountMenu() {
  const session = getAuthSession();
  const isAdmin = Boolean(session?.isAdmin || Number(session?.admin || 0) === 1);
  const idToken = String(session?.idToken || "").trim();
  const givenName = String(
    session?.givenName || session?.given_name || getJwtGivenName(idToken) || ""
  ).trim();
  const image = String(
    session?.image || session?.picture || session?.avatar || getJwtPicture(idToken) || ""
  ).trim();

  if (isAdmin) {
    elements.adminPortalGroup?.classList.remove("hidden");
  } else {
    elements.adminPortalGroup?.classList.add("hidden");
  }

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

  elements.signoutLink?.addEventListener("click", () => {
    clearAuthSession();
  });
}

function showError(message) {
  elements.mangaError.textContent = message;
  elements.mangaError.classList.remove("hidden");
  elements.mangaLayout.classList.add("hidden");
}

function hideError() {
  elements.mangaError.textContent = "";
  elements.mangaError.classList.add("hidden");
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function normalizeLookupItems(items, idKey) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const id = String(item?.[idKey] || "").trim();
      const name = String(item?.name || "").trim();
      if (!id) return null;
      return { id, name: name || id };
    })
    .filter(Boolean);
}

async function fetchLookupMap(url, idKey) {
  const response = await requestJson(url, { method: "GET" });
  const data = responseData(response);
  const normalized = normalizeLookupItems(data?.items, idKey);
  return new Map(normalized.map((item) => [item.id, item.name]));
}

function normalizeParagraphs(item) {
  const text = String(item.description || "").trim();
  if (!text) {
    return ["Description coming soon."];
  }
  return text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function toTitleCase(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (!clean) {
    return "";
  }
  return clean
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeGenreKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function chipClassForGenre(value) {
  const key = normalizeGenreKey(value);
  const supported = new Set([
    "slice-of-life",
    "drama",
    "fantasy",
    "comedy",
    "sci-fi",
    "adventure",
    "romance",
    "sports",
    "horror",
    "mystery",
    "action",
    "manga",
  ]);
  return supported.has(key) ? `genre-chip--${key}` : "";
}

function formatVolumeTitle(contentItem, index) {
  const explicitTitle = String(contentItem?.title || "").trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const contentType = String(contentItem?.content_type || "").trim().toLowerCase();
  const sequenceNumber = Number(contentItem?.sequence_number);
  if (Number.isFinite(sequenceNumber)) {
    const prefix = contentType === "chapter" ? "Chapter" : "Volume";
    return `${prefix} ${sequenceNumber}`;
  }
  return `Volume ${index + 1}`;
}

function normalizeVolumes(parent, contentItems) {
  const normalized = (Array.isArray(contentItems) ? contentItems : [])
    .map((contentItem, index) => ({
      id: String(contentItem?.content_key || `v${index + 1}`),
      contentKey: String(contentItem?.content_key || "").trim(),
      sequenceNumber: Number(contentItem?.sequence_number),
      title: formatVolumeTitle(contentItem, index),
      date: "",
      pdf: String(contentItem?.file_url || "").trim(),
      cover: String(contentItem?.cover_url || "").trim() || String(parent.cover || "").trim(),
      synopsis: String(contentItem?.synopsis || "").trim(),
      pageCount: Number(contentItem?.page_count),
      contentType: String(contentItem?.content_type || "").trim(),
    }))
    .filter((item) => item.contentKey);

  normalized.sort((a, b) => {
    const aSeq = Number.isFinite(a.sequenceNumber) ? a.sequenceNumber : Number.MAX_SAFE_INTEGER;
    const bSeq = Number.isFinite(b.sequenceNumber) ? b.sequenceNumber : Number.MAX_SAFE_INTEGER;
    if (aSeq !== bSeq) {
      return aSeq - bSeq;
    }
    return a.contentKey.localeCompare(b.contentKey);
  });

  return normalized;
}

function normalizeParentManga(item) {
  return {
    id: String(item?.manga_id || "").trim(),
    title: String(item?.title || "").trim(),
    cover: String(item?.cover_url || "").trim(),
    description: String(item?.synopsis || "").trim(),
    ageRating: String(item?.age_rating || "").trim(),
    status: String(item?.is_active === false ? "Inactive" : "Ongoing").trim(),
    categoryIds: normalizeIdList(item?.category_ids),
    genreIds: normalizeIdList(item?.genre_ids),
    inUserLibrary: Boolean(item?.in_user_library),
    categories: [],
    genres: [],
    author: String(item?.publisher || "").trim(),
  };
}

function normalizeMangaSummary(item) {
  const mangaId = String(item?.manga_id || "").trim();
  const title = String(item?.title || "").trim();
  if (!mangaId || !title) {
    return null;
  }
  return {
    id: mangaId,
    title,
    cover: String(item?.cover_url || "").trim() || FALLBACK_COVER,
    author: String(item?.publisher || "").trim() || "Unknown",
    genreIds: normalizeIdList(item?.genre_ids),
  };
}

async function fetchMoreLikeThis(currentMangaId, genreIds, genreNameById) {
  const cleanMangaId = String(currentMangaId || "").trim();
  const cleanGenreIds = Array.isArray(genreIds)
    ? genreIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!cleanMangaId || !cleanGenreIds.length) {
    return [];
  }

  const url = new URL(endpoint.mangaGet);
  url.searchParams.set("genre_ids", cleanGenreIds.join(","));
  const response = await requestJson(url.toString(), { method: "GET" });
  const data = responseData(response);
  const items = (Array.isArray(data?.items) ? data.items : [])
    .map(normalizeMangaSummary)
    .filter(Boolean)
    .filter((entry) => entry.id !== cleanMangaId)
    .slice(0, 8)
    .map((entry) => ({
      ...entry,
      genres: entry.genreIds
        .map((id) => String(genreNameById.get(id) || id).trim())
        .filter(Boolean)
        .slice(0, 2),
    }));

  return items;
}

function buildReaderUrl(item, volume) {
  const url = new URL("../library.html", window.location.href);
  url.searchParams.set("manga", item.id);
  if (volume?.contentKey) {
    url.searchParams.set("content_key", volume.contentKey);
  }
  return url.toString();
}

async function addToUserLibrary(mangaId) {
  const cleanMangaId = String(mangaId || "").trim();
  if (!cleanMangaId) {
    throw new Error("Missing manga id.");
  }
  if (!endpointLooksConfigured(endpoint.userLibrary)) {
    throw new Error("User library endpoint is not configured.");
  }
  await requestJson(endpoint.userLibrary, {
    method: "POST",
    body: JSON.stringify({ manga_id: cleanMangaId }),
  });
}

function render(item) {
  const genres = Array.isArray(item.genres) ? item.genres : [];
  const paragraphs = normalizeParagraphs(item);
  const volumes = Array.isArray(item.volumes) ? item.volumes : [];
  const authorText = item.author || "Unknown";

  elements.mangaTitle.textContent = item.title || "Untitled Manga";
  if (elements.breadcrumbTitle) {
    elements.breadcrumbTitle.textContent = item.title || "Manga";
  }
  document.title = `${item.title || "Manga"} - BluPetal`;

  elements.mangaCover.src = String(item.cover || "").trim() || FALLBACK_COVER;
  elements.mangaCover.alt = `${item.title || "Manga"} cover`;
  elements.mangaCover.addEventListener("error", () => {
    elements.mangaCover.src = FALLBACK_COVER;
  });

  elements.mangaDescription.innerHTML = "";
  paragraphs.forEach((paragraph) => {
    const p = document.createElement("p");
    p.textContent = paragraph;
    elements.mangaDescription.appendChild(p);
  });

  elements.metaAuthor.textContent = item.author || "Unknown";
  elements.metaAge.textContent = item.ageRating || "18+";
  elements.metaStatus.textContent = toTitleCase(item.status || "Ongoing");
  elements.metaRating.textContent = "N/A";
  elements.metaVolumeCount.textContent = String(volumes.length || 0);
  elements.volumeCountLabel.textContent = `${volumes.length || 0} Volumes`;
  elements.heroMetaLine.textContent = `By ${authorText}`;

  elements.metaCategories.innerHTML = "";
  const mangaChip = document.createElement("span");
  mangaChip.className = "genre-chip";
  const mangaChipClass = chipClassForGenre("manga");
  if (mangaChipClass) {
    mangaChip.classList.add(mangaChipClass);
  }
  mangaChip.textContent = "Manga";
  elements.metaCategories.appendChild(mangaChip);

  elements.metaGenres.innerHTML = "";
  (genres.length ? genres : ["Manga"]).forEach((genre) => {
    const chip = document.createElement("span");
    chip.className = "genre-chip";
    const chipClass = chipClassForGenre(genre);
    if (chipClass) {
      chip.classList.add(chipClass);
    }
    chip.textContent = genre;
    elements.metaGenres.appendChild(chip);
  });

  // Prototype progress behavior:
  // We mock "currently on volume 1" while still using real total volume count.
  const totalVolumes = volumes.length;
  const currentVolume = totalVolumes > 0 ? 1 : 0;
  const progressPct = totalVolumes > 0 ? Math.round((currentVolume / totalVolumes) * 100) : 0;
  if (elements.readingProgressText) {
    elements.readingProgressText.textContent = `Vol. ${currentVolume} of ${totalVolumes} • ${progressPct}%`;
  }
  if (elements.readingProgressFill) {
    elements.readingProgressFill.style.width = `${progressPct}%`;
  }

  elements.moreLikeList.innerHTML = "";
  const moreLikeItems = Array.isArray(item.moreLikeItems) ? item.moreLikeItems : [];
  if (moreLikeItems.length) {
    elements.moreLikeThisSection?.classList.remove("hidden");
    moreLikeItems.forEach((entry) => {
      const card = document.createElement("a");
      card.className = "more-like-card";
      card.href = `./manga.html?manga=${encodeURIComponent(entry.id)}`;
      card.setAttribute("aria-label", `Open ${entry.title}`);

      const cover = document.createElement("img");
      cover.className = "more-like-cover";
      cover.loading = "lazy";
      cover.decoding = "async";
      cover.src = entry.cover || FALLBACK_COVER;
      cover.alt = `${entry.title} cover`;
      cover.addEventListener("error", () => {
        cover.src = FALLBACK_COVER;
      });

      const title = document.createElement("div");
      title.className = "more-like-title";
      title.textContent = entry.title;

      const meta = document.createElement("div");
      meta.className = "more-like-meta";
      meta.textContent = entry.author || "Unknown";

      const genresWrap = document.createElement("div");
      genresWrap.className = "more-like-genres";
      (entry.genres || []).forEach((genre) => {
        const chip = document.createElement("span");
        chip.className = "genre-chip";
        const chipClass = chipClassForGenre(genre);
        if (chipClass) {
          chip.classList.add(chipClass);
        }
        chip.textContent = genre;
        genresWrap.appendChild(chip);
      });

      card.append(cover, title, meta, genresWrap);
      elements.moreLikeList.appendChild(card);
    });
  } else {
    elements.moreLikeThisSection?.classList.add("hidden");
  }

  elements.volumeList.innerHTML = "";
  if (!volumes.length) {
    const empty = document.createElement("div");
    empty.className = "volume-item";
    empty.textContent = "No volumes available yet.";
    elements.volumeList.appendChild(empty);
  } else {
    volumes.forEach((volume, index) => {
      const volumeRow = document.createElement("article");
      volumeRow.className = "volume-item";

      const volumeCover = document.createElement("img");
      volumeCover.className = "volume-cover";
      volumeCover.loading = "lazy";
      volumeCover.decoding = "async";
      volumeCover.src = String(volume.cover || "").trim() || FALLBACK_COVER;
      volumeCover.alt = `${volume.title} cover`;
      volumeCover.addEventListener("error", () => {
        volumeCover.src = FALLBACK_COVER;
      });

      const textWrap = document.createElement("div");
      textWrap.className = "volume-text";
      const title = document.createElement("div");
      title.className = "volume-label";
      title.textContent = volume.title;
      const date = document.createElement("div");
      date.className = "volume-date";
      if (Number.isFinite(volume.pageCount) && volume.pageCount > 0) {
        date.textContent = `${volume.pageCount} pages`;
      } else {
        date.textContent = volume.date || "Available";
      }
      const synopsis = document.createElement("p");
      synopsis.className = "volume-synopsis";
      synopsis.textContent = volume.synopsis || "Synopsis coming soon.";
      textWrap.append(title, date, synopsis);

      const action = document.createElement("a");
      action.className = "volume-action";
      if (index === 0) {
        action.classList.add("is-primary");
        action.textContent = "Continue Reading";
      } else {
        action.textContent = "Start Reading";
      }
      action.href = buildReaderUrl(item, volume);
      action.setAttribute("aria-label", `Read ${volume.title}`);

      volumeRow.append(volumeCover, textWrap, action);
      elements.volumeList.appendChild(volumeRow);
    });
  }

  if (volumes[0]) {
    elements.startReadingBtn.href = buildReaderUrl(item, volumes[0]);
    elements.startReadingBtn.setAttribute("aria-disabled", "false");
  } else {
    elements.startReadingBtn.href = "#";
    elements.startReadingBtn.setAttribute("aria-disabled", "true");
  }

  if (elements.addLibraryBtn) {
    const alreadyAdded = Boolean(item.inUserLibrary);
    elements.addLibraryBtn.disabled = alreadyAdded;
    elements.addLibraryBtn.textContent = alreadyAdded ? "Added" : "Add to Library";
    elements.addLibraryBtn.onclick = async () => {
      if (alreadyAdded) {
        return;
      }
      const originalLabel = elements.addLibraryBtn.textContent;
      elements.addLibraryBtn.disabled = true;
      elements.addLibraryBtn.textContent = "Adding...";
      try {
        await addToUserLibrary(item.id);
        elements.addLibraryBtn.textContent = "Added";
      } catch (error) {
        elements.addLibraryBtn.disabled = false;
        elements.addLibraryBtn.textContent = originalLabel;
        showError(`Could not add manga to your library. ${error.message}`);
      }
    };
  }

  elements.mangaLayout.classList.remove("hidden");
}

async function loadMangaPageModel(mangaId) {
  const mangaUrl = new URL(endpoint.mangaGet);
  mangaUrl.searchParams.set("manga_id", mangaId);
  const [mangaResponse, genreNameById] = await Promise.all([
    requestJson(mangaUrl.toString(), { method: "GET" }),
    fetchLookupMap(endpoint.genreGet, "genre_id"),
  ]);
  const parent = normalizeParentManga(responseData(mangaResponse));
  if (!parent.id) {
    throw new Error(`Could not find manga id "${mangaId}".`);
  }
  parent.categories = ["Manga"];
  parent.genres = parent.genreIds.map((id) => genreNameById.get(id) || id);

  const contentUrl = new URL(endpoint.mangaContentGet);
  contentUrl.searchParams.set("manga_id", mangaId);
  const contentResponse = await requestJson(contentUrl.toString(), { method: "GET" });
  const contentData = responseData(contentResponse);
  const childItems = Array.isArray(contentData?.items) ? contentData.items : [];
  const volumes = normalizeVolumes(parent, childItems);

  const firstChildAuthor = volumes.length
    ? String(childItems[0]?.author || "").trim()
    : "";
  const moreLikeItems = await fetchMoreLikeThis(parent.id, parent.genreIds, genreNameById);

  return {
    ...parent,
    author: parent.author || firstChildAuthor || "Unknown",
    volumes,
    moreLikeItems,
  };
}

async function init() {
  wireAccountMenu();
  const mangaId = String(new URLSearchParams(window.location.search).get("manga") || "").trim();
  if (!mangaId) {
    showError('Missing "manga" query parameter. Open from the library page.');
    return;
  }

  try {
    if (!endpointLooksConfigured(endpoint.mangaGet)) {
      throw new Error("Manga endpoint is not configured.");
    }
    if (!endpointLooksConfigured(endpoint.genreGet)) {
      throw new Error("Genre endpoint is not configured.");
    }
    if (!endpointLooksConfigured(endpoint.mangaContentGet)) {
      throw new Error("Manga content endpoint is not configured.");
    }

    const model = await loadMangaPageModel(mangaId);
    hideError();
    render(model);
  } catch (error) {
    showError(`Could not load manga details. ${error.message}`);
    console.error(error);
  }
}

void init();
