const template = `
<table>
    <thead>
        <tr class="header-row"></tr>
    </thead>
    <tbody class="table-body"></tbody>
</table>
`

class GonesTable extends HTMLElement {

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

    loadData(header_list, id_list, type_list, row_list) {
        console.log(id_list, id_list, header_list, row_list);
        

        // Loadings Headers
        const header_row = this.shadowRoot.querySelector('.header-row');
        header_row.replaceChildren();
        
        for (const header of header_list) {
            header_row.insertCell().textContent = header
        }

        // Loading Rows
        const table_body = this.shadowRoot.querySelector('.table-body');
        table_body.replaceChildren();

        for (const row of row_list) {
            const tr = table_body.insertRow();

            for (let i = 0; i < id_list.length; i++) {
                const id = id_list[i];
                const type = type_list[i]
                const content = row[id]
                

                if (type === 'edit') {
                    tr.insertCell().innerHTML = `<a href="${id[2]}.html?id=${tr.id}">Edit</a>`;
                    continue;
                }
                else if (type === 'date') {
                    tr.insertCell().textContent = new Date(tr[id]).toLocaleDateString() || 'Ongoing';
                }
                else {
                    tr.insertCell().textContent = content;
                }
            }
        }
    }
}

// Define the new element
customElements.define('gones-table', GonesTable);