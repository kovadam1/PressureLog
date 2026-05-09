import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { stringify } from "csv-stringify/sync";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import pool from "./db.js";
import { authRequired, adminOnly } from "./auth.js";

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || "*" }));
app.use(express.json());

const symptomDefaults = ["szedules", "fejfajas", "szivdobogas", "mellkasi nyomas", "legszomj"];

async function ensureSchema() {
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(160)`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE`);
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
const { name, password, full_name, birth_date } = req.body;
if (!name || !password) return res.status(400).json({ error: 'Név és jelszó kötelező' });
if (String(password).length < 6) return res.status(400).json({ error: 'A jelszó legalább 6 karakter legyen' });
const pinHash = await bcrypt.hash(password, 10);
const safeRole = 'user';
try {
const q = await pool.query(
'INSERT INTO users(name, pin_hash, role, full_name, birth_date) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,role,full_name,birth_date',
[name, pinHash, safeRole, full_name || null, birth_date || null]
);
res.json(q.rows[0]);
} catch (e) {
if (e?.code === '23505') return res.status(409).json({ error: 'Ez a felhasználónév már foglalt' });
res.status(400).json({ error: 'Hibás adat', detail: e.message });
}
});

app.post('/api/auth/login', async (req, res) => {
const { name, password } = req.body;
const q = await pool.query('SELECT * FROM users WHERE name=$1', [name]);
if (!q.rows[0]) return res.status(401).json({ error: 'Hibás belépés' });
const user = q.rows[0];
const ok = await bcrypt.compare(password || '', user.pin_hash);
if (!ok) return res.status(401).json({ error: 'Hibás belépés' });
const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
res.json({ token, user: { id: user.id, name: user.name, role: user.role, full_name: user.full_name, birth_date: user.birth_date } });
});

app.get('/api/meta/symptoms', authRequired, async (req,res)=>{
const q = await pool.query('SELECT id,label FROM symptom_catalog ORDER BY id');
res.json({ items: q.rows.length ? q.rows : symptomDefaults.map((s,i)=>({id:i+1,label:s})) });
});

app.get('/api/profile', authRequired, async (req,res)=>{
const q = await pool.query('SELECT id,name,full_name,birth_date,role,created_at FROM users WHERE id=$1',[req.user.id]);
res.json({ item: q.rows[0] || null });
});

app.put('/api/profile', authRequired, async (req,res)=>{
const { full_name, birth_date } = req.body;
const q = await pool.query(
'UPDATE users SET full_name=$1, birth_date=$2 WHERE id=$3 RETURNING id,name,full_name,birth_date,role,created_at',
[full_name || null, birth_date || null, req.user.id]
);
res.json({ item: q.rows[0] });
});

app.post('/api/measurements', authRequired, async (req, res) => {
const { systolic, diastolic, pulse, measured_at, daytime, context, symptoms, symptoms_text } = req.body;
if (!systolic || !diastolic || !pulse) return res.status(400).json({ error: 'sys/dia/pulse kotelezo' });

const dateSql = measured_at ? new Date(measured_at) : new Date();
const dayKey = dateSql.toISOString().slice(0,10);
const daily = await pool.query(
`SELECT COUNT(*)::int+1 AS daily_index FROM measurements WHERE user_id=$1 AND measured_at::date = $2::date`,
[req.user.id, dayKey]
);

const inserted = await pool.query(
`INSERT INTO measurements(user_id,systolic,diastolic,pulse,measured_at,daytime,context,daily_index,symptoms_text)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING *`,
[req.user.id, systolic, diastolic, pulse, measured_at || new Date(), daytime || 'egyeni', context || null, daily.rows[0].daily_index, symptoms_text || null]
);

if (Array.isArray(symptoms) && symptoms.length) {
for (const sid of symptoms) {
await pool.query(
'INSERT INTO measurement_symptoms(measurement_id, symptom_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
[inserted.rows[0].id, sid]
);
}
}

const warning = (systolic >= 180 || diastolic >= 120)
? 'KRITIKUS ertek! Azonnali orvosi segitseg javasolt.'
: (systolic >= 140 || diastolic >= 90)
? 'Magas vernyomas tartomany.'
: null;

res.json({ item: inserted.rows[0], warning });
});

app.get('/api/measurements/latest', authRequired, async (req,res)=>{
const q = await pool.query('SELECT * FROM measurements WHERE user_id=$1 ORDER BY measured_at DESC LIMIT 1',[req.user.id]);
res.json({ item: q.rows[0] || null });
});

app.get('/api/measurements', authRequired, async (req,res)=>{
const { from, to } = req.query;
const vals = [req.user.id];
let where = 'WHERE m.user_id=$1';
if (from) { vals.push(from); where += ` AND m.measured_at >= $${vals.length}`; }
if (to) { vals.push(to); where += ` AND m.measured_at <= $${vals.length}`; }

const q = await pool.query(
`SELECT
m.*,
(m.systolic - m.diastolic) AS pulse_pressure,
COALESCE(
ARRAY_REMOVE(ARRAY_AGG(DISTINCT sc.label), NULL),
ARRAY[]::text[]
) AS symptoms_labels
FROM measurements m
LEFT JOIN measurement_symptoms ms ON ms.measurement_id = m.id
LEFT JOIN symptom_catalog sc ON sc.id = ms.symptom_id
${where}
GROUP BY m.id
ORDER BY m.measured_at DESC`,
vals
);

res.json({ items: q.rows });
});

app.get('/api/stats/summary', authRequired, async (req,res)=>{
const q = await pool.query(`
SELECT
COUNT(*)::int AS total,
ROUND(AVG(systolic)::numeric,1) AS avg_sys,
ROUND(AVG(diastolic)::numeric,1) AS avg_dia,
MIN(systolic)::int AS min_sys,
MAX(systolic)::int AS max_sys,
MIN(diastolic)::int AS min_dia,
MAX(diastolic)::int AS max_dia
FROM measurements WHERE user_id=$1`, [req.user.id]);

const trendQ = await pool.query(`
WITH w AS (
SELECT
AVG(CASE WHEN measured_at >= now()-interval '7 day' THEN systolic END) AS cur_sys,
AVG(CASE WHEN measured_at < now()-interval '7 day' AND measured_at >= now()-interval '14 day' THEN systolic END) AS prev_sys
FROM measurements WHERE user_id=$1
) SELECT cur_sys, prev_sys FROM w`, [req.user.id]);
const t = trendQ.rows[0];
let trend = 'stabil';
if (t.cur_sys && t.prev_sys) {
if (t.cur_sys < t.prev_sys - 3) trend = 'javul';
else if (t.cur_sys > t.prev_sys + 3) trend = 'romlik';
}
res.json({ ...q.rows[0], trend });
});

app.get('/api/export.csv', authRequired, async (req,res)=>{
  const { from, to } = req.query;
  const vals = [req.user.id];
  let where = 'WHERE m.user_id=$1';
  if (from) { vals.push(from); where += ` AND m.measured_at::date >= $${vals.length}::date`; }
  if (to) { vals.push(to); where += ` AND m.measured_at::date <= $${vals.length}::date`; }

  const [userQ, dataQ] = await Promise.all([
    pool.query('SELECT full_name, birth_date FROM users WHERE id=$1', [req.user.id]),
    pool.query(`SELECT m.measured_at,m.systolic,m.diastolic,m.pulse,m.daytime,m.context,m.symptoms_text,
      COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT sc.label), NULL), ARRAY[]::text[]) AS symptoms_labels
      FROM measurements m
      LEFT JOIN measurement_symptoms ms ON ms.measurement_id = m.id
      LEFT JOIN symptom_catalog sc ON sc.id = ms.symptom_id
      ${where}
      GROUP BY m.id
      ORDER BY m.measured_at DESC`, vals)
  ]);

  const u = userQ.rows[0] || {};
  const rows = dataQ.rows.map(r => ({
    teljes_nev: u.full_name || '',
    szuletesi_datum: u.birth_date ? new Date(u.birth_date).toISOString().slice(0,10) : '',
    meresi_nap: new Date(r.measured_at).toISOString().slice(0,10),
    idopont: new Date(r.measured_at).toLocaleTimeString('hu-HU', { hour:'2-digit', minute:'2-digit' }),
    vernyomas: `${r.systolic}/${r.diastolic}`,
    pulzus: r.pulse,
    napszak: r.daytime || '',
    alap_tunetek: (r.symptoms_labels || []).join(', '),
    egyeni_tunet: r.symptoms_text || '',
  }));

  const csv = stringify(rows, { header: true });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="vernyomas-export.csv"');
  res.send(csv);
});

app.get('/api/export.pdf', authRequired, async (req,res)=>{
const { from, to } = req.query;
const vals = [req.user.id];
let where = 'WHERE m.user_id=$1';
if (from) { vals.push(from); where += ` AND m.measured_at::date >= $${vals.length}::date`; }
if (to) { vals.push(to); where += ` AND m.measured_at::date <= $${vals.length}::date`; }

const [userQ, medsQ, summaryQ, dataQ] = await Promise.all([
pool.query('SELECT name, full_name, birth_date FROM users WHERE id=$1', [req.user.id]),
pool.query('SELECT name,dose,intake_time FROM medications WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]),
    pool.query(`SELECT ROUND(AVG(m.systolic)::numeric,1) AS avg_sys, ROUND(AVG(m.diastolic)::numeric,1) AS avg_dia, MIN(m.systolic)::int AS min_sys, MAX(m.systolic)::int AS max_sys, MIN(m.diastolic)::int AS min_dia, MAX(m.diastolic)::int AS max_dia, COUNT(*)::int AS total FROM measurements m ${where}`, vals),
pool.query(`SELECT m.measured_at,m.systolic,m.diastolic,m.pulse,m.daytime,m.context,m.symptoms_text,
COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT sc.label), NULL), ARRAY[]::text[]) AS symptoms_labels
FROM measurements m
LEFT JOIN measurement_symptoms ms ON ms.measurement_id = m.id
LEFT JOIN symptom_catalog sc ON sc.id = ms.symptom_id
${where}
GROUP BY m.id
ORDER BY m.measured_at DESC LIMIT 120`, vals)
]);

const u = userQ.rows[0] || {};
const s = summaryQ.rows[0] || {};
const medsText = medsQ.rows.map(x=>`${x.name} ${x.dose} (${x.intake_time})`).join('; ') || '-';
const rows = dataQ.rows;
const ascii = (v='') => String(v)
.normalize('NFD')
.replace(/[\u0300-\u036f]/g, '')
.replace(/O/g, 'O').replace(/o/g, 'o').replace(/U/g, 'U').replace(/u/g, 'u');
const fmtDate = (d) => {
if (!d) return '-';
const x = new Date(d);
const p = (n) => String(n).padStart(2,'0');
return `${x.getFullYear()}.${p(x.getMonth()+1)}.${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`;
};

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const GREEN = rgb(0.11,0.64,0.33);
const SLATE = rgb(0.2,0.23,0.29);

const drawHeader = (page) => {
page.drawText('VERNYOMAS NAPLO', { x: 36, y: 805, size: 16, font: bold, color: GREEN });
page.drawText('OSSZESITO JELENTES', { x: 36, y: 786, size: 10, font, color: SLATE });
const period = `${from || (rows.length ? new Date(rows[rows.length-1].measured_at).toISOString().slice(0,10) : '-')} - ${to || (rows.length ? new Date(rows[0].measured_at).toISOString().slice(0,10) : '-')}`;
page.drawRectangle({ x: 390, y: 770, width: 170, height: 50, borderColor: rgb(0.8,0.84,0.9), borderWidth: 1 });
page.drawText('Idoszak', { x: 398, y: 804, size: 9, font, color: SLATE });
page.drawText(period, { x: 398, y: 790, size: 9, font: bold, color: SLATE });
page.drawText(`Keszitve: ${fmtDate(new Date())}`, { x: 398, y: 777, size: 8, font, color: rgb(0.45,0.49,0.57) });
};

const drawFooter = (page, pageNo, total) => {
  page.drawText(`Oldal ${pageNo} / ${total}`, { x: 500, y: 20, size: 8, font, color: rgb(0.5,0.5,0.5) });
};

const wrapText = (text, maxWidth, size) => {
  const safe = ascii(text || '-');
  const words = safe.split(/\s+/).filter(Boolean);
  if (!words.length) return ['-'];
  const out = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${line} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      out.push(line);
      line = words[i];
    }
  }
  out.push(line);
  return out;
};

const metricCard = (page, x, y, w, h, title, value, sub='') => {
page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.87,0.9,0.94), borderWidth: 1 });
page.drawText(title, { x: x+8, y: y+h-16, size: 8, font, color: rgb(0.4,0.45,0.53) });
page.drawText(value, { x: x+8, y: y+h-34, size: 14, font: bold, color: SLATE });
if (sub) page.drawText(sub, { x: x+8, y: y+8, size: 7, font, color: rgb(0.45,0.49,0.57) });
};

const p1 = pdf.addPage([595,842]);
drawHeader(p1);

// Nagy profil blokk felul
p1.drawRectangle({ x:36, y:620, width:523, height:120, borderColor: rgb(0.87,0.9,0.94), borderWidth:1 });
p1.drawText('PROFIL ADATOK', { x:44, y:722, size:11, font:bold, color:SLATE });
p1.drawText(`Nev: ${ascii(u.full_name || '-')}`, { x:44, y:694, size:14, font:bold, color:SLATE });
p1.drawText(`Szuletesi datum: ${u.birth_date ? new Date(u.birth_date).toISOString().slice(0,10) : '-'}`, { x:44, y:670, size:13, font, color:SLATE });
p1.drawText(`Gyogyszerek: ${ascii(medsText)}`, { x:44, y:646, size:12, font, color:rgb(0.35,0.38,0.45) });

// Osszegzes kozvetlenul alatta
p1.drawText('OSSZEGZES', { x: 36, y: 596, size: 11, font: bold, color: SLATE });
metricCard(p1, 36, 510, 130, 74, 'Atlagos vernyomas', `${s.avg_sys || '-'} / ${s.avg_dia || '-'}`, 'mmHg');
const avgPulse = rows.length ? Math.round(rows.reduce((a,r)=>a+Number(r.pulse||0),0)/rows.length) : '-';
metricCard(p1, 176, 510, 120, 74, 'Atlagos pulzus', String(avgPulse), 'utes/perc');
const highest = rows.reduce((a,r)=> !a || r.systolic>a.systolic ? r : a, null);
const lowest = rows.reduce((a,r)=> !a || r.systolic<a.systolic ? r : a, null);
metricCard(p1, 306, 510, 125, 74, 'Legmagasabb', highest?`${highest.systolic}/${highest.diastolic}`:'-', highest?fmtDate(highest.measured_at):'');
metricCard(p1, 441, 510, 118, 74, 'Legalacsonyabb', lowest?`${lowest.systolic}/${lowest.diastolic}`:'-', lowest?fmtDate(lowest.measured_at):'');

// Elvalaszto csik
p1.drawLine({ start:{x:36,y:488}, end:{x:559,y:488}, thickness:1.2, color:rgb(0.8,0.84,0.9) });

// Minta-szeru tunet blokk + kartya stilusu reszletes naplo
const allSymptoms = rows.flatMap(r => (r.symptoms_labels || [])).filter(Boolean);
const uniqueSymptoms = [...new Set(allSymptoms.map(s => ascii(s)))].slice(0, 8);

p1.drawRectangle({ x:36, y:422, width:523, height:58, borderColor: rgb(0.95,0.80,0.80), borderWidth:1, color: rgb(1,0.97,0.97) });
p1.drawText('FIGYELMET IGENYLO TUNETEK', { x:44, y:462, size:11, font:bold, color:rgb(0.55,0.18,0.18) });
if (uniqueSymptoms.length) {
  p1.drawText(uniqueSymptoms.join(' • ').slice(0, 98), { x:44, y:432, size:9, font, color:rgb(0.55,0.18,0.18) });
}

p1.drawText('RESZLETES MERESI NAPLO', { x: 36, y: 404, size: 14, font: bold, color: SLATE });

const rowsForExport = rows;
let index = 0;
let page = p1;
let y = 388;

while (index < rowsForExport.length) {
  const r = rowsForExport[index];
  const timeText = new Date(r.measured_at).toLocaleTimeString('hu-HU',{hour:'2-digit',minute:'2-digit'});
  const dayText = String(r.daytime || '-');
  const bpText = `${r.systolic}/${r.diastolic}`;
  const pulseText = `${r.pulse} bpm`;
  const sym = (r.symptoms_labels||[]).join(', ');
  const note = (r.symptoms_text||'');
  const noteBase = sym ? ascii(sym) : 'nincs megjegyzes';
  const noteExtra = note ? ` Megj.: ${ascii(note)}` : '';
  const noteLines = wrapText(`${noteBase}${noteExtra}`, 210, 9);
  const rowHeight = Math.max(52, 26 + noteLines.length * 11);

  if (y - rowHeight < 70) {
    page = pdf.addPage([595,842]);
    drawHeader(page);
    page.drawText('RESZLETES MERESI NAPLO (folyt.)', { x: 36, y: 748, size: 13, font: bold, color: SLATE });
    y = 724;
  }

  page.drawRectangle({ x:36, y:y-rowHeight, width:523, height:rowHeight, borderColor: rgb(0.87,0.9,0.94), borderWidth:1, color: index % 2 === 0 ? rgb(0.99,0.995,1) : rgb(1,1,1) });

  page.drawText(timeText, { x:44, y:y-18, size:11, font:bold, color:SLATE });
  page.drawText(dayText, { x:44, y:y-32, size:9, font, color:rgb(0.45,0.49,0.57) });

  page.drawText(bpText, { x:120, y:y-22, size:16, font:bold, color:SLATE });
  page.drawText(pulseText, { x:220, y:y-22, size:11, font:bold, color:SLATE });

  let lineY = y - 18;
  noteLines.slice(0,4).forEach((ln) => {
    page.drawText(ln, { x:300, y:lineY, size:9, font, color:rgb(0.34,0.38,0.45) });
    lineY -= 11;
  });

  y -= (rowHeight + 8);
  index += 1;
}

const pages = pdf.getPages();
pages.forEach((pg, i) => drawFooter(pg, i + 1, pages.length));

const bytes = await pdf.save();
res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', 'attachment; filename="vernyomas-osszefoglalo.pdf"');
res.send(Buffer.from(bytes));
});

app.get('/api/medications', authRequired, async (req,res)=>{
const q = await pool.query('SELECT * FROM medications WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);
res.json({ items: q.rows });
});

app.post('/api/medications', authRequired, async (req,res)=>{
const { name, dose, intake_time, start_date, end_date } = req.body;
if (!name || !dose || !intake_time) return res.status(400).json({ error: 'name, dose, intake_time kotelezo' });
const q = await pool.query(
'INSERT INTO medications(user_id,name,dose,intake_time,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
[req.user.id, name, dose, intake_time, start_date || null, end_date || null]
);
res.json({ item: q.rows[0] });
});

app.post('/api/admin/report-request/:userId', authRequired, adminOnly, async (req,res)=>{
const targetUserId = Number(req.params.userId);
const q = await pool.query(`INSERT INTO report_requests(target_user_id, requested_by_admin_id, status) VALUES($1,$2,'requested') RETURNING *`, [targetUserId, req.user.id]);
res.json({ item: q.rows[0] });
});

app.get('/api/admin/users', authRequired, adminOnly, async (req,res)=>{
const q = await pool.query(`
SELECT u.id,u.name,u.role,u.created_at,
COALESCE(m.total,0)::int as measurement_count,
m.last_measurement_at,
CASE WHEN m.last_measurement_at IS NULL OR m.last_measurement_at < now() - interval '14 day' THEN true ELSE false END as inactive
FROM users u
LEFT JOIN (
SELECT user_id, COUNT(*) AS total, MAX(measured_at) AS last_measurement_at
FROM measurements GROUP BY user_id
) m ON m.user_id=u.id
ORDER BY u.id DESC`);
res.json({ items: q.rows });
});

app.get('/api/admin/system-stats', authRequired, adminOnly, async (req,res)=>{
const q = await pool.query(`
SELECT
(SELECT COUNT(*)::int FROM measurements) AS total_measurements,
(SELECT COUNT(*)::int FROM users WHERE role='user') AS total_users,
(SELECT COUNT(*)::int FROM users u WHERE NOT EXISTS (
SELECT 1 FROM measurements m WHERE m.user_id=u.id AND m.measured_at >= now()-interval '14 day'
) AND u.role='user') AS inactive_users
`);
res.json(q.rows[0]);
});

const port = process.env.PORT || 4000;
ensureSchema()
.then(() => {
app.listen(port, () => console.log(`Backend fut a ${port} porton`));
})
.catch((err) => {
console.error('Schema init hiba:', err);
process.exit(1);
});


