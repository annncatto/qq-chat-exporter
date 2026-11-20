/* A text manuscript view over retained messages. Editing keeps source identities. */
window.LogManuscript = class LogManuscript {
  constructor(options) {
    Object.assign(this, options);
    this.role = "";
    this.section = null;
    this.selection = [];
    this.timer = null;
    this.drag = null;
    this.dialog = this.el("log-editor");
    this.float = this.el("log-preview");
    this.content = this.el("log-content");
    const toggle = this.el("preview-toggle");
    try {
      toggle.checked = localStorage.getItem("qce-log-preview") === "true";
    } catch {}
    toggle.addEventListener("change", () => this.toggle(toggle.checked));
    this.el("preview-close").addEventListener("click", () =>
      this.toggle(false),
    );
    this.el("preview-text").addEventListener("click", () => {
      if (window.getSelection()?.isCollapsed !== false) this.open();
    });
    this.el("preview-text").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.open();
      }
    });
    this.el("log-close").addEventListener("click", () => this.dialog.close());
    this.dialog.addEventListener("close", () => {
      this.clearSelection();
      this.el("draft-view").setAttribute("aria-pressed", "false");
      this.closed();
    });
    this.el("log-role").addEventListener("change", () => {
      this.role = this.el("log-role").value;
      this.renderEditor();
      this.content.scrollTop = 0;
    });
    this.el("log-section").addEventListener("change", () => {
      this.section = JSON.parse(this.el("log-section").value);
      this.renderEditor();
      this.content.scrollTop = 0;
    });
    this.el("log-undo").addEventListener("click", () => this.undo());
    this.el("log-assign").addEventListener("click", () =>
      this.assignSelection(),
    );
    this.el("log-round").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        this.assignSelection();
      }
    });
    this.el("log-clear").addEventListener("click", () => this.clearSelection());
    document.addEventListener("selectionchange", () => this.readSelection());
    this.content.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      const entry = event.target.closest("[data-log-index]");
      if (!entry) return;
      this.clearSelection();
      this.dragRange = {
        start: Number(entry.dataset.logIndex),
        started: false,
        x: event.clientX,
        y: event.clientY,
      };
    });
    document.addEventListener(
      "pointermove",
      (event) => {
        if (!this.dragRange) return;
        const box = this.content.getBoundingClientRect();
        const hit = document
          .elementFromPoint(
            Math.max(box.left + 2, Math.min(event.clientX, box.right - 2)),
            Math.max(box.top + 2, Math.min(event.clientY, box.bottom - 2)),
          )
          ?.closest("[data-log-index]");
        if (!hit || !this.content.contains(hit)) return;
        const index = Number(hit.dataset.logIndex);
        if (index !== this.dragRange.start) this.dragRange.started = true;
        if (!this.dragRange.started) return;
        event.preventDefault();
        this.blockSelection = true;
        window.getSelection()?.removeAllRanges();
        this.content.classList.add("is-selecting");
        const a = this.entries.findIndex(
            (x) => x.index === this.dragRange.start,
          ),
          b = this.entries.findIndex((x) => x.index === index);
        this.setSelection(
          this.entries
            .slice(Math.min(a, b), Math.max(a, b) + 1)
            .map((x) => x.index),
        );
        if (event.clientY < box.top + 20) this.content.scrollTop -= 16;
        else if (event.clientY > box.bottom - 20) this.content.scrollTop += 16;
      },
      { passive: false },
    );
    for (const event of ["pointerup", "pointercancel"])
      document.addEventListener(event, () => {
        this.dragRange = null;
        this.content.classList.remove("is-selecting");
      });

    this.el("preview-drag").addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const box = this.float.getBoundingClientRect();
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        left: box.left,
        top: box.top,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    });
    this.el("preview-drag").addEventListener("pointermove", (event) => {
      if (!this.drag) return;
      const { x, y, left, top } = this.drag;
      this.float.style.right = "auto";
      this.float.style.bottom = "auto";
      this.float.style.left =
        Math.max(
          0,
          Math.min(
            innerWidth - this.float.offsetWidth,
            left + event.clientX - x,
          ),
        ) + "px";
      this.float.style.top =
        Math.max(
          0,
          Math.min(
            innerHeight - this.float.offsetHeight,
            top + event.clientY - y,
          ),
        ) + "px";
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      this.el("preview-drag").addEventListener(event, () => {
        this.drag = null;
      });
    window.addEventListener("resize", () => {
      if (!this.float.style.left) return;
      const box = this.float.getBoundingClientRect();
      this.float.style.left =
        Math.max(0, Math.min(box.left, innerWidth - box.width)) + "px";
      this.float.style.top =
        Math.max(0, Math.min(box.top, innerHeight - box.height)) + "px";
    });
  }
  active() {
    return this.dialog.open;
  }
  toggle(enabled) {
    this.el("preview-toggle").checked = enabled;
    try {
      localStorage.setItem("qce-log-preview", String(enabled));
    } catch {}
    this.refreshText();
    if (!this.active()) this.review();
  }
  refreshText() {
    clearTimeout(this.timer);
    const project = this.getProject();
    this.float.hidden = !project || !this.el("preview-toggle").checked;
    if (!this.float.hidden) {
      const preview = this.el("preview-text"),
        oldTop = preview.scrollTop;
      const pinned = preview.scrollHeight - preview.clientHeight - oldTop < 4;
      const text = this.C.indices(project, { type: "draft" }).length
        ? this.C.output(project, "txt")
        : "尚无保留内容";
      if (preview.textContent !== text) preview.textContent = text;
      preview.scrollTop = pinned ? preview.scrollHeight : oldTop;
    }
  }
  refresh() {
    this.refreshText();
    if (this.active()) this.renderEditor();
    this.el("log-undo").disabled = !this.canUndo();
  }
  open(scope = { type: "draft" }) {
    if (!this.getProject() || !this.canOpen()) return;
    this.role = scope.personId || "";
    this.section = scope.type === "unassigned" ? "" : (scope.round ?? null);
    this.renderEditor();
    this.content.scrollTop = 0;
    if (!this.active()) this.dialog.showModal();
    this.el("all").setAttribute("aria-pressed", "false");
    this.el("draft-view").setAttribute("aria-pressed", "true");
    this.content.focus({ preventScroll: true });
  }
  renderEditor() {
    const project = this.getProject();
    if (!project) return;
    this.clearSelection();
    this.el("log-error").hidden = true;
    const option = (label, value) => {
      const x = document.createElement("option");
      x.textContent = label;
      x.value = value;
      return x;
    };
    if (this.role && !project.people.some((p) => p.id === this.role))
      this.role = "";
    this.el("log-role").replaceChildren(
      option("全部角色", ""),
      ...project.people.map((p) => option(p.role, p.id)),
    );
    this.el("log-role").value = this.role;
    this.el("log-section").replaceChildren(
      option("全部章节", JSON.stringify(null)),
      option("未归类", JSON.stringify("")),
      ...project.state.sections.map((s) => option(s, JSON.stringify(s))),
    );
    this.el("log-section").value = JSON.stringify(this.section);
    const ids = this.C.indices(project, { type: "draft" }).filter(
      (i) =>
        (!this.role || project.messages[i].personId === this.role) &&
        (this.section === null ||
          (project.state.rounds[i] || "") === this.section),
    );
    const fragment = document.createDocumentFragment(),
      title = document.createElement("h1");
    title.textContent = project.title;
    fragment.append(title);
    let previous = null;
    this.entries = [];
    for (const index of ids) {
      const round = project.state.rounds[index] || "";
      if (round !== previous && (round || previous)) {
        const heading = document.createElement("h2");
        heading.textContent = round || "未归类";
        fragment.append(heading);
      }
      previous = round;
      const entry = document.createElement("section");
      entry.className = "r-log-entry";
      entry.dataset.logIndex = String(index);
      const speaker = document.createElement("div");
      speaker.className = "r-log-speaker";
      speaker.textContent =
        "【" + this.C.role(project, project.messages[index]) + "】";
      const body = document.createElement("div");
      body.className = "r-log-body";
      body.contentEditable = "plaintext-only";
      body.spellcheck = false;
      body.textContent = this.C.body(project, index);
      body.setAttribute("role", "textbox");
      body.setAttribute("aria-multiline", "true");
      body.setAttribute("aria-label", "编辑 Log 第 " + (index + 1) + " 条");
      let recorded = false;
      body.addEventListener("focus", () => {
        recorded = false;
      });
      body.addEventListener("input", () => {
        const text = body.innerText.replace(/\r\n/g, "\n");
        if (!text.trim()) return;
        if (text === this.C.body(project, index)) return;
        if (!recorded) {
          this.beforeEdit();
          recorded = true;
        }
        this.C.editKept(project, index, text);
        this.changed();
        this.el("log-error").hidden = true;
        this.el("log-undo").disabled = !this.canUndo();
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refreshText(), 120);
      });
      body.addEventListener("blur", () => {
        if (!body.innerText.trim()) {
          body.textContent = this.C.body(project, index);
          this.error("正文不能为空，已保留修改前的内容。");
        }
      });
      entry.append(speaker, body);
      fragment.append(entry);
      this.entries.push({ index, entry });
    }
    if (!ids.length) {
      const empty = document.createElement("p");
      empty.className = "r-log-empty";
      empty.textContent = "尚无保留内容";
      fragment.append(empty);
    }
    this.content.replaceChildren(fragment);
    this.el("log-undo").disabled = !this.canUndo();
  }
  error(message) {
    this.el("log-error").textContent = message;
    this.el("log-error").hidden = false;
  }
  readSelection() {
    if (!this.active() || this.blockSelection) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!this.content.contains(range.commonAncestorContainer)) return;
    this.setSelection(
      selection.isCollapsed
        ? []
        : this.entries
            .filter(({ entry }) => range.intersectsNode(entry))
            .map((x) => x.index),
    );
  }
  setSelection(ids) {
    this.selection = ids;
    const selected = new Set(ids);
    for (const { index, entry } of this.entries)
      entry.classList.toggle("is-selected", selected.has(index));
    this.el("log-selection").hidden = !ids.length;
    this.el("log-selection-count").textContent = "已选 " + ids.length + " 条";
    if (ids.length && document.activeElement !== this.el("log-round"))
      this.el("log-round").value = this.getProject().state.defaultRound;
  }
  clearSelection() {
    this.blockSelection = false;
    for (const { entry } of this.entries || [])
      entry.classList.remove("is-selected");
    this.selection = [];
    this.el("log-selection").hidden = true;
    if (this.active()) window.getSelection()?.removeAllRanges();
  }
  assignSelection() {
    const label = this.el("log-round").value.trim();
    if (!label) return this.error("请填写章节／回合名称。");
    if (!this.selection.length) return;
    this.assign([...this.selection], label);
    this.clearSelection();
  }
};
