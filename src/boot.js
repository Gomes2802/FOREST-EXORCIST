/*
 * Script clássico (não é módulo) para funcionar também em file://.
 * O Chrome bloqueia módulos ES e texturas WebGL em file://, então avisamos o
 * jogador em vez de deixar uma tela vazia.
 */
(function () {
  if (window.location.protocol !== 'file:') return;
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('file-warning').hidden = false;
    document.getElementById('menu').hidden = true;
  });
})();
