import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { initializeDatabase } from './database';
import adminRouter from './routes/admin';
import boardsRouter from './routes/boards';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3333', 10);

initializeDatabase();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Assign a persistent session id to every browser that doesn't have one
app.use((req, res, next) => {
  if (!req.cookies.session_id) {
    const sid = uuidv4();
    res.cookie('session_id', sid, {
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60 * 1000,
      sameSite: 'strict',
    });
    req.cookies.session_id = sid;
  }
  next();
});

app.use('/api/admin', adminRouter);
app.use('/api/boards', boardsRouter);

// SPA-style routes for the frontend pages
app.get('/board/:slug', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/board.html'));
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.listen(PORT, () => {
  console.log(`Retros running on http://localhost:${PORT}`);
});
