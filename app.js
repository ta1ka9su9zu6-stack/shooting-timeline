"use strict";

const STORAGE_KEY = "shooting-timeline-state-v1";
const CLOUD_CONFIG_KEY = "shooting-timeline-cloud-v1";
const PIXELS_PER_MINUTE = 3;
const MIN_DURATION = 5;
const MIN_COLUMN_WIDTH = 72;
const DEFAULT_CUSTOM_COLUMN_WIDTH = 150;
const ACTION_COLUMN_ID = "__action__";
const ROW_HANDLE_WIDTH = 30;
const DEFAULT_ACTION_COLUMN_WIDTH = 24;
const MIN_ACTION_COLUMN_WIDTH = 18;
const MAX_ACTION_COLUMN_WIDTH = 90;
const SCHEDULE_TABLE_DEFAULT_WIDTH = 940;
const SCHEDULE_TABLE_MIN_WIDTH = 420;
const MAX_SCHEDULE_TABLE_WIDTH = 2200;
const HISTORY_LIMIT = 50;
const REQUIRED_COLUMN_IDS = new Set(["start", "duration", "end"]);

const elements = {
  saveStatus: document.querySelector("#saveStatus"),
  addRowBtn: document.querySelector("#addRowBtn"),
  duplicateBtn: document.querySelector("#duplicateBtn"),
  columnsBtn: document.querySelector("#columnsBtn"),
  printPortraitBtn: document.querySelector("#printPortraitBtn"),
  printLandscapeBtn: document.querySelector("#printLandscapeBtn"),
  cloudBtn: document.querySelector("#cloudBtn"),
  tableTitleInput: document.querySelector("#tableTitleInput"),
  tableTitleHeading: document.querySelector("#tableTitleHeading"),
  shootDateInput: document.querySelector("#shootDateInput"),
  shootPlaceInput: document.querySelector("#shootPlaceInput"),
  dayStartInput: document.querySelector("#dayStartInput"),
  dayEndInput: document.querySelector("#dayEndInput"),
  snapInput: document.querySelector("#snapInput"),
  timelineRangeLabel: document.querySelector("#timelineRangeLabel"),
  timelineViewport: document.querySelector("#timelineViewport"),
  timelineCanvas: document.querySelector("#timelineCanvas"),
  ticksLayer: document.querySelector("#ticksLayer"),
  cardsLayer: document.querySelector("#cardsLayer"),
  scheduleTable: document.querySelector("#scheduleTable"),
  scheduleColgroup: document.querySelector("#scheduleColgroup"),
  scheduleHeader: document.querySelector("#scheduleHeader"),
  scheduleBody: document.querySelector("#scheduleBody"),
  cloudDialog: document.querySelector("#cloudDialog"),
  columnsDialog: document.querySelector("#columnsDialog"),
  columnsList: document.querySelector("#columnsList"),
  newColumnInput: document.querySelector("#newColumnInput"),
  addColumnBtn: document.querySelector("#addColumnBtn"),
  supabaseUrlInput: document.querySelector("#supabaseUrlInput"),
  supabaseKeyInput: document.querySelector("#supabaseKeyInput"),
  workspaceIdInput: document.querySelector("#workspaceIdInput"),
  editorNameInput: document.querySelector("#editorNameInput"),
  pullCloudBtn: document.querySelector("#pullCloudBtn"),
  pushCloudBtn: document.querySelector("#pushCloudBtn"),
  cloudStatus: document.querySelector("#cloudStatus"),
  historyBtn: document.querySelector("#historyBtn"),
  historyDialog: document.querySelector("#historyDialog"),
  refreshHistoryBtn: document.querySelector("#refreshHistoryBtn"),
  historyList: document.querySelector("#historyList"),
  historyStatus: document.querySelector("#historyStatus"),
  printTitle: document.querySelector("#printTitle"),
  printDate: document.querySelector("#printDate"),
  printPlace: document.querySelector("#printPlace"),
  printColgroup: document.querySelector("#printColgroup"),
  printHeader: document.querySelector("#printHeader"),
  printBody: document.querySelector("#printBody"),
  cellFormatToolbar: document.querySelector("#cellFormatToolbar"),
  formatBoldBtn: document.querySelector("#formatBoldBtn"),
  formatColors: document.querySelector("#formatColors"),
  formatClearBtn: document.querySelector("#formatClearBtn"),
  formatHint: document.querySelector("#formatHint"),
};

let supabaseClient = null;
let realtimeChannel = null;
let pendingRemoteState = null;
let isApplyingRemoteChange = false;
let cloudPushTimer = null;

let state = loadState();
let selectedId = state.rows[0]?.id ?? null;
let selectedRowIds = new Set(selectedId ? [selectedId] : []);
let selectionAnchorId = selectedId;
let dragSession = null;
let columnResizeSession = null;
let activeCell = null;
let undoStack = [];
let redoStack = [];
let committedStateJson = JSON.stringify(state);

init();

function init() {
  loadCloudConfig();
  bindControls();
  render();
  if (hasCloudConfig()) {
    pullFromCloud();
  }
}

function hasCloudConfig() {
  return Boolean(
    elements.supabaseUrlInput.value.trim() &&
      elements.supabaseKeyInput.value.trim() &&
      elements.workspaceIdInput.value.trim()
  );
}

function defaultState() {
  return {
    tableTitle: "撮影スケジュール",
    shootDate: "2026-06-22",
    shootPlace: "西船橋 アリュール",
    dayStart: 12 * 60,
    dayEnd: 20 * 60,
    snapMinutes: 1,
    tableWidth: SCHEDULE_TABLE_DEFAULT_WIDTH,
    actionColumnWidth: DEFAULT_ACTION_COLUMN_WIDTH,
    columns: defaultColumns(),
    rows: [
      createRow("12:10", 50, "", "", "", ""),
      createRow("13:00", 50, "", "", "", ""),
      createRow("14:00", 50, "はるな", "", "", "固定予定"),
      createRow("14:50", 20, "休憩", "", "", ""),
      createRow("15:10", 50, "", "", "", ""),
      createRow("16:00", 50, "", "", "", ""),
      createRow("16:50", 50, "", "", "", ""),
      createRow("17:40", 30, "休憩", "", "", ""),
      createRow("18:10", 50, "", "", "", ""),
      createRow("19:00", 50, "", "", "", ""),
    ],
  };
}

function defaultColumns() {
  return [
    { id: "start", label: "開始", type: "time", visible: true, print: true, width: 92, required: true },
    { id: "duration", label: "撮影時間", type: "number", visible: true, print: true, width: 110, required: true },
    { id: "end", label: "終了", type: "time", visible: false, print: false, width: 92, required: true },
    { id: "person", label: "女性名", type: "text", visible: true, print: true, width: 130 },
    { id: "content", label: "撮影内容", type: "textarea", visible: true, print: true, width: 190 },
    { id: "place", label: "場所", type: "text", visible: true, print: false, width: 160 },
    { id: "note", label: "備考", type: "textarea", visible: true, print: true, width: 180 },
  ];
}

function createRow(startTime, duration, person, content, place, note) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    start: parseTime(startTime) ?? 9 * 60,
    duration: Number(duration) || 50,
    person: person || "",
    content: content || "",
    place: place || "",
    note: note || "",
    extras: {},
    formats: {},
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultState();
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.rows)) return defaultState();
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

function normalizeState(input) {
  const fallback = defaultState();
  const columns = normalizeColumns(input.columns);
  const rows = input.rows.map((row) => ({
    id: row.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    start: clampMinutes(Number(row.start), 0, 24 * 60 - 1),
    duration: Math.max(MIN_DURATION, Number(row.duration) || 50),
    person: String(row.person || ""),
    content: String(row.content || ""),
    place: String(row.place || ""),
    note: String(row.note || ""),
    extras: normalizeExtras(row.extras, columns),
    formats: normalizeFormats(row.formats, columns),
  }));

  return {
    tableTitle: input.tableTitle || fallback.tableTitle,
    shootDate: input.shootDate || fallback.shootDate,
    shootPlace: input.shootPlace || "",
    dayStart: clampMinutes(Number(input.dayStart), 0, 24 * 60 - 1),
    dayEnd: clampMinutes(Number(input.dayEnd), 1, 24 * 60),
    snapMinutes: Number(input.snapMinutes) || 1,
    tableWidth: normalizeTableWidth(input.tableWidth ?? fallback.tableWidth),
    actionColumnWidth: normalizeActionColumnWidth(input.actionColumnWidth ?? fallback.actionColumnWidth),
    columns,
    rows: rows.length ? rows : fallback.rows,
  };
}

function normalizeColumns(inputColumns) {
  const fallback = defaultColumns();
  const byId = new Map(fallback.map((column) => [column.id, column]));
  const incoming = Array.isArray(inputColumns) ? inputColumns : fallback;
  const normalized = [];
  const seen = new Set();

  incoming.forEach((column) => {
    const id = String(column?.id || "").trim();
    if (!id || seen.has(id)) return;
    const base = byId.get(id);
    const visible = id === "start" || id === "duration" ? true : column.visible ?? base?.visible ?? true;
    normalized.push({
      id,
      label: String(column.label || base?.label || "追加列"),
      type: base?.type || column.type || "textarea",
      visible,
      print: column.print ?? base?.print ?? true,
      width: normalizeColumnWidth(column.width ?? base?.width ?? DEFAULT_CUSTOM_COLUMN_WIDTH),
      required: REQUIRED_COLUMN_IDS.has(id),
    });
    seen.add(id);
  });

  const missingRequired = fallback
    .filter((column) => REQUIRED_COLUMN_IDS.has(column.id) && !seen.has(column.id))
    .map((column) => ({ ...column }));

  return normalized.length ? [...missingRequired, ...normalized] : fallback;
}

function normalizeExtras(extras, columns) {
  const normalized = {};
  const source = extras && typeof extras === "object" ? extras : {};
  columns.forEach((column) => {
    if (isCustomColumn(column.id)) {
      normalized[column.id] = String(source[column.id] || "");
    }
  });
  return normalized;
}

function normalizeFormats(formats, columns) {
  const normalized = {};
  const source = formats && typeof formats === "object" ? formats : {};
  const validIds = new Set([...columns.map((column) => column.id), ACTION_COLUMN_ID]);
  Object.entries(source).forEach(([columnId, value]) => {
    if (!validIds.has(columnId) || !value || typeof value !== "object") return;
    const bold = Boolean(value.bold);
    const color = typeof value.color === "string" && /^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : "";
    if (bold || color) normalized[columnId] = { bold, color };
  });
  return normalized;
}

function bindControls() {
  elements.addRowBtn.addEventListener("click", addRow);
  elements.duplicateBtn.addEventListener("click", duplicateSelected);
  elements.columnsBtn.addEventListener("click", () => {
    renderColumnsDialog();
    elements.columnsDialog.showModal();
  });
  elements.printPortraitBtn.addEventListener("click", () => printSchedule("portrait"));
  elements.printLandscapeBtn.addEventListener("click", () => printSchedule("landscape"));
  elements.cloudBtn.addEventListener("click", () => {
    elements.cloudDialog.showModal();
  });

  elements.tableTitleInput.addEventListener("input", () => {
    state.tableTitle = elements.tableTitleInput.value;
    elements.tableTitleHeading.textContent = state.tableTitle || "表入力";
    saveStateSoon();
    renderPrintSheet();
  });

  elements.shootDateInput.addEventListener("change", () => {
    state.shootDate = elements.shootDateInput.value;
    saveAndRender();
  });

  elements.shootPlaceInput.addEventListener("input", () => {
    state.shootPlace = elements.shootPlaceInput.value;
    saveStateSoon();
    renderPrintSheet();
  });

  elements.dayStartInput.addEventListener("change", () => {
    const value = parseTime(elements.dayStartInput.value);
    if (value !== null) state.dayStart = value;
    if (state.dayEnd <= state.dayStart) state.dayEnd = state.dayStart + 60;
    saveAndRender();
  });

  elements.dayEndInput.addEventListener("change", () => {
    const value = parseTime(elements.dayEndInput.value);
    if (value !== null) state.dayEnd = value;
    if (state.dayEnd <= state.dayStart) state.dayStart = Math.max(0, state.dayEnd - 60);
    saveAndRender();
  });

  elements.snapInput.addEventListener("change", () => {
    state.snapMinutes = Number(elements.snapInput.value) || 5;
    saveAndRender();
  });

  elements.pullCloudBtn.addEventListener("click", pullFromCloud);
  elements.pushCloudBtn.addEventListener("click", pushToCloud);

  elements.historyBtn.addEventListener("click", () => {
    elements.historyDialog.showModal();
    openHistory();
  });

  elements.formatBoldBtn.addEventListener("click", () => {
    applyBoldToggle();
  });
  elements.formatClearBtn.addEventListener("click", () => {
    applyClearFormat();
  });
  elements.formatColors.querySelectorAll(".format-color").forEach((button) => {
    button.addEventListener("click", () => {
      applyColorToggle(button.dataset.color);
    });
  });
  elements.refreshHistoryBtn.addEventListener("click", openHistory);
  elements.addColumnBtn.addEventListener("click", addColumnFromDialog);

  [elements.supabaseUrlInput, elements.supabaseKeyInput, elements.workspaceIdInput, elements.editorNameInput].forEach((input) => {
    input.addEventListener("input", saveCloudConfig);
  });

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onGlobalKeyDown);
}

function getCellFormat(row, columnId) {
  return (row.formats && row.formats[columnId]) || { bold: false, color: "" };
}

function setCellFormat(row, columnId, partial) {
  row.formats ||= {};
  const current = getCellFormat(row, columnId);
  const next = { bold: current.bold, color: current.color, ...partial };
  if (!next.bold && !next.color) {
    delete row.formats[columnId];
  } else {
    row.formats[columnId] = { bold: Boolean(next.bold), color: next.color || "" };
  }
}

function formatTargets() {
  if (selectedRowIds.size > 1) {
    const targets = [];
    sortedRowsByStart().forEach((row) => {
      if (!selectedRowIds.has(row.id)) return;
      visibleTableColumns().forEach((column) => {
        targets.push({ row, columnId: column.id });
      });
    });
    return targets;
  }
  if (activeCell) {
    const row = findRow(activeCell.rowId);
    if (!row) return [];
    return [{ row, columnId: activeCell.columnId }];
  }
  return [];
}

function applyBoldToggle() {
  const targets = formatTargets();
  if (!targets.length) return;
  const allBold = targets.every((t) => getCellFormat(t.row, t.columnId).bold);
  const newBold = !allBold;
  targets.forEach((t) => setCellFormat(t.row, t.columnId, { bold: newBold }));
  finishFormatChange();
}

function applyColorToggle(color) {
  const targets = formatTargets();
  if (!targets.length) return;
  const allSame = targets.every((t) => getCellFormat(t.row, t.columnId).color === color);
  const newColor = allSame ? "" : color;
  targets.forEach((t) => setCellFormat(t.row, t.columnId, { color: newColor }));
  finishFormatChange();
}

function applyClearFormat() {
  const targets = formatTargets();
  if (!targets.length) return;
  targets.forEach((t) => setCellFormat(t.row, t.columnId, { bold: false, color: "" }));
  finishFormatChange();
}

function finishFormatChange() {
  renderTable();
  renderPrintSheet();
  saveStateSoon();
  if (activeCell && selectedRowIds.size <= 1) {
    focusScheduleCell(activeCell.rowId, activeCell.columnId);
  }
}

function updateFormatToolbar() {
  const targets = formatTargets();
  const hasActive = targets.length > 0;
  elements.formatBoldBtn.disabled = !hasActive;
  elements.formatClearBtn.disabled = !hasActive;
  const colorButtons = elements.formatColors.querySelectorAll(".format-color");
  colorButtons.forEach((button) => {
    button.disabled = !hasActive;
  });

  const allBold = hasActive && targets.every((t) => getCellFormat(t.row, t.columnId).bold);
  elements.formatBoldBtn.classList.toggle("active", allBold);
  colorButtons.forEach((button) => {
    const allSame = hasActive && targets.every((t) => getCellFormat(t.row, t.columnId).color.toLowerCase() === button.dataset.color.toLowerCase());
    button.classList.toggle("active", allSame);
  });

  if (selectedRowIds.size > 1) {
    elements.formatHint.textContent = `${selectedRowIds.size}行選択中の書式を変更できます`;
  } else {
    elements.formatHint.textContent = hasActive
      ? "選択中のセルに書式を適用します"
      : "セルを選択すると書式を変更できます";
  }
}

function applyCellFormatStyle(control, row, columnId) {
  const fmt = (row.formats && row.formats[columnId]) || {};
  control.style.fontWeight = fmt.bold ? "700" : "";
  control.style.color = fmt.color || "";
}

function render() {
  elements.tableTitleInput.value = state.tableTitle;
  elements.tableTitleHeading.textContent = state.tableTitle || "表入力";
  elements.shootDateInput.value = state.shootDate;
  elements.shootPlaceInput.value = state.shootPlace;
  elements.dayStartInput.value = formatTime(state.dayStart);
  elements.dayEndInput.value = formatTime(state.dayEnd);
  elements.snapInput.value = String(state.snapMinutes);
  renderTable();
  renderTimeline();
  renderPrintSheet();
  updateFormatToolbar();
}

function renderTable() {
  const columns = visibleTableColumns();
  renderTableHeader();
  const fragment = document.createDocumentFragment();
  sortedRowsByStart().forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    const isRangeSelected = selectedRowIds.has(row.id) && selectedRowIds.size > 1;
    tr.className = `${row.id === selectedId ? "selected-row" : ""} ${isRangeSelected ? "range-selected" : ""} ${isBreak(row) ? "break-row" : ""}`.trim();
    tr.addEventListener("click", (event) => {
      if (event.target.closest("input, textarea, button, select")) return;
      selectRow(row.id, event);
      render();
    });

    tr.appendChild(rowHandleCell(row, index));
    columns.forEach((column) => {
      tr.appendChild(tableCellForColumn(row, column));
    });
    tr.appendChild(actionCell(row));
    fragment.appendChild(tr);
  });

  elements.scheduleBody.replaceChildren(fragment);
}

function rowHandleCell(row, index) {
  const td = document.createElement("td");
  td.className = "row-handle";
  td.textContent = String(index + 1);
  td.title = "クリックで行を選択 / Shiftで範囲選択 / Ctrl(⌘)で複数選択";
  return td;
}

function renderTableHeader() {
  const fragment = document.createDocumentFragment();
  const columns = visibleTableColumns();
  renderColgroup(elements.scheduleColgroup, columns, true, true);
  setScheduleTableWidth(columns);

  const handleHeader = document.createElement("th");
  handleHeader.className = "row-handle-header";
  handleHeader.setAttribute("aria-label", "行選択");
  fragment.appendChild(handleHeader);

  columns.forEach((column, index) => {
    const th = document.createElement("th");
    th.className = "column-header";
    th.dataset.columnId = column.id;
    th.draggable = true;

    const title = document.createElement("span");
    title.className = "column-title";
    title.textContent = column.label;

    const resizer = document.createElement("span");
    resizer.className = "column-resizer";
    resizer.setAttribute("aria-hidden", "true");
    resizer.addEventListener("pointerdown", (event) => startColumnResize(event, column, columns[index + 1] || actionColumnModel()));
    resizer.addEventListener("dragstart", (event) => event.preventDefault());

    th.addEventListener("dragstart", (event) => startHeaderDrag(event, column));
    th.addEventListener("dragend", clearHeaderDragState);
    th.addEventListener("dragover", (event) => {
      event.preventDefault();
      th.classList.add("drag-over");
    });
    th.addEventListener("dragleave", () => th.classList.remove("drag-over"));
    th.addEventListener("drop", (event) => dropHeaderColumn(event, column));

    th.append(title, resizer);
    fragment.appendChild(th);
  });
  const action = document.createElement("th");
  action.className = "action-header";
  action.setAttribute("aria-label", "行操作");
  action.textContent = "×";

  const tableResizer = document.createElement("span");
  tableResizer.className = "table-resizer";
  tableResizer.setAttribute("aria-hidden", "true");
  tableResizer.addEventListener("pointerdown", startTableResize);
  tableResizer.addEventListener("dragstart", (event) => event.preventDefault());
  action.appendChild(tableResizer);

  fragment.appendChild(action);
  elements.scheduleHeader.replaceChildren(fragment);
}

function renderColgroup(target, columns, includeActionColumn = false, includeHandleColumn = false) {
  const fragment = document.createDocumentFragment();
  if (includeHandleColumn) {
    const handleCol = document.createElement("col");
    handleCol.style.width = `${ROW_HANDLE_WIDTH}px`;
    fragment.appendChild(handleCol);
  }
  const widths = displayColumnWidths(columns, includeActionColumn);
  columns.forEach((column, index) => {
    const col = document.createElement("col");
    col.style.width = `${widths[index]}px`;
    fragment.appendChild(col);
  });
  if (includeActionColumn) {
    const actionCol = document.createElement("col");
    actionCol.style.width = `${normalizeActionColumnWidth(state.actionColumnWidth)}px`;
    fragment.appendChild(actionCol);
  }
  target.replaceChildren(fragment);
}

function tableWidth(columns, includeActionColumn = false) {
  const total = columns.reduce((sum, column) => sum + normalizeColumnWidth(column.width), 0);
  const actionWidth = includeActionColumn ? normalizeActionColumnWidth(state.actionColumnWidth) + ROW_HANDLE_WIDTH : 0;
  const minimum = includeActionColumn ? SCHEDULE_TABLE_MIN_WIDTH : 420;
  const configuredWidth = includeActionColumn ? normalizeTableWidth(state.tableWidth) : minimum;
  return Math.max(minimum, configuredWidth, total + actionWidth);
}

function baseScheduleTableWidth(columns) {
  const total = columns.reduce((sum, column) => sum + normalizeColumnWidth(column.width), 0);
  return total + normalizeActionColumnWidth(state.actionColumnWidth) + ROW_HANDLE_WIDTH;
}

function displayColumnWidths(columns, includeActionColumn = false) {
  const baseWidths = columns.map((column) => normalizeColumnWidth(column.width));
  if (!includeActionColumn || !columns.length) return baseWidths;

  const baseTotal = baseWidths.reduce((sum, width) => sum + width, 0);
  const targetTotal = tableWidth(columns, true) - normalizeActionColumnWidth(state.actionColumnWidth) - ROW_HANDLE_WIDTH;
  const extraTotal = Math.max(0, targetTotal - baseTotal);
  if (!extraTotal) return baseWidths;

  const evenExtra = Math.floor(extraTotal / columns.length);
  let remainder = extraTotal - evenExtra * columns.length;
  return baseWidths.map((width) => {
    const extra = evenExtra + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
    return width + extra;
  });
}

function updateColumnWidthsOnly() {
  const tableColumns = visibleTableColumns();
  renderColgroup(elements.scheduleColgroup, tableColumns, true);
  setScheduleTableWidth(tableColumns);
  renderColgroup(elements.printColgroup, state.columns.filter((column) => column.print !== false));
}

function setScheduleTableWidth(columns) {
  const width = tableWidth(columns, true);
  elements.scheduleTable.style.width = `${width}px`;
  elements.scheduleTable.style.minWidth = `${width}px`;
}

function actionColumnModel() {
  return { id: ACTION_COLUMN_ID };
}

function getColumnWidthById(id) {
  if (id === ACTION_COLUMN_ID) return normalizeActionColumnWidth(state.actionColumnWidth);
  const column = findColumn(id);
  return column ? normalizeColumnWidth(column.width) : MIN_COLUMN_WIDTH;
}

function setColumnWidthById(id, width) {
  if (id === ACTION_COLUMN_ID) {
    state.actionColumnWidth = normalizeActionColumnWidth(width);
    return;
  }
  const column = findColumn(id);
  if (column) column.width = normalizeColumnWidth(width);
}

function minWidthForColumn(id) {
  return id === ACTION_COLUMN_ID ? MIN_ACTION_COLUMN_WIDTH : MIN_COLUMN_WIDTH;
}

function visibleTableColumns() {
  return state.columns.filter((column) => column.visible !== false);
}

function tableCellForColumn(row, column) {
  if (column.id === "start") return timeTextCell(row, "start", formatTime(row.start));
  if (column.id === "duration") return durationCell(row);
  if (column.id === "end") return timeTextCell(row, "end", formatTime(row.start + row.duration));
  if (column.id === "content" || column.id === "note") return tableTextareaCell(row, column.id, row[column.id]);
  if (isCustomColumn(column.id)) return tableCustomCell(row, column);
  return tableInputCell(row, column.id, "text", row[column.id] || "");
}

function tableInputCell(row, field, type, value, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  if (field === "duration") {
    input.min = String(MIN_DURATION);
    input.step = "1";
  }
  if (type === "time") input.step = "60";
  bindScheduleCellKeyboard(input, row, field);
  input.addEventListener("focus", () => {
    selectedId = row.id;
    renderTimeline();
  });
  input.addEventListener("change", () => {
    updateRow(row.id, field, input.value);
  });
  applyCellFormatStyle(input, row, field);
  td.appendChild(input);
  return td;
}

function timeTextCell(row, field, value) {
  const td = document.createElement("td");
  td.className = "time-cell";
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.value = value;
  input.placeholder = "12:10";
  bindScheduleCellKeyboard(input, row, field);
  input.addEventListener("focus", () => {
    selectedId = row.id;
    renderTimeline();
  });
  input.addEventListener("input", () => {
    const parsed = parseTimeEntry(input.value, false);
    if (parsed === null) return;
    applyTimeEdit(row, field, parsed);
    saveStateSoon();
    renderTimeline();
    renderPrintSheet();
  });
  input.addEventListener("blur", () => {
    const parsed = parseTimeEntry(input.value, true);
    if (parsed !== null) applyTimeEdit(row, field, parsed);
    input.value = field === "start" ? formatTime(row.start) : formatTime(row.start + row.duration);
    saveAndRender();
    applyPendingRemoteState();
  });
  applyCellFormatStyle(input, row, field);
  td.appendChild(input);
  return td;
}

function durationCell(row) {
  const td = document.createElement("td");
  td.className = "time-cell duration-cell";

  const control = document.createElement("div");
  control.className = "duration-control";

  const input = document.createElement("input");
  input.type = "number";
  input.min = String(MIN_DURATION);
  input.step = "1";
  input.inputMode = "numeric";
  input.value = String(row.duration);
  input.setAttribute("aria-label", "撮影時間");
  bindScheduleCellKeyboard(input, row, "duration");
  input.addEventListener("focus", () => {
    selectedId = row.id;
    renderTimeline();
  });
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (!Number.isFinite(value) || input.value === "") return;
    row.duration = Math.max(MIN_DURATION, Math.round(value));
    saveStateSoon();
    renderTimeline();
    renderPrintSheet();
  });
  input.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateDurationInput(row, input, 1);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateDurationInput(row, input, -1);
    }
  });
  input.addEventListener("change", () => {
    const value = Number(input.value);
    row.duration = Math.max(MIN_DURATION, Number.isFinite(value) ? Math.round(value) : MIN_DURATION);
    saveAndRender();
  });
  input.addEventListener("blur", () => {
    applyPendingRemoteState();
  });

  applyCellFormatStyle(input, row, "duration");
  control.append(input);
  td.appendChild(control);
  return td;
}

function tableTextareaCell(row, field, value) {
  const td = document.createElement("td");
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.rows = 1;
  bindScheduleCellKeyboard(textarea, row, field);
  textarea.addEventListener("focus", () => {
    selectedId = row.id;
    renderTimeline();
  });
  textarea.addEventListener("input", () => {
    row[field] = textarea.value;
    saveStateSoon();
    renderTimeline();
    renderPrintSheet();
  });
  textarea.addEventListener("blur", () => {
    saveAndRender();
    applyPendingRemoteState();
  });
  applyCellFormatStyle(textarea, row, field);
  td.appendChild(textarea);
  return td;
}

function tableCustomCell(row, column) {
  row.extras ||= {};
  const td = document.createElement("td");
  const textarea = document.createElement("textarea");
  textarea.value = row.extras[column.id] || "";
  textarea.rows = 1;
  bindScheduleCellKeyboard(textarea, row, column.id);
  textarea.addEventListener("focus", () => {
    selectedId = row.id;
    renderTimeline();
  });
  textarea.addEventListener("input", () => {
    row.extras[column.id] = textarea.value;
    saveStateSoon();
    renderPrintSheet();
  });
  textarea.addEventListener("blur", () => {
    saveAndRender();
    applyPendingRemoteState();
  });
  applyCellFormatStyle(textarea, row, column.id);
  td.appendChild(textarea);
  return td;
}

function bindScheduleCellKeyboard(control, row, columnId) {
  control.dataset.cellRowId = row.id;
  control.dataset.cellColumnId = columnId;
  control.addEventListener("keydown", (event) => handleScheduleCellKeydown(event, row, columnId, control));
  control.addEventListener("focus", () => {
    activeCell = { rowId: row.id, columnId };
    if (selectedRowIds.size > 1) {
      selectedRowIds = new Set([row.id]);
      selectedId = row.id;
      selectionAnchorId = row.id;
    }
    updateFormatToolbar();
  });
}

function handleScheduleCellKeydown(event, row, columnId, control) {
  if (event.isComposing) return;
  if (event.key === "Enter") {
    if (control.tagName === "TEXTAREA" && event.altKey) return;
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    moveFromScheduleCell(row, columnId, event.shiftKey ? -1 : 1, 0, control);
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    moveFromScheduleCell(row, columnId, 0, event.shiftKey ? -1 : 1, control, true);
    return;
  }
  if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    moveFromScheduleCell(row, columnId, event.key === "ArrowUp" ? -1 : 1, 0, control);
    return;
  }
  if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    moveFromScheduleCell(row, columnId, 0, event.key === "ArrowLeft" ? -1 : 1, control);
  }
}

function moveFromScheduleCell(row, columnId, rowDelta, columnDelta, control, wrapColumns = false) {
  commitScheduleCellEdit(row, columnId, control.value);
  const target = nextScheduleCell(row.id, columnId, rowDelta, columnDelta, wrapColumns);
  selectedId = target?.row.id ?? row.id;
  saveAndRender();
  if (target) focusScheduleCell(target.row.id, target.column.id);
}

function nextScheduleCell(rowId, columnId, rowDelta, columnDelta, wrapColumns = false) {
  const rows = sortedRowsByStart();
  const columns = visibleTableColumns();
  if (!rows.length || !columns.length) return null;

  let rowIndex = rows.findIndex((item) => item.id === rowId);
  let columnIndex = columns.findIndex((item) => item.id === columnId);
  if (rowIndex === -1 || columnIndex === -1) return null;

  if (wrapColumns && columnDelta) {
    columnIndex += columnDelta;
    if (columnIndex >= columns.length) {
      columnIndex = 0;
      rowIndex += 1;
    }
    if (columnIndex < 0) {
      columnIndex = columns.length - 1;
      rowIndex -= 1;
    }
  } else {
    rowIndex += rowDelta;
    columnIndex += columnDelta;
  }

  rowIndex = Math.min(rows.length - 1, Math.max(0, rowIndex));
  columnIndex = Math.min(columns.length - 1, Math.max(0, columnIndex));
  return { row: rows[rowIndex], column: columns[columnIndex] };
}

function commitScheduleCellEdit(row, columnId, rawValue) {
  const value = String(rawValue ?? "");
  if (columnId === "start") {
    const parsed = parseTimeEntry(value, true);
    if (parsed !== null) row.start = parsed;
  } else if (columnId === "end") {
    const parsed = parseTimeEntry(value, true);
    if (parsed !== null) row.duration = Math.max(MIN_DURATION, parsed - row.start);
  } else if (columnId === "duration") {
    const minutes = Number(value);
    row.duration = Math.max(MIN_DURATION, Number.isFinite(minutes) ? Math.round(minutes) : MIN_DURATION);
  } else if (isCustomColumn(columnId)) {
    row.extras ||= {};
    row.extras[columnId] = value;
  } else {
    row[columnId] = value;
  }
}

function focusScheduleCell(rowId, columnId) {
  requestAnimationFrame(() => {
    const controls = elements.scheduleBody.querySelectorAll("[data-cell-row-id][data-cell-column-id]");
    const target = Array.from(controls).find((control) => (
      control.dataset.cellRowId === rowId && control.dataset.cellColumnId === columnId
    ));
    if (!target) return;
    target.focus();
    if (typeof target.select === "function") target.select();
  });
}

function actionCell(row) {
  const td = document.createElement("td");
  td.className = "row-action";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-button";
  button.textContent = "×";
  button.setAttribute("aria-label", "削除");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    removeRow(row.id);
  });
  td.appendChild(button);
  return td;
}

function renderTimeline() {
  const rangeStart = state.dayStart;
  const rangeEnd = Math.max(state.dayEnd, state.dayStart + 60);
  const duration = rangeEnd - rangeStart;
  const width = Math.max(720, duration * PIXELS_PER_MINUTE);

  elements.timelineCanvas.style.width = `${width}px`;
  elements.timelineRangeLabel.textContent = `${formatTime(rangeStart)}-${formatTime(rangeEnd)}`;

  renderTicks(rangeStart, rangeEnd);

  const cards = document.createDocumentFragment();
  const visibleRows = sortedRowsByStart();
  visibleRows.forEach((row) => {
    const card = document.createElement("div");
    const left = (row.start - rangeStart) * PIXELS_PER_MINUTE;
    const cardWidth = Math.max(46, row.duration * PIXELS_PER_MINUTE);
    card.className = `timeline-card ${isBreak(row) ? "break-card" : ""} ${row.id === selectedId ? "selected" : ""}`.trim();
    card.dataset.id = row.id;
    card.style.left = `${left}px`;
    card.style.width = `${cardWidth}px`;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    const leftHandle = document.createElement("div");
    leftHandle.className = "resize-handle left";
    leftHandle.dataset.mode = "resize-left";

    const rightHandle = document.createElement("div");
    rightHandle.className = "resize-handle right";
    rightHandle.dataset.mode = "resize-right";

    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = cardTitle(row);
    const time = document.createElement("div");
    time.className = "card-time";
    time.textContent = `${formatTime(row.start)}-${formatTime(row.start + row.duration)} / ${row.duration}分`;
    body.append(title, time);

    card.append(leftHandle, body, rightHandle);
    card.addEventListener("pointerdown", (event) => startDrag(event, row));
    card.addEventListener("keydown", (event) => nudgeCard(event, row));
    cards.appendChild(card);
  });

  elements.cardsLayer.replaceChildren(cards);
}

function renderTicks(rangeStart, rangeEnd) {
  const ticks = document.createDocumentFragment();
  const firstTick = Math.ceil(rangeStart / 30) * 30;
  for (let minute = firstTick; minute <= rangeEnd; minute += 30) {
    const tick = document.createElement("div");
    const major = minute % 60 === 0;
    tick.className = `tick ${major ? "major" : ""}`.trim();
    tick.style.left = `${(minute - rangeStart) * PIXELS_PER_MINUTE}px`;
    ticks.appendChild(tick);

    if (major) {
      const label = document.createElement("div");
      label.className = "tick-label";
      label.style.left = tick.style.left;
      label.textContent = formatTime(minute);
      ticks.appendChild(label);
    }
  }
  elements.ticksLayer.replaceChildren(ticks);
}

function printSchedule(orientation) {
  applyPrintOrientation(orientation);
  renderPrintSheet();
  window.print();
}

function applyPrintOrientation(orientation) {
  const pageOrientation = orientation === "landscape" ? "landscape" : "portrait";
  let style = document.querySelector("#printOrientationStyle");
  if (!style) {
    style = document.createElement("style");
    style.id = "printOrientationStyle";
    document.head.appendChild(style);
  }
  style.textContent = `@media print { @page { size: A4 ${pageOrientation}; margin: 10mm; } }`;
}

function renderPrintSheet() {
  const printColumns = state.columns.filter((column) => column.print !== false);
  elements.printTitle.textContent = state.tableTitle || "撮影スケジュール";
  elements.printDate.textContent = state.shootDate ? `撮影日: ${formatDateJapanese(state.shootDate)}` : "";
  elements.printPlace.textContent = state.shootPlace ? `撮影場所: ${state.shootPlace}` : "";
  renderColgroup(elements.printColgroup, printColumns);
  const header = document.createDocumentFragment();
  printColumns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column.label;
    header.appendChild(th);
  });
  elements.printHeader.replaceChildren(header);

  const fragment = document.createDocumentFragment();
  sortedRowsByStart()
    .forEach((row) => {
      const tr = document.createElement("tr");
      if (isBreak(row)) tr.className = "break-row";
      printColumns.forEach((column) => {
        const td = document.createElement("td");
        td.textContent = valueForColumn(row, column);
        const fmt = (row.formats && row.formats[column.id]) || {};
        if (fmt.bold) td.style.fontWeight = "700";
        if (fmt.color) td.style.color = fmt.color;
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
  elements.printBody.replaceChildren(fragment);
}

function startDrag(event, row) {
  const handleMode = event.target.dataset.mode;
  selectedId = row.id;
  dragSession = {
    id: row.id,
    mode: handleMode || "move",
    originX: event.clientX,
    start: row.start,
    duration: row.duration,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add("dragging");
  renderTable();
}

function startColumnResize(event, leftColumn, rightColumn) {
  if (!rightColumn) return;
  event.preventDefault();
  event.stopPropagation();
  columnResizeSession = {
    mode: "columns",
    leftId: leftColumn.id,
    rightId: rightColumn.id,
    originX: event.clientX,
    leftWidth: getColumnWidthById(leftColumn.id),
    rightWidth: getColumnWidthById(rightColumn.id),
    leftMin: minWidthForColumn(leftColumn.id),
    rightMin: minWidthForColumn(rightColumn.id),
  };
  document.body.classList.add("resizing-column");
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function startTableResize(event) {
  event.preventDefault();
  event.stopPropagation();
  columnResizeSession = {
    mode: "table",
    originX: event.clientX,
    tableWidth: tableWidth(visibleTableColumns(), true),
  };
  document.body.classList.add("resizing-column");
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
  if (columnResizeSession) {
    resizeColumnFromPointer(event);
    return;
  }
  if (!dragSession) return;
  const row = findRow(dragSession.id);
  if (!row) return;

  const deltaMinutes = snapMinutes((event.clientX - dragSession.originX) / PIXELS_PER_MINUTE);
  if (dragSession.mode === "move") {
    row.start = clampMinutes(dragSession.start + deltaMinutes, state.dayStart, state.dayEnd - row.duration);
  }
  if (dragSession.mode === "resize-right") {
    row.duration = Math.max(MIN_DURATION, dragSession.duration + deltaMinutes);
    row.duration = Math.min(row.duration, state.dayEnd - row.start);
  }
  if (dragSession.mode === "resize-left") {
    const proposedStart = clampMinutes(dragSession.start + deltaMinutes, state.dayStart, dragSession.start + dragSession.duration - MIN_DURATION);
    const originalEnd = dragSession.start + dragSession.duration;
    row.start = proposedStart;
    row.duration = Math.max(MIN_DURATION, originalEnd - proposedStart);
  }

  renderTable();
  renderTimeline();
  renderPrintSheet();
  saveStateSoon();
}

function onPointerUp() {
  if (columnResizeSession) {
    columnResizeSession = null;
    document.body.classList.remove("resizing-column");
    saveAndRender();
    return;
  }
  if (!dragSession) return;
  dragSession = null;
  saveAndRender();
}

function resizeColumnFromPointer(event) {
  if (columnResizeSession.mode === "table") {
    resizeTableFromPointer(event);
    return;
  }
  const delta = event.clientX - columnResizeSession.originX;
  const minDelta = columnResizeSession.leftMin - columnResizeSession.leftWidth;
  const maxDelta = columnResizeSession.rightWidth - columnResizeSession.rightMin;
  const clampedDelta = Math.min(maxDelta, Math.max(minDelta, Math.round(delta)));
  setColumnWidthById(columnResizeSession.leftId, columnResizeSession.leftWidth + clampedDelta);
  setColumnWidthById(columnResizeSession.rightId, columnResizeSession.rightWidth - clampedDelta);
  state.tableWidth = Math.max(normalizeTableWidth(state.tableWidth), tableWidth(visibleTableColumns(), true));
  updateColumnWidthsOnly();
  saveStateSoon();
}

function resizeTableFromPointer(event) {
  const delta = Math.round(event.clientX - columnResizeSession.originX);
  const minimum = baseScheduleTableWidth(visibleTableColumns());
  state.tableWidth = normalizeTableWidth(Math.max(minimum, columnResizeSession.tableWidth + delta));
  updateColumnWidthsOnly();
  saveStateSoon();
}

function onGlobalKeyDown(event) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    undoLastState();
    return;
  }
  if (key === "y") {
    event.preventDefault();
    redoLastState();
    return;
  }
  if (key === "b") {
    event.preventDefault();
    applyBoldToggle();
  }
}

function nudgeCard(event, row) {
  const step = state.snapMinutes || 5;
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const delta = event.key === "ArrowLeft" ? -step : step;
  row.start = clampMinutes(row.start + delta, state.dayStart, state.dayEnd - row.duration);
  selectedId = row.id;
  saveAndRender();
}

function updateDurationInput(row, input, delta) {
  row.duration = Math.max(MIN_DURATION, Math.round(row.duration + delta));
  input.value = String(row.duration);
  selectedId = row.id;
  saveStateSoon();
  renderTimeline();
  renderPrintSheet();
}

function applyTimeEdit(row, field, parsed) {
  if (field === "start") {
    row.start = parsed;
  }
  if (field === "end") {
    row.duration = Math.max(MIN_DURATION, parsed - row.start);
  }
}

function updateRow(id, field, rawValue) {
  const row = findRow(id);
  if (!row) return;

  if (field === "start") {
    const parsed = parseTime(rawValue);
    if (parsed !== null) row.start = parsed;
  } else if (field === "end") {
    const parsed = parseTime(rawValue);
    if (parsed !== null) row.duration = Math.max(MIN_DURATION, parsed - row.start);
  } else if (field === "duration") {
    row.duration = Math.max(MIN_DURATION, Number(rawValue) || MIN_DURATION);
  } else {
    row[field] = rawValue;
  }

  selectedId = id;
  saveAndRender();
}

function addRow() {
  const sorted = sortedRowsByStart();
  const last = sorted[sorted.length - 1];
  const nextStart = last ? last.start + last.duration : state.dayStart;
  const row = createRow(formatTime(Math.min(nextStart, state.dayEnd - 50)), 50, "", "", "", "");
  state.rows.push(row);
  selectedId = row.id;
  selectedRowIds = new Set([row.id]);
  selectionAnchorId = row.id;
  saveAndRender();
}

function duplicateSelected() {
  const row = findRow(selectedId);
  if (!row) return;
  const copy = {
    ...row,
    extras: { ...(row.extras || {}) },
    formats: { ...(row.formats || {}) },
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    start: Math.min(row.start + row.duration, state.dayEnd - row.duration),
  };
  state.rows.push(copy);
  selectedId = copy.id;
  selectedRowIds = new Set([copy.id]);
  selectionAnchorId = copy.id;
  saveAndRender();
}

function removeRow(id) {
  state.rows = state.rows.filter((row) => row.id !== id);
  if (selectedId === id) selectedId = state.rows[0]?.id ?? null;
  selectedRowIds.delete(id);
  if (selectedRowIds.size === 0 && selectedId) selectedRowIds = new Set([selectedId]);
  if (selectionAnchorId === id) selectionAnchorId = selectedId;
  saveAndRender();
}

function renderColumnsDialog() {
  const fragment = document.createDocumentFragment();
  state.columns.forEach((column, index) => {
    const row = document.createElement("div");
    row.className = `column-row ${column.required ? "locked" : ""}`.trim();
    const canHideInTable = column.id === "end" || !REQUIRED_COLUMN_IDS.has(column.id);

    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = column.required ? "列名（固定列）" : "列名";
    const input = document.createElement("input");
    input.type = "text";
    input.value = column.label;
    input.addEventListener("input", () => {
      column.label = input.value || "無題";
      saveStateSoon();
      renderTable();
      renderPrintSheet();
    });
    label.append(caption, input);

    const widthLabel = document.createElement("label");
    widthLabel.className = "column-width";
    const widthCaption = document.createElement("span");
    widthCaption.textContent = "幅";
    const widthInput = document.createElement("input");
    widthInput.type = "number";
    widthInput.min = String(MIN_COLUMN_WIDTH);
    widthInput.step = "1";
    widthInput.value = String(normalizeColumnWidth(column.width));
    widthInput.addEventListener("input", () => {
      column.width = normalizeColumnWidth(widthInput.value);
      saveStateSoon();
      renderTable();
      renderPrintSheet();
    });
    widthLabel.append(widthCaption, widthInput);

    const visibleLabel = document.createElement("label");
    visibleLabel.className = "column-print";
    const visibleInput = document.createElement("input");
    visibleInput.type = "checkbox";
    visibleInput.checked = column.visible !== false;
    visibleInput.disabled = !canHideInTable;
    visibleInput.addEventListener("change", () => {
      column.visible = visibleInput.checked;
      saveStateSoon();
      renderTable();
    });
    visibleLabel.append(visibleInput, document.createTextNode("表"));

    const printLabel = document.createElement("label");
    printLabel.className = "column-print";
    const printInput = document.createElement("input");
    printInput.type = "checkbox";
    printInput.checked = column.print !== false;
    printInput.addEventListener("change", () => {
      column.print = printInput.checked;
      saveStateSoon();
      renderPrintSheet();
    });
    printLabel.append(printInput, document.createTextNode("印刷"));

    const moveGroup = document.createElement("div");
    moveGroup.className = "column-move";
    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.textContent = "上へ";
    upButton.disabled = index === 0;
    upButton.addEventListener("click", () => moveColumn(index, -1));
    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.textContent = "下へ";
    downButton.disabled = index === state.columns.length - 1;
    downButton.addEventListener("click", () => moveColumn(index, 1));
    moveGroup.append(upButton, downButton);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "削除";
    deleteButton.disabled = REQUIRED_COLUMN_IDS.has(column.id);
    deleteButton.addEventListener("click", () => removeColumn(column.id));

    row.append(label, widthLabel, visibleLabel, printLabel, moveGroup, deleteButton);
    fragment.appendChild(row);
  });
  elements.columnsList.replaceChildren(fragment);
}

function addColumnFromDialog() {
  const label = elements.newColumnInput.value.trim();
  if (!label) return;
  const id = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  state.columns.push({ id, label, type: "textarea", visible: true, print: true, width: DEFAULT_CUSTOM_COLUMN_WIDTH });
  state.rows.forEach((row) => {
    row.extras ||= {};
    row.extras[id] = "";
  });
  elements.newColumnInput.value = "";
  saveAndRender();
  renderColumnsDialog();
}

function moveColumn(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= state.columns.length) return;
  const [column] = state.columns.splice(index, 1);
  state.columns.splice(nextIndex, 0, column);
  saveAndRender();
  renderColumnsDialog();
}

function removeColumn(id) {
  if (REQUIRED_COLUMN_IDS.has(id)) return;
  state.columns = state.columns.filter((column) => column.id !== id);
  if (isCustomColumn(id)) {
    state.rows.forEach((row) => {
      if (row.extras) delete row.extras[id];
    });
  }
  saveAndRender();
  renderColumnsDialog();
}

function startHeaderDrag(event, column) {
  if (event.target.closest(".column-resizer")) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", column.id);
  event.currentTarget.classList.add("drag-source");
}

function dropHeaderColumn(event, targetColumn) {
  event.preventDefault();
  const draggedId = event.dataTransfer.getData("text/plain");
  const afterTarget = event.offsetX > event.currentTarget.clientWidth / 2;
  moveColumnToTarget(draggedId, targetColumn.id, afterTarget);
  clearHeaderDragState();
}

function clearHeaderDragState() {
  document.querySelectorAll(".column-header").forEach((header) => {
    header.classList.remove("drag-source", "drag-over");
  });
}

function moveColumnToTarget(draggedId, targetId, afterTarget = false) {
  if (!draggedId || draggedId === targetId) return;
  const fromIndex = state.columns.findIndex((column) => column.id === draggedId);
  if (fromIndex === -1) return;
  const [column] = state.columns.splice(fromIndex, 1);
  const targetIndex = state.columns.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) {
    state.columns.push(column);
  } else {
    state.columns.splice(targetIndex + (afterTarget ? 1 : 0), 0, column);
  }
  saveAndRender();
  if (elements.columnsDialog.open) renderColumnsDialog();
}

function findRow(id) {
  return state.rows.find((row) => row.id === id);
}

function findColumn(id) {
  return state.columns.find((column) => column.id === id);
}

function sortedRowsByStart(rows = state.rows) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.start - b.row.start || a.index - b.index)
    .map((entry) => entry.row);
}

function selectRow(rowId, event = {}) {
  const isToggle = event.ctrlKey || event.metaKey;
  const isRange = event.shiftKey;

  if (isRange && selectionAnchorId) {
    const order = sortedRowsByStart().map((row) => row.id);
    const anchorIndex = order.indexOf(selectionAnchorId);
    const targetIndex = order.indexOf(rowId);
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [from, to] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      selectedRowIds = new Set(order.slice(from, to + 1));
    } else {
      selectedRowIds = new Set([rowId]);
    }
    selectedId = rowId;
    return;
  }

  if (isToggle) {
    const next = new Set(selectedRowIds);
    if (next.has(rowId)) {
      next.delete(rowId);
    } else {
      next.add(rowId);
    }
    if (next.size === 0) next.add(rowId);
    selectedRowIds = next;
    selectedId = rowId;
    selectionAnchorId = rowId;
    return;
  }

  selectedRowIds = new Set([rowId]);
  selectedId = rowId;
  selectionAnchorId = rowId;
}

function pruneSelection() {
  selectedRowIds = new Set([...selectedRowIds].filter((id) => state.rows.some((row) => row.id === id)));
  if (!state.rows.some((row) => row.id === selectedId)) {
    selectedId = state.rows[0]?.id ?? null;
  }
  if (selectedRowIds.size === 0 && selectedId) selectedRowIds = new Set([selectedId]);
  if (!selectionAnchorId || !selectedRowIds.has(selectionAnchorId)) selectionAnchorId = selectedId;
}

function isBreak(row) {
  const extraText = Object.values(row.extras || {}).join(" ");
  return /休憩|break/i.test(`${row.person} ${row.content} ${row.note} ${extraText}`);
}

function cardTitle(row) {
  if (isBreak(row)) return "休憩";
  return row.person || row.content || "撮影予定";
}

function isCustomColumn(id) {
  return !["start", "duration", "end", "person", "content", "place", "note"].includes(id);
}

function valueForColumn(row, column) {
  if (column.id === "start") return formatTime(row.start);
  if (column.id === "duration") return `${row.duration}分`;
  if (column.id === "end") return formatTime(row.start + row.duration);
  if (isCustomColumn(column.id)) return row.extras?.[column.id] || "";
  return row[column.id] || "";
}

function snapMinutes(value) {
  const snap = state.snapMinutes || 5;
  return Math.round(value / snap) * snap;
}

function parseTime(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseTimeEntry(value, allowShort) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const withColon = parseTime(trimmed);
  if (withColon !== null) return withColon;

  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 4) {
    return parseTime(`${digits.slice(0, 2)}:${digits.slice(2)}`);
  }
  if (allowShort && digits.length === 3) {
    return parseTime(`${digits.slice(0, 1)}:${digits.slice(1)}`);
  }
  if (allowShort && digits.length >= 1 && digits.length <= 2) {
    return parseTime(`${digits}:00`);
  }
  return null;
}

function formatTime(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDateJapanese(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date.getMonth() + 1}/${date.getDate()}(${weekdays[date.getDay()]})`;
}

function clampMinutes(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeColumnWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return DEFAULT_CUSTOM_COLUMN_WIDTH;
  return Math.min(420, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function normalizeActionColumnWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return DEFAULT_ACTION_COLUMN_WIDTH;
  return Math.min(MAX_ACTION_COLUMN_WIDTH, Math.max(MIN_ACTION_COLUMN_WIDTH, Math.round(width)));
}

function normalizeTableWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return SCHEDULE_TABLE_DEFAULT_WIDTH;
  return Math.min(MAX_SCHEDULE_TABLE_WIDTH, Math.max(SCHEDULE_TABLE_MIN_WIDTH, Math.round(width)));
}

let saveTimer = null;
function saveStateSoon() {
  window.clearTimeout(saveTimer);
  elements.saveStatus.textContent = "保存中...";
  saveTimer = window.setTimeout(() => {
    commitStateForUndo();
    localStorage.setItem(STORAGE_KEY, committedStateJson);
    elements.saveStatus.textContent = "保存済み";
    scheduleCloudPush();
  }, 180);
}

function saveAndRender() {
  window.clearTimeout(saveTimer);
  commitStateForUndo();
  localStorage.setItem(STORAGE_KEY, committedStateJson);
  elements.saveStatus.textContent = "保存済み";
  render();
  scheduleCloudPush();
}

function scheduleCloudPush() {
  if (!supabaseClient || isApplyingRemoteChange) return;
  window.clearTimeout(cloudPushTimer);
  cloudPushTimer = window.setTimeout(() => {
    pushToCloud();
  }, 600);
}

function commitStateForUndo() {
  const currentJson = JSON.stringify(state);
  if (currentJson === committedStateJson) return;
  if (undoStack[undoStack.length - 1] !== committedStateJson) {
    undoStack.push(committedStateJson);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  redoStack = [];
  committedStateJson = currentJson;
}

function undoLastState() {
  window.clearTimeout(saveTimer);
  const previousJson = undoStack.pop();
  if (!previousJson) {
    elements.saveStatus.textContent = "戻せる履歴はありません";
    return;
  }
  try {
    redoStack.push(committedStateJson);
    if (redoStack.length > HISTORY_LIMIT) redoStack.shift();
    state = normalizeState(JSON.parse(previousJson));
    committedStateJson = JSON.stringify(state);
    pruneSelection();
    localStorage.setItem(STORAGE_KEY, committedStateJson);
    elements.saveStatus.textContent = "1つ前に戻しました";
    render();
    scheduleCloudPush();
  } catch {
    elements.saveStatus.textContent = "履歴を戻せませんでした";
  }
}

function redoLastState() {
  window.clearTimeout(saveTimer);
  const nextJson = redoStack.pop();
  if (!nextJson) {
    elements.saveStatus.textContent = "やり直せる履歴はありません";
    return;
  }
  try {
    undoStack.push(committedStateJson);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    state = normalizeState(JSON.parse(nextJson));
    committedStateJson = JSON.stringify(state);
    pruneSelection();
    localStorage.setItem(STORAGE_KEY, committedStateJson);
    elements.saveStatus.textContent = "1つ先の状態に進みました";
    render();
    scheduleCloudPush();
  } catch {
    elements.saveStatus.textContent = "履歴をやり直せませんでした";
  }
}

function saveCloudConfig() {
  const config = {
    url: elements.supabaseUrlInput.value.trim(),
    key: elements.supabaseKeyInput.value.trim(),
    workspaceId: elements.workspaceIdInput.value.trim() || "shooting-main",
    editorName: elements.editorNameInput.value.trim(),
  };
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
}

function loadCloudConfig() {
  try {
    const config = JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || "{}");
    elements.supabaseUrlInput.value = config.url || "";
    elements.supabaseKeyInput.value = config.key || "";
    elements.workspaceIdInput.value = config.workspaceId || "shooting-main";
    elements.editorNameInput.value = config.editorName || "";
    elements.cloudStatus.textContent = config.url && config.key ? "接続情報あり" : "未接続";
  } catch {
    elements.workspaceIdInput.value = "shooting-main";
  }
}

function getCloudConfig() {
  const url = elements.supabaseUrlInput.value.trim().replace(/\/$/, "");
  const key = elements.supabaseKeyInput.value.trim();
  const workspaceId = elements.workspaceIdInput.value.trim() || "shooting-main";
  const editorName = elements.editorNameInput.value.trim();
  if (!url || !key || !workspaceId) {
    throw new Error("Supabase URL、Anon key、共有IDを入力してください。");
  }
  return { url, key, workspaceId, editorName };
}

function getSupabaseClient() {
  const config = getCloudConfig();

  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(config.url, config.key);
  }

  return { client: supabaseClient, config };
}

function connectRealtime() {
  const { client, config } = getSupabaseClient();

  if (realtimeChannel) {
    client.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = client
    .channel(`shooting-schedule-${config.workspaceId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "shooting_schedule_docs",
        filter: `workspace_id=eq.${config.workspaceId}`,
      },
      handleRealtimePayload
    )
    .subscribe((status) => {
      elements.cloudStatus.textContent = `Realtime: ${status}`;
    });
}

function handleRealtimePayload(payload) {
  if (payload.eventType === "DELETE") return;

  const remoteState = payload.new?.payload;
  if (!remoteState) return;

  const normalizedRemoteState = normalizeState(remoteState);
  const remoteJson = JSON.stringify(normalizedRemoteState);

  if (remoteJson === committedStateJson) return;

  if (isEditingScheduleCell()) {
    pendingRemoteState = normalizedRemoteState;
    elements.saveStatus.textContent = "他の人の変更があります";
    return;
  }

  applyRemoteState(normalizedRemoteState);
}

function applyRemoteState(remoteState) {
  isApplyingRemoteChange = true;

  state = normalizeState(remoteState);
  committedStateJson = JSON.stringify(state);

  pruneSelection();

  localStorage.setItem(STORAGE_KEY, committedStateJson);
  render();

  elements.saveStatus.textContent = "他の人の変更を反映しました";

  isApplyingRemoteChange = false;
}

function applyPendingRemoteState() {
  if (!pendingRemoteState) return;

  const nextState = pendingRemoteState;
  pendingRemoteState = null;

  applyRemoteState(nextState);
}

function isEditingScheduleCell() {
  return document.activeElement?.matches(
    ".schedule-table input, .schedule-table textarea"
  );
}

async function pushToCloud() {
  try {
    saveCloudConfig();
    const config = getCloudConfig();
    elements.cloudStatus.textContent = "保存中...";
    const response = await fetch(`${config.url}/rest/v1/shooting_schedule_docs?on_conflict=workspace_id`, {
      method: "POST",
      headers: cloudHeaders(config, "resolution=merge-duplicates,return=representation"),
      body: JSON.stringify({
        workspace_id: config.workspaceId,
        payload: state,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    elements.cloudStatus.textContent = "クラウドへ保存済み";
    pushHistorySnapshot(config);
  } catch (error) {
    elements.cloudStatus.textContent = `保存できませんでした: ${shortError(error)}`;
  }
}

async function pushHistorySnapshot(config) {
  try {
    await fetch(`${config.url}/rest/v1/shooting_schedule_history`, {
      method: "POST",
      headers: cloudHeaders(config, "return=minimal"),
      body: JSON.stringify({
        workspace_id: config.workspaceId,
        payload: state,
        editor_name: config.editorName || null,
      }),
    });
  } catch {
    // 履歴保存の失敗は通常の保存処理を妨げない
  }
}

async function openHistory() {
  try {
    const config = getCloudConfig();
    elements.historyStatus.textContent = "読み込み中...";
    const query = `workspace_id=eq.${encodeURIComponent(config.workspaceId)}&select=id,payload,editor_name,created_at&order=created_at.desc&limit=${HISTORY_LIMIT}`;
    const response = await fetch(`${config.url}/rest/v1/shooting_schedule_history?${query}`, {
      method: "GET",
      headers: cloudHeaders(config),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    renderHistoryList(data);
    elements.historyStatus.textContent = data.length ? `${data.length}件の履歴` : "履歴はまだありません";
  } catch (error) {
    elements.historyList.innerHTML = "";
    elements.historyStatus.textContent = `読み込めませんでした: ${shortError(error)}`;
  }
}

function renderHistoryList(entries) {
  elements.historyList.innerHTML = "";
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "history-row";

    const info = document.createElement("div");
    info.className = "history-info";

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatHistoryTime(entry.created_at);

    const editor = document.createElement("span");
    editor.className = "history-editor";
    editor.textContent = entry.editor_name ? `編集者: ${entry.editor_name}` : "編集者: 不明";

    info.appendChild(time);
    info.appendChild(editor);

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.textContent = "この状態に戻す";
    restoreBtn.addEventListener("click", () => restoreHistoryEntry(entry));

    row.appendChild(info);
    row.appendChild(restoreBtn);
    elements.historyList.appendChild(row);
  });
}

function formatHistoryTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function restoreHistoryEntry(entry) {
  if (!entry.payload) return;
  if (!window.confirm(`${formatHistoryTime(entry.created_at)} の状態に戻しますか？`)) return;

  state = normalizeState(entry.payload);
  selectedId = state.rows[0]?.id ?? null;
  selectedRowIds = new Set(selectedId ? [selectedId] : []);
  selectionAnchorId = selectedId;
  saveAndRender();
  elements.historyDialog.close();
}

async function pullFromCloud() {
  try {
    saveCloudConfig();
    const config = getCloudConfig();
    elements.cloudStatus.textContent = "読み込み中...";
    const query = `workspace_id=eq.${encodeURIComponent(config.workspaceId)}&select=payload,updated_at`;
    const response = await fetch(`${config.url}/rest/v1/shooting_schedule_docs?${query}`, {
      method: "GET",
      headers: cloudHeaders(config),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    if (!data.length || !data[0].payload) throw new Error("クラウドにデータがありません。");
    state = normalizeState(data[0].payload);
    selectedId = state.rows[0]?.id ?? null;
    selectedRowIds = new Set(selectedId ? [selectedId] : []);
    selectionAnchorId = selectedId;
    saveAndRender();

    connectRealtime();

    elements.cloudStatus.textContent = "クラウドから読み込み済み / Realtime接続中";
  } catch (error) {
    elements.cloudStatus.textContent = `読み込めませんでした: ${shortError(error)}`;
  }
}

function cloudHeaders(config, prefer) {
  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function shortError(error) {
  const message = error?.message || String(error);
  return message.length > 90 ? `${message.slice(0, 90)}...` : message;
}
