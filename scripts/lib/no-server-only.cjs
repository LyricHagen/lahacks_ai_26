// Preload for scripts that load the request pipeline (pnpm fixtures:record, pnpm demo:check).
// They run without the react-server condition, because next/navigation (pulled in through the
// session code) needs React's client build; so `server-only` must be stubbed out by hand here.
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} };
