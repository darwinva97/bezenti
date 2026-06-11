// Stub for cpu-features native module — not available in CF Workers.
// ssh2 wraps the require() in try/catch so it degrades gracefully without it.
// This stub lets esbuild bundle ssh2 without hitting the .node binary.
module.exports = () => ({ flags: {}, arch: '' });
