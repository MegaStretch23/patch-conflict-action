'use strict';
// Patch-conflict heuristic (port of the m18 browser classifier). Pure functions, zero dependencies.

function parseUnifiedDiff(diffText) {
  const files = {};
  let currentFile = null;
  let currentHunk = null;
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  for (const line of String(diffText).split('\n')) {
    if (line.startsWith('+++ ')) {
      let p = line.slice(4).split('\t')[0].trim();
      if (p.startsWith('b/')) p = p.slice(2);
      currentFile = p;
      if (!files[currentFile]) files[currentFile] = [];
      currentHunk = null;
    } else if (line.startsWith('@@')) {
      const m = hunkRe.exec(line);
      if (m && currentFile !== null) {
        currentHunk = { file: currentFile, oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2], addedLines: [], removedLines: [] };
        files[currentFile].push(currentHunk);
      }
    } else if (currentHunk !== null) {
      if (line.startsWith('+') && !line.startsWith('+++')) currentHunk.addedLines.push(line.slice(1));
      else if (line.startsWith('-') && !line.startsWith('---')) currentHunk.removedLines.push(line.slice(1));
    }
  }
  return files;
}

function overlap(aS, aC, bS, bC) {
  return aS < bS + Math.max(bC, 1) && bS < aS + Math.max(aC, 1);
}
const norm = (lines) => lines.map((l) => l.trim()).filter(Boolean);

function classifyPair(nameA, diffA, nameB, diffB) {
  const fA = parseUnifiedDiff(diffA), fB = parseUnifiedDiff(diffB);
  const shared = [...new Set([...Object.keys(fA), ...Object.keys(fB)])].filter((f) => fA[f] && fB[f]).sort();
  if (!shared.length) {
    const fa = Object.keys(fA).sort()[0] || '?', fb = Object.keys(fB).sort()[0] || '?';
    return { label: 'partial', reason: `${nameA} touches ${fa}, ${nameB} touches ${fb} -- no shared file.` };
  }
  const overlaps = [];
  for (const f of shared) {
    const hA = [...fA[f]].sort((a, b) => a.oldStart - b.oldStart);
    const hB = [...fB[f]].sort((a, b) => a.oldStart - b.oldStart);
    for (const ha of hA) for (const hb of hB)
      if (overlap(ha.oldStart, ha.oldCount, hb.oldStart, hb.oldCount)) overlaps.push({ f, ha, hb });
  }
  if (!overlaps.length) {
    return { label: 'partial', reason: `Both touch ${shared[0]} but at non-overlapping lines -- independent parts of the fix.` };
  }
  for (const { f, ha, hb } of overlaps) {
    if (JSON.stringify(norm(ha.addedLines)) !== JSON.stringify(norm(hb.addedLines)))
      return { label: 'conflicting', reason: `Both edit ${f} around line ${ha.oldStart} but replace it with different code.` };
  }
  const { f, ha } = overlaps[0];
  return { label: 'same-fix', reason: `Both edit ${f} around line ${ha.oldStart} with the same replacement code.` };
}

function combinations(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
  return out;
}

const MARKER = '<!-- patch-conflict-classifier -->';
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// prs: [{number, title, diff}] -> markdown comment body
function renderTable(issueNumber, prs) {
  const sorted = [...prs].sort((a, b) => a.number - b.number);
  const rows = combinations(sorted).map(([a, b]) => {
    const r = classifyPair(`#${a.number}`, a.diff, `#${b.number}`, b.diff);
    return { a, b, ...r };
  });
  const badge = { 'same-fix': 'same-fix', conflicting: 'CONFLICTING', partial: 'independent' };
  let md = `${MARKER}\n### Patch-conflict check for #${issueNumber}\n\n${sorted.length} linked PRs compared pairwise (line-range overlap + replacement text).\n\n`;
  md += '| PR A | PR B | Result | Reason |\n|---|---|---|---|\n';
  for (const r of rows) md += `| #${r.a.number} | #${r.b.number} | ${badge[r.label]} | ${esc(r.reason)} |\n`;
  md += '\n_Heuristic: hunk line ranges and added text, not semantics. Treat as a triage hint._\n';
  return { body: md, rows };
}

module.exports = { parseUnifiedDiff, classifyPair, combinations, renderTable, MARKER };
