type Zoomable = HTMLImageElement | SVGSVGElement;

const ZOOMABLE = '.docusaurus-mermaid-container svg, .markdown img, .markdown figure svg';
const FALLBACK_ASPECT = 1.6;

const isZoomable = (node: Element): node is Zoomable =>
  (node instanceof SVGSVGElement || node instanceof HTMLImageElement) && node.matches(ZOOMABLE) && !node.closest('a');

// AWS service icons are nested <svg> elements, so the first match walking up
// from a click is an icon, not the diagram. The outermost match is the artifact.
const outermostZoomable = (start: Element | null): Zoomable | null => {
  let found: Zoomable | null = null;
  for (let node: Element | null = start; node; node = node.parentElement) {
    if (isZoomable(node)) found = node;
  }
  return found;
};

const hasZoomableAncestor = (element: Element): boolean => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (isZoomable(node)) return true;
  }
  return false;
};

// The stage derives both of its dimensions from this ratio, so the artifact
// reaches 90% of the viewport on its constraining axis without being stretched.
const aspectRatio = (artifact: Zoomable): number => {
  if (artifact instanceof HTMLImageElement) {
    return artifact.naturalWidth > 0 && artifact.naturalHeight > 0
      ? artifact.naturalWidth / artifact.naturalHeight
      : FALLBACK_ASPECT;
  }

  const box = artifact.viewBox.baseVal;
  if (box && box.width > 0 && box.height > 0) return box.width / box.height;

  const { width, height } = artifact.getBoundingClientRect();
  return width > 0 && height > 0 ? width / height : FALLBACK_ASPECT;
};

const describe = (artifact: Zoomable): string => {
  if (artifact instanceof HTMLImageElement) return artifact.alt.trim() || 'Expanded image';
  const title = artifact.querySelector('title')?.textContent?.trim();
  return title || artifact.getAttribute('aria-label')?.trim() || 'Expanded diagram';
};

interface Lightbox {
  readonly dialog: HTMLDialogElement;
  readonly stage: HTMLElement;
}

let lightbox: Lightbox | undefined;

const build = (): Lightbox => {
  const dialog = document.createElement('dialog');
  dialog.className = 'dev-lightbox';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'dev-lightbox__close';
  close.setAttribute('aria-label', 'Close expanded view');
  close.textContent = '\u00d7';
  close.addEventListener('click', () => dialog.close());

  const stage = document.createElement('div');
  stage.className = 'dev-lightbox__stage';

  dialog.append(close, stage);
  // The backdrop is painted by the UA behind the dialog, so a click on it
  // lands on the dialog box itself rather than on any child.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    stage.replaceChildren();
    document.documentElement.classList.remove('dev-lightbox-open');
  });

  document.body.append(dialog);
  return { dialog, stage };
};

const open = (artifact: Zoomable): void => {
  const { dialog, stage } = (lightbox ??= build());

  const clone = artifact.cloneNode(true) as Element;
  clone.removeAttribute('tabindex');
  clone.removeAttribute('data-dev-zoomable');

  stage.style.setProperty('--dev-lightbox-aspect', String(aspectRatio(artifact)));
  stage.replaceChildren(clone);
  dialog.setAttribute('aria-label', describe(artifact));
  document.documentElement.classList.add('dev-lightbox-open');
  dialog.showModal();
};

const mark = (): void => {
  for (const node of Array.from(document.querySelectorAll<Element>(ZOOMABLE))) {
    if (!isZoomable(node) || node.dataset.devZoomable || hasZoomableAncestor(node)) continue;
    node.dataset.devZoomable = 'true';
    node.setAttribute('tabindex', '0');
  }
};

const onClick = (event: MouseEvent): void => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const artifact = event.target instanceof Element ? outermostZoomable(event.target) : null;
  if (artifact) open(artifact);
};

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const artifact = event.target instanceof Element ? outermostZoomable(event.target) : null;
  if (!artifact || artifact !== event.target) return;
  event.preventDefault();
  open(artifact);
};

let started = false;

const start = (): void => {
  if (started) return;
  started = true;

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeyDown);

  // Mermaid swaps its diagrams in asynchronously and re-renders them on every
  // color-mode change, so newly rendered SVGs have to be picked up as they land.
  let pending = 0;
  new MutationObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(mark);
  }).observe(document.body, { childList: true, subtree: true });
};

export const onRouteDidUpdate = (): void => {
  start();
  mark();
};
