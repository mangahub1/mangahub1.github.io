# BluPetal Prototype

Flow:
- `index.html`: BluPetal landing page with a `Log In` button.
- `login.html`: mock Google account chooser.
- `library.html`: manga library shelves.
- `manga.html`: manga detail page (cover, description, metadata, volume list).
- `library.html?manga=<id>`: PDF reader experience.

1) Put PDF files into `/pdfs/`.
2) Update `content.json` with one entry per manga:
   - `id`: unique key used in URL query (`?manga=<id>`)
   - `title`: display title for library tile
   - `pdf`: relative path to the PDF
   - `thumbnail`: relative path to cover image (placeholders are in `/assets/thumbnails/`)
   - `genres`: array shown under the title (for example `["Boys' Love", "Drama"]`)
   - `groups`: array of section ids so a manga can appear in multiple shelves
   - optional `author`, `ageRating`, `status`, `rating`, `ratingCount`
   - optional `longDescription`: array of paragraph strings for the manga detail page
   - optional `volumes`: list of `{id,title,date,pdf}` for the volume picker
   - optional top-level `sections`: ordered section definitions (`id`, `title`)
3) Start a local server from this folder:
   `python -m http.server 5173`
4) Open:
   `http://localhost:5173` (landing page)
5) Click `Log In` then click `bobsmith@gmail.com` to enter the library.
6) Go directly to library if needed:
   `http://localhost:5173/library.html`

Notes:
- Auth is mocked for now; `Log In` -> `login.html` -> `library.html`.
- Reader state is shareable via `library.html?manga=<id>`.
- Workflow is now: Library tile -> `manga.html?manga=<id>` -> select volume -> reader.

