export function getUrlParams(key) {
	const url_params = new URLSearchParams(window.location.search);
	return url_params.get(key);
}

export function saveToLocal(key, o) {
	const j = JSON.stringify(o)
	localStorage.setItem(key, j)
	console.log('Saved in local Storage', o)
	return o
}