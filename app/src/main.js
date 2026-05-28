/* Data Diary — frontend (vanilla JS, no framework) */

const invoke = window.__TAURI__.invoke;
const tauriDialog = window.__TAURI__.dialog;
const tauriShell = window.__TAURI__.shell;

const state = {
  root: "",
  projects: [],         // ProjectSummary[]
  currentSlug: null,
  current: null,        // Project
  filter: "",
  sortBy: "updated",
  saveTimer: null,
  saveStatus: "idle",   // idle | dirty | saving | saved
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

const els = {
  splash: $("splash"),
  splashCurrent: $("splash-current"),
  pickRoot: $("pick-root"),
  app: $("app"),
  projectList: $("project-list"),
  newProject: $("new-project-btn"),
  changeRoot: $("change-root"),
  rootLabel: $("root-label"),
  search: $("search"),
  sort: $("sort"),
  projectTitle: $("project-title"),
  saveStatus: $("save-status"),
  saveBtn: $("save-btn"),
  addEntry: $("add-entry-btn"),
  deleteProject: $("delete-project-btn"),
  entries: $("entries"),
  emptyState: $("empty-state"),
  todoList: $("todo-list"),
  todoForm: $("todo-form"),
  todoInput: $("todo-input"),
  todoCount: $("todo-count"),
  artifactList: $("artifact-list"),
  addFile: $("add-file-btn"),
  addLink: $("add-link-btn"),
  modal: $("modal"),
  modalTitle: $("modal-title"),
  modalFields: $("modal-fields"),
  modalOk: $("modal-ok"),
  modalCancel: $("modal-cancel"),
};

// ---------- Boot ----------
async function boot() {
  try {
    const cfg = await invoke("get_config");
    if (cfg && cfg.root) {
      state.root = cfg.root;
      showApp();
      await refreshProjects();
    } else {
      showSplash();
    }
  } catch (e) {
    showSplash();
    console.error(e);
  }
}

function showSplash() {
  els.splash.classList.remove("hidden");
  els.app.classList.add("hidden");
  if (state.root) {
    els.splashCurrent.textContent = "current: " + state.root;
  } else {
    els.splashCurrent.textContent = "";
  }
}

function showApp() {
  els.splash.classList.add("hidden");
  els.app.classList.remove("hidden");
  els.rootLabel.textContent = state.root;
}

// ---------- Folder picker ----------
async function pickRoot() {
  const selected = await tauriDialog.open({
    directory: true,
    multiple: false,
    title: "Choose a folder for your data diary",
  });
  if (!selected) return;
  const cfg = await invoke("set_root", { path: selected });
  state.root = cfg.root;
  showApp();
  await refreshProjects();
}

els.pickRoot.addEventListener("click", pickRoot);
els.changeRoot.addEventListener("click", pickRoot);

// ---------- Project list ----------
async function refreshProjects() {
  state.projects = await invoke("list_projects", { root: state.root });
  renderProjects();
}

function renderProjects() {
  const filter = state.filter.toLowerCase();
  let list = state.projects.filter((p) =>
    p.title.toLowerCase().includes(filter)
  );
  if (state.sortBy === "title") {
    list.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    list.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  }

  els.projectList.innerHTML = "";
  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "muted small";
    li.style.cursor = "default";
    li.textContent = state.projects.length === 0 ? "no projects yet" : "no matches";
    els.projectList.appendChild(li);
    return;
  }

  for (const p of list) {
    const li = document.createElement("li");
    if (p.slug === state.currentSlug) li.classList.add("active");
    li.innerHTML = `
      <div class="pl-title"></div>
      <div class="pl-meta">
        <span class="pl-updated"></span>
        <span class="pl-counts"></span>
      </div>
    `;
    li.querySelector(".pl-title").textContent = p.title;
    li.querySelector(".pl-updated").textContent = p.updated || "—";
    const counts = [];
    if (p.entry_count) counts.push(`${p.entry_count} entries`);
    if (p.todo_count) counts.push(`${p.todo_done}/${p.todo_count} todo`);
    li.querySelector(".pl-counts").textContent = counts.join(" · ");
    li.addEventListener("click", () => openProject(p.slug));
    els.projectList.appendChild(li);
  }
}

els.search.addEventListener("input", (e) => {
  state.filter = e.target.value;
  renderProjects();
});
els.sort.addEventListener("change", (e) => {
  state.sortBy = e.target.value;
  renderProjects();
});

// ---------- New project ----------
els.newProject.addEventListener("click", () => {
  openModal({
    title: "New project",
    fields: [{ id: "name", label: "name", placeholder: "e.g. Sales pipeline analysis" }],
    onOk: async (vals) => {
      const name = (vals.name || "").trim();
      if (!name) return false;
      try {
        const p = await invoke("create_project", { root: state.root, title: name });
        await refreshProjects();
        await openProject(p.slug);
      } catch (e) {
        alert(e);
        return false;
      }
      return true;
    },
  });
});

// ---------- Open project ----------
async function openProject(slug) {
  if (state.currentSlug === slug) return; // already open
  // Flush any pending edits to disk before swapping.
  await flushSave();
  // If the save failed (status still dirty), don't silently move on.
  if (state.saveStatus === "dirty") {
    const proceed = confirm(
      "Your current project has unsaved changes that couldn't be written to disk. Switch anyway and discard them?"
    );
    if (!proceed) return;
  }
  state.currentSlug = slug;
  state.current = await invoke("read_project", { root: state.root, slug });
  state.saveStatus = "saved";
  els.saveStatus.textContent = "—";
  enableProjectControls(true);
  renderProject();
  renderProjects(); // re-highlight
}

function enableProjectControls(enabled) {
  els.projectTitle.disabled = !enabled;
  els.addEntry.disabled = !enabled;
  els.deleteProject.disabled = !enabled;
  els.todoInput.disabled = !enabled;
  els.addFile.disabled = !enabled;
  els.addLink.disabled = !enabled;
  // Save button stays disabled until something is dirty
  els.saveBtn.disabled = true;
}

function renderProject() {
  const p = state.current;
  if (!p) {
    els.emptyState.classList.remove("hidden");
    els.entries.innerHTML = "";
    els.projectTitle.value = "";
    els.todoList.innerHTML = "";
    els.artifactList.innerHTML = "";
    els.todoCount.textContent = "";
    return;
  }
  els.emptyState.classList.add("hidden");
  els.projectTitle.value = p.meta.title;
  renderEntries();
  renderTodos();
  renderArtifacts();
}

// ---------- Entries ----------
function renderEntries() {
  const p = state.current;
  els.entries.innerHTML = "";
  if (!p.entries || p.entries.length === 0) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "no entries yet — click + entry to add one";
    els.entries.appendChild(note);
    return;
  }
  p.entries.forEach((entry, idx) => {
    const card = document.createElement("div");
    card.className = "entry";
    card.innerHTML = `
      <div class="entry-head">
        <input type="text" class="entry-heading" />
        <button class="entry-del" title="delete entry">×</button>
      </div>
      <textarea class="entry-body" placeholder="write…"></textarea>
    `;
    const headingInput = card.querySelector(".entry-heading");
    const bodyArea = card.querySelector(".entry-body");
    headingInput.value = entry.heading;
    bodyArea.value = entry.body;
    headingInput.addEventListener("input", () => {
      p.entries[idx].heading = headingInput.value;
      markDirty();
    });
    bodyArea.addEventListener("input", () => {
      p.entries[idx].body = bodyArea.value;
      markDirty();
      autoGrow(bodyArea);
    });
    card.querySelector(".entry-del").addEventListener("click", () => {
      if (!confirm("Delete this entry?")) return;
      p.entries.splice(idx, 1);
      markDirty();
      renderEntries();
    });
    els.entries.appendChild(card);
    autoGrow(bodyArea);
  });
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.max(120, textarea.scrollHeight) + "px";
}

els.addEntry.addEventListener("click", () => {
  const p = state.current;
  if (!p) return;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  p.entries.unshift({ heading: `${stamp} — new entry`, body: "" });
  markDirty();
  renderEntries();
  // Focus first heading
  const first = els.entries.querySelector(".entry-heading");
  if (first) first.focus();
});

els.projectTitle.addEventListener("input", () => {
  const p = state.current;
  if (!p) return;
  p.meta.title = els.projectTitle.value;
  markDirty();
});

els.deleteProject.addEventListener("click", async () => {
  const p = state.current;
  if (!p) return;
  if (!confirm(`Delete project "${p.meta.title}" and all its artifacts? This cannot be undone.`)) return;
  await invoke("delete_project", { root: state.root, slug: p.slug });
  state.current = null;
  state.currentSlug = null;
  enableProjectControls(false);
  renderProject();
  await refreshProjects();
});

// ---------- Todos ----------
function renderTodos() {
  const p = state.current;
  els.todoList.innerHTML = "";
  if (!p) return;
  const done = p.meta.todos.filter((t) => t.done).length;
  els.todoCount.textContent = p.meta.todos.length
    ? `${done}/${p.meta.todos.length}`
    : "";
  p.meta.todos.forEach((t, idx) => {
    const li = document.createElement("li");
    if (t.done) li.classList.add("done");
    li.innerHTML = `
      <input type="checkbox" />
      <span class="todo-text" contenteditable="true"></span>
      <button class="todo-del" title="remove">×</button>
    `;
    const cb = li.querySelector("input");
    const text = li.querySelector(".todo-text");
    cb.checked = t.done;
    text.textContent = t.text;
    cb.addEventListener("change", () => {
      t.done = cb.checked;
      li.classList.toggle("done", t.done);
      renderTodos();
      markDirty();
    });
    text.addEventListener("input", () => {
      t.text = text.textContent;
      markDirty();
    });
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        text.blur();
      }
    });
    li.querySelector(".todo-del").addEventListener("click", () => {
      p.meta.todos.splice(idx, 1);
      renderTodos();
      markDirty();
    });
    els.todoList.appendChild(li);
  });
}

els.todoForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const p = state.current;
  if (!p) return;
  const text = els.todoInput.value.trim();
  if (!text) return;
  p.meta.todos.push({ text, done: false });
  els.todoInput.value = "";
  renderTodos();
  markDirty();
});

// ---------- Artifacts ----------
function renderArtifacts() {
  const p = state.current;
  els.artifactList.innerHTML = "";
  if (!p) return;
  p.meta.artifacts.forEach((a, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="art-icon"></span>
      <span class="art-name"></span>
      <button class="art-del" title="remove">×</button>
    `;
    li.querySelector(".art-icon").textContent = a.kind === "link" ? "link" : "file";
    li.querySelector(".art-name").textContent = a.name;
    li.querySelector(".art-name").title = a.target;
    li.querySelector(".art-name").addEventListener("click", () => openArtifact(a));
    li.querySelector(".art-del").addEventListener("click", () => {
      if (!confirm(`Remove "${a.name}" from this project? (the file on disk is NOT deleted)`)) return;
      p.meta.artifacts.splice(idx, 1);
      renderArtifacts();
      markDirty();
    });
    els.artifactList.appendChild(li);
  });
}

async function openArtifact(a) {
  try {
    if (a.kind === "link") {
      await tauriShell.open(a.target);
    } else {
      const full = await invoke("resolve_artifact_path", {
        root: state.root,
        slug: state.current.slug,
        target: a.target,
      });
      await tauriShell.open(full);
    }
  } catch (e) {
    alert("Couldn't open: " + e);
  }
}

els.addFile.addEventListener("click", async () => {
  const p = state.current;
  if (!p) return;
  const selected = await tauriDialog.open({
    directory: false,
    multiple: true,
    title: "Add file to project",
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  for (const path of paths) {
    try {
      const art = await invoke("add_artifact_file", {
        root: state.root,
        slug: p.slug,
        srcPath: path,
      });
      p.meta.artifacts.push(art);
    } catch (e) {
      alert("Failed to add file: " + e);
    }
  }
  renderArtifacts();
  await flushSave();
});

els.addLink.addEventListener("click", () => {
  openModal({
    title: "Add link",
    fields: [
      { id: "name", label: "name", placeholder: "Reference paper" },
      { id: "url", label: "url", placeholder: "https://…" },
    ],
    onOk: async (vals) => {
      const name = (vals.name || "").trim();
      const url = (vals.url || "").trim();
      if (!name || !url) return false;
      const p = state.current;
      if (!p) return true;
      p.meta.artifacts.push({
        name,
        kind: "link",
        target: url,
        added: new Date().toISOString().slice(0, 10),
      });
      renderArtifacts();
      await flushSave();
      return true;
    },
  });
});

// ---------- Save / autosave ----------
function markDirty() {
  state.saveStatus = "dirty";
  els.saveStatus.textContent = "● unsaved";
  els.saveBtn.disabled = false;
  clearTimeout(state.saveTimer);
  // Autosave is the safety net — debounced 2s after last edit.
  state.saveTimer = setTimeout(flushSave, 2000);
}

async function flushSave() {
  if (!state.current) return;
  if (state.saveStatus !== "dirty") return;
  clearTimeout(state.saveTimer);
  // Snapshot what we're saving and which project it belongs to. If the user
  // switches projects mid-save, we can detect that and skip the post-save
  // bookkeeping so we don't write someone else's metadata onto the new project.
  const savingSlug = state.current.slug;
  const savingProject = state.current;
  state.saveStatus = "saving";
  els.saveStatus.textContent = "saving…";
  els.saveBtn.disabled = true;
  try {
    const updated = await invoke("save_project", {
      root: state.root,
      project: savingProject,
    });
    // CRITICAL: do NOT reassign state.current. The DOM handlers built by
    // renderEntries/renderTodos closed over the current project object —
    // replacing it would orphan those handlers and silently lose any edits
    // typed while the save was in flight or made after this save returns.
    // Mutate the existing object in place with just the fields the server
    // may have changed (created + updated timestamps).
    if (state.current && state.current.slug === savingSlug) {
      state.current.meta.created = updated.meta.created;
      state.current.meta.updated = updated.meta.updated;
      // If no further edits arrived during the save, we're clean.
      if (state.saveStatus === "saving") {
        state.saveStatus = "saved";
        els.saveStatus.textContent = "saved " + updated.meta.updated;
        els.saveBtn.disabled = true;
      }
    }
    refreshProjects();
  } catch (e) {
    state.saveStatus = "dirty";
    els.saveStatus.textContent = "save error: " + e;
    els.saveBtn.disabled = false;
    console.error(e);
  }
}

// Manual save button
els.saveBtn.addEventListener("click", () => {
  flushSave();
});

// ⌘S / Ctrl+S — save without leaving the keyboard
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    if (state.current && state.saveStatus === "dirty") flushSave();
  }
});

window.addEventListener("beforeunload", () => {
  // Best-effort sync flush
  if (state.saveStatus === "dirty") flushSave();
});

// ---------- Modal ----------
let modalCtx = null;
function openModal({ title, fields, onOk }) {
  els.modalTitle.textContent = title;
  els.modalFields.innerHTML = "";
  for (const f of fields) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <label class="small muted">${f.label}</label>
      <input type="text" data-id="${f.id}" placeholder="${f.placeholder || ""}" />
    `;
    els.modalFields.appendChild(wrap);
  }
  modalCtx = { onOk };
  els.modal.classList.remove("hidden");
  const first = els.modalFields.querySelector("input");
  if (first) first.focus();
}

function closeModal() {
  els.modal.classList.add("hidden");
  modalCtx = null;
}

els.modalCancel.addEventListener("click", closeModal);
els.modalOk.addEventListener("click", async () => {
  if (!modalCtx) return;
  const vals = {};
  els.modalFields.querySelectorAll("input").forEach((i) => {
    vals[i.dataset.id] = i.value;
  });
  const ok = await modalCtx.onOk(vals);
  if (ok !== false) closeModal();
});
els.modal.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.modalOk.click();
  if (e.key === "Escape") closeModal();
});

// ---------- Go ----------
boot();
