const fs = require('fs');
const s = fs.readFileSync('public/getapi.js', 'utf8');

// Find ALL class= occurrences regardless of quote type, including in backtick templates
const classMatches = [...s.matchAll(/class=([`"'])([^`"']+)\1/g)].map(m => m[2]);

// Also find className assignments with template literals
const cnTemplate = [...s.matchAll(/className\s*=\s*`([^`]+)`/g)].map(m => m[1]);

// Find all string literals that look like CSS class names passed to classList
const clAll = [...s.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1]);

// Find innerHTML with backtick
const innerBacktick = [...s.matchAll(/innerHTML\s*=\s*`/g)];
console.log('innerHTML backtick assignments:', innerBacktick.length);

// Extract all class-like tokens from backtick templates
const backtickContent = [...s.matchAll(/`([^`]*class=[^`]*)`/g)].map(m => m[1]);
const classesInBacktick = [];
for (const tpl of backtickContent) {
  const cls = [...tpl.matchAll(/class=["']([^"']+)["']/g)].map(m => m[1]);
  cls.forEach(c => classesInBacktick.push(c));
}

// Also find class= with escaped quotes inside backticks
const escapedClasses = [...s.matchAll(/class=\\["']([^"']+)\\["']/g)].map(m => m[1]);

console.log('=== class= values (all quotes) ===');
[...new Set(classMatches)].sort().forEach(i => console.log(i));

console.log('\n=== className template literals ===');
[...new Set(cnTemplate)].sort().forEach(i => console.log(i));

console.log('\n=== classList string args ===');
[...new Set(clAll)].sort().forEach(i => console.log(i));

console.log('\n=== classes in backtick templates ===');
[...new Set(classesInBacktick)].sort().forEach(i => console.log(i));

console.log('\n=== escaped-quote classes ===');
[...new Set(escapedClasses)].sort().forEach(i => console.log(i));

// Also dump all unique hyphenated identifiers that could be class names
const hyphenClasses = [...s.matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)['"`]/g)].map(m => m[1]);
const cssLike = [...new Set(hyphenClasses)].filter(x => 
  x.includes('__') || x.includes('--') || 
  /^(arbitrage|value|journal|market|bookmaker|opportunity|event|provider|scanner|ai|bet|filter|mode|profit|edge|terminal|badge|hero|page|side|mobile|warning|audit|state|control|metadata|action|calculator|dense|compact|route|status|loading|error|empty|announcement|config|profit|ledger|trust|review|hide)/.test(x)
);

console.log('\n=== CSS-like hyphenated strings ===');
cssLike.sort().forEach(i => console.log(i));
