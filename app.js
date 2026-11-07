const STORAGE_KEY = "daymark-data-v1";
const COLORS = [
  { name: "Fern", value: "#6b9b7f" },
  { name: "Ocean", value: "#668ead" },
  { name: "Amber", value: "#c79848" },
  { name: "Rose", value: "#c47772" },
  { name: "Lilac", value: "#9282b2" },
  { name: "Slate", value: "#77858b" },
];
const DEFAULT_SUBJECTS = ["General"];
const today = dateKey(new Date());
let state = loadState();
let monthCursor = new Date();
let selectedDates = [];
let selectionMode = false;
let editingTaskId = null;
let selectedColor = COLORS[0].value;
let activeView = "calendar-view";
let longPressTimer = null;
let suppressClickDate = null;
let suppressClickTimer = null;

const $ = (selector) => document.querySelector(selector);
const calendarGrid = $("#calendar-grid");
const taskDialog = $("#task-dialog");

function dateKey(date) {
  // Keep calendar dates local so timezone offsets cannot shift a selected day.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function loadState() {
  const fallback = { tasks: [], subjects: [...DEFAULT_SUBJECTS] };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || !Array.isArray(stored.tasks) || !Array.isArray(stored.subjects)) return fallback;
    return {
      tasks: stored.tasks.filter((task) => task && typeof task.id === "string" && Array.isArray(task.dates)),
      subjects: [...new Set(stored.subjects.filter((name) => typeof name === "string" && name.trim()))],
    };
  } catch (error) {
    console.error("Could not read saved plans:", error);
    return fallback;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $(".status-dot").style.background = "#64a078";
  } catch (error) {
    $(".status-dot").style.background = "#b34e46";
    console.error("Could not save plans on this device:", error);
    alert("Your changes could not be saved. Check available device storage.");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function colorFor(value) {
  return COLORS.find((color) => color.value === value) || COLORS[0];
}

function renderCalendar() {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  $("#month-title").textContent = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("#today-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const dayCount = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.max(5, Math.ceil((offset + dayCount) / 7));
  calendarGrid.style.setProperty("--week-count", weekCount);
  const dateKeys = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return dateKey(date);
  });

  calendarGrid.innerHTML = dateKeys.map((key) => {
    const date = parseDate(key);
    const tasks = state.tasks.filter((task) => task.dates.includes(key));
    const completed = tasks.filter((task) => task.done?.[key]).length;
    const classes = ["calendar-day"];
    if (date.getMonth() !== month) classes.push("outside-month");
    if (key === today) classes.push("today");
    if (selectedDates.includes(key)) classes.push("selected");
    const taskRows = tasks.slice(0, 3).map((task) => {
      const color = colorFor(task.color).value;
      const done = Boolean(task.done?.[key]);
      return `<div class="task-row" style="--task-color:${color};--task-bg:${color}18;--task-ink:${color}">
        <button class="task-chip${done ? " completed" : ""}" type="button" data-task="${escapeHtml(task.id)}" data-date="${key}" aria-label="Edit ${escapeHtml(task.title)}">${escapeHtml(task.title)}</button>
        <button class="task-done${done ? " completed" : ""}" type="button" data-complete="${escapeHtml(task.id)}" data-date="${key}" aria-label="${done ? "Mark incomplete" : "Mark complete"}: ${escapeHtml(task.title)}">${done ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2 6 2.5 2.5L10 3"/></svg>' : ""}</button>
      </div>`;
    }).join("");
    const more = tasks.length > 3 ? `<span class="more-tasks">+${tasks.length - 3} more</span>` : "";
    return `<div class="${classes.join(" ")}" role="gridcell" tabindex="0" data-day="${key}" aria-label="${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${tasks.length ? `, ${tasks.length} tasks` : ""}">
      <div class="day-head"><span class="day-number">${date.getDate()}</span>${tasks.length ? `<span class="day-total">${completed}/${tasks.length}</span>` : ""}</div>
      <div class="day-tasks">${taskRows}${more}</div>
    </div>`;
  }).join("");
}

function renderSubjects(selected = "") {
  const select = $("#task-subject");
  select.innerHTML = state.subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("");
  if (selected && state.subjects.includes(selected)) select.value = selected;
}

function renderColors() {
  $("#color-picker").innerHTML = COLORS.map((color) => `<button class="color-swatch" type="button" data-color="${color.value}" aria-label="${color.name}" aria-pressed="${selectedColor === color.value}" style="background:${color.value}"></button>`).join("");
}

function renderDateChips(dates) {
  $("#task-date-chips").innerHTML = dates.sort().map((key) => `<span class="date-chip">${parseDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric" })}<button type="button" data-remove-date="${key}" aria-label="Remove ${key}">×</button></span>`).join("");
}

function openTaskDialog(dates = [today], task = null) {
  editingTaskId = task?.id || null;
  selectedColor = task?.color || COLORS[0].value;
  renderSubjects(task?.subject);
  renderColors();
  $("#dialog-eyebrow").textContent = task ? "Edit study plan" : "Study plan";
  $("#dialog-title").textContent = task ? "Edit task" : "Add a task";
  $("#task-title").value = task?.title || "";
  $("#task-minutes").value = task?.minutes || 60;
  $("#delete-task-button").hidden = !task;
  $("#task-date-input").value = dates[0] || today;
  $("#task-date-chips").dataset.dates = JSON.stringify(task ? [...task.dates] : [...new Set(dates)]);
  renderDateChips([...new Set(task ? task.dates : dates)]);
  if (!taskDialog.open) taskDialog.showModal();
  $("#task-title").focus();
}

function getDialogDates() {
  try {
    return JSON.parse($("#task-date-chips").dataset.dates || "[]");
  } catch (error) {
    console.error("Could not read selected task dates:", error);
    return [];
  }
}

function setDialogDates(dates) {
  const uniqueDates = [...new Set(dates)].sort();
  $("#task-date-chips").dataset.dates = JSON.stringify(uniqueDates);
  renderDateChips(uniqueDates);
}

function renderSelection() {
  $("#selection-bar").hidden = !selectionMode;
  $("#selection-count").textContent = `${selectedDates.length} day${selectedDates.length === 1 ? "" : "s"} selected`;
  $("#select-days-button").textContent = selectionMode ? "Selecting…" : "Select days";
  renderCalendar();
}

function toggleSelection(key) {
  selectedDates = selectedDates.includes(key) ? selectedDates.filter((date) => date !== key) : [...selectedDates, key];
  renderSelection();
}

function leaveSelection() {
  selectedDates = [];
  selectionMode = false;
  renderSelection();
}

function toggleDone(taskId, key) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.done ||= {};
  task.done[key] = !task.done[key];
  saveState();
  renderCalendar();
  if (activeView === "insights-view") renderDashboard();
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest}m`;
}

function renderDashboard() {
  const monthPrefix = `${dateKey(monthCursor).slice(0, 7)}-`;
  const tasksThisMonth = state.tasks.flatMap((task) => task.dates.filter((key) => key.startsWith(monthPrefix)).map((key) => ({ task, key })));
  const completedThisMonth = tasksThisMonth.filter(({ task, key }) => task.done?.[key]);
  const minutesThisMonth = completedThisMonth.reduce((total, { task }) => total + (Number(task.minutes) || 0), 0);
  const plannedMinutes = tasksThisMonth.reduce((total, { task }) => total + (Number(task.minutes) || 0), 0);
  const percent = tasksThisMonth.length ? Math.round(completedThisMonth.length / tasksThisMonth.length * 100) : 0;
  const studiedDays = [...new Set(state.tasks.flatMap((task) => task.dates.filter((key) => task.done?.[key])))].sort();
  let streak = 0;
  const cursor = new Date();
  if (!studiedDays.includes(today)) cursor.setDate(cursor.getDate() - 1);
  while (studiedDays.includes(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const subjectStats = state.subjects.map((subject) => {
    const planned = tasksThisMonth.filter(({ task }) => task.subject === subject).length;
    const done = completedThisMonth.filter(({ task }) => task.subject === subject).length;
    const minutes = completedThisMonth.filter(({ task }) => task.subject === subject).reduce((sum, { task }) => sum + (Number(task.minutes) || 0), 0);
    return { subject, planned, done, minutes };
  });
  const maxMinutes = Math.max(1, ...subjectStats.map((item) => item.minutes));
  $("#insights-period").textContent = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const days = Array.from({ length: 28 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (27 - index));
    const key = dateKey(date);
    const count = state.tasks.filter((task) => task.done?.[key]).length;
    const level = count ? Math.min(4, Math.ceil(count / 2)) : 0;
    return `<span class="activity-cell${level ? ` level-${level}` : ""}" title="${key}: ${count} tasks">${date.getDate()}</span>`;
  }).join("");
  const subjectRows = subjectStats.map((item, index) => {
    const color = COLORS[index % COLORS.length].value;
    const width = Math.round(item.minutes / maxMinutes * 100);
    return `<div class="subject-row">
      <span class="subject-name" title="${escapeHtml(item.subject)}">${escapeHtml(item.subject)}</span>
      <span class="progress-track"><span class="progress-fill" style="width:${width}%;--subject-color:${color}"></span></span>
      <span class="subject-count">${item.done}/${item.planned} · ${formatMinutes(item.minutes)}</span>
    </div>`;
  }).join("");
  $("#dashboard-content").innerHTML = `
    <div class="metric-grid">
      <article class="metric-card"><p class="eyebrow">Focused</p><p class="metric-value">${formatMinutes(minutesThisMonth)}</p><span class="metric-caption">study time this month</span></article>
      <article class="metric-card"><p class="eyebrow">Follow-through</p><p class="metric-value">${percent}%</p><span class="metric-caption">${completedThisMonth.length} of ${tasksThisMonth.length} tasks complete</span></article>
      <article class="metric-card"><p class="eyebrow">Current streak</p><p class="metric-value">${streak} <span style="font-size:15px">day${streak === 1 ? "" : "s"}</span></p><span class="metric-caption">with at least one task done</span></article>
    </div>
    <div class="habit-streak"><strong>${formatMinutes(plannedMinutes - minutesThisMonth)} left</strong><span>planned study time not yet completed this month</span></div>
    <section class="panel">
      <div class="panel-heading"><h2>Study rhythm</h2><span>LAST 28 DAYS</span></div>
      <div class="activity-grid">${days}</div>
    </section>
    <section class="panel">
      <div class="panel-heading"><h2>By subject</h2><span>THIS MONTH</span></div>
      ${subjectStats.some((item) => item.planned) ? `<div class="subject-list">${subjectRows}</div>` : '<div class="empty-state">No study tasks on your calendar this month yet.<br>Plan a few sessions to start tracking your progress.</div>'}
      <form class="subject-form" id="subject-form">
        <input class="text-input" id="new-subject" maxlength="32" placeholder="Add a subject" aria-label="New subject" required>
        <button class="secondary-button" type="submit">Add subject</button>
      </form>
    </section>
    <div class="backup-footer"><button class="text-button" type="button" id="dashboard-backup-button">Export or restore your data</button></div>`;
}

function switchView(viewId) {
  activeView = viewId;
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.id === viewId;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.view === viewId;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (viewId === "insights-view") renderDashboard();
}

function showBackupDialog() {
  $("#backup-message").textContent = "";
  $("#backup-dialog").showModal();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `daymark-backup-${today}.json`;
  link.click();
  URL.revokeObjectURL(url);
  $("#backup-message").textContent = "Backup downloaded.";
}

function importBackup(file) {
  if (!confirm("Restore this backup and replace the data saved on this device?")) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported || !Array.isArray(imported.tasks) || !Array.isArray(imported.subjects)) throw new Error("This file is not a Daymark backup.");
      const tasks = imported.tasks.filter((task) => task && typeof task.title === "string" && Array.isArray(task.dates) && task.dates.every((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)));
      const subjects = [...new Set(imported.subjects.filter((subject) => typeof subject === "string" && subject.trim()))];
      if (tasks.length !== imported.tasks.length || !subjects.length) throw new Error("The backup contains invalid or incomplete data.");
      state = { tasks, subjects };
      saveState();
      renderCalendar();
      renderSubjects();
      renderDashboard();
      $("#backup-message").textContent = "Backup restored on this device.";
    } catch (error) {
      console.error("Could not restore backup:", error);
      $("#backup-message").textContent = error.message || "Could not read this backup file.";
    }
  };
  reader.onerror = () => {
    console.error("Could not read selected backup:", reader.error);
    $("#backup-message").textContent = "Could not read this file.";
  };
  reader.readAsText(file);
}

calendarGrid.addEventListener("pointerdown", (event) => {
  const day = event.target.closest("[data-day]");
  if (!day || event.target.closest("button")) return;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    suppressClickDate = day.dataset.day;
    clearTimeout(suppressClickTimer);
    suppressClickTimer = setTimeout(() => { suppressClickDate = null; }, 1000);
    if (!selectionMode) {
      selectionMode = true;
      selectedDates = [day.dataset.day];
    } else {
      toggleSelection(day.dataset.day);
      return;
    }
    renderSelection();
  }, 480);
});
calendarGrid.addEventListener("pointerup", () => clearTimeout(longPressTimer));
calendarGrid.addEventListener("pointerleave", () => clearTimeout(longPressTimer));
calendarGrid.addEventListener("pointercancel", () => clearTimeout(longPressTimer));
calendarGrid.addEventListener("click", (event) => {
  const doneButton = event.target.closest("[data-complete]");
  if (doneButton) {
    event.stopPropagation();
    toggleDone(doneButton.dataset.complete, doneButton.dataset.date);
    return;
  }
  const taskButton = event.target.closest("[data-task]");
  if (taskButton) {
    event.stopPropagation();
    const task = state.tasks.find((item) => item.id === taskButton.dataset.task);
    if (task) openTaskDialog([taskButton.dataset.date], task);
    return;
  }
  const day = event.target.closest("[data-day]");
  if (!day) return;
  if (day.dataset.day === suppressClickDate) {
    suppressClickDate = null;
    clearTimeout(suppressClickTimer);
    return;
  }
  if (selectionMode) toggleSelection(day.dataset.day);
  else openTaskDialog([day.dataset.day]);
});
calendarGrid.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-day]")) {
    event.preventDefault();
    if (selectionMode) toggleSelection(event.target.dataset.day);
    else openTaskDialog([event.target.dataset.day]);
  }
});

$("#previous-month").addEventListener("click", () => {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
  renderCalendar();
});
$("#next-month").addEventListener("click", () => {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
  renderCalendar();
});
$("#today-button").addEventListener("click", () => {
  monthCursor = new Date();
  renderCalendar();
});
$("#new-task-button").addEventListener("click", () => openTaskDialog([today]));
$("#select-days-button").addEventListener("click", () => {
  selectionMode = !selectionMode;
  selectedDates = [];
  renderSelection();
});
$("#cancel-selection").addEventListener("click", leaveSelection);
$("#plan-selected").addEventListener("click", () => {
  if (selectedDates.length) openTaskDialog([...selectedDates]);
});

$("#color-picker").addEventListener("click", (event) => {
  const button = event.target.closest("[data-color]");
  if (!button) return;
  selectedColor = button.dataset.color;
  renderColors();
});
$("#add-date-button").addEventListener("click", () => {
  const date = $("#task-date-input").value;
  if (date) setDialogDates([...getDialogDates(), date]);
});
$("#task-date-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#add-date-button").click();
  }
});
$("#task-date-chips").addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-date]");
  if (remove) setDialogDates(getDialogDates().filter((date) => date !== remove.dataset.removeDate));
});
$("#task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const dates = getDialogDates();
  if (!dates.length) {
    $("#task-date-input").focus();
    return;
  }
  const existing = state.tasks.find((task) => task.id === editingTaskId);
  const task = {
    id: editingTaskId || crypto.randomUUID(),
    title: $("#task-title").value.trim(),
    subject: $("#task-subject").value,
    minutes: Math.max(5, Math.min(1440, Number($("#task-minutes").value) || 60)),
    color: selectedColor,
    dates,
    done: existing?.done || {},
  };
  if (!task.title) return;
  if (existing) state.tasks = state.tasks.map((item) => item.id === editingTaskId ? task : item);
  else state.tasks.push(task);
  saveState();
  taskDialog.close();
  leaveSelection();
  renderCalendar();
  if (activeView === "insights-view") renderDashboard();
});
$("#delete-task-button").addEventListener("click", () => {
  if (!editingTaskId || !confirm("Delete this study task from all scheduled days?")) return;
  state.tasks = state.tasks.filter((task) => task.id !== editingTaskId);
  saveState();
  taskDialog.close();
  renderCalendar();
  if (activeView === "insights-view") renderDashboard();
});
$("#close-dialog").addEventListener("click", () => taskDialog.close());
$("#cancel-dialog").addEventListener("click", () => taskDialog.close());
taskDialog.addEventListener("click", (event) => {
  if (event.target === taskDialog) taskDialog.close();
});

document.querySelector(".bottom-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) switchView(button.dataset.view);
});
$("#backup-button").addEventListener("click", showBackupDialog);
$("#export-button").addEventListener("click", showBackupDialog);
$("#backup-export").addEventListener("click", exportBackup);
$("#backup-import-button").addEventListener("click", () => $("#backup-file").click());
$("#backup-file").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) importBackup(file);
  event.target.value = "";
});
$("#close-backup-dialog").addEventListener("click", () => $("#backup-dialog").close());
$("#backup-dialog").addEventListener("click", (event) => {
  if (event.target === $("#backup-dialog")) $("#backup-dialog").close();
});
$("#dashboard-content").addEventListener("submit", (event) => {
  if (event.target.id !== "subject-form") return;
  event.preventDefault();
  const subject = $("#new-subject").value.trim();
  if (!subject || state.subjects.some((item) => item.toLowerCase() === subject.toLowerCase())) return;
  state.subjects.push(subject);
  saveState();
  renderSubjects();
  renderDashboard();
});
$("#dashboard-content").addEventListener("click", (event) => {
  if (event.target.closest("#dashboard-backup-button")) showBackupDialog();
});

renderSubjects();
renderCalendar();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Could not register offline support:", error));
  });
}
