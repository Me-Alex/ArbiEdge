const fs = require('fs');
const s = fs.readFileSync('public/getapi.js', 'utf8');

// Find innerHTML assignments with class names
const innerHTML = [...s.matchAll(/innerHTML\s*=\s*`([^`]{10,500})`/g)].map(m => m[1]);
const innerHTML2 = [...s.matchAll(/innerHTML\s*=\s*['"]([^'"]{10,500})['"]/g)].map(m => m[1]);

// Find class names in template literals
const tplClasses = [...s.matchAll(/class=["']([^"']+)["']/g)].map(m => m[1]);

// Find createElement + className patterns
const created = [...s.matchAll(/createElement\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);

// Find innerHTML template strings with class=
const tplClassesBacktick = [...s.matchAll(/class=\\?["']([^"']+)\\?["']/g)].map(m => m[1]);

console.log('=== createElement types ===');
[...new Set(created)].sort().forEach(i => console.log(i));

console.log('\n=== class= in templates ===');
[...new Set([...tplClasses, ...tplClassesBacktick])].sort().forEach(i => console.log(i));

console.log('\n=== innerHTML template snippets (first 80 chars) ===');
[...new Set([...innerHTML, ...innerHTML2])].forEach(i => {
  const classes = [...i.matchAll(/class=["']([^"']+)["']/g)].map(m => m[1]);
  if (classes.length) console.log(classes.join(', '));
});
