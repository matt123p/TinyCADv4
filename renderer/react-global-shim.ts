const react = (typeof globalThis !== 'undefined'
  ? (globalThis as any).React
  : null) as any;

if (!react) {
  throw new Error('Global React is required before loading server.bundle.js');
}

export default react;
export const Component = react.Component;
export const PureComponent = react.PureComponent;
export const Fragment = react.Fragment;
export const memo = react.memo;
export const createElement = react.createElement;
export const cloneElement = react.cloneElement;
export const createContext = react.createContext;
export const forwardRef = react.forwardRef;
export const isValidElement = react.isValidElement;
export const Children = react.Children;
export const useCallback = react.useCallback;
export const useContext = react.useContext;
export const useEffect = react.useEffect;
export const useLayoutEffect = react.useLayoutEffect;
export const useMemo = react.useMemo;
export const useRef = react.useRef;
export const useState = react.useState;
