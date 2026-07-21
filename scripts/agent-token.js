#!/usr/bin/env node
'use strict';
/**
 * Správa per-agent API tokenů LexisLocalu.
 *   node scripts/agent-token.js create <jmeno> [read|write|read,write]
 *   node scripts/agent-token.js list
 *   node scripts/agent-token.js revoke <jmeno>
 */
const at = require('../backend/lib/agent_tokens');
const [, , cmd, name, scopesArg] = process.argv;

function usage() {
  console.log([
    'Správa per-agent tokenů LexisLocalu:',
    '  node scripts/agent-token.js create <jmeno> [scopes]   scopes = read | write | read,write (default read)',
    '  node scripts/agent-token.js list',
    '  node scripts/agent-token.js revoke <jmeno>'
  ].join('\n'));
}

try {
  if (cmd === 'create') {
    if (!name) { usage(); process.exit(1); }
    const scopes = at.normalizeScopes(scopesArg || 'read');
    const eff = scopes.length ? scopes : ['read'];
    const token = at.createToken(name, eff);
    console.log(`✅ Token pro agenta „${name}" (scopes: ${eff.join(', ')}):\n\n   ${token}\n\nUlož si ho — už se znovu nezobrazí. Posílej v hlavičce X-API-Token nebo Authorization: Bearer.`);
  } else if (cmd === 'list') {
    const list = at.listTokens();
    if (!list.length) console.log('Žádné agent tokeny.');
    else list.forEach((t) => console.log(`- ${t.name}  [${t.scopes.join(', ')}]  (${t.createdAt})`));
  } else if (cmd === 'revoke') {
    if (!name) { usage(); process.exit(1); }
    console.log(at.revokeToken(name) ? `✅ Token agenta „${name}" zrušen.` : `⚠️ Agent „${name}" nenalezen.`);
  } else {
    usage();
  }
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
