declare module 'url:*' {
  const value: string;
  export default value;
}

declare module '*.png' {
  const value: string;
  export default value;
}

declare module 'occt-import-js' {
  const factory: (options: { wasmBinary: ArrayBuffer }) => Promise<unknown>;
  export default factory;
}
