/* FULL MACCApp.jsx — fixed hover overlay parse error, DB-aware template, multi-line drivers, adoption & interpolation, carbon price, NPV/IRR, scrollable wizard, PNG export, timeseries viewer */

import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  XAxis, YAxis, Tooltip, CartesianGrid,
  Line, LineChart, ReferenceLine, ResponsiveContainer,
  ComposedChart, ReferenceArea, Customized,
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
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) { result.push(cur); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur);
    return result.map((s) => s.trim());
  };
  const headers = parseLine(lines.shift());
  return lines.map((line) => {
    const cells = parseLine(line); const obj = {};
    headers.forEach((h, i) => obj[h] = cells[i] !== undefined ? cells[i] : "");
    // Attempt to parse 'details' if it exists and is a stringified object
    if (obj.details) {
      try {
        obj.details = JSON.parse(obj.details);
      } catch (e) {
        console.error("Failed to parse details JSON:", e);
      }
    }
    return obj;
  });
}

function jsonToCsv(arr) {
  if (!arr || arr.length === 0) return "";
  // Ensure 'details' is a string before flattening to headers
  const processedArr = arr.map(row => {
    const newRow = { ...row };
    if (newRow.details) {
      newRow.details = JSON.stringify(newRow.details);
    }
    return newRow;
  });
  const headers = Object.keys(processedArr[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const headerLine = headers.map(esc).join(",");
  const body = processedArr.map((row) => headers.map((h) => esc(row[h])).join(",")).join("\n");
  return headerLine + "\n" + body;
}

function saveFile(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { }
  }, [key, value]);
  return [value, setValue];
}

function quadraticFit(xs, ys) {
  const n = xs.length; if (n < 3) return { a: 0, b: 0, c: 0 };
  let Sx = 0, Sx2 = 0, Sx3 = 0, Sx4 = 0, Sy = 0, Sxy = 0, Sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = Number(xs[i]); const y = Number(ys[i]); const x2 = x * x;
    Sx += x; Sx2 += x2; Sx3 += x2 * x; Sx4 += x2 * x2; Sy += y; Sxy += x * y; Sx2y += x2 * y;
  }
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [[n, Sx, Sx2], [Sx, Sx2, Sx3], [Sx2, Sx3, Sx4]];
  const My = [[Sy, Sx, Sx2], [Sxy, Sx2, Sx3], [Sx2y, Sx3, Sx4]];
  const Mb = [[n, Sy, Sx2], [Sx, Sxy, Sx3], [Sx2, Sx2y, Sx4]];
  const Mc = [[n, Sx, Sy], [Sx, Sx2, Sxy], [Sx2, Sx3, Sx2y]];
  const D = det(M); if (Math.abs(D) < 1e-12) return { a: 0, b: 0, c: 0 };
  return { a: det(My) / D, b: det(Mb) / D, c: det(Mc) / D };
}

/* Interpolation across 5‑year steps */
function interpolateSeries(series) {
  const s = [...series];
  let lastIdx = null;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "" || s[i] == null || !Number.isFinite(Number(s[i]))) continue;
    if (lastIdx === null) { lastIdx = i; continue; }
    const dv = (Number(s[i]) - Number(s[lastIdx])) / (i - lastIdx);
    for (let k = lastIdx + 1; k < i; k++) s[k] = Number(s[lastIdx]) + dv * (k - lastIdx);
    lastIdx = i;
  }
  return s;
}

/* Finance: NPV & IRR */
function npv(rate, amounts, years, baseYear) {
  const r = Number(rate);
  return amounts.reduce((acc, amt, i) => acc + (Number(amt) / Math.pow(1 + r, Math.max(0, years[i] - baseYear))), 0);
}

function irr(amounts, years, baseYear, guessLow = -0.9, guessHigh = 3.0, tol = 1e-6, maxIter = 100) {
  const f = (r) => npv(r, amounts, years, baseYear);
  let lo = guessLow, hi = guessHigh;
  let fLo = f(lo), fHi = f(hi);
  if (Number.isNaN(fLo) || Number.isNaN(fHi)) return null;
  if (fLo * fHi > 0) return null;
  for (let it = 0; it < maxIter; it++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < tol) return mid;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

/* Export chart SVG to PNG */
async function exportContainerSvgToPng(containerEl, filename = "macc.png", scale = 2) {
  if (!containerEl) return;
  const svg = containerEl.querySelector("svg");
  if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const image64 = "data:image/svg+xml;base64," + svg64;

  const img = new Image();
  const bbox = svg.getBBox ? svg.getBBox() : { width: svg.clientWidth, height: svg.clientHeight };
  const width = Math.ceil((bbox.width || svg.clientWidth || 800) * scale);
  const height = Math.ceil((bbox.height || svg.clientHeight || 360) * scale);

  await new Promise((resolve) => { img.onload = resolve; img.src = image64; });

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  });
}

/* ---------------- Defaults & Data Fetching ---------------- */

/* We load all data files from /public/data at runtime */
const DEFAULT_SECTORS = [];
const DEFAULT_BASELINES = {};
const FUELS = [];
const RAW = [];
const TRANSPORT = [];
const WASTE = [];
const ELECTRICITY = [];

// Normalize getters
const getUnitPrice = (row) => (row?.price ?? row?.price_per_unit_inr ?? 0);
const getEFperUnit = (row) => (row?.ef_tco2_per_unit ?? row?.ef_t_per_unit ?? 0);
const getElecPricePerMWh = (row) => (row?.price_per_mwh ?? row?.price_per_mwh_inr ?? 500);
const getElecEFperMWh = (row) => (row?.ef_tco2_per_mwh ?? 0.710);

/* ---------------- Colour palette ---------------- */
const PALETTE = ["#4e79a7","#f28e2b","#e15759","#76b7b2","#59a14f","#edc949","#af7aa1","#ff9da7","#9c755f","#bab0ab","#2f4b7c","#ffa600","#a05195","#003f5c","#d45087"];
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

/* ---------------- Measure Wizard (DB-aware, multi-line) ---------------- */
function MeasureWizard({ onClose, onSave, sectors, currency, carbonPrice, dataSources }) {
  const YEARS = [2020, 2025, 2030, 2035, 2040, 2045, 2050];
  const BASE_YEAR = YEARS[0];
  const CR_TO_RUPEES = 10_000_000;

  const { fuels: DS_FUELS, raw: DS_RAW, transport: DS_TRANSPORT, waste: DS_WASTE, electricity: DS_ELECTRICITY } = dataSources;

  const [tab, setTab] = useState("template");
  const [applyCarbonPriceInSave, setApplyCarbonPriceInSave] = useState(false);

  // Quick tab
  const [q, setQ] = useState({ name: "New Measure", sector: sectors[0] || "Power", abatement_tco2: 0, cost_per_tco2: 0, selected: true });

  // Template meta & adoption
  const [meta, setMeta] = useState({ project_name: "Industrial Efficiency Project", sector: sectors[0] || "Power", discount_rate: 0.10, project_life_years: 30 });
  const [adoption, setAdoption] = useState(YEARS.map((y, i) => i === 0 ? 0 : 0.2 * i));

  // Other direct tCO2e
  const [otherDirectT, setOtherDirectT] = useState(YEARS.map(() => 0));

  const makeZeros = () => YEARS.map(() => 0);
  const makeEmptyEf = () => YEARS.map(() => "");

  // Multi-line drivers with drift
  const [fuelLines, setFuelLines] = useState([
    { id: 1, name: DS_FUELS[0]?.name || "", priceOv: null, efOv: null, priceEscPctYr: 0, efEscPctYr: 0, delta: makeZeros() }
  ]);
  const [rawLines, setRawLines] = useState([
    { id: 1, name: DS_RAW[0]?.name || "", priceOv: null, efOv: null, priceEscPctYr: 0, efEscPctYr: 0, delta: makeZeros() }
  ]);
  const [transLines, setTransLines] = useState([
    { id: 1, name: DS_TRANSPORT[0]?.name || "", priceOv: null, efOv: null, priceEscPctYr: 0, efEscPctYr: 0, delta: makeZeros() }
  ]);
  const [wasteLines, setWasteLines] = useState([
    { id: 1, name: DS_WASTE[0]?.name || "", priceOv: null, efOv: null, priceEscPctYr: 0, efEscPctYr: 0, delta: makeZeros() }
  ]);
  const [elecLines, setElecLines] = useState([
    { id: 1, state: DS_ELECTRICITY[0]?.state || "India", priceOv: null, priceEscPctYr: 0, efEscPctYr: 0, efOvPerYear: makeEmptyEf(), deltaMWh: makeZeros() }
  ]);

  // Stack / finance (₹ cr)
  const [stack, setStack] = useState({
    opex_cr: YEARS.map(() => 0),
    savings_cr: YEARS.map(() => 0),
    other_cr: YEARS.map(() => 0),
    capex_upfront_cr: YEARS.map(() => 0),
    capex_financed_cr: YEARS.map(() => 0),
    financing_tenure_years: YEARS.map(() => 10),
    interest_rate_pct: YEARS.map(() => 7),
  });

  // Utilities
  const setSeries = (arr, setArr, idx, val) => {
    const out = [...arr]; out[idx] = (val === "" ? "" : Number(val)); setArr(out);
  };
  const updateLine = (list, setList, id, patch) => setList(list.map(l => l.id === id ? { ...l, ...patch } : l));
  const addLine = (list, setList, sample) => { const nextId = Math.max(0, ...list.map(l => l.id)) + 1; setList([...list, { id: nextId, ...sample }]); };
  const removeLine = (list, setList, id) => setList(list.filter(l => l.id !== id));

  const annuityFactor = (r, n) => {
    const R = Number(r), N = Number(n);
    if (!Number.isFinite(R) || !Number.isFinite(N) || N <= 0) return 0;
    if (Math.abs(R) < 1e-9) return 1 / N;
    return (R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
  };

  // Core compute
  const computed = useMemo(() => {
    const perYear = YEARS.map((year, i) => {
      const a = Math.max(0, Math.min(1, Number(adoption[i] || 0)));
      const yearsSinceBase = Math.max(0, year - BASE_YEAR);

      let fuel_t = 0, raw_t = 0, trans_t = 0, waste_t = 0, elec_t = 0;
      let driver_cr = 0;

      // Fuel lines
      for (const ln of fuelLines) {
        const base = DS_FUELS.find(x => x.name === ln.name);
        const basePrice = (ln.priceOv ?? getUnitPrice(base) ?? 0);
        const priceEsc = Number(ln.priceEscPctYr || 0) / 100;
        const effPrice = basePrice * Math.pow(1 + priceEsc, yearsSinceBase);

        const baseEf = (ln.efOv ?? getEFperUnit(base) ?? 0);
        const efEsc = Number(ln.efEscPctYr || 0) / 100;
        const effEf = baseEf * Math.pow(1 + efEsc, yearsSinceBase);

        const qty = a * Number(ln.delta[i] || 0);

        fuel_t += qty * effEf;
        driver_cr += (qty * effPrice) / CR_TO_RUPEES;
      }

      // Raw lines
      for (const ln of rawLines) {
        const base = DS_RAW.find(x => x.name === ln.name);
        const basePrice = (ln.priceOv ?? getUnitPrice(base) ?? 0);
        const priceEsc = Number(ln.priceEscPctYr || 0) / 100;
        const effPrice = basePrice * Math.pow(1 + priceEsc, yearsSinceBase);

        const baseEf = (ln.efOv ?? getEFperUnit(base) ?? 0);
        const efEsc = Number(ln.efEscPctYr || 0) / 100;
        const effEf = baseEf * Math.pow(1 + efEsc, yearsSinceBase);

        const qty = a * Number(ln.delta[i] || 0);

        raw_t += qty * effEf;
        driver_cr += (qty * effPrice) / CR_TO_RUPEES;
      }

      // Transport lines
      for (const ln of transLines) {
        const base = DS_TRANSPORT.find(x => x.name === ln.name);
        const basePrice = (ln.priceOv ?? getUnitPrice(base) ?? 0);
        const priceEsc = Number(ln.priceEscPctYr || 0) / 100;
        const effPrice = basePrice * Math.pow(1 + priceEsc, yearsSinceBase);

        const baseEf = (ln.efOv ?? getEFperUnit(base) ?? 0);
        const efEsc = Number(ln.efEscPctYr || 0) / 100;
        const effEf = baseEf * Math.pow(1 + efEsc, yearsSinceBase);

        const qty = a * Number(ln.delta[i] || 0);

        trans_t += qty * effEf;
        driver_cr += (qty * effPrice) / CR_TO_RUPEES;
      }

      // Water & waste lines
      for (const ln of wasteLines) {
        const base = DS_WASTE.find(x => x.name === ln.name);
        const basePrice = (ln.priceOv ?? getUnitPrice(base) ?? 0);
        const priceEsc = Number(ln.priceEscPctYr || 0) / 100;
        const effPrice = basePrice * Math.pow(1 + priceEsc, yearsSinceBase);

        const baseEf = (ln.efOv ?? getEFperUnit(base) ?? 0);
        const efEsc = Number(ln.efEscPctYr || 0) / 100;
        const effEf = baseEf * Math.pow(1 + efEsc, yearsSinceBase);

        const qty = a * Number(ln.delta[i] || 0);

        waste_t += qty * effEf;
        driver_cr += (qty * effPrice) / CR_TO_RUPEES;
      }

      // Electricity lines
      for (const ln of elecLines) {
        const base = DS_ELECTRICITY.find(x => x.state === ln.state) || DS_ELECTRICITY[0];
        const basePrice = (ln.priceOv ?? getElecPricePerMWh(base) ?? 0);
        const priceEsc = Number(ln.priceEscPctYr || 0) / 100;
        const effPrice = basePrice * Math.pow(1 + priceEsc, yearsSinceBase);

        const baseEf = (ln.efOvPerYear[i] !== "" && ln.efOvPerYear[i] != null)
          ? Number(ln.efOvPerYear[i])
          : getElecEFperMWh(base);
        const efEsc = Number(ln.efEscPctYr || 0) / 100;
        const effEf = (ln.efOvPerYear[i] !== "" && ln.efOvPerYear[i] != null)
          ? Number(ln.efOvPerYear[i])
          : baseEf * Math.pow(1 + efEsc, yearsSinceBase);

        const mwh = a * Number(ln.deltaMWh[i] || 0);

        elec_t += mwh * effEf;
        driver_cr += (mwh * effPrice) / CR_TO_RUPEES;
      }

      const other_t = a * Number(otherDirectT[i] || 0);
      const direct_t = fuel_t + raw_t + trans_t + waste_t + elec_t + other_t;

      // Stack & financing
      const opex_cr = Number(stack.opex_cr[i] || 0);
      const savings_cr = Number(stack.savings_cr[i] || 0);
      const other_cr = Number(stack.other_cr[i] || 0);
      const capex_upfront_cr = Number(stack.capex_upfront_cr[i] || 0);

      const capex_financed_cr = Number(stack.capex_financed_cr[i] || 0);
      const i_nominal = Number(stack.interest_rate_pct[i] || 0) / 100;
      const n_tenure = Number(stack.financing_tenure_years[i] || 0);
      const financedAnnual_cr = (capex_financed_cr > 0 && i_nominal > 0 && n_tenure > 0)
        ? capex_financed_cr * annuityFactor(i_nominal, n_tenure)
        : 0;

      const net_cost_cr = (driver_cr + opex_cr + other_cr - savings_cr) + financedAnnual_cr;

      // Cash flow in ₹
      const cashflow_inr_wo_cp = (savings_cr - opex_cr - driver_cr - other_cr - financedAnnual_cr - capex_upfront_cr) * CR_TO_RUPEES;
      const cashflow_inr_w_cp = cashflow_inr_wo_cp + (Number(carbonPrice || 0) * direct_t);

      const implied_cost_per_t_wo = direct_t > 0 ? (net_cost_cr * CR_TO_RUPEES) / direct_t : 0;
      const implied_cost_per_t_w = direct_t > 0 ? ((net_cost_cr * CR_TO_RUPEES) - (Number(carbonPrice || 0) * direct_t)) / direct_t : 0;

      return {
        year, direct_t, net_cost_cr,
        implied_cost_per_t_wo, implied_cost_per_t_w,
        cashflow_inr_wo_cp, cashflow_inr_w_cp,
        pieces: { fuel_t, raw_t, trans_t, waste_t, elec_t, other_t, driver_cr, opex_cr, other_cr, savings_cr, financedAnnual_cr, capex_upfront_cr }
      };
    });

    // Representative year
    let repIdx = perYear.findIndex(y => y.direct_t > 0);
    if (repIdx < 0) repIdx = YEARS.indexOf(2035) >= 0 ? YEARS.indexOf(2035) : Math.floor(YEARS.length / 2);

    // NPV & IRR
    const years = perYear.map(y => y.year);
    const flowsWO = perYear.map(y => y.cashflow_inr_wo_cp);
    const flowsW = perYear.map(y => y.cashflow_inr_w_cp);
    const r = Number(meta.discount_rate || 0.10);
    const npvWO = npv(r, flowsWO, years, BASE_YEAR);
    const npvW = npv(r, flowsW, years, BASE_YEAR);
    const irrWO = irr(flowsWO, years, BASE_YEAR);
    const irrW = irr(flowsW, years, BASE_YEAR);

    const sumDirect = perYear.reduce((s, y) => s + Math.max(0, y.direct_t), 0);
    const sumCostInrWO = perYear.reduce((s, y) => s + (y.net_cost_cr * CR_TO_RUPEES), 0);
    const sumCostInrW = perYear.reduce((s, y) => s + ((y.net_cost_cr * CR_TO_RUPEES) - Number(carbonPrice || 0) * y.direct_t), 0);
    const avgCostWO = sumDirect > 0 ? sumCostInrWO / sumDirect : 0;
    const avgCostW = sumDirect > 0 ? sumCostInrW / sumDirect : 0;

    return {
      YEARS, BASE_YEAR, perYear, repIdx,
      rep: perYear[repIdx] || { direct_t: 0, implied_cost_per_t_wo: 0, implied_cost_per_t_w: 0 },
      finance: { npvWO, npvW, irrWO, irrW, avgCostWO, avgCostW, sumDirect }
    };
  }, [adoption, fuelLines, rawLines, transLines, wasteLines, elecLines, otherDirectT, stack, meta.discount_rate, carbonPrice]);

  function saveQuick() {
    onSave({
      name: q.name, sector: q.sector,
      abatement_tco2: Number(q.abatement_tco2) || 0,
      cost_per_tco2: Number(q.cost_per_tco2) || 0,
      selected: !!q.selected,
      details: { mode: "quick" },
    });
  }

  function saveTemplate() {
    const repAbate = Math.max(0, computed.rep.direct_t);
    const repCost = applyCarbonPriceInSave ? computed.rep.implied_cost_per_t_w : computed.rep.implied_cost_per_t_wo;

    if (repAbate <= 0) {
      const ok = typeof window === "undefined" ? true :
        window.confirm("This measure has 0 tCO₂ abatement in the representative year. Save anyway? It won’t appear on the MACC until abatement > 0.");
      if (!ok) return;
    }

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
        adoption,
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
        representative_index: computed.repIdx,
        finance_summary: computed.finance,
        saved_cost_includes_carbon_price: !!applyCarbonPriceInSave,
        carbon_price_at_save: Number(carbonPrice || 0),
      },
    });
  }

  // Accessibility: ESC to close (always mounted while wizard is open)
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // UI rows
  const SeriesRow = ({ label, unit, series, onChange, onInterpolate }) => (
    <div className="grid grid-cols-2 sm:grid-cols-10 gap-2 items-center">
      <div className="text-sm font-medium col-span-2 sm:col-span-2">{label}</div>
      <div className="text-xs text-gray-500">{unit}</div>
      {computed.YEARS.map((y, i) => (
        <input
          key={y}
          type="number"
          className="border rounded-xl px-2 py-1 text-right"
          value={series[i]}
          onChange={(e) => onChange(i, e.target.value)}
        />
      ))}
      {onInterpolate && (
        <button type="button" className="text-xs px-2 py-1 rounded border" onClick={onInterpolate}>Interpolate</button>
      )}
    </div>
  );

  const LineHeader = ({ title, onRemove, showRemove = true }) => (
    <div className="flex items-center justify-between mt-3">
      <div className="text-sm uppercase tracking-wide text-gray-600">{title}</div>
      {showRemove && <button type="button" className="text-xs px-2 py-1 rounded border" onClick={onRemove}>Remove</button>}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4"
      role="dialog" aria-modal="true" aria-labelledby="measure-wizard-title"
    >
      <div className="bg-white w-full sm:max-w-6xl rounded-2xl shadow-xl border flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex gap-2">
            <button className={`px-3 py-1.5 rounded-xl border ${tab === 'quick' ? 'bg-black text-white' : ''}`} onClick={() => setTab('quick')}>Quick</button>
            <button className={`px-3 py-1.5 rounded-xl border ${tab === 'template' ? 'bg-black text-white' : ''}`} onClick={() => setTab('template')} id="measure-wizard-title">Template (DB-aware)</button>
          </div>
          <button className="px-3 py-1.5 rounded-xl border" onClick={onClose}>Close</button>
        </div>

        {/* Body (scrollable) */}
        <div className="p-4 overflow-y-auto">
          {tab === "quick" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-sm">Project name
                  <input className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.name} onChange={e => setQ({ ...q, name: e.target.value })} />
                </label>
                <label className="text-sm">Sector
                  <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.sector} onChange={e => setQ({ ...q, sector: e.target.value })}>
                    {sectors.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label className="text-sm">Abatement (tCO₂/yr)
                  <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.abatement_tco2} onChange={e => setQ({ ...q, abatement_tco2: Number(e.target.value) })} />
                </label>
                <label className="text-sm">Cost ({currency}/tCO₂)
                  <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={q.cost_per_tco2} onChange={e => setQ({ ...q, cost_per_tco2: Number(e.target.value) })} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={q.selected} onChange={e => setQ({ ...q, selected: e.target.checked })} /> Use in MACC
              </label>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="text-sm font-semibold text-gray-800">Project Metadata</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <label className="text-sm">Project name
                  <input className="mt-1 border rounded-xl px-3 py-2 w-full" value={meta.project_name} onChange={e => setMeta({ ...meta, project_name: e.target.value })} />
                </label>
                <label className="text-sm">Sector
                  <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={meta.sector} onChange={e => setMeta({ ...meta, sector: e.target.value })}>
                    {sectors.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label className="text-sm">Discount rate (real)
                  <input type="number" step="0.01" className="mt-1 border rounded-xl px-3 py-2 w-full" value={meta.discount_rate} onChange={e => setMeta({ ...meta, discount_rate: Number(e.target.value) })} />
                </label>
                <label className="text-sm">Project life (yrs)
                  <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={meta.project_life_years} onChange={e => setMeta({ ...meta, project_life_years: Number(e.target.value) })} />
                </label>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-sm font-semibold mb-2">Adoption profile (fraction 0–1)</div>
                <SeriesRow
                  label="Adoption fraction"
                  unit="share"
                  series={adoption}
                  onChange={(i, v) => setAdoption(adoption.map((vv, idx) => idx === i ? (v === "" ? "" : Math.max(0, Math.min(1, Number(v)))) : vv))}
                  onInterpolate={() => setAdoption(interpolateSeries(adoption))}
                />
                <div className="text-xs text-gray-500 mt-1">Applied multiplicatively to all Δ quantities (fuel/raw/transport/waste/electricity/other).</div>
              </div>

              {/* DRIVERS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-3 rounded-xl border">
                <div className="md:col-span-2 text-sm font-semibold text-gray-800">Driver & Emissions Lines</div>

                {/* Fuel group */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Fuel lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" onClick={() => addLine(fuelLines, setFuelLines, { name: DS_FUELS[0]?.name || "", priceOv: null, efOv: null, priceEscPctYr: 0, efEscPctYr: 0, delta: makeZeros() })}>+ Add fuel line</button>
                  </div>
                  {fuelLines.map((ln) => {
                    const base = DS_FUELS.find(x => x.name === ln.name);
                    const unit = base?.unit || "-";
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2 bg-white">
                        <LineHeader title="Fuel line" onRemove={() => removeLine(fuelLines, setFuelLines, ln.id)} />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <label className="text-sm col-span-2">Fuel
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.name} onChange={e => updateLine(fuelLines, setFuelLines, ln.id, { name: e.target.value })}>
                              {DS_FUELS.map(x => <option key={x.name}>{x.name}</option>)}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getUnitPrice(base)).toString()} value={ln.priceOv ?? ""} onChange={e => updateLine(fuelLines, setFuelLines, ln.id, { priceOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF override (tCO₂/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getEFperUnit(base)).toString()} value={ln.efOv ?? ""} onChange={e => updateLine(fuelLines, setFuelLines, ln.id, { efOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">Price drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.priceEscPctYr} onChange={e => updateLine(fuelLines, setFuelLines, ln.id, { priceEscPctYr: Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.efEscPctYr} onChange={e => updateLine(fuelLines, setFuelLines, ln.id, { efEscPctYr: Number(e.target.value) })} />
                          </label>
                        </div>
                        <SeriesRow
                          label={`ΔFuel quantity (${unit})`}
                          unit={unit}
                          series={ln.delta}
                          onChange={(i, v) => updateLine(fuelLines, setFuelLines, ln.id, { delta: ln.delta.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) })}
                          onInterpolate={() => updateLine(fuelLines, setFuelLines, ln.id, { delta: interpolateSeries(ln.delta) })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Raw group */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Raw material lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" onClick={() => addLine(rawLines, setRawLines, { name: DS_RAW[0]?.name || "", priceOv: null, efOv: null, priceEscPctYr: 0, efEscPctYr: 0, delta: makeZeros() })}>+ Add raw line</button>
                  </div>
                  {rawLines.map((ln) => {
                    const base = DS_RAW.find(x => x.name === ln.name);
                    const unit = base?.unit || "-";
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2 bg-white">
                        <LineHeader title="Raw material line" onRemove={() => removeLine(rawLines, setRawLines, ln.id)} />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <label className="text-sm col-span-2">Raw material
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.name} onChange={e => updateLine(rawLines, setRawLines, ln.id, { name: e.target.value })}>
                              {DS_RAW.map(x => <option key={x.name}>{x.name}</option>)}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getUnitPrice(base)).toString()} value={ln.priceOv ?? ""} onChange={e => updateLine(rawLines, setRawLines, ln.id, { priceOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF override (tCO₂/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getEFperUnit(base)).toString()} value={ln.efOv ?? ""} onChange={e => updateLine(rawLines, setRawLines, ln.id, { efOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">Price drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.priceEscPctYr} onChange={e => updateLine(rawLines, setRawLines, ln.id, { priceEscPctYr: Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.efEscPctYr} onChange={e => updateLine(rawLines, setRawLines, ln.id, { efEscPctYr: Number(e.target.value) })} />
                          </label>
                        </div>
                        <SeriesRow
                          label={`ΔRaw quantity (${unit})`}
                          unit={unit}
                          series={ln.delta}
                          onChange={(i, v) => updateLine(rawLines, setRawLines, ln.id, { delta: ln.delta.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) })}
                          onInterpolate={() => updateLine(rawLines, setRawLines, ln.id, { delta: interpolateSeries(ln.delta) })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Transport group */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Transport lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" onClick={() => addLine(transLines, setTransLines, { name: DS_TRANSPORT[0]?.name || "", priceOv: null, efOv: null, priceEscPctYr: 0, efEscPctYr: 0, delta: makeZeros() })}>+ Add transport line</button>
                  </div>
                  {transLines.map((ln) => {
                    const base = DS_TRANSPORT.find(x => x.name === ln.name);
                    const unit = base?.unit || "-";
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2 bg-white">
                        <LineHeader title="Transport line" onRemove={() => removeLine(transLines, setTransLines, ln.id)} />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <label className="text-sm col-span-2">Transport
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.name} onChange={e => updateLine(transLines, setTransLines, ln.id, { name: e.target.value })}>
                              {DS_TRANSPORT.map(x => <option key={x.name}>{x.name}</option>)}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getUnitPrice(base)).toString()} value={ln.priceOv ?? ""} onChange={e => updateLine(transLines, setTransLines, ln.id, { priceOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF override (tCO₂/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getEFperUnit(base)).toString()} value={ln.efOv ?? ""} onChange={e => updateLine(transLines, setTransLines, ln.id, { efOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">Price drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.priceEscPctYr} onChange={e => updateLine(transLines, setTransLines, ln.id, { priceEscPctYr: Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.efEscPctYr} onChange={e => updateLine(transLines, setTransLines, ln.id, { efEscPctYr: Number(e.target.value) })} />
                          </label>
                        </div>
                        <SeriesRow
                          label={`ΔTransport activity (${unit})`}
                          unit={unit}
                          series={ln.delta}
                          onChange={(i, v) => updateLine(transLines, setTransLines, ln.id, { delta: ln.delta.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) })}
                          onInterpolate={() => updateLine(transLines, setTransLines, ln.id, { delta: interpolateSeries(ln.delta) })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Water & waste group */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Water & waste lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" onClick={() => addLine(wasteLines, setWasteLines, { name: DS_WASTE[0]?.name || "", priceOv: null, efOv: null, priceEscPctYr: 0, efEscPctYr: 0, delta: makeZeros() })}>+ Add water/waste line</button>
                  </div>
                  {wasteLines.map((ln) => {
                    const base = DS_WASTE.find(x => x.name === ln.name);
                    const unit = base?.unit || "-";
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2 bg-white">
                        <LineHeader title="Water & waste line" onRemove={() => removeLine(wasteLines, setWasteLines, ln.id)} />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <label className="text-sm col-span-2">Water/Waste
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.name} onChange={e => updateLine(wasteLines, setWasteLines, ln.id, { name: e.target.value })}>
                              {DS_WASTE.map(x => <option key={x.name}>{x.name}</option>)}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getUnitPrice(base)).toString()} value={ln.priceOv ?? ""} onChange={e => updateLine(wasteLines, setWasteLines, ln.id, { priceOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF override (tCO₂/{unit})
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getEFperUnit(base)).toString()} value={ln.efOv ?? ""} onChange={e => updateLine(wasteLines, setWasteLines, ln.id, { efOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">Price drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.priceEscPctYr} onChange={e => updateLine(wasteLines, setWasteLines, ln.id, { priceEscPctYr: Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.efEscPctYr} onChange={e => updateLine(wasteLines, setWasteLines, ln.id, { efEscPctYr: Number(e.target.value) })} />
                          </label>
                        </div>
                        <SeriesRow
                          label={`ΔWater/waste quantity (${unit})`}
                          unit={unit}
                          series={ln.delta}
                          onChange={(i, v) => updateLine(wasteLines, setWasteLines, ln.id, { delta: ln.delta.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) })}
                          onInterpolate={() => updateLine(wasteLines, setWasteLines, ln.id, { delta: interpolateSeries(ln.delta) })}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Electricity group (spans 2 columns) */}
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Electricity lines</div>
                    <button type="button" className="text-xs px-2 py-1 rounded border" onClick={() => addLine(elecLines, setElecLines, { state: DS_ELECTRICITY[0]?.state || "India", priceOv: null, priceEscPctYr: 0, efEscPctYr: 0, efOvPerYear: makeEmptyEf(), deltaMWh: makeZeros() })}>+ Add electricity line</button>
                  </div>
                  {elecLines.map((ln) => {
                    const base = DS_ELECTRICITY.find(x => x.state === ln.state) || DS_ELECTRICITY[0];
                    return (
                      <div key={ln.id} className="mt-2 rounded-lg border p-2 bg-white">
                        <LineHeader title="Electricity line" onRemove={() => removeLine(elecLines, setElecLines, ln.id)} />
                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 mt-2">
                          <label className="text-sm sm:col-span-2">State
                            <select className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.state} onChange={e => updateLine(elecLines, setElecLines, ln.id, { state: e.target.value })}>
                              {DS_ELECTRICITY.map(e => <option key={e.state}>{e.state}</option>)}
                            </select>
                          </label>
                          <label className="text-sm">Price override (₹/MWh)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" placeholder={(getElecPricePerMWh(base)).toString()} value={ln.priceOv ?? ""} onChange={e => updateLine(elecLines, setElecLines, ln.id, { priceOv: e.target.value === "" ? null : Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">Price drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.priceEscPctYr} onChange={e => updateLine(elecLines, setElecLines, ln.id, { priceEscPctYr: Number(e.target.value) })} />
                          </label>
                          <label className="text-sm">EF drift (%/yr)
                            <input type="number" className="mt-1 border rounded-xl px-3 py-2 w-full" value={ln.efEscPctYr} onChange={e => updateLine(elecLines, setElecLines, ln.id, { efEscPctYr: Number(e.target.value) })} />
                          </label>
                        </div>
                        <SeriesRow
                          label="ΔElectricity use"
                          unit="MWh"
                          series={ln.deltaMWh}
                          onChange={(i, v) => updateLine(elecLines, setElecLines, ln.id, { deltaMWh: ln.deltaMWh.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) })}
                          onInterpolate={() => updateLine(elecLines, setElecLines, ln.id, { deltaMWh: interpolateSeries(ln.deltaMWh) })}
                        />
                        <div className="mt-2">
                          <SeriesRow
                            label="EF override (blank = use state/EF drift)"
                            unit="tCO₂/MWh"
                            series={ln.efOvPerYear}
                            onChange={(i, v) => updateLine(elecLines, setElecLines, ln.id, { efOvPerYear: ln.efOvPerYear.map((vv, idx) => idx === i ? v : vv) })}
                            onInterpolate={() => updateLine(elecLines, setElecLines, ln.id, { efOvPerYear: interpolateSeries(ln.efOvPerYear) })}
                          />
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
                  label="Other direct reduction"
                  unit="tCO₂e"
                  series={otherDirectT}
                  onChange={(i, v) => setSeries(otherDirectT, setOtherDirectT, i, v)}
                  onInterpolate={() => setOtherDirectT(interpolateSeries(otherDirectT))}
                />
              </div>

              {/* Stack & finance */}
              <div className="rounded-xl border p-3">
                <div className="text-sm font-semibold mb-2">Cost stack & financing (₹ cr)</div>
                <SeriesRow label="Opex" unit="₹ cr" series={stack.opex_cr} onChange={(i, v) => setStack(s => ({ ...s, opex_cr: s.opex_cr.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) }))} />
                <SeriesRow label="Savings" unit="₹ cr" series={stack.savings_cr} onChange={(i, v) => setStack(s => ({ ...s, savings_cr: s.savings_cr.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) }))} />
                <SeriesRow label="Other (e.g., manpower)" unit="₹ cr" series={stack.other_cr} onChange={(i, v) => setStack(s => ({ ...s, other_cr: s.other_cr.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) }))} />
                <SeriesRow label="Capex upfront" unit="₹ cr" series={stack.capex_upfront_cr} onChange={(i, v) => setStack(s => ({ ...s, capex_upfront_cr: s.capex_upfront_cr.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) }))} />
                <SeriesRow label="Capex financed" unit="₹ cr" series={stack.capex_financed_cr} onChange={(i, v) => setStack(s => ({ ...s, capex_financed_cr: s.capex_financed_cr.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) }))} />
                <SeriesRow label="Financing tenure" unit="years" series={stack.financing_tenure_years} onChange={(i, v) => setStack(s => ({ ...s, financing_tenure_years: s.financing_tenure_years.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) }))} />
                <SeriesRow label="Interest rate" unit="%" series={stack.interest_rate_pct} onChange={(i, v) => setStack(s => ({ ...s, interest_rate_pct: s.interest_rate_pct.map((vv, idx) => idx === i ? (v === "" ? "" : Number(v)) : vv) }))} />
              </div>

              {/* Roll-ups */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-xl p-3 border">
                  <div>
                    <div className="text-gray-500">Representative year</div>
                    <div className="font-semibold">{computed.YEARS[computed.repIdx]}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Rep. direct abatement</div>
                    <div className="font-semibold">{formatNumber(computed.rep.direct_t)} tCO₂e</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Rep. cost (w/o CP)</div>
                    <div className="font-semibold">{currency} {formatNumber(computed.rep.implied_cost_per_t_wo)} / tCO₂e</div>
                  </div>
                  <div className="sm:col-span-3">
                    <div className="text-gray-500">Rep. cost (with CP = {currency} {formatNumber(carbonPrice)}/tCO₂)</div>
                    <div className="font-semibold">{currency} {formatNumber(computed.rep.implied_cost_per_t_w)} / tCO₂e</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm bg-gray-50 rounded-xl p-3 border">
                  <div>
                    <div className="text-gray-500">NPV (w/o CP)</div>
                    <div className="font-semibold">{currency} {formatNumber(computed.finance.npvWO / CR_TO_RUPEES)} cr</div>
                  </div>
                  <div>
                    <div className="text-gray-500">NPV (with CP)</div>
                    <div className="font-semibold">{currency} {formatNumber(computed.finance.npvW / CR_TO_RUPEES)} cr</div>
                  </div>
                  <div>
                    <div className="text-gray-500">IRR (w/o CP)</div>
                    <div className="font-semibold">{computed.finance.irrWO != null ? (computed.finance.irrWO * 100).toFixed(2) + "%" : "—"}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">IRR (with CP)</div>
                    <div className="font-semibold">{computed.finance.irrW != null ? (computed.finance.irrW * 100).toFixed(2) + "%" : "—"}</div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-gray-500">Average cost over life</div>
                    <div className="font-semibold">
                      w/o CP: {currency} {formatNumber(computed.finance.avgCostWO)} / tCO₂e &nbsp;|&nbsp;
                      with CP: {currency} {formatNumber(computed.finance.avgCostW)} / tCO₂e
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="p-3 border-t bg-white sticky bottom-0 flex items-center justify-end gap-2">
          {tab !== "quick" && (
            <label className="mr-auto flex items-center gap-2 text-xs">
              <input type="checkbox" checked={applyCarbonPriceInSave} onChange={(e) => setApplyCarbonPriceInSave(e.target.checked)} />
              Save cost including carbon price ({currency} {formatNumber(carbonPrice)}/tCO₂)
            </label>
          )}
          <button className="px-4 py-2 rounded-xl border" onClick={onClose}>Cancel</button>
          {tab === "quick" ? (
            <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={saveQuick}>Save measure</button>
          ) : (
            <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={saveTemplate}>
              Save measure
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Hover overlay (fix for parse error) ---------------- */
function HoverOverlay(props) {
  const { segments, maccRef, setHoverInfo, xAxisMap, yAxisMap, offset } = props;

  const xKey = xAxisMap ? Object.keys(xAxisMap)[0] : null;
  const yKey = yAxisMap ? Object.keys(yAxisMap)[0] : null;
  if (!xKey || !yKey) return null;

  const xScale = xAxisMap[xKey].scale;
  const yScale = yAxisMap[yKey].scale;
  const offL = (offset && offset.left) || 0;
  const offT = (offset && offset.top) || 0;

  return (
    <g>
      {segments.map((s) => {
        const x1 = xScale(s.x1_plot) + offL;
        const x2 = xScale(s.x2_plot) + offL;
        const y0 = yScale(0) + offT;
        const yC = yScale(s.cost) + offT;
        const x = Math.min(x1, x2);
        const y = Math.min(y0, yC);
        const w = Math.max(1, Math.abs(x2 - x1));
        const h = Math.max(1, Math.abs(yC - y0));
        return (
          <rect
            key={`hover-${s.id}`}
            x={x} y={y} width={w} height={h}
            fill="rgba(0,0,0,0)" stroke="none"
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              const rect = maccRef?.current?.getBoundingClientRect?.();
              const localX = e.clientX - ((rect && rect.left) || 0);
              const localY = e.clientY - ((rect && rect.top) || 0);
              setHoverInfo({ seg: s, x: localX + 10, y: localY + 10 });
            }}
            onMouseMove={(e) => {
              const rect = maccRef?.current?.getBoundingClientRect?.();
              const localX = e.clientX - ((rect && rect.left) || 0);
              const localY = e.clientY - ((rect && rect.top) || 0);
              setHoverInfo({ seg: s, x: localX + 10, y: localY + 10 });
            }}
            onMouseLeave={() => setHoverInfo(null)}
          />
        );
      })}
    </g>
  );
}

/* ---------------- Main Component ---------------- */

// Minimal error boundary
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error(err, info); }
  render() { return this.state.hasError ? <div className="p-6 text-red-600">Something went wrong.</div> : this.props.children; }
}

function MACCAppInner() {
  const fileInputRef = useRef(null);
  const maccRef = useRef(null);

  const [measures, setMeasures] = useLocalStorage("macc_measures", null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dataError, setDataError] = useState(null);
  const [dataSources, setDataSources] = useState({
    sectors: [], baselines: {}, measures: [], fuels: [], raw: [], transport: [], waste: [], electricity: []
  });

  // Fetch initial data on component mount
  useEffect(() => {
    async function fetchData() {
      try {
        const [
          measuresCsvResponse,
          sectorsResponse,
          baselinesResponse,
          fuelsResponse,
          rawResponse,
          transportResponse,
          wasteResponse,
          electricityResponse
        ] = await Promise.all([
          fetch('/data/measures.csv'),
          fetch('/data/sectors.json'),
          fetch('/data/baselines.json'),
          fetch('/data/fuels.json'),
          fetch('/data/raw.json'),
          fetch('/data/transport.json'),
          fetch('/data/waste.json'),
          fetch('/data/electricity.json')
        ]);

        if (!measuresCsvResponse.ok) throw new Error('Failed to load measures.csv');
        if (!sectorsResponse.ok) throw new Error('Failed to load sectors.json');
        if (!baselinesResponse.ok) throw new Error('Failed to load baselines.json');
        if (!fuelsResponse.ok) throw new Error('Failed to load fuels.json');
        if (!rawResponse.ok) throw new Error('Failed to load raw.json');
        if (!transportResponse.ok) throw new Error('Failed to load transport.json');
        if (!wasteResponse.ok) throw new Error('Failed to load waste.json');
        if (!electricityResponse.ok) throw new Error('Failed to load electricity.json');

        const measuresText = await measuresCsvResponse.text();
        const sectorsJson = await sectorsResponse.json();
        const baselinesJson = await baselinesResponse.json();
        const fuelsJson = await fuelsResponse.json();
        const rawJson = await rawResponse.json();
        const transportJson = await transportResponse.json();
        const wasteJson = await wasteResponse.json();
        const electricityJson = await electricityResponse.json();

        const parsedMeasures = csvToJson(measuresText);
        const initialMeasures = parsedMeasures.map((m, i) => ({
          ...m,
          id: m.id ? Number(m.id) : i + 1,
          abatement_tco2: Number(m.abatement_tco2),
          cost_per_tco2: Number(m.cost_per_tco2),
          selected: String(m.selected ?? "true").toLowerCase() !== "false"
        }));

        setDataSources({
          sectors: sectorsJson,
          baselines: baselinesJson,
          measures: initialMeasures,
          fuels: fuelsJson,
          raw: rawJson,
          transport: transportJson,
          waste: wasteJson,
          electricity: electricityJson
        });
        setDataError(null);
      } catch (error) {
        console.error("Failed to load initial data:", error);
        setDataError(`Failed to load data: ${error.message}. Please ensure all data files are in your 'public/data' directory.`);
      } finally {
        setDataLoaded(true);
      }
    }

    const localMeasures = localStorage.getItem("macc_measures");
    if (!localMeasures || localMeasures === "null") {
      fetchData();
    } else {
      const loadDataFromLocalStorage = async () => {
        try {
          const [
            sectorsResponse, baselinesResponse, fuelsResponse, rawResponse, transportResponse, wasteResponse, electricityResponse
          ] = await Promise.all([
            fetch('/data/sectors.json'),
            fetch('/data/baselines.json'),
            fetch('/data/fuels.json'),
            fetch('/data/raw.json'),
            fetch('/data/transport.json'),
            fetch('/data/waste.json'),
            fetch('/data/electricity.json')
          ]);

          if (!sectorsResponse.ok) throw new Error('Failed to load sectors.json');
          if (!baselinesResponse.ok) throw new Error('Failed to load baselines.json');
          if (!fuelsResponse.ok) throw new Error('Failed to load fuels.json');
          if (!rawResponse.ok) throw new Error('Failed to load raw.json');
          if (!transportResponse.ok) throw new Error('Failed to load transport.json');
          if (!wasteResponse.ok) throw new Error('Failed to load waste.json');
          if (!electricityResponse.ok) throw new Error('Failed to load electricity.json');

          const sectorsJson = await sectorsResponse.json();
          const baselinesJson = await baselinesResponse.json();
          const fuelsJson = await fuelsResponse.json();
          const rawJson = await rawResponse.json();
          const transportJson = await transportResponse.json();
          const wasteJson = await wasteResponse.json();
          const electricityJson = await electricityResponse.json();

          const parsedLocalMeasures = JSON.parse(localMeasures || "[]").map((m, i) => ({
            ...m,
            id: m.id ?? (i + 1),
            abatement_tco2: Number(m.abatement_tco2),
            cost_per_tco2: Number(m.cost_per_tco2),
            selected: String(m.selected ?? "true").toLowerCase() !== "false"
          }));

          setDataSources({
            sectors: sectorsJson,
            baselines: baselinesJson,
            measures: parsedLocalMeasures,
            fuels: fuelsJson,
            raw: rawJson,
            transport: transportJson,
            waste: wasteJson,
            electricity: electricityJson
          });
          setDataLoaded(true);
          setDataError(null);
        } catch (error) {
          console.error("Failed to load a data file from public/data:", error);
          setDataError(`Failed to load a data file from 'public/data': ${error.message}`);
          setDataLoaded(true);
        }
      };
      loadDataFromLocalStorage();
    }
  }, [setMeasures]);

  const [mode, setMode] = useLocalStorage("macc_mode", "capacity");
  const [costModel, setCostModel] = useLocalStorage("macc_costModel", "step");
  const [currency, setCurrency] = useLocalStorage("macc_currency", "₹");
  const [fitPositiveCostsOnly, setFitPositiveCostsOnly] = useLocalStorage("macc_fitPositiveCostsOnly", false);
  const [sectors, setSectors] = useLocalStorage("macc_sectors", DEFAULT_SECTORS);
  const [selectedSector, setSelectedSector] = useLocalStorage("macc_selected_sector", "All sectors");
  const [carbonPrice, setCarbonPrice] = useLocalStorage("macc_carbon_price", 0);

  const [baselines, setBaselines] = useLocalStorage("macc_baselines", DEFAULT_BASELINES);

  // Populate core states once dataSources is ready
  useEffect(() => {
    if ((dataSources.sectors?.length ?? 0) > 0 && (dataSources.measures?.length ?? 0) > 0) {
      setSectors(dataSources.sectors);
      setBaselines(dataSources.baselines);
      setMeasures(dataSources.measures);
    }
  }, [dataSources, setSectors, setBaselines, setMeasures]);

  const sectorOptions = useMemo(() => ["All sectors", ...sectors], [sectors]);

  const activeBaseline = useMemo(() => {
    if (selectedSector === "All sectors") {
      const emissions = Object.values(baselines).reduce((s, b) => s + Number(b.annual_emissions || 0), 0);
      const production = Object.values(baselines).reduce((s, b) => s + Number(b.annual_production || 0), 0);
      return { production_label: "units", annual_production: production, annual_emissions: emissions };
    }
    return baselines[selectedSector] || { production_label: "units", annual_production: 1, annual_emissions: 1 };
  }, [selectedSector, baselines]);

  const filtered = useMemo(() =>
    (measures || []).filter(m => m.selected && (selectedSector === "All sectors" || m.sector === selectedSector)),
    [measures, selectedSector]
  );

  const sorted = useMemo(() => {
    const copy = filtered.map(m => ({
      ...m,
      effective_cost: Number(m.cost_per_tco2 || 0) - Number(carbonPrice || 0)
    }));
    copy.sort((a, b) => (a.effective_cost || 0) - (b.effective_cost || 0));
    return copy;
  }, [filtered, carbonPrice]);

  const totals = useMemo(() => {
    const totalAbatement = filtered.reduce((s, m) => s + Number(m.abatement_tco2 || 0), 0);
    const avgCost = filtered.length ? filtered.reduce((s, m) => s + Number(m.cost_per_tco2 || 0), 0) / filtered.length : 0;
    const negCostAbatement = sorted.filter(m => (m.effective_cost) < 0).reduce((s, m) => s + Number(m.abatement_tco2 || 0), 0);
    return { totalAbatement, avgCost, negCostAbatement };
  }, [filtered, sorted]);

  const baselineIntensity = useMemo(() => {
    const prod = Number(activeBaseline.annual_production || 0);
    const emis = Number(activeBaseline.annual_emissions || 0);
    return prod > 0 ? emis / prod : 0;
  }, [activeBaseline]);

  const { segments, totalX } = useMemo(() => {
    let cum = 0; const segs = [];
    sorted.forEach((m, idx) => {
      const A = Number(m.abatement_tco2 || 0);
      const C = Number(m.effective_cost || 0);
      if (!Number.isFinite(A) || !Number.isFinite(C) || A <= 0) return;
      const x1_cap = cum, x2_cap = cum + Math.max(0, A); cum = x2_cap;
      const denom = Number(activeBaseline.annual_emissions || 0);
      const x1_plot = (mode === "capacity") ? x1_cap : (denom > 0 ? (x1_cap / denom) * 100 : 0);
      const x2_plot = (mode === "capacity") ? x2_cap : (denom > 0 ? (x2_cap / denom) * 100 : 0);
      segs.push({ id: m.id, name: m.name, sector: m.sector, x1_plot, x2_plot, cost: C, abatement: A, color: PALETTE[idx % PALETTE.length] });
    });
    const totalX_plot = segs.length ? segs[segs.length - 1].x2_plot : 0;
    return { segments: segs, totalX: totalX_plot };
  }, [sorted, mode, activeBaseline.annual_emissions]);

  const maccData = useMemo(() => {
    let cumAbate = 0; const points = [];
    for (const m of sorted) {
      const A = Number(m.abatement_tco2 || 0); const C = Number(m.effective_cost || 0);
      cumAbate += Math.max(0, A);
      const xCapacity = cumAbate;
      const xIntensityPct = activeBaseline.annual_emissions > 0 ? (cumAbate / activeBaseline.annual_emissions) * 100 : 0;
      const x = mode === "capacity" ? xCapacity : xIntensityPct;
      points.push({ id: m.id, name: m.name, sector: m.sector, abatement: A, cost: C, cumAbate, x });
    }
    return points;
  }, [sorted, mode, activeBaseline.annual_emissions]);

  const quad = useMemo(() => {
    const dataToFit = fitPositiveCostsOnly ? maccData.filter(p => p.cost >= 0) : maccData;
    if (dataToFit.length < 3) {
      return null;
    }
    const xs = dataToFit.map(p => p.x);
    const ys = dataToFit.map(p => p.cost);
    const { a, b, c } = quadraticFit(xs, ys);
    const fitted = maccData.map(p => ({ x: p.x, y: a + b * p.x + c * p.x * p.x }));
    return { a, b, c, fitted };
  }, [maccData, fitPositiveCostsOnly]);

  // Guard the fit branch; auto-fallback to step if not enough points
  useEffect(() => {
    if (costModel === 'fit' && !quad) setCostModel('step');
  }, [costModel, quad, setCostModel]);

  const [targetIntensityPct, setTargetIntensityPct] = useLocalStorage("macc_targetIntensityPct", 20);
  const budgetToTarget = useMemo(() => {
    if (!maccData.length) return { targetReached: 0, budget: 0 };
    const targetX = mode === "capacity" ? (activeBaseline.annual_emissions * (targetIntensityPct / 100)) : targetIntensityPct;
    let cum = 0, budget = 0, reached = 0;
    for (const p of maccData) {
      const remaining = Math.max(0, targetX - cum);
      const take = Math.min(remaining, p.abatement);
      if (take > 0) { budget += take * p.cost; cum += take; reached = mode === "capacity" ? cum : (cum / activeBaseline.annual_emissions * 100); }
    }
    return { targetReached: reached, budget };
  }, [maccData, activeBaseline.annual_emissions, mode, targetIntensityPct]);

  const totalWidth = useMemo(() => (mode === 'capacity' ? (totalX > 0 ? totalX : 1) : Math.max(100, totalX || 1)), [totalX, mode]);
  const axisData = useMemo(() => [{ x: 0 }, { x: totalWidth > 0 ? totalWidth : 1 }], [totalWidth]);
  const yDomain = useMemo(() => {
    if (!segments.length) return [0, 1];
    const ys = segments.map(s => Number(s.cost) || 0);
    const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
    return minY === maxY ? [minY - 1, maxY + 1] : [minY, maxY];
  }, [segments]);

  const [wizardOpen, setWizardOpen] = useState(false);
  const addMeasure = () => setWizardOpen(true);
  const saveWizard = (obj) => {
    const id = Math.max(0, ...(measures || []).map(m => m.id)) + 1;
    setMeasures([...(measures || []), { id, ...obj }]);
    setWizardOpen(false);
  };

  const importCSV = (rows) => {
    const parsed = rows.map((r, i) => ({
      id: i + 1 + (measures?.length || 0),
      name: r.name || r.Measure || r.intervention || `Row ${i + 1}`,
      sector: r.sector || r.Sector || "Power",
      abatement_tco2: Number(r.abatement_tco2 || r.abatement || r.Abatement || 0),
      cost_per_tco2: Number(r.cost_per_tco2 || r.cost || r.Cost || 0),
      selected: String(r.selected ?? "true").toLowerCase() !== "false",
      details: r.details,
    }));
    setMeasures([...(measures || []), ...parsed]);
  };
  const exportCSV = () => { const rows = (measures || []).map(({ id, ...rest }) => rest); saveFile("macc_measures.csv", jsonToCsv(rows)); };
  const clearAll = () => { if (typeof window !== 'undefined' && window.confirm("Clear all measures? This cannot be undone.")) setMeasures([]); };

  const [inspectedId, setInspectedId] = useState(null);
  const inspected = useMemo(() => (measures || []).find(m => m.id === inspectedId), [measures, inspectedId]);
  const inspectedSeries = useMemo(() => {
    const per = inspected?.details?.per_year;
    const years = inspected?.details?.years;
    if (!per || !years) return null;
    return years.map((year, idx) => ({
      year,
      direct_t: Number(per[idx]?.direct_t || 0),
      net_cost_cr: Number(per[idx]?.net_cost_cr || 0),
    }));
  }, [inspected]);

  const [hoverInfo, setHoverInfo] = useState(null);

  if (!dataLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col">
        <div className="w-12 h-12 rounded-full animate-spin border-4 border-solid border-gray-300 border-t-transparent mb-4"></div>
        <div className="text-xl text-gray-700">Loading data...</div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative max-w-lg text-center" role="alert">
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline ml-2">{dataError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="bg-white rounded-2xl shadow border p-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">India CCTS – Marginal Abatement Cost Curve (MACC) Builder</h1>
              <p className="text-gray-600 mt-1">Editable MACC with DB-aware project template, adoption ramps, finance metrics & hoverable columns.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="border rounded-xl px-3 py-2" value={selectedSector} onChange={(e) => setSelectedSector(e.target.value)}>
                {sectorOptions.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select className="border rounded-xl px-3 py-2" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option>₹</option><option>$</option><option>€</option>
              </select>

              {/* Carbon price */}
              <div className="flex items-center gap-2 border rounded-xl px-3 py-2">
                <span className="text-sm">Carbon price</span>
                <input type="number" className="w-24 border rounded-lg px-2 py-1 text-right" value={carbonPrice} onChange={(e) => setCarbonPrice(Number(e.target.value))} />
                <span className="text-sm">{currency}/tCO₂</span>
              </div>

              <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={exportCSV}>Export CSV</button>
              <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={clearAll}>Clear</button>
              <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={addMeasure}>+ Add measure</button>
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
            <p className="text-xs text-gray-500">Capacity: cumulative tCO₂; Intensity: cumulative % reduction vs baseline.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Marginal Cost Model</label>
            <div className="flex gap-2">
              <button className={`px-3 py-2 rounded-xl border ${costModel === 'step' ? 'bg-black text-white' : ''}`} onClick={() => setCostModel("step")}>Continuous (coloured)</button>
              <button className={`px-3 py-2 rounded-xl border ${costModel === 'fit' ? 'bg-black text-white' : ''}`} onClick={() => { if (maccData.length >= 3) setCostModel("fit"); }}>Quadratic Fit</button>
            </div>
            {costModel === 'fit' && (
              <div className="mt-2 text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  id="fit-positive-costs-only"
                  checked={fitPositiveCostsOnly}
                  onChange={(e) => setFitPositiveCostsOnly(e.target.checked)}
                  className="form-checkbox"
                />
                <label htmlFor="fit-positive-costs-only" className="text-gray-700 cursor-pointer">
                  Fit curve to positive costs only
                </label>
              </div>
            )}
            <p className="text-xs text-gray-500">Costs in MACC reflect <b>saved cost − carbon price</b>.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Baseline for <b>{selectedSector}</b></label>
            <div className="grid grid-cols-3 gap-2 items-center">
              <div className="col-span-1 text-xs text-gray-600">Production ({activeBaseline.production_label})</div>
              <input
                type="number"
                className="col-span-2 border rounded-xl px-3 py-2"
                value={activeBaseline.annual_production}
                onChange={(e) => {
                  if (selectedSector === "All sectors") return;
                  setBaselines({ ...baselines, [selectedSector]: { ...activeBaseline, annual_production: Number(e.target.value) } });
                }}
              />
              <div className="col-span-1 text-xs text-gray-600">Emissions (tCO₂/yr)</div>
              <input
                type="number"
                className="col-span-2 border rounded-xl px-3 py-2"
                value={activeBaseline.annual_emissions}
                onChange={(e) => {
                  if (selectedSector === "All sectors") return;
                  setBaselines({ ...baselines, [selectedSector]: { ...activeBaseline, annual_emissions: Number(e.target.value) } });
                }}
              />
            </div>
            <p className="text-xs text-gray-500">Baseline intensity: {formatNumber(baselineIntensity)} tCO₂ per {activeBaseline.production_label}.</p>
          </div>
        </section>

        {/* Wizard (conditionally mounted) */}
        {wizardOpen && (
          <MeasureWizard
            onClose={() => setWizardOpen(false)}
            onSave={saveWizard}
            sectors={sectors}
            currency={currency}
            carbonPrice={carbonPrice}
            dataSources={dataSources}
          />
        )}

        {/* Continuous coloured MACC with hoverable rectangles */}
        <section className="bg-white rounded-2xl shadow border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Sectoral MACC — {selectedSector} ({mode === 'capacity' ? 'Cumulative tCO₂ abated' : 'Cumulative intensity reduction %'} on X; Marginal cost on Y)</h2>
            <button className="px-3 py-1.5 rounded-xl border" onClick={() => exportContainerSvgToPng(maccRef.current, "macc.png")}>Export PNG</button>
          </div>
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 relative" ref={maccRef}>
              <ResponsiveContainer width="100%" height={360}>
                {costModel === 'fit' && quad ? (
                  <LineChart data={quad.fitted} margin={{ top: 10, right: 10, left: 10, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="x" type="number" domain={[0, totalWidth]} tickFormatter={(v) => mode === 'capacity' ? formatNumber(v) : Number(v).toFixed(1) + '%'} label={{ value: mode === 'capacity' ? 'Cumulative abatement (tCO₂)' : 'Cumulative intensity reduction (%)', position: 'insideBottom', dy: 20 }} />
                    <YAxis tickFormatter={(v) => `${currency} ${formatNumber(v)}`} label={{ value: `Marginal cost (${currency}/tCO₂)`, angle: -90, position: 'insideLeft' }} />
                    <Tooltip />
                    <ReferenceLine y={0} stroke="#8884d8" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="y" name="Quadratic MACC" dot={false} stroke={PALETTE[0]} />
                  </LineChart>
                ) : (
                  <ComposedChart data={axisData} margin={{ top: 10, right: 10, left: 10, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" domain={[0, totalWidth]} tickFormatter={(v) => mode === 'capacity' ? formatNumber(v) : Number(v).toFixed(1) + '%'} label={{ value: mode === 'capacity' ? 'Cumulative abatement (tCO₂)' : 'Cumulative intensity reduction (%)', position: 'insideBottom', dy: 20 }} />
                    <YAxis type="number" domain={yDomain} tickFormatter={(v) => `${currency} ${formatNumber(v)}`} label={{ value: `Marginal cost (${currency}/tCO₂)`, angle: -90, position: 'insideLeft' }} />
                    <Tooltip labelFormatter={(label) => { const v = Number(label); return mode === 'capacity' ? `${formatNumber(v)} tCO₂` : (Number.isFinite(v) ? v.toFixed(2) + '%' : String(label)); }} />
                    <ReferenceLine y={0} stroke="#8884d8" strokeDasharray="4 4" />
                    {segments.map((s) => (
                      <ReferenceArea key={s.id} x1={s.x1_plot} x2={s.x2_plot} y1={0} y2={s.cost} fill={s.color} fillOpacity={0.95} stroke="none" />
                    ))}
                    <Customized
                      component={
                        <HoverOverlay
                          segments={segments}
                          maccRef={maccRef}
                          setHoverInfo={setHoverInfo}
                        />
                      }
                    />
                  </ComposedChart>
                )}
              </ResponsiveContainer>

              {/* Hover tooltip */}
              {hoverInfo && hoverInfo.seg && (
                <div
                  className="absolute z-10 bg-white border rounded-lg shadow p-2 text-xs pointer-events-none"
                  style={{ left: Math.max(8, hoverInfo.x), top: Math.max(8, hoverInfo.y) }}
                >
                  <div className="font-semibold">{hoverInfo.seg.name}</div>
                  <div>Sector: {hoverInfo.seg.sector}</div>
                  <div>Abatement: {formatNumber(hoverInfo.seg.abatement)} tCO₂</div>
                  <div>Effective cost (after carbon price): {currency} {formatNumber(hoverInfo.seg.cost)} /tCO₂</div>
                </div>
              )}

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

              {quad && (
                <>
                  <div className="mt-4">
                    <h4 className="font-medium">Quadratic fit parameters</h4>
                    <div className="text-sm text-gray-600">cost(x) = a + b·x + c·x²</div>
                    <div className="text-sm">a = {quad.a.toFixed(4)}, b = {quad.b.toFixed(4)}, c = {quad.c.toFixed(6)}</div>
                  </div>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Costs in chart reflect <b>saved cost − carbon price</b>. Bars below zero indicate cost-saving measures.
          </p>
        </section>

        {/* Measures table */}
        <section className="bg-white rounded-2xl shadow border p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Measures ({selectedSector})</h2>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 rounded-xl border" onClick={() => fileInputRef.current?.click()}>Import CSV</button>
              <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const reader = new FileReader(); reader.onload = () => importCSV(csvToJson(String(reader.result))); reader.readAsText(f); e.currentTarget.value = ''; }} />
              <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={addMeasure}>+ Add measure</button>
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
                  <th className="p-2 text-right">Marginal cost (input) ({currency}/tCO₂)</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(measures || [])
                  .filter(m => selectedSector === "All sectors" || m.sector === selectedSector)
                  .map((m) => (
                    <tr key={m.id} className="border-b">
                      <td className="p-2">
                        <input type="checkbox" checked={m.selected} onChange={(e) => { const copy = [...measures]; const pos = copy.findIndex(x => x.id === m.id); copy[pos] = { ...m, selected: e.target.checked }; setMeasures(copy); }} />
                      </td>
                      <td className="p-2">
                        <input className="border rounded-lg px-2 py-1 w-56" value={m.name} onChange={(e) => { const copy = [...measures]; const pos = copy.findIndex(x => x.id === m.id); copy[pos] = { ...m, name: e.target.value }; setMeasures(copy); }} />
                        {m.details?.per_year && (
                          <div className="text-[11px] text-blue-600 mt-1 cursor-pointer" onClick={() => setInspectedId(m.id)}>View timeseries</div>
                        )}
                      </td>
                      <td className="p-2">
                        <select className="border rounded-lg px-2 py-1" value={m.sector} onChange={(e) => { const copy = [...measures]; const pos = copy.findIndex(x => x.id === m.id); copy[pos] = { ...m, sector: e.target.value }; setMeasures(copy); }}>
                          {sectors.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="p-2 text-right">
                        <input type="number" className="border rounded-lg px-2 py-1 w-40 text-right" value={m.abatement_tco2} onChange={(e) => { const copy = [...measures]; const pos = copy.findIndex(x => x.id === m.id); copy[pos] = { ...m, abatement_tco2: Number(e.target.value) }; setMeasures(copy); }} />
                      </td>
                      <td className="p-2 text-right">
                        <input type="number" className="border rounded-lg px-2 py-1 w-40 text-right" value={m.cost_per_tco2} onChange={(e) => { const copy = [...measures]; const pos = copy.findIndex(x => x.id === m.id); copy[pos] = { ...m, cost_per_tco2: Number(e.target.value) }; setMeasures(copy); }} />
                      </td>
                      <td className="p-2 text-right">
                        <button className="px-2 py-1 rounded-lg border" onClick={() => setMeasures(measures.filter(x => x.id !== m.id))}>Delete</button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            CSV columns: <code>id, name, sector, abatement_tco2, cost_per_tco2, selected, details</code>.
          </div>
        </section>

        {/* Timeseries viewer */}
        {inspected && inspectedSeries && (
          <section className="bg-white rounded-2xl shadow border p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Measure timeseries — {inspected.name}</h2>
              <button className="px-3 py-1.5 rounded-xl border" onClick={() => setInspectedId(null)}>Close</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={inspectedSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis yAxisId="left" />
                  <Tooltip />
                  <Line yAxisId="left" type="monotone" dataKey="direct_t" name="Direct abatement (tCO₂)" />
                </LineChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={inspectedSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis yAxisId="left" tickFormatter={(v) => `${currency} ${formatNumber(v)}`} />
                  <Tooltip />
                  <Line yAxisId="left" type="monotone" dataKey="net_cost_cr" name={`Net cost (${currency} cr)`} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Methodology */}
        <section className="bg-white rounded-2xl shadow border p-6">
          <h2 className="text-lg font-semibold mb-2">Methodology</h2>
          <ul className="list-disc pl-5 text-sm space-y-1 text-gray-700">
            <li>Continuous MACC uses coloured rectangles (width = potential, height = cost − carbon price).</li>
            <li>Wizard computes per-year reductions via Σ(Δquantity × EF × adoption).</li>
            <li>Costs include drivers + opex + other − savings + financed annuity; upfront capex is added as that year’s cash flow.</li>
            <li>NPV/IRR are computed from yearly cash flows (with/without carbon price) discounted at the real rate.</li>
            <li>Interpolation buttons linearly fill missing 5‑year columns.</li>
          </ul>
        </section>

        <footer className="text-xs text-gray-500 text-center pb-8">Built for India CCTS exploration.</footer>
      </div>
    </div>
  );
}

export default function MACCApp() {
  return (
    <ErrorBoundary>
      <MACCAppInner />
    </ErrorBoundary>
  );
}
