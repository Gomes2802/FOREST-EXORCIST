/**
 * Seleção de item: no máximo um na mão. Só guarda qual está selecionado; o que
 * cada item faz fica no seu controlador (ver Game.equipment).
 *
 * @param {ReadonlyArray<{ id: string, slot: number }>} items CONFIG.items
 */
export function createInventory(items) {
  let selected = null;

  /** @returns {boolean} true se a seleção mudou. */
  const change = (next) => {
    if (next === selected) return false;
    selected = next;
    return true;
  };

  return {
    items,
    get selected() {
      return selected;
    },
    /** Seleciona o item do espaço; escolher o já selecionado o guarda. */
    select(slot) {
      const item = items.find((entry) => entry.slot === slot);
      if (!item) return false;
      return change(item.id === selected ? null : item.id);
    },
    stow() {
      return change(null);
    },
    reset() {
      selected = null;
    },
  };
}
