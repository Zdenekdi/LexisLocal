/**
 * Testy model_config (../lib/model_config.js) — jediný zdroj výchozích názvů AI modelů.
 * Ověřuje: default (unset) = llama3 / nomic-embed-text; env přepis; izolace modulové cache.
 */

const path = require('path');
const MODULE = path.join(__dirname, '..', 'lib', 'model_config.js');

function loadFresh() {
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

describe('model_config', () => {
  const origChat = process.env.CHAT_MODEL;
  const origEmb = process.env.EMBEDDING_MODEL;

  afterEach(() => {
    if (origChat === undefined) delete process.env.CHAT_MODEL; else process.env.CHAT_MODEL = origChat;
    if (origEmb === undefined) delete process.env.EMBEDDING_MODEL; else process.env.EMBEDDING_MODEL = origEmb;
  });

  test('výchozí hodnoty bez env (zpětná kompatibilita)', () => {
    delete process.env.CHAT_MODEL;
    delete process.env.EMBEDDING_MODEL;
    const { CHAT_MODEL, EMBEDDING_MODEL } = loadFresh();
    expect(CHAT_MODEL).toBe('llama3');
    expect(EMBEDDING_MODEL).toBe('nomic-embed-text');
  });

  test('CHAT_MODEL z env má přednost', () => {
    process.env.CHAT_MODEL = 'qwen2.5:3b';
    const { CHAT_MODEL } = loadFresh();
    expect(CHAT_MODEL).toBe('qwen2.5:3b');
  });

  test('EMBEDDING_MODEL z env má přednost', () => {
    process.env.EMBEDDING_MODEL = 'mxbai-embed-large';
    const { EMBEDDING_MODEL } = loadFresh();
    expect(EMBEDDING_MODEL).toBe('mxbai-embed-large');
  });
});
