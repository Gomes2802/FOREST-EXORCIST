/**
 * Menu inicial, configurações, tela de saída, pausa e aviso do modo sem captura.
 * Não conhece o motor 3D: comunica-se apenas pelos callbacks recebidos.
 */
export class Menu {
  /**
   * @param {Document} document
   * @param {{
   *   onPlay: () => void,
   *   onResume: () => void,
   *   onResumeWithoutLock: () => void,
   *   onPause: () => void,
   *   onMenu: () => void,
   *   onSetting: (name: string, value: number) => unknown,
   *   closeWindow?: () => void,
   * }} callbacks
   */
  constructor(document, callbacks) {
    this.document = document;
    this.callbacks = callbacks;
    this.screens = new Map(
      [...document.querySelectorAll('[data-screen]')].map((el) => [el.dataset.screen, el]),
    );
    this.status = document.getElementById('menu-status');
    this.playButton = document.querySelector('[data-action="play"]');
    this.pauseNotice = document.getElementById('pause-notice');
    this.noLockButton = document.querySelector('[data-action="resume-nolock"]');
    this.dragHelp = document.getElementById('drag-help');
    this.current = 'main';

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button && !button.disabled) this.#run(button.dataset.action);
    });
    document.addEventListener('change', (event) => {
      const input = event.target.closest('[data-setting]');
      if (input) this.#changeSetting(input);
    });
    document.addEventListener('keydown', (event) => this.#onKey(event));
  }

  /** Preenche os controles com os valores atuais. */
  setValues(values) {
    for (const [name, value] of Object.entries(values)) {
      const input = this.document.querySelector(`[data-setting="${name}"]`);
      if (input) input.value = String(value);
    }
  }

  setReady(ready) {
    this.playButton.disabled = !ready;
    this.document.querySelectorAll('[data-setting]').forEach((input) => {
      input.disabled = !ready;
    });
    if (ready && this.current === 'main') this.playButton.focus();
  }

  /** @param {'info'|'warning'|'error'} level */
  setStatus(message, level = 'info') {
    this.status.textContent = message;
    this.status.dataset.level = level;
  }

  /** Mostra a tela correspondente ao modo do jogo. */
  showGameState({ mode, control, notice }) {
    if (mode === 'playing') {
      this.dragHelp.hidden = control !== 'drag';
      this.show('hud');
      return;
    }
    if (mode === 'paused') {
      const denied = notice === 'lock-denied';
      this.pauseNotice.hidden = !denied;
      this.noLockButton.hidden = !denied;
      this.show('pause');
      return;
    }
    // Voltou ao menu: só troca se ainda estiver em uma tela de jogo.
    if (this.current === 'hud' || this.current === 'pause') this.show('main');
  }

  show(name) {
    if (!this.screens.has(name)) return;
    this.current = name;
    for (const [screenName, element] of this.screens) element.hidden = screenName !== name;
    this.document.body.dataset.view = name;
    if (name === 'hud') {
      // Sem foco em botão: teclas não devem acionar nada durante o jogo.
      this.document.activeElement?.blur?.();
      return;
    }
    this.screens.get(name).querySelector('button:not([disabled]):not([hidden])')?.focus();
  }

  #run(action) {
    switch (action) {
      // As telas de jogo são trocadas por showGameState, quando o jogo confirmar.
      case 'play':
        this.callbacks.onPlay();
        break;
      case 'resume':
        this.callbacks.onResume();
        break;
      case 'resume-nolock':
        this.callbacks.onResumeWithoutLock();
        break;
      case 'pause':
        this.callbacks.onPause();
        break;
      case 'settings':
        this.show('settings');
        break;
      case 'quit':
        // O navegador só fecha janelas abertas por script; se ignorar, a tela explica.
        this.show('quit');
        this.callbacks.closeWindow?.();
        break;
      case 'back':
        this.show('main');
        this.callbacks.onMenu();
        break;
      default:
        break;
    }
  }

  async #changeSetting(input) {
    try {
      const value = input.dataset.type === 'text' ? input.value : Number(input.value);
      await this.callbacks.onSetting(input.dataset.setting, value);
    } catch (error) {
      console.error('[menu] falha ao aplicar configuração', error);
    }
  }

  #onKey(event) {
    // Durante o jogo e na pausa, o ESC pertence a core/input.js.
    if (event.key === 'Escape' && (this.current === 'settings' || this.current === 'quit')) {
      event.preventDefault();
      this.#run('back');
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (this.current !== 'main') return;
    const buttons = [...this.screens.get('main').querySelectorAll('button:not([disabled])')];
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(this.document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = index === -1 ? 0 : (index + step + buttons.length) % buttons.length;
    buttons[next].focus();
  }
}
