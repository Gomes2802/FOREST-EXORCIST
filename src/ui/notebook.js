/**
 * Caderno de investigação e leitura de documentos: a mesma página, com ou sem o
 * índice ao lado. Só mexe na página ao abrir ou ao escolher um registro, e
 * reaproveita os elementos já criados.
 */
const EMPTY_PAGE = Object.freeze({
  kind: '',
  title: 'Nenhum registro aberto',
  meta: '',
  text: ['Os documentos encontrados na mata e na cabana ficam guardados aqui.'],
});

/** Segundos em mm:ss. */
export function formatTime(seconds) {
  const total = Math.floor(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export class Notebook {
  /**
   * @param {Document} document
   * @param {{ investigation: object, onClose: () => void }} options
   */
  constructor(document, { investigation, onClose }) {
    this.document = document;
    this.investigation = investigation;
    this.onClose = onClose;
    const byId = (id) => document.getElementById(id);
    this.root = byId('notebook');
    this.screen = this.root.closest('[data-screen]');
    this.page = byId('page');
    this.pageKind = byId('page-kind');
    this.pageTitle = byId('page-title');
    this.pageMeta = byId('page-meta');
    this.pageText = byId('page-text');
    this.objectiveList = byId('objective-list');
    this.recordList = byId('record-list');
    this.recordCount = byId('record-count');
    this.recordEmpty = byId('record-empty');
    this.discoveryList = byId('discovery-list');
    this.discoveryEmpty = byId('discovery-empty');
    /** id → elemento da lista (reaproveitados entre aberturas). */
    this.objectiveItems = new Map();
    this.recordButtons = new Map();
    this.selected = null;
    /** Versão da investigação que o índice mostra. */
    this.version = null;
    /** Página desenhada (documento e momento da descoberta). */
    this.shown = null;

    this.recordList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-document]');
      if (button) this.select(button.dataset.document);
    });
    document.addEventListener('keydown', (event) => this.#onKey(event));
  }

  /** @param {{ mode: 'reading'|'journal', document: string|null }} view */
  open({ mode, document: id }) {
    this.root.dataset.view = mode;
    if (mode === 'reading') {
      this.selected = id;
      this.#renderPage(id);
      this.page.focus();
      return;
    }
    this.#syncIndex();
    const keep = this.investigation.has(this.selected);
    this.select(keep ? this.selected : this.investigation.records().at(-1)?.id ?? null);
    this.recordButtons.get(this.selected)?.focus();
  }

  /** Mostra um registro já encontrado. */
  select(id) {
    this.selected = this.investigation.has(id) ? id : null;
    for (const [key, button] of this.recordButtons) {
      button.setAttribute('aria-current', String(key === this.selected));
    }
    this.#renderPage(this.selected);
  }

  #renderPage(id) {
    const record = this.investigation.record(id);
    const key = record ? `${record.id}@${record.time}` : '';
    if (key === this.shown) return;
    this.shown = key;
    const page = record ? {
      ...record,
      meta: `${record.where} · encontrado aos ${formatTime(record.time)} de exploração`,
    } : EMPTY_PAGE;
    this.pageKind.textContent = page.kind;
    this.pageTitle.textContent = page.title;
    this.pageMeta.textContent = page.meta;
    this.#fill(this.pageText, page.text, 'p');
    this.page.scrollTop = 0;
  }

  /** Um elemento por texto, reaproveitando os que existem. */
  #fill(container, texts, tag) {
    texts.forEach((text, i) => {
      let element = container.children[i];
      if (!element) {
        element = this.document.createElement(tag);
        container.append(element);
      }
      element.textContent = text;
    });
    while (container.children.length > texts.length) container.lastElementChild.remove();
  }

  #syncIndex() {
    const { investigation } = this;
    if (investigation.version === this.version) return;
    this.version = investigation.version;

    this.#syncList(this.objectiveList, this.objectiveItems, investigation.objectives(), () => (
      this.document.createElement('li')
    ), (item, objective) => {
      item.dataset.done = String(objective.done);
      item.textContent = `${objective.done ? '[x]' : '[ ]'} ${objective.title}`;
    });

    const records = investigation.records();
    this.#syncList(this.recordList, this.recordButtons, records, () => {
      const button = this.document.createElement('button');
      button.type = 'button';
      this.document.createElement('li').append(button);
      return button;
    }, (button, record) => {
      button.dataset.document = record.id;
      button.textContent = record.title;
    });
    this.recordCount.textContent = `(${records.length} de ${investigation.total})`;
    this.recordEmpty.hidden = records.length > 0;

    const discoveries = investigation.discoveries();
    this.#fill(this.discoveryList, discoveries, 'li');
    this.discoveryEmpty.hidden = discoveries.length > 0;
  }

  /**
   * Ajusta uma lista indexada por id: cria o que falta, remove o que sobrou e
   * mantém a ordem. O elemento guardado é o <li> ou algo dentro dele.
   */
  #syncList(list, cache, entries, create, update) {
    const itemOf = (element) => (element.tagName === 'LI' ? element : element.parentElement);
    const wanted = new Set(entries.map((entry) => entry.id));
    for (const [id, element] of cache) {
      if (wanted.has(id)) continue;
      itemOf(element).remove();
      cache.delete(id);
    }
    entries.forEach((entry, i) => {
      let element = cache.get(entry.id);
      if (!element) {
        element = create();
        cache.set(entry.id, element);
      }
      update(element, entry);
      // Só move quem está fora do lugar, para não perder o foco.
      if (list.children[i] !== itemOf(element)) list.insertBefore(itemOf(element), list.children[i] ?? null);
    });
  }

  #onKey(event) {
    if (this.screen.hidden || event.ctrlKey || event.metaKey || event.altKey) return;
    const reading = this.root.dataset.view === 'reading';
    const close = event.code === 'Escape' || event.code === 'KeyJ' || (reading && event.code === 'KeyE');
    const step = reading ? 0 : { ArrowDown: 1, ArrowUp: -1 }[event.code] ?? 0;
    if (!close && !step) return;
    event.preventDefault();
    // O jogo não pode receber a mesma tecla logo depois de voltar.
    event.stopPropagation();
    if (close) {
      if (!event.repeat) this.onClose();
      return;
    }
    // Na ordem em que aparecem na lista.
    const ids = this.investigation.records().map((record) => record.id);
    if (ids.length === 0) return;
    const index = ids.indexOf(this.selected);
    const next = ids[index === -1 ? 0 : (index + step + ids.length) % ids.length];
    this.select(next);
    this.recordButtons.get(next).focus();
  }
}
