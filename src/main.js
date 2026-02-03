// Clockr - Time Tracking App with SQLite Database
import Database from '@tauri-apps/plugin-sql';

// Workspace accent colors
const WORKSPACE_COLORS = [
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
  '#f97316', // orange
];

// Database instance
let db = null;

// State
let state = {
  workspaceCount: 1,
  activeWorkspace: null,
  timers: {},
  entries: {},
  workspaceNames: {}
};

let timerInterval = null;

// Initialize database
async function initDatabase() {
  db = await Database.load('sqlite:clockr.db');
  
  // Create tables if they don't exist
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      description TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  
  // Create index for faster queries
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_entries_workspace ON entries(workspace_id)
  `);
  
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_entries_start_time ON entries(start_time)
  `);
}

// Initialize workspace state
function initWorkspaceState(count) {
  for (let i = 1; i <= count; i++) {
    if (!state.timers[i]) {
      state.timers[i] = { startTime: null, elapsed: 0 };
    }
    if (!state.entries[i]) {
      state.entries[i] = [];
    }
    if (!state.workspaceNames[i]) {
      state.workspaceNames[i] = `Workspace ${i}`;
    }
  }
}

// Load state from database
async function loadState() {
  // Load workspace count setting
  const countResult = await db.select("SELECT value FROM settings WHERE key = 'workspace_count'");
  if (countResult.length > 0) {
    state.workspaceCount = parseInt(countResult[0].value) || 1;
  }
  
  // Load workspace names
  const workspaces = await db.select("SELECT id, name FROM workspaces ORDER BY id");
  for (const ws of workspaces) {
    state.workspaceNames[ws.id] = ws.name;
  }
  
  // Initialize workspace state
  initWorkspaceState(state.workspaceCount);
  
  // Ensure workspaces exist in database
  for (let i = 1; i <= state.workspaceCount; i++) {
    const existing = await db.select("SELECT id FROM workspaces WHERE id = ?", [i]);
    if (existing.length === 0) {
      await db.execute("INSERT INTO workspaces (id, name) VALUES (?, ?)", [i, state.workspaceNames[i]]);
    }
  }
  
  // Load entries for each workspace
  for (let i = 1; i <= state.workspaceCount; i++) {
    const entries = await db.select(
      "SELECT id, start_time, end_time, duration, description FROM entries WHERE workspace_id = ? ORDER BY start_time DESC",
      [i]
    );
    state.entries[i] = entries.map(e => ({
      id: e.id,
      startTime: e.start_time,
      endTime: e.end_time,
      duration: e.duration,
      description: e.description || "No description"
    }));
  }
  
  // Update workspace count selector
  const selector = document.getElementById("workspace-count");
  if (selector) {
    selector.value = state.workspaceCount.toString();
  }
}

// Save workspace count setting
async function saveWorkspaceCount() {
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_count', ?)",
    [state.workspaceCount.toString()]
  );
}

// Save workspace name
async function saveWorkspaceName(workspaceId, name) {
  await db.execute(
    "INSERT OR REPLACE INTO workspaces (id, name) VALUES (?, ?)",
    [workspaceId, name]
  );
}

// Add entry to database
async function addEntry(workspaceId, entry) {
  const result = await db.execute(
    "INSERT INTO entries (workspace_id, start_time, end_time, duration, description) VALUES (?, ?, ?, ?, ?)",
    [workspaceId, entry.startTime, entry.endTime, entry.duration, entry.description]
  );
  return result.lastInsertId;
}

// Update entry in database
async function updateEntry(entryId, description) {
  await db.execute(
    "UPDATE entries SET description = ? WHERE id = ?",
    [description, entryId]
  );
}

// Delete entry from database
async function deleteEntryFromDb(entryId) {
  await db.execute("DELETE FROM entries WHERE id = ?", [entryId]);
}

// Clear all entries from database
async function clearAllEntries() {
  await db.execute("DELETE FROM entries");
}

// Format time as HH:MM:SS
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return [hours, minutes, seconds]
    .map(n => n.toString().padStart(2, "0"))
    .join(":");
}

// Format date for display
function formatDate(date) {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

// Format date for CSV
function formatDateCSV(date) {
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

// Format time for CSV
function formatTimeCSV(date) {
  const d = new Date(date);
  return d.toTimeString().split(" ")[0];
}

// Update timer display
function updateTimerDisplay(workspace) {
  const timer = state.timers[workspace];
  const display = document.getElementById(`timer${workspace}`);
  if (!display) return;
  
  let elapsed = timer.elapsed;
  if (timer.startTime) {
    elapsed += Date.now() - timer.startTime;
  }
  
  display.textContent = formatTime(elapsed);
}

// Update total time display
function updateTotalTime() {
  const today = new Date().toDateString();
  let total = 0;
  
  // Add completed entries from today
  for (let i = 1; i <= state.workspaceCount; i++) {
    if (state.entries[i]) {
      state.entries[i].forEach(entry => {
        if (new Date(entry.startTime).toDateString() === today) {
          total += entry.duration;
        }
      });
    }
    
    // Add current timer if running
    if (state.activeWorkspace === i && state.timers[i]) {
      const timer = state.timers[i];
      total += timer.elapsed + (timer.startTime ? Date.now() - timer.startTime : 0);
    }
  }
  
  document.getElementById("total-time").textContent = formatTime(total);
}

// Create workspace HTML
function createWorkspaceHTML(workspaceId) {
  const color = WORKSPACE_COLORS[(workspaceId - 1) % WORKSPACE_COLORS.length];
  const name = state.workspaceNames[workspaceId] || `Workspace ${workspaceId}`;
  
  return `
    <div class="workspace" data-workspace="${workspaceId}" style="--workspace-accent: ${color}">
      <div class="workspace-header">
        <input type="text" class="workspace-name" id="workspace${workspaceId}-name" value="${escapeHtml(name)}" />
      </div>
      <div class="timer-display" id="timer${workspaceId}">00:00:00</div>
      <div class="timer-controls">
        <button class="btn btn-primary start-btn" data-workspace="${workspaceId}">Start</button>
        <button class="btn btn-secondary stop-btn" data-workspace="${workspaceId}" disabled>Stop</button>
      </div>
      <div class="description-input">
        <input type="text" id="desc${workspaceId}" placeholder="What are you working on?" />
      </div>
      <div class="entries-section">
        <h3>Time Entries</h3>
        <div class="entries-list" id="entries${workspaceId}"></div>
      </div>
    </div>
  `;
}

// Render all workspaces
function renderWorkspaces() {
  const container = document.getElementById("workspaces-container");
  let html = "";
  
  for (let i = 1; i <= state.workspaceCount; i++) {
    if (i > 1) {
      html += '<div class="divider"></div>';
    }
    html += createWorkspaceHTML(i);
  }
  
  container.innerHTML = html;
  
  // Attach event listeners
  attachWorkspaceListeners();
  
  // Render entries for each workspace
  for (let i = 1; i <= state.workspaceCount; i++) {
    renderEntries(i);
    updateTimerDisplay(i);
  }
}

// Attach event listeners to workspaces
function attachWorkspaceListeners() {
  // Start/Stop buttons
  document.querySelectorAll(".start-btn").forEach(btn => {
    btn.addEventListener("click", () => startTimer(parseInt(btn.dataset.workspace)));
  });
  
  document.querySelectorAll(".stop-btn").forEach(btn => {
    btn.addEventListener("click", () => stopTimer(parseInt(btn.dataset.workspace)));
  });
  
  // Workspace name changes
  for (let i = 1; i <= state.workspaceCount; i++) {
    const nameInput = document.getElementById(`workspace${i}-name`);
    if (nameInput) {
      nameInput.addEventListener("change", async (e) => {
        const newName = e.target.value.trim() || `Workspace ${i}`;
        state.workspaceNames[i] = newName;
        await saveWorkspaceName(i, newName);
      });
    }
  }
}

// Start timer
function startTimer(workspace) {
  // Stop other workspace if running
  if (state.activeWorkspace !== null && state.activeWorkspace !== workspace) {
    stopTimer(state.activeWorkspace);
  }
  
  state.activeWorkspace = workspace;
  state.timers[workspace].startTime = Date.now();
  
  // Update UI
  document.querySelectorAll(".workspace").forEach(ws => ws.classList.remove("active"));
  document.querySelector(`.workspace[data-workspace="${workspace}"]`).classList.add("active");
  
  document.querySelector(`.start-btn[data-workspace="${workspace}"]`).disabled = true;
  document.querySelector(`.stop-btn[data-workspace="${workspace}"]`).disabled = false;
  
  // Start interval for updating display
  if (!timerInterval) {
    timerInterval = setInterval(() => {
      if (state.activeWorkspace) {
        updateTimerDisplay(state.activeWorkspace);
        updateTotalTime();
      }
    }, 100);
  }
}

// Stop timer
async function stopTimer(workspace) {
  const timer = state.timers[workspace];
  
  if (timer.startTime) {
    const duration = timer.elapsed + (Date.now() - timer.startTime);
    const descInput = document.getElementById(`desc${workspace}`);
    const description = descInput ? descInput.value.trim() : "";
    
    // Create entry
    const entry = {
      startTime: new Date(timer.startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: duration,
      description: description || "No description"
    };
    
    // Save to database
    const entryId = await addEntry(workspace, entry);
    entry.id = entryId;
    
    if (!state.entries[workspace]) {
      state.entries[workspace] = [];
    }
    state.entries[workspace].unshift(entry);
    renderEntries(workspace);
    
    // Clear description
    if (descInput) {
      descInput.value = "";
    }
  }
  
  // Reset timer
  timer.startTime = null;
  timer.elapsed = 0;
  updateTimerDisplay(workspace);
  
  // Update UI
  const workspaceEl = document.querySelector(`.workspace[data-workspace="${workspace}"]`);
  if (workspaceEl) {
    workspaceEl.classList.remove("active");
  }
  
  const startBtn = document.querySelector(`.start-btn[data-workspace="${workspace}"]`);
  const stopBtn = document.querySelector(`.stop-btn[data-workspace="${workspace}"]`);
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  
  if (state.activeWorkspace === workspace) {
    state.activeWorkspace = null;
  }
  
  // Stop interval if no timer running
  if (state.activeWorkspace === null && timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  updateTotalTime();
}

// Render entries for a workspace
function renderEntries(workspace) {
  const container = document.getElementById(`entries${workspace}`);
  if (!container) return;
  
  const entries = state.entries[workspace] || [];
  
  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No time entries yet</div>';
    return;
  }
  
  container.innerHTML = entries.map(entry => `
    <div class="entry" data-id="${entry.id}">
      <div class="entry-info">
        <div class="entry-description">${escapeHtml(entry.description)}</div>
        <div class="entry-time">${formatDate(entry.startTime)}</div>
      </div>
      <div class="entry-duration">${formatTime(entry.duration)}</div>
      <div class="entry-actions">
        <button class="entry-action-btn edit" title="Edit" data-workspace="${workspace}" data-id="${entry.id}">
          ✏️
        </button>
        <button class="entry-action-btn delete" title="Delete" data-workspace="${workspace}" data-id="${entry.id}">
          🗑️
        </button>
      </div>
    </div>
  `).join("");
  
  // Add event listeners for entry actions
  container.querySelectorAll(".edit").forEach(btn => {
    btn.addEventListener("click", () => editEntry(btn.dataset.workspace, parseInt(btn.dataset.id)));
  });
  
  container.querySelectorAll(".delete").forEach(btn => {
    btn.addEventListener("click", () => deleteEntry(btn.dataset.workspace, parseInt(btn.dataset.id)));
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Edit entry - inline editing
function editEntry(workspace, id) {
  const workspaceNum = parseInt(workspace);
  const entries = state.entries[workspaceNum];
  if (!entries) return;
  
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  
  const entryEl = document.querySelector(`.entry[data-id="${id}"]`);
  if (!entryEl) return;
  
  const descEl = entryEl.querySelector(".entry-description");
  if (!descEl) return;
  
  // Replace description with input
  const currentText = entry.description;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "entry-edit-input";
  input.value = currentText;
  
  descEl.innerHTML = "";
  descEl.appendChild(input);
  input.focus();
  input.select();
  
  const saveEdit = async () => {
    const newValue = input.value.trim() || "No description";
    entry.description = newValue;
    await updateEntry(id, newValue);
    renderEntries(workspaceNum);
  };
  
  input.addEventListener("blur", saveEdit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      input.value = currentText;
      input.blur();
    }
  });
}

// Delete entry
async function deleteEntry(workspace, id) {
  const workspaceNum = parseInt(workspace);
  
  const entryEl = document.querySelector(`.entry[data-id="${id}"]`);
  if (!entryEl) return;
  
  // Check if already showing delete confirm
  if (entryEl.classList.contains("confirm-delete")) {
    // Actually delete from database
    await deleteEntryFromDb(id);
    state.entries[workspaceNum] = (state.entries[workspaceNum] || []).filter(e => e.id !== id);
    renderEntries(workspaceNum);
    updateTotalTime();
  } else {
    // Show confirm state
    entryEl.classList.add("confirm-delete");
    const deleteBtn = entryEl.querySelector(".delete");
    if (deleteBtn) {
      deleteBtn.textContent = "✓";
      deleteBtn.title = "Click again to confirm";
    }
    
    // Add cancel button
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "entry-action-btn cancel";
    cancelBtn.textContent = "✕";
    cancelBtn.title = "Cancel";
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      renderEntries(workspaceNum);
    });
    
    const actionsEl = entryEl.querySelector(".entry-actions");
    if (actionsEl) {
      actionsEl.appendChild(cancelBtn);
    }
  }
}

// Export to CSV
function exportToCSV() {
  const allEntries = [];
  
  for (let i = 1; i <= state.workspaceCount; i++) {
    if (state.entries[i]) {
      state.entries[i].forEach(entry => {
        allEntries.push({
          workspace: state.workspaceNames[i] || `Workspace ${i}`,
          date: formatDateCSV(entry.startTime),
          startTime: formatTimeCSV(entry.startTime),
          endTime: formatTimeCSV(entry.endTime),
          duration: formatTime(entry.duration),
          durationSeconds: Math.floor(entry.duration / 1000),
          description: entry.description
        });
      });
    }
  }
  
  // Sort by date and time
  allEntries.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return b.startTime.localeCompare(a.startTime);
  });
  
  if (allEntries.length === 0) {
    alert("No entries to export");
    return;
  }
  
  // Create CSV
  const headers = ["Workspace", "Date", "Start Time", "End Time", "Duration", "Duration (seconds)", "Description"];
  const rows = allEntries.map(e => [
    `"${e.workspace}"`,
    e.date,
    e.startTime,
    e.endTime,
    e.duration,
    e.durationSeconds,
    `"${e.description.replace(/"/g, '""')}"`
  ].join(","));
  
  const csv = [headers.join(","), ...rows].join("\n");
  
  // Download
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clockr-export-${formatDateCSV(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Clear all data
async function clearAll() {
  // Stop any running timer
  if (state.activeWorkspace) {
    const timer = state.timers[state.activeWorkspace];
    timer.startTime = null;
    timer.elapsed = 0;
    const workspaceEl = document.querySelector(`.workspace[data-workspace="${state.activeWorkspace}"]`);
    if (workspaceEl) workspaceEl.classList.remove("active");
    
    const startBtn = document.querySelector(`.start-btn[data-workspace="${state.activeWorkspace}"]`);
    const stopBtn = document.querySelector(`.stop-btn[data-workspace="${state.activeWorkspace}"]`);
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    
    state.activeWorkspace = null;
  }
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  // Clear entries from database
  await clearAllEntries();
  
  // Clear local state
  for (let i = 1; i <= state.workspaceCount; i++) {
    state.entries[i] = [];
    state.timers[i] = { startTime: null, elapsed: 0 };
  }
  
  for (let i = 1; i <= state.workspaceCount; i++) {
    renderEntries(i);
    updateTimerDisplay(i);
  }
  updateTotalTime();
}

// Change workspace count
async function changeWorkspaceCount(newCount) {
  // Stop any running timer first
  if (state.activeWorkspace) {
    await stopTimer(state.activeWorkspace);
  }
  
  state.workspaceCount = newCount;
  initWorkspaceState(newCount);
  
  // Ensure new workspaces exist in database
  for (let i = 1; i <= newCount; i++) {
    const existing = await db.select("SELECT id FROM workspaces WHERE id = ?", [i]);
    if (existing.length === 0) {
      await db.execute("INSERT INTO workspaces (id, name) VALUES (?, ?)", [i, state.workspaceNames[i]]);
    }
    
    // Load entries for new workspaces
    if (!state.entries[i] || state.entries[i].length === 0) {
      const entries = await db.select(
        "SELECT id, start_time, end_time, duration, description FROM entries WHERE workspace_id = ? ORDER BY start_time DESC",
        [i]
      );
      state.entries[i] = entries.map(e => ({
        id: e.id,
        startTime: e.start_time,
        endTime: e.end_time,
        duration: e.duration,
        description: e.description || "No description"
      }));
    }
  }
  
  await saveWorkspaceCount();
  renderWorkspaces();
  updateTotalTime();
}

// Current view state
let currentView = 'timer';
let recordsFilter = { workspace: 'all', date: 'all' };

// Switch view
function switchView(view) {
  currentView = view;
  
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  
  // Update view visibility
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `${view}-view`);
  });
  
  // Show/hide workspace control (only in timer view)
  const workspaceControl = document.getElementById('workspace-control');
  if (workspaceControl) {
    workspaceControl.style.display = view === 'timer' ? 'flex' : 'none';
  }
  
  // Show/hide clear button (only in timer view)
  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) {
    clearBtn.style.display = view === 'timer' ? 'inline-block' : 'none';
  }
  
  // Load records when switching to records view
  if (view === 'records') {
    loadRecordsView();
  }
}

// Load all records from database
async function loadAllRecords() {
  const records = await db.select(`
    SELECT e.id, e.workspace_id, e.start_time, e.end_time, e.duration, e.description, w.name as workspace_name
    FROM entries e
    LEFT JOIN workspaces w ON e.workspace_id = w.id
    ORDER BY e.start_time DESC
  `);
  
  return records.map(r => ({
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name || `Workspace ${r.workspace_id}`,
    startTime: r.start_time,
    endTime: r.end_time,
    duration: r.duration,
    description: r.description || 'No description'
  }));
}

// Filter records based on current filter
function filterRecords(records) {
  let filtered = [...records];
  
  // Filter by workspace
  if (recordsFilter.workspace !== 'all') {
    const wsId = parseInt(recordsFilter.workspace);
    filtered = filtered.filter(r => r.workspaceId === wsId);
  }
  
  // Filter by date
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  if (recordsFilter.date === 'today') {
    filtered = filtered.filter(r => new Date(r.startTime) >= today);
  } else if (recordsFilter.date === 'week') {
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    filtered = filtered.filter(r => new Date(r.startTime) >= weekAgo);
  } else if (recordsFilter.date === 'month') {
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    filtered = filtered.filter(r => new Date(r.startTime) >= monthAgo);
  }
  
  return filtered;
}

// Load records view
async function loadRecordsView() {
  // Update workspace filter options
  const wsFilter = document.getElementById('filter-workspace');
  wsFilter.innerHTML = '<option value="all">All</option>';
  for (let i = 1; i <= state.workspaceCount; i++) {
    const name = state.workspaceNames[i] || `Workspace ${i}`;
    wsFilter.innerHTML += `<option value="${i}">${escapeHtml(name)}</option>`;
  }
  wsFilter.value = recordsFilter.workspace;
  
  // Load and filter records
  const allRecords = await loadAllRecords();
  const filtered = filterRecords(allRecords);
  
  // Update summary
  const totalEntries = filtered.length;
  const totalDuration = filtered.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalEntries > 0 ? totalDuration / totalEntries : 0;
  
  document.getElementById('total-entries').textContent = totalEntries;
  document.getElementById('total-duration').textContent = formatTime(totalDuration);
  document.getElementById('avg-duration').textContent = formatTime(avgDuration);
  
  // Render table
  renderRecordsTable(filtered);
}

// Render records table
function renderRecordsTable(records) {
  const tbody = document.getElementById('records-tbody');
  const emptyState = document.getElementById('records-empty');
  const tableWrapper = document.querySelector('.records-table-wrapper');
  
  if (records.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'flex';
    tableWrapper.style.display = 'none';
    return;
  }
  
  emptyState.style.display = 'none';
  tableWrapper.style.display = 'block';
  
  tbody.innerHTML = records.map(record => {
    const startDate = new Date(record.startTime);
    const endDate = new Date(record.endTime);
    const color = WORKSPACE_COLORS[(record.workspaceId - 1) % WORKSPACE_COLORS.length];
    
    return `
      <tr data-id="${record.id}" data-workspace="${record.workspaceId}">
        <td>${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td><span class="workspace-badge" style="background-color: ${color}20; color: ${color}">${escapeHtml(record.workspaceName)}</span></td>
        <td>${startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</td>
        <td>${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</td>
        <td class="duration-cell">${formatTime(record.duration)}</td>
        <td class="description-cell" title="${escapeHtml(record.description)}">${escapeHtml(record.description)}</td>
        <td class="actions-cell">
          <button class="action-btn edit-record" title="Edit" data-id="${record.id}">✏️</button>
          <button class="action-btn delete delete-record" title="Delete" data-id="${record.id}" data-workspace="${record.workspaceId}">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
  
  // Attach event listeners
  tbody.querySelectorAll('.edit-record').forEach(btn => {
    btn.addEventListener('click', () => editRecordInTable(parseInt(btn.dataset.id)));
  });
  
  tbody.querySelectorAll('.delete-record').forEach(btn => {
    btn.addEventListener('click', () => deleteRecordFromTable(parseInt(btn.dataset.id), parseInt(btn.dataset.workspace)));
  });
}

// Edit record from table
async function editRecordInTable(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;
  
  const descCell = row.querySelector('.description-cell');
  const currentText = descCell.textContent;
  
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'entry-edit-input';
  input.value = currentText;
  input.style.width = '100%';
  
  descCell.innerHTML = '';
  descCell.appendChild(input);
  input.focus();
  input.select();
  
  const saveEdit = async () => {
    const newValue = input.value.trim() || 'No description';
    await updateEntry(id, newValue);
    
    // Update local state
    for (let i = 1; i <= state.workspaceCount; i++) {
      const entry = state.entries[i]?.find(e => e.id === id);
      if (entry) {
        entry.description = newValue;
        break;
      }
    }
    
    await loadRecordsView();
  };
  
  input.addEventListener('blur', saveEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = currentText;
      input.blur();
    }
  });
}

// Delete record from table
async function deleteRecordFromTable(id, workspaceId) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;
  
  if (row.classList.contains('confirm-delete')) {
    await deleteEntryFromDb(id);
    state.entries[workspaceId] = (state.entries[workspaceId] || []).filter(e => e.id !== id);
    await loadRecordsView();
    updateTotalTime();
  } else {
    row.classList.add('confirm-delete');
    row.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
    const deleteBtn = row.querySelector('.delete-record');
    if (deleteBtn) {
      deleteBtn.textContent = '✓';
      deleteBtn.title = 'Click again to confirm';
    }
    
    // Auto-reset after 3 seconds
    setTimeout(() => {
      if (row.classList.contains('confirm-delete')) {
        row.classList.remove('confirm-delete');
        row.style.backgroundColor = '';
        if (deleteBtn) {
          deleteBtn.textContent = '🗑️';
          deleteBtn.title = 'Delete';
        }
      }
    }, 3000);
  }
}

// Initialize
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await initDatabase();
    await loadState();
    renderWorkspaces();
    updateTotalTime();
    
    // View tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    
    // Records filters
    document.getElementById('filter-workspace').addEventListener('change', (e) => {
      recordsFilter.workspace = e.target.value;
      loadRecordsView();
    });
    
    document.getElementById('filter-date').addEventListener('change', (e) => {
      recordsFilter.date = e.target.value;
      loadRecordsView();
    });
    
    // Workspace count selector
    document.getElementById("workspace-count").addEventListener("change", async (e) => {
      await changeWorkspaceCount(parseInt(e.target.value));
    });
    
    // Export button
    document.getElementById("export-btn").addEventListener("click", exportToCSV);
    
    // Clear button - two-click confirmation
    const clearBtn = document.getElementById("clear-btn");
    let clearConfirm = false;
    clearBtn.addEventListener("click", async () => {
      if (clearConfirm) {
        await clearAll();
        clearBtn.textContent = "Clear All";
        clearBtn.classList.remove("confirming");
        clearConfirm = false;
        // Refresh records view if active
        if (currentView === 'records') {
          await loadRecordsView();
        }
      } else {
        clearBtn.textContent = "Confirm Clear?";
        clearBtn.classList.add("confirming");
        clearConfirm = true;
        setTimeout(() => {
          if (clearConfirm) {
            clearBtn.textContent = "Clear All";
            clearBtn.classList.remove("confirming");
            clearConfirm = false;
          }
        }, 3000);
      }
    });
    
    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Only in timer view
      if (currentView !== 'timer') return;
      
      // Press 1-4 to toggle workspace timers
      const num = parseInt(e.key);
      if (num >= 1 && num <= 4 && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== "INPUT") {
        if (num <= state.workspaceCount) {
          if (state.activeWorkspace === num) {
            stopTimer(num);
          } else {
            startTimer(num);
          }
        }
      }
      
      // Press Space to stop current timer
      if (e.key === " " && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        if (state.activeWorkspace) {
          stopTimer(state.activeWorkspace);
        }
      }
    });
  } catch (error) {
    console.error("Failed to initialize database:", error);
    document.body.innerHTML = `<div style="padding: 2rem; color: #ef4444;">
      <h2>Database Error</h2>
      <p>${error.message}</p>
    </div>`;
  }
});
