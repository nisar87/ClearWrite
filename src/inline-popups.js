// Placement of the inline widget and suggestion card (all values in DIP).

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

// Bottom-right corner inside a multi-line field; just to the right of a single-line field.
export function badgePlacement(rect, area, size) {
  const tall = rect.height >= 2 * size;
  const x = tall ? rect.x + rect.width - size - 6 : rect.x + rect.width + 4;
  const y = tall ? rect.y + rect.height - size - 6 : rect.y + Math.round((rect.height - size) / 2);
  return {
    x: Math.round(clamp(x, area.x, area.x + area.width - size)),
    y: Math.round(clamp(y, area.y, area.y + area.height - size)),
    width: size,
    height: size,
  };
}

// Below the underlined word, or above it when there is no room below; kept on the work area.
export function cardPlacement(word, area, width, height) {
  const [x, y, , h] = word;
  let top = Math.round(y + h + 6);
  if (top + height > area.y + area.height) top = Math.round(y - height - 6);
  return {
    x: Math.round(clamp(x, area.x, area.x + area.width - width)),
    y: Math.round(clamp(top, area.y, area.y + area.height - height)),
    width,
    height,
  };
}
