import type { Bill, Item } from '../types';
import { getAllBills, getItems } from './db';

export interface DashboardStats {
  todaySales: number;
  todayBillCount: number;
  weekSales: number;
  monthSales: number;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  lowStock: Item[];
  recentBills: Bill[];
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const LOW_STOCK_THRESHOLD = 10;

export async function getDashboardStats(): Promise<DashboardStats> {
  const [bills, items] = await Promise.all([getAllBills(), getItems()]);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let todaySales = 0;
  let todayBillCount = 0;
  let weekSales = 0;
  let monthSales = 0;
  const itemAgg = new Map<string, { name: string; qty: number; revenue: number }>();

  for (const bill of bills) {
    const created = new Date(bill.createdAt);
    if (isSameDay(created, now)) {
      todaySales += bill.grandTotal;
      todayBillCount += 1;
    }
    if (created >= weekAgo) weekSales += bill.grandTotal;
    if (created >= monthAgo) {
      monthSales += bill.grandTotal;
      for (const line of bill.lines) {
        const agg = itemAgg.get(line.itemId) ?? { name: line.name, qty: 0, revenue: 0 };
        agg.qty += line.qty;
        agg.revenue += line.lineGrandTotal;
        itemAgg.set(line.itemId, agg);
      }
    }
  }

  const topItems = Array.from(itemAgg.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const lowStock = items.filter((i) => i.stock <= LOW_STOCK_THRESHOLD).sort((a, b) => a.stock - b.stock);

  return {
    todaySales,
    todayBillCount,
    weekSales,
    monthSales,
    topItems,
    lowStock,
    recentBills: bills.slice(0, 8),
  };
}
