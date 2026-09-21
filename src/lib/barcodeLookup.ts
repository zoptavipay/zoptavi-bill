/**
 * Best-effort online lookup of a product name from its barcode, using Open Food Facts'
 * free, keyless, CORS-enabled public database. This only covers products someone has
 * already contributed to that database (mostly larger/branded FMCG items) — many local
 * or in-house Indian products simply won't be found, which is expected, not a bug.
 * Returns null on no match, no internet, or any error — callers should fall back to
 * manual entry silently.
 */
export async function lookupBarcodeOnline(barcode: string): Promise<{ name: string; brand?: string } | null> {
  if (!navigator.onLine) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const name: string | undefined = data.product.product_name || data.product.product_name_en;
    if (!name) return null;
    return { name, brand: data.product.brands };
  } catch {
    return null;
  }
}
