(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const treeRoot = $("#tree-root");
  const editor = $("#editor");
  const searchInput = $("#search-input");
  const searchResults = $("#search-results");
  const saveState = $("#save-state");
  const backBtn = $("#back-btn");
  const undoBtn = $("#undo-btn");
  const redoBtn = $("#redo-btn");

  let tree = [];
  let currentFile = null;
  let dirty = false;
  let saveTimer = null;
  let currentGalaxyPath = "";
  const openState = new Map();
  let booted = false;

  const THEME_KEY = "astro-theme";
  const SHIP_SPEED_KEY = "astro-ship-speed";
  const SHIP_SPEED_DEFAULT = 0.2;
  const THEMES = [
    { id: "astro", label: "Astro (dark)" },
    { id: "dracula", label: "Dracula" },
  ];

  function shipSpeed() {
    const v = parseFloat(localStorage.getItem(SHIP_SPEED_KEY));
    if (Number.isFinite(v)) return Math.min(1, Math.max(0.05, v));
    return SHIP_SPEED_DEFAULT;
  }

  function applyTheme(id) {
    const theme = id === "dracula" ? "dracula" : "astro";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    return theme;
  }

  applyTheme(localStorage.getItem(THEME_KEY));

  async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = {};
    try {
      data = await res.json();
    } catch (e) {}
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  // ---------- Mobile drawer + tabs ----------

  const menuBtn = $("#menu-btn");
  const backdrop = $("#backdrop");

  function closeDrawer() {
    document.body.classList.remove("sidebar-open");
    backdrop.classList.remove("show");
    if (topbarMQ.matches) {
      searchInput.value = "";
      searchResults.classList.add("hidden");
    }
  }

  menuBtn.addEventListener("click", () => {
    const open = document.body.classList.toggle("sidebar-open");
    backdrop.classList.toggle("show", open);
  });

  backdrop.addEventListener("click", closeDrawer);
  $("#sidebar-close").addEventListener("click", closeDrawer);

  const topbarMQ = window.matchMedia("(max-width: 768px)");

  function layoutMobileTopbar() {
    const sidebarTools = $("#sidebar-tools");
    if (topbarMQ.matches) {
      sidebarTools.append(redoBtn, searchInput, $("#galaxy-btn"), $("#settings-btn"));
      sidebarTools.appendChild(searchResults);
    } else {
      undoBtn.after(redoBtn);
      $("#graph-btn").after($("#galaxy-btn"), $("#settings-btn"));
      saveState.before(searchInput);
      document.body.appendChild(searchResults);
    }
  }

  if (topbarMQ.addEventListener) topbarMQ.addEventListener("change", layoutMobileTopbar);
  else topbarMQ.addListener(layoutMobileTopbar);
  layoutMobileTopbar();

  // ---------- Tree ----------

  async function loadTree() {
    try {
      const data = await api("GET", "/api/tree");
      tree = data.tree;
      renderTree();
      LiveEditor.setNotes(collectFiles(tree));
      return true;
    } catch (e) {
      return false;
    }
  }

  function renderTree() {
    const sidebar = $("#sidebar");
    const scrollTop = sidebar.scrollTop;
    treeRoot.innerHTML = "";
    if (!tree.length) {
      treeRoot.innerHTML = '<div class="empty">empty galaxy — use "+ Planet"</div>';
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "tree";
    tree.forEach((entry) => ul.appendChild(renderEntry(entry)));
    treeRoot.appendChild(ul);
    sidebar.scrollTop = scrollTop;
  }

  function renderEntry(entry) {
    const li = document.createElement("li");
    li.dataset.path = entry.path;
    const row = document.createElement("div");
    row.className = "row";
    if (entry.type === "star") {
      li.classList.add("star");
      const isOpen = !openState.has(entry.path) || openState.get(entry.path);
      if (isOpen) li.classList.add("open");
      const twist = document.createElement("span");
      twist.className = "twist";
      twist.textContent = isOpen ? "▾" : "▸";
      const icon = document.createElement("span");
      icon.className = "star-icon";
      icon.textContent = "★";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = entry.path.split("/").pop();
      row.append(twist, icon, name);
      row.appendChild(actions(li, entry));
      row.addEventListener("pointerdown", (e) => startRowDrag(li, entry, e));
      li.appendChild(row);
      const childUl = document.createElement("ul");
      (entry.children || []).forEach((child) => childUl.appendChild(renderEntry(child)));
      li.appendChild(childUl);
      if (!isOpen) childUl.style.display = "none";
      twist.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = li.classList.toggle("open");
        openState.set(entry.path, open);
        twist.textContent = open ? "▾" : "▸";
        childUl.style.display = open ? "" : "none";
      });
      li.addEventListener("click", (e) => {
        if (e.target.closest(".actions")) return;
        if (isClickSuppressed(e)) return;
        if (!row.contains(e.target)) return;
        twist.click();
      });
    } else {
      const icon = document.createElement("span");
      icon.className = "planet-icon";
      icon.textContent = "●";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = entry.path.split("/").pop();
      row.append(icon, name);
      row.appendChild(actions(li, entry));
      row.addEventListener("pointerdown", (e) => startRowDrag(li, entry, e));
      li.appendChild(row);
      li.addEventListener("click", (e) => {
        if (e.target.closest(".actions")) return;
        if (isClickSuppressed(e)) return;
        openFile(entry.path);
      });
    }
    return li;
  }

  function actions(li, entry) {
    const box = document.createElement("span");
    box.className = "actions";
    const mk = (label, fn, title) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title || label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      box.appendChild(b);
    };
    if (entry.type === "star") {
      mk("+p", () => createEntry("planet", entry.path), "New planet");
      mk("+s", () => createEntry("star", entry.path), "New star");
    }
    mk("✎", () => renameEntry(entry));
    mk("×", () => deleteEntry(entry));
    return box;
  }

  function collectFiles(list) {
    const files = [];
    list.forEach((e) => {
      if (e.type === "planet") files.push(e.path);
      else files.push(...collectFiles(e.children));
    });
    return files;
  }

  // ---------- File ops ----------

  $("#new-planet-btn").addEventListener("click", () => createEntry("planet", ""));
  $("#new-star-btn").addEventListener("click", () => createEntry("star", ""));
  $("#collapse-all-btn").addEventListener("click", () => {
    document.querySelectorAll(".tree li.star").forEach((li) => {
      li.classList.remove("open");
      openState.set(li.dataset.path, false);
      const t = li.querySelector(".twist");
      if (t) t.textContent = "▸";
      const child = li.querySelector(":scope > ul");
      if (child) child.style.display = "none";
    });
  });

  // ---------- Tree drag & drop ----------

  const LONG_PRESS_MS = 350;
  const DRAG_CANCEL_DIST = 8;
  const HOVER_EXPAND_MS = 600;
  const CLICK_SUPPRESS_MS = 400;

  let dragState = null;
  let suppressTreeClickUntil = 0;

  function isClickSuppressed(e) {
    if (performance.now() >= suppressTreeClickUntil) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  function parentDir(path) {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  }

  function startRowDrag(li, entry, e) {
    if (e.target.closest(".actions") || e.target.closest(".twist")) return;
    if (dragState) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType !== "mouse") e.preventDefault();
    const row = li.querySelector(".row") || li;
    dragState = {
      entry,
      li,
      row,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      ghost: null,
      rootZone: null,
      target: null,
      timer: null,
      expandTimer: null,
    };
    document.body.classList.add("dragging");
    li.classList.add("press");
    dragState.timer = setTimeout(() => activateDrag(dragState), LONG_PRESS_MS);
  }

  function activateDrag(s) {
    if (dragState !== s) return;
    s.timer = null;
    s.active = true;
    if (window.getSelection && window.getSelection().removeAllRanges) {
      window.getSelection().removeAllRanges();
    }
    s.row.classList.add("dragging-row");
    s.li.classList.remove("press");
    s.li.classList.add("dragging");
    if (s.pointerType === "touch" && navigator.vibrate) navigator.vibrate(10);
    try {
      s.row.setPointerCapture(s.pointerId);
    } catch (err) {}
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent =
      (s.entry.type === "star" ? "★ " : "● ") + s.entry.path.split("/").pop();
    document.body.appendChild(ghost);
    s.ghost = ghost;
    s.ghostW = ghost.offsetWidth;
    s.ghostH = ghost.offsetHeight;
    const zone = document.createElement("div");
    zone.className = "root-drop-zone";
    zone.textContent = "move to root";
    treeRoot.prepend(zone);
    s.rootZone = zone;
    positionGhost(s, s.startX, s.startY);
  }

  function positionGhost(s, x, y) {
    s.ghost.style.transform =
      "translate(" +
      (x - s.ghostW / 2).toFixed(0) +
      "px," +
      (y - s.ghostH - 18).toFixed(0) +
      "px)";
  }

  function documentPointerMove(e) {
    const s = dragState;
    if (!s || e.pointerId !== s.pointerId) return;
    if (!s.active) {
      if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > DRAG_CANCEL_DIST) {
        cleanupDrag(false);
      }
      return;
    }
    e.preventDefault();
    positionGhost(s, e.clientX, e.clientY);
    updateDropTarget(s, e.clientX, e.clientY);
    autoScrollTree(s, e.clientY);
  }

  function documentPointerUp(e) {
    const s = dragState;
    if (!s || e.pointerId !== s.pointerId) return;
    if (s.active) performDrop(s);
    cleanupDrag(s.active);
  }

  function documentPointerCancel(e) {
    const s = dragState;
    if (!s || e.pointerId !== s.pointerId) return;
    cleanupDrag(true);
  }

  function updateDropTarget(s, cx, cy) {
    clearTimeout(s.expandTimer);
    s.expandTimer = null;
    const el = document.elementFromPoint(cx, cy);
    let target = null;
    if (el && s.rootZone && s.rootZone.contains(el)) {
      target = { li: s.rootZone, folder: "" };
    } else if (el) {
      const li = el.closest(".tree li");
      if (li && li !== s.li) {
        const isStar = li.classList.contains("star");
        const folder = isStar ? li.dataset.path : parentDir(li.dataset.path);
        if (isStar || folder) target = { li, folder };
      }
    }
    if (target && s.entry.type === "star" && target.folder) {
      if (
        target.folder === s.entry.path ||
        target.folder.startsWith(s.entry.path + "/")
      ) {
        target = null;
      }
    }
    if (target && target.folder === parentDir(s.entry.path)) target = null;
    if (s.target !== target) {
      if (s.target && s.target.li) s.target.li.classList.remove("drop-target");
      s.target = target;
      if (s.target && s.target.li) s.target.li.classList.add("drop-target");
    }
    if (
      target &&
      target.li.classList.contains("star") &&
      !target.li.classList.contains("open")
    ) {
      s.expandTimer = setTimeout(() => expandStar(target.li), HOVER_EXPAND_MS);
    }
  }

  function expandStar(li) {
    const path = li.dataset.path;
    li.classList.add("open");
    openState.set(path, true);
    const t = li.querySelector(".twist");
    if (t) t.textContent = "▾";
    const child = li.querySelector(":scope > ul");
    if (child) child.style.display = "";
  }

  function autoScrollTree(s, cy) {
    const sidebar = $("#sidebar");
    const rect = sidebar.getBoundingClientRect();
    const edge = 32;
    if (cy < rect.top + edge) {
      sidebar.scrollTop -= 12;
    } else if (cy > rect.bottom - edge) {
      sidebar.scrollTop += 12;
    }
  }

  async function performDrop(s) {
    if (!s.target) return;
    const from = s.entry.path;
    const base = from.split("/").pop();
    const to = s.target.folder ? s.target.folder + "/" + base : base;
    if (to === from) return;
    try {
      if (dirty && currentFile) await saveFile();
      await api("POST", "/api/rename", { from, to });
      if (currentFile && (currentFile === from || currentFile.startsWith(from + "/"))) {
        currentFile = to + currentFile.slice(from.length);
        dirty = true;
      }
      await loadTree();
      if (currentFile) {
        const data = await api("GET", "/api/file?path=" + encodeURIComponent(currentFile));
        liveApply(data.content, 0);
        dirty = false;
        saveState.textContent = "";
      }
    } catch (err) {
      alert(err.message);
    }
  }

  function cleanupDrag(suppressClick) {
    const s = dragState;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    if (s.expandTimer) clearTimeout(s.expandTimer);
    if (s.target && s.target.li) s.target.li.classList.remove("drop-target");
    if (s.ghost) s.ghost.remove();
    if (s.rootZone) s.rootZone.remove();
    s.li.classList.remove("dragging", "press");
    s.row.classList.remove("dragging-row");
    dragState = null;
    document.body.classList.remove("dragging");
    if (suppressClick) suppressTreeClickUntil = performance.now() + CLICK_SUPPRESS_MS;
  }

  document.addEventListener("pointermove", documentPointerMove);
  document.addEventListener("pointerup", documentPointerUp);
  document.addEventListener("pointercancel", documentPointerCancel);
  document.addEventListener("selectstart", (e) => {
    if (dragState) e.preventDefault();
  });
  treeRoot.addEventListener("contextmenu", (e) => {
    if (dragState) e.preventDefault();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dragState) cleanupDrag(true);
  });

  backBtn.addEventListener("click", () => history.back());

  async function openFile(path, opts) {
    if (dirty && currentFile) await saveFile();
    const data = await api("GET", "/api/file?path=" + encodeURIComponent(path));
    currentFile = path;
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoButtons();
    liveApply(data.content, 0);
    editor.scrollTop = 0;
    dirty = false;
    saveState.textContent = "";
    document.querySelectorAll(".tree li").forEach((li) => li.classList.remove("selected"));
    const li = document.querySelector(`.tree li[data-path="${CSS.escape(path)}"]`);
    if (li) li.classList.add("selected");
    closeDrawer();
    editor.focus();
    if (!opts || !opts.noHistory) {
      if (!booted) {
        history.replaceState({ note: path, depth: 0 }, "", "#" + encodeURIComponent(path));
        booted = true;
      } else {
        const depth = history.state && typeof history.state.depth === "number" ? history.state.depth : 0;
        history.pushState({ note: path, depth: depth + 1 }, "", "#" + encodeURIComponent(path));
      }
      updateBackBtn();
    }
  }

  function updateBackBtn() {
    const d = history.state && typeof history.state.depth === "number" ? history.state.depth : 0;
    backBtn.disabled = d <= 0;
  }

  window.addEventListener("popstate", () => {
    updateBackBtn();
    const st = history.state;
    const path = st && st.note;
    if (path && path !== currentFile) {
      openFile(path, { noHistory: true }).catch(() => {});
    }
  });

  async function saveFile() {
    if (!currentFile) return;
    saveState.textContent = "saving…";
    try {
      await api("PUT", "/api/file?path=" + encodeURIComponent(currentFile), {
        content: LiveEditor.source(editor),
      });
      dirty = false;
      const t = new Date();
      saveState.textContent =
        "saved " + t.toTimeString().slice(0, 8);
    } catch (err) {
      saveState.textContent = "error";
    }
  }

  async function createEntry(type, folderPath) {
    const name = await promptInput(
      type === "planet" ? "New planet" : "New star",
      type === "planet" ? "untitled.md" : "new-star"
    );
    if (!name || !name.trim()) return;
    let path = name.trim();
    if (type === "planet" && !path.toLowerCase().endsWith(".md")) path += ".md";
    if (folderPath && !path.includes("/")) path = folderPath + "/" + path;
    try {
      if (type === "planet") {
        await api("POST", "/api/file", { path });
      } else {
        await api("POST", "/api/star", { path });
      }
      await loadTree();
      if (type === "planet") await openFile(path);
    } catch (err) {
      alert(err.message);
    }
  }

  async function renameEntry(entry) {
    const base = entry.path.split("/").pop();
    const name = await promptInput("Rename", base, "Rename");
    if (!name || !name.trim()) return;
    let to = name.trim();
    if (entry.type === "planet" && !to.toLowerCase().endsWith(".md")) to += ".md";
    const dir = parentDir(entry.path);
    if (dir && !to.includes("/")) to = dir + "/" + to;
    if (to === entry.path) return;
    try {
      if (dirty && currentFile) await saveFile();
      await api("POST", "/api/rename", { from: entry.path, to });
      if (currentFile && (currentFile === entry.path || currentFile.startsWith(entry.path + "/"))) {
        currentFile = entry.type === "planet" ? to : to + currentFile.slice(entry.path.length);
        dirty = true;
      }
      await loadTree();
      if (currentFile) {
        const data = await api("GET", "/api/file?path=" + encodeURIComponent(currentFile));
        liveApply(data.content, 0);
        dirty = false;
        saveState.textContent = "";
      }
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteEntry(entry) {
    const ok = await confirmBox(
      "Delete " + entry.type + "?",
      entry.path + (entry.type === "star" ? "\nThis cannot be undone." : "")
    );
    if (!ok) return;
    try {
      await api("DELETE", "/api/file?path=" + encodeURIComponent(entry.path));
      if (currentFile === entry.path || currentFile.startsWith(entry.path + "/")) {
        currentFile = null;
        editor.innerHTML = "";
        lastSource = "";
        dirty = false;
      }
      await loadTree();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- Live editor ----------

  let lastSource = "";
  let suppressSel = false;
  let selPending = false;
  let pendingCaret = null;
  const undoStack = [];
  const redoStack = [];

  function clampOffset(c, len) {
    if (typeof c !== "number" || !isFinite(c) || c < 0) return len;
    return Math.min(c, len);
  }

  function markDirty() {
    dirty = true;
    saveState.textContent = "unsaved";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveFile, 800);
  }

  function pushUndo(source, caret) {
    undoStack.push({ source, caret });
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }

  function updateUndoButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  function undo() {
    const entry = undoStack.pop();
    if (entry === undefined) return;
    const cur = LiveEditor.caretOffset(editor);
    redoStack.push({ source: lastSource, caret: cur >= 0 ? cur : lastSource.length });
    lastEditorAction = "caret";
    liveApply(entry.source, clampOffset(entry.caret, entry.source.length));
    markDirty();
    editor.focus();
    updateUndoButtons();
  }

  function redo() {
    const entry = redoStack.pop();
    if (entry === undefined) return;
    const cur = LiveEditor.caretOffset(editor);
    undoStack.push({ source: lastSource, caret: cur >= 0 ? cur : lastSource.length });
    lastEditorAction = "caret";
    liveApply(entry.source, clampOffset(entry.caret, entry.source.length));
    markDirty();
    editor.focus();
    updateUndoButtons();
  }

  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);

  function liveApply(source, caret) {
    const scrollTop = editor.scrollTop;
    editor.innerHTML = LiveEditor.render(source, caret);
    editor.scrollTop = scrollTop;
    if (caret >= 0) {
      LiveEditor.setCaret(editor, caret);
      suppressSel = true;
    }
    lastSource = source;
    if (caret >= 0) requestAnimationFrame(() => maybeShowAutocomplete(source, caret));
  }

  editor.addEventListener("beforeinput", (e) => {
    if (e.isComposing) return;
    if (e.inputType === "historyUndo") {
      e.preventDefault();
      undo();
      return;
    }
    if (e.inputType === "historyRedo") {
      e.preventDefault();
      redo();
      return;
    }
    pendingCaret = LiveEditor.caretOffset(editor);
  });

  editor.addEventListener("input", (e) => {
    if (e.isComposing) return;
    lastEditorAction = "input";
    const prev = lastSource;
    const offset = LiveEditor.caretOffset(editor);
    const md = LiveEditor.source(editor);
    if (md !== prev) {
      pushUndo(prev, pendingCaret != null ? pendingCaret : offset);
    }
    pendingCaret = null;
    liveApply(md, offset);
    markDirty();
  });

  editor.addEventListener("keydown", (e) => {
    if (ac && ac.items.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        acMove(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        acMove(-1);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acSelect(ac.items[ac.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeAc();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "Tab") {
      e.preventDefault();
      document.execCommand("insertText", false, "    ");
    }
  });

  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  });

  editor.addEventListener("drop", (e) => e.preventDefault());

  document.addEventListener("selectionchange", () => {
    if (suppressSel) {
      suppressSel = false;
      return;
    }
    if (selPending) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!editor.contains(r.startContainer)) return;
    if (!r.collapsed) return;
    selPending = true;
    requestAnimationFrame(() => {
      selPending = false;
      lastEditorAction = "caret";
      pendingCaret = null;
      const offset = LiveEditor.caretOffset(editor);
      const md = LiveEditor.source(editor);
      if (md !== lastSource) return;
      liveApply(md, offset);
    });
  });

  editor.addEventListener("click", (e) => {
    const wl = e.target.closest(".lp-wikilink");
    if (wl) {
      e.preventDefault();
      const file = LiveEditor.resolve(wl.dataset.note || "", currentFile);
      if (file) openFile(file);
      return;
    }
    const ext = e.target.closest(".lp-link");
    if (ext && ext.dataset.url) {
      e.preventDefault();
      const url = ext.dataset.url;
      if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
    }
  });

  // ---------- Galaxy graph ----------

  const graphBtn = $("#graph-btn");
  const graphOverlay = $("#graph-overlay");
  const graphSvg = $("#graph-svg");
  const graphClose = $("#graph-close");
  const graphPauseBtn = $("#graph-pause");
  const graphOrbitsBtn = $("#graph-orbits");
  let showOrbits = true;
  let graphAnim = null;
  let graphView = null;
  let graphHome = null;
  let sim = null;
  let graphBodies = [];
  let graphShipsLayer = null;

  const STAR_COLORS = [
    "#aabfff",
    "#cad7ff",
    "#f8f7ff",
    "#fdf4cf",
    "#fff4a8",
    "#ffddaa",
    "#ffb56b",
    "#ff8c6b",
  ];
  const PLANET_COLORS = [
    "#9c9c9c",
    "#e8cfa0",
    "#6b93d6",
    "#e27b58",
    "#d8b28c",
    "#e8d5a3",
    "#7fd4d4",
    "#4a68c4",
  ];
  const ORBIT_GAP = 8;
  const KEPLER_K = 45;
  const ECC_MAX = 0.12;
  const COMPRESS = 8;
  const TWO_PI = Math.PI * 2;
  const MIN_SCREEN_A = 0.7;

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function starColor(path) {
    return STAR_COLORS[hashStr(path) % STAR_COLORS.length];
  }

  function planetColor(path) {
    return PLANET_COLORS[hashStr(path) % PLANET_COLORS.length];
  }

  function planetRadius(size) {
    return Math.min(18, 2.5 + 1.1 * Math.pow(size || 0, 0.28));
  }

  function eccFor(path) {
    return ((hashStr(path + ":e") % 1000) / 1000) * ECC_MAX;
  }

  function phaseFor(path) {
    return ((hashStr(path + ":p") % 1000) / 1000) * Math.PI * 2;
  }

  function solveKepler(M, e) {
    if (!e) return M;
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 2; i++) {
      E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    return E;
  }

  function compressExtent(extent) {
    return Math.min(extent, COMPRESS * Math.sqrt(extent));
  }

  function computeRadii(node) {
    if (node.type === "planet") {
      node.r = planetRadius(node.size);
      return { r: node.r, maxPlanet: node.r };
    }
    let maxPlanet = 0;
    let maxChildStar = 0;
    node._children.forEach((c) => {
      const res = computeRadii(c);
      maxPlanet = Math.max(maxPlanet, res.maxPlanet);
      if (c.type === "star") maxChildStar = Math.max(maxChildStar, res.r);
    });
    node.r = Math.max(5 + 1.6 * maxPlanet, maxChildStar * 1.05 + 1);
    return { r: node.r, maxPlanet };
  }

  function assignOrbits(node) {
    node._children.forEach((c) => {
      if (c.type === "star") c.sysExtent = assignOrbits(c);
    });
    const planets = node._children
      .filter((c) => c.type === "planet")
      .sort((a, b) => a.r - b.r);
    const stars = node._children
      .filter((c) => c.type === "star")
      .sort((a, b) => a.sysExtent - b.sysExtent);
    let cum = node.r + ORBIT_GAP;
    let reach = 0;
    node._orbits = [];
    for (const child of planets.concat(stars)) {
      const e = eccFor(child.path);
      const bodyR =
        child.type === "planet" ? child.r : compressExtent(child.sysExtent);
      const aReq = (node.r + bodyR + ORBIT_GAP) / (1 - e);
      const aSeq = (cum + bodyR) / (1 + e);
      const a = Math.max(aReq, aSeq);
      node._orbits.push({ child, a, e, phi: phaseFor(child.path) });
      cum = a * (1 + e) + bodyR + ORBIT_GAP;
      reach = Math.max(
        reach,
        a * (1 + e) + (child.type === "planet" ? child.r : child.sysExtent)
      );
    }
    node.sysExtent = Math.max(node.r, reach);
    return node.sysExtent;
  }

  graphBtn.addEventListener("click", openGraph);
  graphClose.addEventListener("click", closeGraph);
  graphPauseBtn.addEventListener("click", () => {
    if (!sim) return;
    sim.userPaused = !sim.userPaused;
    if (sim.userPaused) {
      sim.running = false;
      cancelAnimationFrame(graphAnim);
      graphAnim = null;
      graphPauseBtn.textContent = "▶";
    } else {
      wakeSim();
    }
  });
  graphOrbitsBtn.addEventListener("click", () => {
    showOrbits = !showOrbits;
    graphOrbitsBtn.classList.toggle("active", showOrbits);
    document.querySelectorAll(".orbit-path").forEach((el) => {
      el.style.display = showOrbits ? "" : "none";
    });
  });
  graphOverlay.addEventListener("click", (e) => {
    if (e.target === graphOverlay) closeGraph();
  });

  $("#graph-zoom-in").addEventListener("click", () => {
    if (!graphView) return;
    const r = graphSvg.getBoundingClientRect();
    zoomView(r.width / 2, r.height / 2, 1.25);
  });
  $("#graph-zoom-out").addEventListener("click", () => {
    if (!graphView) return;
    const r = graphSvg.getBoundingClientRect();
    zoomView(r.width / 2, r.height / 2, 0.8);
  });
  $("#graph-reset").addEventListener("click", () => {
    if (!graphView) return;
    if (graphHome) {
      graphView.x = graphHome.x;
      graphView.y = graphHome.y;
      graphView.k = graphHome.k;
    } else {
      graphView.k = 1;
      graphView.x = 0;
      graphView.y = 0;
    }
    applyView();
  });

  function clampZoom(k) {
    return Math.max(0.001, Math.min(6, k));
  }

  function applyView() {
    if (!graphView) return;
    graphView.g.setAttribute(
      "transform",
      `translate(${graphView.x},${graphView.y}) scale(${graphView.k})`
    );
    const mini = graphView.k < 0.35;
    graphSvg.classList.toggle("mini", mini);
    wakeSim();
  }

  function zoomView(sx, sy, factor) {
    if (!graphView) return;
    const k2 = clampZoom(graphView.k * factor);
    const real = k2 / graphView.k;
    graphView.x = sx - real * (sx - graphView.x);
    graphView.y = sy - real * (sy - graphView.y);
    graphView.k = k2;
    applyView();
  }

  function svgPoint(clientX, clientY) {
    const rect = graphSvg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  const pointers = new Map();
  let pan = null;
  let pinch = null;
  let dragActive = false;
  let suppressClickUntil = 0;
  const DRAG_THRESHOLD = 6;

  graphSvg.addEventListener("pointerdown", (e) => {
    graphSvg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, {
      x: svgPoint(e.clientX, e.clientY).x,
      y: svgPoint(e.clientX, e.clientY).y,
      cx: e.clientX,
      cy: e.clientY,
    });
    if (pointers.size === 1) {
      suppressClickUntil = 0;
      dragActive = false;
      pan = { sx: e.clientX, sy: e.clientY, vx: graphView.x, vy: graphView.y };
      pinch = null;
      graphSvg.classList.add("panning");
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinch = {
        d: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        vx: graphView.x,
        vy: graphView.y,
        vk: graphView.k,
      };
      pan = null;
      dragActive = true;
    }
  });

  graphSvg.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = svgPoint(e.clientX, e.clientY);
    const pt = pointers.get(e.pointerId);
    pt.x = p.x;
    pt.y = p.y;
    pt.cx = e.clientX;
    pt.cy = e.clientY;
    if (pinch && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const d = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const k2 = clampZoom(pinch.vk * (d / pinch.d));
      graphView.x = cx - (k2 * (pinch.cx - pinch.vx)) / pinch.vk;
      graphView.y = cy - (k2 * (pinch.cy - pinch.vy)) / pinch.vk;
      graphView.k = k2;
      dragActive = true;
      applyView();
    } else if (pan) {
      const dx = e.clientX - pan.sx;
      const dy = e.clientY - pan.sy;
      if (!dragActive && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragActive = true;
      graphView.x = pan.vx + dx;
      graphView.y = pan.vy + dy;
      applyView();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      pan = { sx: p.cx, sy: p.cy, vx: graphView.x, vy: graphView.y };
      pinch = null;
    } else if (pointers.size === 0) {
      pan = null;
      pinch = null;
      if (dragActive) suppressClickUntil = performance.now() + 400;
      dragActive = false;
      graphSvg.classList.remove("panning");
    }
  }

  graphSvg.addEventListener("pointerup", endPointer);
  graphSvg.addEventListener("pointercancel", endPointer);

  graphSvg.addEventListener(
    "click",
    (e) => {
      if (performance.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  ["gesturestart", "gesturechange", "gestureend"].forEach((type) =>
    graphOverlay.addEventListener(type, (e) => e.preventDefault(), { passive: false })
  );

  graphSvg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = svgPoint(e.clientX, e.clientY);
      zoomView(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false }
  );

  async function openGraph() {
    if (!currentGalaxyPath) return;
    try {
      const data = await api("GET", "/api/graph");
      graphOverlay.classList.remove("hidden");
      graphOrbitsBtn.classList.toggle("active", showOrbits);
      buildAstroView(data);
    } catch (err) {
      alert(err.message);
    }
  }

  function closeGraph() {
    graphOverlay.classList.add("hidden");
    cancelAnimationFrame(graphAnim);
    graphAnim = null;
    graphSvg.innerHTML = "";
    graphView = null;
    graphHome = null;
    sim = null;
    graphBodies = [];
    graphShipsLayer = null;
    pan = null;
    pinch = null;
    dragActive = false;
    suppressClickUntil = 0;
    pointers.clear();
    graphSvg.classList.remove("panning");
  }

  function buildAstroView(data) {
    cancelAnimationFrame(graphAnim);
    graphAnim = null;
    graphSvg.innerHTML = "";
    const w = graphSvg.clientWidth || 800;
    const h = graphSvg.clientHeight || 500;

    const ns = "http://www.w3.org/2000/svg";
    const viewport = document.createElementNS(ns, "g");
    graphSvg.appendChild(viewport);
    graphView = { g: viewport, x: w / 2, y: h / 2, k: 1 };

    const byId = {};
    data.nodes.forEach((n) => {
      byId[n.id] = n;
      n._children = [];
      n._orbits = [];
    });
    data.links.forEach((l) => {
      if (l.type === "wikilink") return;
      if (l.source !== l.target && byId[l.source] && byId[l.target]) {
        byId[l.source]._children.push(byId[l.target]);
      }
    });
    const root = byId["."];
    if (!root) {
      graphSvg.innerHTML =
        '<text x="50%" y="50%" fill="#888" font-size="14" text-anchor="middle">galaxy is empty</text>';
      return;
    }
    computeRadii(root);
    assignOrbits(root);
    graphView.k = clampZoom(Math.min(1.5, Math.min(w, h) / (2 * (root.sysExtent + 20))));
    graphHome = { x: w / 2, y: h / 2, k: graphView.k };

    const curDir =
      currentFile && currentFile.includes("/")
        ? currentFile.slice(0, currentFile.lastIndexOf("/"))
        : "";
    graphBodies = [];

    function isCurrentNode(node) {
      if (node.type === "planet") return node.path === currentFile;
      return node.path === "." ? curDir === "" : node.path === curDir;
    }

    function labelFor(name, r) {
      const text = document.createElementNS(ns, "text");
      text.setAttribute("class", "graph-label");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dy", r + 12);
      text.setAttribute("fill", "#888");
      text.setAttribute("font-size", "10");
      text.textContent = name;
      return text;
    }

    function buildSystem(parentG, node, parentBody) {
      const starG = document.createElementNS(ns, "g");
      starG.setAttribute("class", "graph-node star-node");
      starG.style.cursor = "pointer";
      const isCur = isCurrentNode(node);
      const halo = document.createElementNS(ns, "circle");
      halo.setAttribute("r", node.r * 2.6);
      halo.setAttribute("fill", starColor(node.path));
      halo.setAttribute("opacity", "0.16");
      const body = document.createElementNS(ns, "circle");
      body.setAttribute("r", node.r);
      body.setAttribute("fill", starColor(node.path));
      body.setAttribute("stroke", isCur ? "#fff" : "rgba(255,255,255,0.35)");
      body.setAttribute("stroke-width", isCur ? 1.5 : 0.75);
      starG.append(halo, body, labelFor(node.name, node.r));
      starG.addEventListener("click", () => {
        closeGraph();
        openGraphNode(node);
      });
      parentG.appendChild(starG);
      node._orbits.forEach((orb) => {
        const orbitG = document.createElementNS(ns, "g");
        orbitG.setAttribute(
          "transform",
          `rotate(${((orb.phi * 180) / Math.PI).toFixed(2)})`
        );
        const path = document.createElementNS(ns, "ellipse");
        path.setAttribute("class", "orbit-path");
        path.setAttribute("cx", -orb.a * orb.e);
        path.setAttribute("cy", "0");
        path.setAttribute("rx", orb.a);
        path.setAttribute("ry", orb.a * Math.sqrt(1 - orb.e * orb.e));
        const bodyG = document.createElementNS(ns, "g");
        bodyG.setAttribute("class", "orbit-body");
        const common = {
          path: orb.child.path,
          M: phaseFor(orb.child.path + ":m"),
          omega: KEPLER_K / Math.pow(orb.a, 1.5),
          a: orb.a,
          e: orb.e,
          phi: orb.phi,
          sqrt1e2: Math.sqrt(1 - orb.e * orb.e),
          parent: parentBody,
        };
        if (orb.child.type === "planet") {
          bodyG.classList.add("graph-node");
          bodyG.style.cursor = "pointer";
          const isC = isCurrentNode(orb.child);
          const pc = document.createElementNS(ns, "circle");
          pc.setAttribute("r", orb.child.r);
          pc.setAttribute("fill", planetColor(orb.child.path));
          pc.setAttribute("stroke", isC ? "#fff" : "rgba(0,0,0,0.5)");
          pc.setAttribute("stroke-width", isC ? 1.5 : 0.75);
          bodyG.append(pc, labelFor(orb.child.name, orb.child.r));
          bodyG.addEventListener("click", () => {
            closeGraph();
            openFile(orb.child.path);
          });
          graphBodies.push({ el: bodyG, isStar: false, ...common });
        } else {
          const sub = { el: bodyG, isStar: true, ...common };
          graphBodies.push(sub);
          buildSystem(bodyG, orb.child, sub);
        }
        orbitG.append(path, bodyG);
        if (!showOrbits) path.style.display = "none";
        starG.appendChild(orbitG);
      });
    }

    buildSystem(viewport, root, null);

    const linkColor = (
      getComputedStyle(document.documentElement).getPropertyValue("--link").trim() ||
      "#9ab3ff"
    );
    graphShipsLayer = document.createElementNS(ns, "g");
    graphShipsLayer.setAttribute("class", "graph-ships");
    graphShipsLayer.style.pointerEvents = "none";
    viewport.appendChild(graphShipsLayer);
    const bodyByPath = new Map();
    graphBodies.forEach((b) => {
      if (b.path) bodyByPath.set(b.path, b);
    });
    const ships = [];
    data.links.forEach((l) => {
      if (l.type !== "wikilink") return;
      const a = bodyByPath.get(l.source);
      const b = bodyByPath.get(l.target);
      if (!a || !b) return;
      const seed = hashStr(l.source + "->" + l.target);
      const g = document.createElementNS(ns, "g");
      g.setAttribute("class", "graph-ship");
      g.style.pointerEvents = "none";
      const trail = document.createElementNS(ns, "path");
      trail.setAttribute("d", "M-16,0 L-3,0");
      trail.setAttribute("fill", "none");
      trail.setAttribute("stroke", linkColor);
      trail.setAttribute("stroke-width", "1.1");
      trail.setAttribute("opacity", "0.35");
      const glow = document.createElementNS(ns, "circle");
      glow.setAttribute("cx", "0");
      glow.setAttribute("cy", "0");
      glow.setAttribute("r", "5");
      glow.setAttribute("fill", linkColor);
      glow.setAttribute("opacity", "0.18");
      const hull = document.createElementNS(ns, "path");
      hull.setAttribute("d", "M-3,0 L3,-2.6 L6.5,0 L3,2.6 Z");
      hull.setAttribute("fill", linkColor);
      g.append(trail, glow, hull);
      graphShipsLayer.appendChild(g);
      ships.push({
        g,
        a,
        b,
        t: (seed % 100) / 100,
        dir: seed % 2 === 0 ? 1 : -1,
        speed: shipSpeed() * (0.75 + ((seed >> 3) % 25) / 100),
      });
    });
    applyView();

    sim = {
      bodies: graphBodies,
      ships,
      running: true,
      userPaused: false,
      idleFrames: 0,
      w,
      h,
      last: performance.now(),
    };
    graphPauseBtn.textContent = "⏸";
    graphAnim = requestAnimationFrame(tick);
  }

  function wakeSim() {
    if (!sim || sim.userPaused || sim.running) return;
    sim.running = true;
    sim.idleFrames = 0;
    sim.last = performance.now();
    graphPauseBtn.textContent = "⏸";
    graphAnim = requestAnimationFrame(tick);
  }

  function tick() {
    graphAnim = requestAnimationFrame(tick);
    if (!sim || !sim.running) return;
    const now = performance.now();
    let dt = (now - sim.last) / 1000;
    sim.last = now;
    if (dt > 0.1) dt = 0.1;
    const k = graphView.k;
    const w = sim.w;
    const h = sim.h;
    let moved = false;
    for (const b of sim.bodies) {
      b.M += b.omega * dt;
      const cx = b.parent ? b.parent._sx : graphView.x;
      const cy = b.parent ? b.parent._sy : graphView.y;
      const screenA = b.a * k;
      const margin = screenA * (1 + b.e) + 1;
      const offscreen =
        screenA >= MIN_SCREEN_A &&
        (cx + margin < 0 || cx - margin > w || cy + margin < 0 || cy - margin > h);
      if (offscreen && !b.isStar) continue;
      const E = solveKepler(b.M % TWO_PI, b.e);
      const cosE = Math.cos(E);
      const sinE = Math.sin(E);
      const x = b.a * (cosE - b.e);
      const y = b.a * b.sqrt1e2 * sinE;
      b._sx = cx + x * k;
      b._sy = cy + y * k;
      if (screenA >= MIN_SCREEN_A && !offscreen) {
        moved = true;
        const t = x.toFixed(2) + "," + y.toFixed(2);
        if (t !== b._t) {
          b._t = t;
          b.el.setAttribute("transform", "translate(" + t + ")");
        }
      }
    }
    for (const s of sim.ships) {
      s.t += s.dir * s.speed * dt;
      if (s.t > 1) {
        s.t = 1;
        s.dir = -1;
      } else if (s.t < 0) {
        s.t = 0;
        s.dir = 1;
      }
      const A = bodyPos(s.a);
      const B = bodyPos(s.b);
      const x = A.x + (B.x - A.x) * s.t;
      const y = A.y + (B.y - A.y) * s.t;
      const ang = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI;
      s.g.setAttribute(
        "transform",
        `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${ang.toFixed(2)})`
      );
    }
    if (!moved) {
      if (++sim.idleFrames >= 20 && !sim.userPaused) {
        cancelAnimationFrame(graphAnim);
        graphAnim = null;
        sim.running = false;
      }
    } else {
      sim.idleFrames = 0;
    }
  }

  function bodyPos(b) {
    const chain = [];
    for (let x = b; x; x = x.parent) chain.push(x);
    let rot = 0;
    let x = 0;
    let y = 0;
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      rot += c.phi;
      const E = solveKepler(c.M % TWO_PI, c.e);
      const ox = c.a * (Math.cos(E) - c.e);
      const oy = c.a * c.sqrt1e2 * Math.sin(E);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      x += ox * cos - oy * sin;
      y += ox * sin + oy * cos;
    }
    return { x, y };
  }

  function openGraphNode(node) {
    const list = node.path === "." ? tree : (findEntry(tree, node.path) || {}).children || [];
    expandInSidebar(node.path === "." ? "" : node.path);
    const first = firstFileInTree(list);
    if (first) openFile(first);
  }

  function findEntry(list, path) {
    for (const e of list) {
      if (e.path === path) return e;
      if (e.type === "star") {
        const r = findEntry(e.children || [], path);
        if (r) return r;
      }
    }
    return null;
  }

  function firstFileInTree(list) {
    for (const e of list) {
      if (e.type === "planet") return e.path;
      const f = firstFileInTree(e.children || []);
      if (f) return f;
    }
    return null;
  }

  function expandInSidebar(path) {
    document.querySelectorAll(".tree li").forEach((li) => {
      if (
        li.dataset.path &&
        path &&
        li.dataset.path !== path &&
        path.startsWith(li.dataset.path + "/") &&
        li.classList.contains("star") &&
        !li.classList.contains("open")
      ) {
        li.classList.add("open");
        openState.set(li.dataset.path, true);
        const t = li.querySelector(".twist");
        if (t) t.textContent = "▾";
        const child = li.querySelector(":scope > ul");
        if (child) child.style.display = "";
      }
    });
  }

  // ---------- Search ----------

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 300);
  });

  async function doSearch() {
    const q = searchInput.value.trim();
    if (!q) {
      searchResults.classList.add("hidden");
      return;
    }
    try {
      const data = await api("GET", "/api/search?q=" + encodeURIComponent(q));
      searchResults.innerHTML = "";
      if (!data.results.length) {
        searchResults.innerHTML = '<div class="result-item">no matches</div>';
      } else {
        data.results.forEach((r) => {
          const div = document.createElement("div");
          div.className = "result-item";
          div.innerHTML =
            `<div class="r-title">${escapeHtml(r.title)}</div>` +
            (r.snippet
              ? `<div class="r-snippet">${escapeHtml(r.snippet)}…</div>`
              : "");
          div.addEventListener("click", () => {
            searchResults.classList.add("hidden");
            searchInput.value = "";
            openFile(r.path);
          });
          searchResults.appendChild(div);
        });
      }
      searchResults.classList.remove("hidden");
    } catch (e) {
      searchResults.classList.add("hidden");
    }
  }

  // ---------- Galaxy switching ----------

  $("#galaxy-btn").addEventListener("click", () => openGalaxyManager());
  $("#settings-btn").addEventListener("click", () => openSettings());

  async function setGalaxy(path) {
    try {
      if (dirty && currentFile) await saveFile();
      const data = await api("PUT", "/api/galaxy", { path });
      currentGalaxyPath = data.path;
      $("#galaxy-label").textContent = data.path || "galaxies";
      $("#galaxy-setup").classList.add("hidden");
      currentFile = null;
      editor.innerHTML = "";
      lastSource = "";
      dirty = false;
      saveState.textContent = "";
      booted = false;
      history.replaceState({ depth: 0 }, "", location.pathname);
      updateBackBtn();
      await loadTree();
      await openStartupNote();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- Settings (index note) ----------

  async function openSettings() {
    const themeLabel = document.createElement("div");
    themeLabel.className = "field-label";
    themeLabel.textContent = "Theme";
    const themeSel = document.createElement("select");
    THEMES.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      themeSel.appendChild(opt);
    });
    themeSel.value = localStorage.getItem(THEME_KEY) || "astro";
    const speedLabel = document.createElement("div");
    speedLabel.className = "field-label";
    speedLabel.textContent = "Ship speed";
    const speedRange = document.createElement("input");
    speedRange.type = "range";
    speedRange.min = "0.05";
    speedRange.max = "1";
    speedRange.step = "0.05";
    speedRange.value = String(shipSpeed());
    const speedValue = document.createElement("span");
    speedValue.className = "field-label";
    speedValue.textContent = speedRange.value;
    speedRange.addEventListener("input", () => {
      speedValue.textContent = speedRange.value;
    });
    const speedRow = document.createElement("div");
    speedRow.className = "import-row";
    speedRow.append(speedRange, speedValue);
    let indexNote = null;
    try {
      const data = await api("GET", "/api/index-note");
      indexNote = data.path;
    } catch (e) {}
    const label = document.createElement("div");
    label.className = "field-label";
    label.textContent = "Index note — opens every time the app starts";
    const row = document.createElement("div");
    row.className = "import-row";
    const input = document.createElement("input");
    input.placeholder = "none — first note opens";
    input.value = indexNote || "";
    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.textContent = "Pick…";
    pickBtn.addEventListener("click", async () => {
      const picked = await pickIndexNote();
      if (picked) input.value = picked;
    });
    row.append(input, pickBtn);
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      input.value = "";
    });
    const hint = document.createElement("div");
    hint.className = "field-label";
    hint.textContent = "Like a home page for your galaxy.";
    const backupLabel = document.createElement("div");
    backupLabel.className = "field-label";
    backupLabel.textContent = "Backup";
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.textContent = "Download galaxy (.zip)";
    dlBtn.addEventListener("click", () => {
      window.location.href = "/api/galaxy/download";
    });
    const body = document.createElement("div");
    body.append(
      themeLabel,
      themeSel,
      speedLabel,
      speedRow,
      label,
      row,
      clearBtn,
      hint,
      backupLabel,
      dlBtn
    );
    const ok = await showModal("Settings", body, "Save");
    if (!ok) return;
    applyTheme(themeSel.value);
    localStorage.setItem(SHIP_SPEED_KEY, speedRange.value);
    if (sim) {
      const ratio = shipSpeed() / (sim._speedBase || shipSpeed());
      sim._speedBase = shipSpeed();
      for (const s of sim.ships) s.speed *= ratio;
    }
    try {
      await api("PUT", "/api/index-note", { path: input.value.trim() });
    } catch (err) {
      alert(err.message);
    }
  }

  function pickIndexNote() {
    return new Promise((resolve) => {
      const files = collectFiles(tree);
      const body = document.createElement("div");
      const ul = document.createElement("ul");
      ul.className = "dir-list";
      if (!files.length) {
        const li = document.createElement("li");
        li.textContent = "(no notes)";
        li.style.color = "var(--dim)";
        ul.appendChild(li);
      }
      files.forEach((f) => {
        const li = document.createElement("li");
        li.textContent = f;
        li.addEventListener("click", () => closeModal(f));
        ul.appendChild(li);
      });
      body.appendChild(ul);
      showModal("Pick index note", body, "Cancel").then((ok) => {
        resolve(typeof ok === "string" ? ok : null);
      });
    });
  }

  async function openStartupNote() {
    try {
      const data = await api("GET", "/api/index-note");
      if (data.path) {
        await openFile(data.path);
        return;
      }
    } catch (e) {}
    const files = collectFiles(tree);
    if (files.length) await openFile(files[0]);
  }

  // ---------- Galaxy manager ----------

  function showGalaxySetup() {
    $("#galaxy-setup").classList.remove("hidden");
  }

  $("#setup-create-btn").addEventListener("click", createGalaxyFlow);
  $("#setup-import-btn").addEventListener("click", importGalaxyFlow);

  async function openGalaxyManager() {
    try {
      const data = await api("GET", "/api/galaxies");
      const body = document.createElement("div");
      const list = document.createElement("ul");
      list.className = "galaxy-list";
      let selected = null;
      if (!data.galaxies.length) {
        const li = document.createElement("li");
        li.className = "galaxy-none";
        li.textContent = "no galaxies yet";
        list.appendChild(li);
      } else {
        data.galaxies.forEach((v) => {
          const li = document.createElement("li");
          li.className = "galaxy-item" + (v.current ? " current" : "");
          li.textContent = v.name;
          if (v.current) li.textContent += "  (current)";
          li.addEventListener("click", () => {
            list.querySelectorAll("li.galaxy-item").forEach((x) => x.classList.remove("sel"));
            li.classList.add("sel");
            selected = v.path;
          });
          list.appendChild(li);
        });
      }
      const btns = document.createElement("div");
      btns.className = "galaxy-actions";
      const createB = document.createElement("button");
      createB.type = "button";
      createB.textContent = "+ Create";
      createB.addEventListener("click", async () => {
        closeModal(null);
        await createGalaxyFlow();
      });
      const importB = document.createElement("button");
      importB.type = "button";
      importB.textContent = "Import";
      importB.addEventListener("click", async () => {
        closeModal(null);
        await importGalaxyFlow();
      });
      btns.append(createB, importB);
      body.append(list, btns);
      const result = await showModal("Galaxies", body, "Open");
      if (result === null || !selected) return;
      await setGalaxy(selected);
    } catch (err) {
      alert(err.message);
    }
  }

  async function createGalaxyFlow() {
    const name = await promptInput("New galaxy", "my-galaxy");
    if (!name) return;
    try {
      const data = await api("POST", "/api/galaxies", { name });
      await setGalaxy(data.path);
    } catch (err) {
      alert(err.message);
    }
  }

  async function importGalaxyFlow() {
    const body = document.createElement("div");
    const srcLabel = document.createElement("div");
    srcLabel.className = "field-label";
    srcLabel.textContent = "Source folder";
    const srcInput = document.createElement("input");
    srcInput.placeholder = "/path/to/galaxy or browse…";
    const browseB = document.createElement("button");
    browseB.type = "button";
    browseB.textContent = "Browse…";
    const row = document.createElement("div");
    row.className = "import-row";
    browseB.addEventListener("click", async () => {
      const picked = await browseDirs("");
      if (picked === null) return;
      srcInput.value = picked;
      if (!nameInput.value.trim()) nameInput.value = picked.split("/").pop();
    });
    row.append(srcInput, browseB);
    const nameLabel = document.createElement("div");
    nameLabel.className = "field-label";
    nameLabel.textContent = "Galaxy name";
    const nameInput = document.createElement("input");
    nameInput.placeholder = "my-galaxy";
    body.append(srcLabel, row, nameLabel, nameInput);
    const ok = await showModal("Import galaxy", body, "Import");
    if (!ok) return;
    const source = srcInput.value.trim();
    const name = nameInput.value.trim();
    if (!source) {
      alert("source folder required");
      return;
    }
    try {
      const data = await api("POST", "/api/galaxy/import", { source, name });
      await setGalaxy(data.path);
    } catch (err) {
      alert(err.message);
    }
  }

  function browseDirs(start) {
    return new Promise((resolve) => {
      let cur = start;
      let settled = false;

      function finish(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }

      function setBody(body) {
        $("#modal-title").textContent = "Browse — choose source folder";
        $("#modal-body").innerHTML = "";
        $("#modal-body").appendChild(body);
      }

      async function render() {
        if (settled) return;
        let data;
        try {
          data = await api("GET", "/api/dirs?path=" + encodeURIComponent(cur));
        } catch (e) {
          closeModal(null);
          finish(null);
          return;
        }
        if (settled) return;
        cur = data.current;
        const body = document.createElement("div");
        const ul = document.createElement("ul");
        ul.className = "dir-list";
        if (data.parent) {
          const up = document.createElement("li");
          up.className = "go-up";
          up.textContent = "↑ ..";
          up.addEventListener("click", () => {
            cur = data.parent;
            render();
          });
          ul.appendChild(up);
        }
        data.dirs.forEach((d) => {
          const li = document.createElement("li");
          li.textContent = "▣ " + d.split("/").pop();
          li.addEventListener("click", () => {
            cur = d;
            render();
          });
          ul.appendChild(li);
        });
        if (!data.dirs.length) {
          ul.appendChild(
            Object.assign(document.createElement("li"), { textContent: "(no subfolders)" })
          );
        }
        body.appendChild(ul);
        setBody(body);
      }

      showModal("Browse — choose source folder", document.createElement("div"), "Select this").then(
        (ok) => {
          finish(ok === true ? cur : null);
        }
      );

      render();
    });
  }

  // ---------- Modal ----------

  let modalResolve = null;
  let modalStack = [];

  function showModal(title, bodyEl, okLabel) {
    if (modalResolve) {
      modalStack.push({
        resolve: modalResolve,
        title: $("#modal-title").textContent,
        okLabel: $("#modal-ok").textContent,
        bodyEl: $("#modal-body").firstElementChild,
      });
    }
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = "";
    $("#modal-body").appendChild(bodyEl);
    $("#modal-ok").textContent = okLabel || "OK";
    $("#modal-overlay").classList.remove("hidden");
    const firstInput = bodyEl.querySelector("input");
    if (firstInput) {
      firstInput.focus();
      firstInput.select();
    }
    return new Promise((resolve) => {
      modalResolve = resolve;
    });
  }

  function closeModal(value) {
    const current = modalResolve;
    modalResolve = null;
    if (current) current(value);
    const prev = modalStack.pop();
    if (prev) {
      $("#modal-title").textContent = prev.title;
      $("#modal-body").innerHTML = "";
      $("#modal-body").appendChild(prev.bodyEl);
      $("#modal-ok").textContent = prev.okLabel;
      $("#modal-overlay").classList.remove("hidden");
      modalResolve = prev.resolve;
    } else {
      $("#modal-overlay").classList.add("hidden");
    }
  }

  $("#modal-cancel").addEventListener("click", () => closeModal(null));
  $("#modal-ok").addEventListener("click", () => closeModal(true));
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target === $("#modal-overlay")) closeModal(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#modal-overlay").classList.contains("hidden")) closeModal(null);
      if (!graphOverlay.classList.contains("hidden")) closeGraph();
    }
  });

  function promptInput(title, value) {
    const input = document.createElement("input");
    input.value = value;
    input.placeholder = title;
    const body = document.createElement("div");
    body.appendChild(input);
    return showModal(title, body, "OK").then((ok) => (ok ? input.value : null));
  }

  function confirmBox(title, message) {
    const p = document.createElement("p");
    p.textContent = message;
    p.style.whiteSpace = "pre-line";
    const body = document.createElement("div");
    body.appendChild(p);
    return showModal(title, body, "Delete").then((ok) => ok === true);
  }

  // ---------- Editor events ----------

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      clearTimeout(saveTimer);
      saveFile();
    }
  });

  // ---------- Wikilink autocomplete ----------

  const AC_LIMIT = 12;

  let ac = null;
  let lastEditorAction = "caret";

  function noteBase(path) {
    const t = path.slice(0, -3);
    return t.slice(t.lastIndexOf("/") + 1);
  }

  function noteDir(path) {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  }

  function acMatch(query, notes) {
    const q = query.toLowerCase();
    const scored = [];
    for (const p of notes) {
      const t = noteBase(p).toLowerCase();
      const pl = p.toLowerCase();
      let s = -1;
      if (t === q) s = 5;
      else if (t.startsWith(q)) s = 4;
      else if (pl.startsWith(q)) s = 3;
      else if (t.includes(q)) s = 2;
      else if (pl.includes(q)) s = 1;
      if (s < 0) continue;
      scored.push({ p, s });
    }
    scored.sort((a, b) => b.s - a.s || a.p.localeCompare(b.p));
    return scored.slice(0, AC_LIMIT).map((x) => x.p);
  }

  function linkFor(path, notes) {
    const base = noteBase(path);
    const same = notes.filter((p) => noteBase(p) === base).length;
    if (same <= 1) return base;
    const parts = path.slice(0, -3).split("/");
    for (let i = parts.length - 2; i >= 0; i--) {
      const cand = parts.slice(i).join("/");
      const count = notes.filter((p) => {
        const t = p.slice(0, -3);
        return t === cand || t.endsWith("/" + cand);
      }).length;
      if (count === 1) return cand;
    }
    return path.slice(0, -3);
  }

  function caretRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (!r.collapsed || !editor.contains(r.startContainer)) return null;
    const rect = r.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return rect;
  }

  function maybeShowAutocomplete(md, caret) {
    if (caret < 0 || lastEditorAction !== "input") {
      closeAc();
      return;
    }
    const lineStart = md.lastIndexOf("\n", caret - 1) + 1;
    const before = md.slice(lineStart, caret);
    const m = /\[\[([^\[\]\n]*)$/.exec(before);
    if (!m) {
      closeAc();
      return;
    }
    const open = lineStart + m.index;
    const raw = m[1];
    const pipe = raw.indexOf("|");
    const query = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
    const alias = pipe === -1 ? "" : raw.slice(pipe + 1);
    const notes = collectFiles(tree);
    const matches = acMatch(query, notes);
    const items = matches.map((p) => ({
      kind: "note",
      path: p,
      label: noteBase(p),
      sub: noteDir(p),
      link: linkFor(p, notes),
    }));
    const exact =
      notes.some((p) => noteBase(p) === query) || notes.includes(query + ".md");
    if (query && !exact) {
      items.push({
        kind: "create",
        path: query + ".md",
        label: query,
        sub: "create note",
        link: query,
      });
    }
    if (!items.length) {
      closeAc();
      return;
    }
    showAc(items, open, caret, alias);
  }

  function showAc(items, open, end, alias) {
    if (ac) ac.popup.remove();
    const popup = document.createElement("div");
    popup.className = "ac-popup";
    popup.style.display = "none";
    const listEl = document.createElement("div");
    listEl.className = "ac-list";
    items.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "ac-item" + (idx === 0 ? " sel" : "");
      const label = document.createElement("span");
      label.className = "ac-label";
      label.textContent = it.label;
      const sub = document.createElement("span");
      sub.className = "ac-sub";
      sub.textContent = it.sub;
      row.append(label, sub);
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("click", () => acSelect(it));
      listEl.appendChild(row);
    });
    popup.appendChild(listEl);
    document.body.appendChild(popup);
    ac = { popup, items, index: 0, open, end, alias };
    requestAnimationFrame(() => {
      if (!ac) return;
      const rect = caretRect();
      if (!rect) {
        closeAc();
        return;
      }
      popup.style.display = "";
      const pr = popup.getBoundingClientRect();
      let left = rect.left;
      if (left + pr.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - pr.width - 8);
      }
      const below = rect.bottom + 6;
      const top =
        below + pr.height <= window.innerHeight - 8
          ? below
          : Math.max(8, rect.top - pr.height - 6);
      popup.style.left = left + "px";
      popup.style.top = top + "px";
    });
  }

  function acMove(delta) {
    if (!ac || !ac.items.length) return;
    ac.index = (ac.index + delta + ac.items.length) % ac.items.length;
    const rows = ac.popup.querySelectorAll(".ac-item");
    rows.forEach((r, i) => r.classList.toggle("sel", i === ac.index));
    const sel = rows[ac.index];
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }

  function acSelect(item) {
    if (!ac) return;
    const md = LiveEditor.source(editor);
    const insert = "[[" + item.link + (ac.alias ? "|" + ac.alias : "") + "]]";
    pushUndo(lastSource, ac.open);
    liveApply(md.slice(0, ac.open) + insert + md.slice(ac.end), ac.open + insert.length);
    markDirty();
    closeAc();
    if (item.kind === "create") {
      api("POST", "/api/file", { path: item.path }).then(loadTree).catch(() => {});
    }
  }

  function closeAc() {
    if (!ac) return;
    ac.popup.remove();
    ac = null;
  }

  editor.addEventListener("blur", closeAc);

  // ---------- Utils ----------

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---------- Boot ----------

  async function boot() {
    let galaxy = null;
    try {
      galaxy = await api("GET", "/api/galaxy");
    } catch (e) {}
    if (galaxy && galaxy.path) {
      currentGalaxyPath = galaxy.path;
      $("#galaxy-label").textContent = galaxy.path;
      await loadTree();
      const hash = location.hash ? decodeURIComponent(location.hash.slice(1)) : "";
      if (hash && collectFiles(tree).includes(hash)) {
        await openFile(hash);
      } else {
        await openStartupNote();
      }
    } else {
      showGalaxySetup();
    }
  }

  boot();
})();
