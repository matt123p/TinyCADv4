// Serve generated engine assets unchanged during Parcel development. Production
// builds copy this same directory after verifying its manifest.
// Parcel loads this file instead of .proxyrc, so retain its API routes too.
const fs = require('node:fs');
const path = require('node:path');
const { createProxyMiddleware } = require('http-proxy-middleware');
module.exports = (app) => {
  const routes = JSON.parse(
    fs.readFileSync(path.join(__dirname, '.proxyrc'), 'utf8'),
  );
  for (const [route, options] of Object.entries(routes)) {
    app.use(createProxyMiddleware(route, options));
  }
  app.use('/engines/ngspice', (request, response) => {
    const name = (request.url || '').split('?')[0].replace(/^\//, '');
    if (!['ngspice.js', 'ngspice.wasm', 'manifest.json'].includes(name)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const target = path.join(__dirname, 'public/engines/ngspice', name);
    if (!fs.existsSync(target)) {
      response.statusCode = 503;
      response.end('Build the pinned WASM engine with npm run engine:wasm.');
      return;
    }
    response.setHeader(
      'Content-Type',
      name.endsWith('.wasm')
        ? 'application/wasm'
        : name.endsWith('.js')
        ? 'text/javascript'
        : 'application/json',
    );
    fs.createReadStream(target).pipe(response);
  });
};
