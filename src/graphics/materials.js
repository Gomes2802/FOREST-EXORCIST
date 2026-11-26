/**
 * Criação de texturas e materiais do Babylon.js com amostragem de pixel art.
 */

/** Cria uma textura a partir de um canvas já pixelado. */
export function createPixelTexture(BABYLON, scene, canvas, pixelRenderer, kind = 'sprite') {
  const { width, height } = canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, width, height).data;
  const sampling = pixelRenderer.getSampling(BABYLON, kind);

  const texture = BABYLON.RawTexture.CreateRGBATexture(
    new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    width,
    height,
    scene,
    sampling.generateMipMaps,
    true, // invertY: o canvas tem origem no topo, o UV na base.
    sampling.samplingMode,
  );
  texture.wrapU = sampling.wrap;
  texture.wrapV = sampling.wrap;
  texture.anisotropicFilteringLevel = 1;
  return texture;
}

/**
 * Material de sprite. A cor da noite vem da tonalidade (luz própria constante) e
 * a neblina continua ativa. Com `lit`, as luzes dinâmicas se somam a ela (na
 * floresta, só a lanterna). Sprites "glow" nunca recebem luz.
 */
export function createSpriteMaterial(BABYLON, scene, record, {
  pixelRenderer, tint, lit = false, doubleSided = false,
}) {
  const material = new BABYLON.StandardMaterial(`sprite:${record.id}`, scene);
  const texture = createPixelTexture(BABYLON, scene, record.canvas, pixelRenderer, 'sprite');
  texture.hasAlpha = true;

  material.diffuseTexture = texture;
  material.backFaceCulling = !doubleSided;
  material.specularColor = BABYLON.Color3.Black();

  // A alternativa de sprite ausente fica sem tonalidade, para chamar atenção.
  const fullBright = record.status === 'fallback' || record.definition.shading === 'glow';
  material.disableLighting = fullBright || !lit;
  material.emissiveColor = fullBright ? BABYLON.Color3.White() : BABYLON.Color3.FromHexString(tint);

  // Sem isto o StandardMaterial ignora o alfa da textura e desenha um retângulo.
  material.useAlphaFromDiffuseTexture = true;
  if (record.definition.alphaMode === 'blend') {
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  } else {
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
    material.alphaCutOff = 0.5;
  }
  return material;
}

/** Material iluminado para superfícies repetidas (chão e trilhas). */
export function createSurfaceMaterial(BABYLON, scene, name, canvas, { pixelRenderer, repeat, zOffset = 0 }) {
  const material = new BABYLON.StandardMaterial(name, scene);
  const texture = createPixelTexture(BABYLON, scene, canvas, pixelRenderer, 'surface');
  texture.uScale = repeat;
  texture.vScale = repeat;
  material.diffuseTexture = texture;
  material.specularColor = BABYLON.Color3.Black();
  material.zOffset = zOffset;
  // As malhas geradas por código não dependem da ordem dos vértices.
  material.backFaceCulling = false;
  return material;
}

/** Material iluminado de um objeto 3D texturizado por um sprite (tronco caído). */
export function createLogMaterial(BABYLON, scene, record, { pixelRenderer }) {
  const material = new BABYLON.StandardMaterial(`log:${record.id}`, scene);
  material.diffuseTexture = createPixelTexture(BABYLON, scene, record.canvas, pixelRenderer, 'sprite');
  material.specularColor = BABYLON.Color3.Black();
  material.backFaceCulling = false;
  return material;
}

/** Sombra no chão: preta, com a transparência dada pelo sprite. */
export function createShadowMaterial(BABYLON, scene, record, { pixelRenderer }) {
  const material = new BABYLON.StandardMaterial(`shadow:${record.id}`, scene);
  const texture = createPixelTexture(BABYLON, scene, record.canvas, pixelRenderer, 'sprite');
  texture.hasAlpha = true;
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  material.disableLighting = true;
  material.emissiveColor = BABYLON.Color3.Black();
  material.specularColor = BABYLON.Color3.Black();
  material.disableDepthWrite = true;
  material.zOffset = -4;
  return material;
}

/**
 * Silhuetas do horizonte: recorte repetido na horizontal, pintado com uma cor
 * já misturada à neblina (por isso o material a ignora).
 */
export function createBackdropMaterial(BABYLON, scene, name, canvas, {
  pixelRenderer, color, repeat, offset,
}) {
  const material = new BABYLON.StandardMaterial(name, scene);
  const texture = createPixelTexture(BABYLON, scene, canvas, pixelRenderer, 'sprite');
  texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.uScale = repeat;
  texture.uOffset = offset;
  texture.hasAlpha = true;
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
  material.alphaCutOff = 0.5;
  material.disableLighting = true;
  material.emissiveColor = BABYLON.Color3.FromHexString(color);
  material.backFaceCulling = false;
  material.fogEnabled = false;
  return material;
}

/** Céu: cores definidas nos vértices, sem luz, neblina nem profundidade. */
export function createSkyDomeMaterial(BABYLON, scene, name) {
  const material = new BABYLON.StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = BABYLON.Color3.White();
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.fogEnabled = false;
  return material;
}

/** Material de cor chapada que ignora luzes e neblina (lua). */
export function createSkyMaterial(BABYLON, scene, name, hexColor) {
  const material = new BABYLON.StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = BABYLON.Color3.FromHexString(hexColor);
  material.fogEnabled = false;
  return material;
}
