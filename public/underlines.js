// Draws wavy underlines under findings in the editor. The window ignores the mouse except while
// the pointer is over an underline, so typing and clicking in the editor are never blocked.
const api = window.clearWrite;
const layer = document.getElementById('underlines');
let items = [];
let hovering = -1;

function kindClass(kind) {
  if (kind === 'Spelling') return 'spelling';
  if (kind === 'Learned') return 'learned';
  return 'grammar';
}

function render(next) {
  items = Array.isArray(next?.items) ? next.items : [];
  hovering = -1;
  layer.replaceChildren(...items.flatMap((item) => item.rects.map(([x, y, w, h]) => {
    const line = document.createElement('div');
    line.className = `underline ${kindClass(item.kind)}`;
    line.style.left = `${x}px`;
    line.style.top = `${y + h - 3}px`;
    line.style.width = `${w}px`;
    line.dataset.index = String(item.index);
    return line;
  })));
}

function hitTest(clientX, clientY) {
  for (const item of items) {
    for (const [x, y, w, h] of item.rects) {
      if (clientX >= x && clientX <= x + w && clientY >= y && clientY <= y + h) return item.index;
    }
  }
  return -1;
}

window.addEventListener('mousemove', (event) => {
  const index = hitTest(event.clientX, event.clientY);
  if (index === hovering) return;
  hovering = index;
  layer.querySelectorAll('.underline').forEach((line) => line.classList.toggle('hover', Number(line.dataset.index) === index));
  void api.underlineHover(index >= 0);
});
window.addEventListener('mouseleave', () => {
  if (hovering < 0) return;
  hovering = -1;
  layer.querySelectorAll('.underline.hover').forEach((line) => line.classList.remove('hover'));
  void api.underlineHover(false);
});
window.addEventListener('mousedown', (event) => {
  const index = hitTest(event.clientX, event.clientY);
  if (index >= 0) { event.preventDefault(); void api.openUnderline(index); }
});

api.onUnderlines(render);
