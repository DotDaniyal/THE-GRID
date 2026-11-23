import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  BarChart3,
  CheckCircle2,
  CupSoda,
  Download,
  Droplet,
  Edit2,
  FileSpreadsheet,
  Lock,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  exportInventoryReportCsv,
  exportProfitLossReportCsv,
  exportSalesReportCsv,
} from '@/src/features/admin/drinksCsvExport';
import {
  adjustAdminDrinkStock,
  cancelAdminDrinkSale,
  createAdminDrink,
  createAdminDrinkExpense,
  createAdminDrinkSale,
  deleteAdminDrink,
  deleteAdminDrinkExpense,
  fetchAdminDrinkExpenses,
  fetchAdminDrinks,
  fetchAdminDrinkSales,
  fetchAdminDrinksReports,
  updateAdminDrink,
  updateAdminDrinkSale,
  type DrinkCategory,
  type DrinkExpenseItem,
  type DrinkItem,
  type DrinkSaleItem,
  type DrinksAnalyticsReport,
  type ProductAnalyticsItem,
} from '@/src/services/api/adminApi';
import { addDaysToIsoDate, getKarachiTodayStr } from '@/src/utils/date';

type SubTab = 'dashboard' | 'products' | 'sales' | 'expenses' | 'reports';
type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom';

const CATEGORY_META: Record<
  DrinkCategory,
  { label: string; shortLabel: string }
> = {
  cold_drinks: { label: 'Cold Drinks', shortLabel: 'Cold Drinks' },
  water: { label: 'Water', shortLabel: 'Water' },
  hydration_drinks: { label: 'Hydration Drinks', shortLabel: 'Hydration' },
};

function getKarachiDateTimeInputDefault(): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour ?? '12';
  return `${map.year ?? '2026'}-${map.month ?? '01'}-${map.day ?? '01'}T${hour}:${map.minute ?? '00'}`;
}

function getDateRangeForPreset(preset: DatePreset): { from: string; to: string } {
  const today = getKarachiTodayStr();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const y = addDaysToIsoDate(today, -1);
    return { from: y, to: y };
  }
  if (preset === 'week') {
    return { from: addDaysToIsoDate(today, -6), to: today };
  }
  if (preset === 'month') {
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  return { from: '', to: '' };
}

async function compressImageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, WebP, or GIF).');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Image file must be under 8 MB.');
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read selected image file.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('Empty image data.'));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      img.onload = () => {
        const maxSize = 480;
        const scale = Math.min(1, maxSize / Math.max(img.width || 1, img.height || 1));
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(result);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}

function formatPkr(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const formatted = `PKR ${abs.toLocaleString()}`;
  return amount < 0 ? `-${formatted}` : formatted;
}

function getStockBadge(stock: number, minAlert: number): {
  label: string;
  classes: string;
} {
  if (stock <= 0) {
    return {
      label: 'Out of Stock',
      classes: 'bg-rose-950/90 text-rose-300 border border-rose-500/40',
    };
  }
  if (stock <= minAlert) {
    return {
      label: 'Low Stock',
      classes: 'bg-amber-950/90 text-amber-300 border border-amber-500/40',
    };
  }
  return {
    label: 'In Stock',
    classes: 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/40',
  };
}

export function AdminDrinksPanel() {
  const [subTab, setSubTab] = useState<SubTab>('dashboard');

  // Shared filter state for analytics, sales, expenses, reports
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterDrinkId, setFilterDrinkId] = useState<string>('');

  // Data collections
  const [drinks, setDrinks] = useState<DrinkItem[]>([]);
  const [sales, setSales] = useState<DrinkSaleItem[]>([]);
  const [expenses, setExpenses] = useState<DrinkExpenseItem[]>([]);
  const [report, setReport] = useState<DrinksAnalyticsReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Products view state
  const [productCategoryTab, setProductCategoryTab] = useState<'all' | DrinkCategory>('all');
  const [busyDrinkId, setBusyDrinkId] = useState<number | null>(null);
  const [confirmDeleteDrinkId, setConfirmDeleteDrinkId] = useState<number | null>(null);

  // Add/Edit Product Modal
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingDrink, setEditingDrink] = useState<DrinkItem | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodCategory, setProdCategory] = useState<DrinkCategory>('cold_drinks');
  const [prodBrand, setProdBrand] = useState('');
  const [prodBottleSize, setProdBottleSize] = useState('');
  const [prodPurchasePrice, setProdPurchasePrice] = useState('0');
  const [prodSellingPrice, setProdSellingPrice] = useState('');
  const [prodOpeningStock, setProdOpeningStock] = useState('0');
  const [prodCurrentStock, setProdCurrentStock] = useState('0');
  const [prodMinAlert, setProdMinAlert] = useState('5');
  const [prodDescription, setProdDescription] = useState('');
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [prodIsActive, setProdIsActive] = useState(true);
  const [savingProduct, setSavingProduct] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stock Adjustment Modal
  const [adjustingDrink, setAdjustingDrink] = useState<DrinkItem | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<'add' | 'remove'>('add');
  const [adjustQty, setAdjustQty] = useState('1');
  const [adjustReason, setAdjustReason] = useState('');
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  // Daily Sale Entry Form
  const [saleDrinkId, setSaleDrinkId] = useState<string>('');
  const [saleQty, setSaleQty] = useState('1');
  const [saleUnitSellPrice, setSaleUnitSellPrice] = useState('');
  const [saleUnitCostPrice, setSaleUnitCostPrice] = useState('');
  const [saleSoldAt, setSaleSoldAt] = useState(getKarachiDateTimeInputDefault);
  const [saleNotes, setSaleNotes] = useState('');
  const [savingSale, setSavingSale] = useState(false);

  // Edit Sale Modal
  const [editingSale, setEditingSale] = useState<DrinkSaleItem | null>(null);
  const [editSaleQty, setEditSaleQty] = useState('1');
  const [editSaleSellPrice, setEditSaleSellPrice] = useState('0');
  const [editSaleCostPrice, setEditSaleCostPrice] = useState('0');
  const [editSaleSoldAt, setEditSaleSoldAt] = useState('');
  const [editSaleNotes, setEditSaleNotes] = useState('');
  const [savingSaleEdit, setSavingSaleEdit] = useState(false);

  // Cancel Sale Modal
  const [cancellingSale, setCancellingSale] = useState<DrinkSaleItem | null>(null);
  const [cancelSaleReason, setCancelSaleReason] = useState('');
  const [submittingCancelSale, setSubmittingCancelSale] = useState(false);

  // Expense Entry Form
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(getKarachiTodayStr);
  const [expenseDescription, setExpenseDescription] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [confirmDeleteExpenseId, setConfirmDeleteExpenseId] = useState<number | null>(null);

  const loadAllInventoryData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const parsedDrinkId = filterDrinkId ? Number(filterDrinkId) : undefined;
    const filters = {
      from: filterFrom || undefined,
      to: filterTo || undefined,
      category: filterCategory || undefined,
      drinkId: parsedDrinkId && Number.isFinite(parsedDrinkId) ? parsedDrinkId : undefined,
    };

    try {
      const [drinkList, salesList, expensesList, analyticsReport] = await Promise.all([
        fetchAdminDrinks(),
        fetchAdminDrinkSales({ ...filters, includeCancelled: true }),
        fetchAdminDrinkExpenses({ from: filters.from, to: filters.to }),
        fetchAdminDrinksReports(filters),
      ]);
      setDrinks(drinkList);
      setSales(salesList);
      setExpenses(expensesList);
      setReport(analyticsReport);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load private drinks inventory data.'
      );
    } finally {
      setLoading(false);
    }
  }, [filterFrom, filterTo, filterCategory, filterDrinkId]);

  useEffect(() => {
    void loadAllInventoryData();
  }, [loadAllInventoryData]);

  // Close open modals on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isProductModalOpen && !savingProduct) setIsProductModalOpen(false);
      if (adjustingDrink && !savingAdjustment) setAdjustingDrink(null);
      if (editingSale && !savingSaleEdit) setEditingSale(null);
      if (cancellingSale && !submittingCancelSale) setCancellingSale(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isProductModalOpen,
    savingProduct,
    adjustingDrink,
    savingAdjustment,
    editingSale,
    savingSaleEdit,
    cancellingSale,
    submittingCancelSale,
  ]);

  const applyPreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') return;
    const range = getDateRangeForPreset(preset);
    setFilterFrom(range.from);
    setFilterTo(range.to);
  };

  // Selectable active in-stock products for Sale Entry
  const sellableDrinks = useMemo(
    () => drinks.filter((d) => d.is_active === 1 && d.current_stock > 0),
    [drinks]
  );

  const selectedSaleProduct = useMemo(
    () => drinks.find((d) => String(d.id) === saleDrinkId) ?? null,
    [drinks, saleDrinkId]
  );

  const handleSelectSaleProduct = (nextId: string) => {
    setSaleDrinkId(nextId);
    const found = drinks.find((d) => String(d.id) === nextId);
    if (found) {
      setSaleUnitSellPrice(String(found.price_pkr));
      setSaleUnitCostPrice(String(found.purchase_price_pkr));
      setSaleQty('1');
    } else {
      setSaleUnitSellPrice('');
      setSaleUnitCostPrice('');
    }
  };

  // Live sale calculation preview
  const liveSalePreview = useMemo(() => {
    const qty = Math.max(0, Math.round(Number(saleQty) || 0));
    const sell = Math.max(0, Math.round(Number(saleUnitSellPrice) || 0));
    const cost = Math.max(0, Math.round(Number(saleUnitCostPrice) || 0));
    const totalSale = qty * sell;
    const totalCost = qty * cost;
    const profit = totalSale - totalCost;
    return { qty, totalSale, totalCost, profit };
  }, [saleQty, saleUnitSellPrice, saleUnitCostPrice]);

  // Product modal handlers
  const openAddProductModal = (defaultCat?: DrinkCategory) => {
    setEditingDrink(null);
    setProdName('');
    setProdCategory(defaultCat ?? (productCategoryTab === 'all' ? 'cold_drinks' : productCategoryTab));
    setProdBrand('');
    setProdBottleSize('');
    setProdPurchasePrice('0');
    setProdSellingPrice('');
    setProdOpeningStock('0');
    setProdCurrentStock('0');
    setProdMinAlert('5');
    setProdDescription('');
    setProdImageUrl('');
    setProdIsActive(true);
    setError(null);
    setIsProductModalOpen(true);
  };

  const openEditProductModal = (item: DrinkItem) => {
    setEditingDrink(item);
    setProdName(item.name);
    setProdCategory(item.category);
    setProdBrand(item.brand || '');
    setProdBottleSize(item.bottle_size || '');
    setProdPurchasePrice(String(item.purchase_price_pkr));
    setProdSellingPrice(String(item.price_pkr));
    setProdOpeningStock(String(item.opening_stock));
    setProdCurrentStock(String(item.current_stock));
    setProdMinAlert(String(item.min_stock_alert));
    setProdDescription(item.description || '');
    setProdImageUrl(item.image_url || '');
    setProdIsActive(item.is_active === 1);
    setError(null);
    setIsProductModalOpen(true);
  };

  const handleImageFileSelect = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setUploadingImage(true);
    setError(null);
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setProdImageUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process uploaded image.');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);
    setError(null);
    setSuccessMessage(null);

    const purchase = Number(prodPurchasePrice);
    const selling = Number(prodSellingPrice);
    const opening = Number(prodOpeningStock);
    const current = Number(prodCurrentStock);
    const minAlert = Number(prodMinAlert);

    if (!prodName.trim()) {
      setError('Product name is required.');
      setSavingProduct(false);
      return;
    }
    if (!Number.isFinite(purchase) || purchase < 0) {
      setError('Purchase price must be 0 or greater.');
      setSavingProduct(false);
      return;
    }
    if (!Number.isFinite(selling) || selling <= 0) {
      setError('Selling price must be greater than 0.');
      setSavingProduct(false);
      return;
    }
    if (!Number.isFinite(opening) || opening < 0) {
      setError('Opening stock must be 0 or greater.');
      setSavingProduct(false);
      return;
    }

    try {
      if (editingDrink) {
        await updateAdminDrink(editingDrink.id, {
          name: prodName.trim(),
          category: prodCategory,
          brand: prodBrand.trim(),
          bottleSize: prodBottleSize.trim(),
          purchasePricePkr: Math.round(purchase),
          pricePkr: Math.round(selling),
          openingStock: Math.round(opening),
          currentStock: Number.isFinite(current) && current >= 0 ? Math.round(current) : editingDrink.current_stock,
          minStockAlert: Number.isFinite(minAlert) && minAlert >= 0 ? Math.round(minAlert) : 5,
          description: prodDescription.trim() || null,
          imageUrl: prodImageUrl.trim() || null,
          isActive: prodIsActive,
        });
        setSuccessMessage(`Updated product "${prodName.trim()}".`);
      } else {
        const openingRounded = Math.round(opening);
        await createAdminDrink({
          name: prodName.trim(),
          category: prodCategory,
          brand: prodBrand.trim(),
          bottleSize: prodBottleSize.trim(),
          purchasePricePkr: Math.round(purchase),
          pricePkr: Math.round(selling),
          openingStock: openingRounded,
          currentStock: openingRounded,
          minStockAlert: Number.isFinite(minAlert) && minAlert >= 0 ? Math.round(minAlert) : 5,
          description: prodDescription.trim() || undefined,
          imageUrl: prodImageUrl.trim() || undefined,
          isActive: prodIsActive,
        });
        setSuccessMessage(`Added product "${prodName.trim()}" to inventory.`);
      }
      setIsProductModalOpen(false);
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleToggleProductActive = async (drink: DrinkItem) => {
    setBusyDrinkId(drink.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const nextActive = drink.is_active === 0;
      await updateAdminDrink(drink.id, { isActive: nextActive });
      setSuccessMessage(`"${drink.name}" marked ${nextActive ? 'Active' : 'Inactive'}.`);
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update product status.');
    } finally {
      setBusyDrinkId(null);
    }
  };

  const handleDeleteProduct = async (drink: DrinkItem) => {
    setBusyDrinkId(drink.id);
    setError(null);
    setSuccessMessage(null);
    try {
      await deleteAdminDrink(drink.id);
      setConfirmDeleteDrinkId(null);
      setSuccessMessage(`Deleted product "${drink.name}".`);
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete product.');
    } finally {
      setBusyDrinkId(null);
    }
  };

  const handleSaveStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingDrink) return;
    const qty = Math.trunc(Number(adjustQty));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Stock adjustment quantity must be at least 1.');
      return;
    }
    const delta = adjustDirection === 'add' ? qty : -qty;
    setSavingAdjustment(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await adjustAdminDrinkStock(adjustingDrink.id, {
        deltaQty: delta,
        reason: adjustReason.trim() || undefined,
      });
      setAdjustingDrink(null);
      setAdjustReason('');
      setAdjustQty('1');
      setSuccessMessage(
        `Adjusted stock for "${res.drink.name}" (${delta > 0 ? `+${delta}` : delta}). New stock: ${res.drink.current_stock}.`
      );
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust stock.');
    } finally {
      setSavingAdjustment(false);
    }
  };

  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSaleProduct) {
      setError('Please select a product to record a sale.');
      return;
    }
    const qty = Math.round(Number(saleQty));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity sold must be at least 1.');
      return;
    }
    if (qty > selectedSaleProduct.current_stock) {
      setError(
        `Insufficient stock for "${selectedSaleProduct.name}". Available: ${selectedSaleProduct.current_stock}.`
      );
      return;
    }

    setSavingSale(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const createdSale = await createAdminDrinkSale({
        drinkId: selectedSaleProduct.id,
        quantity: qty,
        unitSellingPricePkr: Number(saleUnitSellPrice),
        unitPurchasePricePkr: Number(saleUnitCostPrice),
        soldAt: saleSoldAt,
        notes: saleNotes.trim() || undefined,
      });
      setSuccessMessage(
        `Recorded sale #${createdSale.id}: ${createdSale.quantity} x ${createdSale.product_name} (${formatPkr(createdSale.total_sale_pkr)}).`
      );
      setSaleQty('1');
      setSaleNotes('');
      setSaleDrinkId('');
      setSaleUnitSellPrice('');
      setSaleUnitCostPrice('');
      setSaleSoldAt(getKarachiDateTimeInputDefault());
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record sale.');
    } finally {
      setSavingSale(false);
    }
  };

  const openEditSaleModal = (sale: DrinkSaleItem) => {
    setEditingSale(sale);
    setEditSaleQty(String(sale.quantity));
    setEditSaleSellPrice(String(sale.unit_selling_price_pkr));
    setEditSaleCostPrice(String(sale.unit_purchase_price_pkr));
    setEditSaleSoldAt(sale.sold_at.slice(0, 16));
    setEditSaleNotes(sale.notes || '');
    setError(null);
  };

  const handleSaveSaleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSale) return;
    setSavingSaleEdit(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await updateAdminDrinkSale(editingSale.id, {
        quantity: Math.round(Number(editSaleQty)),
        unitSellingPricePkr: Math.round(Number(editSaleSellPrice)),
        unitPurchasePricePkr: Math.round(Number(editSaleCostPrice)),
        soldAt: editSaleSoldAt,
        notes: editSaleNotes.trim() || null,
      });
      setEditingSale(null);
      setSuccessMessage(`Updated sale #${updated.id}. Stock and financials updated automatically.`);
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update sale.');
    } finally {
      setSavingSaleEdit(false);
    }
  };

  const handleConfirmCancelSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingSale) return;
    setSubmittingCancelSale(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const cancelled = await cancelAdminDrinkSale(
        cancellingSale.id,
        cancelSaleReason.trim() || undefined
      );
      setCancellingSale(null);
      setCancelSaleReason('');
      setSuccessMessage(
        `Cancelled sale #${cancelled.id} and restored ${cancelled.quantity} units of "${cancelled.product_name}" to stock.`
      );
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel sale.');
    } finally {
      setSubmittingCancelSale(false);
    }
  };

  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseTitle.trim()) {
      setError('Expense name is required.');
      return;
    }
    const amt = Number(expenseAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Expense amount must be greater than 0 PKR.');
      return;
    }

    setSavingExpense(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const created = await createAdminDrinkExpense({
        title: expenseTitle.trim(),
        amountPkr: Math.round(amt),
        expenseDate,
        description: expenseDescription.trim() || undefined,
      });
      setExpenseTitle('');
      setExpenseAmount('');
      setExpenseDescription('');
      setSuccessMessage(`Recorded expense "${created.title}" (${formatPkr(created.amount_pkr)}).`);
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record expense.');
    } finally {
      setSavingExpense(false);
    }
  };

  const handleDeleteExpense = async (id: number, title: string) => {
    setError(null);
    setSuccessMessage(null);
    try {
      await deleteAdminDrinkExpense(id);
      setConfirmDeleteExpenseId(null);
      setSuccessMessage(`Deleted expense "${title}".`);
      await loadAllInventoryData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete expense.');
    }
  };

  const dateRangeLabel = useMemo(() => {
    if (filterFrom && filterTo) {
      return filterFrom === filterTo ? filterFrom : `${filterFrom}_to_${filterTo}`;
    }
    if (filterFrom) return `from_${filterFrom}`;
    if (filterTo) return `to_${filterTo}`;
    return 'all-time';
  }, [filterFrom, filterTo]);

  const filteredProductsList = useMemo(() => {
    if (productCategoryTab === 'all') return drinks;
    return drinks.filter((d) => d.category === productCategoryTab);
  }, [drinks, productCategoryTab]);

  const kpis = report?.kpis;

  const renderProductReportRows = (rows: ProductAnalyticsItem[], emptyText: string) => {
    if (rows.length === 0) {
      return (
        <div className="p-6 rounded-lg border border-white/10 bg-[#0C153B]/60 text-center text-xs text-slate-400">
          {emptyText}
        </div>
      );
    }
    return (
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#0C153B] text-slate-300 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="px-3 py-2.5">Product</th>
              <th className="px-3 py-2.5">Category</th>
              <th className="px-3 py-2.5 text-right">Purchase / Sell</th>
              <th className="px-3 py-2.5 text-right">Qty Sold</th>
              <th className="px-3 py-2.5 text-right">Remaining</th>
              <th className="px-3 py-2.5 text-right">Revenue</th>
              <th className="px-3 py-2.5 text-right">Gross Profit</th>
              <th className="px-3 py-2.5 text-right">Stock Cost Value</th>
              <th className="px-3 py-2.5">Stock Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-[#121D52]/70">
            {rows.map((p) => {
              const badge = getStockBadge(p.current_stock, p.min_stock_alert);
              return (
                <tr key={p.id} className="hover:bg-white/5">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-white">{p.name}</div>
                    {(p.brand || p.bottle_size) && (
                      <div className="text-[10px] text-slate-400">
                        {[p.brand, p.bottle_size].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">
                    {CATEGORY_META[p.category]?.shortLabel ?? p.category}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-200">
                    {p.purchase_price_pkr.toLocaleString()} / {p.selling_price_pkr.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-[#c4d835]">
                    {p.qty_sold}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-white">
                    {p.current_stock}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-white">
                    {formatPkr(p.revenue_pkr)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono-tabular font-semibold ${
                      p.profit_pkr < 0 ? 'text-rose-300' : 'text-emerald-300'
                    }`}
                  >
                    {formatPkr(p.profit_pkr)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-300">
                    {formatPkr(p.remaining_cost_value_pkr)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded ${badge.classes}`}>
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="rounded-xl border border-[#c4d835]/30 bg-[#121D52] p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#c4d835]">
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Private Internal Business Module · Admin Only</span>
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-extrabold uppercase text-white">
            Drinks Inventory, Sales &amp; Profit Management
          </h2>
          <p className="text-xs text-slate-300">
            Track bottle stock, manual counter sales, additional expenses, and real-time profit &amp; loss internally. Not visible to website customers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadAllInventoryData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#16235C] hover:border-[#c4d835] border border-white/15 rounded-lg cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={() => openAddProductModal()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#c4d835] hover:bg-[#d4e157] text-[#0E1845] font-bold text-xs uppercase rounded-lg shadow cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-[#121D52] border border-white/15">
        {(
          [
            { id: 'dashboard', label: 'Analytics Dashboard', icon: BarChart3 },
            { id: 'products', label: `Products & Stock (${drinks.length})`, icon: Package },
            { id: 'sales', label: 'Daily Sales', icon: ShoppingCart },
            { id: 'expenses', label: 'Expenses', icon: Receipt },
            { id: 'reports', label: 'Unsold Stock & Reports', icon: FileSpreadsheet },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                active
                  ? 'bg-[#c4d835] text-[#0E1845]'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Alerts */}
      {successMessage && (
        <div className="p-3.5 rounded-xl border border-emerald-400/40 bg-emerald-950/40 text-xs sm:text-sm text-emerald-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-300 hover:text-white p-1 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border border-rose-400/40 bg-rose-950/40 text-xs sm:text-sm text-rose-200 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-300 hover:text-white p-1 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Bar (shown on Dashboard, Sales, Expenses, Reports) */}
      {subTab !== 'products' && (
        <div className="rounded-xl border border-white/15 bg-[#121D52] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
              Filter Period &amp; Scope
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'today', label: 'Today' },
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: 'week', label: 'Last 7 Days' },
                  { id: 'month', label: 'This Month' },
                  { id: 'all', label: 'All Time' },
                  { id: 'custom', label: 'Custom' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded border cursor-pointer ${
                    datePreset === preset.id
                      ? 'bg-[#c4d835] text-[#0E1845] border-[#c4d835]'
                      : 'bg-[#16235C] text-slate-300 border-white/15 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="filter-from" className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                From Date
              </label>
              <input
                id="filter-from"
                type="date"
                value={filterFrom}
                onChange={(e) => {
                  setDatePreset('custom');
                  setFilterFrom(e.target.value);
                }}
                className="w-full px-3 py-1.5 bg-[#16235C] border border-white/15 rounded text-xs text-white focus:outline-none focus:border-[#c4d835]"
              />
            </div>
            <div>
              <label htmlFor="filter-to" className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                To Date
              </label>
              <input
                id="filter-to"
                type="date"
                value={filterTo}
                onChange={(e) => {
                  setDatePreset('custom');
                  setFilterTo(e.target.value);
                }}
                className="w-full px-3 py-1.5 bg-[#16235C] border border-white/15 rounded text-xs text-white focus:outline-none focus:border-[#c4d835]"
              />
            </div>
            <div>
              <label htmlFor="filter-category" className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                Category
              </label>
              <select
                id="filter-category"
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full px-3 py-1.5 bg-[#16235C] border border-white/15 rounded text-xs text-white focus:outline-none focus:border-[#c4d835]"
              >
                <option value="">All Categories</option>
                <option value="cold_drinks">Cold Drinks</option>
                <option value="water">Water</option>
                <option value="hydration_drinks">Hydration Drinks</option>
              </select>
            </div>
            <div>
              <label htmlFor="filter-product" className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                Product
              </label>
              <select
                id="filter-product"
                value={filterDrinkId}
                onChange={(e) => setFilterDrinkId(e.target.value)}
                className="w-full px-3 py-1.5 bg-[#16235C] border border-white/15 rounded text-xs text-white focus:outline-none focus:border-[#c4d835]"
              >
                <option value="">All Products</option>
                {drinks.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 1: ANALYTICS DASHBOARD */}
      {subTab === 'dashboard' && (
        <div className="space-y-6">
          {loading && !kpis ? (
            <div className="py-12 text-center text-sm text-slate-300">
              Calculating inventory and financial analytics...
            </div>
          ) : kpis ? (
            <>
              {/* Financial & Stock KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <div className="rounded-xl border border-white/15 bg-[#121D52] p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Total Revenue
                  </div>
                  <div className="mt-1 font-mono-tabular text-xl font-extrabold text-white">
                    {formatPkr(kpis.totalRevenuePkr)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {kpis.totalSalesCount} sales · {kpis.totalItemsSold} units sold
                  </div>
                </div>

                <div className="rounded-xl border border-white/15 bg-[#121D52] p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Purchase Cost (COGS)
                  </div>
                  <div className="mt-1 font-mono-tabular text-xl font-extrabold text-slate-100">
                    {formatPkr(kpis.totalPurchaseCostPkr)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Gross Profit: <span className="text-emerald-300 font-mono-tabular">{formatPkr(kpis.grossProfitPkr)}</span>
                  </div>
                </div>

                <div
                  className={`rounded-xl border p-4 ${
                    kpis.netProfitPkr >= 0
                      ? 'border-emerald-500/40 bg-emerald-950/30'
                      : 'border-rose-500/40 bg-rose-950/30'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-slate-300">
                    <span>Net Profit / Loss</span>
                    {kpis.netProfitPkr >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    )}
                  </div>
                  <div
                    className={`mt-1 font-mono-tabular text-xl font-extrabold ${
                      kpis.netProfitPkr >= 0 ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {formatPkr(kpis.netProfitPkr)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-300">
                    After {formatPkr(kpis.totalExpensesPkr)} expenses
                  </div>
                </div>

                <div className="rounded-xl border border-white/15 bg-[#121D52] p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Total Profit vs Loss
                  </div>
                  <div className="mt-1 flex items-baseline gap-2 font-mono-tabular">
                    <span className="text-base font-extrabold text-[#c4d835]">
                      +{formatPkr(kpis.totalProfitPkr)}
                    </span>
                    <span className="text-xs text-rose-300 font-bold">
                      / -{formatPkr(kpis.totalLossPkr)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Actual financial loss only
                  </div>
                </div>

                <div className="rounded-xl border border-white/15 bg-[#121D52] p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Total Products
                  </div>
                  <div className="mt-1 font-mono-tabular text-xl font-extrabold text-white">
                    {kpis.totalProducts}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {kpis.activeProducts} active · {kpis.zeroSalesProductsCount} unsold
                  </div>
                </div>

                <div className="rounded-xl border border-white/15 bg-[#121D52] p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Total Items Remaining
                  </div>
                  <div className="mt-1 font-mono-tabular text-xl font-extrabold text-white">
                    {kpis.totalItemsRemaining}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Cost Value: <span className="font-mono-tabular text-slate-200">{formatPkr(kpis.remainingInventoryCostValuePkr)}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/35 bg-[#121D52] p-4">
                  <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">
                    Low Stock Alert
                  </div>
                  <div className="mt-1 font-mono-tabular text-xl font-extrabold text-amber-300">
                    {kpis.lowStockCount}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    At or below min threshold
                  </div>
                </div>

                <div className="rounded-xl border border-rose-500/35 bg-[#121D52] p-4">
                  <div className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold">
                    Out of Stock
                  </div>
                  <div className="mt-1 font-mono-tabular text-xl font-extrabold text-rose-300">
                    {kpis.outOfStockCount}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Retail Stock Value: <span className="font-mono-tabular text-slate-200">{formatPkr(kpis.remainingInventoryRetailValuePkr)}</span>
                  </div>
                </div>
              </div>

              {/* P&L Formula Explanation Card */}
              <div className="rounded-xl border border-white/15 bg-[#121D52] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
                  <h3 className="font-display text-sm font-bold uppercase text-white tracking-wide">
                    Profit &amp; Loss Breakdown (Accounting View)
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      report && exportProfitLossReportCsv(report, expenses, dateRangeLabel)
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export P&amp;L CSV</span>
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2">
                    <div className="flex justify-between py-1 border-b border-white/10">
                      <span className="text-slate-300">Revenue (Total Completed Sales)</span>
                      <span className="font-mono-tabular font-bold text-white">
                        {formatPkr(kpis.totalRevenuePkr)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/10">
                      <span className="text-slate-300">Less: Cost of Goods Sold (Purchase Cost × Qty Sold)</span>
                      <span className="font-mono-tabular font-bold text-rose-300">
                        -{formatPkr(kpis.totalPurchaseCostPkr)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/10">
                      <span className="font-semibold text-white">Gross Profit</span>
                      <span className="font-mono-tabular font-bold text-[#c4d835]">
                        {formatPkr(kpis.grossProfitPkr)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/10">
                      <span className="text-slate-300">Less: Recorded Additional Expenses</span>
                      <span className="font-mono-tabular font-bold text-rose-300">
                        -{formatPkr(kpis.totalExpensesPkr)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="font-bold text-white uppercase">Net Profit / Loss</span>
                      <span
                        className={`font-mono-tabular font-extrabold text-sm ${
                          kpis.netProfitPkr >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {formatPkr(kpis.netProfitPkr)}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#0C153B] border border-white/10 p-3.5 space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#c4d835]">
                      Remaining Unsold Stock Valuation (Asset — Not a Loss)
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Unsold Units on Shelf</span>
                      <span className="font-mono-tabular font-bold text-white">
                        {kpis.totalItemsRemaining} units
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Inventory Asset at Purchase Cost</span>
                      <span className="font-mono-tabular font-bold text-white">
                        {formatPkr(kpis.remainingInventoryCostValuePkr)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300">Potential Retail Value</span>
                      <span className="font-mono-tabular font-bold text-[#c4d835]">
                        {formatPkr(kpis.remainingInventoryRetailValuePkr)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category Summary */}
              {report && (
                <div className="rounded-xl border border-white/15 bg-[#121D52] p-4 space-y-3">
                  <h3 className="font-display text-sm font-bold uppercase text-white tracking-wide">
                    Category-Wise Sales &amp; Stock Summary
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#0C153B] text-slate-300 uppercase text-[10px]">
                        <tr>
                          <th className="px-3 py-2.5">Category</th>
                          <th className="px-3 py-2.5 text-right">Products</th>
                          <th className="px-3 py-2.5 text-right">Items Sold</th>
                          <th className="px-3 py-2.5 text-right">Remaining</th>
                          <th className="px-3 py-2.5 text-right">Revenue</th>
                          <th className="px-3 py-2.5 text-right">COGS</th>
                          <th className="px-3 py-2.5 text-right">Gross Profit</th>
                          <th className="px-3 py-2.5 text-right">Stock Cost Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {report.categoryReport.map((cat) => (
                          <tr key={cat.category} className="hover:bg-white/5">
                            <td className="px-3 py-2.5 font-semibold text-white">{cat.label}</td>
                            <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-300">
                              {cat.product_count}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-[#c4d835]">
                              {cat.items_sold}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono-tabular text-white">
                              {cat.items_remaining}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono-tabular text-white">
                              {formatPkr(cat.revenue_pkr)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-300">
                              {formatPkr(cat.cogs_pkr)}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-mono-tabular font-bold ${
                                cat.gross_profit_pkr < 0 ? 'text-rose-300' : 'text-emerald-300'
                              }`}
                            >
                              {formatPkr(cat.gross_profit_pkr)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-300">
                              {formatPkr(cat.inventory_cost_value_pkr)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Audit Activity */}
              {report && (report.recentAdjustments.length > 0 || report.recentSaleLogs.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-white/15 bg-[#121D52] p-4 space-y-2.5">
                    <h3 className="font-display text-sm font-bold uppercase text-white">
                      Recent Stock Movement Log
                    </h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {report.recentAdjustments.slice(0, 15).map((adj) => (
                        <div
                          key={adj.id}
                          className="p-2.5 rounded-lg bg-[#0C153B] border border-white/10 text-xs flex items-start justify-between gap-2"
                        >
                          <div>
                            <div className="font-semibold text-white">
                              {adj.drink_name || `Product #${adj.drink_id}`}{' '}
                              <span className="text-[10px] text-slate-400 uppercase">
                                ({adj.adjustment_type})
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {adj.reason || 'Stock updated'} · by {adj.created_by}
                            </div>
                          </div>
                          <div className="text-right shrink-0 font-mono-tabular">
                            <div
                              className={`font-bold ${
                                adj.delta_qty >= 0 ? 'text-emerald-300' : 'text-amber-300'
                              }`}
                            >
                              {adj.delta_qty >= 0 ? `+${adj.delta_qty}` : adj.delta_qty}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {adj.previous_stock} → {adj.new_stock}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/15 bg-[#121D52] p-4 space-y-2.5">
                    <h3 className="font-display text-sm font-bold uppercase text-white">
                      Recent Sale Audit Trail
                    </h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {report.recentSaleLogs.slice(0, 15).map((log) => (
                        <div
                          key={log.id}
                          className="p-2.5 rounded-lg bg-[#0C153B] border border-white/10 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[10px] font-bold uppercase ${
                                log.action === 'CANCELLED'
                                  ? 'text-rose-300'
                                  : log.action === 'EDITED'
                                  ? 'text-amber-300'
                                  : 'text-emerald-300'
                              }`}
                            >
                              {log.action} · Sale #{log.sale_id}
                            </span>
                            <span className="text-[10px] text-slate-400">{log.actor_username}</span>
                          </div>
                          <p className="text-[11px] text-slate-300 mt-0.5">{log.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* SUBTAB 2: PRODUCTS & STOCK */}
      {subTab === 'products' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: `All (${drinks.length})`, icon: Package },
                  {
                    id: 'cold_drinks',
                    label: `Cold Drinks (${drinks.filter((d) => d.category === 'cold_drinks').length})`,
                    icon: CupSoda,
                  },
                  {
                    id: 'water',
                    label: `Water (${drinks.filter((d) => d.category === 'water').length})`,
                    icon: Droplet,
                  },
                  {
                    id: 'hydration_drinks',
                    label: `Hydration Drinks (${drinks.filter((d) => d.category === 'hydration_drinks').length})`,
                    icon: Zap,
                  },
                ] as const
              ).map((cat) => {
                const Icon = cat.icon;
                const active = productCategoryTab === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setProductCategoryTab(cat.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                      active
                        ? 'bg-[#c4d835] text-[#0E1845] border-[#c4d835]'
                        : 'bg-[#121D52] text-slate-300 border-white/15 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => openAddProductModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#c4d835] hover:bg-[#d4e157] text-[#0E1845] font-bold text-xs uppercase rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Product</span>
            </button>
          </div>

          {filteredProductsList.length === 0 ? (
            <div className="p-10 rounded-xl border border-white/10 bg-[#121D52] text-center space-y-2">
              <p className="text-sm font-semibold text-white">No inventory products added yet.</p>
              <p className="text-xs text-slate-400">
                Add your actual Cold Drinks, Water, and Hydration Drinks with purchase cost, selling price, and opening stock.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredProductsList.map((drink) => {
                const badge = getStockBadge(drink.current_stock, drink.min_stock_alert);
                const unitMargin = drink.price_pkr - drink.purchase_price_pkr;
                return (
                  <div
                    key={drink.id}
                    className={`rounded-xl border p-4 bg-[#121D52] flex flex-col justify-between gap-4 ${
                      drink.is_active === 0 ? 'border-white/10 opacity-75' : 'border-white/15'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        {drink.image_url ? (
                          <img
                            src={drink.image_url}
                            alt={drink.name}
                            className="w-14 h-14 rounded-lg object-cover bg-[#16235C] border border-white/10 shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-lg bg-[#16235C] border border-white/10 flex items-center justify-center shrink-0">
                            <CupSoda className="w-6 h-6 text-[#c4d835]" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-bold text-white truncate">{drink.name}</h3>
                            <span className="text-[10px] font-semibold text-slate-300 bg-[#0C153B] px-2 py-0.5 rounded border border-white/10 shrink-0">
                              {CATEGORY_META[drink.category].shortLabel}
                            </span>
                          </div>
                          {(drink.brand || drink.bottle_size) && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {[drink.brand, drink.bottle_size].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${badge.classes}`}>
                              {badge.label}
                            </span>
                            <button
                              type="button"
                              disabled={busyDrinkId === drink.id}
                              onClick={() => void handleToggleProductActive(drink)}
                              className={`px-2 py-0.5 text-[10px] font-semibold rounded border cursor-pointer ${
                                drink.is_active === 1
                                  ? 'bg-blue-950/80 text-blue-300 border-blue-500/35'
                                  : 'bg-slate-800 text-slate-300 border-slate-600'
                              }`}
                            >
                              {drink.is_active === 1 ? 'Active' : 'Inactive'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-[#0C153B] border border-white/10 text-xs">
                        <div>
                          <div className="text-[10px] text-slate-400">Purchase</div>
                          <div className="font-mono-tabular font-bold text-slate-200">
                            PKR {drink.purchase_price_pkr.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400">Selling</div>
                          <div className="font-mono-tabular font-bold text-[#c4d835]">
                            PKR {drink.price_pkr.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400">Margin / Unit</div>
                          <div
                            className={`font-mono-tabular font-bold ${
                              unitMargin >= 0 ? 'text-emerald-300' : 'text-rose-300'
                            }`}
                          >
                            PKR {unitMargin.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-slate-400">Opening: </span>
                          <span className="font-mono-tabular font-bold text-slate-200">
                            {drink.opening_stock}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Stock: </span>
                          <span className="font-mono-tabular font-extrabold text-white">
                            {drink.current_stock}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Min Alert: </span>
                          <span className="font-mono-tabular font-bold text-slate-300">
                            {drink.min_stock_alert}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAdjustingDrink(drink);
                          setAdjustDirection('add');
                          setAdjustQty('1');
                          setAdjustReason('');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded cursor-pointer"
                      >
                        <ArrowDownUp className="w-3.5 h-3.5" />
                        <span>Adjust Stock</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditProductModal(drink)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white bg-white/5 hover:bg-white/10 rounded border border-white/15 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>

                        {confirmDeleteDrinkId === drink.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busyDrinkId === drink.id}
                              onClick={() => void handleDeleteProduct(drink)}
                              className="px-2 py-1.5 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-500 rounded cursor-pointer"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteDrinkId(null)}
                              className="px-2 py-1.5 text-[11px] font-semibold text-slate-300 bg-white/10 rounded cursor-pointer"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteDrinkId(drink.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:text-rose-100 bg-rose-950/40 hover:bg-rose-900/60 rounded border border-rose-500/30 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 3: DAILY SALES MANAGEMENT */}
      {subTab === 'sales' && (
        <div className="space-y-6">
          {/* Manual Sale Entry Form */}
          <form
            onSubmit={(e) => void handleRecordSale(e)}
            className="rounded-xl border border-[#c4d835]/35 bg-[#121D52] p-4 sm:p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
              <div>
                <h3 className="font-display text-base font-bold uppercase text-white">
                  Record Manual Counter Sale
                </h3>
                <p className="text-xs text-slate-400">
                  Select a product and quantity sold. Stock deducts automatically and unit cost &amp; profit are snapshot for accurate accounting.
                </p>
              </div>
              {selectedSaleProduct && (
                <div className="text-xs font-mono-tabular bg-[#0C153B] border border-white/15 px-3 py-1.5 rounded">
                  Available Stock:{' '}
                  <strong className="text-[#c4d835]">{selectedSaleProduct.current_stock}</strong>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="lg:col-span-2">
                <label htmlFor="sale-product" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Product *
                </label>
                <select
                  id="sale-product"
                  required
                  value={saleDrinkId}
                  onChange={(e) => handleSelectSaleProduct(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                >
                  <option value="">-- Select Active In-Stock Product --</option>
                  {sellableDrinks.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name} ({d.current_stock} left · PKR {d.price_pkr})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sale-qty" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Qty Sold *
                </label>
                <input
                  id="sale-qty"
                  type="number"
                  min={1}
                  max={selectedSaleProduct?.current_stock || 9999}
                  required
                  value={saleQty}
                  onChange={(e) => setSaleQty(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div>
                <label htmlFor="sale-sell-price" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Selling / Unit (PKR) *
                </label>
                <input
                  id="sale-sell-price"
                  type="number"
                  min={0}
                  required
                  value={saleUnitSellPrice}
                  onChange={(e) => setSaleUnitSellPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div>
                <label htmlFor="sale-cost-price" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Cost / Unit (PKR) *
                </label>
                <input
                  id="sale-cost-price"
                  type="number"
                  min={0}
                  required
                  value={saleUnitCostPrice}
                  onChange={(e) => setSaleUnitCostPrice(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label htmlFor="sale-datetime" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Sale Date &amp; Time *
                </label>
                <input
                  id="sale-datetime"
                  type="datetime-local"
                  required
                  value={saleSoldAt}
                  onChange={(e) => setSaleSoldAt(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div className="lg:col-span-2">
                <label htmlFor="sale-notes" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Optional Notes
                </label>
                <input
                  id="sale-notes"
                  type="text"
                  maxLength={250}
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  placeholder="e.g. Evening match group counter sale"
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div>
                  <span className="text-slate-400">Total Sale: </span>
                  <strong className="font-mono-tabular text-white">
                    {formatPkr(liveSalePreview.totalSale)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400">Total Cost: </span>
                  <strong className="font-mono-tabular text-slate-300">
                    {formatPkr(liveSalePreview.totalCost)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400">Estimated Profit: </span>
                  <strong
                    className={`font-mono-tabular ${
                      liveSalePreview.profit >= 0 ? 'text-[#c4d835]' : 'text-rose-300'
                    }`}
                  >
                    {formatPkr(liveSalePreview.profit)}
                  </strong>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingSale || !selectedSaleProduct}
                className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 bg-[#c4d835] hover:bg-[#d4e157] text-[#0E1845] font-bold text-xs uppercase rounded-lg cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{savingSale ? 'Recording...' : 'Record Sale'}</span>
              </button>
            </div>
          </form>

          {/* Sales History Table */}
          <div className="rounded-xl border border-white/15 bg-[#121D52] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold uppercase text-white">
                Sales History ({sales.length})
              </h3>
              <button
                type="button"
                onClick={() => exportSalesReportCsv(sales, dateRangeLabel)}
                disabled={sales.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded cursor-pointer disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Sales CSV</span>
              </button>
            </div>

            {sales.length === 0 ? (
              <div className="p-8 rounded-lg border border-white/10 bg-[#0C153B]/60 text-center text-xs text-slate-400">
                No sales match the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0C153B] text-slate-300 uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-2.5">ID / Date</th>
                      <th className="px-3 py-2.5">Product</th>
                      <th className="px-3 py-2.5 text-right">Qty</th>
                      <th className="px-3 py-2.5 text-right">Unit Price</th>
                      <th className="px-3 py-2.5 text-right">Total Sale</th>
                      <th className="px-3 py-2.5 text-right">Total Cost</th>
                      <th className="px-3 py-2.5 text-right">Profit</th>
                      <th className="px-3 py-2.5">Status / Audit</th>
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {sales.map((s) => (
                      <tr
                        key={s.id}
                        className={s.status === 'CANCELLED' ? 'bg-rose-950/20 opacity-75' : 'hover:bg-white/5'}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-mono-tabular font-bold text-white">#{s.id}</div>
                          <div className="text-[10px] text-slate-400">
                            {s.sold_at.replace('T', ' ')}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-white">{s.product_name}</div>
                          {s.notes && <div className="text-[10px] text-slate-400">{s.notes}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-white">
                          {s.quantity}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-300">
                          {s.unit_selling_price_pkr.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-white">
                          {formatPkr(s.total_sale_pkr)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono-tabular text-slate-300">
                          {formatPkr(s.total_cost_pkr)}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono-tabular font-bold ${
                            s.status === 'CANCELLED'
                              ? 'text-slate-400 line-through'
                              : s.profit_pkr >= 0
                              ? 'text-[#c4d835]'
                              : 'text-rose-300'
                          }`}
                        >
                          {formatPkr(s.profit_pkr)}
                        </td>
                        <td className="px-3 py-2.5">
                          {s.status === 'COMPLETED' ? (
                            <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/35">
                              Completed
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded bg-rose-950/80 text-rose-300 border border-rose-500/35">
                              Cancelled
                            </span>
                          )}
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            By {s.created_by}
                            {s.cancelled_by ? ` · Cancelled by ${s.cancelled_by}` : ''}
                          </div>
                          {s.cancel_reason && (
                            <div className="text-[10px] text-rose-300">{s.cancel_reason}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {s.status === 'COMPLETED' ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditSaleModal(s)}
                                className="px-2 py-1 text-[11px] font-semibold text-slate-200 bg-white/5 hover:bg-white/10 border border-white/15 rounded cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCancellingSale(s);
                                  setCancelSaleReason('');
                                }}
                                className="px-2 py-1 text-[11px] font-semibold text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 rounded cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-500">Stock Restored</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 4: EXPENSES MANAGEMENT */}
      {subTab === 'expenses' && (
        <div className="space-y-6">
          <form
            onSubmit={(e) => void handleRecordExpense(e)}
            className="rounded-xl border border-white/15 bg-[#121D52] p-4 sm:p-5 space-y-4"
          >
            <div>
              <h3 className="font-display text-base font-bold uppercase text-white">
                Record Additional Inventory Expense
              </h3>
              <p className="text-xs text-slate-400">
                Record delivery/transportation, ice, cooling, or extra stock handling costs. Subtracted from Gross Profit to compute Net Profit (COGS is already tracked per sale).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label htmlFor="exp-title" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Expense Name *
                </label>
                <input
                  id="exp-title"
                  type="text"
                  required
                  value={expenseTitle}
                  onChange={(e) => setExpenseTitle(e.target.value)}
                  placeholder="e.g. Beverage Delivery Rickshaw"
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div>
                <label htmlFor="exp-amount" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Amount (PKR) *
                </label>
                <input
                  id="exp-amount"
                  type="number"
                  min={1}
                  required
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  placeholder="500"
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div>
                <label htmlFor="exp-date" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Expense Date *
                </label>
                <input
                  id="exp-date"
                  type="date"
                  required
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div>
                <label htmlFor="exp-desc" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Notes / Description
                </label>
                <input
                  id="exp-desc"
                  type="text"
                  maxLength={250}
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                  placeholder="Optional details"
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingExpense}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#c4d835] hover:bg-[#d4e157] text-[#0E1845] font-bold text-xs uppercase rounded-lg cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{savingExpense ? 'Saving...' : 'Add Expense'}</span>
              </button>
            </div>
          </form>

          <div className="rounded-xl border border-white/15 bg-[#121D52] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold uppercase text-white">
                Recorded Expenses ({expenses.length})
              </h3>
              <span className="font-mono-tabular text-xs font-bold text-rose-300">
                Total: {formatPkr(expenses.reduce((sum, e) => sum + e.amount_pkr, 0))}
              </span>
            </div>

            {expenses.length === 0 ? (
              <div className="p-8 rounded-lg border border-white/10 bg-[#0C153B]/60 text-center text-xs text-slate-400">
                No additional inventory expenses recorded in this date range.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0C153B] text-slate-300 uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Expense</th>
                      <th className="px-3 py-2.5">Description</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="px-3 py-2.5">Recorded By</th>
                      <th className="px-3 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {expenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-white/5">
                        <td className="px-3 py-2.5 font-mono-tabular text-slate-300">
                          {exp.expense_date}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-white">{exp.title}</td>
                        <td className="px-3 py-2.5 text-slate-400">{exp.description || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-rose-300">
                          {formatPkr(exp.amount_pkr)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-400">{exp.created_by}</td>
                        <td className="px-3 py-2.5 text-right">
                          {confirmDeleteExpenseId === exp.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handleDeleteExpense(exp.id, exp.title)}
                                className="px-2 py-1 text-[10px] font-bold text-white bg-rose-600 rounded cursor-pointer"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteExpenseId(null)}
                                className="px-2 py-1 text-[10px] text-slate-300 bg-white/10 rounded cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteExpenseId(exp.id)}
                              className="px-2 py-1 text-[11px] font-semibold text-rose-300 hover:text-white bg-rose-950/40 rounded border border-rose-500/30 cursor-pointer"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 5: UNSOLD STOCK & REPORTS + CSV EXPORT */}
      {subTab === 'reports' && report && (
        <div className="space-y-6">
          {/* Export Toolbar */}
          <div className="rounded-xl border border-[#c4d835]/30 bg-[#121D52] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold uppercase text-white">
                Downloadable Excel / CSV Reports
              </h3>
              <p className="text-xs text-slate-300">
                Exports match your active date, category, and product filters ({dateRangeLabel}).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportInventoryReportCsv(report, dateRangeLabel)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-lg cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Inventory &amp; Unsold CSV</span>
              </button>
              <button
                type="button"
                onClick={() => exportSalesReportCsv(sales, dateRangeLabel)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#16235C] hover:border-[#c4d835] border border-white/15 rounded-lg cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Sales CSV</span>
              </button>
              <button
                type="button"
                onClick={() => exportProfitLossReportCsv(report, expenses, dateRangeLabel)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#16235C] hover:border-[#c4d835] border border-white/15 rounded-lg cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>P&amp;L Statement CSV</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-white/15 bg-[#121D52] p-4 space-y-3">
            <h3 className="font-display text-sm font-bold uppercase text-white">
              Unsold / Zero-Sales Products ({report.unsoldProducts.length})
            </h3>
            <p className="text-xs text-slate-400">
              Products with zero recorded sales inside the selected period (remaining stock is held as inventory value, not counted as a loss).
            </p>
            {renderProductReportRows(
              report.unsoldProducts,
              'All filtered products recorded at least one sale in this period.'
            )}
          </div>

          <div className="rounded-xl border border-white/15 bg-[#121D52] p-4 space-y-3">
            <h3 className="font-display text-sm font-bold uppercase text-white">
              Products That Sold ({report.soldProducts.length})
            </h3>
            {renderProductReportRows(
              report.soldProducts,
              'No products sold inside this date/category filter.'
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-amber-500/35 bg-[#121D52] p-4 space-y-3">
              <h3 className="font-display text-sm font-bold uppercase text-amber-300">
                Low Stock Products ({report.lowStockProducts.length})
              </h3>
              {report.lowStockProducts.length === 0 ? (
                <p className="text-xs text-slate-400">No products currently at low stock threshold.</p>
              ) : (
                <div className="space-y-2">
                  {report.lowStockProducts.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-lg bg-[#0C153B] border border-amber-500/30 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-white">{p.name}</div>
                        <div className="text-[11px] text-slate-400">
                          Min alert: {p.min_stock_alert}
                        </div>
                      </div>
                      <span className="font-mono-tabular font-extrabold text-amber-300">
                        {p.current_stock} left
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-rose-500/35 bg-[#121D52] p-4 space-y-3">
              <h3 className="font-display text-sm font-bold uppercase text-rose-300">
                Out of Stock Products ({report.outOfStockProducts.length})
              </h3>
              {report.outOfStockProducts.length === 0 ? (
                <p className="text-xs text-slate-400">No out-of-stock products.</p>
              ) : (
                <div className="space-y-2">
                  {report.outOfStockProducts.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-lg bg-[#0C153B] border border-rose-500/30 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-white">{p.name}</div>
                        <div className="text-[11px] text-slate-400">
                          {CATEGORY_META[p.category]?.label}
                        </div>
                      </div>
                      <span className="font-mono-tabular font-bold text-rose-300">0 units</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD / EDIT PRODUCT */}
      {isProductModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingDrink ? 'Edit Drink Product' : 'Add Drink Product'}
          className="fixed inset-0 z-50 bg-[#070A14]/85 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !savingProduct && setIsProductModalOpen(false)}
        >
          <div
            className="bg-[#0C153B] border border-[#c4d835]/40 rounded-2xl max-w-xl w-full p-6 shadow-2xl text-white space-y-4 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="font-display text-lg font-bold uppercase">
                {editingDrink ? 'Edit Inventory Product' : 'Add Inventory Product'}
              </h3>
              <button
                type="button"
                aria-label="Close product modal"
                onClick={() => setIsProductModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveProduct(e)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="prod-name" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Product Name *
                  </label>
                  <input
                    id="prod-name"
                    type="text"
                    required
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                    placeholder="e.g. Mineral Water 500ml"
                    className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                  />
                </div>
                <div>
                  <label htmlFor="prod-category" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Category *
                  </label>
                  <select
                    id="prod-category"
                    value={prodCategory}
                    onChange={(e) => setProdCategory(e.target.value as DrinkCategory)}
                    className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                  >
                    <option value="cold_drinks">Cold Drinks</option>
                    <option value="water">Water</option>
                    <option value="hydration_drinks">Hydration Drinks</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="prod-brand" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Brand
                  </label>
                  <input
                    id="prod-brand"
                    type="text"
                    value={prodBrand}
                    onChange={(e) => setProdBrand(e.target.value)}
                    placeholder="e.g. Nestle / Coca-Cola"
                    className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                  />
                </div>
                <div>
                  <label htmlFor="prod-size" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Bottle Size
                  </label>
                  <input
                    id="prod-size"
                    type="text"
                    value={prodBottleSize}
                    onChange={(e) => setProdBottleSize(e.target.value)}
                    placeholder="e.g. 500ml / 1.5L / Can"
                    className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="prod-purchase" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Purchase (PKR) *
                  </label>
                  <input
                    id="prod-purchase"
                    type="number"
                    min={0}
                    required
                    value={prodPurchasePrice}
                    onChange={(e) => setProdPurchasePrice(e.target.value)}
                    className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                  />
                </div>
                <div>
                  <label htmlFor="prod-selling" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Selling (PKR) *
                  </label>
                  <input
                    id="prod-selling"
                    type="number"
                    min={1}
                    required
                    value={prodSellingPrice}
                    onChange={(e) => setProdSellingPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                  />
                </div>
                <div>
                  <label htmlFor="prod-opening" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Opening Stock *
                  </label>
                  <input
                    id="prod-opening"
                    type="number"
                    min={0}
                    required
                    value={prodOpeningStock}
                    onChange={(e) => setProdOpeningStock(e.target.value)}
                    className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                  />
                </div>
                <div>
                  <label htmlFor="prod-min" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Min Stock Alert
                  </label>
                  <input
                    id="prod-min"
                    type="number"
                    min={0}
                    value={prodMinAlert}
                    onChange={(e) => setProdMinAlert(e.target.value)}
                    className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                  />
                </div>
              </div>

              {editingDrink && (
                <div>
                  <label htmlFor="prod-current" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                    Current Stock Quantity
                  </label>
                  <input
                    id="prod-current"
                    type="number"
                    min={0}
                    value={prodCurrentStock}
                    onChange={(e) => setProdCurrentStock(e.target.value)}
                    className="w-full sm:w-48 px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                  />
                </div>
              )}

              {/* Optional Image */}
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase text-slate-300">
                  Product Image (Optional)
                </label>
                <div className="flex items-start gap-3">
                  {prodImageUrl ? (
                    <div className="relative shrink-0">
                      <img
                        src={prodImageUrl}
                        alt="Preview"
                        className="w-14 h-14 rounded-lg object-cover bg-[#16235C] border border-white/15"
                      />
                      <button
                        type="button"
                        onClick={() => setProdImageUrl('')}
                        aria-label="Remove image"
                        className="absolute -top-2 -right-2 w-5 h-5 rounded bg-rose-600 text-white flex items-center justify-center cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-[#16235C] border border-white/15 flex items-center justify-center shrink-0">
                      <CupSoda className="w-6 h-6 text-[#c4d835]" />
                    </div>
                  )}

                  <div className="flex-1 space-y-2">
                    <input
                      ref={fileInputRef}
                      id="prod-image-file"
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleImageFileSelect(e.target.files)}
                      className="sr-only"
                    />
                    <label
                      htmlFor="prod-image-file"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingImage ? 'Processing...' : 'Upload Image'}</span>
                    </label>
                    <input
                      type="text"
                      value={prodImageUrl.startsWith('data:') ? '' : prodImageUrl}
                      onChange={(e) => setProdImageUrl(e.target.value)}
                      placeholder={
                        prodImageUrl.startsWith('data:')
                          ? 'Uploaded image attached (paste URL to replace)'
                          : 'Or paste image URL (optional)'
                      }
                      className="w-full px-3 py-1.5 bg-[#16235C] border border-white/15 rounded text-xs text-white focus:outline-none focus:border-[#c4d835]"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="prod-desc" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Notes / Description (Optional)
                </label>
                <input
                  id="prod-desc"
                  type="text"
                  value={prodDescription}
                  onChange={(e) => setProdDescription(e.target.value)}
                  placeholder="Optional internal note"
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={prodIsActive}
                  onChange={(e) => setProdIsActive(e.target.checked)}
                  className="w-4 h-4 accent-[#c4d835]"
                />
                <span className="text-xs font-semibold text-white">
                  Active (available for manual counter sales)
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-300 bg-white/5 hover:bg-white/10 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProduct || uploadingImage}
                  className="px-5 py-2 bg-[#c4d835] hover:bg-[#d4e157] text-[#0E1845] font-bold text-xs uppercase rounded-md cursor-pointer disabled:opacity-50"
                >
                  {savingProduct ? 'Saving...' : editingDrink ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADJUST STOCK */}
      {adjustingDrink && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Adjust Product Stock"
          className="fixed inset-0 z-50 bg-[#070A14]/85 flex items-center justify-center p-4"
          onClick={() => !savingAdjustment && setAdjustingDrink(null)}
        >
          <div
            className="bg-[#0C153B] border border-[#c4d835]/40 rounded-2xl max-w-md w-full p-6 shadow-2xl text-white space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h3 className="font-display text-base font-bold uppercase">Adjust Stock</h3>
                <p className="text-xs text-slate-300">
                  {adjustingDrink.name} · Current Stock:{' '}
                  <strong className="font-mono-tabular text-[#c4d835]">
                    {adjustingDrink.current_stock}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                aria-label="Close stock modal"
                onClick={() => setAdjustingDrink(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveStockAdjustment(e)} className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustDirection('add')}
                  className={`py-2 text-xs font-bold rounded border cursor-pointer ${
                    adjustDirection === 'add'
                      ? 'bg-[#c4d835] text-[#0E1845] border-[#c4d835]'
                      : 'bg-[#16235C] text-slate-300 border-white/15'
                  }`}
                >
                  + Increase (Restock)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustDirection('remove')}
                  className={`py-2 text-xs font-bold rounded border cursor-pointer ${
                    adjustDirection === 'remove'
                      ? 'bg-rose-600 text-white border-rose-500'
                      : 'bg-[#16235C] text-slate-300 border-white/15'
                  }`}
                >
                  - Decrease (Spoilage/Loss)
                </button>
              </div>

              <div>
                <label htmlFor="adj-qty" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Quantity *
                </label>
                <input
                  id="adj-qty"
                  type="number"
                  min={1}
                  required
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-sm font-mono-tabular text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div>
                <label htmlFor="adj-reason" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Reason
                </label>
                <input
                  id="adj-reason"
                  type="text"
                  maxLength={200}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. New crate received / Damaged bottle"
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-[#c4d835]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setAdjustingDrink(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-300 bg-white/5 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAdjustment}
                  className="px-5 py-2 bg-[#c4d835] hover:bg-[#d4e157] text-[#0E1845] font-bold text-xs uppercase rounded-md cursor-pointer"
                >
                  {savingAdjustment ? 'Saving...' : 'Update Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT COMPLETED SALE */}
      {editingSale && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit Sale Record"
          className="fixed inset-0 z-50 bg-[#070A14]/85 flex items-center justify-center p-4"
          onClick={() => !savingSaleEdit && setEditingSale(null)}
        >
          <div
            className="bg-[#0C153B] border border-[#c4d835]/40 rounded-2xl max-w-md w-full p-6 shadow-2xl text-white space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h3 className="font-display text-base font-bold uppercase">
                  Edit Sale #{editingSale.id}
                </h3>
                <p className="text-xs text-slate-300">{editingSale.product_name}</p>
              </div>
              <button
                type="button"
                aria-label="Close edit sale modal"
                onClick={() => setEditingSale(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveSaleEdit(e)} className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="edit-sale-qty" className="block text-[10px] font-semibold uppercase text-slate-300 mb-1">
                    Qty Sold
                  </label>
                  <input
                    id="edit-sale-qty"
                    type="number"
                    min={1}
                    required
                    value={editSaleQty}
                    onChange={(e) => setEditSaleQty(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[#16235C] border border-white/15 rounded text-xs font-mono-tabular text-white"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-sell" className="block text-[10px] font-semibold uppercase text-slate-300 mb-1">
                    Sell Price
                  </label>
                  <input
                    id="edit-sale-sell"
                    type="number"
                    min={0}
                    required
                    value={editSaleSellPrice}
                    onChange={(e) => setEditSaleSellPrice(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[#16235C] border border-white/15 rounded text-xs font-mono-tabular text-white"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-cost" className="block text-[10px] font-semibold uppercase text-slate-300 mb-1">
                    Cost / Unit
                  </label>
                  <input
                    id="edit-sale-cost"
                    type="number"
                    min={0}
                    required
                    value={editSaleCostPrice}
                    onChange={(e) => setEditSaleCostPrice(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[#16235C] border border-white/15 rounded text-xs font-mono-tabular text-white"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-sale-date" className="block text-[10px] font-semibold uppercase text-slate-300 mb-1">
                  Sale Date &amp; Time
                </label>
                <input
                  id="edit-sale-date"
                  type="datetime-local"
                  required
                  value={editSaleSoldAt}
                  onChange={(e) => setEditSaleSoldAt(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded text-xs text-white"
                />
              </div>

              <div>
                <label htmlFor="edit-sale-notes" className="block text-[10px] font-semibold uppercase text-slate-300 mb-1">
                  Notes
                </label>
                <input
                  id="edit-sale-notes"
                  type="text"
                  maxLength={250}
                  value={editSaleNotes}
                  onChange={(e) => setEditSaleNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded text-xs text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setEditingSale(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-300 bg-white/5 rounded-md cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={savingSaleEdit}
                  className="px-4 py-2 bg-[#c4d835] hover:bg-[#d4e157] text-[#0E1845] font-bold text-xs uppercase rounded-md cursor-pointer"
                >
                  {savingSaleEdit ? 'Updating...' : 'Save Sale Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: CANCEL SALE & RESTORE STOCK */}
      {cancellingSale && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cancel Sale Record"
          className="fixed inset-0 z-50 bg-[#070A14]/85 flex items-center justify-center p-4"
          onClick={() => !submittingCancelSale && setCancellingSale(null)}
        >
          <div
            className="bg-[#0C153B] border border-rose-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl text-white space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                <div>
                  <h3 className="font-display text-base font-bold uppercase text-white">
                    Cancel Sale #{cancellingSale.id}
                  </h3>
                  <p className="text-xs text-slate-300">
                    Restores <strong>{cancellingSale.quantity}</strong> units of{' '}
                    <strong>{cancellingSale.product_name}</strong> back to inventory.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close cancel modal"
                onClick={() => setCancellingSale(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleConfirmCancelSale(e)} className="space-y-4">
              <div>
                <label htmlFor="cancel-sale-reason" className="block text-[11px] font-semibold uppercase text-slate-300 mb-1">
                  Cancellation Reason (Recorded in Audit Log)
                </label>
                <input
                  id="cancel-sale-reason"
                  type="text"
                  maxLength={200}
                  value={cancelSaleReason}
                  onChange={(e) => setCancelSaleReason(e.target.value)}
                  placeholder="e.g. Wrong quantity entered / Order cancelled"
                  className="w-full px-3 py-2 bg-[#16235C] border border-white/15 rounded-md text-xs text-white focus:outline-none focus:border-rose-400"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setCancellingSale(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-300 bg-white/5 rounded-md cursor-pointer"
                >
                  Keep Sale
                </button>
                <button
                  type="submit"
                  disabled={submittingCancelSale}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase rounded-md cursor-pointer"
                >
                  {submittingCancelSale ? 'Cancelling...' : 'Confirm Cancel & Restore Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
