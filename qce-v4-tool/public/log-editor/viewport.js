/* Native scrolling with measured, bounded DOM windows. Each pane owns its cache. */
window.LogViewport = class LogViewport {
  constructor(element, renderRow, changed) {
    this.element = element;
    this.renderRow = renderRow;
    this.changed = changed;
    this.ids = [];
    this.positions = new Map();
    this.heights = new Map();
    this.prefix = [0];
    this.nodes = new Map();
    this.frame = 0;
    this.owner = null;
    this.width = 0;
    this.pinEnd = false;
    this.before = document.createElement("div");
    this.after = document.createElement("div");
    this.list = document.createElement("div");
    this.before.setAttribute("aria-hidden", "true");
    this.after.setAttribute("aria-hidden", "true");
    this.list.className = "r-visible-rows";
    element.replaceChildren(this.before, this.list, this.after);
    this.scroll = () => {
      this.pinEnd =
        element.scrollHeight - element.scrollTop - element.clientHeight < 2;
      this.schedule();
    };
    element.addEventListener("scroll", this.scroll, { passive: true });
    this.rowsObserver = new ResizeObserver((entries) => {
      const at = this.indexAt(element.scrollTop),
        offset = element.scrollTop - (this.prefix[at] || 0);
      let dirty = false;
      for (const entry of entries) {
        const id = Number(entry.target.dataset.index),
          height = Math.ceil(entry.target.getBoundingClientRect().height);
        if (height > 0 && this.heights.get(id) !== height) {
          this.heights.set(id, height);
          dirty = true;
        }
      }
      if (dirty) {
        this.measure();
        if (!this.pinEnd) element.scrollTop = (this.prefix[at] || 0) + offset;
        this.schedule();
      }
    });
    this.sizeObserver = new ResizeObserver(() => {
      const width = Math.round(element.getBoundingClientRect().width);
      if (width !== this.width) {
        this.width = width;
        this.heights.clear();
        this.measure();
        this.refresh();
      }
    });
    this.sizeObserver.observe(element);
  }
  setItems(ids, owner) {
    if (this.owner !== owner) {
      this.owner = owner;
      this.heights.clear();
      this.nodes.clear();
      this.pinEnd = false;
      this.element.scrollTop = 0;
    }
    this.ids = ids;
    this.positions = new Map(ids.map((id, index) => [id, index]));
    this.measure();
    this.refresh();
  }
  measure() {
    this.prefix = [0];
    for (let i = 0; i < this.ids.length; i++)
      this.prefix.push(this.prefix[i] + (this.heights.get(this.ids[i]) || 112));
  }
  indexAt(y) {
    let low = 0,
      high = this.ids.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.prefix[middle + 1] <= y) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, Math.max(0, this.ids.length - 1));
  }
  schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.paint();
      });
  }
  refresh() {
    this.rowsObserver.disconnect();
    this.nodes.clear();
    this.paint();
  }
  paint() {
    if (!this.ids.length) {
      this.rowsObserver.disconnect();
      this.nodes.clear();
      this.list.replaceChildren();
      this.before.style.height = "0px";
      this.after.style.height = "0px";
      this.changed?.();
      return;
    }
    const top = this.element.scrollTop,
      height = this.element.clientHeight || 500;
    const start = Math.max(0, this.indexAt(Math.max(0, top - height)) - 3),
      end = Math.min(this.ids.length, this.indexAt(top + height * 2) + 5);
    const desired = [],
      next = new Map();
    for (let position = start; position < end; position++) {
      const id = this.ids[position];
      let row = this.nodes.get(id);
      if (!row) {
        row = this.renderRow(id, this.ids[position - 1]);
        row.dataset.index = String(id);
        row.setAttribute("aria-posinset", String(position + 1));
        row.setAttribute("aria-setsize", String(this.ids.length));
        this.rowsObserver.observe(row);
      }
      next.set(id, row);
      desired.push(row);
    }
    for (const [id, row] of this.nodes)
      if (!next.has(id)) {
        this.rowsObserver.unobserve(row);
        row.remove();
      }
    this.nodes = next;
    this.before.style.height = this.prefix[start] + "px";
    this.after.style.height =
      Math.max(0, this.prefix[this.ids.length] - this.prefix[end]) + "px";
    for (let i = 0; i < desired.length; i++)
      if (this.list.children[i] !== desired[i])
        this.list.insertBefore(desired[i], this.list.children[i] || null);
    for (const row of [...this.list.children])
      if (next.get(Number(row.dataset.index)) !== row) row.remove();
    if (this.pinEnd) this.element.scrollTop = this.element.scrollHeight;
    this.changed?.();
  }
  visible(id) {
    const row = this.nodes.get(id);
    if (!row) return false;
    const a = row.getBoundingClientRect(),
      b = this.element.getBoundingClientRect();
    return a.top < b.bottom - 8 && a.bottom > b.top + 8;
  }
  reveal(id, center = false) {
    const position = this.positions.get(id);
    if (position === undefined) return;
    this.pinEnd = false;
    const start = this.prefix[position],
      end = this.prefix[position + 1],
      height = this.element.clientHeight;
    if (end - start >= height) this.element.scrollTop = start;
    else if (center) this.element.scrollTop = Math.max(0, start - height * 0.3);
    else if (start < this.element.scrollTop) this.element.scrollTop = start;
    else if (end > this.element.scrollTop + height)
      this.element.scrollTop = Math.max(0, end - height);
    this.paint();
    const expectedTop = this.element.scrollTop;
    requestAnimationFrame(() => {
      if (Math.abs(this.element.scrollTop - expectedTop) > 2) return;
      const row = this.nodes.get(id);
      if (!row) return;
      const a = row.getBoundingClientRect(),
        b = this.element.getBoundingClientRect();
      if (a.height >= b.height || a.top < b.top)
        this.element.scrollTop += a.top - b.top;
      else if (a.bottom > b.bottom && a.height < b.height)
        this.element.scrollTop += a.bottom - b.bottom;
      this.schedule();
    });
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.rowsObserver.disconnect();
    this.sizeObserver.disconnect();
    this.element.removeEventListener("scroll", this.scroll);
    this.element.replaceChildren();
  }
};
