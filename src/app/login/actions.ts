"use server";

import { loginAction, logoutAction, setDemoToggleAction, signupAction } from "@/lib/auth-actions";

// "use server" files may only export async functions, so the wrapped actions live in src/lib/auth-actions.ts.
export async function login(input: { email: string; password: string; next?: string }) {
  return loginAction(input);
}
export async function signup(input: { email: string; password: string }) {
  return signupAction(input);
}
export async function logout() {
  return logoutAction(undefined);
}
export async function setDemoToggle(input: { demo: boolean }) {
  return setDemoToggleAction(input);
}
