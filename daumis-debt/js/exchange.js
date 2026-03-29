// Exchange rate cache — avoids repeated API calls in a single session
const rateCache = {};
const LS_KEY = 'daumis-debt-rates';

// Load saved rates from localStorage
function loadSavedRates() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return {};
}

function saveRates() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rateCache));
  } catch (e) {}
}

/**
 * Get exchange rate from a currency to USD.
 * Uses frankfurter.app (ECB data, free, no API key).
 * Returns the rate (multiply by this to get USD).
 * For USD → USD, returns 1.
 * Note: BTN is pegged 1:1 to INR. frankfurter.app doesn't support BTN,
 * so we use INR rate as a proxy.
 * Falls back to localStorage-cached rates when offline.
 */
export async function getExchangeRate(currency) {
  if (currency === 'USD') return 1;

  const cacheKey = currency;
  if (rateCache[cacheKey]) return rateCache[cacheKey];

  // BTN (Bhutanese Ngultrum) is pegged 1:1 to INR
  const queryCurrency = currency === 'BTN' ? 'INR' : currency;

  // Try frankfurter.app first (ECB data, supports most major currencies)
  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${queryCurrency}&to=USD`
    );
    if (response.ok) {
      const data = await response.json();
      const rate = data.rates.USD;
      rateCache[cacheKey] = rate;
      saveRates();
      return rate;
    }
  } catch (e) {
    // Fall through to backup API
  }

  // Fallback: open.er-api.com (supports TWD and other currencies frankfurter doesn't)
  try {
    const fallback = await fetch(`https://open.er-api.com/v6/latest/${queryCurrency}`);
    if (fallback.ok) {
      const fbData = await fallback.json();
      const rate = fbData.rates.USD;
      rateCache[cacheKey] = rate;
      saveRates();
      return rate;
    }
  } catch (e) {
    // Fall through
  }

  // Offline fallback: use last known rate from localStorage
  const savedRates = loadSavedRates();
  if (savedRates[cacheKey]) {
    rateCache[cacheKey] = savedRates[cacheKey];
    return savedRates[cacheKey];
  }

  throw new Error(`Exchange rate unavailable for ${currency} (offline with no cached rate)`);
}

/**
 * Convert an amount in a given currency to USD.
 * Returns { usdAmount, exchangeRate }.
 */
export async function convertToUSD(amount, currency) {
  const exchangeRate = await getExchangeRate(currency);
  return {
    usdAmount: Math.round(amount * exchangeRate * 100) / 100,
    exchangeRate
  };
}
