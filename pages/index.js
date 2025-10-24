// /pages/index.js
// --- CÓDIGO REVISADO (v7) ---
// Garantindo a sintaxe correta

import React, { useEffect, useMemo, useRef, useState } from "react";

/** ========= CONFIG ========= */
const DEVICES = [
  { id: "eb4834395c8fbc4dfefpe9", name: "Sala-CW" },
  { id: "eb13a02df36c15cc0czqmm", name: "Sala 3-2SS" },
  { id: "eb08f82b6ddb5a1699dced", name: "Sala 2-DAY" },
  // Adicione mais dispositivos aqui se precisar, copiando o formato { id: "...", name: "..." },
];

const DEFAULT_REFRESH_SECONDS = 300; // 5 minutos
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const HISTORY_MAX_POINTS = 480;      // segurança

/** ========= HELPERS (LÓGICA - NÃO MEXER) ========= */
function parseFunctionValues(valuesStr) {
  try { return JSON.parse(valuesStr || "{}"); } catch { return {}; }
}
function scaleNormalize(value, meta) {
  if (!meta) return value;
  if (meta?.type === "Integer") {
    let conf = {};
    if (typeof meta.values === 'string') {
        try { conf = JSON.parse(meta.values || "{}"); } catch { conf = {}; }
    } else if (typeof meta.values === 'object' && meta.values !== null) {
        conf = meta.values;
    }
    const scale = Number(conf.scale || 0);
    if (Number.isFinite(value) && Number.isFinite(scale) && scale > 0) {
      return value / Math.pow(10, scale);
    }
  }
  return value;
}
async function getAccessToken() {
  const r = await fetch("/api/get-tuya-token");
  const j = await r.json();
  if (j?.success && j?.result?.access_token) return j.result.access_token;
  throw new Error(j?.msg || "Falha ao obter access_token");
}
async function tuyaProxy({ token, tuyaPath, method = "GET", body = {} }) {
  // ADICIONANDO REGRAS DE CORS AQUI (já que removemos o vercel.json)
  const responseHeaders = {
    'Access-Control-Allow-Origin': '*', // Permite qualquer origem
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tuya-Method, X-Tuya-Path',
  };

  // Responde ao Preflight OPTIONS
  if (method === 'OPTIONS_PREFLIGHT_FOR_PROXY') {
      // Nota: Esta condição especial nunca será acionada pelo fetch normal,
      // mas o código do handler em /api/proxy PRECISA ser atualizado
      // para lidar com o método OPTIONS real.
      // Esta função tuyaProxy agora retorna os headers CORS.
      return { status: 200, data: {}, headers: responseHeaders };
  }

  const r = await fetch("/api/proxy", {
    method: "POST", // A chamada para o proxy é sempre POST
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tuya-Method": method, // O método real para a Tuya
      "X-Tuya-Path": tuyaPath,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json();

  // Adiciona cabeçalhos CORS à resposta final
  const finalHeaders = { ...responseHeaders };
  // Copia outros cabeçalhos relevantes se necessário (ex: Content-Type)
  if (r.headers.has('content-type')) {
      finalHeaders['Content-Type'] = r.headers.get('content-type');
  }

  return { status: r.status, data: j, headers: finalHeaders };
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
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(`history:${deviceId}`) || "[]"); }
  catch { return []; }
}
function saveHistory(deviceId, arr) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`history:${deviceId}`, JSON.stringify(arr)); } catch {}
}

/** ========= ESTILOS (CSS-in-JS) ========= */
const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    backgroundColor: "#f0f2f5",
    margin: 0,
    padding: "20px",
    minHeight: "100vh",
  },
  header: {
    textAlign: "center",
    color: "#1c1e21",
    width: "100%",
    marginBottom: "20px"
  },
  container: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "20px",
    maxWidth: 1400,
    margin: "0 auto",
  },
  card: {
    backgroundColor: "white",
    borderRadius: "8px",
    boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
    padding: "20px",
    minWidth: "260px",
    textAlign: "center",
    transition: "transform 0.2s, opacity 0.2s",
    opacity: 1,
  },
  cardOffline: {
    opacity: 0.6,
  },
  cardTitle: {
    marginTop: 0,
    color: "#05386b",
    fontSize: "1.5em",
    fontWeight: 600,
    marginBottom: "20px",
  },
  data: {
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    margin: "20px 0",
    color: "#333",
    flexWrap: "wrap",
    gap: "16px",
  },
  dataPoint: {
    fontSize: "2em",
  },
  dataUnit: {
    fontSize: "0.5em",
    color: "#666",
    verticalAlign: "super",
  },
  battery: {
    fontSize: "1em",
    color: "#555",
    marginTop: "15px",
  },
  statusBanner: {
    marginTop: "15px",
    padding: "10px",
    borderRadius: "5px",
    color: "white",
    fontWeight: "bold",
  },
  statusLoading: {
    background: "#ff9800", // Laranja
  },
  statusOk: {
    background: "#4CAF50", // Verde
  },
  statusError: {
    background: "#f44336", // Vermelho
  },
  globalError: {
    color: "#f44336",
    fontWeight: "bold",
    marginTop: 20,
    minHeight: 20,
    textAlign: "center",
    width: "100%",
  },
};

/** ========= COMPONENTE DE GRÁFICO ========= */
function Sparkline({ values = [], stroke = "#0ea5e9", width = 220, height = 48 }) {
  const W = width, H = height, P = 6;
  if (!values.length || values.length < 2) return (
    <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 14, background: '#fafafa', borderRadius: 8 }}>
      Sem dados de histórico suficientes
    </div>
  );
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
    <svg width={W} height={H} style={{ display: "block", margin: '0 auto' }}>
      <polyline fill="none" stroke={stroke} strokeWidth={2} points={points.join(" ")} />
    </svg>
  );
}

/** ========= COMPONENTE DO MODAL ========= */
function HistoryModal({ device, historyData, onClose }) {
  const modalOverlay = {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };
  const modalContent = {
    background: 'white',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
    minWidth: '500px',
    maxWidth: '90%',
  };
  const modalHeader = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #eee',
    paddingBottom: '12px',
    marginBottom: '20px',
  };
  const modalTitle = {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#111',
  };
  const closeButton = {
    background: '#eee',
    border: 'none',
    borderRadius: '50%',
    width: '32px',
    height: '32px',
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: '30px',
    textAlign: 'center',
  };
  const chartLabel = {
    fontSize: '0.9rem',
    color: '#555',
    marginBottom: '8px',
  };

  const tempSeries = historyData.map(p => (typeof p.temp === "number" ? p.temp : null)).filter(x => x !== null);
  const humSeries  = historyData.map(p => (typeof p.hum  === "number" ? p.hum  : null)).filter(x => x !== null);

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={modalTitle}>Histórico 24h: {device.name}</div>
          <button style={closeButton} onClick={onClose}>&times;</button>
        </div>

        <div style={chartLabel}>Temperatura (°C) - (Últimas 24h)</div>
        <Sparkline values={tempSeries} stroke="#0ea5e9" width={450} height={80} />

        <div style={{...chartLabel, marginTop: '20px'}}>Umidade (%) - (Últimas 24h)</div>
        <Sparkline values={humSeries} stroke="#10b981" width={450} height={80} />
      </div>
    </div>
  );
}

/** ========= COMPONENTE DO CARD ========= */
function DeviceCard({ devMeta, onTempClick }) {
  const {
    tVal, hVal, bVal,
    tempAlert, humAlert, lowBattery
  } = devMeta.metrics;

  const isLoading = devMeta.loading;
  const isOffline = devMeta.online === false;
  const isError = !devMeta.ok || isOffline;
  const hasAlert = !isError && (tempAlert || humAlert || lowBattery);

  let statusText = "A carregar...";
  let statusStyle = {...styles.statusBanner, ...styles.statusLoading};

  if (!isLoading) {
    if (isError) {
      statusText = isOffline ? "Status: Offline" : "Status: Erro";
      statusStyle = {...styles.statusBanner, ...styles.statusError};
    } else if (hasAlert) {
      statusText = "Status: Alerta";
      statusStyle = {...styles.statusBanner, ...styles.statusError};
    } else {
      statusText = "Status: OK";
      statusStyle = {...styles.statusBanner, ...styles.statusOk};
    }
  }

  const tempStr = isLoading ? "--" : (typeof tVal === "number" ? tVal.toFixed(1) : "--");
  const humStr = isLoading ? "--" : (typeof hVal === "number" ? hVal.toFixed(0) : "--");
  const batStr = isLoading ? "--" : (typeof bVal === "number" ? bVal : "--");

  let cardStyle = {...styles.card};
  if (isOffline) {
    cardStyle = {...cardStyle, ...styles.cardOffline};
  }

  return (
    <div style={cardStyle}>
      <h2 style={styles.cardTitle}>{devMeta.name}</h2>
      <div style={styles.data}>
        <div
          style={{...styles.dataPoint, cursor: 'pointer'}}
          onClick={onTempClick}
          title="Ver histórico 24h"
        >
          {tempStr}<span style={styles.dataUnit}>°C</span>
        </div>
        <div style={styles.dataPoint}>
          {humStr}<span style={styles.dataUnit}>%</span>
        </div>
      </div>
      <div style={styles.battery}>🔋 {batStr}%</div>
      <div style={statusStyle}>{statusText}</div>
    </div>
  );
}

/** ========= PÁGINA PRINCIPAL ========= */
export default function TuyaMultiEnvDashboard() {
  const [token, setToken] = useState(null);
  const [refreshSec, setRefreshSec] = useState(DEFAULT_REFRESH_SECONDS);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const [modalDevice, setModalDevice] = useState(null);

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

  const [history, setHistory] = useState({});
  useEffect(() => {
    const initialHistory = {};
    DEVICES.forEach((d) => (initialHistory[d.id] = loadHistory(d.id)));
    setHistory(initialHistory);
  }, []);

  const timerRef = useRef(null);

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
    });
    // token expirado → renova e re-tenta
    if (s?.code === 1010 || s?.msg === "token invalid") {
      const newTk = await getAccessToken();
      setToken(newTk);
      ({ data: s } = await tuyaProxy({
        token: newTk,
        tuyaPath: `/v1.0/devices/${deviceId}/status`,
      }));
    }
    if (!s?.success) throw new Error(s?.msg || "Falha ao obter status");

    // functions
    const { data: f } = await tuyaProxy({
      token: token || (await ensureToken()),
      tuyaPath: `/v1.0/devices/${deviceId}/functions`,
    });

    // info (online/offline)
    const { data: info } = await tuyaProxy({
      token: token || (await ensureToken()),
      tuyaPath: `/v1.0/devices/${deviceId}`,
    });

    return {
      status: Array.isArray(s.result) ? s.result : [],
      functions: f?.result || {},
      online: info?.result?.online ?? null,
    };
  }

  async function loadAll() {
    setError("");
    try {
      const tk = await ensureToken();
      const results = await Promise.all(
        DEVICES.map(async (d) => {
          if (d.id.startsWith("COLE_O_ID_")) {
            return { id: d.id, ok: false, err: "ID não configurado", name: d.name };
          }
          try {
            const r = await fetchOne(d.id, tk);
            return { id: d.id, ok: true, name: d.name, ...r };
          } catch (e) {
            return { id: d.id, ok: false, err: e?.message || String(e), name: d.name };
          }
        })
      );

      setItems((prev) =>
        prev.map((p) => {
          const found = results.find((r) => r.id === p.id);
          if (!found) return { ...p, name: p.name || `Device ${p.id}` }; // Ensure name exists
          return {
            ...p,
            name: found.name || `Device ${p.id}`, // Ensure name exists
            status: found.status || [],
            functions: found.functions || null,
            online: found.online,
            loading: false,
            ok: !!found.ok,
            err: found.err || "",
          };
        })
      );

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

          let tVal = tSel ? scaleNormalize(tSel.value, tMeta) : null;
          let hVal = hSel ? scaleNormalize(hSel.value, hMeta) : null;

          if (tSel && (tSel.code === 'va_temperature' || tSel.code === 'temp_current') && tVal === tSel.value && Math.abs(tVal) > 100) {
             tVal = tVal / 10.0;
          }

          if (typeof tVal === "number" || typeof hVal === "number") {
            pushHistory(res.id, { t: now, temp: typeof tVal === "number" ? tVal : null, hum: typeof hVal === "number" ? hVal : null });
          }
      });

      setLastUpdated(new Date());
    } catch (e) {
      setError(String(e));
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

  // Pré-calcula métricas para todos os itens
  const itemsWithMetrics = useMemo(() => {
    return items.map(devMeta => {
      // Garante que devMeta.functions existe e é um objeto antes de tentar mapear
      const functionsArray = devMeta.functions?.functions || [];
      const fnMap = new Map(functionsArray.map((f) => [f.code, f]));
      
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

      if (tSel && (tSel.code === 'va_temperature' || tSel.code === 'temp_current') && tVal === tSel.value && Math.abs(tVal) > 100) {
         tVal = tVal / 10.0;
      }

      if (typeof bVal === "string") {
        const map = { low: 20, medium: 50, high: 80, full: 100 };
        bVal = map[bVal.toLowerCase()] ?? bVal;
      }
      if (typeof bVal === "number") bVal = Math.max(0, Math.min(100, bVal));

      const tempAlert  = false;
      const humAlert   = false;
      const lowBattery = typeof bVal === "number" && bVal < 20;

      return { ...devMeta, metrics: { tVal, hVal, bVal, tempAlert, humAlert, lowBattery } };
    });
  }, [items]);


  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={{ fontSize: "2.5em", margin: 0 }}>Painel de Monitoramento (Versão Final)</h1>
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Última atualização: {lastUpdated ? lastUpdated.toLocaleString() : "—"}
          (Auto-refresh:
          <select
             value={refreshSec}
             onChange={(e) => setRefreshSec(Number(e.target.value))}
             style={{ marginLeft: 5, fontSize: 12, border: 'none', background: 'transparent' }}
          >
            <option value={0}>Manual</option>
            <option value={300}>5m</option>
            <option value={600}>10m</option>
            <option value={1800}>30m</option>
          </select>
          )
          <button onClick={loadAll} style={{ marginLeft: 10, padding: "4px 8px", fontSize: 12, cursor: 'pointer' }}>Atualizar Agora</button>
        </div>
      </div>

      {error && (
        <p style={styles.globalError}>Erro Global: {error}</p>
      )}

      <div style={styles.container}>
        {itemsWithMetrics.map((d) => (
          <DeviceCard
             key={d.id}
             devMeta={d}
             onTempClick={() => {
                 if (!d.id.startsWith("COLE_O_ID_")) { // Só abre se o ID for real
                     setModalDevice(d);
                 }
             }}
          />
        ))}
      </div>

      {modalDevice && (
        <HistoryModal
          device={modalDevice}
          historyData={history[modalDevice.id] || []}
          onClose={() => setModalDevice(null)}
        />
      )}
    </div>
  );
}
