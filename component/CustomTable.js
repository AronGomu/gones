import { html } from "../library/lit";

class CustomTable extends LitElement {
	static properties = {
		header_list: {type: Array},
		data_list: {type: Array},
	}

	// can swap styles based on severity
	static styles = css``
p
	constructor() {
		super();
	}

	render() {
		return html`
			<table>
				<thead>
					<tr class="header-row">
						${this.name_list.map(name => html `<th>${name}</th>`)}
					</tr>
				</thead>
				<tbody class="table-body">
					${this.id_list.map((id, index) => html `
						<tr>
							${this.data_list[index].map((data) => html `<td>${data}</td>`)}
						</tr>
					`)}
				</tbody>
			</table>
		`;
	}

	traiterAlert(e) {
		console.log(e);
	}

}