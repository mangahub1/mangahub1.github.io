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
  categoryGet:
    String(appAuthzConfig?.getCategoryEndpoint || "").trim() || endpointFromMangaBase("/category"),
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
  mangaDescription: document.getElementById("mangaDescription"),
  metaAuthor: document.getElementById("metaAuthor"),
  metaCategories: document.getElementById("metaCategories"),
  metaGenres: document.getElementById("metaGenres"),
  metaAge: document.getElementById("metaAge"),
  metaStatus: document.getElementById("metaStatus"),
  metaRating: document.getElementById("metaRating"),
  volumeList: document.getElementById("volumeList"),
  startReadingBtn: document.getElementById("startReadingBtn"),
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
    categories: [],
    genres: [],
    author: String(item?.publisher || "").trim(),
  };
}

function buildReaderUrl(item, volume) {
  const url = new URL("../library.html", window.location.href);
  url.searchParams.set("manga", item.id);
  if (volume?.contentKey) {
    url.searchParams.set("content_key", volume.contentKey);
  }
  return url.toString();
}

function render(item) {
  const categories = Array.isArray(item.categories) ? item.categories : [];
  const genres = Array.isArray(item.genres) ? item.genres : [];
  const paragraphs = normalizeParagraphs(item);
  const volumes = Array.isArray(item.volumes) ? item.volumes : [];

  elements.mangaTitle.textContent = item.title || "Untitled Manga";
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
  elements.metaStatus.textContent = item.status || "Ongoing";
  elements.metaRating.textContent = "N/A";

  elements.metaCategories.innerHTML = "";
  (categories.length ? categories : ["Uncategorized"]).forEach((category) => {
    const chip = document.createElement("span");
    chip.className = "genre-chip";
    chip.textContent = category;
    elements.metaCategories.appendChild(chip);
  });

  elements.metaGenres.innerHTML = "";
  (genres.length ? genres : ["Manga"]).forEach((genre) => {
    const chip = document.createElement("span");
    chip.className = "genre-chip";
    chip.textContent = genre;
    elements.metaGenres.appendChild(chip);
  });

  elements.volumeList.innerHTML = "";
  if (!volumes.length) {
    const empty = document.createElement("div");
    empty.className = "volume-item";
    empty.textContent = "No volumes available yet.";
    elements.volumeList.appendChild(empty);
  } else {
    volumes.forEach((volume) => {
      const itemLink = document.createElement("a");
      itemLink.className = "volume-item";
      itemLink.href = buildReaderUrl(item, volume);
      itemLink.setAttribute("aria-label", `Open ${volume.title}`);

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
      date.textContent = volume.date || "Available";
      const synopsis = document.createElement("p");
      synopsis.className = "volume-synopsis";
      synopsis.textContent = volume.synopsis || "Synopsis coming soon.";
      textWrap.append(title, date, synopsis);

      itemLink.append(volumeCover, textWrap);
      elements.volumeList.appendChild(itemLink);
    });
  }

  if (volumes[0]) {
    elements.startReadingBtn.href = buildReaderUrl(item, volumes[0]);
    elements.startReadingBtn.setAttribute("aria-disabled", "false");
  } else {
    elements.startReadingBtn.href = "#";
    elements.startReadingBtn.setAttribute("aria-disabled", "true");
  }

  elements.mangaLayout.classList.remove("hidden");
}

async function loadMangaPageModel(mangaId) {
  const mangaUrl = new URL(endpoint.mangaGet);
  mangaUrl.searchParams.set("manga_id", mangaId);
  const [mangaResponse, categoryNameById, genreNameById] = await Promise.all([
    requestJson(mangaUrl.toString(), { method: "GET" }),
    fetchLookupMap(endpoint.categoryGet, "category_id"),
    fetchLookupMap(endpoint.genreGet, "genre_id"),
  ]);
  const parent = normalizeParentManga(responseData(mangaResponse));
  if (!parent.id) {
    throw new Error(`Could not find manga id "${mangaId}".`);
  }
  parent.categories = parent.categoryIds.map((id) => categoryNameById.get(id) || id);
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

  return {
    ...parent,
    author: parent.author || firstChildAuthor || "Unknown",
    volumes,
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
    if (!endpointLooksConfigured(endpoint.categoryGet)) {
      throw new Error("Category endpoint is not configured.");
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
