// /pages/index.js
// --- CÓDIGO CORRIGIDO ---
// A correção impede que o 'localStorage' seja chamado no servidor.

import { useEffect, useMemo, useRef, useState } from "react";

/** ========= CONFIG ========= */
const DEFAULT_LIMITS = {
  temp: { min: 18, max: 27 }, // °C
  hum: { min: 30, max: 70 },  // %
};

const DEVICES = [
  { id: "eb798cab6fd0612ab95jwc", name: "Sala-T5" },
  { id: "eb4834395c8fbc4dfefpe9", name: "Sala-T4" },
  { id: "eb13a02df36c15cc0czqmm", name: "Sala-T3" },
  { id: "eb08f82b6ddb5a1699dced", name: "Sala-T2" },
];

const DEFAULT_REFRESH_SECONDS = 30;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const HISTORY_MAX_POINTS = 480;

/** ========= HELPERS ========= */
function parseFunctionValues(valuesStr) {
  try { return JSON.parse(valuesStr || "{}"); } catch { return {}; }
}
function scaleNormalize(value, meta) {
  if (!meta) return value;
  if (meta?.type === "Integer") {
    const conf = parseFunctionValues(meta.values);
    const scale = Number(conf.scale || 0);
    if (Number.isFinite(value) && Number.isFinite(scale) && scale > 0) {
      return value / Math.pow(10, scale);
    }
  }
  return value;
}
function unitFor(code) {
  const c = String(code || "").toLowerCase();
  if (c.includes("temp")) return "°C";
  if (c.includes("humid")) return "%";
  if (c.includes("batt")) return "%";
  return "";
}
function limitsFor(device) {
  return {
    temp: { ...DEFAULT_LIMITS.temp, ...(device?.limits?.temp || {}) },
    hum:  { ...DEFAULT_LIMITS.hum,  ...(device?.limits?.hum  || {}) },
  };
}
function outOfRange(val, min, max) {
  if (typeof val !== "number") return false;
  if (Number.isFinite(min) && val < min) return true;
  if (Number.isFinite(max) && val > max) return true;
  return false;
}
function csvFromHistory(name, arr) {
  const header = "time_iso,temp,hum";
  const lines = (arr || []).map(p => {
    const iso = new Date(p.t).toISOString();
    const t = (typeof p.temp === "number") ? p.temp.toFixed(2) : "";
    const h = (typeof p.hum === "number") ? p.hum.toFixed(0) : "";
    return `${iso},${t},${h}`;
  });
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(name || "device").replace(/\s+/g, "_")}_24h.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

async function getAccessToken() {
  const r = await fetch("/api/get-tuya-token"); 
  const j = await r.json();
  if (j?.success && j?.result?.access_token) return j.result.access_token;
  throw new Error("Falha ao obter access_token");
}

async function tuyaProxy({ token, tuyaPath, method = "GET", body = {} }) {
  const r = await fetch("/api/proxy", { 
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tuya-Method": method,
      "X-Tuya-Path": tuyaPath,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json();
  return { status: r.status, data: j };
}

function prefer(keys, statusArr) {
  const map = new Map((statusArr || []).map((s) => [s.code, s.value]));
  for (const k of keys) if (map.has(k)) return { code: k, value: map.get(k) };
  const list = (statusArr || []).map((s) => s.code.toLowerCase());
  for (const k of keys) {
    const hit = list.find((x) => x.includes(k.replace(/_/g, "")));
    if (hit) {
      const found = (statusArr || []).find((s) => s.code.toLowerCase() === hit);
      if (found) return { code: found.code, value: found.value };
    }
  }
  return null;
}
function loadHistory(deviceId) {
  // Esta função SÓ é chamada no navegador (cliente), então é segura
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(`history:${deviceId}`) || "[]"); }
  catch { return []; }
}
function saveHistory(deviceId, arr) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`history:${deviceId}`, JSON.stringify(arr)); } catch {}
}

/** ========= UI ========= */
function Badge({ type = "loading", children }) {
  const base = {
    padding: "4px 8px",
    fontSize: 12,
    borderRadius: 8,
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid",
    gap: 6,
  };
  const palette =
    type === "ok" ? { background: "#E8F5E9", color: "#2E7D32", borderColor: "#C8E6C9" } :
    type === "error" ? { background: "#FFEBEE", color: "#C62828", borderColor: "#FFCDD2" } :
    type === "warn" ? { background: "#FFF8E1", color: "#EF6C00", borderColor: "#FFE0B2" } :
                      { background: "#E3F2FD", color: "#1565C0", borderColor: "#BBDEFB" };
  return <span style={{ ...base, ...palette }}>{children}</span>;
}
function Card({ title, value, unit, meta, loading, footer }) {
  const box = {
    borderRadius: 16,
    border: "1px solid #eee",
    background: "#fff",
    boxShadow: "0 4px 10px rgba(0,0,0,0.05)",
    padding: 16,
  };
  const titleCss = { fontSize: 12, color: "#6b7280" };
  const valueCss = { fontSize: 28, fontWeight: 600, marginTop: 4 };
  const metaCss = { fontSize: 11, color: "#9ca3af", marginTop: 6 };
  return (
    <div style={box}>
      <div style={titleCss}>{title}</div>
      <div style={valueCss}>
        {loading ? "—" : value}{unit ? ` ${unit}` : ""}
      </div>
      {meta ? <div style={metaCss}>{meta}</div> : null}
      {footer}
    </div>
  );
}
function Sparkline({ values = [], stroke = "#0ea5e9" }) {
  const W = 220, H = 48, P = 6;
  if (!values.length) return <div style={{ height: H }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rng = max - min || 1;
  const step = (W - P * 2) / Math.max(1, values.length - 1);
  const points = values.map((v, i) => {
    const x = P + i * step;
    const y = P + (H - P * 2) * (1 - (v - min) / rng);
    return `${x},${y}`;
  });
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <polyline fill="none" stroke={stroke} strokeWidth={2} points={points.join(" ")} />
    </svg>
  );
}

/** ========= PÁGINA ========= */
export default function TuyaMultiEnvDashboard() {
  const [token, setToken] = useState(null);
  const [refreshSec, setRefreshSec] = useState(DEFAULT_REFRESH_SECONDS);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [onlyOffline, setOnlyOffline] = useState(false);
  const [onlyAlert, setOnlyAlert] = useState(false);

  const [items, setItems] = useState(() =>
    DEVICES.map((d) => ({
      id: d.id,
      name: d.name,
      status: [],
      functions: null,
      online: null,
      loading: true,
      ok: false,
      err: "",
    }))
  );

  // --- ESTA É A CORREÇÃO ---
  // Inicia o histórico como um objeto vazio
  const [history, setHistory] = useState({});
  
  // Este hook roda APENAS no navegador (cliente), DEPOIS que a página carrega.
  // Ele vai carregar o histórico do localStorage de forma segura.
  useEffect(() => {
    const initialHistory = {};
    DEVICES.forEach((d) => (initialHistory[d.id] = loadHistory(d.id)));
    setHistory(initialHistory);
  }, []);
  // -------------------------

  const timerRef = useRef(null);

  async function ensureToken() {
    if (token) return token;
    const t = await getAccessToken();
    setToken(t);
    return t;
  }

  async function fetchOne(deviceId, currentToken) {
    // status
    let { data: s } = await tuyaProxy({
      token: currentToken,
      tuyaPath: `/v1.0/devices/${deviceId}/status`,
      method: "GET",
    });
    // token expirado → renova e re-tenta
    if (s?.code === 1010 || s?.msg === "token invalid") {
      const newTk = await getAccessToken();
      setToken(newTk);
      ({ data: s } = await tuyaProxy({
        token: newTk,
        tuyaPath: `/v1.0/devices/${deviceId}/status`,
        method: "GET",
      }));
    }
    if (!s?.success) throw new Error(s?.msg || "Falha ao obter status");

    // functions
    const { data: f } = await tuyaProxy({
      token: token || (await ensureToken()),
      tuyaPath: `/v1.0/devices/${deviceId}/functions`,
      method: "GET",
    });

    // info (online/offline)
    const { data: info } = await tuyaProxy({
      token: token || (await ensureToken()),
      tuyaPath: `/v1.0/devices/${deviceId}`,
      method: "GET",
    });

    return {
      status: Array.isArray(s.result) ? s.result : [],
      functions: f?.result || {},
      online: info?.result?.online ?? null,
    };
  }

  function pushHistory(deviceId, { temp, hum, t }) {
    const now = t || Date.now();
    setHistory((prev) => {
      const list = [...(prev[deviceId] || []), { t: now, temp, hum }];
      const cutoff = now - HISTORY_WINDOW_MS;
      const trimmed = list.filter((p) => p.t >= cutoff).slice(-HISTORY_MAX_POINTS);
      saveHistory(deviceId, trimmed);
      return { ...prev, [deviceId]: trimmed };
    });
  }

  async function loadAll() {
    setError("");
    try {
      const tk = await ensureToken();
      const results = await Promise.all(
        DEVICES.map(async (d) => {
          try {
            const r = await fetchOne(d.id, tk);
            return { id: d.id, ok: true, ...r };
          } catch (e) {
            return { id: d.id, ok: false, err: e?.message || String(e) };
          }
        })
      );

      setItems((prev) =>
        prev.map((p) => {
          const found = results.find((r) => r.id === p.id);
          if (!found) return p;
          return {
            ...p,
            status: found.status || [],
            functions: found.functions || null,
            online: found.online,
            loading: false,
            ok: !!found.ok,
            err: found.err || "",
          };
        })
      );

      // atualizar histórico (apenas online)
      const now = Date.now();
      results.forEach((res) => {
        if (!res?.ok || res?.online === false) return;
        const fnMap = new Map((res.functions?.functions || []).map((f) => [f.code, f]));
        const tempPref = ["va_temperature", "temp_current", "temperature", "temp_value", "temp_set"];
        const humPref  = ["va_humidity", "humidity_value", "humidity"];
        const tSel = prefer(tempPref, res.status);
        const hSel = prefer(humPref,  res.status);
        const tMeta = tSel ? fnMap.get(tSel.code) : null;
        const hMeta = hSel ? fnMap.get(hSel.code) : null;
        const tVal = tSel ? scaleNormalize(tSel.value, tMeta) : null;
        const hVal = hSel ? scaleNormalize(hSel.value, hMeta) : null;
        if (typeof tVal === "number" || typeof hVal === "number") {
          pushHistory(res.id, { t: now, temp: typeof tVal === "number" ? tVal : null, hum: typeof hVal === "number" ? hVal : null });
        }
      });

      setLastUpdated(new Date());
    } catch (e) {
      setError(e?.message || String(e));
    }
  }

  useEffect(() => {
    loadAll();
    return () => timerRef.current && clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (refreshSec > 0) timerRef.current = setInterval(loadAll, refreshSec * 1000);
    return () => timerRef.current && clearInterval(timerRef.current);
  }, [refreshSec]);

  /** ======== cálculo de métricas p/ ordenar/filtrar ======== */
  function metricsFor(devMeta) {
    const deviceCfg = DEVICES.find(d => d.id === devMeta.id) || {};
    const lim = limitsFor(deviceCfg);
    const fnMap = new Map((devMeta.functions?.functions || []).map((f) => [f.code, f]));
    const tempPref = ["va_temperature", "temp_current", "temperature", "temp_value", "temp_set"];
    const humPref  = ["va_humidity", "humidity_value", "humidity"];
    const batPref  = ["battery_percentage", "battery_value", "battery_state", "battery"];

    const tSel = prefer(tempPref, devMeta.status);
    const hSel = prefer(humPref,  devMeta.status);
    const bSel = prefer(batPref,  devMeta.status);

    const tMeta = tSel ? fnMap.get(tSel.code) : null;
    const hMeta = hSel ? fnMap.get(hSel.code) : null;

    let tVal = tSel ? scaleNormalize(tSel.value, tMeta) : null;
    let hVal = hSel ? scaleNormalize(hSel.value, hMeta) : null;
    let bVal = bSel ? bSel.value : null;

    if (typeof bVal === "string") {
      const map = { low: 20, medium: 50, high: 80, full: 100 };
      bVal = map[bVal.toLowerCase()] ?? bVal;
    }
    if (typeof bVal === "number") bVal = Math.max(0, Math.min(100, bVal));

    const tempAlert  = outOfRange(tVal, lim.temp.min, lim.temp.max);
    const humAlert   = outOfRange(hVal, lim.hum.min,  lim.hum.max);
    const lowBattery = typeof bVal === "number" && bVal < 20;

    return { tVal, hVal, bVal, tempAlert, humAlert, lowBattery, limits: lim };
  }

  /** ======== busca + filtros + ordenação ======== */
  const visibleItems = useMemo(() => {
    let arr = items.filter((d) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q);
    });

    if (onlyOffline || onlyAlert) {
      arr = arr.filter((d) => {
        const m = metricsFor(d);
        const isAlert = m.tempAlert || m.humAlert || m.lowBattery;
        const isOffline = d.online === false;
        if (onlyOffline && onlyAlert) return isOffline || isAlert;
        if (onlyOffline) return isOffline;
        if (onlyAlert) return isAlert;
        return true;
      });
    }

    const withMetrics = arr.map((d) => ({ d, m: metricsFor(d) }));
    withMetrics.sort((A, B) => {
      const a = A.d, b = B.d;
      const ma = A.m, mb = B.m;

      let va, vb;
      switch (sortKey) {
        case "temp": va = ma.tVal ?? -Infinity; vb = mb.tVal ?? -Infinity; break;
        case "hum":  va = ma.hVal ?? -Infinity; vb = mb.hVal ?? -Infinity; break;
        case "batt": va = ma.bVal ?? -Infinity; vb = mb.bVal ?? -Infinity; break;
        default:     va = a.name.toLowerCase(); vb = b.name.toLowerCase();
      }
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return withMetrics.map(({ d }) => d);
  }, [items, query, onlyOffline, onlyAlert, sortKey, sortDir]);

  /** ======== render de card ======== */
  function renderDevice(devMeta) {
    const deviceCfg = DEVICES.find(d => d.id === devMeta.id) || {};
    const { tVal, hVal, bVal, tempAlert, humAlert, lowBattery, limits } = metricsFor(devMeta);

    const cardBorder =
      devMeta.online === false ? "1px solid #FCA5A5" :
      tempAlert || humAlert     ? "1px solid #F59E0B" :
      lowBattery             ? "1px solid #FCA5A5" : "1px solid #eee";

    const opacityOffline = devMeta.online === false ? 0.7 : 1;

    const wrapper = { borderRadius: 16, border: cardBorder, background: "#fff", padding: 16, boxShadow: "0 4px 10px rgba(0,0,0,0.05)", opacity: opacityOffline };
    const top = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" };
    const idCss = { fontSize: 12, color: "#6b7280" };
    const nameCss = { fontSize: 16, fontWeight: 600 };
    const grid = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 };

    const hist = history[devMeta.id] || [];
    const tempSeries = hist.map(p => (typeof p.temp === "number" ? p.temp : null)).filter(x => x !== null);
    const humSeries  = hist.map(p => (typeof p.hum  === "number" ? p.hum  : null)).filter(x => x !== null);

    return (
      <div key={devMeta.id} style={wrapper}>
        <div style={top}>
          <div>
            <div style={idCss}>{devMeta.id}</div>
            <div style={nameCss}>{devMeta.name}</div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {devMeta.online === false && <Badge type="error">Offline</Badge>}
            {tempAlert && <Badge type="warn">Temp fora ({limits.temp.min}–{limits.temp.max}°C)</Badge>}
            {humAlert && <Badge type="warn">Umidade fora ({limits.hum.min}–{limits.hum.max}%)</Badge>}
            {lowBattery && <Badge type="error">Bateria baixa</Badge>}
            {devMeta.loading ? <Badge>Carregando…</Badge> : devMeta.ok ? <Badge type="ok">OK</Badge> : <Badge type="error">Erro</Badge>}
          </div>
        </div>

        <div style={grid}>
          <Card
            title="Temperatura"
            value={devMeta.loading ? "—" : (typeof tVal === "number" ? tVal.toFixed(1) : tVal ?? "—")}
            unit="°C"
            meta={`Limites: ${limits.temp.min}–${limits.temp.max}°C`}
            loading={devMeta.loading}
            footer={<Sparkline values={tempSeries} stroke="#0ea5e9" />}
          />
          <Card
            title="Umidade"
            value={devMeta.loading ? "—" : (typeof hVal === "number" ? hVal.toFixed(0) : hVal ?? "—")}
            unit="%"
            meta={`Limites: ${limits.hum.min}–${limits.hum.max}%`}
            loading={devMeta.loading}
            footer={<Sparkline values={humSeries} stroke="#10b981" />}
          />
          <Card
            title="Bateria"
            value={devMeta.loading ? "—" : (typeof bVal === "number" ? `${bVal}` : String(bVal ?? "—"))}
            unit="%"
            loading={devMeta.loading}
          />
        </div>

        {!devMeta.ok && devMeta.err ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#C62828" }}>Erro: {devMeta.err}</div>
        ) : null}

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => csvFromHistory(devMeta.name, history[devMeta.id] || [])}
            style={{ padding: "8px 12px", borderRadius: 12, border: "1px solid #e5e7eb", background: "#111827", color: "#fff", cursor: "pointer" }}
          >
            Exportar CSV (24h)
          </button>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "#6b7280" }}>Debug (status & functions)</summary>
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#F9FAFB", padding: 12, borderRadius: 8, border: "1px solid #eee", fontSize: 12, color: "#374151" }}>
{JSON.stringify({ status: devMeta.status, functions: devMeta.functions }, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    );
  }

  // layout
  const page = { minHeight: "100vh", background: "linear-gradient(135deg, #f8fafc, #eef2f7)", color: "#111827" };
  const container = { maxWidth: 1200, margin: "0 auto", padding: 24 };
  const header = { display: "flex", gap: 16, alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap" };
  const gridAll = { display: "grid", gridTemplateColumns: "1fr", gap: 20 }; // Padrão 1 coluna
  const input = { padding: "8px 12px", borderRadius: 12, border: "1px solid #ddd", minWidth: 220 };
  const selectCss = { padding: "8px 12px", borderRadius: 12, border: "1px solid #ddd" };
  const btn = { padding: "8px 16px", borderRadius: 16, background: "#111827", color: "#fff", border: "none", cursor: "pointer" };
  const checkbox = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151" };

  const responsiveStyle = `
    @media (min-width: 1024px) {
      .main-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `;

  return (
    <div style={page}>
      <style>{responsiveStyle}</style>
      <div style={container}>
        <div style={header}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Painel – Temperatura, Umidade e Bateria</h1>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Busca • Ordenar • Filtros • Histórico 24h • CSV • Token/Proxy automáticos
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input
              placeholder="Buscar por nome ou ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={input}
            />
            <select style={selectCss} value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="name">Ordenar: Nome</option>
              <option value="temp">Ordenar: Temperatura</option>
              <option value="hum">Ordenar: Umidade</option>
              <option value="batt">Ordenar: Bateria</option>
            </select>
            <select style={selectCss} value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
              <option value="asc">Ascendente</option>
              <option value="desc">Descendente</option>
            </select>
            <label style={checkbox}>
              <input type="checkbox" checked={onlyOffline} onChange={(e) => setOnlyOffline(e.target.checked)} />
              Somente offline
            </label>
            <label style={checkbox}>
              <input type="checkbox" checked={onlyAlert} onChange={(e) => setOnlyAlert(e.target.checked)} />
              Somente com alerta
            </label>
            <select style={selectCss} value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))}>
              <option value={0}>Atualização: Manual</option>
              <option value={15}>Atualização: 15s</option>
              <option value={30}>Atualização: 30s</option>
              <option value={60}>Atualização: 60s</option>
              <option value={120}>Atualização: 2m</option>
              <option value={300}>Atualização: 5m</option>
            </select>
            <button onClick={loadAll} style={btn}>Atualizar</button>
          </div>
        </div>

        {error ? (
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 12, background: "#FFEBEE", color: "#C62828", border: "1px solid #FFCDD2", fontSize: 14 }}>
            Erro global: {error}
          </div>
        ) : null}

        <div style={gridAll} className="main-grid">
            {visibleItems.map((d) => renderDevice(d))}
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "#6b7280", display: "flex", gap: 8 }}>
          <span>Última atualização: {lastUpdated ? lastUpdated.toLocaleString() : "—"}</span>
          <span>•</span>
          <span>Token renova automaticamente ao receber 1010.</span>
        </div>
      </div>
    </div>
  );
}
