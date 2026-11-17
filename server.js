const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS) || 2; // mínimo de jugadores para empezar
const DRAW_MS = Number(process.env.DRAW_MS) || 2500;      // cada cuánto sale un número
const PICKS = 5;
const MAX_NUM = 100;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Estado de la única sala
let nextId = 1;
const players = new Map(); // id -> { id, name, ws, picks, ready, inRound }
let phase = 'lobby';       // 'lobby' | 'playing' | 'ended'
let drawn = [];
let pool = [];
let last = null;
let winners = [];
let timer = null;

const hits = (p) => p.picks.filter((n) => drawn.includes(n)).length;

function broadcast() {
  const list = [...players.values()].map((p) => ({
    id: p.id, name: p.name, ready: p.ready, inRound: p.inRound, hits: hits(p),
  }));
  for (const p of players.values()) {
    if (p.ws.readyState !== 1) continue;
    p.ws.send(JSON.stringify({
      type: 'state', you: p.id, phase, drawn, last, min: MIN_PLAYERS, picks: PICKS,
      winners: winners.map((w) => w.name), players: list,
    }));
  }
}

function toLobby() {
  clearInterval(timer); timer = null;
  phase = 'lobby'; drawn = []; pool = []; last = null; winners = [];
  for (const p of players.values()) { p.picks = []; p.ready = false; p.inRound = false; }
}

function startGame() {
  phase = 'playing'; drawn = []; last = null; winners = [];
  pool = Array.from({ length: MAX_NUM }, (_, i) => i + 1);
  for (const p of players.values()) p.inRound = p.ready;
  timer = setInterval(drawNumber, DRAW_MS);
  broadcast();
}

function drawNumber() {
  if (!pool.length) return;
  last = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  drawn.push(last);
  winners = [...players.values()].filter((p) => p.inRound && hits(p) >= PICKS);
  if (winners.length) { clearInterval(timer); timer = null; phase = 'ended'; }
  broadcast();
}

function validPicks(a) {
  return Array.isArray(a) && a.length === PICKS &&
    new Set(a).size === PICKS &&
    a.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_NUM);
}

function error(ws, message) { ws.send(JSON.stringify({ type: 'error', message })); }

wss.on('connection', (ws) => {
  const p = { id: nextId++, name: null, ws, picks: [], ready: false, inRound: false };

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'join') {
      p.name = String(m.name || '').trim().slice(0, 20) || 'Jugador ' + p.id;
      players.set(p.id, p);
      return broadcast();
    }
    if (!players.has(p.id)) return;

    if (m.type === 'ready' && phase === 'lobby') {
      if (!validPicks(m.picks)) return error(ws, 'Elegí 5 números distintos del 1 al 100.');
      p.picks = m.picks; p.ready = true;
    } else if (m.type === 'unready' && phase === 'lobby') {
      p.ready = false; p.picks = [];
    } else if (m.type === 'start' && phase === 'lobby') {
      const all = [...players.values()];
      if (all.length < MIN_PLAYERS) return error(ws, 'Hacen falta al menos ' + MIN_PLAYERS + ' jugadores.');
      if (!all.every((x) => x.ready)) return error(ws, 'Todavía hay jugadores sin elegir sus números.');
      return startGame();
    } else if (m.type === 'again' && phase === 'ended') {
      toLobby();
    } else return;
    broadcast();
  });

  ws.on('close', () => {
    players.delete(p.id);
    if (phase === 'playing' && ![...players.values()].some((x) => x.inRound)) toLobby();
    broadcast();
  });
});

server.listen(PORT, () => console.log('Bingo en http://localhost:' + PORT));
