/** Acumula caixas e quadriláteros em um único conjunto de vértices. */

/** Repetição da textura por unidade do mundo (64 px = 4 unidades, como os sprites). */
const UV_SCALE = 0.25;

export function createGeometry() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  /**
   * Quadrilátero com cantos em ordem; UVs em unidades do mundo (u, v). `shade` é
   * um tom (número) ou uma cor [r, g, b].
   */
  function quad(corners, normal, coordinates, shade) {
    const [r, g, b] = Array.isArray(shade) ? shade : [shade, shade, shade];
    const first = positions.length / 3;
    corners.forEach((corner, i) => {
      positions.push(...corner);
      normals.push(...normal);
      uvs.push(coordinates[i][0] * UV_SCALE, coordinates[i][1] * UV_SCALE);
      colors.push(r, g, b, 1);
    });
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  return {
    quad,
    /**
     * Faces de uma caixa. `faces` filtra por direção (ex.: só a que olha para
     * fora). Direções: '+x', '-x', '+y', '-y', '+z', '-z'. Com `whole`, a imagem
     * é esticada em cada face em vez de se repetir pelo mundo; com um ponto
     * [u, v] (0..1) em `whole`, a face inteira usa a cor daquele ponto.
     */
    box(b, shade = 1, faces = () => true, whole = false) {
      const { minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 } = b;
      const sides = [
        ['+x', [1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], (p) => [p[2], p[1]]],
        ['-x', [-1, 0, 0], [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], (p) => [p[2], p[1]]],
        ['+y', [0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], (p) => [p[0], p[2]]],
        ['-y', [0, -1, 0], [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], (p) => [p[0], p[2]]],
        ['+z', [0, 0, 1], [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], (p) => [p[0], p[1]]],
        ['-z', [0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], (p) => [p[0], p[1]]],
      ];
      const corner = Array.isArray(whole) ? () => whole : (uv) => uv;
      const full = [[0, 0], [1, 0], [1, 1], [0, 1]].map((uv) => corner(uv).map((v) => v / UV_SCALE));
      for (const [name, normal, corners, map] of sides) {
        if (faces(name)) quad(corners, normal, whole ? full : corners.map(map), shade);
      }
    },
    toMesh(BABYLON, scene, name) {
      if (positions.length === 0) return null;
      const mesh = new BABYLON.Mesh(name, scene);
      const data = new BABYLON.VertexData();
      Object.assign(data, { positions, normals, uvs, colors, indices });
      data.applyToMesh(mesh);
      return mesh;
    },
  };
}
