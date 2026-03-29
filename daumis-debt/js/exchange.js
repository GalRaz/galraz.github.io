// Exchange rate cache — avoids repeated API calls in a single session
const rateCache = {};

/**
 * Get exchange rate from a currency to USD.
 * Uses frankfurter.app (ECB data, free, no API key).
 * Returns the rate (multiply by this to get USD).
 * For USD → USD, returns 1.
 * Note: BTN is pegged 1:1 to INR. frankfurter.app doesn't support BTN,
 * so we use INR rate as a proxy.
 */
export async function getExchangeRate(currency) {
  if (currency === 'USD') return 1;

  const cacheKey = currency;
  if (rateCache[cacheKey]) return rateCache[cacheKey];

  // BTN (Bhutanese Ngultrum) is pegged 1:1 to INR
  const queryCurrency = currency === 'BTN' ? 'INR' : currency;

  const response = await fetch(
    `https://api.frankfurter.app/latest?from=${queryCurrency}&to=USD`
  );

  if (!response.ok) {
    throw new Error(`Exchange rate fetch failed for ${currency}`);
  }

  const data = await response.json();
  const rate = data.rates.USD;
  rateCache[cacheKey] = rate;
  return rate;
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
