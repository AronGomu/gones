export function loadRows(table, list, keys) {

	console.log("loadRows", table, list, keys);
	
	
	table.replaceChildren();

	for (const e of list) {
		const row = table.insertRow();

		let i = 0;
		for (const key of keys) {

			let content = e[key[0]];

			if (key[0] === 'edit') {
				row.insertCell().innerHTML = `<a href="${key[1]}.html?id=${e.id}">Edit</a>`;
				continue;
			}
			
			else if (key[1] === 'date') {
				content = new Date(e[key[0]]).toLocaleDateString() || 'Ongoing';
			}
			
			row.insertCell().textContent = content;
			i++;
		}
	}

	return "END loadRows";
}

export function getUrlParams(key) {
	const url_params = new URLSearchParams(window.location.search);
	return url_params.get(key);
}

