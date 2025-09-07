import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  ComposedChart,
  ReferenceArea,
  BarChart,
  Bar
} from "recharts";

// ---------- Helpers ----------
function formatNumber(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "k";
  return n.toFixed(2);
}

// Safer CSV → JSON
function csvToJson(text) {
  const clean = (text || "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((ln) => ln.trim().length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line) => {
    const result = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result.map((s) => s.trim());
  };

  const headers = parseLine(lines.shift());
  return lines.map((line) => {
    const cells = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i] : ""; });
    return obj;
  });
}

// Safer JSON → CSV
function jsonToCsv(arr) {
  if (!arr || arr.length === 0) return "";
  const headers = Object.keys(arr[0]);
  const escapeCell = (val) => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const headerLine = headers.map(escapeCell).join(",");
  const body = arr.map((row) => headers.map((h) => escapeCell(row[h])).join(",")).join("\n");
  return headerLine + "\n" + body;
}

function saveFile(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);
  return [value, setValue];
}

// Least squares quadratic fit: y = a + b*x + c*x^2
function quadraticFit(xs, ys) {
  const n = xs.length;
  if (n < 3) return { a: 0, b: 0, c: 0 };
  let Sx = 0, Sx2 = 0, Sx3 = 0, Sx4 = 0, Sy = 0, Sxy = 0, Sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = Number(xs[i]);
    const y = Number(ys[i]);
    const x2 = x * x;
    Sx += x;
    Sx2 += x2;
    Sx3 += x2 * x;
    Sx4 += x2 * x2;
    Sy += y;
    Sxy += x * y;
    Sx2y += x2 * y;
  }
  const det = (m) =>
    m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) -
    m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) +
    m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const M  = [[n, Sx, Sx2],[Sx, Sx2, Sx3],[Sx2, Sx3, Sx4]];
  const My = [[Sy, Sx, Sx2],[Sxy, Sx2, Sx3],[Sx2y, Sx3, Sx4]];
  const Mb = [[n, Sy, Sx2],[Sx, Sxy, Sx3],[Sx2, Sx2y, Sx4]];
  const Mc = [[n, Sx, Sy],[Sx, Sx2, Sxy],[Sx2, Sx3, Sx2y]];
  const D = det(M);
  if (Math.abs(D) < 1e-12) return { a: 0, b: 0, c: 0 };
  const a = det(My) / D, b = det(Mb) / D, c = det(Mc) / D;
  return { a, b, c };
}

// ---------- Default Indian ETS (CCTS-adjacent) sectors ----------
const DEFAULT_SECTORS = [
  "Power",
  "Iron & Steel",
  "Cement",
  "Fertilizer",
  "Refineries",
  "Petrochemicals",
  "Aluminium",
  "Pulp & Paper",
  "Textiles",
];

// Baselines (cooked, editable)
const DEFAULT_BASELINES = {
  "Power": { production_label: "MWh", annual_production: 120000000, annual_emissions: 340000000 },
  "Iron & Steel": { production_label: "t crude steel", annual_production: 120000000, annual_emissions: 310000000 },
  "Cement": { production_label: "t cement", annual_production: 350000000, annual_emissions: 210000000 },
  "Fertilizer": { production_label: "t urea", annual_production: 30000000, annual_emissions: 40000000 },
  "Refineries": { production_label: "t throughput", annual_production: 250000000, annual_emissions: 70000000 },
  "Petrochemicals": { production_label: "t products", annual_production: 40000000, annual_emissions: 50000000 },
  "Aluminium": { production_label: "t aluminium", annual_production: 4000000, annual_emissions: 25000000 },
  "Pulp & Paper": { production_label: "t paper", annual_production: 20000000, annual_emissions: 12000000 },
  "Textiles": { production_label: "t fabric equiv.", annual_production: 10000000, annual_emissions: 8000000 },
};

// Measures (cooked but plausible). cost_per_tco2 in ₹/tCO2, abatement in tCO2/year
const DEFAULT_MEASURES = [
  // Power
  { id: 1, name: "Boiler & Turbine Efficiency Upgrade", sector: "Power", abatement_tco2: 12000000, cost_per_tco2: 300, selected: true },
  { id: 2, name: "Auxiliary Power Reduction & VFDs", sector: "Power", abatement_tco2: 6000000, cost_per_tco2: -150, selected: true },
  { id: 3, name: "Waste Heat to Power in CPPs", sector: "Power", abatement_tco2: 3000000, cost_per_tco2: 800, selected: true },
  { id: 4, name: "Coal Drying & Mill Optimization", sector: "Power", abatement_tco2: 5000000, cost_per_tco2: 100, selected: true },

  // Iron & Steel
  { id: 101, name: "Top Gas Recovery Turbines", sector: "Iron & Steel", abatement_tco2: 8000000, cost_per_tco2: 200, selected: true },
  { id: 102, name: "Coke Dry Quenching", sector: "Iron & Steel", abatement_tco2: 5000000, cost_per_tco2: 400, selected: true },
  { id: 103, name: "EAF Scrap Charge Increase", sector: "Iron & Steel", abatement_tco2: 6000000, cost_per_tco2: -250, selected: true },
  { id: 104, name: "BF/BOF Heat Recovery", sector: "Iron & Steel", abatement_tco2: 4000000, cost_per_tco2: 500, selected: true },

  // Cement
  { id: 201, name: "Clinker Factor Reduction (LC3/Blending)", sector: "Cement", abatement_tco2: 12000000, cost_per_tco2: -400, selected: true },
  { id: 202, name: "Waste Heat Recovery (Preheater/Grate)", sector: "Cement", abatement_tco2: 5000000, cost_per_tco2: 700, selected: true },
  { id: 203, name: "High-Efficiency Grinding (VRM/HPGR)", sector: "Cement", abatement_tco2: 3000000, cost_per_tco2: 100, selected: true },
  { id: 204, name: "Alternative Fuels & Raw Materials", sector: "Cement", abatement_tco2: 4000000, cost_per_tco2: 200, selected: true },

  // Fertilizer
  { id: 301, name: "Ammonia Synthesis Loop Optimization", sector: "Fertilizer", abatement_tco2: 2000000, cost_per_tco2: 500, selected: true },
  { id: 302, name: "Primary Reformer Heat Recovery", sector: "Fertilizer", abatement_tco2: 1500000, cost_per_tco2: 300, selected: true },
  { id: 303, name: "CO2 Capture for Urea Synthesis", sector: "Fertilizer", abatement_tco2: 1000000, cost_per_tco2: 1200, selected: true },

  // Refineries
  { id: 401, name: "Fired Heater Efficiency & APH", sector: "Refineries", abatement_tco2: 3000000, cost_per_tco2: 200, selected: true },
  { id: 402, name: "Steam Trap & Condensate Recovery", sector: "Refineries", abatement_tco2: 1000000, cost_per_tco2: -100, selected: true },
  { id: 403, name: "Hydrogen Network Optimization", sector: "Refineries", abatement_tco2: 1200000, cost_per_tco2: 900, selected: true },

  // Petrochemicals
  { id: 501, name: "Cracker Furnace Revamp", sector: "Petrochemicals", abatement_tco2: 1500000, cost_per_tco2: 600, selected: true },
  { id: 502, name: "Steam System Optimization", sector: "Petrochemicals", abatement_tco2: 800000, cost_per_tco2: 150, selected: true },
  { id: 503, name: "Solvent Recovery & Recycle", sector: "Petrochemicals", abatement_tco2: 500000, cost_per_tco2: -50, selected: true },

  // Aluminium
  { id: 601, name: "Anode Effect Reduction & Controls", sector: "Aluminium", abatement_tco2: 1000000, cost_per_tco2: 400, selected: true },
  { id: 602, name: "Point-Feed Alumina & Hooding", sector: "Aluminium", abatement_tco2: 700000, cost_per_tco2: 250, selected: true },
  { id: 603, name: "Inert Anodes (pilot)", sector: "Aluminium", abatement_tco2: 500000, cost_per_tco2: 2000, selected: true },

  // Pulp & Paper
  { id: 701, name: "Black Liquor Recovery Upgrade", sector: "Pulp & Paper", abatement_tco2: 800000, cost_per_tco2: 300, selected: true },
  { id: 702, name: "High-Consistency Presses", sector: "Pulp & Paper", abatement_tco2: 400000, cost_per_tco2: 100, selected: true },
  { id: 703, name: "Biomass Boiler Revamp", sector: "Pulp & Paper", abatement_tco2: 600000, cost_per_tco2: 500, selected: true },

  // Textiles
  { id: 801, name: "Low-liquor Dyeing & Heat Recovery", sector: "Textiles", abatement_tco2: 600000, cost_per_tco2: 50, selected: true },
  { id: 802, name: "Compressed Air Leak Management", sector: "Textiles", abatement_tco2: 300000, cost_per_tco2: -200, selected: true },
  { id: 803, name: "Boiler Condensate Recovery", sector: "Textiles", abatement_tco2: 200000, cost_per_tco2: 150, selected: true },
];

// Qualitative color palette for measures
const PALETTE = [
  "#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f",
  "#edc949","#af7aa1","#ff9da7","#9c755f","#bab0ab",
  "#2f4b7c","#ffa600","#a05195","#003f5c","#d45087",
];

function ColorLegend({ items }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs mt-2">
      {items.map((s) => (
        <div key={s.id} className="flex items-center gap-2">
          <span style={{ background: s.color, width: 12, height: 12, display: 'inline-block', borderRadius: 2 }} />
          <span>{s.name}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Measure Wizard (kept simple “as usual”) ----------
function MeasureWizard({ open, onClose, onSave, sectors, currency }) {
  const [tab, setTab] = useState("quick");
  const [q, setQ] = useState({ name: "New Measure", sector: sectors[0] || "Power", abatement_tco2: 0, cost_per_tco2: 0, selected: true });
  const [t, setT] = useState({
    project_name: "Intensive Measure",
    sector: sectors[0] || "Power",
    adoption_share: 1.0,
    baseline_activity: 1000000,
    intensity_before_kwh_per_unit: 100,
    intensity_after_kwh_per_unit: 80,
    elec_state: "India",
    grid_ef_t_per_mwh: 0.710,
    energy_price_per_kwh: 0.5,
    capex_total: 50000000,
    opex_delta_per_year: 0,
    lifetime_years: 10,
    discount_rate: 0.10,
    selected: true,
  });

  const calc = useMemo(() => {
    const act = Number(t.baseline_activity) * Math.max(0, Number(t.adoption_share));
    const dI_kwh = Math.max(0, Number(t.intensity_before_kwh_per_unit) - Number(t.intensity_after_kwh_per_unit));
    const abate_t = (act * dI_kwh * 1e-3) * Number(t.grid_ef_t_per_mwh);

    const af = annuityFactor(Number(t.discount_rate), Number(t.lifetime_years));
    const annualized_capex = Number(t.capex_total) * af;
    const energy_savings_kwh = act * dI_kwh;
    const energy_savings_value = energy_savings_kwh * Number(t.energy_price_per_kwh);
    const net_annual_cost = annualized_capex + Number(t.opex_delta_per_year) - energy_savings_value;
    const cost_per_t = abate_t > 0 ? net_annual_cost / abate_t : 0;

    return { abate_t, cost_per_t, annualized_capex, energy_savings_value, net_annual_cost };
  }, [t]);

  function annuityFactor(r, n) {
    const R = Number(r);
    const N = Number(n);
    if (!Number.isFinite(R) || !Number.isFinite(N) || N <= 0) return 0;
    if (Math.abs(R) < 1e-9) return 1 / N;
    return (R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
  }

  function saveQuick() {
    onSave({
      name: q.name,
      sector: q.sector,
      abatement_tco2: Number(q.abatement_tco2) || 0,
      cost_per_tco2: Number(q.cost_per_tco2) || 0,
      selected: !!q.selected,
      details: { mode: "quick" },
    });
  }

  function saveTemplate() {
    onSave({
      name: t.project_name,
      sector: t.sector,
      abatement_tco2: Math.max(0, calc.abate_t),
      cost_per_tco2: calc.cost_per_t,
      selected: !!t.selected,
      details: { mode: "template", inputs: t, derived: calc },
    });
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl shadow-xl border">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex gap-2">
            <button className={`px-3 py-1.5 rounded-xl border ${tab==='quick'?'bg-black text-white':''}`} onClick={()=>setTab('quick')}>Quick add</button>
            <button className={`px-3 py-1.5 rounded-xl border ${tab==='template'?'bg-black text-white':''}`} onClick={()=>setTab('template')}>Template</button>
          </div>
          <button className="px-3 py-1.5 rounded-xl border" onClick={onClose}>Close</button>
        </div>

        {tab === 'quick' && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">Project name<input className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.name} onChange={e=>setQ({...q,name:e.target.value})}/></label>
              <label className="text-sm">Sector<select className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.sector} onChange={e=>setQ({...q,sector:e.target.value})}>{DEFAULT_SECTORS.map(s=> <option key={s}>{s}</option>)}</select></label>
              <label className="text-sm">Abatement (tCO₂/yr)<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.abatement_tco2} onChange={e=>setQ({...q,abatement_tco2:Number(e.target.value)})}/></label>
              <label className="text-sm">Cost ({currency}/tCO₂)<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.cost_per_tco2} onChange={e=>setQ({...q,cost_per_tco2:Number(e.target.value)})}/></label>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.selected} onChange={e=>setQ({...q,selected:e.target.checked})}/> Use in MACC</label>
              <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={saveQuick}>Save measure</button>
            </div>
          </div>
        )}

        {tab === 'template' && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">Project name<input className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.project_name} onChange={e=>setT({...t,project_name:e.target.value})}/></label>
              <label className="text-sm">Sector<select className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.sector} onChange={e=>setT({...t,sector:e.target.value})}>{DEFAULT_SECTORS.map(s=> <option key={s}>{s}</option>)}</select></label>

              <label className="text-sm">Adoption share (0–1)<input type="number" step="0.01" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.adoption_share} onChange={e=>setT({...t,adoption_share:Number(e.target.value)})}/></label>
              <label className="text-sm">Baseline activity (units/yr)<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.baseline_activity} onChange={e=>setT({...t,baseline_activity:Number(e.target.value)})}/></label>

              <label className="text-sm">Intensity before (kWh/unit)<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.intensity_before_kwh_per_unit} onChange={e=>setT({...t,intensity_before_kwh_per_unit:Number(e.target.value)})}/></label>
              <label className="text-sm">Intensity after (kWh/unit)<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.intensity_after_kwh_per_unit} onChange={e=>setT({...t,intensity_after_kwh_per_unit:Number(e.target.value)})}/></label>

              <label className="text-sm">Grid EF (tCO₂/MWh)<input type="number" step="0.01" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.grid_ef_t_per_mwh} onChange={e=>setT({...t,grid_ef_t_per_mwh:Number(e.target.value)})}/></label>
              <label className="text-sm">Energy price ({currency}/kWh)<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.energy_price_per_kwh} onChange={e=>setT({...t,energy_price_per_kwh:Number(e.target.value)})}/></label>

              <label className="text-sm">CAPEX total ({currency})<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.capex_total} onChange={e=>setT({...t,capex_total:Number(e.target.value)})}/></label>
              <label className="text-sm">ΔOPEX per year ({currency}/yr)<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.opex_delta_per_year} onChange={e=>setT({...t,opex_delta_per_year:Number(e.target.value)})}/></label>

              <label className="text-sm">Lifetime (years)<input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.lifetime_years} onChange={e=>setT({...t,lifetime_years:Number(e.target.value)})}/></label>
              <label className="text-sm">Discount rate (decimal)<input type="number" step="0.01" className="mt-1 border rounded-xl px-3 py-2 w-full" value={t.discount_rate} onChange={e=>setT({...t,discount_rate:Number(e.target.value)})}/></label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-xl p-3 border">
              <div>
                <div className="text-gray-500">Annual abatement</div>
                <div className="font-semibold">{formatNumber(calc.abate_t)} tCO₂/yr</div>
              </div>
              <div>
                <div className="text-gray-500">Annualized CAPEX</div>
                <div className="font-semibold">{currency} {formatNumber(calc.annualized_capex)}</div>
              </div>
              <div>
                <div className="text-gray-500">Net annual cost</div>
                <div className="font-semibold">{currency} {formatNumber(calc.net_annual_cost)}</div>
              </div>
              <div className="sm:col-span-3">
                <div className="text-gray-500">Implied cost</div>
                <div className="font-semibold">{currency} {formatNumber(calc.cost_per_t)} / tCO₂</div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={t.selected} onChange={e=>setT({...t,selected:e.target.checked})}/> Use in MACC</label>
              <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={saveTemplate}>Save measure</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Main Component ----------
export default function MACCApp() {
  const fileInputRef = useRef(null);

  // Global settings
  const [mode, setMode] = useLocalStorage("macc_mode", "capacity"); // 'capacity' or 'intensity'
  const [costModel, setCostModel] = useLocalStorage("macc_costModel", "step"); // 'step' or 'quadratic'
  const [currency, setCurrency] = useLocalStorage("macc_currency", "₹");
  const [sectors] = useLocalStorage("macc_sectors", DEFAULT_SECTORS);
  const [selectedSector, setSelectedSector] = useLocalStorage("macc_selected_sector", "All sectors");

  // Baselines by sector (editable)
  const [baselines, setBaselines] = useLocalStorage("macc_baselines", DEFAULT_BASELINES);

  // Measures
  const [measures, setMeasures] = useLocalStorage("macc_measures", DEFAULT_MEASURES);

  const sectorOptions = useMemo(() => ["All sectors", ...sectors], [sectors]);

  // Active baseline for the selected sector (if not All)
  const activeBaseline = useMemo(() => {
    if (selectedSector === "All sectors") {
      const emissions = Object.values(baselines).reduce((s, b) => s + Number(b.annual_emissions || 0), 0);
      const production = Object.values(baselines).reduce((s, b) => s + Number(b.annual_production || 0), 0);
      return { production_label: "units", annual_production: production, annual_emissions: emissions };
    }
    return baselines[selectedSector] || { production_label: "units", annual_production: 1, annual_emissions: 1 };
  }, [selectedSector, baselines]);

  // Filter measures by sector selection
  const filtered = useMemo(() => {
    return measures.filter(m => m.selected && (selectedSector === "All sectors" || m.sector === selectedSector));
  }, [measures, selectedSector]);

  // Sorted by cost ascending (classic MACC ordering)
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => (Number(a.cost_per_tco2) || 0) - (Number(b.cost_per_tco2) || 0));
    return copy;
  }, [filtered]);

  // Derived metrics
  const totals = useMemo(() => {
    const totalAbatement = filtered.reduce((s, m) => s + Number(m.abatement_tco2 || 0), 0);
    const avgCost = filtered.length ? filtered.reduce((s, m) => s + Number(m.cost_per_tco2 || 0), 0) / filtered.length : 0;
    const negCostAbatement = filtered.filter(m => Number(m.cost_per_tco2) < 0).reduce((s, m) => s + Number(m.abatement_tco2 || 0), 0);
    return { totalAbatement, avgCost, negCostAbatement };
  }, [filtered]);

  const baselineIntensity = useMemo(() => {
    const prod = Number(activeBaseline.annual_production || 0);
    const emis = Number(activeBaseline.annual_emissions || 0);
    return prod > 0 ? emis / prod : 0; // tCO2 per unit
  }, [activeBaseline]);

  // Build continuous MACC rectangles (colour + cumulative width)
  const { segments, totalX } = useMemo(() => {
    let cum = 0;
    const segs = [];
    sorted.forEach((m, idx) => {
      const A = Number(m.abatement_tco2 || 0);
      const C = Number(m.cost_per_tco2 || 0);
      if (!Number.isFinite(A) || !Number.isFinite(C) || A <= 0) return;

      const x1_cap = cum;
      const x2_cap = cum + Math.max(0, A);
      cum = x2_cap;

      const denom = Number(activeBaseline.annual_emissions || 0);
      const x1_plot = (mode === "capacity") ? x1_cap : (denom > 0 ? (x1_cap / denom) * 100 : 0);
      const x2_plot = (mode === "capacity") ? x2_cap : (denom > 0 ? (x2_cap / denom) * 100 : 0);

      segs.push({
        id: m.id,
        name: m.name,
        sector: m.sector,
        x1_plot, x2_plot,
        cost: C,
        abatement: A,
        color: PALETTE[idx % PALETTE.length],
      });
    });

    const totalX_plot = segs.length ? segs[segs.length - 1].x2_plot : 0;
    return { segments: segs, totalX: totalX_plot };
  }, [sorted, mode, activeBaseline.annual_emissions]);

  // Build MACC data points for analytics (budget-to-target & quadratic fit)
  const maccData = useMemo(() => {
    let cumAbate = 0;
    const points = [];
    for (const m of sorted) {
      const A = Number(m.abatement_tco2 || 0);
      const C = Number(m.cost_per_tco2 || 0);
      cumAbate += Math.max(0, A);
      const xCapacity = cumAbate;
      const xIntensityPct = activeBaseline.annual_emissions > 0 ? (cumAbate / activeBaseline.annual_emissions) * 100 : 0;
      const x = mode === "capacity" ? xCapacity : xIntensityPct;
      points.push({ id: m.id, name: m.name, sector: m.sector, abatement: A, cost: C, cumAbate, x });
    }
    return points;
  }, [sorted, mode, activeBaseline.annual_emissions]);

  // Quadratic fit over cumulative x vs marginal cost
  const quad = useMemo(() => {
    if (costModel !== "quadratic" || maccData.length < 3) return null;
    const xs = maccData.map((p) => p.x);
    const ys = maccData.map((p) => p.cost);
    const { a, b, c } = quadraticFit(xs, ys);
    const fitted = xs.map((x) => ({ x, y: a + b * x + c * x * x }));
    return { a, b, c, fitted };
  }, [maccData, costModel]);

  // Budget-to-target
  const [targetIntensityPct, setTargetIntensityPct] = useLocalStorage("macc_targetIntensityPct", 20);
  const budgetToTarget = useMemo(() => {
    if (!maccData.length) return { targetReached: 0, budget: 0 };
    const targetX = mode === "capacity" ? (activeBaseline.annual_emissions * (targetIntensityPct / 100)) : targetIntensityPct;
    let cum = 0, budget = 0, reached = 0;
    for (const p of maccData) {
      const remaining = Math.max(0, targetX - cum);
      const take = Math.min(remaining, p.abatement);
      if (take > 0) {
        budget += take * p.cost; // ₹/tCO2 * tCO2
        cum += take;
        reached = mode === "capacity" ? (cum) : (cum / activeBaseline.annual_emissions * 100);
      }
    }
    return { targetReached: reached, budget };
  }, [maccData, activeBaseline.annual_emissions, mode, targetIntensityPct]);

  // X width & Y domain for continuous chart
  const totalWidth = useMemo(
    () => (mode === 'capacity' ? (totalX > 0 ? totalX : 1) : Math.max(100, totalX || 1)),
    [totalX, mode]
  );

  const axisData = useMemo(
    () => [{ x: 0 }, { x: totalWidth > 0 ? totalWidth : 1 }],
    [totalWidth]
  );

  const yDomain = useMemo(() => {
    if (!segments.length) return [0, 1];
    const ys = segments.map(s => Number(s.cost) || 0);
    const minY = Math.min(0, ...ys);
    const maxY = Math.max(0, ...ys);
    return minY === maxY ? [minY - 1, maxY + 1] : [minY, maxY];
  }, [segments]);

  // ---------- UI Actions ----------
  const [wizardOpen, setWizardOpen] = useState(false);
  const addBlank = () => setWizardOpen(true);
  const saveWizard = (obj) => {
    const id = Math.max(0, ...measures.map((m) => m.id)) + 1;
    setMeasures([...measures, { id, ...obj }]);
    setWizardOpen(false);
  };

  const importCSV = (rows) => {
    // Expect headers: name,sector,abatement_tco2,cost_per_tco2,selected
    const parsed = rows.map((r, i) => ({
      id: i + 1 + (measures?.length || 0),
      name: r.name || r.Measure || r.intervention || `Row ${i+1}`,
      sector: r.sector || r.Sector || "Power",
      abatement_tco2: Number(r.abatement_tco2 || r.abatement || r.Abatement || 0),
      cost_per_tco2: Number(r.cost_per_tco2 || r.cost || r.Cost || 0),
      selected: String(r.selected ?? "true").toLowerCase() !== "false",
    }));
    setMeasures([...(measures || []), ...parsed]);
  };

  const exportCSV = () => {
    const rows = measures.map(({ id, ...rest }) => rest);
    saveFile("macc_measures.csv", jsonToCsv(rows));
  };

  const clearAll = () => {
    if (typeof window !== 'undefined' && window.confirm("Clear all measures? This cannot be undone.")) {
      setMeasures([]);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="bg-white rounded-2xl shadow border p-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">India CCTS – Marginal Abatement Cost Curve (MACC) Builder</h1>
              <p className="text-gray-600 mt-1">Choose a sector from India’s CCTS-relevant industries to see its sectoral MACC. Data are prefilled (plausible defaults) and fully editable.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="border rounded-xl px-3 py-2" value={selectedSector} onChange={(e) => setSelectedSector(e.target.value)}>
                {sectorOptions.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select className="border rounded-xl px-3 py-2" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option>₹</option>
                <option>$</option>
                <option>€</option>
              </select>
              <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={exportCSV}>Export CSV</button>
              <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={clearAll}>Clear</button>
              <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={() => setWizardOpen(true)}>+ Add measure</button>
            </div>
          </div>
        </header>

        {/* Settings */}
        <section className="bg-white rounded-2xl shadow border p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium">View Mode</label>
            <div className="flex gap-2">
              <button className={`px-3 py-2 rounded-xl border ${mode === 'capacity' ? 'bg-black text-white' : ''}`} onClick={() => setMode("capacity")}>Capacity-based</button>
              <button className={`px-3 py-2 rounded-xl border ${mode === 'intensity' ? 'bg-black text-white' : ''}`} onClick={() => setMode("intensity")}>Intensity-based</button>
            </div>
            <p className="text-xs text-gray-500">Capacity: x-axis = cumulative abatement (tCO₂). Intensity: x-axis = cumulative intensity reduction (%) relative to the selected sector’s baseline emissions.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Marginal Cost Model</label>
            <div className="flex gap-2">
              <button className={`px-3 py-2 rounded-xl border ${costModel === 'step' ? 'bg-black text-white' : ''}`} onClick={() => setCostModel("step")}>Stepwise</button>
              <button className={`px-3 py-2 rounded-xl border ${costModel === 'quadratic' ? 'bg-black text-white' : ''}`} onClick={() => setCostModel("quadratic")}>Quadratic Fit</button>
            </div>
            <p className="text-xs text-gray-500">Quadratic fits cost vs. cumulative abatement to approximate a smooth MACC.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Baseline for <b>{selectedSector}</b></label>
            <div className="grid grid-cols-3 gap-2 items-center">
              <div className="col-span-1 text-xs text-gray-600">Production ({activeBaseline.production_label})</div>
              <input type="number" className="col-span-2 border rounded-xl px-3 py-2" value={activeBaseline.annual_production}
                onChange={(e) => {
                  if (selectedSector === "All sectors") return;
                  setBaselines({ ...baselines, [selectedSector]: { ...activeBaseline, annual_production: Number(e.target.value) } });
                }} />
              <div className="col-span-1 text-xs text-gray-600">Emissions (tCO₂/yr)</div>
              <input type="number" className="col-span-2 border rounded-xl px-3 py-2" value={activeBaseline.annual_emissions}
                onChange={(e) => {
                  if (selectedSector === "All sectors") return;
                  setBaselines({ ...baselines, [selectedSector]: { ...activeBaseline, annual_emissions: Number(e.target.value) } });
                }} />
            </div>
            <p className="text-xs text-gray-500">Baseline intensity: {formatNumber(baselineIntensity)} tCO₂ per {activeBaseline.production_label}.</p>
          </div>
        </section>

        {/* Wizard modal */}
        <MeasureWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onSave={(obj) => {
          const id = Math.max(0, ...measures.map(m => m.id)) + 1;
          setMeasures([...measures, { id, ...obj }]);
          setWizardOpen(false);
        }} sectors={DEFAULT_SECTORS} currency={currency} />

        {/* Continuous coloured MACC */}
        <section className="bg-white rounded-2xl shadow border p-6 space-y-4">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1">
              <h2 className="text-lg font-semibold mb-2">
                Sectoral MACC — {selectedSector} ({mode === 'capacity' ? 'Cumulative tCO₂ abated' : 'Cumulative intensity reduction %'} on X; Marginal cost on Y)
              </h2>

              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={axisData} margin={{ top: 10, right: 10, left: 10, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[0, totalWidth > 0 ? totalWidth : 1]}
                    tickFormatter={(v) => mode === 'capacity' ? formatNumber(v) : Number(v).toFixed(1) + '%'}
                    label={{ value: mode === 'capacity' ? 'Cumulative abatement (tCO₂)' : 'Cumulative intensity reduction (%)', position: 'insideBottom', dy: 20 }}
                  />
                  <YAxis
                    type="number"
                    domain={yDomain}
                    tickFormatter={(v) => `${currency} ${formatNumber(v)}`}
                    label={{ value: `Marginal cost (${currency}/tCO₂)`, angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip
                    labelFormatter={(label) => {
                      const v = Number(label);
                      return mode === 'capacity' ? `${formatNumber(v)} tCO₂` : (Number.isFinite(v) ? v.toFixed(2) + '%' : String(label));
                    }}
                  />
                  <ReferenceLine y={0} stroke="#8884d8" strokeDasharray="4 4" />

                  {/* Draw continuous MACC rectangles (width = potential, height = cost) */}
                  {segments.map((s) => (
                    <ReferenceArea
                      key={s.id}
                      x1={s.x1_plot}
                      x2={s.x2_plot}
                      y1={0}
                      y2={s.cost}
                      fill={s.color}
                      fillOpacity={0.95}
                      stroke="none"
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>

              <ColorLegend items={segments.slice(0, 16)} />
            </div>

            <div className="w-full lg:w-[380px]">
              <h3 className="text-base font-semibold mb-2">Target & Budget (greedy stack)</h3>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={50} step={1} value={targetIntensityPct} onChange={(e) => setTargetIntensityPct(Number(e.target.value))} />
                <div className="w-24 text-right">{targetIntensityPct}%</div>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <div>Target reached: <b>{mode === 'capacity' ? formatNumber(budgetToTarget.targetReached) + ' tCO₂' : budgetToTarget.targetReached.toFixed(2) + '%'}</b></div>
                <div>Budget required (Σ cost×tCO₂): <b>{currency} {formatNumber(budgetToTarget.budget)}</b></div>
              </div>

              {costModel === 'quadratic' && quad && (
                <>
                  <div className="mt-4">
                    <h4 className="font-medium">Quadratic fit parameters</h4>
                    <div className="text-sm text-gray-600">cost(x) = a + b·x + c·x²</div>
                    <div className="text-sm">a = {quad.a.toFixed(4)}, b = {quad.b.toFixed(4)}, c = {quad.c.toFixed(6)}</div>
                  </div>
                  <div className="mt-4">
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={quad.fitted}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" type="number" domain={[0, totalWidth]} tickFormatter={(v) => mode === 'capacity' ? formatNumber(v) : Number(v).toFixed(1) + '%'} />
                        <YAxis tickFormatter={(v) => `${currency} ${formatNumber(v)}`} />
                        <Tooltip />
                        <Line type="monotone" dataKey="y" name="Quadratic MACC" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-500">Bars below zero indicate cost-saving measures. Numbers are illustrative defaults — replace with your sector study data when ready.</p>
        </section>

        {/* Measures table */}
        <section className="bg-white rounded-2xl shadow border p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Measures ({selectedSector})</h2>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 rounded-xl border" onClick={addBlank}>+ Add measure</button>
              <button className="px-3 py-2 rounded-xl border" onClick={() => fileInputRef.current?.click()}>Import CSV</button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => importCSV(csvToJson(String(reader.result)));
                  reader.readAsText(f);
                  e.currentTarget.value = '';
                }}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-700">
                  <th className="p-2 text-left">Use</th>
                  <th className="p-2 text-left">Measure</th>
                  <th className="p-2 text-left">Sector</th>
                  <th className="p-2 text-right">Abatement (tCO₂)</th>
                  <th className="p-2 text-right">Cost ({currency}/tCO₂)</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {measures
                  .filter(m => selectedSector === "All sectors" || m.sector === selectedSector)
                  .map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={m.selected}
                        onChange={(e) => {
                          const copy = [...measures];
                          const pos = copy.findIndex(x => x.id === m.id);
                          copy[pos] = { ...m, selected: e.target.checked };
                          setMeasures(copy);
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className="border rounded-lg px-2 py-1 w-56"
                        value={m.name}
                        onChange={(e) => {
                          const copy = [...measures];
                          const pos = copy.findIndex(x => x.id === m.id);
                          copy[pos] = { ...m, name: e.target.value };
                          setMeasures(copy);
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        className="border rounded-lg px-2 py-1"
                        value={m.sector}
                        onChange={(e) => {
                          const copy = [...measures];
                          const pos = copy.findIndex(x => x.id === m.id);
                          copy[pos] = { ...m, sector: e.target.value };
                          setMeasures(copy);
                        }}
                      >
                        {DEFAULT_SECTORS.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        className="border rounded-lg px-2 py-1 w-40 text-right"
                        value={m.abatement_tco2}
                        onChange={(e) => {
                          const copy = [...measures];
                          const pos = copy.findIndex(x => x.id === m.id);
                          copy[pos] = { ...m, abatement_tco2: Number(e.target.value) };
                          setMeasures(copy);
                        }}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        className="border rounded-lg px-2 py-1 w-40 text-right"
                        value={m.cost_per_tco2}
                        onChange={(e) => {
                          const copy = [...measures];
                          const pos = copy.findIndex(x => x.id === m.id);
                          copy[pos] = { ...m, cost_per_tco2: Number(e.target.value) };
                          setMeasures(copy);
                        }}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <button
                        className="px-2 py-1 rounded-lg border"
                        onClick={() => { setMeasures(measures.filter((x) => x.id !== m.id)); }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            CSV columns supported: <code>name, sector, abatement_tco2, cost_per_tco2, selected</code>. Extra columns are ignored on import and preserved on export.
          </div>
        </section>

        {/* Methodology card */}
        <section className="bg-white rounded-2xl shadow border p-6">
          <h2 className="text-lg font-semibold mb-2">Methodology (India CCTS context)</h2>
          <ul className="list-disc pl-5 text-sm space-y-1 text-gray-700">
            <li><b>Sectors:</b> Preloaded with nine CCTS-adjacent heavy industry & power sectors common in India’s efficiency/ETS programs. Edit the list as needed.</li>
            <li><b>Ordering:</b> Measures are sorted by marginal cost (₹/tCO₂) ascending to form the MACC.</li>
            <li><b>Capacity view:</b> X-axis shows cumulative abatement (tCO₂).</li>
            <li><b>Intensity view:</b> X-axis shows cumulative intensity reduction (%) = cumulative abatement ÷ sector baseline emissions × 100. Baseline intensity = emissions ÷ production.</li>
            <li><b>Quadratic MACC:</b> Least-squares fit cost(x) = a + b·x + c·x² over (x = cumulative abatement, y = marginal cost) to provide a smooth approximation.</li>
            <li><b>Budget to target:</b> Greedy stacking sums cost×abatement until a % reduction target is reached. For rigorous planning, add adoption caps, interactions, and minimum uptake constraints.</li>
            <li><b>Data:</b> Prefills are indicative only ("cooked"). Replace with plant- or sector-level studies when available.</li>
          </ul>
        </section>

        {/* Footer */}
        <footer className="text-xs text-gray-500 text-center pb-8">
          Built for India CCTS exploration. Next steps: add adoption caps, sector filters by region/state, and export of sectoral MACC PNG/PDF.
        </footer>
      </div>
    </div>
  );
}
