import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const files = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));

console.log(`Auditing ${files.length} HTML files:`);

const titles = new Map();
const internalLinks = new Set();
const linkErrors = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
  const titleMatch = content.match(/<title>(.*?)<\/title>/i);
  const descMatch = content.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);
  const h1Matches = content.match(/<h1[\s>]/gi) || [];
  const title = titleMatch ? titleMatch[1] : 'MISSING';
  const desc = descMatch ? descMatch[1] : 'MISSING';
  
  if (titles.has(title)) {
    console.warn(`DUPLICATE TITLE: ${file} matches ${titles.get(title)} ("${title}")`);
  } else {
    titles.set(title, file);
  }
  
  // Check headings
  if (h1Matches.length === 0) {
    console.warn(`NO H1 in ${file}`);
  } else if (h1Matches.length > 2) {
    console.warn(`MULTIPLE H1s (${h1Matches.length}) in ${file}`);
  }

  // Check internal links
  const hrefMatches = content.matchAll(/href=["'](\/[^"'#?]*)/g);
  for (const m of hrefMatches) {
    const rawTarget = m[1];
    if (rawTarget === '/') continue;
    const targetFile = rawTarget.slice(1);
    if (!fs.existsSync(path.join(rootDir, targetFile)) && !fs.existsSync(path.join(rootDir, targetFile + '.html'))) {
      linkErrors.push({ file, target: rawTarget });
    }
  }

  console.log(`${file.padEnd(20)} | h1=${h1Matches.length} | title: "${title.slice(0, 45)}" | desc: ${desc.length} chars`);
}

if (linkErrors.length > 0) {
  console.error('\nBROKEN INTERNAL LINKS FOUND:');
  for (const err of linkErrors) {
    console.error(`- In ${err.file}: broken link to "${err.target}"`);
  }
} else {
  console.log('\n✓ All internal links resolve to valid files.');
}
