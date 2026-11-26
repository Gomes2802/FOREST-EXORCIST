/**
 * Leitura do teclado e do mouse, e captura do ponteiro (Pointer Lock).
 *
 * Dois modos de olhar:
 *  - "lock": ponteiro capturado; todo movimento do mouse gira a câmera.
 *  - "drag": alternativa sem captura; gira enquanto o botão esquerdo está pressionado.
 *
 * Nos dois, segurar o botão esquerdo ergue a cruz (isPrimaryHeld).
 */

/** event.code identifica a posição física da tecla (vale para ABNT2, US etc.). */
export const KEY_BINDINGS = Object.freeze({
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
});

/** Teclas de ação: disparam uma vez por pressionamento. */
export const ACTION_BINDINGS = Object.freeze({ KeyF: 'lantern' });

/** Saltos maiores que isto (px por evento) são falhas do navegador e são ignorados. */
const MAX_MOUSE_STEP = 400;
const LOCK_TIMEOUT_MS = 2000;

export class InputController {
  /**
   * @param {{ element: any, document?: any, window?: any }} targets
   *   element é o canvas que captura o ponteiro.
   */
  constructor({ element, document = globalThis.document, window = globalThis.window }) {
    this.element = element;
    this.document = document;
    this.window = window;
    /** null (desativado) | 'lock' | 'drag' */
    this.mode = null;
    /** Chamado com 'escape' | 'lock-lost' | 'focus-lost'. */
    this.onPauseRequest = () => {};
    /** Chamado com o nome da ação (ver ACTION_BINDINGS). */
    this.onAction = () => {};
    this.pressed = new Set();
    this.look = { dx: 0, dy: 0 };
    this.dragging = false;
    /** Botão esquerdo pressionado durante o jogo. */
    this.isPrimaryHeld = false;
    this.pendingRequest = null;
    /** exitPointerLock é assíncrono: indica uma liberação ainda não concluída. */
    this.releasing = false;
    this.listeners = [];
  }

  attach() {
    if (this.listeners.length > 0) return;
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler);
      this.listeners.push(() => target.removeEventListener(type, handler));
    };
    listen(this.window, 'keydown', (e) => this.#onKeyDown(e));
    listen(this.window, 'keyup', (e) => this.pressed.delete(e.code));
    listen(this.window, 'blur', () => this.#interrupt('focus-lost'));
    // Eventos de ponteiro, e não de mouse: o Babylon.js cancela "pointerdown" no
    // canvas, e então o navegador deixa de emitir mousedown/mousemove.
    const endDrag = () => {
      this.dragging = false;
      this.isPrimaryHeld = false;
    };
    listen(this.window, 'pointerup', endDrag);
    listen(this.window, 'pointercancel', endDrag);
    listen(this.element, 'pointerdown', (e) => {
      if (!this.mode || e.button !== 0) return;
      this.isPrimaryHeld = true;
      if (this.mode === 'drag') this.dragging = true;
      e.preventDefault?.();
    });
    listen(this.document, 'pointermove', (e) => this.#onPointerMove(e));
    listen(this.document, 'pointerlockchange', () => this.#onLockChange());
    listen(this.document, 'visibilitychange', () => {
      if (this.document.visibilityState === 'hidden') this.#interrupt('focus-lost');
    });
  }

  detach() {
    this.disable();
    this.listeners.splice(0).forEach((remove) => remove());
  }

  /** Passa a aceitar comandos. */
  enable(mode) {
    this.clear();
    this.mode = mode;
  }

  /** Ignora comandos e libera o ponteiro. */
  disable() {
    this.mode = null;
    this.clear();
    this.releaseLock();
  }

  clear() {
    this.pressed.clear();
    this.look.dx = 0;
    this.look.dy = 0;
    this.dragging = false;
    this.isPrimaryHeld = false;
  }

  /** Intenção de movimento: forward e right valem -1, 0 ou 1. */
  getIntent() {
    const active = new Set([...this.pressed].map((code) => KEY_BINDINGS[code]));
    const axis = (positive, negative) => Number(active.has(positive)) - Number(active.has(negative));
    return {
      forward: axis('forward', 'back'),
      right: axis('right', 'left'),
      run: active.has('run'),
    };
  }

  /** Devolve e zera o movimento do mouse acumulado desde a última chamada. */
  consumeLook() {
    const delta = { ...this.look };
    this.look.dx = 0;
    this.look.dy = 0;
    return delta;
  }

  get isLocked() {
    return Boolean(this.element) && this.document.pointerLockElement === this.element;
  }

  /**
   * Pede a captura do ponteiro. Precisa ser chamado dentro de um clique.
   * Nunca rejeita: resolve para 'locked', 'denied' ou 'unsupported'.
   */
  requestLock() {
    if (this.pendingRequest) return this.pendingRequest;
    if (typeof this.element?.requestPointerLock !== 'function') return Promise.resolve('unsupported');
    if (this.isLocked && !this.releasing) return Promise.resolve('locked');

    let finish;
    const request = new Promise((resolve) => {
      const onChange = () => {
        if (this.isLocked) finish('locked');
      };
      const onError = () => finish('denied');
      const timer = setTimeout(() => finish('denied'), LOCK_TIMEOUT_MS);
      finish = (result) => {
        clearTimeout(timer);
        this.document.removeEventListener('pointerlockchange', onChange);
        this.document.removeEventListener('pointerlockerror', onError);
        this.pendingRequest = null;
        resolve(result);
      };
      this.document.addEventListener('pointerlockchange', onChange);
      this.document.addEventListener('pointerlockerror', onError);
    });
    this.pendingRequest = request;

    const failure = (error) => finish(error?.name === 'NotSupportedError' ? 'unsupported' : 'denied');
    try {
      // Navegadores atuais devolvem uma Promise; os antigos, nada.
      this.element.requestPointerLock()?.then?.(undefined, failure);
    } catch (error) {
      failure(error);
    }
    return request;
  }

  releaseLock() {
    if (!this.isLocked) return;
    this.releasing = true;
    this.document.exitPointerLock();
  }

  #onKeyDown(event) {
    if (!this.mode) return;
    if (event.code === 'Escape') {
      // Com o ponteiro capturado, o Chrome consome o ESC e avisa por pointerlockchange.
      if (!event.repeat) this.#interrupt('escape');
      return;
    }
    // Não intercepta atalhos do navegador (Ctrl+W, Ctrl+R, Ctrl+F...).
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code in ACTION_BINDINGS) {
      if (!event.repeat) this.onAction(ACTION_BINDINGS[event.code]);
      event.preventDefault?.();
      return;
    }
    if (!(event.code in KEY_BINDINGS)) return;
    this.pressed.add(event.code);
    event.preventDefault?.();
  }

  #onPointerMove(event) {
    // Soltou o botão fora da janela: o "pointerup" pode não chegar.
    if (event.buttons === 0) this.dragging = false;
    // Com outro botão já pressionado, o esquerdo não gera pointerdown/pointerup:
    // a mudança chega por pointermove.
    if (typeof event.buttons === 'number') {
      if ((event.buttons & 1) === 0) this.isPrimaryHeld = false;
      else if (this.mode && event.button === 0) this.isPrimaryHeld = true;
    }
    const looking = this.mode === 'lock' ? this.isLocked : this.mode === 'drag' && this.dragging;
    if (!looking) return;
    const { movementX: dx = 0, movementY: dy = 0 } = event;
    if (Math.abs(dx) > MAX_MOUSE_STEP || Math.abs(dy) > MAX_MOUSE_STEP) return;
    this.look.dx += dx;
    this.look.dy += dy;
  }

  #onLockChange() {
    if (this.isLocked) {
      // Captura que chegou tarde demais (já desistimos dela): devolve o ponteiro.
      if (!this.pendingRequest && this.mode !== 'lock') this.releaseLock();
      return;
    }
    this.releasing = false;
    if (this.mode === 'lock') this.#interrupt('lock-lost');
  }

  #interrupt(reason) {
    if (!this.mode) {
      this.clear();
      return;
    }
    this.clear();
    this.onPauseRequest(reason);
  }
}
