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

// Splits long text into pieces the on-device checker accepts (`maxUnits` UTF-16 units each),
// preferring paragraph, then line, then sentence, then word boundaries. Each piece records its
// start in code points so findings can be shifted back into the full text.
export function splitForChecking(text, maxUnits = 6000) {
  const pieces = [];
  let rest = text;
  let offset = 0;
  while (rest.length > maxUnits) {
    const window = rest.slice(0, maxUnits);
    let cut = -1;
    for (const pattern of [/\n\s*\n/g, /\n/g, /[.!?]["'”’)\]]*\s+/g, /\s+/g]) {
      let match;
      let last = -1;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(window))) last = match.index + match[0].length;
      if (last > maxUnits / 4) { cut = last; break; }
    }
    if (cut <= 0) cut = maxUnits;
    // Never split a surrogate pair.
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut -= 1;
    const piece = rest.slice(0, cut);
    pieces.push({ start: offset, text: piece });
    offset += [...piece].length;
    rest = rest.slice(cut);
  }
  if (rest.length || !pieces.length) pieces.push({ start: offset, text: rest });
  return pieces;
}

// Moves findings computed on a piece of text to their position in the full text.
export function offsetFindings(findings, delta) {
  if (!delta || !Array.isArray(findings)) return findings || [];
  const move = (value) => (Number.isSafeInteger(value) ? value + delta : value);
  return findings.map((finding) => ({
    ...finding,
    start: move(finding.start),
    end: move(finding.end),
    ...(Array.isArray(finding.edits) ? { edits: finding.edits.map((edit) => ({ ...edit, start: edit.start + delta, end: edit.end + delta })) } : {}),
  }));
}

const WORD = /[\p{L}\p{N}_'’]/u;
const BREAK = /[\r\n]|[\u{10000}-\u{10FFFF}]/u;

// Turns chosen edits into spans for in-place replacement in a rich editor. Each span covers
// whole words (so an insertion such as a comma has non-empty original text to verify), carries
// up to `context` characters of same-line text on each side (not overlapping other spans) to
// locate it unambiguously, and
// edits inside the same word are merged. Spans are returned in document order.
export function spansForEdits(text, edits, context = 24) {
  const source = points(text);
  const regions = [];
  for (const edit of [...edits].sort((x, y) => x.start - y.start)) {
    let start = edit.start;
    let end = edit.end;
    while (start > 0 && WORD.test(source[start - 1])) start -= 1;
    while (end < source.length && WORD.test(source[end])) end += 1;
    if (start === end) {
      if (end < source.length && !BREAK.test(source[end])) end += 1;
      else if (start > 0 && !BREAK.test(source[start - 1])) start -= 1;
    }
    const last = regions[regions.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
      last.edits.push(edit);
    } else regions.push({ start, end, edits: [edit] });
  }
  // Context never reaches into a neighbouring span: spans are applied last to first, so a
  // neighbour's text may already have changed when this span is located.
  return regions.map(({ start, end, edits: inside }, index) => {
    const floor = index > 0 ? regions[index - 1].end : 0;
    const ceiling = index + 1 < regions.length ? regions[index + 1].start : source.length;
    let replacement = '';
    let cursor = start;
    for (const edit of inside) {
      replacement += source.slice(cursor, edit.start).join('') + edit.text;
      cursor = edit.end;
    }
    replacement += source.slice(cursor, end).join('');
    let from = start;
    while (from > floor && start - from < context && !BREAK.test(source[from - 1])) from -= 1;
    let to = end;
    while (to < ceiling && to - end < context && !BREAK.test(source[to])) to += 1;
    return {
      before: source.slice(from, start).join(''),
      original: source.slice(start, end).join(''),
      after: source.slice(end, to).join(''),
      replacement,
    };
  }).filter((span) => span.original && span.original !== span.replacement);
}

// Locators for underlining findings in the editor: each finding's words (whole words) with up to
// `context` characters of same-line text around them, not reaching into another finding.
// Returns [{ index, before, original, after }] in text order (index = position in `findings`).
export function underlineLocators(text, findings, context = 24) {
  const source = points(text);
  const ranges = findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => Array.isArray(finding.edits) && !finding.ignored && Number.isSafeInteger(finding.start) && Number.isSafeInteger(finding.end))
    .map(({ finding, index }) => {
      let start = finding.start;
      let end = finding.end;
      while (start > 0 && WORD.test(source[start - 1])) start -= 1;
      while (end < source.length && WORD.test(source[end])) end += 1;
      if (start === end && end < source.length && !BREAK.test(source[end])) end += 1;
      return { index, start, end };
    })
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  return ranges.map((range, position) => {
    const floor = position > 0 ? Math.max(ranges[position - 1].end, 0) : 0;
    const ceiling = position + 1 < ranges.length ? ranges[position + 1].start : source.length;
    let from = range.start;
    while (from > floor && range.start - from < context && !BREAK.test(source[from - 1])) from -= 1;
    let to = range.end;
    while (to < ceiling && to - range.end < context && !BREAK.test(source[to])) to += 1;
    return {
      index: range.index,
      before: source.slice(from, range.start).join(''),
      original: source.slice(range.start, range.end).join(''),
      after: source.slice(range.end, to).join(''),
    };
  }).filter((locator) => locator.original.trim());
}

// Overlay layout: the union of all rectangles (already in screen DIPs), inflated by `margin`,
// and each underline's rectangles relative to it. items: [{ index, kind, rects: [[x,y,w,h]] }].
export function underlineLayout(items, margin = 4) {
  const all = items.flatMap((item) => item.rects);
  if (!all.length) return null;
  const left = Math.floor(Math.min(...all.map(([x]) => x)) - margin);
  const top = Math.floor(Math.min(...all.map(([, y]) => y)) - margin);
  const right = Math.ceil(Math.max(...all.map(([x, , w]) => x + w)) + margin);
  const bottom = Math.ceil(Math.max(...all.map(([, y, , h]) => y + h)) + margin);
  return {
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
    items: items.filter((item) => item.rects.length).map((item) => ({ ...item, rects: item.rects.map(([x, y, w, h]) => [x - left, y - top, w, h]) })),
  };
}
