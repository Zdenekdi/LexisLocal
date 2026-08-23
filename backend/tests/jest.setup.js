// Testovaci setup: vypne realna volani Ollamy, aby testy byly DETERMINISTICKE
// a rychle bez ohledu na to, zda na stroji bezi Ollama. Testy jsou psane pro
// stav "AI nedostupna" (rychly lexikalni/fallback). Lokalni jest.mock v konkretnim
// testu tento globalni mock prebije.
jest.mock('ollama', () => {
  const fail = () => Promise.reject(new Error('AI vypnuta v testech (jest.setup.js)'));
  const client = {
    chat: fail, generate: fail, embeddings: fail, embed: fail,
    show: fail, pull: fail, create: fail, delete: fail, copy: fail,
    list: () => Promise.resolve({ models: [] }),
    ps: () => Promise.resolve({ models: [] }),
  };
  return { __esModule: true, default: client, Ollama: function () { return client; } };
});
