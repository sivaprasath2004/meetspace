const detectPort = require('detect-port');

const PORT = parseInt(process.env.PORT || '1212', 10);

detectPort(PORT, function(err, availablePort) {
  if (err) { console.error(err); process.exit(1); }
  if (PORT !== availablePort) {
    console.log('Port ' + PORT + ' in use, switching to ' + availablePort);
    process.env.PORT = String(availablePort);
  }
});
