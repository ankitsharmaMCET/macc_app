/* MACCApp.jsx — DB-aware template + scrollable wizard + continuous coloured MACC */
import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  ComposedChart,
  ReferenceArea,
} from "recharts";

/* ---------------- Helpers ---------------- */
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

function csvToJson(text) {
  const clean = (text || "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((ln) => ln.trim().length > 0);
  if (lines.length === 0) return [];
  const parseLine = (line) => {
    const result = []; let cur = ""; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQuotes && line[i+1] === '"') { cur += '"'; i++; } else { inQuotes = !inQuotes; } }
      else if (ch === ',' && !inQuotes) { result.push(cur); cur=""; }
      else { cur += ch; }
    }
    result.push(cur);
    return result.map((s)=>s.trim());
  };
  const headers = parseLine(lines.shift());
  return lines.map((line)=>{
    const cells = parseLine(line); const obj = {};
    headers.forEach((h,i)=> obj[h] = cells[i] !== undefined ? cells[i] : "");
    return obj;
  });
}
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
  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initialValue; } catch { return initialValue; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue];
}
function quadraticFit(xs, ys) {
  const n = xs.length; if (n < 3) return { a: 0, b: 0, c: 0 };
  let Sx=0,Sx2=0,Sx3=0,Sx4=0,Sy=0,Sxy=0,Sx2y=0;
  for (let i=0;i<n;i++){ const x=Number(xs[i]); const y=Number(ys[i]); const x2=x*x;
    Sx+=x; Sx2+=x2; Sx3+=x2*x; Sx4+=x2*x2; Sy+=y; Sxy+=x*y; Sx2y+=x2*y; }
  const det=(m)=> m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const M=[[n,Sx,Sx2],[Sx,Sx2,Sx3],[Sx2,Sx3,Sx4]];
  const My=[[Sy,Sx,Sx2],[Sxy,Sx2,Sx3],[Sx2y,Sx3,Sx4]];
  const Mb=[[n,Sy,Sx2],[Sx,Sxy,Sx3],[Sx2,Sx2y,Sx4]];
  const Mc=[[n,Sx,Sy],[Sx,Sx2,Sxy],[Sx2,Sx3,Sx2y]];
  const D=det(M); if (Math.abs(D)<1e-12) return {a:0,b:0,c:0};
  return { a: det(My)/D, b: det(Mb)/D, c: det(Mc)/D };
}

/* ---------------- Defaults ---------------- */
const DEFAULT_SECTORS = ["Power","Iron & Steel","Cement","Fertilizer","Refineries","Petrochemicals","Aluminium","Pulp & Paper","Textiles"];
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
const DEFAULT_MEASURES = [
  { id:1, name:"Boiler & Turbine Efficiency Upgrade", sector:"Power", abatement_tco2:12000000, cost_per_tco2:300,  selected:true },
  { id:2, name:"Auxiliary Power Reduction & VFDs",   sector:"Power", abatement_tco2:6000000,  cost_per_tco2:-150, selected:true },
  { id:3, name:"Waste Heat to Power in CPPs",        sector:"Power", abatement_tco2:3000000,  cost_per_tco2:800,  selected:true },
  { id:4, name:"Coal Drying & Mill Optimization",    sector:"Power", abatement_tco2:5000000,  cost_per_tco2:100,  selected:true },
];

/* ---------------- Colour palette ---------------- */
const PALETTE = [
  "#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f",
  "#edc949","#af7aa1","#ff9da7","#9c755f","#bab0ab",
  "#2f4b7c","#ffa600","#a05195","#003f5c","#d45087",
];
// stable color per measure id
function colorForId(id) {
  const s = String(id);
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
function ColorLegend({ items }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs mt-2">
      {items.map((s) => (
        <div key={s.id} className="flex items-center gap-2">
          <span style={{ background:s.color, width:12, height:12, display:'inline-block', borderRadius:2 }} />
          <span>{s.name}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Drivers DB bindings (guarded) ---------------- */
// Use in-app DB_* if present, else safe fallbacks.
// IMPORTANT: from here on, only use FUELS/RAW/TRANSPORT/WASTE/ELECTRICITY (not DB_* directly).
const FUELS = (typeof DB_FUELS !== "undefined" && Array.isArray(DB_FUELS)) ? DB_FUELS : [
  { name:"LNG", unit:"ton", price:0, price_per_unit_inr:0, ef_tco2_per_unit:2.559, ef_t_per_unit:2.559 },
  { name:"Diesel (100% mineral)", unit:"ton", price:0, price_per_unit_inr:0, ef_tco2_per_unit:3.209, ef_t_per_unit:3.209 },
];
const RAW = (typeof DB_RAW !== "undefined" && Array.isArray(DB_RAW)) ? DB_RAW : [
  { name:"Iron ore pellet (IOP)", unit:"ton", price:0, price_per_unit_inr:0, ef_tco2_per_unit:0.137, ef_t_per_unit:0.137 },
];
const TRANSPORT = (typeof DB_TRANSPORT !== "undefined" && Array.isArray(DB_TRANSPORT)) ? DB_TRANSPORT : [
  { name:"HGV | diesel", unit:"000 ton-km", price:0, price_per_unit_inr:0, ef_tco2_per_unit:0.110, ef_t_per_unit:0.110 },
];
const WASTE = (typeof DB_WASTE !== "undefined" && Array.isArray(DB_WASTE)) ? DB_WASTE : [
  { name:"Water treatment", unit:"million litres", price:0, price_per_unit_inr:0, ef_tco2_per_unit:0.272, ef_t_per_unit:0.272 },
];
const ELECTRICITY = (typeof DB_ELECTRICITY !== "undefined" && Array.isArray(DB_ELECTRICITY)) ? DB_ELECTRICITY : [
  { state:"India", unit:"MWh", price_per_mwh:500, price_per_mwh_inr:500, ef_tco2_per_mwh:0.710 },
];
// normalize getters (support both price/price_per_unit_inr and ef_tco2_per_unit/ef_t_per_unit)
const getUnitPrice       = (row) => (row?.price ?? row?.price_per_unit_inr ?? 0);
const getEFperUnit       = (row) => (row?.ef_tco2_per_unit ?? row?.ef_t_per_unit ?? 0);
const getElecPricePerMWh = (row) => (row?.price_per_mwh ?? row?.price_per_mwh_inr ?? 500);
const getElecEFperMWh    = (row) => (row?.ef_tco2_per_mwh ?? 0.710);

/* ---------------- Measure Wizard (DB-aware, multi-line, scrollable) ---------------- */
function MeasureWizard({ open, onClose, onSave, sectors, currency }) {
  const [tab, setTab] = useState("quick");
  const YEARS = [2020, 2025, 2030, 2035, 2040, 2045, 2050];
  const CR_TO_RUPEES = 10_000_000;

  // Quick tab
  const [q, setQ] = useState({
    name: "New Measure",
    sector: sectors[0] || "Power",
    abatement_tco2: 0,
    cost_per_tco2: 0,
    selected: true,
  });

  // Template meta
  const [meta, setMeta] = useState({
    project_name: "Industrial Efficiency Project",
    sector: sectors[0] || "Power",
    discount_rate: 0.10,         // real (CRF)
    project_life_years: 10,      // years for non-financed capex CRF
    annualize_nonfinanced_capex: true,
  });

  // Optional direct tCO2e series
  const [otherDirectT, setOtherDirectT] = useState(YEARS.map(() => 0));

  // Utilities
  const makeZeros = () => YEARS.map(() => 0);
  const makeEmptyEf = () => YEARS.map(() => ""); // blank = use DB EF

  // Multi-line drivers (each line can be a different item/state + per-year Δ + overrides)
  const [fuelLines, setFuelLines] = useState([
    { id: 1, name: FUELS[0]?.name || "", priceOv: null, efOv: null, delta: makeZeros() }
  ]);
  const [rawLines, setRawLines] = useState([
    { id: 1, name: RAW[0]?.name || "", priceOv: null, efOv: null, delta: makeZeros() }
  ]);
  const [transLines, setTransLines] = useState([
    { id: 1, name: TRANSPORT[0]?.name || "", priceOv: null, efOv: null, delta: makeZeros() }
  ]);
  const [wasteLines, setWasteLines] = useState([
    { id: 1, name: WASTE[0]?.name || "", priceOv: null, efOv: null, delta: makeZeros() }
  ]);
  const [elecLines, setElecLines] = useState([
    { id: 1, state: ELECTRICITY[0]?.state || "India", priceOv: null, efOvPerYear: makeEmptyEf(), deltaMWh: makeZeros() }
  ]);

  // Cost stack + financing (₹ cr)
  const [stack, setStack] = useState({
    opex_cr: YEARS.map(() => 0),
    savings_cr: YEARS.map(() => 0),
    other_cr: YEARS.map(() => 0),
    total_capex_cr: YEARS.map(() => 0),
    capex_upfront_cr: YEARS.map(() => 0),     // info only
    capex_financed_cr: YEARS.map(() => 0),
    financing_tenure_years: YEARS.map(() => 40),
    interest_rate_pct: YEARS.map(() => 7),
  });

  // Line helpers
  const updateLine = (list, setList, id, patch) => setList(list.map(l => l.id === id ? { ...l, ...patch } : l));
  const addLine = (list, setList, sample) => {
    const nextId = Math.max(0, ...list.map(l => l.id)) + 1;
    setList([...list, { id: nextId, ...sample }]);
  };
  const removeLine = (list, setList, id) => setList(list.filter(l => l.id !== id));

  // Annuity factor for financed capex
  const annuityFactor = (r, n) => {
    const R = Number(r), N = Number(n);
    if (!Number.isFinite(R) || !Number.isFinite(N) || N <= 0) return 0;
    if (Math.abs(R) < 1e-9) return 1 / N;
    return (R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
  };

  // Computation across all driver lines and stack
  const computed = useMemo(() => {
    const perYear = YEARS.map((_, i) => {
      let fuel_t = 0, raw_t = 0, trans_t = 0, waste_t = 0, elec_t = 0;
      let driver_cr = 0;

      // Fuel lines
      for (const ln of fuelLines) {
        const base = FUELS.find(x => x.name === ln.name);
        const price = (ln.priceOv ?? getUnitPrice(base) ?? 0);
        const ef    = (ln.efOv    ?? getEFperUnit(base) ?? 0);
        const qty   = Number(ln.delta[i] || 0);
        fuel_t  += qty * ef;
        driver_cr += (qty * price) / CR_TO_RUPEES;
      }
      // Raw lines
      for (const ln of rawLines) {
        const base = RAW.find(x => x.name === ln.name);
        const price = (ln.priceOv ?? getUnitPrice(base) ?? 0);
        const ef    = (ln.efOv    ?? getEFperUnit(base) ?? 0);
        const qty   = Number(ln.delta[i] || 0);
        raw_t  += qty * ef;
        driver_cr += (qty * price) / CR_TO_RUPEES;
      }
      // Transport lines
      for (const ln of transLines) {
        const base = TRANSPORT.find(x => x.name === ln.name);
        const price = (ln.priceOv ?? getUnitPrice(base) ?? 0);
        const ef    = (ln.efOv    ?? getEFperUnit(base) ?? 0);
        const qty   = Number(ln.delta[i] || 0);
        trans_t += qty * ef;
        driver_cr += (qty * price) / CR_TO_RUPEES;
      }
      // Water & waste lines
      for (const ln of wasteLines) {
        const base = WASTE.find(x => x.name === ln.name);
        const price = (ln.priceOv ?? getUnitPrice(base) ?? 0);
        const ef    = (ln.efOv    ?? getEFperUnit(base) ?? 0);
        const qty   = Number(ln.delta[i] || 0);
        waste_t += qty * ef;
        driver_cr += (qty * price) / CR_TO_RUPEES;
      }
      // Electricity lines
      for (const ln of elecLines) {
        const base = ELECTRICITY.find(x => x.state === ln.state) || ELECTRICITY[0];
        const price = (ln.priceOv ?? getElecPricePerMWh(base) ?? 0);
        const ef = (ln.efOvPerYear[i] !== "" && ln.efOvPerYear[i] != null)
          ? Number(ln.efOvPerYear[i])
          : getElecEFperMWh(base);
        const mwh = Number(ln.deltaMWh[i] || 0);
        elec_t  += mwh * ef;
        driver_cr += (mwh * price) / CR_TO_RUPEES;
      }

      const other_t = Number(otherDirectT[i] || 0);
      const direct_t = fuel_t + raw_t + trans_t + waste_t + elec_t + other_t;

      // Stack & financing
      const opex_cr    = Number(stack.opex_cr[i]    || 0);
      const savings_cr = Number(stack.savings_cr[i] || 0);
      const other_cr   = Number(stack.other_cr[i]   || 0);

      const total_capex_cr = Number(stack.total_capex_cr[i] || 0);
      const capex_financed_cr = Number(stack.capex_financed_cr[i] || 0);

      const i_nominal         = Number(stack.interest_rate_pct[i]  || 0) / 100;
      const n_tenure          = Number(stack.financing_tenure_years[i] || 0);
      const financedAnnual_cr = (capex_financed_cr > 0 && i_nominal > 0 && n_tenure > 0)
        ? capex_financed_cr * annuityFactor(i_nominal, n_tenure)
        : 0;

      // Annualize non-financed capex across project life with CRF (real discount rate)
      const r = Number(meta.discount_rate || 0);
      const N = Number(meta.project_life_years || 0);
      const crf = (r > 0 && N > 0) ? (r * Math.pow(1 + r, N)) / (Math.pow(1 + r, N) - 1) : (N > 0 ? 1 / N : 0);
      const nonFinanced_cr = Math.max(0, total_capex_cr - capex_financed_cr);
      const annualizedNonFinanced_cr = (meta.annualize_nonfinanced_capex && crf > 0) ? nonFinanced_cr * crf : 0;

      // Net annual (₹ cr)
      const net_cost_cr = (driver_cr + opex_cr + other_cr - savings_cr) + financedAnnual_cr + annualizedNonFinanced_cr;

      // Implied cost (₹/t)
      const implied_cost_per_t = direct_t > 0 ? (net_cost_cr * 10_000_000) / direct_t : 0;

      return {
        direct_t,
        net_cost_cr,
        implied_cost_per_t,
        pieces: {
          fuel_t, raw_t, trans_t, waste_t, elec_t, other_t,
          driver_cr, opex_cr, other_cr, savings_cr,
          financedAnnual_cr, annualizedNonFinanced_cr,
        }
      };
    });

    // Representative year: first with positive direct_t (fallback 2035 or midpoint)
    let repIdx = perYear.findIndex(y => y.direct_t > 0);
    if (repIdx < 0) repIdx = YEARS.indexOf(2035) >= 0 ? YEARS.indexOf(2035) : Math.floor(YEARS.length / 2);

    return { YEARS, perYear, repIdx, rep: perYear[repIdx] || { direct_t: 0, implied_cost_per_t: 0 } };
  }, [fuelLines, rawLines, transLines, wasteLines, elecLines, otherDirectT, stack, meta.discount_rate, meta.project_life_years, meta.annualize_nonfinanced_capex]);

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
    const repAbate = Math.max(0, computed.rep.direct_t);
    const repCost  = computed.rep.implied_cost_per_t;

    onSave({
      name: meta.project_name,
      sector: meta.sector,
      abatement_tco2: repAbate,
      cost_per_tco2: repCost,
      selected: true,
      details: {
        mode: "template_db_multiline",
        years: computed.YEARS,
        meta,
        drivers: {
          fuel_lines: fuelLines,
          raw_lines: rawLines,
          transport_lines: transLines,
          waste_lines: wasteLines,
          electricity_lines: elecLines,
          other_direct_t: otherDirectT,
        },
        stack,
        per_year: computed.perYear,
        representative_index: computed.repIdx
      },
    });
  }

  if (!open) return null;

  // Shared series row (7 columns for 2020..2050)
  const SeriesRow = ({ label, unit, series, onChange, hint }) => (
    <div className="grid grid-cols-2 sm:grid-cols-9 gap-2 items-center">
      <div className="text-sm font-medium col-span-2 sm:col-span-2">
        {label}
        {hint && <div className="text-[10px] text-gray-500">{hint}</div>}
      </div>
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

  const LineHeader = ({ title, onRemove, showRemove = true }) => (
    <div className="flex items-center justify-between mt-3">
      <div className="text-xs uppercase tracking-wide text-gray-600">{title}</div>
      {showRemove && (
        <button type="button" className="text-xs px-2 py-1 rounded border" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  );

  // DB presence guards
  const hasFuelDB = FUELS.length > 0;
  const hasRawDB = RAW.length > 0;
  const hasTransDB = TRANSPORT.length > 0;
  const hasWasteDB = WASTE.length > 0;
  const hasElecDB = ELECTRICITY.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4">
      <div className="bg-white w-full sm:max-w-6xl rounded-2xl shadow-xl border flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex gap-2">
            <button className={`px-3 py-1.5 rounded-xl border ${tab==='quick'?'bg-black text-white':''}`} onClick={()=>setTab('quick')}>Quick add</button>
            <button className={`px-3 py-1.5 rounded-xl border ${tab==='template'?'bg-black text-white':''}`} onClick={()=>setTab('template')}>Template (DB-aware)</button>
          </div>
          <button className="px-3 py-1.5 rounded-xl border" onClick={onClose}>Close</button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto">
          {tab === "quick" ? (
            <div className="space-y-3">
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
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={q.selected} onChange={e=>setQ({...q,selected:e.target.checked})}/> Use in MACC
              </label>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Meta */}
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <label className="text-sm sm:col-span-2">Project name
                  <input className="mt-1 border rounded-xl px-3 py-2 w-full" value={meta.project_name} onChange={e=>setMeta({...meta,project_name:e.target.value})}/>
                </label>
                <label className="text-sm">Sector
                  <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={meta.sector} onChange={e=>setMeta({...meta,sector:e.target.value})}>
                    {sectors.map(s=> <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label className="text-sm">Discount rate (real)
                  <input type="number" step="0.01" className="mt-1 border rounded-xl px-3 py-2 w-full" value={meta.discount_rate} onChange={e=>setMeta({...meta,discount_rate:Number(e.target.value)})}/>
                </label>
                <label className="text-sm">Project life (yrs)
                  <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={meta.project_life_years} onChange={e=>setMeta({...meta,project_life_years:Number(e.target.value)})}/>
                </label>
                <label className="text-sm flex items-center gap-2 sm:col-span-2">
                  <input type="checkbox" checked={!!meta.annualize_nonfinanced_capex} onChange={e=>setMeta({...meta, annualize_nonfinanced_capex:e.target.checked})}/>
                  Annualize non‑financed capex via CRF
                </label>
              </div>

              {/* Drivers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-3 rounded-xl border">
                {/* Fuel group */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Fuel lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" disabled={!hasFuelDB}
                      title={!hasFuelDB ? "No fuel items in DB" : ""}
                      onClick={() => addLine(fuelLines, setFuelLines, { name: FUELS[0]?.name || "", priceOv: null, efOv: null, delta: YEARS.map(()=>0) })}>
                      + Add fuel line
                    </button>
                  </div>
                  {!hasFuelDB && <div className="text-xs text-red-500 mt-1">No fuel items available in DB.</div>}

                  {fuelLines.map((ln) => {
                    const base = FUELS.find(x => x.name === ln.name);
                    const unit = base?.unit || "-";
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2">
                        <LineHeader title="Fuel line" onRemove={() => removeLine(fuelLines, setFuelLines, ln.id)} />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <label className="text-sm col-span-2">Fuel
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.name} onChange={e=>updateLine(fuelLines, setFuelLines, ln.id, { name: e.target.value })}>
                              {hasFuelDB ? FUELS.map(x=> <option key={x.name}>{x.name}</option>) : <option>—</option>}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getUnitPrice(base)).toString()}
                                   value={ln.priceOv ?? ""} onChange={e=>updateLine(fuelLines,setFuelLines,ln.id,{ priceOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getUnitPrice(base)} ₹/{unit}</div>
                          </label>
                          <label className="text-sm">EF override (tCO₂/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getEFperUnit(base)).toString()}
                                   value={ln.efOv ?? ""} onChange={e=>updateLine(fuelLines,setFuelLines,ln.id,{ efOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getEFperUnit(base)} tCO₂/{unit}</div>
                          </label>
                        </div>
                        <SeriesRow
                          label={`ΔFuel quantity (${unit})`} unit={unit} series={ln.delta}
                          hint="Positive = reduction (avoided consumption)"
                          onChange={(i,v)=>updateLine(fuelLines,setFuelLines,ln.id,{ delta: ln.delta.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv) })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Raw group */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Raw material lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" disabled={!hasRawDB}
                      title={!hasRawDB ? "No raw items in DB" : ""}
                      onClick={() => addLine(rawLines, setRawLines, { name: RAW[0]?.name || "", priceOv: null, efOv: null, delta: YEARS.map(()=>0) })}>
                      + Add raw line
                    </button>
                  </div>
                  {!hasRawDB && <div className="text-xs text-red-500 mt-1">No raw items available in DB.</div>}

                  {rawLines.map((ln) => {
                    const base = RAW.find(x => x.name === ln.name);
                    const unit = base?.unit || "-";
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2">
                        <LineHeader title="Raw material line" onRemove={() => removeLine(rawLines, setRawLines, ln.id)} />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <label className="text-sm col-span-2">Raw material
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.name} onChange={e=>updateLine(rawLines, setRawLines, ln.id, { name: e.target.value })}>
                              {hasRawDB ? RAW.map(x=> <option key={x.name}>{x.name}</option>) : <option>—</option>}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getUnitPrice(base)).toString()}
                                   value={ln.priceOv ?? ""} onChange={e=>updateLine(rawLines,setRawLines,ln.id,{ priceOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getUnitPrice(base)} ₹/{unit}</div>
                          </label>
                          <label className="text-sm">EF override (tCO₂/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getEFperUnit(base)).toString()}
                                   value={ln.efOv ?? ""} onChange={e=>updateLine(rawLines,setRawLines,ln.id,{ efOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getEFperUnit(base)} tCO₂/{unit}</div>
                          </label>
                        </div>
                        <SeriesRow
                          label={`ΔRaw quantity (${unit})`} unit={unit} series={ln.delta}
                          hint="Positive = reduction (avoided use)"
                          onChange={(i,v)=>updateLine(rawLines,setRawLines,ln.id,{ delta: ln.delta.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv) })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Transport group */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Transport lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" disabled={!hasTransDB}
                      title={!hasTransDB ? "No transport items in DB" : ""}
                      onClick={() => addLine(transLines, setTransLines, { name: TRANSPORT[0]?.name || "", priceOv: null, efOv: null, delta: YEARS.map(()=>0) })}>
                      + Add transport line
                    </button>
                  </div>
                  {!hasTransDB && <div className="text-xs text-red-500 mt-1">No transport items available in DB.</div>}

                  {transLines.map((ln) => {
                    const base = TRANSPORT.find(x => x.name === ln.name);
                    const unit = base?.unit || "-";
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2">
                        <LineHeader title="Transport line" onRemove={() => removeLine(transLines, setTransLines, ln.id)} />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <label className="text-sm col-span-2">Transport
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.name} onChange={e=>updateLine(transLines, setTransLines, ln.id, { name: e.target.value })}>
                              {hasTransDB ? TRANSPORT.map(x=> <option key={x.name}>{x.name}</option>) : <option>—</option>}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getUnitPrice(base)).toString()}
                                   value={ln.priceOv ?? ""} onChange={e=>updateLine(transLines,setTransLines,ln.id,{ priceOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getUnitPrice(base)} ₹/{unit}</div>
                          </label>
                          <label className="text-sm">EF override (tCO₂/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getEFperUnit(base)).toString()}
                                   value={ln.efOv ?? ""} onChange={e=>updateLine(transLines,setTransLines,ln.id,{ efOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getEFperUnit(base)} tCO₂/{unit}</div>
                          </label>
                        </div>
                        <SeriesRow
                          label={`ΔTransport activity (${unit})`} unit={unit} series={ln.delta}
                          hint="Positive = reduction (avoided activity)"
                          onChange={(i,v)=>updateLine(transLines,setTransLines,ln.id,{ delta: ln.delta.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv) })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Water & waste group */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Water & waste lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" disabled={!hasWasteDB}
                      title={!hasWasteDB ? "No water/waste items in DB" : ""}
                      onClick={() => addLine(wasteLines, setWasteLines, { name: WASTE[0]?.name || "", priceOv: null, efOv: null, delta: YEARS.map(()=>0) })}>
                      + Add water/waste line
                    </button>
                  </div>
                  {!hasWasteDB && <div className="text-xs text-red-500 mt-1">No water/waste items available in DB.</div>}

                  {wasteLines.map((ln) => {
                    const base = WASTE.find(x => x.name === ln.name);
                    const unit = base?.unit || "-";
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2">
                        <LineHeader title="Water & waste line" onRemove={() => removeLine(wasteLines, setWasteLines, ln.id)} />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <label className="text-sm col-span-2">Water/Waste
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.name} onChange={e=>updateLine(wasteLines, setWasteLines, ln.id, { name: e.target.value })}>
                              {hasWasteDB ? WASTE.map(x=> <option key={x.name}>{x.name}</option>) : <option>—</option>}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getUnitPrice(base)).toString()}
                                   value={ln.priceOv ?? ""} onChange={e=>updateLine(wasteLines,setWasteLines,ln.id,{ priceOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getUnitPrice(base)} ₹/{unit}</div>
                          </label>
                          <label className="text-sm">EF override (tCO₂/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getEFperUnit(base)).toString()}
                                   value={ln.efOv ?? ""} onChange={e=>updateLine(wasteLines,setWasteLines,ln.id,{ efOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getEFperUnit(base)} tCO₂/{unit}</div>
                          </label>
                        </div>
                        <SeriesRow
                          label={`ΔWater/waste quantity (${unit})`} unit={unit} series={ln.delta}
                          hint="Positive = reduction (avoided quantity)"
                          onChange={(i,v)=>updateLine(wasteLines,setWasteLines,ln.id,{ delta: ln.delta.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv) })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Electricity group (spans 2 columns) */}
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Electricity lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" disabled={!hasElecDB}
                      title={!hasElecDB ? "No electricity states in DB" : ""}
                      onClick={() => addLine(elecLines, setElecLines, { state: ELECTRICITY[0]?.state || "India", priceOv: null, efOvPerYear: YEARS.map(()=>""), deltaMWh: YEARS.map(()=>0) })}>
                      + Add electricity line
                    </button>
                  </div>
                  {!hasElecDB && <div className="text-xs text-red-500 mt-1">No electricity states available in DB.</div>}

                  {elecLines.map((ln) => {
                    const base = ELECTRICITY.find(x => x.state === ln.state) || ELECTRICITY[0];
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2">
                        <LineHeader title="Electricity line" onRemove={() => removeLine(elecLines, setElecLines, ln.id)} />
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-2">
                          <label className="text-sm sm:col-span-2">State
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.state} onChange={e=>updateLine(elecLines,setElecLines,ln.id,{ state: e.target.value })}>
                              {hasElecDB ? ELECTRICITY.map(e=> <option key={e.state}>{e.state}</option>) : <option>—</option>}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/MWh)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full"
                                   placeholder={(getElecPricePerMWh(base)).toString()}
                                   value={ln.priceOv ?? ""} onChange={e=>updateLine(elecLines,setElecLines,ln.id,{ priceOv: e.target.value===""?null:Number(e.target.value) })}/>
                            <div className="text-[10px] text-gray-500">DB: {getElecPricePerMWh(base)} ₹/MWh</div>
                          </label>
                          <div className="text-sm self-end text-gray-500">EF override per year (tCO₂/MWh)</div>
                        </div>

                        <SeriesRow
                          label="ΔElectricity use" unit="MWh" series={ln.deltaMWh}
                          hint="Positive = reduction (avoided MWh)"
                          onChange={(i,v)=>updateLine(elecLines,setElecLines,ln.id,{ deltaMWh: ln.deltaMWh.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv) })}
                        />

                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-9 gap-2 items-center">
                          <div className="text-sm font-medium col-span-2 sm:col-span-2">EF override (blank = use state)</div>
                          <div className="text-xs text-gray-500">tCO₂/MWh</div>
                          {YEARS.map((y, i) => (
                            <input key={y} type="number" className="border rounded-xl px-2 py-1 text-right"
                                   value={ln.efOvPerYear[i]}
                                   onChange={(e)=>updateLine(elecLines,setElecLines,ln.id,{ efOvPerYear: ln.efOvPerYear.map((vv,idx)=> idx===i ? e.target.value : vv) })}/>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Other direct tCO2e */}
              <div className="rounded-xl border p-3">
                <div className="text-sm font-semibold mb-2">Other direct emissions reduction (optional)</div>
                <SeriesRow
                  label="Other direct reduction" unit="tCO₂e" series={otherDirectT}
                  hint="Use if part of abatement is not captured by the driver lines"
                  onChange={(i,v)=> setOtherDirectT(otherDirectT.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv))}
                />
              </div>

              {/* Stack & finance */}
              <div className="rounded-xl border p-3">
                <div className="text-sm font-semibold mb-2">Cost stack & financing (₹ cr)</div>
                <SeriesRow label="Opex" unit="₹ cr" series={stack.opex_cr} onChange={(i,v)=> setStack(s=>({...s, opex_cr: s.opex_cr.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv)}))}/>
                <SeriesRow label="Savings" unit="₹ cr" series={stack.savings_cr} onChange={(i,v)=> setStack(s=>({...s, savings_cr: s.savings_cr.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv)}))}/>
                <SeriesRow label="Other (e.g., manpower)" unit="₹ cr" series={stack.other_cr} onChange={(i,v)=> setStack(s=>({...s, other_cr: s.other_cr.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv)}))}/>
                <SeriesRow label="Total capex" unit="₹ cr" series={stack.total_capex_cr} onChange={(i,v)=> setStack(s=>({...s, total_capex_cr: s.total_capex_cr.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv)}))}/>
                <SeriesRow label="Capex financed" unit="₹ cr" series={stack.capex_financed_cr} onChange={(i,v)=> setStack(s=>({...s, capex_financed_cr: s.capex_financed_cr.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv)}))}/>
                <SeriesRow label="Capex upfront (info)" unit="₹ cr" series={stack.capex_upfront_cr} onChange={(i,v)=> setStack(s=>({...s, capex_upfront_cr: s.capex_upfront_cr.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv)}))}/>
                <SeriesRow label="Financing tenure" unit="years" series={stack.financing_tenure_years} onChange={(i,v)=> setStack(s=>({...s, financing_tenure_years: s.financing_tenure_years.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv)}))}/>
                <SeriesRow label="Interest rate" unit="%" series={stack.interest_rate_pct} onChange={(i,v)=> setStack(s=>({...s, interest_rate_pct: s.interest_rate_pct.map((vv,idx)=> idx===i ? (v===""? "": Number(v)) : vv)}))}/>
              </div>

              {/* Roll-ups */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-xl p-3 border">
                <div>
                  <div className="text-gray-500">Representative year</div>
                  <div className="font-semibold">{YEARS[computed.repIdx]}</div>
                </div>
                <div>
                  <div className="text-gray-500">Rep. direct abatement</div>
                  <div className="font-semibold">{formatNumber(computed.rep.direct_t)} tCO₂e</div>
                </div>
                <div>
                  <div className="text-gray-500">Rep. implied cost</div>
                  <div className="font-semibold">{currency} {formatNumber(computed.rep.implied_cost_per_t)} / tCO₂e</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="p-3 border-t bg-white sticky bottom-0">
          {tab === "quick" ? (
            <div className="flex items-center justify-end gap-2">
              <button className="px-4 py-2 rounded-xl border" onClick={onClose}>Cancel</button>
              <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={saveQuick}>Save measure</button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <div className="text-[11px] text-gray-600 mr-auto">
                Positive Δ = reduction. Driver cost = Σ(Δ × price). Reductions = Σ(Δ × EF). Non‑financed capex is annualized via CRF if enabled.
              </div>
              <button className="px-4 py-2 rounded-xl border" onClick={onClose}>Cancel</button>
              <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={saveTemplate}>Save measure</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Main Component ---------------- */
export default function MACCApp() {
  const fileInputRef = useRef(null);

  const [mode, setMode] = useLocalStorage("macc_mode", "capacity");
  const [costModel, setCostModel] = useLocalStorage("macc_costModel", "step");
  const [currency, setCurrency] = useLocalStorage("macc_currency", "₹");
  const [sectors] = useLocalStorage("macc_sectors", DEFAULT_SECTORS);
  const [selectedSector, setSelectedSector] = useLocalStorage("macc_selected_sector", "All sectors");

  const [baselines, setBaselines] = useLocalStorage("macc_baselines", DEFAULT_BASELINES);
  const [measures, setMeasures] = useLocalStorage("macc_measures", DEFAULT_MEASURES);

  const sectorOptions = useMemo(() => ["All sectors", ...sectors], [sectors]);

  const activeBaseline = useMemo(() => {
    if (selectedSector === "All sectors") {
      const emissions = Object.values(baselines).reduce((s,b)=> s + Number(b.annual_emissions || 0), 0);
      const production = Object.values(baselines).reduce((s,b)=> s + Number(b.annual_production || 0), 0);
      return { production_label: "units", annual_production: production, annual_emissions: emissions };
    }
    return baselines[selectedSector] || { production_label:"units", annual_production:1, annual_emissions:1 };
  }, [selectedSector, baselines]);

  const filtered = useMemo(() => measures.filter(m => m.selected && (selectedSector==="All sectors" || m.sector===selectedSector)), [measures, selectedSector]);
  const sorted = useMemo(() => { const copy=[...filtered]; copy.sort((a,b)=> (Number(a.cost_per_tco2)||0) - (Number(b.cost_per_tco2)||0)); return copy; }, [filtered]);

  const totals = useMemo(() => {
    const totalAbatement = filtered.reduce((s,m)=> s + Number(m.abatement_tco2||0), 0);
    const avgCost = filtered.length ? filtered.reduce((s,m)=> s + Number(m.cost_per_tco2||0), 0) / filtered.length : 0;
    const negCostAbatement = filtered.filter(m=> Number(m.cost_per_tco2) < 0).reduce((s,m)=> s + Number(m.abatement_tco2||0), 0);
    return { totalAbatement, avgCost, negCostAbatement };
  }, [filtered]);

  const baselineIntensity = useMemo(() => {
    const prod=Number(activeBaseline.annual_production||0);
    const emis=Number(activeBaseline.annual_emissions||0);
    return prod>0 ? emis/prod : 0;
  }, [activeBaseline]);

  // Build continuous rectangles (stable colors)
  const { segments, totalX } = useMemo(() => {
    let cum = 0; const segs = [];
    sorted.forEach((m) => {
      const A = Number(m.abatement_tco2 || 0);
      const C = Number(m.cost_per_tco2 || 0);
      if (!Number.isFinite(A) || !Number.isFinite(C) || A <= 0) return;
      const x1_cap = cum, x2_cap = cum + Math.max(0, A); cum = x2_cap;
      const denom = Number(activeBaseline.annual_emissions || 0);
      const x1_plot = (mode === "capacity") ? x1_cap : (denom > 0 ? (x1_cap/denom)*100 : 0);
      const x2_plot = (mode === "capacity") ? x2_cap : (denom > 0 ? (x2_cap/denom)*100 : 0);
      segs.push({ id:m.id, name:m.name, sector:m.sector, x1_plot, x2_plot, cost:C, abatement:A, color:colorForId(m.id) });
    });
    const totalX_plot = segs.length ? segs[segs.length - 1].x2_plot : 0;
    return { segments: segs, totalX: totalX_plot };
  }, [sorted, mode, activeBaseline.annual_emissions]);

  const maccData = useMemo(() => {
    let cumAbate=0; const points=[];
    for (const m of sorted){
      const A=Number(m.abatement_tco2||0); const C=Number(m.cost_per_tco2||0);
      cumAbate += Math.max(0, A);
      const xCapacity = cumAbate;
      const xIntensityPct = activeBaseline.annual_emissions>0 ? (cumAbate/activeBaseline.annual_emissions)*100 : 0;
      const x = mode==="capacity" ? xCapacity : xIntensityPct;
      points.push({ id:m.id, name:m.name, sector:m.sector, abatement:A, cost:C, cumAbate, x });
    }
    return points;
  }, [sorted, mode, activeBaseline.annual_emissions]);

  const quad = useMemo(() => {
    if (costModel !== "quadratic" || maccData.length < 3) return null;
    const xs = maccData.map(p=>p.x);
    const ys = maccData.map(p=>p.cost);
    const { a,b,c } = quadraticFit(xs, ys);
    const fitted = xs.map(x=> ({ x, y: a + b*x + c*x*x }));
    return { a,b,c,fitted };
  }, [maccData, costModel]);

  // Budget-to-target (slider now 0..100)
  const [targetIntensityPct, setTargetIntensityPct] = useLocalStorage("macc_targetIntensityPct", 20);
  const budgetToTarget = useMemo(() => {
    if (!maccData.length) return { targetReached:0, budget:0 };
    const targetX = mode==="capacity" ? (activeBaseline.annual_emissions * (targetIntensityPct/100)) : targetIntensityPct;
    let cum=0, budget=0, reached=0;
    for (const p of maccData){
      const remaining = Math.max(0, targetX - cum);
      const take = Math.min(remaining, p.abatement);
      if (take>0){ budget += take * p.cost; cum += take; reached = mode==="capacity" ? cum : (cum/activeBaseline.annual_emissions*100); }
    }
    if (mode === "intensity") reached = Math.min(100, reached);
    return { targetReached:reached, budget };
  }, [maccData, activeBaseline.annual_emissions, mode, targetIntensityPct]);

  // X width & Y domain with padding
  const totalWidth = useMemo(() => (mode === 'capacity' ? (totalX > 0 ? totalX : 1) : 100), [totalX, mode]);
  const axisData = useMemo(() => [{ x:0 }, { x: totalWidth > 0 ? totalWidth : 1 }], [totalWidth]);
  const yDomain = useMemo(() => {
    if (!segments.length) return [0,1];
    const ys = segments.map(s=> Number(s.cost)||0);
    const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
    const pad = Math.max(1, 0.05 * (maxY - minY || 1));
    return minY===maxY ? [minY - pad, maxY + pad] : [minY - pad, maxY + pad];
  }, [segments]);

  // UI Actions
  const [wizardOpen, setWizardOpen] = useState(false);
  const addBlank = () => setWizardOpen(true);

  const importCSV = (rows) => {
    const parsed = rows.map((r,i)=>({
      id: i + 1 + (measures?.length || 0),
      name: r.name || r.Measure || r.intervention || `Row ${i+1}`,
      sector: r.sector || r.Sector || "Power",
      abatement_tco2: Number(r.abatement_tco2 || r.abatement || r.Abatement || 0),
      cost_per_tco2: Number(r.cost_per_tco2 || r.cost || r.Cost || 0),
      selected: String(r.selected ?? "true").toLowerCase() !== "false",
    }));
    setMeasures([...(measures||[]), ...parsed]);
  };
  const exportCSV = () => { const rows = measures.map(({ id, ...rest }) => rest); saveFile("macc_measures.csv", jsonToCsv(rows)); };
  const exportJSON = () => saveFile("macc_measures.json", JSON.stringify(measures, null, 2));
  const clearAll = () => { if (typeof window!=='undefined' && window.confirm("Clear all measures? This cannot be undone.")) setMeasures([]); };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="bg-white rounded-2xl shadow border p-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">India CCTS – Marginal Abatement Cost Curve (MACC) Builder</h1>
              <p className="text-gray-600 mt-1">Choose a sector from India’s CCTS-relevant industries to see its sectoral MACC. Data are prefilled and editable.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="border rounded-xl px-3 py-2" value={selectedSector} onChange={(e)=>setSelectedSector(e.target.value)}>
                {sectorOptions.map((s)=> <option key={s}>{s}</option>)}
              </select>
              <select className="border rounded-xl px-3 py-2" value={currency} onChange={(e)=>setCurrency(e.target.value)}>
                <option>₹</option><option>$</option><option>€</option>
              </select>
              <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={exportCSV}>Export CSV</button>
              <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={exportJSON}>Export JSON</button>
              <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={clearAll}>Clear</button>
              <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={()=>setWizardOpen(true)}>+ Add measure</button>
            </div>
          </div>
        </header>

        <section className="bg-white rounded-2xl shadow border p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium">View Mode</label>
            <div className="flex gap-2">
              <button className={`px-3 py-2 rounded-xl border ${mode==='capacity'?'bg-black text-white':''}`} onClick={()=>setMode("capacity")}>Capacity-based</button>
              <button className={`px-3 py-2 rounded-xl border ${mode==='intensity'?'bg-black text-white':''}`} onClick={()=>setMode("intensity")}>Intensity-based</button>
            </div>
            <p className="text-xs text-gray-500">Capacity: cumulative tCO₂; Intensity: cumulative % reduction vs baseline.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Marginal Cost Model</label>
            <div className="flex gap-2">
              <button className={`px-3 py-2 rounded-xl border bg-black text-white`} disabled>Continuous (coloured)</button>
              <button className={`px-3 py-2 rounded-xl border ${costModel==='quadratic'?'bg-black text-white':''}`} onClick={()=>setCostModel("quadratic")}>Quadratic Fit</button>
            </div>
            <p className="text-xs text-gray-500">Chart uses continuous rectangles; optional quadratic fit shown on the right.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Baseline for <b>{selectedSector}</b></label>
            <div className="grid grid-cols-3 gap-2 items-center">
              <div className="col-span-1 text-xs text-gray-600">Production ({activeBaseline.production_label})</div>
              <input type="number" className="col-span-2 border rounded-xl px-3 py-2" value={activeBaseline.annual_production}
                onChange={(e)=>{ if(selectedSector==="All sectors") return; setBaselines({...baselines, [selectedSector]:{...activeBaseline, annual_production:Number(e.target.value)}}); }}/>
              <div className="col-span-1 text-xs text-gray-600">Emissions (tCO₂/yr)</div>
              <input type="number" className="col-span-2 border rounded-xl px-3 py-2" value={activeBaseline.annual_emissions}
                onChange={(e)=>{ if(selectedSector==="All sectors") return; setBaselines({...baselines, [selectedSector]:{...activeBaseline, annual_emissions:Number(e.target.value)}}); }}/>
            </div>
            <p className="text-xs text-gray-500">Baseline intensity: {formatNumber(baselineIntensity)} tCO₂ per {activeBaseline.production_label}.</p>
          </div>
        </section>

        {/* Wizard modal */}
        <MeasureWizard
          open={wizardOpen}
          onClose={()=>setWizardOpen(false)}
          onSave={(obj)=>{
            const id = Math.max(0, ...measures.map(m=>m.id)) + 1;
            setMeasures([...measures, { id, ...obj }]);
            setWizardOpen(false);
          }}
          sectors={DEFAULT_SECTORS}
          currency={currency}
        />

        {/* Continuous coloured MACC */}
        <section className="bg-white rounded-2xl shadow border p-6 space-y-4">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1">
              <h2 className="text-lg font-semibold mb-2">Sectoral MACC — {selectedSector} ({mode==='capacity'?'Cumulative tCO₂ abated':'Cumulative intensity reduction %'} on X; Marginal cost on Y)</h2>
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={axisData} margin={{ top:10, right:10, left:10, bottom:40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[0, mode==='intensity' ? 100 : totalWidth]}
                    tickFormatter={(v)=> mode==='capacity'? formatNumber(v) : Number(v).toFixed(1)+'%'}
                    label={{ value: mode==='capacity'?'Cumulative abatement (tCO₂)':'Cumulative intensity reduction (%)', position:'insideBottom', dy:20 }}
                  />
                  <YAxis
                    type="number"
                    domain={yDomain}
                    tickFormatter={(v)=> `${currency} ${formatNumber(v)}`}
                    label={{ value:`Marginal cost (${currency}/tCO₂)`, angle:-90, position:'insideLeft' }}
                  />
                  <Tooltip labelFormatter={(label)=>{ const v=Number(label); return mode==='capacity'? `${formatNumber(v)} tCO₂` : (Number.isFinite(v)? v.toFixed(2)+'%' : String(label)); }} />
                  <ReferenceLine y={0} stroke="#8884d8" strokeDasharray="4 4" />
                  {segments.map((s)=>(
                    <ReferenceArea key={s.id} x1={s.x1_plot} x2={s.x2_plot} y1={0} y2={s.cost} fill={s.color} fillOpacity={0.95} stroke="none" />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
              <ColorLegend items={segments.slice(0,16)} />
            </div>

            <div className="w-full lg:w-[380px]">
              <h3 className="text-base font-semibold mb-2">Target & Budget (greedy stack)</h3>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={100} step={1} value={targetIntensityPct} onChange={(e)=>setTargetIntensityPct(Number(e.target.value))}/>
                <div className="w-24 text-right">{targetIntensityPct}%</div>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <div>Target reached: <b>{mode==='capacity'? formatNumber(budgetToTarget.targetReached)+' tCO₂' : Math.min(100, budgetToTarget.targetReached).toFixed(2)+'%'}</b></div>
                <div>Budget required (Σ cost×tCO₂): <b>{currency} {formatNumber(budgetToTarget.budget)}</b></div>
              </div>

              {costModel==='quadratic' && quad && (
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
                        <XAxis dataKey="x" type="number" domain={[0, mode==='intensity' ? 100 : totalWidth]} tickFormatter={(v)=> mode==='capacity'? formatNumber(v) : Number(v).toFixed(1)+'%'} />
                        <YAxis tickFormatter={(v)=> `${currency} ${formatNumber(v)}`} />
                        <Tooltip />
                        <Line type="monotone" dataKey="y" name="Quadratic MACC" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500">Bars below zero indicate cost-saving measures. Defaults are placeholders — replace with plant data.</p>
        </section>

        {/* Measures table */}
        <section className="bg-white rounded-2xl shadow border p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Measures ({selectedSector})</h2>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 rounded-xl border" onClick={()=>setWizardOpen(true)}>+ Add measure</button>
              <button className="px-3 py-2 rounded-xl border" onClick={()=>fileInputRef.current?.click()}>Import CSV</button>
              <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={(e)=>{ const f=e.target.files?.[0]; if(!f) return; const reader=new FileReader(); reader.onload=()=> importCSV(csvToJson(String(reader.result))); reader.readAsText(f); e.currentTarget.value=''; }} />
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
                {measures.filter(m=> selectedSector==="All sectors" || m.sector===selectedSector).map((m)=>(
                  <tr key={m.id} className="border-b">
                    <td className="p-2"><input type="checkbox" checked={m.selected} onChange={(e)=>{ const copy=[...measures]; const pos=copy.findIndex(x=>x.id===m.id); copy[pos]={...m, selected:e.target.checked}; setMeasures(copy); }}/></td>
                    <td className="p-2"><input className="border rounded-lg px-2 py-1 w-56" value={m.name} onChange={(e)=>{ const copy=[...measures]; const pos=copy.findIndex(x=>x.id===m.id); copy[pos]={...m, name:e.target.value}; setMeasures(copy); }}/></td>
                    <td className="p-2">
                      <select className="border rounded-lg px-2 py-1" value={m.sector} onChange={(e)=>{ const copy=[...measures]; const pos=copy.findIndex(x=>x.id===m.id); copy[pos]={...m, sector:e.target.value}; setMeasures(copy); }}>
                        {DEFAULT_SECTORS.map((s)=> <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-2 text-right"><input type="number" className="border rounded-lg px-2 py-1 w-40 text-right" value={m.abatement_tco2} onChange={(e)=>{ const copy=[...measures]; const pos=copy.findIndex(x=>x.id===m.id); copy[pos]={...m, abatement_tco2:Number(e.target.value)}; setMeasures(copy); }}/></td>
                    <td className="p-2 text-right"><input type="number" className="border rounded-lg px-2 py-1 w-40 text-right" value={m.cost_per_tco2} onChange={(e)=>{ const copy=[...measures]; const pos=copy.findIndex(x=>x.id===m.id); copy[pos]={...m, cost_per_tco2:Number(e.target.value)}; setMeasures(copy); }}/></td>
                    <td className="p-2 text-right"><button className="px-2 py-1 rounded-lg border" onClick={()=> setMeasures(measures.filter(x=>x.id!==m.id))}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            CSV columns supported: <code>name, sector, abatement_tco2, cost_per_tco2, selected</code>.
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow border p-6">
          <h2 className="text-lg font-semibold mb-2">Methodology (India CCTS context)</h2>
          <ul className="list-disc pl-5 text-sm space-y-1 text-gray-700">
            <li><b>Sectors:</b> Nine CCTS-adjacent sectors preloaded.</li>
            <li><b>Ordering:</b> Sorted by marginal cost to form the MACC.</li>
            <li><b>Capacity view:</b> X = cumulative tCO₂; <b>Intensity view:</b> X = cumulative % reduction vs baseline (0–100%).</li>
            <li><b>Quadratic fit:</b> Least-squares fit of cost(x) over cumulative x (optional).</li>
            <li><b>Budget-to-target:</b> Greedy sum of cost×t until target reached.</li>
            <li><b>Data:</b> Drivers DB is editable; overrides per line are supported.</li>
          </ul>
        </section>

        <footer className="text-xs text-gray-500 text-center pb-8">Built for India CCTS exploration.</footer>
      </div>
    </div>
  );
}
