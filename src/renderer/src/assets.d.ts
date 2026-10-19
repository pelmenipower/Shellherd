/** Text files bundled by Vite, e.g. CHANGELOG.md. */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
