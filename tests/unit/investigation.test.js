/** Etapa 7: documentos, registros, objetivos e descobertas (lógica pura). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { createInvestigation } from '../../src/systems/investigation.js';

const settings = CONFIG.investigation;
const ids = settings.documents.map((d) => d.id);
const create = () => createInvestigation(settings);
const objective = (investigation, id) => investigation.objectives().find((o) => o.id === id);
const drain = (investigation) => {
  const notices = [];
  for (let n = investigation.takeNotice(); n; n = investigation.takeNotice()) notices.push(n);
  return notices;
};

test('há de 6 a 8 documentos, com IDs únicos e conteúdo próprio e curto', () => {
  assert.ok(ids.length >= 6 && ids.length <= 8, `${ids.length}`);
  assert.equal(new Set(ids).size, ids.length);
  const texts = settings.documents.map((d) => d.text.join(' '));
  assert.equal(new Set(texts).size, texts.length);
  for (const doc of settings.documents) {
    for (const field of ['title', 'kind', 'name', 'where']) assert.ok(doc[field]?.length > 2, `${doc.id}.${field}`);
    const words = doc.text.join(' ').split(/\s+/).length;
    assert.ok(words >= 25 && words <= 150, `${doc.id}: ${words} palavras`);
  }
});

test('objetivos e descobertas só dependem de documentos que existem', () => {
  const events = [...settings.objectives.flatMap((o) => [...(o.any ?? []), ...(o.all ?? []), ...(o.revealedBy ?? [])]),
    ...Object.keys(settings.discoveries)];
  for (const event of events) {
    const [kind, id] = event.split(/:(.*)/);
    if (kind === 'document') assert.ok(ids.includes(id), event);
    if (kind === 'sighted' || kind === 'exorcised') assert.ok(CONFIG.entityTypes.some((t) => t.id === id), event);
    if (kind === 'examined') {
      const [building, item] = id.split(':');
      assert.ok(CONFIG.buildings.find((b) => b.id === building).examinables.some((e) => e.id === item), event);
    }
  }
});

test('registrar um documento guarda quando foi descoberto, sem duplicar', () => {
  const investigation = create();
  assert.deepEqual(investigation.records(), []);
  assert.equal(investigation.has(ids[1]), false);
  assert.equal(investigation.discover(ids[1], 12.5), true);
  assert.equal(investigation.discover(ids[1], 90), false);
  assert.equal(investigation.discover(ids[0], 20), true);
  assert.deepEqual(investigation.records().map((r) => [r.id, r.time]), [[ids[1], 12.5], [ids[0], 20]]);
  assert.equal(investigation.has(ids[1]), true);
  assert.equal(investigation.discover('inexistente', 1), false);
  assert.equal(investigation.records().length, 2);
});

test('um objetivo conclui sozinho, avisa uma única vez e fica marcado', () => {
  const investigation = create();
  assert.equal(objective(investigation, 'cabana').done, false);
  investigation.note('entered:cabin');
  assert.equal(objective(investigation, 'cabana').done, true);
  const first = drain(investigation);
  assert.equal(first.filter((n) => n.includes('Objetivo concluído')).length, 1, first.join('|'));
  investigation.note('entered:cabin');
  assert.deepEqual(drain(investigation), []);
});

test('reler um documento não repete avisos', () => {
  const investigation = create();
  investigation.discover(ids[0], 1);
  assert.ok(drain(investigation).some((n) => n.includes('Novo registro')));
  investigation.discover(ids[0], 2);
  assert.deepEqual(drain(investigation), []);
});

test('a exploração é livre: qualquer ordem conclui, e o objetivo escondido aparece', () => {
  const investigation = create();
  const hidden = settings.objectives.find((o) => o.revealedBy);
  assert.equal(objective(investigation, hidden.id), undefined);
  // Concluir sem antes ter sido revelado também vale.
  for (const event of hidden.all ?? hidden.any) {
    const [, id] = event.split(':');
    investigation.discover(id, 3);
  }
  assert.equal(objective(investigation, hidden.id).done, true);

  const other = create();
  other.discover(hidden.revealedBy[0].split(':')[1], 1);
  assert.equal(objective(other, hidden.id).done, false);
});

test('reunir todos os documentos conclui o arquivo; um exorcismo conta com qualquer entidade', () => {
  const investigation = create();
  investigation.note('exorcised:unstable');
  assert.equal(objective(investigation, 'exorcismo').done, true);
  investigation.note('entered:cabin');
  ids.forEach((id, i) => {
    assert.equal(objective(investigation, 'arquivo').done, false, `${i}`);
    investigation.discover(id, i);
  });
  assert.equal(objective(investigation, 'arquivo').done, true);
  assert.ok(investigation.objectives().every((o) => o.done), 'sobrou objetivo pendente');
});

test('descobertas aparecem uma vez, e a versão só muda quando algo muda', () => {
  const investigation = create();
  const start = investigation.version;
  investigation.note('sighted:watcher');
  assert.equal(investigation.discoveries().length, 1);
  assert.notEqual(investigation.version, start);
  const version = investigation.version;
  investigation.note('sighted:watcher');
  investigation.note('evento-sem-efeito');
  assert.equal(investigation.discoveries().length, 1);
  assert.equal(investigation.version, version);
});

test('uma nova exploração apaga registros, objetivos, descobertas e avisos', () => {
  const investigation = create();
  investigation.note('entered:cabin');
  investigation.discover(ids[0], 1);
  const version = investigation.version;
  investigation.reset();
  assert.deepEqual([investigation.records(), investigation.discoveries(), investigation.takeNotice()], [[], [], null]);
  assert.ok(investigation.objectives().every((o) => !o.done));
  assert.notEqual(investigation.version, version);
});
