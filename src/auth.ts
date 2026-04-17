import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { upsertUser, getUserByGoogleId } from './database';
import './types';

export function configurePassport(): void {
  const clientID     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
    process.exit(1);
  }

  const appUrl     = process.env.APP_URL     ?? 'http://localhost:3333';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';

  passport.use(new GoogleStrategy(
    {
      clientID,
      clientSecret,
      callbackURL: `${appUrl}/auth/google/callback`,
    },
    (_accessToken, _refreshToken, profile, done) => {
      try {
        const email   = profile.emails?.[0]?.value ?? '';
        const name    = profile.displayName;
        const picture = profile.photos?.[0]?.value ?? null;
        const isAdmin = adminEmail && email === adminEmail ? 1 : 0;
        const user    = upsertUser(profile.id, email, name, picture, isAdmin);
        done(null, user);
      } catch (err) {
        done(err as Error);
      }
    },
  ));

  passport.serializeUser((user, done) => {
    done(null, user.google_id);
  });

  passport.deserializeUser((googleId: string, done) => {
    const user = getUserByGoogleId(googleId);
    done(null, user ?? false);
  });
}
