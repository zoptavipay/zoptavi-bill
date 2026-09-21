import type { BillLine, Item } from '../types';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Backs out the GST-exclusive unit price from an MRP (a price that already has GST baked
 * in) — the common case for most retail/grocery items sold at a printed pack price.
 * e.g. an MRP of ₹60 at 5% GST → ₹57.14 taxable value + ₹2.86 GST = ₹60 charged, not ₹63.
 */
export function exclusiveFromMrp(mrp: number, gstRate: number): number {
  return round2(mrp / (1 + gstRate / 100));
}

/**
 * Builds a bill line for a given item + quantity, splitting GST evenly into
 * CGST + SGST (intra-state sale — the common case for a single local store).
 */
// gstRateOverride lets a single bill line use a different GST rate than the item's master
// record — e.g. a one-off correction at billing time without permanently changing the item.
export function makeBillLine(item: Item, qty: number, gstRateOverride?: number): BillLine {
  const gstRate = gstRateOverride ?? item.gstRate;
  const lineTotal = round2(item.price * qty);
  const gstAmount = round2((lineTotal * gstRate) / 100);
  const cgst = round2(gstAmount / 2);
  const sgst = round2(gstAmount - cgst); // avoid rounding leaving a paisa unaccounted
  const lineGrandTotal = round2(lineTotal + cgst + sgst);
  return {
    itemId: item.id,
    name: item.name,
    hsn: item.hsn,
    qty,
    unit: item.unit,
    price: item.price,
    gstRate,
    lineTotal,
    cgst,
    sgst,
    lineGrandTotal,
  };
}

export function totalsForLines(lines: BillLine[]) {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const totalCgst = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const totalSgst = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const grandTotal = round2(subtotal + totalCgst + totalSgst);
  return { subtotal, totalCgst, totalSgst, grandTotal };
}

/** Groups bill lines by GST rate for the invoice's tax-rate summary table. */
export function gstSummaryByRate(lines: BillLine[]) {
  const map = new Map<number, { rate: number; taxable: number; cgst: number; sgst: number }>();
  for (const l of lines) {
    const cur = map.get(l.gstRate) ?? { rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0 };
    cur.taxable = round2(cur.taxable + l.lineTotal);
    cur.cgst = round2(cur.cgst + l.cgst);
    cur.sgst = round2(cur.sgst + l.sgst);
    map.set(l.gstRate, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.rate - b.rate);
}

export function formatINR(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
