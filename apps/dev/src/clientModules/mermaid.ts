import type { Mermaid } from 'mermaid';

const lightThemeVariables = {
  darkMode: false,
  background: '#ffffff',
  primaryColor: '#a9e0ff',
  primaryTextColor: '#202124',
  primaryBorderColor: '#343ced',
  secondaryColor: '#f6f3eb',
  secondaryTextColor: '#202124',
  secondaryBorderColor: '#343ced',
  tertiaryColor: '#d8fd49',
  tertiaryTextColor: '#202124',
  tertiaryBorderColor: '#1e26d6',
  lineColor: '#343ced',
  textColor: '#202124',
  mainBkg: '#a9e0ff',
  nodeBorder: '#343ced',
  clusterBkg: '#f6f3eb',
  clusterBorder: '#343ced',
  titleColor: '#202124',
  actorBkg: '#f6f3eb',
  actorBorder: '#343ced',
  actorTextColor: '#202124',
  actorLineColor: '#343ced',
  signalColor: '#343ced',
  signalTextColor: '#202124',
  edgeLabelBackground: '#ffffff',
  labelBoxBkgColor: '#ffffff',
  labelBoxBorderColor: '#343ced',
  labelTextColor: '#202124',
  loopTextColor: '#202124',
  noteBkgColor: '#ffdf69',
  noteTextColor: '#202124',
  noteBorderColor: '#343ced',
  activationBkgColor: '#d8fd49',
  sequenceNumberColor: '#ffffff',
} as const;

let mermaidPromise: Promise<Mermaid> | undefined;

const loadMermaid = (): Promise<Mermaid> =>
  (mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => mermaid));

// Mermaid sizes every box from a getBBox measurement taken at render time. If
// DM Sans is still in flight it measures the fallback, then the wider webfont
// paints and overflows the box it just sized.
const waitForFonts = async (): Promise<void> => {
  const { fonts } = document;
  if (!fonts) return;
  await Promise.allSettled([fonts.load('400 16px "DM Sans"'), fonts.load('500 16px "DM Sans"')]);
  await fonts.ready;
};

const isDark = (): boolean => document.documentElement.getAttribute('data-theme') === 'dark';

const configure = (mermaid: Mermaid): void => {
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark() ? 'dark' : 'base',
    fontFamily: 'DM Sans, system-ui, sans-serif',
    // wrappingWidth also caps the label box; too low and a label mermaid
    // mis-measures gets clipped rather than wrapped. Diagrams carry their own
    // <br/> where a specific shape matters.
    flowchart: { curve: 'basis', padding: 12, rankSpacing: 34, wrappingWidth: 280 },
    ...(isDark() ? {} : { themeVariables: lightThemeVariables }),
  });
};

// Docusaurus renders each source line as its own `.token-line` node, so
// textContent on the block collapses the diagram onto one line.
const readSource = (block: HTMLElement): string =>
  Array.from(block.querySelectorAll('.token-line'))
    .map((line) => line.textContent ?? '')
    .join('\n')
    .trim();

const claimBlock = (block: HTMLElement, source: string): HTMLElement => {
  const host = document.createElement('div');
  host.className = 'docusaurus-mermaid-container';
  host.dataset.mermaidSource = source;
  block.replaceWith(host);
  return host;
};

const showSource = (host: HTMLElement, source: string): void => {
  const fallback = document.createElement('pre');
  fallback.textContent = source;
  host.replaceChildren(fallback);
};

let renderSeq = 0;

// mermaid.render mutates module-level state, so concurrent calls drop diagrams.
// Render one at a time and let a bad diagram fail without taking out the rest.
const renderInto = async (mermaid: Mermaid, host: HTMLElement): Promise<void> => {
  const source = host.dataset.mermaidSource;
  if (!source) return;
  try {
    const { svg } = await mermaid.render(`mermaid-${++renderSeq}`, source, host);
    host.innerHTML = svg;
  } catch (error) {
    console.error('mermaid render failed', error);
    showSource(host, source);
  }
};

const renderMermaid = async ({ replay = false } = {}): Promise<void> => {
  const [mermaid] = await Promise.all([loadMermaid(), waitForFonts()]);
  configure(mermaid);
  document.documentElement.dataset.mermaid = 'ready';

  const hosts = replay
    ? Array.from(document.querySelectorAll<HTMLElement>('.docusaurus-mermaid-container[data-mermaid-source]'))
    : Array.from(document.querySelectorAll<HTMLElement>('.theme-code-block.language-mermaid')).map((block) =>
        claimBlock(block, readSource(block)),
      );

  for (const host of hosts) await renderInto(mermaid, host);
};

let watchingColorMode = false;

const watchColorMode = (): void => {
  if (watchingColorMode) return;
  watchingColorMode = true;
  new MutationObserver(() => {
    void renderMermaid({ replay: true });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
};

export const onRouteDidUpdate = ({
  location,
  previousLocation,
}: {
  location: { pathname: string };
  previousLocation?: { pathname: string };
}): void => {
  if (location.pathname === previousLocation?.pathname) return;
  watchColorMode();
  // CSS hides the raw fenced source until this resolves; if the CDN is
  // unreachable, fall back to showing it rather than an empty page.
  void renderMermaid().catch((error) => {
    console.error('mermaid unavailable', error);
    document.documentElement.dataset.mermaid = 'failed';
  });
};
