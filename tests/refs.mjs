// VAULT RAIDER - cross-reference integrity. SPEC v0.9 section 12.1.
//
// SPEC.md and docs/NOTES.md ARE the audit trail. fidelity-auditor and
// softlock-hunter audit code against them, and rulings are amended into them so
// decisions do not have to be re-litigated. If the record can contain invented
// references, that premise fails and every downstream audit inherits it.
//
// This exists because it happened: src/game/entities.js carried
// `// INVENTED - see docs/NOTES.md M3-A1.` at a commit where NOTES.md had no M3
// section at all. The pointer was written while writing the code, intending to
// write the entry in the same pass, and the loop was never closed. A comment
// promising disclosure reads exactly like disclosure and is worse than none,
// because it stops the reader looking.
//
// Same reasoning as determinism.mjs enforcing the PRNG ban: an unenforced rule
// about the record is a comment.
//
// Pure text checking. No game logic, no imports from src/.
// Zero dependencies. Node only, no DOM.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let failures = 0;

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function walk(dir, exts, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const SPEC = read('SPEC.md');
const NOTES = read('docs/NOTES.md');

// Files that may carry cross-references.
const SOURCES = [
  'CLAUDE.md', 'docs/PLAN.md', 'docs/NOTES.md', 'SPEC.md',
  ...walk(join(ROOT, '.claude', 'agents'), ['.md'], []).map((f) => relative(ROOT, f)),
  ...walk(join(ROOT, 'src'), ['.js'], []).map((f) => relative(ROOT, f)),
  ...walk(join(ROOT, 'tests'), ['.mjs'], []).map((f) => relative(ROOT, f))
].map((p) => p.replace(/\\/g, '/'))
  // This file plants deliberately-broken decoys to prove the matchers can fire.
  .filter((p) => !p.endsWith('tests/refs.mjs'));

// --- 1. every section reference must name a section that exists -------------

// Headings carry an optional bold version marker before the number:
//   ## 4. ENTITIES        ### **[v0.5]** 2.1 Floor indexing
const SECTIONS = new Set();
for (const line of SPEC.split('\n')) {
  const m = line.match(/^#{2,4}\s*(?:\*\*\[v[\d.]+\]\*\*\s*)?(\d+(?:\.\d+)*)/);
  if (m) {
    SECTIONS.add(m[1]);
    // A subsection implies its parents exist as referenceable sections.
    const parts = m[1].split('.');
    for (let i = 1; i <= parts.length; i++) SECTIONS.add(parts.slice(0, i).join('.'));
  }
}
// Some top-level sections are numbered LISTS rather than sub-headings - section
// 2's six core-loop steps and section 3's thirteen mechanics - so §2.4 and §3.5
// are legitimate references to list items. Count the items rather than
// hardcoding, so this keeps working if a list grows.
{
  const lines = SPEC.split('\n');
  let current = null;
  let count = 0;
  const flush = () => {
    if (current !== null) for (let i = 1; i <= count; i++) SECTIONS.add(current + '.' + i);
    current = null;
    count = 0;
  };
  for (const line of lines) {
    const head = line.match(/^## (\d+)\./);
    if (head) { flush(); current = head[1]; continue; }
    if (/^#{3,}/.test(line)) { flush(); continue; }
    const item = line.match(/^(\d+)\.\s+\S/);
    if (current !== null && item) count = Math.max(count, parseInt(item[1], 10));
  }
  flush();
}

console.log(`# ${SECTIONS.size} referenceable SPEC sections found`);

const SECTION_REF = /(?:§|\bsection\s+)(\d+(?:\.\d+)*)/gi;
const brokenSections = [];
for (const rel of SOURCES) {
  const text = read(rel);
  const lines = text.split('\n');
  // A document may reference its OWN sections - docs/PLAN.md numbers its own -
  // so a reference resolves against SPEC's sections or the file's own headings.
  const own = new Set();
  for (const line of lines) {
    const m = line.match(/^#{2,4}\s*(?:\*\*[^*]+\*\*\s*)?(\d+(?:\.\d+)*)/);
    if (m) own.add(m[1]);
  }
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(SECTION_REF)) {
      if (!SECTIONS.has(m[1]) && !own.has(m[1])) {
        brokenSections.push(`${rel}:${i + 1} -> §${m[1]}`);
      }
    }
  }
}
assert(`every section reference resolves (${SOURCES.length} files scanned)`,
  brokenSections.length === 0,
  `${brokenSections.length} broken: ${brokenSections.slice(0, 6).join('; ')}`);

// --- 2. every NOTES identifier cited anywhere must exist ---------------------

// Identifiers appear as headings (### A7 — ...) or bold leads (**C1 — ...**).
const NOTE_IDS = new Set();
for (const line of NOTES.split('\n')) {
  const h = line.match(/^#{2,4}\s+\*{0,2}((?:M\d+-)?[A-Z]{1,3}\d+)\b/);
  if (h) NOTE_IDS.add(h[1]);
  const b = line.match(/^\*\*((?:M\d+-)?[A-Z]{1,3}\d+)\s*[—-]/);
  if (b) NOTE_IDS.add(b[1]);
}
console.log(`# ${NOTE_IDS.size} NOTES identifiers defined`);

// Only count citations that actually point AT the notes file or "NOTES", which
// is the exact defect shape: a pointer written before its target.
const NOTE_REF = /NOTES(?:\.md)?\s+((?:M\d+-)?[A-Z]{1,3}\d+)\b/g;
const brokenNotes = [];
for (const rel of SOURCES) {
  const lines = read(rel).split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(NOTE_REF)) {
      if (!NOTE_IDS.has(m[1])) brokenNotes.push(`${rel}:${i + 1} -> ${m[1]}`);
    }
  }
}
assert('every cited NOTES identifier exists',
  brokenNotes.length === 0,
  `${brokenNotes.length} broken: ${brokenNotes.slice(0, 6).join('; ')}`);

// --- 3. every [v0.x] marker corresponds to a declared amendment --------------

const headerVersion = (SPEC.match(/^# VAULT RAIDER — Game Spec v([\d.]+)/m) || [])[1];
assert('SPEC header declares a version', !!headerVersion, 'no version in the header');

const declared = new Set();
for (const m of SPEC.matchAll(/Changes from v[\d.]+ are marked \*\*\[v([\d.]+)\]\*\*/g)) {
  declared.add(m[1]);
}
const used = new Set();
for (const m of SPEC.matchAll(/\[v([\d.]+)\]/g)) used.add(m[1]);

const undeclared = [...used].filter((v) => !declared.has(v));
assert('every [v0.x] marker used in SPEC is declared in the change preamble',
  undeclared.length === 0, `undeclared: ${undeclared.join(', ')}`);

const unused = [...declared].filter((v) => !used.has(v));
assert('every declared amendment actually marks something',
  unused.length === 0, `declared but never used: ${unused.join(', ')}`);

assert(`the header version (${headerVersion}) is the newest declared marker`,
  declared.has(headerVersion),
  `header says v${headerVersion}, declared: ${[...declared].join(', ')}`);

// --- 4. every test file SPEC names must exist -------------------------------

const testRefs = new Set();
for (const m of SPEC.matchAll(/tests\/([a-z]+\.mjs)/g)) testRefs.add(m[1]);
const onDisk = new Set(readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs')));
const missingTests = [...testRefs].filter((f) => !onDisk.has(f));
assert(`every test file SPEC references exists (${testRefs.size} referenced)`,
  missingTests.length === 0, `missing: ${missingTests.join(', ')}`);
console.log(`     on disk: ${[...onDisk].sort().join(', ')}`);

// --- 5. every src file the MANIFEST names exists, and vice versa -------------

const build = read('build.py');
const manifest = [...build.matchAll(/^\s*"([\w/.]+\.js)",/gm)].map((m) => m[1]);
const srcFiles = walk(join(ROOT, 'src'), ['.js'], [])
  .map((f) => relative(join(ROOT, 'src'), f).replace(/\\/g, '/'));
const manifestMissing = manifest.filter((f) => !srcFiles.includes(f));
const srcUnlisted = srcFiles.filter((f) => !manifest.includes(f));
assert(`every MANIFEST entry exists on disk (${manifest.length} entries)`,
  manifestMissing.length === 0, `missing: ${manifestMissing.join(', ')}`);
assert('every src/*.js file is in the MANIFEST',
  srcUnlisted.length === 0, `unlisted: ${srcUnlisted.join(', ')}`);

// --- 6. section 14 must not duplicate the content spec -----------------------
//
// Section 14.0 [v1.1]: milestone rows REFERENCE §4.4 and §5, never restate
// them. A row naming an archetype or a room is a second source of truth, and it
// lost all three times it disagreed.
//
// ONLY the archetype and room-name half is checked. The numeral half - "no §14
// row should contain a number that also appears in §4.4 or §5" - is NOT cleanly
// checkable: §14 legitimately says "40×30 mask", "5-substep cap", "320×240
// scaling", "144 Hz", "floors 2-3", "all 12". A check that flagged those would
// be noise, and this project has already retired one rule for crying wolf.
{
  // The first cell must be JUST the milestone id. Section 14.0's own drift
  // table has rows like "| M4 BOUNCER | scheduled at M6 | ..." which DOCUMENT a
  // past drift rather than being milestone rows, and a looser match ate them.
  const rows = SPEC.split('\n').filter(
    (l) => /^\|\s*(?:\*\*)?(?:\[v[\d.]+\]\*\*\s*)?M\d+(?:\*\*)?\s*\|/.test(l)
  );
  const ARCHETYPES = ['CRAWLER', 'BOUNCER', 'DROPPER', 'STALKER', 'BRUTE', 'BLINKER'];
  // Ship names from §5, which are what a row would wrongly restate.
  const SHIP_NAMES = [...SPEC.matchAll(/`(THE [A-Z]+)`/g)].map((m) => m[1]);
  const dupes = [];
  for (const row of rows) {
    for (const name of [...ARCHETYPES, ...new Set(SHIP_NAMES)]) {
      if (row.includes(name)) dupes.push(`${name} in "${row.slice(0, 46)}..."`);
    }
  }
  assert(`no §14 row names an archetype or room (${rows.length} rows checked)`,
    dupes.length === 0, dupes.slice(0, 4).join('; '));
}

// --- 7. NOT CHECKED: cited tuning keys ---------------------------------------
//
// A check that every `TUNING.x.y` reference resolves was written here and then
// REMOVED, because it did not work in either direction. It missed a planted
// dead-flag citation, and a corrected version reported 42 false positives on a
// clean tree - the key extractor only captured the FIRST key on each line, so
// multi-key lines like `logicalW: 320, logicalH: 240` lost everything after the
// first.
//
// A broken checker in the file whose whole job is protecting the audit trail is
// worse than no checker: it reports green while missing the defect class it
// claims to cover. Same reasoning that retired the v0.5 blanket IP rule.
//
// The defect it was aimed at - three comments still citing TUNING.corpse.*
// flags after those flags were deleted - was fixed by hand. If this is
// rebuilt, extract keys with a real brace-aware walk, not a line regex, and
// mutation-verify it against a planted citation BEFORE trusting it.

// --- 8. the checker must be capable of failing ------------------------------
{
  const planted = 'see docs/NOTES.md ZZ99';
  const m = [...planted.matchAll(NOTE_REF)];
  assert('the NOTES matcher catches a planted bad citation',
    m.length === 1 && !NOTE_IDS.has(m[0][1]));
  const plantedSection = 'per §99.99 of the spec';
  const s = [...plantedSection.matchAll(SECTION_REF)];
  assert('the section matcher catches a planted bad reference',
    s.length === 1 && !SECTIONS.has(s[0][1]));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/refs.mjs`);
process.exit(failures === 0 ? 0 : 1);
