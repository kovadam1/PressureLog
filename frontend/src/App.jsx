import React, { useEffect, useMemo, useState } from "react";
import api from "./api";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const card = "bg-white rounded-2xl border border-slate-200 shadow-sm";
const chip = "px-3 py-1 rounded-full text-sm border";

function statusLabel(sys, dia) {
  if (sys >= 180 || dia >= 120) return { text: "Kritikus", cls: "text-red-600" };
  if (sys >= 140 || dia >= 90) return { text: "Emelkedett", cls: "text-amber-600" };
  return { text: "Normál", cls: "text-emerald-600" };
}

export default function App() {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
  });
  const [tab, setTab] = useState("dashboard");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [form, setForm] = useState({ name: "", password: "" });
  const [reg, setReg] = useState({ name: "", password: "" });
  const [authMode, setAuthMode] = useState("login"); // login | register
  const [authError, setAuthError] = useState("");
  const [m, setM] = useState({ systolic: "120", diastolic: "80", pulse: "72", measured_time: "", daytime: "reggel", context: "ülve", symptoms_text: "", symptoms: [] });
  const [symptomsCatalog, setSymptomsCatalog] = useState([]);
  const [profile, setProfile] = useState({ full_name: "", birth_date: "" });
  const [exportCfg, setExportCfg] = useState({
    from: "",
    to: "",
    format: "pdf",
    include_measurements: true,
    include_symptoms: true,
    include_averages: true,
    include_charts: true,
  });
  const [med, setMed] = useState([]);
  const [medForm, setMedForm] = useState({ name: "", dose: "", intake_time: "reggel" });
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [reportUserId, setReportUserId] = useState("");

  const loadData = async () => {
    const [ms, ss, meds, syms, prof] = await Promise.all([
      api.get("/api/measurements"),
      api.get("/api/stats/summary"),
      api.get("/api/medications"),
      api.get("/api/meta/symptoms"),
      api.get("/api/profile"),
    ]);
    setRows((ms.data.items || []).reverse());
    setSummary(ss.data);
    setMed(meds.data.items || []);
    setSymptomsCatalog(syms.data.items || []);
    setProfile({
      full_name: prof.data.item?.full_name || "",
      birth_date: prof.data.item?.birth_date ? String(prof.data.item.birth_date).slice(0,10) : "",
    });
  };

  const loadAdminData = async () => {
    if (auth?.role !== "admin") return;
    setAdminLoading(true);
    try {
      const [usersRes, statsRes] = await Promise.all([
        api.get("/api/admin/users"),
        api.get("/api/admin/system-stats"),
      ]);
      setAdminUsers(usersRes.data.items || []);
      setAdminStats(statsRes.data || null);
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (!auth) return;
    loadData();
    if (auth.role === "admin") loadAdminData();
  }, [auth]);

  const login = async () => {
    try {
      setAuthError("");
      const { data } = await api.post("/api/auth/login", form);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setAuth(data.user);
    } catch (e) {
      setAuthError(e?.response?.data?.error || "Sikertelen belépés");
    }
  };

  const register = async () => {
    try {
      setAuthError("");
      await api.post("/api/auth/register", reg);
      alert("Sikeres regisztráció");
      setAuthMode("login");
      setForm({ name: reg.name, password: "" });
      setReg({ name: "", password: "" });
    } catch (e) {
      setAuthError(e?.response?.data?.error || "Sikertelen regisztráció");
    }
  };

  const addMeasurement = async () => {
    const now = new Date();
    let measuredAt;
    if (m.measured_time) {
      const [hh, mm] = m.measured_time.split(":").map(Number);
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh || 0, mm || 0, 0, 0);
      measuredAt = d.toISOString();
    }

    await api.post("/api/measurements", {
      ...m,
      measured_at: measuredAt,
      systolic: Number(m.systolic),
      diastolic: Number(m.diastolic),
      pulse: Number(m.pulse),
    });
    await loadData();
    setTab("dashboard");
  };

  const addMedication = async () => {
    if (!medForm.name || !medForm.dose) return;
    await api.post("/api/medications", medForm);
    setMedForm({ name: "", dose: "", intake_time: "reggel" });
    await loadData();
  };

  const saveProfile = async () => {
    await api.put('/api/profile', {
      full_name: profile.full_name,
      birth_date: profile.birth_date || null,
    });
    await loadData();
    alert('Profil mentve');
  };

  const createReportRequest = async () => {
    if (!reportUserId) return;
    await api.post(`/api/admin/report-request/${reportUserId}`);
    alert('Riportkérés elküldve');
    setReportUserId('');
    await loadAdminData();
  };

  const download = async (url, filename) => {
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = blobUrl; a.download = filename; a.click();
    window.URL.revokeObjectURL(blobUrl);
  };

  const runExport = async (forcedFormat) => {
    const params = new URLSearchParams({
      from: exportCfg.from || '',
      to: exportCfg.to || '',
    });
    const ext = forcedFormat || exportCfg.format || 'pdf';
    await download(`/api/export.${ext}?${params.toString()}`, `vernyomas-export.${ext}`);
  };

  const toggleSymptom = (id) => {
    setM((prev) => ({
      ...prev,
      symptoms: prev.symptoms.includes(id)
        ? prev.symptoms.filter((x) => x !== id)
        : [...prev.symptoms, id],
    }));
  };

  const latest = rows.at(-1);
  const trendData = rows.slice(-7).map((r, i) => ({
    nap: i + 1,
    szisztolés: Number(r.systolic),
    diasztolés: Number(r.diastolic),
    pulzus: Number(r.pulse),
  }));

  const dailyAvg = useMemo(() => {
    if (!rows.length) return "--";
    const d = rows[rows.length - 1]?.measured_at?.slice(0, 10);
    const today = rows.filter((r) => r.measured_at?.slice(0, 10) === d);
    const s = Math.round(today.reduce((a, r) => a + r.systolic, 0) / today.length);
    const di = Math.round(today.reduce((a, r) => a + r.diastolic, 0) / today.length);
    return `${s}/${di}`;
  }, [rows]);

  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-100 p-6 flex items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-sm p-6 text-slate-900">
          {authMode === "login" ? (
            <>
              <h2 className="text-xl font-bold mb-3 text-slate-900">Belépés</h2>
              <input className="w-full mb-2 p-2 rounded border border-slate-300 bg-slate-50 text-slate-900 placeholder:text-slate-500" placeholder="Név" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} />
              <input className="w-full mb-3 p-2 rounded border border-slate-300 bg-slate-50 text-slate-900 placeholder:text-slate-500" placeholder="Jelszó" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} />
              {authError && <p className="text-sm text-red-600 mb-2">{authError}</p>}
              <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-semibold" onClick={login}>Belépés</button>
              <button className="w-full mt-3 border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-lg font-medium" onClick={()=>{setAuthError(""); setAuthMode("register");}}>Regisztráció</button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold mb-3 text-slate-900">Regisztráció</h2>
              <input className="w-full mb-2 p-2 rounded border border-slate-300 bg-slate-50 text-slate-900 placeholder:text-slate-500" placeholder="Név" value={reg.name} onChange={e=>setReg({...reg,name:e.target.value})} />
              <input className="w-full mb-2 p-2 rounded border border-slate-300 bg-slate-50 text-slate-900 placeholder:text-slate-500" placeholder="Jelszó (minimum 6 karakter)" type="password" value={reg.password} onChange={e=>setReg({...reg,password:e.target.value})} />
              {authError && <p className="text-sm text-red-600 mb-2">{authError}</p>}
              <button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold" onClick={register}>Regisztráció mentése</button>
              <button className="w-full mt-3 border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-lg font-medium" onClick={()=>{setAuthError(""); setAuthMode("login");}}>Vissza a belépéshez</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-32">
      <div className="max-w-md mx-auto px-4 pt-5">
        <h1 className="text-2xl font-bold">Vérnyomás Napló</h1>
        <p className="text-slate-500">Egészséged napi követése</p>
        <div className="border-b border-slate-300 my-4" />

        {tab === "dashboard" && (
          <>
            <div className={`${card} p-5 mb-3`}>
              {!latest ? (
                <div className="text-center py-2">
                  <p className="font-semibold">Még nincs mérés</p>
                  <p className="text-slate-500 text-sm">Add hozzá az első mérésed lent</p>
                </div>
              ) : (
                <>
                  <div className="flex justify-between"><h3 className="font-semibold">Legutóbbi mérés</h3><span className={statusLabel(latest.systolic, latest.diastolic).cls}>{statusLabel(latest.systolic, latest.diastolic).text}</span></div>
                  <div className="grid grid-cols-2 mt-3">
                    <div><p className="text-sm text-slate-500">Vérnyomás</p><p className="text-2xl font-bold">{latest.systolic}/{latest.diastolic}</p><p className="text-xs text-slate-500">mmHg</p></div>
                    <div><p className="text-sm text-slate-500">Pulzus</p><p className="text-2xl font-bold">{latest.pulse}</p><p className="text-xs text-slate-500">bpm</p></div>
                  </div>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className={`${card} p-3`}><p className="text-sm text-slate-500">Napi átlag</p><p className="text-xl font-semibold">{dailyAvg}</p></div>
              <div className={`${card} p-3`}><p className="text-sm text-slate-500">Heti átlag</p><p className="text-xl font-semibold">{summary?.avg_sys ? `${summary.avg_sys}/${summary.avg_dia}` : "--"}</p></div>
            </div>
            <div className={`${card} p-4 mb-3`}>
              <h3 className="font-semibold mb-2">7 napos trend</h3>
              <div style={{ width: "100%", height: 210 }}>
                <ResponsiveContainer>
                  <LineChart data={trendData}>
                    <CartesianGrid stroke="#e2e8f0" />
                    <XAxis dataKey="nap" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="szisztolés" stroke="#22c55e" strokeWidth={2} />
                    <Line type="monotone" dataKey="diasztolés" stroke="#3b82f6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={`${card} p-4 mb-3`}>
              <h3 className="font-semibold mb-2">Legutóbbi mérések (lista)</h3>
              {rows.length === 0 ? (
                <p className="text-sm text-slate-500">Még nincs mentett mérés.</p>
              ) : (
                <div className="space-y-2">
                  {rows.slice(-5).reverse().map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 p-2">
                      <div>
                        <p className="font-semibold leading-tight">{r.systolic}/{r.diastolic} mmHg • {r.pulse} bpm</p>
                        <p className="text-xs text-slate-500">{new Date(r.measured_at).toLocaleString("hu-HU")}</p>
                      </div>
                      <span className={`text-xs ${statusLabel(r.systolic, r.diastolic).cls}`}>{statusLabel(r.systolic, r.diastolic).text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="w-full bg-emerald-500 text-white rounded-xl py-3 font-semibold" onClick={() => setTab("add")}>Új mérés</button>
          </>
        )}

        {tab === "add" && (
          <div className={`${card} p-4 space-y-3`}>
            <h3 className="font-semibold">Új mérés</h3>
            <div className="grid grid-cols-2 gap-2">
              <input className="p-2 rounded bg-slate-100" placeholder="Szisztolés" value={m.systolic} onChange={e=>setM({...m,systolic:e.target.value})} />
              <input className="p-2 rounded bg-slate-100" placeholder="Diasztolés" value={m.diastolic} onChange={e=>setM({...m,diastolic:e.target.value})} />
            </div>
            <input className="w-full p-2 rounded bg-slate-100" placeholder="Pulzus" value={m.pulse} onChange={e=>setM({...m,pulse:e.target.value})} />
            <div>
              <label className="text-sm text-slate-600">Mérés időpontja (óra:perc, opcionális)</label>
              <input
                type="time"
                className="w-full p-2 rounded bg-slate-100 mt-1"
                value={m.measured_time}
                onChange={e=>setM({...m,measured_time:e.target.value})}
              />
              <p className="text-xs text-slate-500 mt-1">Az év/hó/nap automatikusan a mai nap lesz. Ha üres, a mentés pillanatát használjuk.</p>
            </div>
            <div>
              <p className="text-sm mb-1">Napszak</p>
              <div className="flex gap-2">
                {[
                  ["reggel", "Reggel"], ["del", "Dél"], ["este", "Este"]
                ].map(([v,l]) => <button key={v} className={`${chip} ${m.daytime===v?"bg-emerald-50 border-emerald-400 text-emerald-700":"bg-white border-slate-300"}`} onClick={()=>setM({...m,daytime:v})}>{l}</button>)}
              </div>
            </div>
            <input className="w-full p-2 rounded bg-slate-100" placeholder="Testhelyzet (pl. ülve)" value={m.context} onChange={e=>setM({...m,context:e.target.value})} />
            <div>
              <p className="text-sm mb-1">Alap tünetek</p>
              <div className="flex flex-wrap gap-2">
                {symptomsCatalog.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSymptom(s.id)}
                    className={`${chip} ${m.symptoms.includes(s.id) ? "bg-amber-50 border-amber-400 text-amber-700" : "bg-white border-slate-300"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea className="w-full p-2 rounded bg-slate-100" placeholder="Egyéni tünet / megjegyzés..." value={m.symptoms_text} onChange={e=>setM({...m,symptoms_text:e.target.value})} />
            <button className="w-full bg-emerald-500 text-white rounded-xl py-3 font-semibold" onClick={addMeasurement}>Mérés mentése</button>
          </div>
        )}

        {tab === "log" && (
          <div className="space-y-3">
            <div className={`${card} p-3`}><p className="font-semibold">Mérési napló</p><p className="text-sm text-slate-500">{rows.length} mérés</p></div>
            {rows.slice().reverse().map((r) => (
              <div className={`${card} p-3`} key={r.id}>
                <div className="flex justify-between text-sm"><span>{new Date(r.measured_at).toLocaleString("hu-HU")}</span><span className={statusLabel(r.systolic, r.diastolic).cls}>{statusLabel(r.systolic, r.diastolic).text}</span></div>
                <div className="grid grid-cols-2 mt-2"><div><p className="text-slate-500 text-sm">Vérnyomás</p><p className="font-bold text-xl">{r.systolic}/{r.diastolic}</p></div><div><p className="text-slate-500 text-sm">Pulzus</p><p className="font-bold text-xl">{r.pulse}</p></div></div>
                {(r.symptoms_labels?.length > 0 || r.symptoms_text) && (
                  <div className="mt-2 space-y-1">
                    {r.symptoms_labels?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.symptoms_labels.map((s, idx) => (
                          <span key={`${r.id}-sym-${idx}`} className="text-xs px-2 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-700">{s}</span>
                        ))}
                      </div>
                    )}
                    {r.symptoms_text && <p className="text-sm text-slate-600">Egyéni: {r.symptoms_text}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "stats" && (
          <div className="space-y-3">
            <div className={`${card} p-3`}><p className="font-semibold">Statisztika</p><p className="text-sm text-slate-500">Trend elemzés</p></div>
            <div className={`${card} p-4`}>
              <p className="font-semibold mb-2">Vérnyomás trend</p>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={trendData}>
                    <CartesianGrid stroke="#e2e8f0" />
                    <XAxis dataKey="nap" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="szisztolés" stroke="#10b981" strokeWidth={2} />
                    <Line type="monotone" dataKey="diasztolés" stroke="#3b82f6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className={`${card} p-3 grid grid-cols-2`}><div><p className="text-sm text-slate-500">Átlag BP</p><p className="text-xl font-bold">{summary?.avg_sys ? `${summary.avg_sys}/${summary.avg_dia}` : "--"}</p></div><div><p className="text-sm text-slate-500">Átlag pulzus</p><p className="text-xl font-bold">{rows.length ? Math.round(rows.reduce((a,r)=>a+r.pulse,0)/rows.length) : "--"}</p></div></div>
          </div>
        )}

        {tab === "admin" && auth?.role === "admin" && (
          <div className="space-y-3">
            <div className={`${card} p-3`}>
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold">Admin panel</p>
                <button className="text-sm border border-slate-300 rounded px-2 py-1" onClick={loadAdminData}>Frissítés</button>
              </div>
              {adminLoading ? (
                <p className="text-sm text-slate-500">Betöltés...</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-slate-200 p-2 bg-slate-50">
                    <p className="text-xs text-slate-500">Összes mérés</p>
                    <p className="text-lg font-bold">{adminStats?.total_measurements ?? '--'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2 bg-slate-50">
                    <p className="text-xs text-slate-500">Felhasználók</p>
                    <p className="text-lg font-bold">{adminStats?.total_users ?? '--'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-2 bg-slate-50">
                    <p className="text-xs text-slate-500">Inaktív (14 nap)</p>
                    <p className="text-lg font-bold">{adminStats?.inactive_users ?? '--'}</p>
                  </div>
                </div>
              )}
            </div>

            <div className={`${card} p-3`}>
              <p className="font-semibold mb-2">Riportkérés</p>
              <div className="flex gap-2">
                <input className="flex-1 p-2 rounded bg-slate-100" placeholder="User ID (pl. 2)" value={reportUserId} onChange={e=>setReportUserId(e.target.value)} />
                <button className="bg-indigo-600 text-white rounded-lg px-3" onClick={createReportRequest}>Küldés</button>
              </div>
            </div>

            <div className={`${card} p-3`}>
              <p className="font-semibold mb-2">Felhasználók</p>
              <div className="space-y-2">
                {adminUsers.map((u) => (
                  <div key={u.id} className="rounded-lg border border-slate-200 p-2 bg-slate-50 text-sm">
                    <div className="flex justify-between">
                      <span className="font-semibold">#{u.id} • {u.name}</span>
                      <span className={`text-xs ${u.role === 'admin' ? 'text-indigo-700' : 'text-slate-600'}`}>{u.role}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">Mérések: {u.measurement_count} • Utolsó: {u.last_measurement_at ? new Date(u.last_measurement_at).toLocaleString('hu-HU') : 'nincs'}</div>
                  </div>
                ))}
                {!adminUsers.length && <p className="text-sm text-slate-500">Nincs adat.</p>}
              </div>
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div className="space-y-3">
            <div className={`${card} p-3`}>
              <p className="font-semibold mb-2">Profil adatok</p>
              <p className="text-xs text-slate-500 mb-2">Felhasználónév: {auth?.name}</p>
              <input
                className="w-full p-2 rounded bg-slate-100 mb-2"
                placeholder="Teljes név"
                value={profile.full_name}
                onChange={(e)=>setProfile({...profile, full_name: e.target.value})}
              />
              <div>
                <label className="text-sm text-slate-600">Születési idő</label>
                <input
                  type="date"
                  className="w-full p-2 rounded bg-slate-100 mt-1"
                  value={profile.birth_date}
                  onChange={(e)=>setProfile({...profile, birth_date: e.target.value})}
                />
              </div>
              <button className="w-full mt-3 border border-slate-300 rounded-lg py-2" onClick={saveProfile}>Profil mentése</button>
            </div>
            <div className={`${card} p-3`}>
              <p className="font-semibold mb-2">Exportálás</p>
              <p className="text-xs text-slate-500 mb-3">Időszak alapján exportál: profil adatok (teljes név, születési dátum) + mérések + tünetek.</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-xs text-slate-500">Kezdő dátum</label>
                  <input type="date" className="w-full p-2 rounded bg-slate-100 mt-1" value={exportCfg.from} onChange={e=>setExportCfg({...exportCfg,from:e.target.value})} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Záró dátum</label>
                  <input type="date" className="w-full p-2 rounded bg-slate-100 mt-1" value={exportCfg.to} onChange={e=>setExportCfg({...exportCfg,to:e.target.value})} />
                </div>
              </div>
              <div className="flex gap-2">
                <button className="flex-1 bg-emerald-500 text-white rounded-lg py-2 font-semibold" onClick={()=>runExport('pdf')}>PDF export</button>
                <button className="flex-1 border border-slate-300 rounded-lg py-2 font-semibold" onClick={()=>runExport('csv')}>CSV export</button>
              </div>
            </div>
            <div className={`${card} p-3`}>
              <p className="font-semibold mb-2">Gyógyszerek</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <input className="p-2 rounded bg-slate-100" placeholder="Név" value={medForm.name} onChange={e=>setMedForm({...medForm,name:e.target.value})} />
                <input className="p-2 rounded bg-slate-100" placeholder="Dózis" value={medForm.dose} onChange={e=>setMedForm({...medForm,dose:e.target.value})} />
                <select className="p-2 rounded bg-slate-100" value={medForm.intake_time} onChange={e=>setMedForm({...medForm,intake_time:e.target.value})}><option value="reggel">reggel</option><option value="este">este</option></select>
              </div>
              <button className="w-full border border-slate-300 rounded-lg py-2" onClick={addMedication}>Gyógyszer mentése</button>
              <div className="mt-2 space-y-1">{med.map(x=><div key={x.id} className="text-sm text-slate-600">• {x.name} – {x.dose} ({x.intake_time})</div>)}</div>
            </div>
            <button className="w-full bg-slate-700 text-white rounded-xl py-3" onClick={()=>{localStorage.clear(); setAuth(null);}}>Kilépés</button>
          </div>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-[0_-6px_20px_rgba(15,23,42,0.08)]">
        <div className={`max-w-md mx-auto grid ${auth?.role === 'admin' ? 'grid-cols-6' : 'grid-cols-5'} text-sm`}>
          {[
            ["dashboard", "Főoldal", "🏠"],
            ["log", "Napló", "📋"],
            ["add", "Hozzáad", "➕"],
            ["stats", "Statisztika", "📈"],
            ...(auth?.role === 'admin' ? [["admin", "Admin", "🛠️"]] : []),
            ["profile", "Profil", "👤"],
          ].map(([k, label, icon]) => (
            <button
              key={k}
              className={`py-3 flex flex-col items-center justify-center gap-1.5 ${tab===k?"text-emerald-600 font-semibold":"text-slate-500"}`}
              onClick={()=>setTab(k)}
            >
              <span className="text-xl leading-none" aria-hidden="true">{icon}</span>
              <span className="leading-none">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
