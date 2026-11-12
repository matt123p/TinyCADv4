// Let Electron finish synchronous startup before the ESM renderer awaits ready.
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {app}=require('electron');
app.setPath('userData',path.resolve(__dirname,'../../build/teaching-examples/chromium-profile'));
app.disableHardwareAcceleration();
const script=process.argv[2];
process.argv.splice(1,1);
import(pathToFileURL(path.resolve(script)).href).catch(error=>{
  console.error(error);
  require('electron').app.exit(1);
});
