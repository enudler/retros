// Extends Express's User type so req.user is fully typed throughout the app.
declare global {
  namespace Express {
    interface User {
      id: number;
      google_id: string;
      email: string;
      name: string;
      picture: string | null;
      is_admin: number;
      created_at: string;
    }
  }
}

export {};
