const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
  entryPoints: [path.join(__dirname, 'src/index.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: path.join(__dirname, 'mcp-server.js'),
  format: 'cjs',
  external: [],
  minify: false,
  sourcemap: false,
  logLevel: 'info'
}).catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
