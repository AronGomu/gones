import { LitElement, html, css } from '../library/lit.js';

export class MainButton extends LitElement {
	static properties = {
		name: {},
	};

	static styles = css`
		:host {
			color: blue
		}
	`

	constructor() {
		super();
		this.name = 'World';
	}

	render() {
		return html `<p>Hello, ${this.name} !</p>`;
	}
}
customElements.define('main-button', MainButton);