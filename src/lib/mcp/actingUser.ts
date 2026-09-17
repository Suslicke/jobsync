import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// The user an MCP request acts as. Set only by the MCP route after the bearer
// token is verified, and scoped to that request's async context — so server
// actions and API route handlers called from MCP see this user through auth(),
// with all their usual ownership checks, and nothing leaks between requests.
export interface ActingUser {
  id: string;
  name: string;
  email: string;
}

const store = new AsyncLocalStorage<ActingUser>();

export const runAsUser = <T>(user: ActingUser, fn: () => Promise<T>): Promise<T> => store.run(user, fn);

export const getActingUser = (): ActingUser | undefined => store.getStore();
