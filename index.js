'use strict';
const fs = require('fs');
const { renderTable, MARKER } = require('./classifier');

const token = process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const api = process.env.GITHUB_API_URL || 'https://api.github.com';
const minPrs = parseInt(process.env.INPUT_MIN_PRS || '2', 10);

async function gh(path, opts = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${api}/repos/${repo}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: opts.accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'patch-conflict-action', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return opts.text ? res.text() : res.status === 204 ? null : res.json();
}

function issueNumbersFromEvent(ev) {
  const nums = new Set();
  const manual = process.env.INPUT_ISSUE_NUMBER;
  if (manual) nums.add(+manual);
  if (ev.pull_request) {
    const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:#|[\w.-]+\/[\w.-]+#)(\d+)/gi;
    let m; const body = ev.pull_request.body || '';
    while ((m = re.exec(body))) nums.add(+m[1]);
  } else if (ev.issue && !ev.issue.pull_request) nums.add(ev.issue.number);
  return [...nums];
}

async function linkedPrs(issue) {
  const found = new Map();
  for (let page = 1; page < 6; page++) {
    const ev = await gh(`/issues/${issue}/timeline?per_page=100&page=${page}`);
    for (const e of ev) {
      const s = e.event === 'cross-referenced' && e.source && e.source.issue;
      if (s && s.pull_request && (s.state === 'open' || s.pull_request.merged_at)) found.set(s.number, s.title);
    }
    if (ev.length < 100) break;
  }
  return [...found].map(([number, title]) => ({ number, title }));
}

async function upsert(issue, body) {
  const comments = await gh(`/issues/${issue}/comments?per_page=100`);
  const mine = comments.find((c) => c.body && c.body.includes(MARKER));
  if (mine) await gh(`/issues/comments/${mine.id}`, { method: 'PATCH', body: { body } });
  else await gh(`/issues/${issue}/comments`, { method: 'POST', body: { body } });
  return mine ? 'updated' : 'created';
}

(async () => {
  const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH || '/dev/null', 'utf8') || '{}');
  const issues = issueNumbersFromEvent(ev);
  if (!issues.length) { console.log('No linked issue found for this event; nothing to do.'); return; }
  for (const issue of issues) {
    const prs = await linkedPrs(issue);
    if (prs.length < minPrs) { console.log(`#${issue}: ${prs.length} linked open PR(s) (< ${minPrs}); skipping.`); continue; }
    for (const p of prs) p.diff = await gh(`/pulls/${p.number}`, { accept: 'application/vnd.github.v3.diff', text: true });
    const { body, rows } = renderTable(issue, prs);
    const what = await upsert(issue, body);
    console.log(`#${issue}: comment ${what}; ${rows.length} pair(s): ${rows.map((r) => `#${r.a.number}/#${r.b.number}=${r.label}`).join(', ')}`);
  }
})().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
