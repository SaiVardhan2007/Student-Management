import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ConfirmDialog } from './ui.jsx';

const ConfirmContext = createContext(() => Promise.resolve(false));

/** Usage: const confirm = useConfirm(); if (await confirm({ message, danger: true })) { ... } */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve;
    setState(opts);
  }), []);

  const close = (result) => {
    resolver.current?.(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && <ConfirmDialog {...state} onConfirm={() => close(true)} onCancel={() => close(false)} />}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
