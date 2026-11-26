/** DOM mínimo para testar teclado, mouse e Pointer Lock no Node. */
export const emit = (target, type, props = {}) => {
  const event = Object.assign(new Event(type, { cancelable: true }), props);
  target.dispatchEvent(event);
  return event;
};

/**
 * @param {{ lock?: 'grant'|'deny'|'reject'|'throw'|'silent'|'legacy'|'unsupported' }} [options]
 *   Como o "navegador" responde ao pedido de captura. Pode ser trocado em dom.lock.
 */
export function createFakeDom({ lock = 'grant' } = {}) {
  const window = new EventTarget();
  const document = new EventTarget();
  const element = new EventTarget();
  const dom = { window, document, element, lock, requests: 0 };

  document.pointerLockElement = null;
  document.visibilityState = 'visible';
  const setLock = (value) => {
    document.pointerLockElement = value;
    emit(document, 'pointerlockchange');
  };
  dom.grant = () => setLock(element);
  /** O que o Chrome faz quando o jogador aperta ESC. */
  dom.loseLock = () => setLock(null);
  document.exitPointerLock = () => queueMicrotask(() => setLock(null));

  if (lock !== 'unsupported') {
    element.requestPointerLock = () => {
      dom.requests += 1;
      if (dom.lock === 'throw') throw new Error('falha');
      if (dom.lock === 'reject') return Promise.reject(Object.assign(new Error('x'), { name: 'SecurityError' }));
      if (dom.lock === 'silent') return undefined;
      queueMicrotask(() => {
        if (dom.lock === 'deny') emit(document, 'pointerlockerror');
        else dom.grant();
      });
      return dom.lock === 'legacy' ? undefined : Promise.resolve();
    };
  }
  return dom;
}
