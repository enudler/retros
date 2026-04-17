import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import passport from 'passport';
import path from 'path';
import { initializeDatabase } from './database';
import { configurePassport } from './auth';
import adminRouter from './routes/admin';
import boardsRouter from './routes/boards';

const app  = express();
const PORT = parseInt(process.env.PORT ?? '3333', 10);

initializeDatabase();
configurePassport();

app.use(express.json());
app.use(cookieParser());

app.use(session({
  secret: process.env.SESSION_SECRET ?? 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge:   7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
  },
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(express.static(path.join(__dirname, '../public')));

// ── Auth routes ──────────────────────────────────────────────────────────────

app.get('/auth/google', (req, res, next) => {
  // Persist returnTo so we can redirect after login
  if (req.query.returnTo) {
    (req.session as any).returnTo = req.query.returnTo as string;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/error' }),
  (req, res) => {
    const returnTo = (req.session as any).returnTo ?? '/';
    delete (req.session as any).returnTo;
    res.redirect(returnTo);
  },
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/auth/error', (_req, res) => {
  res.status(401).sendFile(path.join(__dirname, '../public/auth-error.html'));
});

// ── Current user ─────────────────────────────────────────────────────────────

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

// ── API ───────────────────────────────────────────────────────────────────────

app.use('/api/admin',  adminRouter);
app.use('/api/boards', boardsRouter);

// ── SPA routes ───────────────────────────────────────────────────────────────

app.get('/board/:slug', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/board.html'));
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.listen(PORT, () => {
  console.log(`Retros running on http://localhost:${PORT}`);
});
