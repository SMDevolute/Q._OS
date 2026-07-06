// Q. OS Worker entry.
// For now this is a pure static passthrough: every request is served from the
// bundled static assets (the app). When the sync backend is built, API routes
// get handled here before the assets fallback — see docs/BACKEND_AND_SYNC.md.
export default {
  async fetch(req, env) {
    // Later:
    //   const url = new URL(req.url);
    //   if (url.pathname.startsWith("/api/")) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  },
};
