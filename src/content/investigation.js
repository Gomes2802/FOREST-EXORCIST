/**
 * Narrativa e dados da investigação: documentos, objetivos e descobertas.
 * Só dados; as regras ficam em systems/investigation.js.
 *
 * Onde fica cada documento (`place`):
 *  - na construção: { building, at: [x, altura, z] relativo ao centro, form, face };
 *    `outdoor` marca as que ficam pelo lado de fora;
 *  - na floresta: { at: [x, z], form, face }.
 * form: 'floor' (caído no chão), 'wall' (folha pregada), 'photo' (fotografia),
 * 'stake' (estaca com folha) ou 'stone' (marco de pedra). face: para onde a face
 * está voltada ('+x', '-x', '+z', '-z').
 *
 * Eventos usados pelos objetivos e descobertas: 'entered:<construção>',
 * 'document:<id>', 'examined:<construção>:<objeto>', 'sighted:<entidade>' e
 * 'exorcised:<entidade>'.
 */
export const INVESTIGATION = {
  /** Alcance da tecla E para ler (unidades, a partir dos olhos). */
  reach: 2.4,
  /** Até onde as pistas ao ar livre são desenhadas. */
  drawDistance: 20,
  /** Segundos que cada aviso fica na tela. */
  noticeDuration: 4,

  documents: [
    {
      id: 'diario',
      title: 'Diário: primeiras noites',
      kind: 'Página de diário',
      name: 'o diário caído',
      where: 'Cabana, no chão sob a janela oeste',
      place: { building: 'cabin', at: [-2.35, 0.05, -1.1], form: 'floor' },
      text: [
        '3 de abril. Aluguei a cabana por um preço que ninguém discute. Na vila dizem que a mata “devolve” quem se perde, mas nunca inteiro.',
        'Vim catalogar o que for explicável. Meu nome é Aurélio Vidigal e não acredito em assombração.',
        '9 de abril. Alguém esteve na janela. Não há pegadas na terra molhada.',
      ],
    },
    {
      id: 'registro',
      title: 'Registro de campo nº 7',
      kind: 'Registro de investigação',
      name: 'o registro pregado',
      where: 'Cabana, pregado na parede norte',
      place: { building: 'cabin', at: [0.55, 1.45, 2.28], form: 'wall', face: '-z' },
      text: [
        'Três manifestações, três modos de agir.',
        'I. A pálida: surge ao longe, às vezes foge de um olhar, às vezes da falta dele.',
        'II. A alta, encapuzada: observa. III. A violeta: não se demora.',
        'Todas recuam diante da cruz erguida, se eu não desviar a mira.',
        'Há três sinais iguais no marco de pedra, no fim da trilha sul.',
      ],
    },
    {
      id: 'foto',
      title: 'Fotografia na clareira',
      kind: 'Fotografia',
      verb: 'examine',
      name: 'a fotografia',
      where: 'Cabana, presa à parede leste',
      place: { building: 'cabin', at: [2.77, 1.45, -1.35], form: 'photo', face: '-x' },
      text: [
        'Um homem e uma menina diante de uma pedra alta, na trilha sul. Ela segura uma cruz pequena demais para as mãos.',
        'Atrás dos dois, entre os troncos, três borrões claros que não estavam lá quando o retrato foi tirado.',
        'No verso: “Nina e eu, junto ao marco. Ela diz que eles contam: um, dois, três... e esperam.”',
      ],
    },
    {
      id: 'bilhete',
      title: 'Bilhete pregado à porta',
      kind: 'Bilhete',
      name: 'o bilhete',
      where: 'Cabana, do lado de fora da porta',
      place: { building: 'cabin', at: [3.03, 1.4, 1.1], form: 'wall', face: '+x', outdoor: true },
      text: [
        'Sr. Vidigal, deixei o querosene no degrau, mas não volto depois de escurecer.',
        'Ontem a sua lamparina estava acesa e havia alguém alto olhando por ela, do lado de fora. Chamei pelo senhor. Quem se virou não foi o senhor.',
        'Leve a menina daí. — Dona Cida, do armazém',
      ],
    },
    {
      id: 'cruz',
      title: 'Anotação junto à cruz',
      kind: 'Anotação',
      name: 'a anotação na estaca',
      where: 'Trilha principal, junto à cruz fincada',
      place: { at: [-1.0, 4.4], form: 'stake', face: '+x' },
      text: [
        'Finquei esta cruz onde os antigos moradores fincaram a deles. A madeira velha ainda estava no chão, partida ao meio.',
        'A cruz não os destrói. Obriga-os a ficar visíveis até irem embora. É preciso firmeza: soltar no meio só adia.',
        'Comecem pelo marco ao sul. Foi lá que contaram pela primeira vez.',
      ],
    },
    {
      id: 'observadora',
      title: 'Caderneta: a que observa',
      kind: 'Caderneta molhada',
      name: 'a caderneta molhada',
      where: 'Trilha do leste',
      place: { at: [19.3, 6.6], form: 'stake', face: '-z' },
      text: [
        'A encapuzada fica longe e quase não se mexe. Desvio os olhos e ela está em outro lugar, um pouco ao lado.',
        'Nunca a vi andar. Ela só muda quando ninguém está olhando.',
        'Encarei-a por alguns instantes sem erguer a cruz, e sumiu. Com a cruz, leva mais tempo que as outras. É paciente.',
      ],
    },
    {
      id: 'instavel',
      title: 'Folha rasgada: a luz que não fica',
      kind: 'Folha de caderno',
      name: 'a folha rasgada',
      where: 'Trilha do norte',
      place: { at: [-4.0, 26.8], form: 'stake', face: '-x' },
      text: [
        'A violeta pisca como um pavio no fim. Dura poucos segundos, some e reaparece adiante, como se saltasse.',
        'É a mais fraca diante da cruz: se a mira não escapar, desfaz-se depressa.',
        'Nina riu para ela. Disse que era a menor das três e que só queria que alguém ficasse...',
      ],
    },
    {
      id: 'marco',
      title: 'O marco dos três sinais',
      kind: 'Símbolos em pedra',
      verb: 'examine',
      name: 'o marco de pedra',
      where: 'Fim da trilha sul',
      place: { at: [-2.9, -27], form: 'stone', face: '-x' },
      text: [
        'Três sinais talhados fundo: um olho, um capuz, uma chama. São muito mais velhos que a cabana.',
        'Abaixo deles, em giz: “Não são visitas. São guardas. A. V.”',
        'Há um quarto sinal raspado até sumir. Alguém voltou a riscá-lo há pouco: o pó de pedra ainda está solto na base.',
      ],
    },
  ],

  /**
   * Concluídos em qualquer ordem. `any`: basta um dos eventos; `all`: todos.
   * Com `revealedBy`, o objetivo só aparece depois de um daqueles eventos (ou
   * quando já foi cumprido): nada fica bloqueado.
   */
  objectives: [
    { id: 'cabana', title: 'Investigar a cabana abandonada', any: ['entered:cabin'] },
    { id: 'registro', title: 'Encontrar o registro de campo do investigador', any: ['document:registro'] },
    { id: 'fotografia', title: 'Examinar a fotografia', any: ['document:foto'] },
    {
      id: 'entidade',
      title: 'Descobrir como age uma das aparições (procure nas trilhas)',
      any: ['document:observadora', 'document:instavel'],
    },
    {
      id: 'marco',
      title: 'Investigar o marco de pedra no fim da trilha sul',
      all: ['document:marco'],
      revealedBy: ['document:registro', 'document:foto', 'document:cruz'],
    },
    { id: 'exorcismo', title: 'Expulsar uma presença com a cruz', any: ['exorcised:ghost', 'exorcised:watcher', 'exorcised:unstable'] },
    {
      id: 'arquivo',
      title: 'Reunir todos os registros',
      all: [
        'document:diario', 'document:registro', 'document:foto', 'document:bilhete',
        'document:cruz', 'document:observadora', 'document:instavel', 'document:marco',
      ],
    },
  ],

  /** Acontecimentos anotados no caderno, na ordem em que ocorrem. */
  discoveries: {
    'entered:cabin': 'A cabana pertenceu a alguém que estudava a mata.',
    'examined:cabin:papers': 'Nos papéis: ela encara de volta e, com a cruz erguida, não foge.',
    'examined:cabin:portrait': 'No retrato da família, os rostos foram riscados.',
    'examined:cabin:crate': 'Velas gastas e um terço partido no caixote.',
    'sighted:ghost': 'Vi de perto a aparição pálida.',
    'sighted:watcher': 'Vi a figura alta e encapuzada.',
    'sighted:unstable': 'Vi a presença violeta, instável.',
    'exorcised:ghost': 'Expulsei a aparição pálida.',
    'exorcised:watcher': 'Expulsei a observadora.',
    'exorcised:unstable': 'Desfiz a presença instável.',
  },
};
