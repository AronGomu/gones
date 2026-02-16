import {LitElement, html, css} from '../library/lit.js';

class SimpleToggle extends LitElement {
  static properties = { active: { type: Boolean } };

  static styles = css`
    button {
      padding: 1em 2em;
      font-size: 1.2rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      color: white;
      transition: 0.3s;
    }
    button[active] { background: #28a745; }
    button:not([active]) { background: #dc3545; }
  `;

  render() {
    return html`
      HELLO ?
      <button ?active=${this.active} @click=${this._toggle}>
        ${this.active ? "Allumé" : "Éteint"}
      </button>
    `;
  }

  _toggle() {
    this.isActive = !this.isActive;
    this.active = this.isActive;

    // Dispatch a custom event that anyone can listen to
    this.dispatchEvent(new CustomEvent('toggle-button-clicked', {
      bubbles: true,          // let it bubble up through the DOM
      composed: true,         // cross shadow DOM boundary
      cancelable: true,
      detail: {
        active: this.isActive,     // current state after toggle
        previous: !this.isActive,  // optional: state before toggle
        element: this              // optional: reference to the component
      }
    })); 
  }
}

customElements.define('simple-toggle', SimpleToggle);