/**
 * Builds the fictional competition demo workbook.
 * Not a product feature — run with: npx tsx scripts/generate-demo-workbook.ts
 *
 * The file contains no real company records and no personal information.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { buildVerifiedBusinessFacts } from '../src/lib/ai/facts.ts'
import { buildDashboard } from '../src/lib/dashboard/buildDashboard.ts'
import { loadWorkbookFile, selectSheet } from '../src/lib/excel/loadWorkbook.ts'
import { getActiveSheet, type CellValue, type SheetDataset } from '../src/lib/excel/types.ts'
import { toNumber } from '../src/lib/excel/values.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_DIR = join(ROOT, 'demo', 'data')
const OUTPUT_NAME = 'Zillion_Telecom_Business_Demo.xlsx'
const OUTPUT_PATH = join(OUTPUT_DIR, OUTPUT_NAME)

type Row = CellValue[]

type Site = {
  id: string
  region: 'North' | 'South' | 'West' | 'Central'
  type: 'Urban' | 'Rural' | 'Industrial' | 'Highway' | 'Remote'
}

type MonthPoint = {
  date: Date
  monthIndex: number
  days: number
}

type MissingCell = {
  sheet: string
  sourceRow: number
  column: string
  entity: string
}

const SITES: Site[] = [
  { id: 'ZT-N-102', region: 'North', type: 'Urban' },
  { id: 'ZT-N-118', region: 'North', type: 'Rural' },
  { id: 'ZT-N-141', region: 'North', type: 'Highway' },
  { id: 'ZT-S-207', region: 'South', type: 'Urban' },
  { id: 'ZT-S-221', region: 'South', type: 'Rural' },
  { id: 'ZT-S-238', region: 'South', type: 'Remote' },
  { id: 'ZT-W-304', region: 'West', type: 'Industrial' },
  { id: 'ZT-W-319', region: 'West', type: 'Highway' },
  { id: 'ZT-W-330', region: 'West', type: 'Remote' },
  { id: 'ZT-C-401', region: 'Central', type: 'Urban' },
  { id: 'ZT-C-412', region: 'Central', type: 'Industrial' },
  { id: 'ZT-C-425', region: 'Central', type: 'Rural' },
]

const MONTHS: MonthPoint[] = [
  { date: utcDate(2026, 4, 30), monthIndex: 0, days: 30 },
  { date: utcDate(2026, 5, 31), monthIndex: 1, days: 31 },
  { date: utcDate(2026, 6, 30), monthIndex: 2, days: 30 },
  { date: utcDate(2026, 7, 31), monthIndex: 3, days: 31 },
  { date: utcDate(2026, 8, 31), monthIndex: 4, days: 31 },
]

const NOC_HEADERS = [
  'Date',
  'Site_ID',
  'Region',
  'Site_Type',
  'Outage_Hours',
  'Site_Down_Count',
  'Availability_Percent',
  'Incident_Count',
  'Resolution_Hours',
  'Priority',
] as const

const ENERGY_HEADERS = [
  'Date',
  'Site_ID',
  'Region',
  'Generator_Runtime_Hours',
  'Fuel_Consumption_Liters',
  'Fuel_Cost',
  'Grid_Availability_Percent',
  'Battery_Backup_Hours',
  'Energy_Incident_Count',
] as const

const FINANCE_HEADERS = [
  'Date',
  'Region',
  'Cost_Category',
  'Budget',
  'Actual_Spend',
  'Variance',
  'Invoice_Count',
  'Payment_Amount',
  'Payment_Status',
] as const

const PROCUREMENT_HEADERS = [
  'Date',
  'Purchase_Order_ID',
  'Vendor',
  'Region',
  'Category',
  'Order_Value',
  'Delivery_Days',
  'Expected_Delivery_Days',
  'Delivery_Status',
  'Invoice_Status',
] as const

const missing: MissingCell[] = []
const duplicateNotes: string[] = []
const failures: string[] = []

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function rngFor(seed: string): () => number {
  let state = hashString(seed)
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function jitter(rng: () => number, spread: number): number {
  return (rng() * 2 - 1) * spread
}

function pickPriority(outageHours: number, incidentCount: number): string {
  if (outageHours >= 20 || incidentCount >= 10) {
    return 'Critical'
  }
  if (outageHours >= 9 || incidentCount >= 7) {
    return 'High'
  }
  if (outageHours >= 3.5 || incidentCount >= 3) {
    return 'Medium'
  }
  return 'Low'
}

function availabilityFromOutage(outageHours: number, days: number, noise: number): number {
  const raw = (1 - outageHours / (days * 24)) * 100
  return round1(clamp(raw + noise, 0, 100))
}

function noteMissing(
  sheet: string,
  sourceRow: number,
  column: string,
  entity: string,
): null {
  missing.push({ sheet, sourceRow, column, entity })
  return null
}

function nocOutage(site: Site, monthIndex: number, rng: () => number): number {
  if (site.region === 'Central') {
    return round1(clamp(1.35 + (site.type === 'Industrial' ? 0.7 : 0) + jitter(rng, 0.55), 0.5, 3.4))
  }

  if (site.region === 'South') {
    const curve = [2.5, 3.9, 6.4, 10.2, 14.9][monthIndex] ?? 6
    const factor = site.id === 'ZT-S-238' ? 1.36 : site.id === 'ZT-S-221' ? 1.1 : 0.84
    return round1(clamp(curve * factor + jitter(rng, 0.45), 1.2, 24))
  }

  if (site.region === 'North') {
    return round1(clamp(5.1 + monthIndex * 0.22 + jitter(rng, 1.05), 3.2, 9.2))
  }

  const westSpikes: Record<string, number[]> = {
    'ZT-W-304': [19.6, 4.7, 33.8, 7.4, 41.9],
    'ZT-W-319': [2.9, 21.8, 3.2, 5.5, 6.1],
    'ZT-W-330': [4.1, 3.5, 5.2, 23.6, 7.8],
  }
  const base = westSpikes[site.id]?.[monthIndex] ?? 5
  return round1(clamp(base + jitter(rng, 0.35), 1.5, 48))
}

function nocIncidents(site: Site, monthIndex: number, downCount: number, rng: () => number): number {
  if (site.region === 'North') {
    return Math.max(downCount, 6 + Math.floor(rng() * 5) + (site.type === 'Highway' ? 1 : 0))
  }
  if (site.region === 'South') {
    return Math.max(downCount, 2 + monthIndex + Math.floor(rng() * 3) + (site.id === 'ZT-S-238' ? 1 : 0))
  }
  if (site.region === 'West') {
    return Math.max(downCount, 1 + Math.floor(rng() * 3))
  }
  return Math.max(downCount, Math.floor(rng() * 3))
}

function nocDownCount(site: Site, outageHours: number, monthIndex: number, rng: () => number): number {
  if (outageHours < 1.2) {
    return rng() > 0.55 ? 0 : 1
  }
  if (site.region === 'North') {
    return clamp(Math.round(outageHours / 1.15) + Math.floor(rng() * 2), 2, 8)
  }
  if (site.region === 'West' && outageHours >= 18) {
    return rng() > 0.7 ? 2 : 1
  }
  if (site.region === 'South') {
    return clamp(1 + Math.round(monthIndex / 2) + (rng() > 0.6 ? 1 : 0), 1, 5)
  }
  return outageHours >= 2.5 ? 1 : rng() > 0.4 ? 1 : 0
}

function nocResolution(site: Site, outageHours: number, monthIndex: number, rng: () => number): number {
  if (site.region === 'North') {
    return round1(clamp(0.9 + rng() * 1.7, 0.8, 2.8))
  }
  if (site.region === 'Central') {
    return round1(clamp(2.1 + rng() * 2.2, 1.8, 4.6))
  }
  if (site.region === 'South') {
    return round1(clamp(2.8 + monthIndex * 1.35 + jitter(rng, 0.6), 2.4, 12.5))
  }
  if (outageHours >= 18) {
    return round1(clamp(11 + rng() * 7.5, 9.5, 19.5))
  }
  return round1(clamp(3.8 + rng() * 3.2, 3.2, 8.4))
}

function buildNocSheet(): { headers: string[]; rows: Row[] } {
  const rows: Row[] = []
  let sourceRow = 2

  for (const month of MONTHS) {
    for (const site of SITES) {
      if (site.id === 'ZT-C-425' && month.monthIndex === 2) {
        continue
      }

      const rng = rngFor(`${site.id}|${month.monthIndex}|noc`)
      const outage = nocOutage(site, month.monthIndex, rng)
      const downs = nocDownCount(site, outage, month.monthIndex, rng)
      const incidents = nocIncidents(site, month.monthIndex, downs, rng)
      const availabilityNoise = hashString(site.id) % 8 === 0 ? (rng() > 0.5 ? 0.1 : -0.1) : 0
      const availability = availabilityFromOutage(outage, month.days, availabilityNoise)

      const skipType = site.id === 'ZT-S-221' && month.monthIndex === 0
      const skipResolution =
        (site.id === 'ZT-C-425' && month.monthIndex === 1) ||
        (site.id === 'ZT-W-319' && month.monthIndex === 3)
      const skipPriority =
        (site.id === 'ZT-N-118' && month.monthIndex === 2) ||
        (site.id === 'ZT-N-141' && month.monthIndex === 4)

      const siteType = skipType
        ? noteMissing('NOC_Data', sourceRow, 'Site_Type', site.id)
        : site.type
      const resolution = skipResolution
        ? noteMissing('NOC_Data', sourceRow, 'Resolution_Hours', site.id)
        : nocResolution(site, outage, month.monthIndex, rng)
      const priority = skipPriority
        ? noteMissing('NOC_Data', sourceRow, 'Priority', site.id)
        : pickPriority(outage, incidents)

      rows.push([
        month.date,
        site.id,
        site.region,
        siteType,
        outage,
        downs,
        availability,
        incidents,
        resolution,
        priority,
      ])
      sourceRow += 1
    }
  }

  const duplicateOf = rows.find(
    (row) => row[1] === 'ZT-C-401' && (row[0] as Date).getUTCMonth() === 5,
  )
  if (!duplicateOf) {
    throw new Error('NOC duplicate source row was not found')
  }
  rows.push([...duplicateOf])
  duplicateNotes.push('NOC_Data: ZT-C-401 June snapshot is repeated (double-export style row).')

  return { headers: [...NOC_HEADERS], rows }
}

function gridAvailability(site: Site, monthIndex: number, rng: () => number): number {
  if (site.region === 'Central') {
    return round1(clamp(98.4 + jitter(rng, 0.7), 97.4, 99.5))
  }
  if (site.region === 'North') {
    return round1(clamp(95.6 - monthIndex * 0.15 + jitter(rng, 1.1), 93.2, 97.6))
  }
  if (site.region === 'South') {
    const curve = [96.1, 94.7, 92.2, 89.3, 86.6][monthIndex] ?? 92
    const penalty = site.id === 'ZT-S-238' ? 1.8 : site.id === 'ZT-S-221' ? 0.6 : 0
    return round1(clamp(curve - penalty + jitter(rng, 0.5), 82, 97.5))
  }
  if (site.id === 'ZT-W-304') {
    const curve = [88.4, 93.1, 84.6, 90.2, 82.8][monthIndex] ?? 88
    return round1(clamp(curve + jitter(rng, 0.6), 80.5, 95))
  }
  return round1(clamp(92.4 - monthIndex * 0.2 + jitter(rng, 1.4), 87, 96.2))
}

function generatorRuntime(site: Site, monthIndex: number, grid: number, rng: () => number): number {
  if (site.id === 'ZT-W-304') {
    const spikes = [96.4, 41.8, 124.6, 68.2, 138.5]
    return round1(spikes[monthIndex] + jitter(rng, 2.2))
  }
  if (site.id === 'ZT-S-238') {
    const curve = [38.6, 52.4, 71.8, 98.2, 129.4]
    return round1(curve[monthIndex] + jitter(rng, 2.8))
  }

  const deficitHours = ((100 - grid) / 100) * 24 * 28 * 0.42
  if (site.region === 'Central') {
    const testRun = monthIndex === 1 && site.id === 'ZT-C-412' ? 9.4 : 0
    return round1(clamp(4.8 + deficitHours * 0.35 + testRun + jitter(rng, 1.6), 3.2, 18))
  }
  if (site.region === 'South') {
    const rise = [14, 21, 29, 41, 55][monthIndex] ?? 25
    return round1(clamp(rise + deficitHours * 0.25 + jitter(rng, 2.4), 10, 72))
  }
  if (site.region === 'North') {
    return round1(clamp(16 + deficitHours * 0.4 + jitter(rng, 3.1), 12, 42))
  }
  return round1(clamp(22 + deficitHours * 0.55 + jitter(rng, 3.6), 14, 64))
}

function fuelBurnRate(site: Site, rng: () => number): number {
  const base =
    site.id === 'ZT-W-304' ? 11.35 : site.type === 'Remote' ? 10.05 : site.type === 'Urban' ? 8.85 : 9.4
  return clamp(base + jitter(rng, 0.35), 8.2, 12.4)
}

function fuelPrice(region: Site['region'], monthIndex: number, rng: () => number): number {
  const base = { North: 1.26, South: 1.31, West: 1.23, Central: 1.21 }[region]
  return clamp(base + monthIndex * 0.012 + jitter(rng, 0.025), 1.12, 1.46)
}

function buildEnergySheet(): { headers: string[]; rows: Row[] } {
  const rows: Row[] = []
  let sourceRow = 2

  for (const month of MONTHS) {
    for (const site of SITES) {
      if (site.id === 'ZT-C-425' && month.monthIndex === 0) {
        continue
      }

      const rng = rngFor(`${site.id}|${month.monthIndex}|energy`)
      const grid = gridAvailability(site, month.monthIndex, rng)
      const runtime = generatorRuntime(site, month.monthIndex, grid, rng)
      const extra =
        rng() > 0.84
          ? Math.min(runtime * 0.28, 16)
          : jitter(rng, Math.min(3.2, Math.max(0.6, runtime * 0.08)))
      const liters = round1(clamp(runtime * fuelBurnRate(site, rng) + extra, 18, 1750))
      const skipCost = site.id === 'ZT-S-207' && month.monthIndex === 2
      const skipBattery =
        (site.id === 'ZT-C-425' && month.monthIndex === 1) ||
        (site.id === 'ZT-N-118' && month.monthIndex === 1) ||
        (site.id === 'ZT-W-319' && month.monthIndex === 3)
      const skipIncidents = site.id === 'ZT-N-141' && month.monthIndex === 4

      const cost = skipCost
        ? noteMissing('Energy_Data', sourceRow, 'Fuel_Cost', site.id)
        : round2(liters * fuelPrice(site.region, month.monthIndex, rng))
      const battery = skipBattery
        ? noteMissing('Energy_Data', sourceRow, 'Battery_Backup_Hours', site.id)
        : round1(clamp((site.type === 'Remote' ? 11.2 : 6.4) + jitter(rng, 1.6), 3.5, 14.5))
      const incidents = skipIncidents
        ? noteMissing('Energy_Data', sourceRow, 'Energy_Incident_Count', site.id)
        : Math.max(0, Math.round((100 - grid) / 5.5) + (runtime > 90 ? 1 : 0) - (rng() > 0.7 ? 1 : 0))

      rows.push([
        month.date,
        site.id,
        site.region,
        runtime,
        liters,
        cost,
        grid,
        battery,
        incidents,
      ])
      sourceRow += 1
    }
  }

  return { headers: [...ENERGY_HEADERS], rows }
}

function financeStatus(
  category: string,
  monthIndex: number,
  overBudget: boolean,
  rng: () => number,
): 'Paid' | 'Pending' | 'Processing' {
  if (category === 'Vendor Services' && rng() > 0.35) {
    return 'Pending'
  }
  if (category === 'Fuel' && monthIndex >= 2 && overBudget && rng() > 0.4) {
    return 'Pending'
  }
  if (overBudget && rng() > 0.72) {
    return 'Processing'
  }
  if (rng() > 0.82) {
    return 'Processing'
  }
  return 'Paid'
}

function buildFinanceSheet(): { headers: string[]; rows: Row[] } {
  const specs: Array<{
    monthIndex: number
    region: Site['region']
    category: string
    budget: number
    actualFactor: number
  }> = []

  const push = (
    monthIndex: number,
    region: Site['region'],
    category: string,
    budget: number,
    actualFactor: number,
  ) => {
    specs.push({ monthIndex, region, category, budget, actualFactor })
  }

  for (const month of MONTHS) {
    const seasonal = month.monthIndex >= 3 ? 1.12 : 1
    if (month.monthIndex > 0) {
      push(month.monthIndex, 'North', 'Operations', round2(62000 * seasonal), 1.03 + month.monthIndex * 0.008)
      push(month.monthIndex, 'South', 'Operations', round2(71000 * seasonal), 1.05 + month.monthIndex * 0.01)
      push(month.monthIndex, 'West', 'Operations', round2(54500 * seasonal), 0.99 + month.monthIndex * 0.006)
      push(month.monthIndex, 'Central', 'Operations', round2(47800 * seasonal), 0.94 + month.monthIndex * 0.004)
    }

    const fuelRise = [1.04, 1.18, 1.39, 1.68, 2.04][month.monthIndex] ?? 1.2
    push(month.monthIndex, 'North', 'Fuel', 16200, 0.98 + month.monthIndex * 0.03)
    push(month.monthIndex, 'South', 'Fuel', 18800 + month.monthIndex * 400, fuelRise)
    push(month.monthIndex, 'West', 'Fuel', 21400, 1.11 + month.monthIndex * 0.025)
    push(month.monthIndex, 'Central', 'Fuel', 12600, 0.93 + month.monthIndex * 0.01)
  }

  for (const monthIndex of [1, 2, 3, 4]) {
    push(monthIndex, 'North', 'Maintenance', 22400, 0.98 + monthIndex * 0.02)
    push(monthIndex, 'South', 'Maintenance', 28600, 1.04 + monthIndex * 0.03)
    push(monthIndex, 'West', 'Maintenance', 24100, 1.16 + monthIndex * 0.035)
  }

  for (const monthIndex of [2, 3, 4]) {
    push(monthIndex, 'South', 'Vendor Services', 15800, 1.07 + monthIndex * 0.02)
    push(monthIndex, 'West', 'Vendor Services', 12100, 0.96 + monthIndex * 0.03)
  }

  push(1, 'Central', 'Administration', 8200, 0.81)
  push(2, 'Central', 'Administration', 8200, 0.86)
  push(4, 'Central', 'Administration', 8200, 0.79)
  push(0, 'North', 'Other', 4800, 0.97)
  push(4, 'West', 'Other', 6400, 1.14)

  const rows: Row[] = []
  let sourceRow = 2

  for (const spec of specs) {
    const month = MONTHS[spec.monthIndex]
    const rng = rngFor(`${spec.region}|${spec.category}|${spec.monthIndex}|fin`)
    const budget = round2(spec.budget)
    const actual = round2(budget * spec.actualFactor + jitter(rng, budget * 0.012))
    const variance = round2(actual - budget)
    const overBudget = variance > 0
    const invoices = clamp(2 + Math.round(actual / 5200) + Math.floor(rng() * 3), 1, 18)
    const status = financeStatus(spec.category, spec.monthIndex, overBudget, rng)
    const payment =
      status === 'Paid'
        ? actual
        : status === 'Processing'
          ? round2(actual * (0.42 + rng() * 0.28))
          : 0

    const skipInvoices = spec.region === 'Central' && spec.category === 'Administration' && spec.monthIndex === 2
    const skipStatus =
      (spec.region === 'South' && spec.category === 'Vendor Services' && spec.monthIndex === 3) ||
      (spec.region === 'West' && spec.category === 'Fuel' && spec.monthIndex === 4)
    const skipPayment = spec.region === 'South' && spec.category === 'Fuel' && spec.monthIndex === 2 && status === 'Pending'

    rows.push([
      month.date,
      spec.region,
      spec.category,
      budget,
      actual,
      variance,
      skipInvoices ? noteMissing('Finance_Data', sourceRow, 'Invoice_Count', spec.region) : invoices,
      skipPayment ? noteMissing('Finance_Data', sourceRow, 'Payment_Amount', spec.region) : payment,
      skipStatus ? noteMissing('Finance_Data', sourceRow, 'Payment_Status', spec.region) : status,
    ])
    sourceRow += 1
  }

  const duplicateOf = rows.find(
    (row) => row[1] === 'Central' && row[2] === 'Administration' && (row[0] as Date).getUTCMonth() === 4,
  )
  if (!duplicateOf) {
    throw new Error('Finance duplicate source row was not found')
  }
  rows.push([...duplicateOf])
  duplicateNotes.push('Finance_Data: Central Administration May snapshot is repeated (double-entry style row).')

  return { headers: [...FINANCE_HEADERS], rows }
}

type PurchaseSpec = {
  date: Date
  vendor: string
  region: Site['region']
  category: string
  value: number
  expected: number
  days: number
  delivery: string | null
  invoice: string | null
}

function deliveryStatus(days: number, expected: number): string {
  if (days <= expected) {
    return days + 2 < expected ? 'Completed' : 'On Time'
  }
  if (days >= expected + 3) {
    return 'Delayed'
  }
  return days - expected === 1 ? 'Completed' : 'Partial'
}

function invoiceStatus(delivery: string | null, rng: () => number): string {
  if (delivery === 'Delayed' && rng() > 0.35) {
    return 'Pending'
  }
  if (delivery === 'Partial' && rng() > 0.45) {
    return 'Pending'
  }
  if (delivery === 'Completed' && rng() > 0.3) {
    return 'Verified'
  }
  if (rng() > 0.78) {
    return 'Pending'
  }
  return rng() > 0.45 ? 'Verified' : 'Received'
}

function buildProcurementSheet(): { headers: string[]; rows: Row[] } {
  const specs: PurchaseSpec[] = []
  const add = (spec: PurchaseSpec) => specs.push(spec)

  const orbitFuel: Array<[number, number, number, Site['region'], number]> = [
    [4, 3, 6420, 'South', 11],
    [4, 18, 7185, 'West', 9],
    [5, 6, 8840, 'South', 12],
    [5, 22, 9310, 'South', 10],
    [6, 9, 12480, 'South', 13],
    [6, 27, 13225, 'West', 11],
    [7, 8, 17860, 'South', 14],
    [7, 21, 19340, 'South', 12],
    [8, 5, 24150, 'South', 15],
    [8, 19, 26920, 'West', 13],
  ]
  for (const [month, day, value, region, days] of orbitFuel) {
    add({
      date: utcDate(2026, month, day),
      vendor: 'Orbit Fuel Logistics',
      region,
      category: 'Fuel',
      value,
      expected: day % 2 === 0 ? 6 : 5,
      days,
      delivery: 'Delayed',
      invoice: days >= 12 ? 'Pending' : 'Received',
    })
  }

  const larkspur: Array<[number, number, Site['region'], string, number, number, number]> = [
    [4, 11, 'North', 'Spare Parts', 4180, 10, 16],
    [5, 14, 'South', 'Equipment', 22640, 12, 19],
    [6, 4, 'West', 'Spare Parts', 5730, 10, 17],
    [7, 16, 'South', 'Spare Parts', 6915, 11, 18],
    [8, 12, 'North', 'Equipment', 19880, 12, 21],
  ]
  for (const [month, day, region, category, value, expected, days] of larkspur) {
    add({
      date: utcDate(2026, month, day),
      vendor: 'Larkspur Logistics',
      region,
      category,
      value,
      expected,
      days,
      delivery: 'Delayed',
      invoice: 'Pending',
    })
  }

  const helix: Array<[number, number, Site['region'], string, number, number, number]> = [
    [4, 7, 'Central', 'Services', 8600, 7, 6],
    [4, 24, 'North', 'Maintenance', 12440, 8, 7],
    [5, 9, 'South', 'Services', 15210, 7, 7],
    [5, 28, 'Central', 'Maintenance', 9800, 8, 6],
    [6, 12, 'North', 'Services', 11175, 7, 5],
    [6, 29, 'West', 'Maintenance', 13420, 8, 8],
    [7, 10, 'South', 'Services', 16890, 7, 7],
    [7, 27, 'Central', 'Services', 7420, 6, 5],
    [8, 14, 'North', 'Maintenance', 14110, 8, 7],
  ]
  for (const [month, day, region, category, value, expected, days] of helix) {
    add({
      date: utcDate(2026, month, day),
      vendor: 'Helix Field Services',
      region,
      category,
      value,
      expected,
      days,
      delivery: null,
      invoice: null,
    })
  }

  const nimbus: Array<[number, number, Site['region'], number, number, number]> = [
    [4, 9, 'West', 41200, 21, 20],
    [5, 5, 'South', 47850, 22, 26],
    [5, 26, 'North', 36540, 18, 17],
    [6, 16, 'South', 52110, 24, 31],
    [7, 3, 'Central', 29880, 19, 18],
    [7, 24, 'West', 44670, 21, 29],
    [8, 8, 'South', 58320, 23, 22],
    [8, 26, 'North', 33790, 18, 19],
  ]
  for (const [month, day, region, value, expected, days] of nimbus) {
    add({
      date: utcDate(2026, month, day),
      vendor: 'Nimbus Tower Equipment',
      region,
      category: 'Equipment',
      value,
      expected,
      days,
      delivery: null,
      invoice: null,
    })
  }

  const pinnacle: Array<[number, number, Site['region'], number, number, number]> = [
    [4, 14, 'Central', 2360, 8, 7],
    [4, 28, 'South', 4125, 9, 9],
    [5, 12, 'West', 1875, 7, 6],
    [5, 30, 'North', 5640, 10, 10],
    [6, 18, 'South', 3288, 8, 8],
    [7, 7, 'Central', 2490, 8, 7],
    [7, 29, 'West', 6710, 11, 12],
    [8, 20, 'South', 4540, 9, 8],
  ]
  for (const [month, day, region, value, expected, days] of pinnacle) {
    add({
      date: utcDate(2026, month, day),
      vendor: 'Pinnacle Spare Parts',
      region,
      category: 'Spare Parts',
      value,
      expected,
      days,
      delivery: null,
      invoice: null,
    })
  }

  const summit: Array<[number, number, Site['region'], number, number, number]> = [
    [4, 21, 'North', 27450, 20, 24],
    [6, 6, 'West', 31880, 22, 28],
    [6, 23, 'South', 25940, 18, 18],
    [7, 15, 'Central', 19860, 16, 21],
    [8, 4, 'South', 34610, 24, 23],
    [8, 27, 'West', 22175, 19, 26],
  ]
  for (const [month, day, region, value, expected, days] of summit) {
    add({
      date: utcDate(2026, month, day),
      vendor: 'Summit Grid Systems',
      region,
      category: 'Equipment',
      value,
      expected,
      days,
      delivery: null,
      invoice: null,
    })
  }

  const aether: Array<[number, number, Site['region'], number, number, number]> = [
    [4, 16, 'West', 8920, 9, 9],
    [5, 8, 'Central', 7640, 8, 7],
    [5, 20, 'South', 11880, 10, 10],
    [6, 11, 'North', 9510, 9, 8],
    [7, 2, 'South', 13440, 11, 11],
    [7, 18, 'West', 10225, 9, 12],
    [8, 11, 'Central', 8380, 8, 8],
    [8, 25, 'North', 12160, 10, 9],
  ]
  for (const [month, day, region, value, expected, days] of aether) {
    add({
      date: utcDate(2026, month, day),
      vendor: 'Aether Maintenance Co',
      region,
      category: 'Maintenance',
      value,
      expected,
      days,
      delivery: null,
      invoice: null,
    })
  }

  specs.sort((left, right) => left.date.getTime() - right.date.getTime())

  const rows: Row[] = []
  specs.forEach((spec, index) => {
    const rng = rngFor(`${spec.vendor}|${spec.date.toISOString()}|${index}`)
    const sourceRow = index + 2
    const skipExpected = spec.vendor === 'Pinnacle Spare Parts' && spec.date.getUTCDate() === 12
    const skipDelivery = spec.vendor === 'Aether Maintenance Co' && spec.date.getUTCDate() === 2
    const skipInvoice =
      (spec.vendor === 'Helix Field Services' && spec.date.getUTCDate() === 12) ||
      (spec.vendor === 'Nimbus Tower Equipment' && spec.date.getUTCDate() === 3)

    const delivery =
      spec.delivery ??
      (skipDelivery
        ? noteMissing('Procurement_Data', sourceRow, 'Delivery_Status', spec.vendor)
        : deliveryStatus(spec.days, spec.expected))
    const invoice =
      spec.invoice ??
      (skipInvoice
        ? noteMissing('Procurement_Data', sourceRow, 'Invoice_Status', spec.vendor)
        : invoiceStatus(delivery, rng))
    const expected = skipExpected
      ? noteMissing('Procurement_Data', sourceRow, 'Expected_Delivery_Days', spec.vendor)
      : spec.expected

    rows.push([
      spec.date,
      `PO-2026-${1041 + index}`,
      spec.vendor,
      spec.region,
      spec.category,
      spec.value,
      spec.days,
      expected,
      delivery,
      invoice,
    ])
  })

  const splitIndex = rows.findIndex((row) => row[2] === 'Nimbus Tower Equipment' && (row[0] as Date).getUTCDate() === 16)
  if (splitIndex === -1) {
    throw new Error('Procurement split-order source was not found')
  }
  const original = rows[splitIndex]
  original[8] = 'Partial'
  original[9] = 'Pending'
  const followOn = [...original]
  followOn[6] = Number(original[6]) + 5
  followOn[8] = 'Completed'
  followOn[9] = 'Verified'
  rows.splice(splitIndex + 1, 0, followOn)

  for (let index = 0; index < rows.length; index += 1) {
    if (index === splitIndex + 1) {
      continue
    }
    const base = 1041 + (index > splitIndex ? index - 1 : index)
    rows[index][1] = `PO-2026-${base}`
  }
  rows[splitIndex + 1][1] = rows[splitIndex][1]
  duplicateNotes.push(
    `Procurement_Data: ${String(rows[splitIndex][1])} appears twice as a partial then completed delivery.`,
  )

  return { headers: [...PROCUREMENT_HEADERS], rows }
}

function columnWidth(header: string): number {
  return Math.max(14, header.length + 4)
}

function applyFormats(sheet: XLSX.WorkSheet, headers: string[], rowCount: number) {
  for (let row = 1; row <= rowCount; row += 1) {
    for (let column = 0; column < headers.length; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      const cell = sheet[address] as XLSX.CellObject | undefined
      if (!cell || cell.v === null || cell.v === undefined) {
        continue
      }

      const header = headers[column]
      if (header === 'Date' && cell.v instanceof Date) {
        cell.t = 'd'
        cell.z = 'yyyy-mm-dd'
        continue
      }

      if (typeof cell.v !== 'number') {
        continue
      }

      if (/percent/i.test(header)) {
        cell.z = '0.0'
      } else if (/cost|spend|budget|variance|amount|value/i.test(header)) {
        cell.z = '#,##0.00'
      } else if (/hours|liters/i.test(header)) {
        cell.z = '0.0'
      } else if (/count|days/i.test(header)) {
        cell.z = '0'
      }
    }
  }

  sheet['!cols'] = headers.map((header) => ({ wch: columnWidth(header) }))
  sheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rowCount, c: headers.length - 1 },
    }),
  }
  sheet['!views'] = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }]
}

function appendSheet(
  workbook: XLSX.WorkBook,
  name: string,
  headers: string[],
  rows: Row[],
) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  applyFormats(sheet, headers, rows.length)
  XLSX.utils.book_append_sheet(workbook, sheet, name)
}

function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
}

function cellAt(row: Row, index: number): CellValue {
  return row[index] ?? null
}

function verifyGeneratedSheets(
  sheets: Array<{ name: string; headers: string[]; rows: Row[] }>,
) {
  for (const sheet of sheets) {
    if (sheet.rows.length < 40 || sheet.rows.length > 60) {
      failures.push(`${sheet.name} row count ${sheet.rows.length} is outside 40–60`)
    }

    for (let index = 0; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index]
      if (row.length !== sheet.headers.length) {
        failures.push(`${sheet.name} row ${index + 2} has ${row.length} cells`)
      }
      if (!(row[0] instanceof Date) || Number.isNaN(row[0].getTime())) {
        failures.push(`${sheet.name} row ${index + 2} has an invalid Date`)
      }
    }
  }

  const noc = sheets.find((sheet) => sheet.name === 'NOC_Data')
  if (noc) {
    for (const row of noc.rows) {
      const outage = toNumber(cellAt(row, 4))
      const downs = toNumber(cellAt(row, 5))
      const availability = toNumber(cellAt(row, 6))
      const incidents = toNumber(cellAt(row, 7))
      const resolution = cellAt(row, 8)
      const date = row[0] as Date
      if (outage === null || outage < 0) {
        failures.push(`NOC ${row[1]} has invalid Outage_Hours`)
      }
      if (downs === null || downs < 0) {
        failures.push(`NOC ${row[1]} has invalid Site_Down_Count`)
      }
      if (availability === null || availability < 0 || availability > 100) {
        failures.push(`NOC ${row[1]} has Availability_Percent outside 0–100`)
      }
      if (incidents === null || incidents < 0) {
        failures.push(`NOC ${row[1]} has invalid Incident_Count`)
      }
      if (resolution !== null && (toNumber(resolution) === null || (toNumber(resolution) ?? -1) < 0)) {
        failures.push(`NOC ${row[1]} has invalid Resolution_Hours`)
      }
      if (outage !== null && availability !== null) {
        const expected = (1 - outage / (daysInMonth(date) * 24)) * 100
        if (Math.abs(availability - expected) > 0.35) {
          failures.push(`NOC ${row[1]} availability is inconsistent with outage hours`)
        }
      }
      if (downs !== null && incidents !== null && incidents < downs) {
        failures.push(`NOC ${row[1]} Incident_Count is below Site_Down_Count`)
      }
    }
  }

  const energy = sheets.find((sheet) => sheet.name === 'Energy_Data')
  if (energy) {
    for (const row of energy.rows) {
      const runtime = toNumber(cellAt(row, 3))
      const liters = toNumber(cellAt(row, 4))
      const cost = cellAt(row, 5)
      const grid = cellAt(row, 6)
      const battery = cellAt(row, 7)
      const incidents = cellAt(row, 8)
      if (runtime === null || runtime < 0 || runtime > 24 * 31) {
        failures.push(`Energy ${row[1]} has impossible Generator_Runtime_Hours`)
      }
      if (liters === null || liters < 0) {
        failures.push(`Energy ${row[1]} has invalid Fuel_Consumption_Liters`)
      }
      if (runtime && liters) {
        const burn = liters / runtime
        if (burn < 7 || burn > 14.5) {
          failures.push(`Energy ${row[1]} burn rate ${burn.toFixed(2)} L/h is unrealistic`)
        }
      }
      if (cost !== null) {
        const amount = toNumber(cost)
        if (amount === null || amount < 0) {
          failures.push(`Energy ${row[1]} has invalid Fuel_Cost`)
        } else if (liters && liters > 0) {
          const unit = amount / liters
          if (unit < 1.08 || unit > 1.5) {
            failures.push(`Energy ${row[1]} fuel unit cost ${unit.toFixed(3)} is out of range`)
          }
        }
      }
      if (grid !== null) {
        const percent = toNumber(grid)
        if (percent === null || percent < 0 || percent > 100) {
          failures.push(`Energy ${row[1]} Grid_Availability_Percent is invalid`)
        }
      }
      if (battery !== null && (toNumber(battery) === null || (toNumber(battery) ?? -1) < 0)) {
        failures.push(`Energy ${row[1]} has invalid Battery_Backup_Hours`)
      }
      if (incidents !== null && (toNumber(incidents) === null || (toNumber(incidents) ?? -1) < 0)) {
        failures.push(`Energy ${row[1]} has invalid Energy_Incident_Count`)
      }
    }
  }

  const finance = sheets.find((sheet) => sheet.name === 'Finance_Data')
  if (finance) {
    for (const row of finance.rows) {
      const budget = toNumber(cellAt(row, 3))
      const actual = toNumber(cellAt(row, 4))
      const variance = toNumber(cellAt(row, 5))
      const invoices = cellAt(row, 6)
      const payment = cellAt(row, 7)
      const status = cellAt(row, 8)
      if (budget === null || budget < 0 || actual === null || actual < 0) {
        failures.push(`Finance ${row[1]} ${row[2]} has negative budget or spend`)
      }
      if (budget !== null && actual !== null && variance !== null) {
        if (Math.abs(variance - round2(actual - budget)) > 0.001) {
          failures.push(`Finance ${row[1]} ${row[2]} variance does not equal Actual_Spend − Budget`)
        }
      }
      if (invoices !== null && (toNumber(invoices) === null || (toNumber(invoices) ?? -1) < 0)) {
        failures.push(`Finance ${row[1]} ${row[2]} has invalid Invoice_Count`)
      }
      if (payment !== null) {
        const amount = toNumber(payment)
        if (amount === null || amount < 0) {
          failures.push(`Finance ${row[1]} ${row[2]} has invalid Payment_Amount`)
        }
        if (status === 'Paid' && actual !== null && amount !== null && Math.abs(amount - actual) > 0.001) {
          failures.push(`Finance ${row[1]} ${row[2]} Paid amount does not match Actual_Spend`)
        }
        if (status === 'Pending' && amount !== null && amount > 0) {
          failures.push(`Finance ${row[1]} ${row[2]} Pending row has a non-zero payment`)
        }
      }
    }
  }

  const procurement = sheets.find((sheet) => sheet.name === 'Procurement_Data')
  if (procurement) {
    for (const row of procurement.rows) {
      const value = toNumber(cellAt(row, 5))
      const days = toNumber(cellAt(row, 6))
      const expected = cellAt(row, 7)
      const delivery = cellAt(row, 8)
      if (value === null || value < 0) {
        failures.push(`Procurement ${row[1]} has invalid Order_Value`)
      }
      if (days === null || days < 0) {
        failures.push(`Procurement ${row[1]} has invalid Delivery_Days`)
      }
      if (expected !== null && (toNumber(expected) === null || (toNumber(expected) ?? -1) < 0)) {
        failures.push(`Procurement ${row[1]} has invalid Expected_Delivery_Days`)
      }
      if (delivery === 'Delayed' && expected !== null && days !== null && days <= Number(expected)) {
        failures.push(`Procurement ${row[1]} is Delayed but not later than expected`)
      }
      if (delivery === 'On Time' && expected !== null && days !== null && days > Number(expected)) {
        failures.push(`Procurement ${row[1]} is On Time but later than expected`)
      }
    }
  }

  const asText = JSON.stringify(sheets)
  if (/@|gmail|outlook|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|national id|passport|ssn/i.test(asText)) {
    failures.push('Dataset appears to contain personal contact information')
  }
}

function summarizePattern(
  rows: Row[],
  groupIndex: number,
  valueIndex: number,
): string {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const label = String(row[groupIndex])
    const value = toNumber(row[valueIndex])
    if (value === null) {
      continue
    }
    const list = groups.get(label) ?? []
    list.push(value)
    groups.set(label, list)
  }

  return [...groups.entries()]
    .map(([label, values]) => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      return `${label} ${mean.toFixed(1)}`
    })
    .join('; ')
}

function monthKey(value: CellValue): string {
  if (!(value instanceof Date)) {
    return 'unknown'
  }
  return value.toISOString().slice(0, 7)
}

function summarizeMonthly(
  rows: Row[],
  valueIndex: number,
  predicate: (row: Row) => boolean,
  mode: 'mean' | 'sum' = 'mean',
): string {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    if (!predicate(row)) {
      continue
    }
    const value = toNumber(row[valueIndex])
    if (value === null) {
      continue
    }
    const key = monthKey(row[0])
    const list = groups.get(key) ?? []
    list.push(value)
    groups.set(key, list)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, values]) => {
      const total = values.reduce((sum, value) => sum + value, 0)
      const statistic = mode === 'sum' ? total : total / values.length
      return `${label} ${statistic.toFixed(1)}`
    })
    .join('; ')
}

async function parseWorkbookFromDisk(): Promise<void> {
  const buffer = readFileSync(OUTPUT_PATH)
  const file = new File([buffer], OUTPUT_NAME, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const loaded = await loadWorkbookFile(file, 'main')
  if (!loaded.ok) {
    failures.push(`Parser rejected the workbook: ${loaded.error.title} — ${loaded.error.message}`)
    return
  }

  const dataset = loaded.value
  const expectedNames = ['NOC_Data', 'Energy_Data', 'Finance_Data', 'Procurement_Data']
  if (dataset.sheetNames.join('|') !== expectedNames.join('|')) {
    failures.push(`Parser sheet names were ${dataset.sheetNames.join(', ')}`)
  }

  console.log('\nParser / dashboard verification')
  console.log('--------------------------------')

  for (const sheetMeta of dataset.sheets) {
    const current = selectSheet(dataset, sheetMeta.id)
    const sheet = getActiveSheet(current)
    const dashboard = buildDashboard(current)
    const facts = buildVerifiedBusinessFacts(current, dashboard)
    const mixed = sheet.columns.filter((column) => column.type === 'mixed' || column.hasMixedTypes)
    const mostlyEmpty = sheet.columns.filter((column) => column.isMostlyEmpty || column.isEmpty)

    if (sheet.isEmpty) {
      failures.push(`${sheet.name} parsed as empty`)
    }
    if (dashboard.notice) {
      failures.push(`${sheet.name} dashboard notice: ${dashboard.notice.message}`)
    }
    if (dashboard.kpis.length === 0) {
      failures.push(`${sheet.name} produced no KPIs`)
    }
    if (dashboard.charts.length === 0) {
      failures.push(`${sheet.name} produced no charts`)
    }
    if (mixed.length > 0) {
      failures.push(`${sheet.name} has mixed-type columns: ${mixed.map((column) => column.name).join(', ')}`)
    }
    if (mostlyEmpty.length > 0) {
      failures.push(`${sheet.name} has empty/sparse columns: ${mostlyEmpty.map((column) => column.name).join(', ')}`)
    }
    if (!facts.dataset.sheetName) {
      failures.push(`${sheet.name} facts were incomplete`)
    }

    printParsedSheet(sheet, dashboard.kpis.map((kpi) => kpi.name), dashboard.charts.map((chart) => chart.title))
  }

  console.log(`Workbook notes: ${dataset.notes.length === 0 ? 'none' : dataset.notes.map((note) => note.message).join('; ')}`)
}

function printParsedSheet(sheet: SheetDataset, kpis: string[], charts: string[]) {
  console.log(`\n${sheet.name}`)
  console.log(`  rows=${sheet.rowCount} columns=${sheet.columnCount} headerRow=${sheet.headerRow}`)
  console.log(
    `  structure: measure=${sheet.structure.measure} temporal=${sheet.structure.temporal} category=${sheet.structure.category} identifier=${sheet.structure.identifier}`,
  )
  console.log(
    '  columns: ' +
      sheet.columns
        .map((column) => `${column.name} [${column.role}/${column.type} empty=${column.emptyCount}]`)
        .join(' | '),
  )
  console.log(`  KPIs: ${kpis.join('; ')}`)
  console.log(`  charts: ${charts.join('; ')}`)
  if (sheet.notes.length > 0) {
    console.log(`  notes: ${sheet.notes.map((note) => note.message).join('; ')}`)
  }
}

function printPatternReport(sheets: Array<{ name: string; headers: string[]; rows: Row[] }>) {
  const noc = sheets.find((sheet) => sheet.name === 'NOC_Data')
  const energy = sheets.find((sheet) => sheet.name === 'Energy_Data')
  const finance = sheets.find((sheet) => sheet.name === 'Finance_Data')
  const procurement = sheets.find((sheet) => sheet.name === 'Procurement_Data')

  console.log('\nIntentional patterns (in the data only)')
  console.log('---------------------------------------')
  if (noc) {
    console.log(`NOC mean outage hours by region: ${summarizePattern(noc.rows, 2, 4)}`)
    console.log(`NOC South outage hours by month: ${summarizeMonthly(noc.rows, 4, (row) => row[2] === 'South')}`)
    console.log(`NOC Central outage hours by month: ${summarizeMonthly(noc.rows, 4, (row) => row[2] === 'Central')}`)
    console.log(`NOC mean incidents by region: ${summarizePattern(noc.rows, 2, 7)}`)
    console.log(`NOC mean resolution hours by region: ${summarizePattern(noc.rows, 2, 8)}`)
  }
  if (energy) {
    console.log(`Energy mean fuel liters by region: ${summarizePattern(energy.rows, 2, 4)}`)
    console.log(`Energy South fuel liters by month: ${summarizeMonthly(energy.rows, 4, (row) => row[2] === 'South')}`)
    console.log(`Energy Central fuel liters by month: ${summarizeMonthly(energy.rows, 4, (row) => row[2] === 'Central')}`)
    console.log(`Energy mean generator hours by region: ${summarizePattern(energy.rows, 2, 3)}`)
    console.log(`Energy mean grid availability by region: ${summarizePattern(energy.rows, 2, 6)}`)
  }
  if (finance) {
    console.log(`Finance mean actual spend by category: ${summarizePattern(finance.rows, 2, 4)}`)
    console.log(`Finance Fuel actual spend by month: ${summarizeMonthly(finance.rows, 4, (row) => row[2] === 'Fuel', 'sum')}`)
    console.log(`Finance mean variance by region: ${summarizePattern(finance.rows, 1, 5)}`)
  }
  if (procurement) {
    console.log(`Procurement mean order value by category: ${summarizePattern(procurement.rows, 4, 5)}`)
    console.log(`Procurement Fuel order value by month: ${summarizeMonthly(procurement.rows, 5, (row) => row[4] === 'Fuel', 'sum')}`)
    console.log(`Procurement mean delivery days by vendor: ${summarizePattern(procurement.rows, 2, 6)}`)
    const regionCounts = new Map<string, number>()
    for (const row of procurement.rows) {
      const region = String(row[3])
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1)
    }
    console.log(
      `Procurement PO counts by region: ${[...regionCounts.entries()].map(([region, count]) => `${region} ${count}`).join('; ')}`,
    )
  }
}

async function main() {
  const sheets = [
    { name: 'NOC_Data', ...buildNocSheet() },
    { name: 'Energy_Data', ...buildEnergySheet() },
    { name: 'Finance_Data', ...buildFinanceSheet() },
    { name: 'Procurement_Data', ...buildProcurementSheet() },
  ]

  verifyGeneratedSheets(sheets)

  const workbook = XLSX.utils.book_new()
  workbook.Props = {
    Title: 'Zillion Telecom Business Demo (Fictional)',
    Subject: 'Fictional departmental operational data for AI Business Insight demos',
    Author: 'Zillion AI Demo Generator',
    Comments: 'Fictional dataset only. Not real company records. No personal information.',
    Company: 'Zillion (fictional demo)',
  }

  for (const sheet of sheets) {
    appendSheet(workbook, sheet.name, sheet.headers, sheet.rows)
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    cellDates: true,
  }) as Buffer
  writeFileSync(OUTPUT_PATH, buffer)

  console.log(`Wrote ${OUTPUT_PATH}`)
  for (const sheet of sheets) {
    console.log(`  ${sheet.name}: ${sheet.rows.length} data rows, ${sheet.headers.length} columns`)
    console.log(`    ${sheet.headers.join(', ')}`)
  }

  console.log('\nMissing / imperfect cells')
  console.log('-------------------------')
  for (const item of missing.filter((item) => !item.column.startsWith('('))) {
    console.log(`  ${item.sheet} row ${item.sourceRow} ${item.column} (${item.entity})`)
  }
  console.log('\nDuplicate-looking records')
  console.log('-------------------------')
  for (const note of duplicateNotes) {
    console.log(`  ${note}`)
  }

  printPatternReport(sheets)
  await parseWorkbookFromDisk()

  if (failures.length > 0) {
    console.error('\nVerification failed:')
    for (const failure of failures) {
      console.error(`  - ${failure}`)
    }
    process.exitCode = 1
    return
  }

  console.log('\nAll workbook checks passed.')
}

await main()
