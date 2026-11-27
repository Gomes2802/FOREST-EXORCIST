/**
 * Estado da investigação: documentos encontrados, objetivos, descobertas e os
 * avisos a mostrar. Lógica pura, sem página nem 3D.
 *
 * Tudo muda por eventos (note e discover): nada é conferido a cada quadro. Os
 * registros valem para a exploração atual e são apagados por reset().
 */

/**
 * @param {{ documents: object[], objectives: object[], discoveries: Record<string, string> }} settings
 *   CONFIG.investigation
 */
export function createInvestigation({ documents, objectives, discoveries }) {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  /** Eventos que já aconteceram. */
  const events = new Set();
  /** id → { id, time }, na ordem das descobertas. */
  const found = new Map();
  const noted = [];
  const done = new Set();
  const notices = [];
  let version = 0;

  const satisfied = ({ any, all }) => (all
    ? all.every((event) => events.has(event))
    : any.some((event) => events.has(event)));

  function note(event) {
    if (events.has(event)) return false;
    events.add(event);
    let changed = false;
    if (Object.hasOwn(discoveries, event)) {
      noted.push(discoveries[event]);
      changed = true;
    }
    for (const objective of objectives) {
      if (!done.has(objective.id) && satisfied(objective)) {
        done.add(objective.id);
        notices.push(`Objetivo concluído: ${objective.title}`);
        changed = true;
      } else if (objective.revealedBy?.includes(event)) changed = true;
    }
    if (changed) version += 1;
    return changed;
  }

  return {
    /** Aumenta sempre que algo que o caderno mostra muda. */
    get version() {
      return version;
    },
    /** Total de documentos existentes. */
    get total() {
      return documents.length;
    },
    note,
    /**
     * @param {string} id documento
     * @param {number} time segundos de exploração
     * @returns {boolean} true na primeira vez
     */
    discover(id, time) {
      if (!byId.has(id) || found.has(id)) return false;
      found.set(id, { id, time });
      version += 1;
      notices.push(`Novo registro no caderno (J): ${byId.get(id).title}`);
      note(`document:${id}`);
      return true;
    },
    has(id) {
      return found.has(id);
    },
    /** O documento (conteúdo e quando foi encontrado), só se já encontrado. */
    record(id) {
      const entry = found.get(id);
      return entry ? { ...byId.get(id), time: entry.time } : null;
    },
    /** Documentos encontrados, na ordem da descoberta. */
    records() {
      return [...found.keys()].map((id) => this.record(id));
    },
    /** Objetivos visíveis: { id, title, done }. */
    objectives() {
      return objectives
        .filter((o) => !o.revealedBy || done.has(o.id) || o.revealedBy.some((event) => events.has(event)))
        .map(({ id, title }) => ({ id, title, done: done.has(id) }));
    },
    discoveries() {
      return [...noted];
    },
    /** Próximo aviso a mostrar, ou null. */
    takeNotice() {
      return notices.shift() ?? null;
    },
    reset() {
      events.clear();
      found.clear();
      done.clear();
      noted.length = 0;
      notices.length = 0;
      version += 1;
    },
  };
}
