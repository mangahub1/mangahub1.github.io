import { adminApiConfigLooksReady, appAuthzConfig } from "./auth-config.js";
import { clearAuthSession, getAuthSession, isJwtExpired } from "./auth-session.js";

const state = {
  users: [],
  filteredUsers: [],
  session: null,
  busy: false,
};

const elements = {
  error: document.getElementById("adminError"),
  success: document.getElementById("adminSuccess"),
  statusFilter: document.getElementById("statusFilter"),
  searchInput: document.getElementById("searchInput"),
  refreshBtn: document.getElementById("refreshBtn"),
  approveSelectedBtn: document.getElementById("approveSelectedBtn"),
  tableBody: document.getElementById("usersTableBody"),
  resultsCount: document.getElementById("resultsCount"),
  selectAll: document.getElementById("selectAll"),
  signoutLinks: document.querySelectorAll(".settings-item.signout"),
  accountAvatar: document.getElementById("accountAvatar"),
  welcomeMessage: document.getElementById("welcomeMessage"),
  accountIconSvg: document.querySelector(".settings-trigger .library-icon-svg"),
};

function redirectTo(path) {
  window.location.replace(path);
}

function showError(message) {
  if (!elements.error) {
    return;
  }
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

function clearError() {
  if (!elements.error) {
    return;
  }
  elements.error.textContent = "";
  elements.error.classList.add("hidden");
}

function showSuccess(message) {
  if (!elements.success) {
    return;
  }
  elements.success.textContent = message;
  elements.success.classList.remove("hidden");
  window.setTimeout(() => {
    elements.success?.classList.add("hidden");
  }, 2500);
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function statusLabel(status) {
  if (status === 1) {
    return "Approved";
  }
  if (status === 0) {
    return "Disabled";
  }
  return "Pending";
}

function statusClass(status) {
  if (status === 1) {
    return "approved";
  }
  if (status === 0) {
    return "disabled";
  }
  return "pending";
}

function ensureAdminSession() {
  const session = getAuthSession();
  if (!session) {
    redirectTo("./index.html");
    return null;
  }

  const idToken = String(session.idToken || "").trim();
  const accessToken = String(session.accessToken || "").trim();
  const email = String(session.email || "").trim();
  const status = normalizeNumber(session.status, 0);
  const isAdmin = Boolean(session.isAdmin || normalizeNumber(session.admin, 0) === 1);

  if (!idToken || !accessToken || !email || status !== 1 || isJwtExpired(idToken)) {
    clearAuthSession();
    redirectTo("./index.html");
    return null;
  }

  if (!isAdmin) {
    redirectTo("./library.html");
    return null;
  }

  state.session = session;
  return session;
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  elements.refreshBtn.disabled = nextBusy;
  elements.approveSelectedBtn.disabled = nextBusy;
}

function wireAccountIdentity() {
  const givenName = String(state.session?.givenName || "").trim();
  const image = String(state.session?.image || "").trim();

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

function getSelectedUserIds() {
  return Array.from(
    document.querySelectorAll('input[data-user-select="true"]:checked')
  ).map((input) => String(input.getAttribute("data-user-id") || "").trim()).filter(Boolean);
}

function updateSelectAllState() {
  const checkboxes = Array.from(document.querySelectorAll('input[data-user-select="true"]'));
  if (!checkboxes.length) {
    elements.selectAll.checked = false;
    elements.selectAll.indeterminate = false;
    return;
  }
  const checked = checkboxes.filter((box) => box.checked).length;
  elements.selectAll.checked = checked === checkboxes.length;
  elements.selectAll.indeterminate = checked > 0 && checked < checkboxes.length;
}

function applyFilters() {
  const statusFilter = String(elements.statusFilter.value || "").trim();
  const search = String(elements.searchInput.value || "").trim().toLowerCase();

  state.filteredUsers = state.users.filter((user) => {
    const userStatus = normalizeNumber(user.status, -1);
    if (statusFilter && userStatus !== normalizeNumber(statusFilter, -999)) {
      return false;
    }

    if (!search) {
      return true;
    }

    const name = String(user.name || "").toLowerCase();
    const email = String(user.email || "").toLowerCase();
    return name.includes(search) || email.includes(search);
  });

  renderUsers();
}

function renderUsers() {
  if (!elements.tableBody) {
    return;
  }

  elements.tableBody.innerHTML = "";
  elements.selectAll.checked = false;
  elements.selectAll.indeterminate = false;

  if (!state.filteredUsers.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "admin-grid-empty";
    cell.colSpan = 6;
    cell.textContent = "No users match the selected filters.";
    row.appendChild(cell);
    elements.tableBody.appendChild(row);
    elements.resultsCount.textContent = "0 users";
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filteredUsers.forEach((user) => {
    const userId = String(user.user_id || "").trim();
    const row = document.createElement("tr");

    const currentStatus = normalizeNumber(user.status, -1);
    const currentAdmin = normalizeNumber(user.admin, 0);

    row.innerHTML = `
      <td>
        <input type="checkbox" data-user-select="true" data-user-id="${userId}" aria-label="Select ${String(
      user.email || userId
    )}" />
      </td>
      <td>${String(user.name || "").trim() || "-"}</td>
      <td>${String(user.email || "").trim() || "-"}</td>
      <td>
        <div class="status-cell">
          <span class="status-chip ${statusClass(currentStatus)}">${statusLabel(currentStatus)}</span>
          <select class="status-edit" data-status-edit="${userId}" aria-label="Status for ${String(
      user.email || userId
    )}">
            <option value="-1" ${currentStatus === -1 ? "selected" : ""}>Pending</option>
            <option value="1" ${currentStatus === 1 ? "selected" : ""}>Approved</option>
            <option value="0" ${currentStatus === 0 ? "selected" : ""}>Disabled</option>
          </select>
        </div>
      </td>
      <td>
        <div class="admin-cell">
          <span>${currentAdmin === 1 ? "Yes" : "No"}</span>
          <select class="admin-edit" data-admin-edit="${userId}" aria-label="Admin for ${String(
      user.email || userId
    )}">
            <option value="0" ${currentAdmin === 0 ? "selected" : ""}>No</option>
            <option value="1" ${currentAdmin === 1 ? "selected" : ""}>Yes</option>
          </select>
        </div>
      </td>
      <td>
        <button type="button" class="row-save-btn" data-save-row="${userId}">Save</button>
      </td>
    `;
    fragment.appendChild(row);
  });

  elements.tableBody.appendChild(fragment);
  elements.resultsCount.textContent = `${state.filteredUsers.length} user${
    state.filteredUsers.length === 1 ? "" : "s"
  }`;

  elements.tableBody
    .querySelectorAll('input[data-user-select="true"]')
    .forEach((input) => input.addEventListener("change", updateSelectAllState));
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }

  if (!response.ok) {
    const message = body?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body;
}

async function fetchUsers() {
  if (!state.session) {
    return;
  }
  if (!adminApiConfigLooksReady()) {
    throw new Error("Admin API endpoints are not configured in auth-config.js.");
  }

  const data = await requestJson(appAuthzConfig.getUsersEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${state.session.accessToken}`,
    },
  });

  const users = Array.isArray(data?.users) ? data.users : [];
  state.users = users.map((user) => ({
    ...user,
    status: normalizeNumber(user.status, -1),
    admin: normalizeNumber(user.admin, 0),
  }));
}

async function updateUsers(payload) {
  if (!state.session) {
    return null;
  }
  return requestJson(appAuthzConfig.updateUserEndpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

async function refreshGrid() {
  clearError();
  setBusy(true);
  try {
    await fetchUsers();
    applyFilters();
  } finally {
    setBusy(false);
  }
}

async function handleBulkApprove() {
  const selectedUserIds = getSelectedUserIds();
  if (!selectedUserIds.length) {
    showError("Select at least one user to approve.");
    return;
  }

  clearError();
  setBusy(true);
  try {
    await updateUsers({ user_ids: selectedUserIds, status: 1 });
    showSuccess(`Approved ${selectedUserIds.length} selected account(s).`);
    await refreshGrid();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

async function handleRowSave(userId) {
  if (!userId) {
    return;
  }

  const statusInput = document.querySelector(`[data-status-edit="${userId}"]`);
  const adminInput = document.querySelector(`[data-admin-edit="${userId}"]`);
  const nextStatus = normalizeNumber(statusInput?.value, -1);
  const nextAdmin = normalizeNumber(adminInput?.value, 0);

  clearError();
  setBusy(true);
  try {
    await updateUsers({
      user_id: userId,
      status: nextStatus,
      admin: nextAdmin,
    });
    showSuccess("User updated.");
    await refreshGrid();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

function wireEvents() {
  elements.statusFilter.addEventListener("change", applyFilters);
  elements.searchInput.addEventListener("input", applyFilters);
  elements.refreshBtn.addEventListener("click", async () => {
    try {
      await refreshGrid();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });
  elements.approveSelectedBtn.addEventListener("click", () => {
    void handleBulkApprove();
  });
  elements.selectAll.addEventListener("change", () => {
    const checked = elements.selectAll.checked;
    document
      .querySelectorAll('input[data-user-select="true"]')
      .forEach((input) => {
        input.checked = checked;
      });
    updateSelectAllState();
  });

  elements.tableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const saveBtn = target.closest("[data-save-row]");
    if (!saveBtn) {
      return;
    }
    const userId = String(saveBtn.getAttribute("data-save-row") || "").trim();
    void handleRowSave(userId);
  });

  elements.signoutLinks.forEach((link) => {
    link.addEventListener("click", () => {
      clearAuthSession();
    });
  });
}

async function init() {
  if (!ensureAdminSession()) {
    return;
  }
  wireAccountIdentity();
  wireEvents();
  try {
    await refreshGrid();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

void init();
