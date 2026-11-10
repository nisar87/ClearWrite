// Per-finding edits. A finding offers up to three options; each option is one edit
// { start, end, text } in Unicode code points of the text that was checked. The suggested
// text is always rebuilt from the original text plus the options the writer has chosen, so
// accepting one fix never forces accepting another.
//
// finding.choice: index of the chosen option, or -1 when no option is chosen.
// finding.ignored: true when the writer dismissed the finding.

const points = (value) => [...value];

// Smallest single edit that turns `before` into `after` (common prefix/suffix trimmed).
export function diffSpan(before, after) {
  const a = points(before);
  const b = points(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  return { start, end: endA, text: b.slice(start, endB).join('') };
}

function validEdit(edit, length) {
  return edit && Number.isSafeInteger(edit.start) && Number.isSafeInteger(edit.end) &&
    edit.start >= 0 && edit.end >= edit.start && edit.end <= length && typeof edit.text === 'string';
}

// Edits the writer has chosen, in text order, with any edit overlapping an earlier one dropped.
export function chosenEdits(text, findings = []) {
  const length = points(text).length;
  const chosen = findings
    .filter((finding) => !finding.ignored && Number.isSafeInteger(finding.choice) && finding.choice >= 0)
    .map((finding) => finding.edits?.[finding.choice])
    .filter((edit) => validEdit(edit, length))
    .sort((x, y) => x.start - y.start || x.end - y.end);
  const accepted = [];
  for (const edit of chosen) {
    const previous = accepted[accepted.length - 1];
    // Two insertions at the same point, or overlapping ranges, cannot both be applied safely.
    if (previous && (edit.start < previous.end || (edit.start === previous.start && edit.start === previous.end))) continue;
    accepted.push(edit);
  }
  return accepted;
}

export function composeText(text, findings = []) {
  const source = points(text);
  let output = '';
  let cursor = 0;
  for (const edit of chosenEdits(text, findings)) {
    output += source.slice(cursor, edit.start).join('') + edit.text;
    cursor = edit.end;
  }
  return output + source.slice(cursor).join('');
}

export function hasEdits(findings) {
  return Array.isArray(findings) && findings.length > 0 && findings.every((finding) => Array.isArray(finding.edits));
}

export function unresolvedCount(findings = []) {
  return findings.filter((finding) => !finding.ignored && !(finding.choice >= 0)).length;
}

// Returns a new findings array with one finding changed. `option` is an option index,
// -1 to clear the choice, or 'ignore'.
export function chooseOption(findings, index, option) {
  if (!Array.isArray(findings) || !Number.isSafeInteger(index) || index < 0 || index >= findings.length) {
    throw new Error('That suggestion is no longer available.');
  }
  const finding = findings[index];
  let next;
  if (option === 'ignore') next = { ...finding, choice: -1, ignored: true };
  else if (option === -1) next = { ...finding, choice: -1, ignored: false };
  else if (Number.isSafeInteger(option) && option >= 0 && option < (finding.edits?.length || 0)) next = { ...finding, choice: option, ignored: false };
  else throw new Error('That option is no longer available.');
  return findings.map((item, position) => (position === index ? next : item));
}

// Code-point positions of URL placeholder tokens in a protected draft (see protectUrls).
function tokenShifts(protectedDraft) {
  const input = protectedDraft.input;
  const shifts = [];
  for (const { token, url } of protectedDraft.urls || []) {
    const at = input.indexOf(token);
    if (at < 0) continue;
    const start = points(input.slice(0, at)).length;
    const tokenLength = points(token).length;
    shifts.push({ start, end: start + tokenLength, delta: points(url).length - tokenLength });
  }
  return shifts.sort((x, y) => x.start - y.start);
}

// Maps finding offsets computed on protectedDraft.input back to the original text. Edits that
// touch a protected token are dropped; a finding left without options keeps no edits.
export function mapFindingsFromProtected(findings, protectedDraft) {
  if (!Array.isArray(findings)) return [];
  const shifts = tokenShifts(protectedDraft || { input: '', urls: [] });
  if (!shifts.length) return findings;
  const touches = (start, end) => shifts.some((shift) => start < shift.end && end > shift.start);
  const map = (position) => position + shifts.filter((shift) => shift.end <= position).reduce((sum, shift) => sum + shift.delta, 0);
  return findings
    .filter((finding) => !Number.isSafeInteger(finding.start) || !touches(finding.start, finding.end))
    .map((finding) => {
      if (!Array.isArray(finding.edits)) return finding;
      const keep = finding.edits.map((edit, option) => ({ edit, option })).filter(({ edit }) => !touches(edit.start, edit.end));
      const choice = keep.findIndex(({ option }) => option === finding.choice);
      return {
        ...finding,
        start: Number.isSafeInteger(finding.start) ? map(finding.start) : finding.start,
        end: Number.isSafeInteger(finding.end) ? map(finding.end) : finding.end,
        suggestions: keep.map(({ option }) => finding.suggestions?.[option]).filter((value) => value !== undefined),
        edits: keep.map(({ edit }) => ({ start: map(edit.start), end: map(edit.end), text: edit.text })),
        choice,
      };
    });
}
