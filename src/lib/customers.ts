import type { Bill } from '../types';
import { getAllBills } from './db';

export interface CustomerSummary {
  phone: string;
  name?: string;
  totalSpend: number;
  billCount: number;
  lastPurchase: string; // ISO timestamp of most recent bill
  bills: Bill[]; // most recent first
}

/** Builds a per-customer purchase history from bills that captured a phone number. */
export async function getCustomerSummaries(): Promise<CustomerSummary[]> {
  const bills = await getAllBills(); // already sorted most-recent first
  const byPhone = new Map<string, CustomerSummary>();

  for (const bill of bills) {
    if (!bill.customerPhone) continue;
    const phone = bill.customerPhone.trim();
    if (!phone) continue;

    const existing = byPhone.get(phone);
    if (existing) {
      existing.totalSpend += bill.grandTotal;
      existing.billCount += 1;
      existing.bills.push(bill);
      // bills are already newest-first, and name may vary bill-to-bill (typos, updates) —
      // keep the name from the most recent bill that actually has one.
      if (!existing.name && bill.customerName) existing.name = bill.customerName;
    } else {
      byPhone.set(phone, {
        phone,
        name: bill.customerName,
        totalSpend: bill.grandTotal,
        billCount: 1,
        lastPurchase: bill.createdAt,
        bills: [bill],
      });
    }
  }

  return Array.from(byPhone.values()).sort((a, b) => (a.lastPurchase < b.lastPurchase ? 1 : -1));
}
