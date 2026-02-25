const CONTENT_DATA_PATH = "./content.json";
const FALLBACK_THUMBNAIL = "./assets/thumbnails/placeholder.svg";

const elements = {
  mangaPage: document.getElementById("mangaPage"),
  mangaLayout: document.getElementById("mangaLayout"),
  mangaError: document.getElementById("mangaError"),
  mangaCover: document.getElementById("mangaCover"),
  mangaTitle: document.getElementById("mangaTitle"),
  mangaDescription: document.getElementById("mangaDescription"),
  metaAuthor: document.getElementById("metaAuthor"),
  metaGenres: document.getElementById("metaGenres"),
  metaAge: document.getElementById("metaAge"),
  metaStatus: document.getElementById("metaStatus"),
  metaRating: document.getElementById("metaRating"),
  volumeList: document.getElementById("volumeList"),
  startReadingBtn: document.getElementById("startReadingBtn"),
};

function showError(message) {
  elements.mangaError.textContent = message;
  elements.mangaError.classList.remove("hidden");
  elements.mangaLayout.classList.add("hidden");
}

function hideError() {
  elements.mangaError.textContent = "";
  elements.mangaError.classList.add("hidden");
}

function normalizeParagraphs(item) {
  if (Array.isArray(item.longDescription) && item.longDescription.length) {
    return item.longDescription.map((part) => String(part || "").trim()).filter(Boolean);
  }
  const text = String(item.description || "").trim();
  if (!text) {
    return ["Description coming soon."];
  }
  return text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function normalizeVolumes(item) {
  if (Array.isArray(item.volumes) && item.volumes.length) {
    return item.volumes.map((volume, index) => ({
      id: String(volume?.id || `v${index + 1}`),
      title: String(volume?.title || `Volume ${index + 1}`),
      date: String(volume?.date || ""),
      pdf: String(volume?.pdf || item.pdf),
    }));
  }

  const defaults = [
    "October 1, 2025",
    "November 5, 2025",
    "December 3, 2025",
    "January 7, 2026",
    "February 4, 2026",
    "March 4, 2026",
  ];

  return defaults.map((date, index) => ({
    id: `v${index + 1}`,
    title: `Volume ${index + 1}`,
    date,
    pdf: item.pdf,
  }));
}

function buildReaderUrl(item, volume) {
  const url = new URL("./library.html", window.location.href);
  url.searchParams.set("manga", item.id);
  if (volume?.id) {
    url.searchParams.set("volume", volume.id);
  }
  return url.toString();
}

function render(item) {
  const genres = Array.isArray(item.genres) ? item.genres : [];
  const paragraphs = normalizeParagraphs(item);
  const volumes = normalizeVolumes(item);

  elements.mangaTitle.textContent = item.title || "Untitled Manga";
  document.title = `${item.title || "Manga"} - BluPetal`;

  elements.mangaCover.src = item.thumbnail || FALLBACK_THUMBNAIL;
  elements.mangaCover.alt = `${item.title || "Manga"} cover`;
  elements.mangaCover.addEventListener("error", () => {
    elements.mangaCover.src = FALLBACK_THUMBNAIL;
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
  elements.metaRating.textContent =
    item.rating && item.ratingCount
      ? `${item.rating} (${item.ratingCount} reviews)`
      : item.rating
      ? String(item.rating)
      : "4.8";

  elements.metaGenres.innerHTML = "";
  (genres.length ? genres : ["Manga"]).forEach((genre) => {
    const chip = document.createElement("span");
    chip.className = "genre-chip";
    chip.textContent = genre;
    elements.metaGenres.appendChild(chip);
  });

  elements.volumeList.innerHTML = "";
  volumes.forEach((volume) => {
    const itemLink = document.createElement("a");
    itemLink.className = "volume-item";
    itemLink.href = buildReaderUrl(item, volume);
    itemLink.setAttribute("aria-label", `Open ${volume.title}`);

    const dot = document.createElement("span");
    dot.className = "volume-dot";

    const textWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "volume-label";
    title.textContent = volume.title;
    const date = document.createElement("div");
    date.className = "volume-date";
    date.textContent = volume.date || "Coming soon";
    textWrap.append(title, date);

    const chev = document.createElement("span");
    chev.className = "volume-chevron";
    chev.textContent = "⌄";

    itemLink.append(dot, textWrap, chev);
    elements.volumeList.appendChild(itemLink);
  });

  elements.startReadingBtn.href = buildReaderUrl(item, volumes[0] || null);
  elements.mangaLayout.classList.remove("hidden");
}

async function init() {
  const mangaId = new URLSearchParams(window.location.search).get("manga");
  if (!mangaId) {
    showError('Missing "manga" query parameter. Open from the library page.');
    return;
  }

  try {
    const response = await fetch(CONTENT_DATA_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const items = Array.isArray(data?.manga) ? data.manga : [];
    const item = items.find((entry) => String(entry?.id) === mangaId);
    if (!item) {
      throw new Error(`Could not find manga id "${mangaId}" in content.json.`);
    }

    hideError();
    render(item);
  } catch (error) {
    showError(`Could not load manga details. ${error.message}`);
    console.error(error);
  }
}

void init();
