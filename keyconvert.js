const fs = require('fs');
const key = fs.readFileSync('./localchefbazaar-31da8-firebase-adminsdk-fbsvc-e5d0ea71b0.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)