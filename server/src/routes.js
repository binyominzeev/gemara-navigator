import { Router } from 'express';
import { getHistory, recordHistory } from './db.js';
import { requireAuth } from './auth.js';

const router = Router();
const validNavigators = new Set(['gemara', 'tursa']);
const maxHistoryEntries = 500;

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

router.get('/history', requireAuth, (req, res) => {
  res.json({ history: getHistory(req.user.id) });
});

router.post('/history', requireAuth, (req, res) => {
  const { navigator, work, item } = req.body || {};
  const parsedItem = Number(item);

  if (
    !validNavigators.has(navigator) ||
    typeof work !== 'string' ||
    work.length < 1 ||
    work.length > 100 ||
    !Number.isInteger(parsedItem) ||
    parsedItem < 1 ||
    parsedItem > maxHistoryEntries
  ) {
    return res.status(400).json({ error: 'Invalid history entry' });
  }

  recordHistory({
    userId: req.user.id,
    navigator,
    work,
    item: parsedItem,
    lastOpenedAt: new Date().toISOString()
  });

  return res.status(204).end();
});

export default router;
