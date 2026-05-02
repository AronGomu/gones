import { html } from "../library/lit";


class Alert {
	id
	title
	description = null;
	severity = 'info' | 'warning' | 'error'

	constructor(id, title, description, severity) {
		this.id = id
		this.title = title
		this.description = description
		this.severity = severity
	}
	
}

class QualityAlertList extends LitElement {
	static properties = {
		alert_list: [],
		
	}

	// can swap styles based on severity
	static styles = css`
		.info {
			color: blue
		}

		. warning {
			color: orange
		}

		.error {
			color: red
		}
	`
p
	constructor(alert_list) {
		super();
		this.alert_list = alert_list;
		
	}

	render() {
		return html`
			<ul>
			${this.alert_list.map(alert => html `
				<li class="severity">
					<div>${alert.title}</div>
					<div>${alert.description}</div>
					<button 
						class="${alert.severity}"
						@click=${this.traiterAlert}
					>Traiter</button>
				</li>
			`)}
			</ul>
		`;
	}

	traiterAlert(e) {
		console.log(e);
	}

}