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
// ---------- Measure Wizard (real-world template) ----------
function MeasureWizard({ open, onClose, onSave, sectors, currency }) {
  const [tab, setTab] = useState("quick"); // 'quick' | 'template'

  // --- Quick (unchanged) ---
  const [q, setQ] = useState({
    name: "New Measure",
    sector: sectors[0] || "Power",
    abatement_tco2: 0,
    cost_per_tco2: 0,
    selected: true,
  });

  // --- Template (real-world, multi-year) ---
  // Years as in your Excel: 2020, 2025, ..., 2050
  const YEARS = [2020, 2025, 2030, 2035, 2040, 2045, 2050];
  const CR_TO_RUPEES = 10000000; // ₹/cr multiplier

  // Left block (reductions/intensities)
  const [tL, setTL] = useState({
    // core
    project_name: "Intensive Measure",
    sector: sectors[0] || "Power",
    // left metrics
    direct_reduction: YEARS.map(() => 0),           // tCO2e per year
    fuel_reduction: YEARS.map(() => 0),             // tCO2e per year
    fuel_use_reduction: YEARS.map(() => 0),         // '-' (dimensionless; used in narrative)
    fuel_intensity: YEARS.map(() => 0),             // tCO2e / -
    raw_reduction: YEARS.map(() => 0),              // tCO2e
    raw_use_reduction: YEARS.map(() => 0),          // '-'
    raw_intensity: YEARS.map(() => 0),              // tCO2e / -
    water_reduction: YEARS.map(() => 0),            // tCO2e
    water_use_reduction: YEARS.map(() => 0),        // '-'
    water_intensity: YEARS.map(() => 0),            // tCO2e / -
    transport_reduction: YEARS.map(() => 0),        // tCO2e
    transport_use_reduction: YEARS.map(() => 0),    // '-'
    transport_intensity: YEARS.map(() => 0),        // tCO2e / -
    elec_reduction: YEARS.map(() => 0),             // tCO2e
    elec_use_reduction_mwh: YEARS.map(() => 0),     // MWh
    elec_intensity_t_per_mwh: YEARS.map(() => 0.71),// tCO2e/MWh
    other_reduction: YEARS.map(() => 0),            // tCO2e
  });

  // Right block (cost stack)
  const [tR, setTR] = useState({
    abatement_total_cost_cr: YEARS.map(() => 0),  // ₹ cr
    opex_cr: YEARS.map(() => 0),
    savings_cr: YEARS.map(() => 0),
    fuel1_cr: YEARS.map(() => 0),
    fuel2_cr: YEARS.map(() => 0),
    raw1_cr: YEARS.map(() => 0),
    raw2_cr: YEARS.map(() => 0),
    water_waste_cr: YEARS.map(() => 0),
    transport_cr: YEARS.map(() => 0),
    electricity_cr: YEARS.map(() => 0),
    other_cr: YEARS.map(() => 0),
    total_capex_cr: YEARS.map(() => 0),
    capex_upfront_cr: YEARS.map(() => 0),
    capex_financed_cr: YEARS.map(() => 0),
    financing_tenure_years: YEARS.map(() => 40),
    interest_rate_pct: YEARS.map(() => 7), // %
  });

  // Finance block (global for the measure)
  const [fin, setFin] = useState({
    discount_rate: 0.10, // real, decimal
  });

  // helpers
  const setSeries = (obj, setter, key, idx, val) => {
    const copy = { ...obj };
    const arr = [...copy[key]];
    arr[idx] = Number(val);
    copy[key] = arr;
    setter(copy);
  };

  // core math (per year)
  const annuityFactor = (r, n) => {
    const R = Number(r), N = Number(n);
    if (!Number.isFinite(R) || !Number.isFinite(N) || N <= 0) return 0;
    if (Math.abs(R) < 1e-9) return 1 / N;
    return (R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
  };

  const computed = useMemo(() => {
    const perYear = YEARS.map((_, i) => {
      // direct tCO2 reductions are the denominator
      const direct = Number(tL.direct_reduction[i] || 0);

      // annualized capex (simple: use financed capex with market rate, else from total_capex if financed = 0)
      const financed = Number(tR.capex_financed_cr[i] || 0) * CR_TO_RUPEES;
      const upfront  = Number(tR.capex_upfront_cr[i] || 0) * CR_TO_RUPEES;
      const totalCap = Number(tR.total_capex_cr[i] || 0) * CR_TO_RUPEES;

      const i_nominal = Number(tR.interest_rate_pct[i] || 0) / 100.0;
      const n_tenure  = Number(tR.financing_tenure_years[i] || 0);

      const financedAnnual = financed > 0 && i_nominal > 0 && n_tenure > 0
        ? financed * annuityFactor(i_nominal, n_tenure)
        : 0;

      // You can optionally annualize remaining capex (upfront or total - financed) over the project life using discount_rate,
      // but to stay close to the sheet we keep it in the year it occurs (upfront) and track cumulative elsewhere.
      const annualizedCapex = financedAnnual; // minimal, transparent

      // cost stack (₹)
      const stack_cr =
        (Number(tR.opex_cr[i])           || 0) +
        (Number(tR.fuel1_cr[i])          || 0) +
        (Number(tR.fuel2_cr[i])          || 0) +
        (Number(tR.raw1_cr[i])           || 0) +
        (Number(tR.raw2_cr[i])           || 0) +
        (Number(tR.water_waste_cr[i])    || 0) +
        (Number(tR.transport_cr[i])      || 0) +
        (Number(tR.electricity_cr[i])    || 0) +
        (Number(tR.other_cr[i])          || 0) -
        (Number(tR.savings_cr[i])        || 0);

      const netAnnualCost = stack_cr * CR_TO_RUPEES + annualizedCapex;

      const impliedCostPerT = direct > 0 ? (netAnnualCost / direct) : 0; // ₹/tCO2e

      return {
        direct,
        netAnnualCost,
        impliedCostPerT,
      };
    });

    // Choose representative year for MACC (midpoint = 2035); fallback to last non-zero
    const midIdx = YEARS.indexOf(2035) >= 0 ? YEARS.indexOf(2035) : Math.floor(YEARS.length / 2);

    // prefer a year with positive direct reduction
    let repIdx = midIdx;
    const nonZeroIdx = perYear.findIndex(y => y.direct > 0);
    if (nonZeroIdx >= 0) repIdx = nonZeroIdx;

    const rep = perYear[repIdx] || { direct: 0, impliedCostPerT: 0 };
    return { YEARS, perYear, repIdx, rep };
  }, [tL, tR, fin]);

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
    // Use representative year for insertion into MACC; keep full timeline in details
    const repAbate = Math.max(0, computed.rep.direct);
    const repCost  = computed.rep.impliedCostPerT;
    onSave({
      name: tL.project_name,
      sector: tL.sector,
      abatement_tco2: repAbate,
      cost_per_tco2: repCost,
      selected: true,
      details: {
        mode: "template_real_world",
        years: computed.YEARS,
        left: tL,
        right: tR,
        finance: fin,
        computed: computed.perYear,  // [{direct, netAnnualCost, impliedCostPerT} ...]
        representative_index: computed.repIdx
      },
    });
  }

  if (!open) return null;

  // small input renderer for the 5-year columns
  const SeriesRow = ({ label, unit, series, onChange }) => (
    <div className="grid grid-cols-2 sm:grid-cols-9 gap-2 items-center">
      <div className="text-sm font-medium col-span-2 sm:col-span-2">{label}</div>
      <div className="text-xs text-gray-500">{unit}</div>
      {YEARS.map((y, i) => (
        <input
          key={y}
          type="number"
          className="border rounded-xl px-2 py-1 text-right"
          value={series[i]}
          onChange={(e) => onChange(i, e.target.value)}
        />
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="bg-white w-full sm:max-w-6xl rounded-t-2xl sm:rounded-2xl shadow-xl border">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex gap-2">
            <button className={`px-3 py-1.5 rounded-xl border ${tab==='quick'?'bg-black text-white':''}`} onClick={()=>setTab('quick')}>Quick add</button>
            <button className={`px-3 py-1.5 rounded-xl border ${tab==='template'?'bg-black text-white':''}`} onClick={()=>setTab('template')}>Template (Real-world)</button>
          </div>
          <button className="px-3 py-1.5 rounded-xl border" onClick={onClose}>Close</button>
        </div>

        {tab === "quick" && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">Project name
                <input className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.name} onChange={e=>setQ({...q,name:e.target.value})}/>
              </label>
              <label className="text-sm">Sector
                <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.sector} onChange={e=>setQ({...q,sector:e.target.value})}>
                  {sectors.map(s=> <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-sm">Abatement (tCO₂/yr)
                <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.abatement_tco2} onChange={e=>setQ({...q,abatement_tco2:Number(e.target.value)})}/>
              </label>
              <label className="text-sm">Cost ({currency}/tCO₂)
                <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.cost_per_tco2} onChange={e=>setQ({...q,cost_per_tco2:Number(e.target.value)})}/>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.selected} onChange={e=>setQ({...q,selected:e.target.checked})}/> Use in MACC</label>
              <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={saveQuick}>Save measure</button>
            </div>
          </div>
        )}

        {tab === "template" && (
          <div className="p-4 space-y-6">
            {/* Header */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-sm">Project name
                <input className="mt-1 border rounded-xl px-3 py-2 w-full" value={tL.project_name} onChange={e=>setTL({...tL,project_name:e.target.value})}/>
              </label>
              <label className="text-sm">Sector
                <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={tL.sector} onChange={e=>setTL({...tL,sector:e.target.value})}>
                  {sectors.map(s=> <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-sm">Discount rate (real)
                <input type="number" step="0.01" className="mt-1 border rounded-xl px-3 py-2 w-full" value={fin.discount_rate} onChange={e=>setFin({...fin,discount_rate:Number(e.target.value)})}/>
              </label>
            </div>

            {/* CALCULATIONS Two-block */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* LEFT: Reductions / Intensity */}
              <div className="space-y-3">
                <div className="text-sm font-semibold">Reductions (left block) — {YEARS.join(", ")}</div>
                <SeriesRow label="Direct emissions reduction" unit="tCO₂e"
                  series={tL.direct_reduction}
                  onChange={(i,v)=>setSeries(tL,setTL,"direct_reduction",i,v)} />
                <SeriesRow label="Select fuel emissions reduction" unit="tCO₂e"
                  series={tL.fuel_reduction}
                  onChange={(i,v)=>setSeries(tL,setTL,"fuel_reduction",i,v)} />
                <SeriesRow label="Select raw material emissions reduction" unit="tCO₂e"
                  series={tL.raw_reduction}
                  onChange={(i,v)=>setSeries(tL,setTL,"raw_reduction",i,v)} />
                <SeriesRow label="Select water & waste emissions reduction" unit="tCO₂e"
                  series={tL.water_reduction}
                  onChange={(i,v)=>setSeries(tL,setTL,"water_reduction",i,v)} />
                <SeriesRow label="Select transport emissions reduction" unit="tCO₂e"
                  series={tL.transport_reduction}
                  onChange={(i,v)=>setSeries(tL,setTL,"transport_reduction",i,v)} />
                <SeriesRow label="Electricity emissions reduction" unit="tCO₂e"
                  series={tL.elec_reduction}
                  onChange={(i,v)=>setSeries(tL,setTL,"elec_reduction",i,v)} />
                <SeriesRow label="Electricity use reduction" unit="MWh"
                  series={tL.elec_use_reduction_mwh}
                  onChange={(i,v)=>setSeries(tL,setTL,"elec_use_reduction_mwh",i,v)} />
                <SeriesRow label="Electricity emissions intensity" unit="tCO₂e/MWh"
                  series={tL.elec_intensity_t_per_mwh}
                  onChange={(i,v)=>setSeries(tL,setTL,"elec_intensity_t_per_mwh",i,v)} />
              </div>

              {/* RIGHT: Cost stack */}
              <div className="space-y-3">
                <div className="text-sm font-semibold">Cost stack (right block) — {YEARS.join(", ")}</div>
                <SeriesRow label="Abatement total cost" unit="₹ cr"
                  series={tR.abatement_total_cost_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"abatement_total_cost_cr",i,v)} />
                <SeriesRow label="Opex" unit="₹ cr" series={tR.opex_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"opex_cr",i,v)} />
                <SeriesRow label="Savings" unit="₹ cr" series={tR.savings_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"savings_cr",i,v)} />
                <SeriesRow label="Fuel 1" unit="₹ cr" series={tR.fuel1_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"fuel1_cr",i,v)} />
                <SeriesRow label="Fuel 2" unit="₹ cr" series={tR.fuel2_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"fuel2_cr",i,v)} />
                <SeriesRow label="Raw material 1" unit="₹ cr" series={tR.raw1_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"raw1_cr",i,v)} />
                <SeriesRow label="Raw material 2" unit="₹ cr" series={tR.raw2_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"raw2_cr",i,v)} />
                <SeriesRow label="Water & waste" unit="₹ cr" series={tR.water_waste_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"water_waste_cr",i,v)} />
                <SeriesRow label="Transport" unit="₹ cr" series={tR.transport_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"transport_cr",i,v)} />
                <SeriesRow label="Electricity" unit="₹ cr" series={tR.electricity_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"electricity_cr",i,v)} />
                <SeriesRow label="Other (e.g., manpower)" unit="₹ cr" series={tR.other_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"other_cr",i,v)} />
                <SeriesRow label="Total capex" unit="₹ cr" series={tR.total_capex_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"total_capex_cr",i,v)} />
                <SeriesRow label="Capex upfront" unit="₹ cr" series={tR.capex_upfront_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"capex_upfront_cr",i,v)} />
                <SeriesRow label="Capex financed" unit="₹ cr" series={tR.capex_financed_cr}
                  onChange={(i,v)=>setSeries(tR,setTR,"capex_financed_cr",i,v)} />
                <SeriesRow label="Financing tenure" unit="years" series={tR.financing_tenure_years}
                  onChange={(i,v)=>setSeries(tR,setTR,"financing_tenure_years",i,v)} />
                <SeriesRow label="Interest rate" unit="%" series={tR.interest_rate_pct}
                  onChange={(i,v)=>setSeries(tR,setTR,"interest_rate_pct",i,v)} />
              </div>
            </div>

            {/* Live roll-ups */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-xl p-3 border">
              <div>
                <div className="text-gray-500">Representative year</div>
                <div className="font-semibold">{YEARS[computed.repIdx]}</div>
              </div>
              <div>
                <div className="text-gray-500">Rep. direct abatement</div>
                <div className="font-semibold">{formatNumber(computed.rep.direct)} tCO₂e</div>
              </div>
              <div>
                <div className="text-gray-500">Rep. implied cost</div>
                <div className="font-semibold">{currency} {formatNumber(computed.rep.impliedCostPerT)} / tCO₂e</div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">Note: Cost per t uses the cost stack (₹ cr) × 10^7 ÷ direct tCO₂e for each year; representative year is the first non-zero direct reduction (fallback 2035).</div>
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
