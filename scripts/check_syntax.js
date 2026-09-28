const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function walk(dir) {
  let count = 0;
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      count += walk(p);
    } else if (f.endsWith('.js')) {
      try {
        execSync(`node --check "${p}"`);
        console.log('[OK]', path.relative(process.cwd(), p));
        count++;
      } catch (err) {
        console.error('[SYNTAX ERROR]', p, err.message);
        process.exit(1);
      }
    }
  });
  return count;
}

const total = walk(path.resolve(__dirname, '../client/src'));
console.log(`\nAll ${total} client JS files passed syntax check!`);
