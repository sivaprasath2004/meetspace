const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
args.forEach((dir) => {
  const fullPath = path.join(__dirname, '../../', dir);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true });
    console.log(`Removed: ${fullPath}`);
  }
});
