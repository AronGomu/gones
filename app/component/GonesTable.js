const template = `
<span id="table_title"></span>
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

    static get observedAttributes() {
        return ['title', 'row_list'];
    }

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

    build(table_title, header_list, id_list, type_list, row_list) {
        this.title = table_title
        this.header_list = header_list
        this.id_list = id_list
        this.type_list = type_list
        this.row_list = row_list

        // Loadings Headers //
        const header_row = this.shadowRoot.querySelector('.header-row')
        header_row.replaceChildren()
        for (const header of header_list) header_row.insertCell().textContent = header
        // Loadings Headers //

        // Loading Rows
        const table_body = this.shadowRoot.querySelector('.table-body')
        table_body.replaceChildren()

        for (let i = 0; i < row_list.length; i++) {
            const row = row_list[i];
            const row_index = i;

            const tr = table_body.insertRow();

            for (let i = 0; i < id_list.length; i++) {
                const id = id_list[i];
                const type = type_list[i]
                const content = row[id]

                if (type === 'edit') {
                    const edit_id = `${this.title}_${row_index}_edit`
                    const cell = tr.insertCell()
                    cell.innerHTML = `<button id="${edit_id}" >Edit</button>`
                    const edit_button = cell.querySelector('button')
                    edit_button.addEventListener('click', () => this.edit(row_index))
                    continue
                }
                else if (type === 'date') {
                    const localDate = new Date(row[id]).toLocaleDateString()
                    if (localDate === 'Invalid Date') tr.insertCell().textContent = "N/A"
                    else tr.insertCell().textContent = localDate
                }
                else {
                    tr.insertCell().textContent = content;
                }
            }
        }
    }

    edit(row_index) {
        this.dispatchEvent(new CustomEvent('edit-row', {
            bubbles:  true,
            composed: true,
            detail: {
                row: this.row_list[row_index],
                row_index
            }
        }))
    }
}

// Define the new element
customElements.define('gones-table', GonesTable);