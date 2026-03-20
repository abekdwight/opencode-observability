import express from 'express';
import { homeRoute } from './routes/home.js';
import { directoryRoute } from './routes/directory.js';
import { sessionRoute } from './routes/session.js';
import { dashboardRoute, invalidateDashboardCache } from './routes/dashboard.js';
import { searchRoute } from './routes/search.js';
import { getWritableDb } from './lib/db.js';
import { toolErrorsRoute } from './routes/tool-errors.js';

const app = express();
const PORT = Number(process.env.PORT) || 3737;

app.use(express.json());

app.get('/', dashboardRoute);
app.get('/directories', homeRoute);
app.get('/search', searchRoute);
app.get('/dir/:directory(.*)', directoryRoute);
app.get('/session/:sessionId', sessionRoute);
app.get('/tool-errors/:tool', toolErrorsRoute);

app.delete('/api/session/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const db = getWritableDb();
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const deleteStmt = db.prepare('DELETE FROM session WHERE id = ? OR parent_id = ?');
    const result = deleteStmt.run(sessionId, sessionId);
    invalidateDashboardCache();
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  } finally {
    db.close();
  }
});

app.listen(PORT, () => {
  console.log(`OpenCode Telemetry running at http://localhost:${PORT}`);
});
