import { createApp } from './app.js';
import { init } from './db.js';
import { COMMIT, VERSION } from './version.js';
import { authMode, mcpRequireAuth } from './config.js';

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  await init();
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Pointless ${VERSION} (commit ${COMMIT}) listening on http://localhost:${PORT}`);
    console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`);
    if (authMode() === 'oidc') {
      console.log(
        `  Auth: OIDC sign-in enabled for the UI. ` +
          `MCP endpoint: ${mcpRequireAuth() ? 'requires a bearer token' : 'open (set MCP_REQUIRE_AUTH=true to gate it)'}.`
      );
    } else if (!process.env.ADMIN_TOKEN) {
      console.warn(
        '  ⚠ ADMIN_TOKEN is not set — the operator API (deck management and ' +
          'preview-by-id) is reachable only from localhost. Set ADMIN_TOKEN to ' +
          'use the manager UI from another host.'
      );
    }
  });
}

main().catch((err) => {
  console.error('Failed to start Pointless:', err);
  process.exit(1);
});
