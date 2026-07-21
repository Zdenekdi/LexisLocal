const path = require('path');
const os = require('os');
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_agenttok_${Date.now()}`);

const fs = require('fs');
const at = require('../lib/agent_tokens');

describe('Per-agent tokeny + scopes', () => {
  afterAll(() => {
    if (fs.existsSync(process.env.LEXIS_KEY_DIR)) {
      fs.rmSync(process.env.LEXIS_KEY_DIR, { recursive: true, force: true });
    }
  });

  it('vytvoří token a ověří ho (name + scopes)', () => {
    const tok = at.createToken('resersnik', ['read']);
    expect(typeof tok).toBe('string');
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    const v = at.verifyToken(tok);
    expect(v).toEqual({ name: 'resersnik', scopes: ['read'] });
  });

  it('neplatný token vrátí null', () => {
    expect(at.verifyToken('neexistuje')).toBeNull();
    expect(at.verifyToken('')).toBeNull();
  });

  it('list neobsahuje hash ani token', () => {
    const list = at.listTokens();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).not.toHaveProperty('hash');
    expect(list[0]).toHaveProperty('name');
    expect(list[0]).toHaveProperty('scopes');
  });

  it('vytvoření stejného jména token nahradí a starý zneplatní', () => {
    const before = at.listTokens().length;
    const oldTok = at.createToken('dvojnik', ['read']);
    const newTok = at.createToken('dvojnik', ['read', 'write']);
    expect(at.listTokens().length).toBe(before + 1); // jen jeden „dvojnik"
    expect(at.verifyToken(oldTok)).toBeNull();
    expect(at.verifyToken(newTok).scopes).toEqual(['read', 'write']);
  });

  it('normalizeScopes filtruje neplatné a odstraní duplicity', () => {
    expect(at.normalizeScopes('read,bogus,write,read')).toEqual(['read', 'write']);
    expect(at.normalizeScopes(['WRITE'])).toEqual(['write']);
  });

  it('revoke odstraní token', () => {
    at.createToken('smazat', ['read']);
    expect(at.revokeToken('smazat')).toBe(true);
    expect(at.revokeToken('smazat')).toBe(false);
  });
});
