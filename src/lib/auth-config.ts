import "server-only";
// Auth.js v5 setup: credentials provider only (email plus bcrypt password), JWT session in an
// httpOnly cookie. The cookie carries only the user id; role and status are read from the
// database on every request (getSessionUser in ./auth.ts), so approving or rejecting an account
// takes effect immediately without re-login.
//
// There is deliberately no /api/auth/[...nextauth] route: signing in only happens through the
// rate-limited server action in src/app/login/actions.ts, so the limit cannot be bypassed.
// The second provider, "demo", signs in to the shared guided demo account without a password. It
// is reachable only through signIn("demo") in the demo action (src/lib/demo-actions.ts), for the
// same reason: no route exposes providers over HTTP.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { findDemoAccount, verifyCredentials } from "./accounts";
import { createLogger } from "./log";

const log = createLogger("auth.core");

export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

if (!process.env.AUTH_SECRET) {
  log.error("AUTH_SECRET is not set: sessions cannot be signed, so every request is treated as signed out. Set it in .env.local or the Vercel project env.");
}

export const { auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  // Vercel and local dev both sit behind a known host; Auth.js otherwise refuses non-localhost hosts.
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        const user = await verifyCredentials(email, password);
        return user ? { id: user.id, email: user.email } : null;
      },
    }),
    Credentials({
      id: "demo",
      name: "Guided demo",
      credentials: {},
      async authorize() {
        const demo = await findDemoAccount();
        if (!demo) log.warn("demo sign in refused: there is no demo account yet (the demo action creates it first)");
        return demo;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  logger: {
    error(err) {
      // A failed login is an expected outcome, logged by the login action; not an error here.
      if ((err as { type?: string }).type === "CredentialsSignin") {
        log.debug("credentials rejected by authorize");
        return;
      }
      log.error("Auth.js error", { err });
    },
    warn(code) {
      log.warn(`Auth.js warning ${code}`);
    },
    debug(message, metadata) {
      log.trace(`Auth.js ${message}`, metadata ? { metadata } : undefined);
    },
  },
});
