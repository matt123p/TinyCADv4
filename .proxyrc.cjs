// Serve generated engine assets unchanged during Parcel development. Production
// builds copy this same directory after verifying its manifest.
const fs = require('node:fs');
const path = require('node:path');
module.exports = (app) =>
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
