import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const publicPages = {
  'index.html': {
    canonical: 'https://chorematrix.com/',
    ogTitle: 'ChoreMatrix — Household Workload Optimizer',
    ogDesc: 'Stop arguing over who does what. ChoreMatrix calculates balanced, workable household chore allocations based on capacity, schedules, and effort.',
    url: 'https://chorematrix.com/'
  },
  'how-it-works.html': {
    canonical: 'https://chorematrix.com/how-it-works.html',
    ogTitle: 'How It Works — ChoreMatrix Household Workload Optimizer',
    ogDesc: 'Understand how ChoreMatrix calculates fair household chore allocations using deterministic workload balancing, capacity limits, and differential rebalancing.',
    url: 'https://chorematrix.com/how-it-works.html'
  },
  'pricing.html': {
    canonical: 'https://chorematrix.com/pricing.html',
    ogTitle: 'Pricing & Free Trials — ChoreMatrix Household Optimizer',
    ogDesc: 'Explore ChoreMatrix pricing plans, 14-day free trials, and household optimization tiers. Transparent cancellation and fair scheduling without lock-in.',
    url: 'https://chorematrix.com/pricing.html'
  },
  'why-chorematrix.html': {
    canonical: 'https://chorematrix.com/why-chorematrix.html',
    ogTitle: 'Why ChoreMatrix? — Workload Optimization vs Chore Checklists',
    ogDesc: 'Discover why traditional chore checklists fail modern households and how ChoreMatrix solves chore friction through capacity-aware mathematical balancing.',
    url: 'https://chorematrix.com/why-chorematrix.html'
  },
  'faq.html': {
    canonical: 'https://chorematrix.com/faq.html',
    ogTitle: 'ChoreMatrix FAQ — Household Workload Optimizer Questions & Answers',
    ogDesc: 'Explore 25 comprehensive answers covering ChoreMatrix optimization algorithms, fairness indices, multi-week rotation, local privacy, and account security.',
    url: 'https://chorematrix.com/faq.html'
  },
  'privacy.html': {
    canonical: 'https://chorematrix.com/privacy.html',
    ogTitle: 'Privacy Policy — ChoreMatrix',
    ogDesc: 'ChoreMatrix Privacy Policy. Transparent, plain-language description of data collected, data minimized, sub-processors, and deletion rights.',
    url: 'https://chorematrix.com/privacy.html'
  },
  'terms.html': {
    canonical: 'https://chorematrix.com/terms.html',
    ogTitle: 'Terms of Service — ChoreMatrix',
    ogDesc: 'ChoreMatrix Terms of Service. Understand acceptable use, planning disclaimers, account terms, and service limitations.',
    url: 'https://chorematrix.com/terms.html'
  },
  'cookies.html': {
    canonical: 'https://chorematrix.com/cookies.html',
    ogTitle: 'Cookie Policy — ChoreMatrix',
    ogDesc: 'ChoreMatrix Cookie Policy. Complete inventory of strictly necessary storage, local preferences, and optional analytics controls.',
    url: 'https://chorematrix.com/cookies.html'
  },
  'data-rights.html': {
    canonical: 'https://chorematrix.com/data-rights.html',
    ogTitle: 'Data Rights & Export — ChoreMatrix',
    ogDesc: 'Exercise your data rights on ChoreMatrix. Self-service instant structured JSON export of all your household tasks, members, and schedules.',
    url: 'https://chorematrix.com/data-rights.html'
  },
  'login.html': {
    canonical: 'https://chorematrix.com/login.html',
    ogTitle: 'Sign In — ChoreMatrix',
    ogDesc: 'Sign in to your ChoreMatrix account to access your saved households, member availability, and workload plans.',
    url: 'https://chorematrix.com/login.html'
  },
  'signup.html': {
    canonical: 'https://chorematrix.com/signup.html',
    ogTitle: 'Create an Account — ChoreMatrix',
    ogDesc: 'Create a free ChoreMatrix account to save your household profiles, member capacities, and weekly chore schedules across devices.',
    url: 'https://chorematrix.com/signup.html'
  },
  'forgot-password.html': {
    canonical: 'https://chorematrix.com/forgot-password.html',
    ogTitle: 'Reset Password — ChoreMatrix',
    ogDesc: 'Request a password reset link for your ChoreMatrix account.',
    url: 'https://chorematrix.com/forgot-password.html'
  }
};

const privatePages = [
  'app.html',
  'account.html',
  'reset-password.html',
  'verify-email.html'
];

for (const [filename, meta] of Object.entries(publicPages)) {
  const filePath = path.join(rootDir, filename);
  if (!fs.existsSync(filePath)) continue;
  let html = fs.readFileSync(filePath, 'utf8');

  // Strip existing seo tags if any to avoid duplicates
  html = html.replace(/<link rel=["']canonical["'][^>]*>\s*/gi, '');
  html = html.replace(/<meta property=["']og:[^"']*["'][^>]*>\s*/gi, '');
  html = html.replace(/<meta name=["']twitter:[^"']*["'][^>]*>\s*/gi, '');
  html = html.replace(/<link rel=["']icon["'][^>]*>\s*/gi, '');
  html = html.replace(/<link rel=["']alternate icon["'][^>]*>\s*/gi, '');

  const tagsToInsert = `
<link rel="canonical" href="${meta.canonical}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="alternate icon" href="/favicon.ico" />
<meta property="og:title" content="${meta.ogTitle}" />
<meta property="og:description" content="${meta.ogDesc}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${meta.url}" />
<meta property="og:image" content="https://chorematrix.com/og-image.jpg" />
<meta property="og:site_name" content="ChoreMatrix" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${meta.ogTitle}" />
<meta name="twitter:description" content="${meta.ogDesc}" />
<meta name="twitter:image" content="https://chorematrix.com/og-image.jpg" />`;

  // Insert after meta description
  if (html.includes('name="description"')) {
    html = html.replace(/(<meta\s+name=["']description["'][^>]*>)/i, `$1${tagsToInsert}`);
  } else {
    html = html.replace(/(<head[^>]*>)/i, `$1${tagsToInsert}`);
  }

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`Updated SEO & favicons in ${filename}`);
}

for (const filename of privatePages) {
  const filePath = path.join(rootDir, filename);
  if (!fs.existsSync(filePath)) continue;
  let html = fs.readFileSync(filePath, 'utf8');

  html = html.replace(/<link rel=["']icon["'][^>]*>\s*/gi, '');
  html = html.replace(/<link rel=["']alternate icon["'][^>]*>\s*/gi, '');
  html = html.replace(/<meta name=["']robots["'][^>]*>\s*/gi, '');

  const tagsToInsert = `
<meta name="robots" content="noindex, nofollow" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="alternate icon" href="/favicon.ico" />`;

  if (html.includes('name="description"')) {
    html = html.replace(/(<meta\s+name=["']description["'][^>]*>)/i, `$1${tagsToInsert}`);
  } else {
    html = html.replace(/(<head[^>]*>)/i, `$1${tagsToInsert}`);
  }

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`Updated robots & favicons in private page: ${filename}`);
}

console.log('Finished SEO, favicon, and robots tags injection.');
