export function getUrlParams(key) {
	const url_params = new URLSearchParams(window.location.search);
	return url_params.get(key);
}