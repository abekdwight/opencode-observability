import express from 'express';
import { homeRoute } from './routes/home.js';
import { directoryRoute } from './routes/directory.js';
import { sessionRoute } from './routes/session.js';
import { dashboardRoute } from './routes/dashboard.js';
import { searchRoute } from './routes/search.js';

const app = express();
const PORT = Number(process.env.PORT) || 3737;

app.use(express.json());

app.get('/', homeRoute);
app.get('/dashboard', dashboardRoute);
app.get('/search', searchRoute);
app.get('/dir/:directory(.*)', directoryRoute);
app.get('/session/:sessionId', sessionRoute);

app.listen(PORT, () => {
  console.log(`OpenCode Telemetry running at http://localhost:${PORT}`);
});
