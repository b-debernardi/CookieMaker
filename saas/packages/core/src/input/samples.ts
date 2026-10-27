// Built-in sample designs, so there is something to look at on first load.

export const SAMPLES: { id: string; label: string; svg: string }[] = [
  {
    id: 'gingerbread',
    label: 'Galletita de jengibre',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120">
  <g fill="#8b5a2b">
    <circle cx="50" cy="22" r="17"/>
    <rect x="31" y="36" width="38" height="44" rx="12"/>
    <rect x="8" y="42" width="40" height="15" rx="7.5" transform="rotate(-18 28 49)"/>
    <rect x="52" y="42" width="40" height="15" rx="7.5" transform="rotate(18 72 49)"/>
    <rect x="30" y="66" width="17" height="46" rx="8.5" transform="rotate(12 38 89)"/>
    <rect x="53" y="66" width="17" height="46" rx="8.5" transform="rotate(-12 62 89)"/>
  </g>
  <g fill="#ffffff">
    <circle cx="43" cy="18" r="3"/>
    <circle cx="57" cy="18" r="3"/>
    <circle cx="50" cy="50" r="3.2"/>
    <circle cx="50" cy="63" r="3.2"/>
  </g>
  <path d="M41 26 Q50 34 59 26" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>
</svg>`,
  },
  {
    id: 'star',
    label: 'Estrella',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M50 4 L61.8 36.2 L95.6 37.3 L69 58.2 L78.2 90.7 L50 71.8 L21.8 90.7 L31 58.2 L4.4 37.3 L38.2 36.2 Z" fill="#000"/>
</svg>`,
  },
  {
    id: 'heart',
    label: 'Corazón',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 92">
  <path d="M50 88 C20 66 4 50 4 30 C4 14 16 4 29 4 C39 4 46 9 50 17 C54 9 61 4 71 4 C84 4 96 14 96 30 C96 50 80 66 50 88 Z" fill="#c0392b"/>
  <path d="M30 22 Q22 26 22 36" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
</svg>`,
  },
];
