export function getUrlParams(key) {
	const url_params = new URLSearchParams(window.location.search);
	return url_params.get(key);
}

export function saveToLocal(key, o) {
	localStorage.setItem(key, JSON.stringify(o))
	console.log('Item saved in local Storage', o)
	return o
}

/** Converts a Date object to a YYYY-MM-DD string (for <input type="date">).
 * @param {Date} date - The Date object to convert
 * @returns {string} Date formatted as YYYY-MM-DD
 */
export function YYYYMMDD(date) {
	if (!date || !date.toISOString() || !date.toISOString().split('T')) return null;
	return date.toISOString().split('T')[0]
}

export function deepCopySimpleObject(o) {
	return JSON.parse(JSON.stringify(o))
}

export function trunc4(n) {
  return ((n * 10000) | 0) / 10000;
}
