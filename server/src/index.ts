import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);

const app = createApp();

app.listen(PORT, () => {
  console.log(`Pointless listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`);
  if (!process.env.ADMIN_TOKEN) {
    console.warn(
      '  ⚠ ADMIN_TOKEN is not set — the operator API (deck management and ' +
        'preview-by-id) is reachable only from localhost. Set ADMIN_TOKEN to ' +
        'use the manager UI from another host.'
    );
  }
});
