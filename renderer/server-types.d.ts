// The renderer deliberately targets React's browser-safe legacy server build.
declare module 'react-dom/server.browser' {
  export { renderToStaticMarkup } from 'react-dom/server';
}
