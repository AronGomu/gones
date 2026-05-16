export function renderBackButton() {
  return `
    <nav class="bottom-nav" aria-label="Page navigation">
      <button class="button-secondary min-h-[52px] gap-3 px-6 py-3 text-lg" type="button" data-action="go-back" data-cy="back-button"><span aria-hidden="true">←</span> Back</button>
    </nav>
  `;
}

export function bindBackButton({ fallbackHref = "leagues.html" } = {}) {
  document.querySelectorAll("[data-action='go-back']").forEach((button) => {
    button.addEventListener("click", () => {
      if (history.length > 1) {
        history.back();
        return;
      }
      location.href = fallbackHref;
    });
  });
}
