/**
 * Interface durante o jogo: mira, aviso de cruz erguida, barra do exorcismo e
 * mensagem de conclusão. Não conhece o motor 3D; recebe o estado a cada quadro e
 * só mexe na página quando algo muda.
 */
export class Hud {
  /**
   * @param {Document} document
   * @param {{ flash?: boolean }} [options] flash: clarão discreto ao concluir.
   */
  constructor(document, { flash = true } = {}) {
    this.crosshair = document.getElementById('crosshair');
    this.indicator = document.getElementById('cross-indicator');
    this.bar = document.getElementById('exorcism');
    this.fill = document.getElementById('exorcism-fill');
    this.message = document.getElementById('hud-message');
    this.notice = document.getElementById('hud-notice');
    this.prompt = document.getElementById('interact-prompt');
    this.promptText = document.getElementById('interact-text');
    this.note = document.getElementById('interact-message');
    this.toast = document.getElementById('hud-toast');
    this.flash = flash ? document.getElementById('hud-flash') : null;
    this.last = {};
  }

  /**
   * @param {{ raised: boolean, aim: 'idle'|'target'|'exorcising',
   *   progress: number|null, message: string|null, notice?: string|null,
   *   prompt?: string|null, note?: string|null, toast?: string|null }} state
   *   notice: aviso discreto (ex.: qualidade gráfica reduzida); prompt: ação
   *   disponível na tecla E; note: o que se descobriu ao examinar; toast: aviso da
   *   investigação.
   */
  render({ raised, aim, progress, message, notice = null, prompt = null, note = null, toast = null }) {
    const percent = progress === null ? null : Math.floor(progress * 100);
    this.#changed('raised', raised, () => {
      this.indicator.hidden = !raised;
    });
    this.#changed('aim', aim, () => {
      this.crosshair.dataset.aim = aim;
      this.bar.dataset.active = String(aim === 'exorcising');
    });
    this.#changed('percent', percent, () => {
      this.bar.hidden = percent === null;
      if (percent === null) return;
      this.fill.style.width = `${percent}%`;
      this.bar.setAttribute('aria-valuenow', String(percent));
    });
    this.#changed('message', message, () => {
      this.message.hidden = !message;
      this.message.textContent = message ?? '';
      if (this.flash) this.flash.hidden = !message;
    });
    this.#changed('prompt', prompt, () => {
      if (!this.prompt) return;
      this.prompt.hidden = !prompt;
      this.promptText.textContent = prompt ?? '';
    });
    this.#changed('note', note, () => {
      if (!this.note) return;
      this.note.hidden = !note;
      this.note.textContent = note ?? '';
    });
    this.#changed('toast', toast, () => {
      if (!this.toast) return;
      this.toast.hidden = !toast;
      this.toast.textContent = toast ?? '';
    });
    this.#changed('notice', notice, () => {
      if (!this.notice) return;
      this.notice.hidden = !notice;
      this.notice.textContent = notice ?? '';
    });
  }

  #changed(key, value, apply) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }
}
