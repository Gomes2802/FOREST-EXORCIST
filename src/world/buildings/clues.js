/**
 * Pistas no cenário: onde cada documento fica e as caixas que o desenham.
 * Função pura sobre os dados de CONFIG.investigation (ver content/investigation.js).
 *
 * Desempenho: numa construção as peças entram na geometria que ela já desenha
 * (nenhuma chamada de desenho a mais); na floresta, cada pista é uma malha
 * pequena, desligada à distância.
 */

/** Altura (acima do chão) do ponto que o jogador olha, ao ar livre. */
const OUTDOOR_HEIGHT = { stake: 1, stone: 0.75 };
const DIRECTIONS = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
/** Um ponto liso da textura de papel (canto da margem). */
const BLANK = [0.5 / 32, 0.5 / 32];
/**
 * Na floresta tudo usa uma só textura (a de papel): a folha mostra a imagem
 * inteira e as demais peças usam o ponto liso, coloridas pelo vértice.
 */
const OUTDOOR_COLORS = {
  wood: [0.36, 0.25, 0.16],
  stone: [0.46, 0.48, 0.5],
  cloth: [0.95, 0.93, 0.88],
  mark: [1, 0.96, 0.82],
};

/** Cor e coordenadas de textura de uma peça na floresta. */
export function outdoorPaint({ look, shade }) {
  if (look === 'sheet') return { color: shade, image: true };
  // As marcas e o pano já trazem o próprio tom; o resto escurece pela peça.
  const factor = look === 'mark' ? shade : 1;
  return { color: OUTDOOR_COLORS[look].map((value) => value * factor), image: BLANK };
}

/**
 * Ponto do mundo que o jogador olha para ler.
 * @param {object} doc
 * @param {{ x: number, z: number }} [center] centro da construção
 */
export function documentPoint({ place }, center) {
  if (center) {
    const [x, y, z] = place.at;
    return { x: center.x + x, y, z: center.z + z };
  }
  const [x, z] = place.at;
  const [dx, dz] = DIRECTIONS[place.face];
  // Um pouco à frente da face, para o ponto não ficar dentro da peça.
  const ahead = place.form === 'stone' ? 0.15 : 0.09;
  return { x: x + dx * ahead, y: OUTDOOR_HEIGHT[place.form], z: z + dz * ahead };
}

/** Interagível da tecla E correspondente a um documento. */
export function documentItem(doc, point, reach) {
  return {
    id: `document:${doc.id}`,
    type: 'document',
    documentId: doc.id,
    name: doc.name,
    verb: doc.verb,
    point,
    range: reach,
  };
}

/**
 * Peças do documento: { box, material, shade, look }. `material` vale numa
 * construção; `look`, na floresta.
 */
export function documentParts({ place }, point) {
  const { form, face } = place;
  const [dx, dz] = DIRECTIONS[face] ?? [0, 0];
  const parts = [];
  const add = (material, shade, x, z, sizeX, sizeZ, bottom, top, look) => parts.push({
    material,
    shade,
    look: look ?? (material === 'wood' ? 'wood' : 'sheet'),
    box: {
      minX: x - sizeX / 2, maxX: x + sizeX / 2, minY: bottom, maxY: top,
      minZ: z - sizeZ / 2, maxZ: z + sizeZ / 2,
    },
  });
  /**
   * Placa de frente para `face`: centro no ponto, recuada `depth` (negativo =
   * adiante), deslocada `side` para a direita de quem a olha, na altura `y`.
   */
  const plate = (material, shade, {
    width, height, thickness, depth = 0, side = 0, y = point.y, look,
  }) => add(
    material,
    shade,
    point.x - dx * depth - dz * side,
    point.z - dz * depth + dx * side,
    dx ? thickness : width,
    dx ? width : thickness,
    y - height / 2,
    y + height / 2,
    look,
  );

  switch (form) {
    case 'floor':
      // Caderno aberto: capa escura e duas páginas.
      add('wood', 0.4, point.x, point.z, 0.5, 0.36, 0.03, point.y - 0.006);
      add('paper', 1, point.x - 0.115, point.z, 0.2, 0.3, point.y - 0.006, point.y + 0.004);
      add('paper', 0.85, point.x + 0.115, point.z, 0.2, 0.3, point.y - 0.006, point.y + 0.002);
      break;
    case 'wall':
      plate('paper', 1, { width: 0.34, height: 0.44, thickness: 0.012, depth: 0.014 });
      // Prego.
      plate('wood', 0.2, { width: 0.05, height: 0.05, thickness: 0.02, depth: 0.004, y: point.y + 0.18 });
      break;
    case 'photo':
      plate('wood', 0.45, { width: 0.56, height: 0.46, thickness: 0.024, depth: 0.018 });
      plate('portrait', 1, { width: 0.46, height: 0.36, thickness: 0.012, depth: 0.002 });
      break;
    case 'stake':
      plate('wood', 0.35, { width: 0.09, height: 1.15, thickness: 0.09, depth: 0.09, y: 0.575 });
      plate('paper', 1, { width: 0.34, height: 0.4, thickness: 0.014, depth: 0.03 });
      // Tira de pano claro amarrada no alto: chama a atenção de longe.
      plate('paper', 0.9, {
        width: 0.26, height: 0.07, thickness: 0.11, depth: 0.09, side: 0.05, y: 1.12, look: 'cloth',
      });
      break;
    case 'stone': {
      plate('wood', 0.5, { width: 0.8, height: 1.15, thickness: 0.2, depth: 0.12, y: 0.575, look: 'stone' });
      plate('wood', 0.38, { width: 1, height: 0.16, thickness: 0.38, depth: 0.12, y: 0.08, look: 'wood' });
      const mark = (side, up, width, height, shade = 0.95) => plate('paper', shade, {
        width, height, thickness: 0.012, depth: 0.018, side, y: point.y + up, look: 'mark',
      });
      // Olho.
      mark(-0.23, 0.2, 0.17, 0.03);
      mark(-0.23, 0.14, 0.05, 0.05);
      mark(-0.23, 0.08, 0.17, 0.03);
      // Capuz.
      mark(0, 0.23, 0.09, 0.03);
      mark(-0.055, 0.13, 0.03, 0.17);
      mark(0.055, 0.13, 0.03, 0.17);
      // Chama.
      mark(0.23, 0.11, 0.11, 0.07);
      mark(0.23, 0.18, 0.06, 0.07);
      mark(0.245, 0.24, 0.025, 0.05);
      // O quarto sinal, raspado.
      mark(-0.04, -0.15, 0.2, 0.018, 0.55);
      mark(0.03, -0.2, 0.17, 0.018, 0.45);
      break;
    }
    default:
      throw new Error(`Forma de pista desconhecida: "${form}".`);
  }
  return parts;
}
