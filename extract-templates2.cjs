const fs = require('fs');
const s = fs.readFileSync('public/getapi.js', 'utf8');

// Find ALL class= occurrences (single, double, backtick quotes)
const classMatches = [...s.matchAll(/class=(["'`])([^"'`]+)\1/g)].map(m => m[2]);

// Find classList.add/remove/toggle with string literals
const clAdd = [...s.matchAll(/classList\.add\(([^)]+)\)/g)].map(m => m[1]);
const clRemove = [...s.matchAll(/classList\.remove\(([^)]+)\)/g)].map(m => m[1]);
const clToggle = [...s.matchAll(/classList\.toggle\(([^)]+)\)/g)].map(m => m[1]);
const clContains = [...s.matchAll(/classList\.contains\(([^)]+)\)/g)].map(m => m[1]);

console.log('=== ALL class= values ===');
[...new Set(classMatches)].sort().forEach(i => console.log(i));

console.log('\n=== classList.add args ===');
[...new Set(clAdd)].sort().forEach(i => console.log(i));

console.log('\n=== classList.remove args ===');
[...new Set(clRemove)].sort().forEach(i => console.log(i));

console.log('\n=== classList.toggle args ===');
[...new Set(clToggle)].sort().forEach(i => console.log(i));

console.log('\n=== classList.contains args ===');
[...new Set(clContains)].sort().forEach(i => console.log(i));
