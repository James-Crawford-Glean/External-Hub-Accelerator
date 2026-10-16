// `me` is fetched once by AuthGate after sign-in and shared through context.
import { createContext, useContext } from 'react';
import type { Me } from '../lib/api/identity';

export const CurrentUserContext = createContext<Me | null>(null);

export function useCurrentUser(): Me | null {
  return useContext(CurrentUserContext);
}
