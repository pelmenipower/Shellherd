/** Text files bundled by Vite, e.g. CHANGELOG.md. */
declare module '*.md?raw' {
  const content: string;
  export default content;
}

/** Images bundled by Vite resolve to their URL. */
declare module '*.png' {
  const src: string;
  export default src;
}
