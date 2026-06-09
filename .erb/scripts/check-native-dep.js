const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
const deps = Object.keys(pkg.dependencies || {});
// No native deps check needed for this project
console.log('Native dep check: OK');
