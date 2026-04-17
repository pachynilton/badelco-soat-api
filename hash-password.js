const crypto = require('crypto');

const plainPassword = process.argv[2];

if (!plainPassword) {
    console.error('Uso: npm run hash:password -- "TuPasswordSegura"');
    process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(plainPassword, salt, 64).toString('hex');

console.log(`${salt}:${hash}`);
