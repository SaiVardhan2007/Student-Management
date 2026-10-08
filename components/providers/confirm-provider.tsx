'use client';

// Lets any component ask "Are you sure?" with await confirm(...) instead of managing dialog state itself.

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui';

const ConfirmContext = createContext<(opts: any) => Promise<boolean>>(() => Promise.resolve(false));

/** Usage: const confirm = useConfirm(); if (await confirm({ message, danger: true })) { ... } */
export function ConfirmProvider({ children }: any) {
  // Options of the dialog currently shown (null means no dialog)
  const [state, setState] = useState(null);
  // The resolve function of the pending promise, called when the user answers
  const resolver = useRef(null);

  const confirm = useCallback(
    (opts: any) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setState(opts);
      }),
    []
  );

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
