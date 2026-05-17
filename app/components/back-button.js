export function renderBackButton() {
  return `
    <nav class="bottom-nav" aria-label="Page navigation">
      <button class="button-secondary min-h-[64px] gap-3 px-8 py-4 text-xl" type="button" data-action="go-back" data-cy="back-button"><svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path></svg> Back</button>
    </nav>
  `;
}

export function renderBackButtonsAround(content) {
  return `${renderBackButton()}${content}${renderBackButton()}`;
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
