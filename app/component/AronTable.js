const template = `
<table>
    <thead>
        <tr class="header-row"></tr>
    </thead>
    <tbody class="table-body"></tbody>
</table>
`

class AronTable extends HTMLElement {

    constructor() {
        super();

        // Attach a shadow root to the element.
        const shadow = this.attachShadow({ mode: 'open' });

        // Define the inner structure and styles of the component.
        shadow.innerHTML = template;
    }

    connectedCallback() {
        // Update the content when the component is attached to the DOM.
        this.updateContent();
    }

    // static get observedAttributes() {
    //     return ['title', 'description'];
    // }

    attributeChangedCallback(name, oldValue, newValue) {
        // Update the content when attributes change.
        this.updateContent();
    }

    updateContent() {
        // const title = this.getAttribute('title') || '';
        // const description = this.getAttribute('description') || '';
        // this.shadowRoot.querySelector('.title').textContent = title;
        // this.shadowRoot.querySelector('.description').textContent = description;
    }

    loadData(keys, list) {
        // Loadings Headers
        const header_row = this.shadowRoot.querySelector('.header-row');
        header_row.replaceChildren();
        
        for (const key of keys) {
            console.log(key);
            header_row.insertCell().textContent = key[0]
        }

        // Loading Rows
        const table_body = this.shadowRoot.querySelector('.table-body');
        table_body.replaceChildren();

        for (const e of list) {
            const row = table_body.insertRow();

            let i = 0;
            for (const key of keys) {

                let content = e[key[1]];

                if (key[1] === 'edit') {
                    row.insertCell().innerHTML = `<a href="${key[2]}.html?id=${e.id}">Edit</a>`;
                    continue;
                }
                
                else if (key[2] === 'date') {
                    content = new Date(e[key[1]]).toLocaleDateString() || 'Ongoing';
                }
                
                row.insertCell().textContent = content;
                i++;
            }
        }
    }
}

// Define the new element
customElements.define('aron-table', AronTable);