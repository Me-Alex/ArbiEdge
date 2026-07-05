const fs = require('fs');
const s = fs.readFileSync('public/getapi.js', 'utf8');

const ids = [...s.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
const qs = [...s.matchAll(/querySelector\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
const qsa = [...s.matchAll(/querySelectorAll\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
const cls = [...s.matchAll(/classList\.(?:add|remove|toggle|contains)\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
const cName = [...s.matchAll(/className\s*=\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

console.log('=== getElementById ===');
[...new Set(ids)].sort().forEach(i => console.log(i));
console.log('\n=== querySelector ===');
[...new Set(qs)].sort().forEach(i => console.log(i));
console.log('\n=== querySelectorAll ===');
[...new Set(qsa)].sort().forEach(i => console.log(i));
console.log('\n=== classList ops ===');
[...new Set(cls)].sort().forEach(i => console.log(i));
console.log('\n=== className= ===');
[...new Set(cName)].sort().forEach(i => console.log(i));

// Also find data- attributes
const dataAttrs = [...s.matchAll(/dataset\.([a-zA-Z]+)/g)].map(m => m[1]);
const getData = [...s.matchAll(/getAttribute\(['"](data-[^'"]+)['"]\)/g)].map(m => m[1]);
const setData = [...s.matchAll(/setAttribute\(['"](data-[^'"]+)['"]\)/g)].map(m => m[1]);

console.log('\n=== dataset.* ===');
[...new Set(dataAttrs)].sort().forEach(i => console.log(i));
console.log('\n=== getAttribute(data-*) ===');
[...new Set(getData)].sort().forEach(i => console.log(i));
console.log('\n=== setAttribute(data-*) ===');
[...new Set(setData)].sort().forEach(i => console.log(i));
