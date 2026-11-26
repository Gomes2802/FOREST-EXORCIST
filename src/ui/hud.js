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
    this.flash = flash ? document.getElementById('hud-flash') : null;
    this.last = {};
  }

  /**
   * @param {{ raised: boolean, aim: 'idle'|'target'|'exorcising',
   *   progress: number|null, message: string|null }} state
   */
  render({ raised, aim, progress, message }) {
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
  }

  #changed(key, value, apply) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }
}
