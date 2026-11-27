/**
 * Regras do exorcismo: o progresso avança somente enquanto a cruz está erguida e
 * a mira está sobre a entidade. Não há dano nem combate físico.
 *
 * Tudo é calculado em segundos, então o resultado independe da taxa de quadros.
 */

/**
 * @param {{ duration: number, speed: number, decayPerSecond: number }} settings
 */
export function createExorcism(settings) {
  /** Entidade que está avançando agora. */
  let active = null;
  /** Última entidade exorcizada em parte (para a perda de progresso). */
  let touched = null;

  return {
    /**
     * @param {number} dt segundos
     * @param {{ holding: boolean, readyTime: number, target: object|null }} input
     *   readyTime: segundos deste passo com a cruz erguida.
     * @returns {object|null} a entidade expulsa neste passo.
     */
    update(dt, { holding, readyTime, target }) {
      const next = holding && readyTime > 0 && target?.isTargetable ? target : null;
      if (active && active !== next) active.interrupt();
      active = next;

      if (!next) {
        touched?.decay(settings.decayPerSecond * dt);
        return null;
      }
      touched = next;
      // Cada tipo de entidade pode pedir um tempo diferente.
      if (!next.advance((readyTime * settings.speed) / (next.exorcismDuration ?? settings.duration))) return null;
      active = null;
      touched = null;
      return next;
    },
    reset() {
      active = null;
      touched = null;
    },
  };
}
