import type {
  DrinkExpenseItem,
  DrinkSaleItem,
  DrinksAnalyticsReport,
} from '@/src/services/api/adminApi';

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

export function triggerCsvDownload(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  const csvBody = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportSalesReportCsv(
  sales: DrinkSaleItem[],
  dateRangeLabel: string
): void {
  const rows: Array<Array<string | number | null>> = [
    ['THE GRID - Private Drinks Sales Report', dateRangeLabel],
    [],
    [
      'Sale ID',
      'Status',
      'Sale Date & Time',
      'Product Name',
      'Category',
      'Quantity Sold',
      'Unit Selling Price (PKR)',
      'Total Sale Amount (PKR)',
      'Unit Purchase Cost (PKR)',
      'Total Cost / COGS (PKR)',
      'Profit / Loss (PKR)',
      'Notes',
      'Recorded By',
      'Updated By',
      'Cancelled By',
      'Cancel Reason',
    ],
    ...sales.map((s) => [
      s.id,
      s.status,
      s.sold_at,
      s.product_name,
      s.category,
      s.quantity,
      s.unit_selling_price_pkr,
      s.total_sale_pkr,
      s.unit_purchase_price_pkr,
      s.total_cost_pkr,
      s.profit_pkr,
      s.notes || '',
      s.created_by,
      s.updated_by || '',
      s.cancelled_by || '',
      s.cancel_reason || '',
    ]),
  ];

  triggerCsvDownload(`thegrid-drinks-sales-${dateRangeLabel}.csv`, rows);
}

export function exportInventoryReportCsv(
  report: DrinksAnalyticsReport,
  dateRangeLabel: string
): void {
  const rows: Array<Array<string | number | null>> = [
    ['THE GRID - Private Drinks Inventory & Unsold Stock Report', dateRangeLabel],
    [],
    [
      'Product ID',
      'Product Name',
      'Category',
      'Brand',
      'Bottle Size',
      'Status',
      'Stock Status',
      'Purchase Price (PKR)',
      'Selling Price (PKR)',
      'Opening Stock',
      'Qty Sold (Filtered)',
      'Current Remaining Stock',
      'Min Stock Alert',
      'Revenue (PKR)',
      'COGS (PKR)',
      'Gross Profit (PKR)',
      'Remaining Stock Cost Value (PKR)',
      'Remaining Stock Retail Value (PKR)',
    ],
    ...report.productReport.map((p) => [
      p.id,
      p.name,
      p.category,
      p.brand || '',
      p.bottle_size || '',
      p.is_active === 1 ? 'Active' : 'Inactive',
      p.stock_status,
      p.purchase_price_pkr,
      p.selling_price_pkr,
      p.opening_stock,
      p.qty_sold,
      p.current_stock,
      p.min_stock_alert,
      p.revenue_pkr,
      p.cogs_pkr,
      p.profit_pkr,
      p.remaining_cost_value_pkr,
      p.remaining_retail_value_pkr,
    ]),
  ];

  triggerCsvDownload(`thegrid-drinks-inventory-${dateRangeLabel}.csv`, rows);
}

export function exportProfitLossReportCsv(
  report: DrinksAnalyticsReport,
  expenses: DrinkExpenseItem[],
  dateRangeLabel: string
): void {
  const { kpis } = report;
  const rows: Array<Array<string | number | null>> = [
    ['THE GRID - Private Drinks Profit & Loss Statement', dateRangeLabel],
    [],
    ['Metric', 'Value'],
    ['Total Completed Sales Entries', kpis.totalSalesCount],
    ['Total Items Sold', kpis.totalItemsSold],
    ['Total Revenue (PKR)', kpis.totalRevenuePkr],
    ['Cost of Goods Sold (PKR)', kpis.totalPurchaseCostPkr],
    ['Gross Profit (PKR)', kpis.grossProfitPkr],
    ['Recorded Additional Expenses (PKR)', kpis.totalExpensesPkr],
    ['Net Profit / Loss (PKR)', kpis.netProfitPkr],
    ['Actual Financial Profit (PKR)', kpis.totalProfitPkr],
    ['Actual Financial Loss (PKR)', kpis.totalLossPkr],
    ['Remaining Items in Stock', kpis.totalItemsRemaining],
    ['Remaining Inventory Cost Value (Not a Loss) (PKR)', kpis.remainingInventoryCostValuePkr],
    ['Remaining Inventory Retail Value (PKR)', kpis.remainingInventoryRetailValuePkr],
    [],
    ['Category Breakdown'],
    ['Category', 'Products', 'Items Sold', 'Remaining Stock', 'Revenue (PKR)', 'COGS (PKR)', 'Gross Profit (PKR)', 'Inventory Cost Value (PKR)'],
    ...report.categoryReport.map((c) => [
      c.label,
      c.product_count,
      c.items_sold,
      c.items_remaining,
      c.revenue_pkr,
      c.cogs_pkr,
      c.gross_profit_pkr,
      c.inventory_cost_value_pkr,
    ]),
    [],
    ['Additional Expenses Included'],
    ['Expense Date', 'Expense Name', 'Amount (PKR)', 'Description', 'Recorded By'],
    ...expenses.map((e) => [
      e.expense_date,
      e.title,
      e.amount_pkr,
      e.description || '',
      e.created_by,
    ]),
  ];

  triggerCsvDownload(`thegrid-drinks-pnl-${dateRangeLabel}.csv`, rows);
}
