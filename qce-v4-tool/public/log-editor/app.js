(() => {
  "use strict";
  const C = window.LogEditorCore,
    root = document.getElementById("trpg-review-flow");
  const el = (id) => document.getElementById("rr-" + id),
    clone = C.clone;
  function notifyParent(data) {
    if (window.parent !== window && /^https?:$/.test(location.protocol))
      window.parent.postMessage(data, location.origin);
  }
  const MAX_BYTES = 64 * 1024 * 1024;
  let project = null,
    selected = new Set(),
    anchor = null,
    history = [],
    historyBytes = 0;
  let status = "",
    saveTimer = null,
    dbPromise = null,
    saved = true,
    sourceSaved = false,
    revision = 0,
    savedRevision = 0,
    backup = null;
  let loading = false,
    queuedSource = null,
    panes = [],
    activePane = null,
    nextPaneId = 1,
    drag = null,
    dragFrame = 0,
    skipClick = false;
  let peopleMap = new Map(),
    windowsMap = new Map();
  const state = () => project.state,
    current = () => project?.messages[state().current],
    editing = () => !!project?.state.draft;
  const node = (tag, className, text) => {
    const x = document.createElement(tag);
    if (className) x.className = className;
    if (text !== undefined) x.textContent = text;
    return x;
  };
  const button = (text, action, label) => {
    const x = node("button", "", text);
    x.type = "button";
    if (label) x.setAttribute("aria-label", label);
    x.addEventListener("click", action);
    return x;
  };
  const fail = (text) => {
    el("error").textContent = text;
    el("error").hidden = false;
  };
  const clearError = () => {
    el("error").hidden = true;
  };
  const manuscript = new window.LogManuscript({
    C,
    el,
    getProject: () => project,
    canOpen: () => !editing(),
    review: () => resumeReview(),
    beforeEdit: () => remember(),
    changed: () => scheduleSave(),
    canUndo: () => history.length > 0,
    undo: () => undo(),
    assign: (ids, label) =>
      update("已归入 " + label, () => C.assign(project, ids, label)),
    closed: () => {
      if (project) render(false);
      resumeReview();
    },
  });
  function database() {
    if (!dbPromise)
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("qce-log-editor", 1);
        request.onupgradeneeded = () => {
          for (const name of ["sources", "progress"])
            if (!request.result.objectStoreNames.contains(name))
              request.result.createObjectStore(name, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("请关闭其他整理窗口后重试。"));
      });
    return dbPromise;
  }
  async function readProject(id) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["sources", "progress"], "readonly"),
        source = tx.objectStore("sources").get(id),
        progress = tx.objectStore("progress").get(id);
      tx.oncomplete = () => {
        if (!source.result || !progress.result) return resolve(null);
        try {
          const { windowSettings, ...overlay } = progress.result;
          const result = C.validateProject({ ...source.result, ...overlay });
          if (windowSettings)
            for (const window of result.windows) {
              const settings = windowSettings.find((x) => x.id === window.id);
              if (settings) {
                window.name = settings.name;
                window.enabled = settings.enabled;
              }
            }
          resolve(C.validateProject(result));
        } catch (error) {
          reject(error);
        }
      };
      tx.onerror = () => reject(tx.error);
    });
  }
  async function recents() {
    try {
      const db = await database(),
        items = await new Promise((resolve, reject) => {
          const q = db
            .transaction("progress", "readonly")
            .objectStore("progress")
            .getAll();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        });
      el("recents").replaceChildren(
        ...items
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 5)
          .map((item) =>
            button(item.title, async () => {
              try {
                await protectCurrent();
                const next = await readProject(item.id);
                if (next) await activate(next, true);
              } catch (error) {
                fail(error.message);
              }
            }),
          ),
      );
    } catch {}
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (!project || saved) return;
    const owner = project,
      token = revision,
      writeSource = !sourceSaved;
    const progress = {
      id: owner.id,
      title: owner.title,
      state: clone(owner.state),
      people: clone(owner.people),
      windowSettings: owner.windows.map(({ id, name, enabled }) => ({
        id,
        name,
        enabled,
      })),
      updatedAt: Date.now(),
    };
    try {
      const db = await database();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["sources", "progress"], "readwrite");
        if (writeSource) {
          const { state: unusedState, people: unusedPeople, ...source } = owner;
          tx.objectStore("sources").put(source);
        }
        tx.objectStore("progress").put(progress);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      if (project === owner) {
        sourceSaved = true;
        savedRevision = Math.max(savedRevision, token);
        saved = savedRevision >= revision;
        el("save").textContent = saved ? "已自动保存" : "保存中";
      }
      try {
        localStorage.setItem("qce-log-editor-last", owner.id);
      } catch {}
    } catch {
      if (project === owner) {
        saved = false;
        el("save").textContent = "未自动保存，请保存工程";
      }
    }
  }
  function scheduleSave() {
    revision++;
    saved = false;
    el("save").textContent = "保存中";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 350);
  }
  async function protectCurrent() {
    await flush();
    if (
      project &&
      !saved &&
      !(backup?.id === project.id && backup.revision === revision)
    )
      throw new Error("当前工程未能自动保存，请先保存工程再打开其他记录。");
  }
  async function activate(next, restored = false) {
    project = C.validateProject(next);
    selected.clear();
    anchor = null;
    history = [];
    historyBytes = 0;
    backup = null;
    sourceSaved = restored;
    revision = 0;
    savedRevision = 0;
    saved = restored;
    for (const pane of panes) pane.view.owner = null;
    if (!panes.length) addPane(state().scope);
    else {
      activePane = panes[0];
      activePane.scope = clone(state().scope);
    }
    status = restored ? "已继续上次进度" : "已打开记录";
    clearError();
    el("open-menu").open = false;
    el("search").value = "";
    render(true);
    if (!restored) {
      scheduleSave();
      await flush();
    } else el("save").textContent = "已自动保存";
    recents();
  }
  function remember() {
    const entry = {
        state: clone(state()),
        people: clone(project.people),
        windows: project.windows.map(({ id, name, enabled }) => ({
          id,
          name,
          enabled,
        })),
      },
      size = JSON.stringify(entry).length * 2;
    history.push({ entry, size });
    historyBytes += size;
    while (
      history.length > 50 ||
      (historyBytes > 8 * 1024 * 1024 && history.length > 1)
    )
      historyBytes -= history.shift().size;
  }
  function update(label, fn, reveal = false) {
    if (!project) return;
    try {
      remember();
      fn();
      status = label;
      clearError();
      render(reveal);
      scheduleSave();
    } catch (error) {
      const old = history.pop();
      if (old) {
        project.state = old.entry.state;
        project.people = old.entry.people;
        for (const window of project.windows) {
          const m = old.entry.windows.find((x) => x.id === window.id);
          if (m) Object.assign(window, m);
        }
        historyBytes -= old.size;
      }
      fail(error.message);
    }
  }
  function scopeLabel(scope) {
    if (scope.type === "all") return "全部原文";
    if (scope.type === "draft") return "整理稿";
    if (scope.type === "unassigned") return "待归类";
    if (scope.type === "window")
      return windowsMap.get(scope.windowId)?.name || "原始窗口";
    if (scope.type === "person")
      return peopleMap.get(scope.personId)?.role || "角色";
    return (
      (scope.personId ? peopleMap.get(scope.personId)?.role + " · " : "") +
      (scope.round || "未归类")
    );
  }
  function checkpoint() {
    if (!state().returnPoint && current())
      state().returnPoint = {
        current: state().current,
        scope: clone(state().scope),
      };
  }
  function jump(index, scope = activePane.scope, center = false) {
    if (editing() || !project?.messages[index]) return;
    checkpoint();
    state().scope = clone(scope);
    activePane.scope = clone(scope);
    state().current = index;
    status = "第 " + (index + 1) + " 条";
    render(false);
    activePane.view.reveal(index, center);
    resumeReview();
    scheduleSave();
  }
  function openScope(scope, pane = activePane) {
    if (!project || editing()) return;
    checkpoint();
    activePane = pane;
    state().scope = clone(scope);
    pane.scope = clone(scope);
    selected.clear();
    anchor = null;
    const ids = C.indices(project, scope);
    state().current =
      ids.find((i) => state().decisions[i] === "pending") ?? ids[0] ?? null;
    status = scopeLabel(scope);
    render(true);
    resumeReview();
    scheduleSave();
  }
  function resumeReview() {
    activePane?.viewport.focus({ preventScroll: true });
  }
  function decide(kind) {
    if (!current()) return;
    if (!activePane.view.visible(state().current)) {
      activePane.view.reveal(state().current);
      return;
    }
    const i = state().current,
      text = editing() ? state().draft.text : undefined;
    if (text !== undefined && !text.trim())
      return fail("正文为空，请填写内容或选择排除。");
    if (state().useSection && !state().defaultRound.trim())
      return fail("请填写当前章节 / 回合。");
    update(
      (kind === "keep" ? "已保留 #" : "已排除 #") + (i + 1),
      () => {
        C.decide(project, i, kind, text);
        selected.clear();
        anchor = null;
      },
      true,
    );
    el("keep").focus({ preventScroll: true });
  }
  function assign(label = el("round").value.trim()) {
    if (!project || editing()) return;
    if (selected.size)
      update(
        "已归入 " + (label || "未归类"),
        () => {
          C.assign(project, [...selected], label);
          selected.clear();
          anchor = null;
        },
        false,
      );
    el("keep").focus({ preventScroll: true });
  }
  function undo() {
    if (!history.length || editing()) return;
    const old = history.pop();
    historyBytes -= old.size;
    project.state = old.entry.state;
    project.people = old.entry.people;
    for (const window of project.windows) {
      const m = old.entry.windows.find((x) => x.id === window.id);
      if (m) Object.assign(window, m);
    }
    activePane.scope = clone(state().scope);
    selected.clear();
    anchor = null;
    status = "已撤销";
    render(true);
    scheduleSave();
  }
  function toggleEdit() {
    if (!current()) return;
    if (!activePane.view.visible(state().current)) {
      activePane.view.reveal(state().current);
      return;
    }
    state().draft = editing()
      ? null
      : { index: state().current, text: C.body(project, state().current) };
    render(true);
    scheduleSave();
  }
  function sourceOptions(select, scope) {
    const values = [
      { label: "全部原文", scope: { type: "all" } },
      ...project.windows.map((w) => ({
        label: w.name,
        scope: { type: "window", windowId: w.id },
      })),
      ...project.people.map((p) => ({
        label: "角色 · " + p.role,
        scope: { type: "person", personId: p.id },
      })),
    ];
    select.disabled = editing();
    const key = JSON.stringify(scope);
    if (!values.some((v) => JSON.stringify(v.scope) === key))
      values.push({ label: scopeLabel(scope), scope });
    select.replaceChildren(
      ...values.map((v) => {
        const option = node("option", "", v.label);
        option.value = JSON.stringify(v.scope);
        return option;
      }),
    );
    select.value = key;
  }
  function addPane(scope = { type: "all" }) {
    if (panes.length >= 3) return;
    const pane = { id: nextPaneId++, scope: clone(scope), ids: [] };
    pane.element = node("section", "r-pane");
    pane.element.dataset.pane = String(pane.id);
    const head = node("div", "r-pane-head");
    pane.select = node("select");
    pane.select.setAttribute("aria-label", "阅读窗来源");
    pane.select.addEventListener("change", () =>
      openScope(JSON.parse(pane.select.value), pane),
    );
    pane.badge = node("span", "r-pane-badge");
    head.append(
      pane.select,
      pane.badge,
      button("收起", () => removePane(pane), "关闭阅读窗"),
    );
    pane.viewport = node("div", "r-scroll");
    pane.viewport.setAttribute("role", "list");
    pane.viewport.setAttribute("aria-label", "聊天消息");
    pane.viewport.tabIndex = 0;
    pane.element.append(head, pane.viewport);
    el("panes").append(pane.element);
    pane.view = new window.LogViewport(
      pane.viewport,
      (id, previous) => renderMessage(id, pane, previous),
      () => {
        if (activePane === pane)
          el("current-location").classList.toggle(
            "is-offscreen",
            !!project && !pane.view.visible(state().current),
          );
      },
    );
    panes.push(pane);
    if (!activePane) activePane = pane;
    return pane;
  }
  function removePane(pane) {
    if (panes.length === 1 || editing()) return;
    pane.view.destroy();
    pane.element.remove();
    panes = panes.filter((p) => p !== pane);
    if (activePane === pane) {
      activePane = panes[0];
      if (project) {
        state().scope = clone(activePane.scope);
        const ids = C.indices(project, activePane.scope);
        state().current = ids.includes(state().current)
          ? state().current
          : (ids[0] ?? null);
      }
    }
    render(true);
  }
  function split(vertical, add = false) {
    if (!project) return;
    if (add || panes.length === 1) addPane(activePane.scope);
    el("panes").classList.toggle("is-vertical", vertical);
    render(true);
    root.querySelector(".r-split-menu").open = false;
    resumeReview();
  }
  async function toggleFlow() {
    const on = !root.classList.contains("is-flow");
    root.classList.toggle("is-flow", on);
    el("flow").textContent = on ? "退出心流" : "心流";
    el("flow").setAttribute("aria-pressed", String(on));
    notifyParent({ type: "qce-log-editor:flow", enabled: on });
    if (on) {
      try {
        await root.requestFullscreen?.();
      } catch {}
    } else if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {}
    }
    requestAnimationFrame(() => activePane?.view.reveal(state().current));
  }
  // Keep the upstream modern viewer's message/avatar/bubble markup.
  function renderMessage(index, pane) {
    const message = project.messages[index],
      person = peopleMap.get(message.personId),
      window = windowsMap.get(message.windowId),
      isCurrent = pane === activePane && index === state().current;
    const block = node(
      "article",
      "message-block" +
        (isCurrent ? " r-current" : "") +
        (selected.has(index) ? " r-selected" : "") +
        (state().decisions[index] === "exclude" ? " r-excluded" : ""),
    );
    block.dataset.message = String(index + 1);
    block.setAttribute("role", "listitem");
    const checkLabel = node("label", "r-check"),
      check = node("input");
    check.type = "checkbox";
    check.checked = selected.has(index);
    check.disabled = editing();
    check.setAttribute("aria-label", "选择第 " + (index + 1) + " 条");
    check.addEventListener("click", (event) => {
      activePane = pane;
      state().scope = clone(pane.scope);
      state().current = index;
      const a = pane.ids.indexOf(anchor),
        b = pane.ids.indexOf(index),
        ids =
          event.shiftKey && a >= 0
            ? pane.ids.slice(Math.min(a, b), Math.max(a, b) + 1)
            : [index];
      for (const i of ids) check.checked ? selected.add(i) : selected.delete(i);
      anchor = index;
      render(false);
    });
    checkLabel.append(check);
    block.append(checkLabel);
    const self = !!(
        (window.selfUin && person.qq === window.selfUin) ||
        (window.selfUid && person.uid === window.selfUid)
      ),
      chat = node("div", "message " + (self ? "self" : "other"));
    const avatar = node("div", "avatar"),
      fallback = node("span", "avatar-fallback", person.role[0] || "人");
    avatar.append(fallback);
    const rawAvatar =
      message.original?.sender?.avatarBase64 ||
      (window.original || project.original)?.avatars?.[person.qq];
    if (
      typeof rawAvatar === "string" &&
      /^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(rawAvatar)
    ) {
      const image = node("img");
      image.alt = person.role;
      image.src = rawAvatar;
      image.addEventListener("error", () => image.remove());
      avatar.prepend(image);
    }
    const wrapper = node("div", "message-wrapper"),
      head = node("div", "message-header");
    if (isCurrent) {
      const name = node("input", "sender r-role-input");
      name.value = person.role;
      name.disabled = editing();
      name.setAttribute("aria-label", "角色名");
      name.addEventListener("change", () => {
        const value = name.value.trim();
        if (value)
          update("已统一角色名", () => {
            person.role = value;
          });
        else name.value = person.role;
      });
      head.append(name);
    } else head.append(node("span", "sender", person.role));
    head.append(node("span", "time", message.time || "时间未知"));
    if (project.windows.length > 1)
      head.append(node("span", "r-message-source", window.name));
    const number = button(
      "#" + (index + 1),
      () => {
        activePane = pane;
        jump(index, pane.scope);
      },
      "查看第 " + (index + 1) + " 条",
    );
    number.className = "r-number";
    number.disabled = editing();
    head.append(number);
    const round = state().rounds[index];
    if (round) head.append(node("span", "r-state", round));
    if (isCurrent || state().decisions[index] !== "pending")
      head.append(
        node(
          "span",
          "r-state",
          state().decisions[index] === "keep"
            ? "已保留"
            : state().decisions[index] === "exclude"
              ? "已排除"
              : "未确认",
        ),
      );
    const bubble = node("div", "message-bubble"),
      content = node("div", "content");
    if (isCurrent && editing()) {
      const input = node("textarea");
      input.id = "rr-draft";
      input.rows = 5;
      input.value = state().draft.text;
      input.setAttribute("aria-label", "编辑当前消息");
      input.addEventListener("input", () => {
        state().draft.text = input.value;
        scheduleSave();
      });
      content.append(input);
    } else content.textContent = C.body(project, index);
    bubble.append(content);
    wrapper.append(head, bubble);
    if (isCurrent && Object.hasOwn(state().edits, index)) {
      const origin = node("details", "r-origin");
      origin.append(node("summary", "", "原文"), node("p", "", message.text));
      wrapper.append(origin);
    }
    chat.append(avatar, wrapper);
    block.append(chat);
    block.addEventListener("click", (event) => {
      if (skipClick) return;
      if (
        event.target.closest("button,input,textarea,label,details,select") ||
        editing()
      )
        return;
      activePane = pane;
      jump(index, pane.scope);
    });
    block.addEventListener("pointerdown", (event) => {
      if (
        !editing() &&
        ["draft", "section", "round", "unassigned"].includes(pane.scope.type) &&
        event.button === 0 &&
        event.pointerType !== "touch" &&
        !event.target.closest("button,input,textarea,label,details,select")
      )
        drag = {
          pane,
          start: index,
          x: event.clientX,
          y: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          started: false,
        };
    });
    return block;
  }
  function selectionRange(pane, start, end) {
    const a = pane.ids.indexOf(start),
      b = pane.ids.indexOf(end);
    if (a < 0 || b < 0) return;
    selected = new Set(pane.ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    renderChecks();
  }
  function dragTick() {
    if (!drag?.started) return;
    const { pane, lastX: x, lastY: y } = drag,
      box = pane.viewport.getBoundingClientRect();
    if (y < box.top + 25) pane.viewport.scrollTop -= 16;
    else if (y > box.bottom - 25) pane.viewport.scrollTop += 16;
    const hit = document
      .elementFromPoint(
        Math.max(box.left + 3, Math.min(x, box.right - 3)),
        Math.max(box.top + 3, Math.min(y, box.bottom - 3)),
      )
      ?.closest("[data-index]");
    if (hit && pane.viewport.contains(hit))
      selectionRange(pane, drag.start, Number(hit.dataset.index));
    dragFrame = requestAnimationFrame(dragTick);
  }
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!drag) return;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (
        !drag.started &&
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6
      ) {
        drag.started = true;
        activePane = drag.pane;
        state().scope = clone(activePane.scope);
        root.classList.add("is-dragging");
        window.getSelection()?.removeAllRanges();
        dragTick();
      }
      if (drag.started) event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener("pointerup", () => {
    if (drag?.started) {
      skipClick = true;
      setTimeout(() => {
        skipClick = false;
      }, 0);
    }
    drag = null;
    cancelAnimationFrame(dragFrame);
    root.classList.remove("is-dragging");
  });
  function renderChecks() {
    for (const pane of panes)
      for (const [id, row] of pane.view.nodes) {
        row.classList.toggle("r-selected", selected.has(id));
        const input = row.querySelector("input[type=checkbox]");
        if (input) input.checked = selected.has(id);
      }
    const ids = activePane?.ids || [];
    el("select-all").checked =
      !!ids.length && ids.every((i) => selected.has(i));
    el("clear-selection").hidden = !selected.size;
    el("selection-count").textContent = selected.size
      ? "已选 " + selected.size + " 条"
      : "";
    el("assign").hidden = !selected.size;
    renderSections();
  }
  function renderManagers() {
    el("windows").replaceChildren(
      ...project.windows.map((window) => {
        const row = node("div", "r-window-row"),
          line = node("div", "r-source-line"),
          enabled = node("input");
        enabled.type = "checkbox";
        enabled.checked = window.enabled;
        enabled.disabled = editing();
        enabled.setAttribute("aria-label", "纳入窗口 " + window.name);
        enabled.addEventListener("change", () =>
          update(
            window.name + (enabled.checked ? " 已纳入" : " 不纳入成稿"),
            () => {
              window.enabled = enabled.checked;
            },
            true,
          ),
        );
        const name = node("input");
        name.value = window.name;
        name.disabled = editing();
        name.setAttribute("aria-label", "窗口名称 " + window.name);
        name.addEventListener("change", () => {
          const value = name.value.trim();
          if (value)
            update("已更新窗口名称", () => {
              window.name = value;
            });
          else name.value = window.name;
        });
        line.append(enabled, name);
        const meta = node("div", "r-source-meta");
        meta.append(
          node(
            "span",
            "",
            project.messages.filter((m) => m.windowId === window.id).length +
              " 条",
          ),
        );
        row.append(line, meta);
        return row;
      }),
    );
    el("roles").replaceChildren(
      ...project.people.map((person) => {
        const row = node("div", "r-role-row"),
          account = node("div", "r-source-meta");
        account.append(
          node("span", "", person.name + " · " + (person.qq || "UID")),
        );
        const line = node("div", "r-source-line"),
          input = node("input");
        input.value = person.role;
        input.disabled = editing();
        input.setAttribute(
          "aria-label",
          "角色名 " + (person.qq || person.name),
        );
        input.addEventListener("change", () => {
          const value = input.value.trim();
          if (value)
            update("已统一角色名", () => {
              person.role = value;
            });
          else input.value = person.role;
        });
        line.append(input);
        row.append(account, line);
        return row;
      }),
    );
  }
  function renderSections() {
    if (!project) return;
    const ids = C.indices(project, { type: "draft" }),
      counts = new Map();
    for (const i of ids) {
      const key = state().rounds[i] || "";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const labels = [
      "",
      ...new Set(
        state().sections.concat(Object.values(state().rounds)).filter(Boolean),
      ),
    ];
    el("sections-table").classList.toggle("has-selection", !!selected.size);
    el("sections-body").replaceChildren(
      ...labels.map((label) => {
        const row = node(
          "tr",
          state().useSection && state().defaultRound === label
            ? "is-active"
            : "",
        );
        const name = node("td"),
          count = node("td", "", String(counts.get(label) || 0)),
          action = node("td");
        name.append(
          button(
            label || "未归类",
            () =>
              manuscript.open(
                label
                  ? { type: "section", round: label }
                  : { type: "unassigned" },
              ),
            "查看 " + (label || "未归类"),
          ),
        );
        if (selected.size)
          action.append(
            button("归入", () => assign(label), "归入 " + (label || "未归类")),
          );
        row.append(name, count, action);
        return row;
      }),
    );
  }
  function render(reveal = false) {
    if (!project) return;
    peopleMap = new Map(project.people.map((p) => [p.id, p]));
    windowsMap = new Map(project.windows.map((w) => [w.id, w]));
    if (!activePane) addPane(state().scope);
    activePane.scope = clone(state().scope);
    for (const pane of panes) {
      if (
        (pane.scope.windowId && !windowsMap.has(pane.scope.windowId)) ||
        (pane.scope.personId && !peopleMap.has(pane.scope.personId))
      )
        pane.scope = { type: "all" };
      pane.element.classList.toggle("is-active", pane === activePane);
      pane.element.querySelector("button").disabled = editing();
      pane.ids = C.indices(project, pane.scope);
      pane.badge.textContent =
        pane !== activePane
          ? "参考"
          : !pane.ids.length
            ? "无消息"
            : pane.ids.some((i) => state().decisions[i] === "pending")
              ? "审阅中"
              : "本窗已确认";
      sourceOptions(pane.select, pane.scope);
    }
    const ids = activePane.ids;
    if (!ids.includes(state().current)) state().current = ids[0] ?? null;
    el("empty").hidden = true;
    el("workspace").hidden = false;
    const included = C.indices(project, { type: "all" }),
      pending = included.filter(
        (i) => state().decisions[i] === "pending",
      ).length,
      kept = C.indices(project, { type: "draft" }).length;
    el("title").textContent = project.title;
    el("progress").textContent =
      "已确认 " + (included.length - pending) + " / " + included.length;
    el("total").textContent = ids.length + " 条";
    el("scope").textContent = "审阅 · " + scopeLabel(activePane.scope);
    el("scope").hidden = panes.length === 1;
    el("source").hidden = panes.length > 1;
    sourceOptions(el("source"), activePane.scope);
    el("all").setAttribute("aria-pressed", String(!manuscript.active()));
    el("draft-view").setAttribute("aria-pressed", String(manuscript.active()));
    el("return").hidden = !state().returnPoint;
    el("return").disabled = editing();
    el("select-all-label").hidden =
      activePane.scope.type === "all" || !ids.length;
    el("select-all").disabled = editing();
    el("prev").disabled =
      editing() || !current() || ids.indexOf(state().current) <= 0;
    el("next").disabled =
      editing() || !current() || ids.indexOf(state().current) >= ids.length - 1;
    el("keep").disabled = !current();
    el("keep").innerHTML = editing()
      ? "确认并继续 <kbd>Ctrl Enter</kbd>"
      : "保留 <kbd>A</kbd>";
    el("exclude").disabled = editing() || !current();
    el("edit").disabled = !current();
    el("edit").innerHTML = editing()
      ? "取消 <kbd>Esc</kbd>"
      : "编辑 <kbd>E</kbd>";
    el("undo").disabled = editing() || !history.length;
    el("current-location").textContent = current()
      ? "#" + (state().current + 1)
      : "暂无内容";
    el("current-location").disabled = !current();
    el("status").textContent = status;
    el("save-project").disabled = false;
    el("use-section").checked = state().useSection;
    el("use-section").disabled = editing();
    el("round").disabled = editing();
    el("assign").disabled = editing();
    if (document.activeElement !== el("round"))
      el("round").value = state().defaultRound;
    el("rounds").replaceChildren(
      ...state().sections.map((label) => {
        const option = node("option");
        option.value = label;
        return option;
      }),
    );
    root.querySelectorAll("[data-export]").forEach((b) => {
      b.disabled = !kept;
    });
    el("panes").classList.toggle("is-split", panes.length > 1);
    for (const pane of panes) pane.view.setItems(pane.ids, project);
    renderManagers();
    renderChecks();
    el("draft-view").disabled = editing();
    manuscript.refresh();
    if (reveal && current()) activePane.view.reveal(state().current);
    if (editing()) {
      const input = el("draft");
      if (input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }
  function download(contents, name, type) {
    const url = URL.createObjectURL(new Blob([contents], { type })),
      a = node("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const safeName = (name) =>
    name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "跑团记录";
  function saveProject() {
    if (project) {
      download(
        C.packed(project),
        safeName(project.title) + ".qcelog",
        "application/json",
      );
      backup = { id: project.id, revision };
    }
  }
  function originalOf(owner, window) {
    return window.original ?? owner.original;
  }
  function sameSource(owner, other) {
    return owner.windows.find(
      (window) =>
        (window.filename || window.name) ===
          (other.windows[0].filename || other.windows[0].name) &&
        JSON.stringify(originalOf(owner, window)) ===
          JSON.stringify(other.original),
    );
  }
  async function decode(file) {
    if (file.size > MAX_BYTES)
      throw new Error("单个记录超过 64 MB，请按日期分段导出。");
    const data = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      if (!/\.txt$/i.test(file.name)) throw new Error("文件不是 UTF-8 编码。");
      text = new TextDecoder("gb18030", { fatal: true }).decode(data);
    }
    return C.parse(text, file.name);
  }
  async function openFiles(files, asProject = false) {
    files = [...files];
    if (!files.length || loading) return;
    if (
      files.length > 20 ||
      files.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024
    )
      return fail("请分批导入，单批最多 20 个文件、128 MB。");
    loading = true;
    try {
      const parsed = [];
      for (const file of files) parsed.push(await decode(file));
      const isProject =
        asProject || files.some((f) => /\.qcelog$/i.test(f.name));
      if (isProject && files.length !== 1)
        throw new Error("工程文件请单独打开。");
      await protectCurrent();
      if (isProject) {
        await activate(parsed[0]);
      } else {
        let next = project ? C.validateProject(project) : null,
          added = 0;
        for (const part of parsed) {
          if (next && sameSource(next, part)) continue;
          next = next ? C.merge(next, part) : part;
          added++;
        }
        if (!added) return;
        await activate(next);
        status = "已导入 " + added + " 个窗口";
        el("status").textContent = status;
      }
    } catch (error) {
      fail(error.message);
    } finally {
      loading = false;
      el("file").value = "";
      el("project-file").value = "";
      drainSource();
    }
  }
  async function newLog() {
    try {
      await protectCurrent();
      project = null;
      manuscript.refresh();
      selected.clear();
      history = [];
      for (const pane of panes) pane.view.destroy();
      panes = [];
      activePane = null;
      el("panes").replaceChildren();
      el("workspace").hidden = true;
      el("empty").hidden = false;
      el("open-menu").open = false;
      el("title").textContent = "跑团 log 整理";
      el("progress").textContent = "";
      el("save").textContent = "";
      el("save-project").disabled = true;
      root.querySelectorAll("[data-export]").forEach((b) => {
        b.disabled = true;
      });
      try {
        localStorage.removeItem("qce-log-editor-last");
      } catch {}
    } catch (error) {
      fail(error.message);
    }
  }
  function locate() {
    if (!project || editing()) return;
    const q = el("search").value.trim().toLowerCase();
    if (!q) return;
    const exact = q.match(/^#(\d+)$/),
      found = project.messages.filter((m) =>
        exact
          ? m.id === Number(exact[1]) - 1
          : [
              m.text,
              C.body(project, m.id),
              m.time,
              C.role(project, m),
              windowsMap.get(m.windowId)?.name || "",
            ].some((t) => t.toLowerCase().includes(q)),
      );
    if (!found.length) {
      el("status").textContent = "未找到匹配内容";
      return;
    }
    const target = found.find((m) => m.id > state().current) || found[0];
    jump(target.id, { type: "all" }, true);
  }
  for (const id of ["open", "open-empty"])
    el(id).addEventListener("click", () => el("file").click());
  el("open-project").addEventListener("click", () =>
    el("project-file").click(),
  );
  el("file").addEventListener("change", () => openFiles(el("file").files));
  el("project-file").addEventListener("change", () =>
    openFiles(el("project-file").files, true),
  );
  el("new").addEventListener("click", newLog);
  el("save-project").addEventListener("click", saveProject);
  root.querySelectorAll("[data-export]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!project) return;
      const fmt = b.dataset.export;
      download(
        C.output(project, fmt),
        safeName(project.title) + "." + fmt,
        fmt === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8",
      );
      el("export-menu").open = false;
    }),
  );
  el("keep").addEventListener("click", () => decide("keep"));
  el("exclude").addEventListener("click", () => decide("exclude"));
  el("edit").addEventListener("click", toggleEdit);
  el("undo").addEventListener("click", undo);
  el("round").addEventListener("change", () => {
    if (
      project &&
      !editing() &&
      el("round").value.trim() !== state().defaultRound
    )
      update("已更新归属名称", () =>
        C.startSection(project, el("round").value),
      );
  });
  el("round").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (selected.size) assign();
      else {
        el("round").blur();
        resumeReview();
      }
    }
  });
  el("assign").addEventListener("click", () => assign());
  el("use-section").addEventListener("change", () => {
    const enabled = el("use-section").checked;
    update(enabled ? "已开启自动归属" : "已关闭自动归属", () => {
      C.startSection(project, el("round").value);
      state().useSection = enabled;
    });
    if (enabled && !state().defaultRound) el("round").focus();
    else resumeReview();
  });
  el("source").addEventListener("change", () =>
    openScope(JSON.parse(el("source").value)),
  );
  el("all").addEventListener("click", () => openScope({ type: "all" }));
  el("draft-view").addEventListener("click", () => manuscript.open());
  el("return").addEventListener("click", () => {
    if (!project || !state().returnPoint || editing()) return;
    state().current = state().returnPoint.current;
    state().scope = state().returnPoint.scope;
    activePane.scope = clone(state().scope);
    state().returnPoint = null;
    selected.clear();
    status = "已回到原进度";
    render(true);
    resumeReview();
    scheduleSave();
  });
  el("prev").addEventListener("click", () => {
    if (!project) return;
    const ids = activePane.ids,
      p = ids.indexOf(state().current);
    if (p > 0) jump(ids[p - 1]);
  });
  el("next").addEventListener("click", () => {
    if (!project) return;
    const ids = activePane.ids,
      p = ids.indexOf(state().current);
    if (p >= 0 && p < ids.length - 1) jump(ids[p + 1]);
  });
  el("current-location").addEventListener("click", () =>
    activePane?.view.reveal(state().current, true),
  );
  el("locate").addEventListener("click", locate);
  el("search").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      locate();
    }
  });
  el("select-all").addEventListener("change", () => {
    const enabled = el("select-all").checked;
    for (const id of activePane.ids)
      enabled ? selected.add(id) : selected.delete(id);
    renderChecks();
  });
  el("clear-selection").addEventListener("click", () => {
    selected.clear();
    anchor = null;
    renderChecks();
  });
  for (const menu of [
    el("open-menu"),
    el("export-menu"),
    root.querySelector(".r-split-menu"),
    el("sidebar"),
    el("sections-panel"),
  ])
    menu.addEventListener("toggle", () => {
      if (!menu.open && project && !editing() && !manuscript.active())
        resumeReview();
    });
  for (const id of ["sidebar", "sections-panel"])
    el(id).addEventListener("toggle", () => {
      if (el(id).open && matchMedia("(max-width:720px)").matches)
        el(id === "sidebar" ? "sections-panel" : "sidebar").open = false;
    });
  window.addEventListener("resize", () => {
    if (
      matchMedia("(max-width:720px)").matches &&
      el("sidebar").open &&
      el("sections-panel").open
    )
      el("sections-panel").open = false;
  });
  el("windows-tab").addEventListener("click", () => {
    el("windows").hidden = false;
    el("roles").hidden = true;
    el("windows-tab").setAttribute("aria-pressed", "true");
    el("roles-tab").setAttribute("aria-pressed", "false");
  });
  el("roles-tab").addEventListener("click", () => {
    el("roles").hidden = false;
    el("windows").hidden = true;
    el("roles-tab").setAttribute("aria-pressed", "true");
    el("windows-tab").setAttribute("aria-pressed", "false");
  });
  el("split-horizontal").addEventListener("click", () => split(false));
  el("split-vertical").addEventListener("click", () => split(true));
  el("add-pane").addEventListener("click", () =>
    split(el("panes").classList.contains("is-vertical"), true),
  );
  el("single-pane").addEventListener("click", () => {
    while (panes.length > 1) removePane(panes[panes.length - 1]);
    root.querySelector(".r-split-menu").open = false;
  });
  el("flow").addEventListener("click", toggleFlow);
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && root.classList.contains("is-flow")) {
      root.classList.remove("is-flow");
      el("flow").textContent = "心流";
      el("flow").setAttribute("aria-pressed", "false");
      notifyParent({ type: "qce-log-editor:flow", enabled: false });
    }
  });
  el("demo").addEventListener("click", async () => {
    const rows = [
      ["10001", "KP", "雨水敲打着车窗。你们抵达了山脚下的旧旅馆。"],
      ["10002", "林雾", "我先看看柜台和门口，确认有没有人刚刚离开。"],
      ["10003", "沈舟", "（我去倒杯水，马上回来）"],
      ["10002", "林雾", ".ra 侦查"],
      ["10004", "骰子", "林雾进行侦查检定：D100=23/60，成功。"],
      ["10001", "KP", "柜台上留着一封拆开的信。"],
      ["10003", "沈舟", "我拿起信封，看看里面有没有别的东西。"],
      ["10002", "林雾", "我站再门边，留意外面有没有脚步声。"],
      ["10001", "KP", "楼上传来一声轻响。"],
      ["10002", "林雾", "我抬头看向楼梯口。"],
      ["10003", "沈舟", "我把信收好。"],
      ["10001", "KP", "一位老人出现在楼梯上：“你们终于来了。”"],
    ];
    const data = {
      chatInfo: { name: "雨夜来信 · 示例", selfUin: "10002" },
      messages: rows.map((r, i) => ({
        id: String(i),
        time: "20:" + String(i).padStart(2, "0"),
        sender: { uin: r[0], uid: "u_" + r[0], name: r[1] },
        content: { text: r[2] },
      })),
    };
    try {
      await protectCurrent();
      await activate(C.parse(JSON.stringify(data), "示例.json"));
    } catch (error) {
      fail(error.message);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      !project ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey
    )
      return;
    if (manuscript.active()) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveProject();
      }
      return;
    }
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
        (event.target.tagName === "SUMMARY" &&
          event.target.parentElement?.hasAttribute("open")));
    if (editing()) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        decide("keep");
      } else if (event.key === "Escape") {
        event.preventDefault();
        toggleEdit();
      }
      return;
    }
    if (typing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveProject();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      decide("keep");
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      decide("exclude");
    } else if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      toggleEdit();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      el("prev").click();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      el("next").click();
    } else if (event.key === "Escape" && root.classList.contains("is-flow"))
      void toggleFlow();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });
  window.addEventListener("beforeunload", (event) => {
    if (
      !saved &&
      !(backup?.id === project?.id && backup.revision === revision)
    ) {
      flush();
      event.preventDefault();
      event.returnValue = "";
    }
  });
  function drainSource() {
    if (!loading && queuedSource) {
      const next = queuedSource;
      queuedSource = null;
      void receiveSource(next);
    }
  }
  async function receiveSource(data) {
    if (loading) {
      queuedSource = data;
      return;
    }
    loading = true;
    const { text, name, taskId } = data;
    try {
      const next = C.parse(text, name);
      next.windows[0].taskId = taskId;
      await protectCurrent();
      if (!project) {
        let previousId;
        try {
          previousId = localStorage.getItem("qce-log-editor-task-" + taskId);
        } catch {}
        const previous = previousId
          ? await readProject(previousId).catch(() => null)
          : null;
        if (previous) await activate(previous, true);
      }
      let found = project?.windows.find(
        (w) =>
          w.taskId === taskId &&
          JSON.stringify(originalOf(project, w)) ===
            JSON.stringify(next.original),
      );
      if (!found) {
        if (project) await activate(C.merge(project, next));
        else await activate(next);
        found = project.windows.find((w) => w.taskId === taskId);
      }
      if (found) openScope({ type: "window", windowId: found.id });
      try {
        localStorage.setItem("qce-log-editor-task-" + taskId, project.id);
      } catch {}
      notifyParent({ type: "qce-log-editor:loaded", taskId });
    } catch (error) {
      fail(error.message);
      notifyParent({
        type: "qce-log-editor:error",
        message: error.message,
        taskId,
      });
    } finally {
      loading = false;
      drainSource();
    }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== location.origin)
      return;
    if (event.data?.type !== "qce-log-editor:source") return;
    const { text, name, taskId } = event.data;
    if (
      typeof text !== "string" ||
      text.length > MAX_BYTES ||
      typeof name !== "string" ||
      typeof taskId !== "string"
    )
      return;
    void receiveSource({ text, name, taskId });
  });
  if (window.parent !== window) notifyParent({ type: "qce-log-editor:ready" });
  async function start() {
    try {
      const id = localStorage.getItem("qce-log-editor-last");
      if (id) {
        const last = await readProject(id);
        if (last && !project && !loading) await activate(last, true);
      }
    } catch {}
    recents();
  }
  start();
})();
