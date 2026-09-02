# T4: Event Markdown and public media

**Plan:** `./artifacts/PLAN_2026_08_31_event_editor_images_markdown.md`
**Depends:** T1, T3
**Commit outcome:** Event detail responses derive safe HTML from canonical Markdown and render ordered EventOwned hero/gallery imgs with exact preview reuse, alt fallback, responsive geometry, and accessible lightbox.

## Context (self-contained)

- C1. Goal: Markdown description authoring + imgs separate from description; public detail is fidelity authority for live preview.
- C2. This slice: reset schema `body_html`→`body_markdown`, transition every existing create/edit/proposal writer to `bodyMarkdown` while current preview-ticket flow still exists, paired renderer parity, sanitizer allowlist, public detail render shape, actual Event detail hero/gallery/lightbox.
- C3. Out of scope here: direct-publication flow, proposal image promotion/token media response, split editor shell.
- C4. Assumptions: public list/catalog excludes imgs; detail/preview only; null alt fallback uses display title + 1-based position.

## Requirements

- R1. Reset-required migration drops `body_html`, adds nullable `body_markdown` max 20,000; fixtures convert authored descriptions to Markdown manually, not HTML reverse conversion.
- R2. In same commit, replace `bodyHtml` with `bodyMarkdown` through current `EventPayloadRequest`, `UpdateEventDetailsRequest`, `EventManagementResponse`, proposal stored payload/review, Angular draft/mappers, notifications, API client, tests. Existing preview-ticket flow remains green until T5 removes it.
- R3. Backend Markdig pipeline: CommonMark + pipe tables/task lists/strikethrough/autolinks only; disable raw HTML/img nodes; map source h1/h2/h3+ to output h2/h3/h4.
- R4. Frontend `marked` config matches R3; shared fixture corpus has supported constructs + attacks; normalized TS/C# HTML must match.
- R5. Server sanitizer + client defense allow exactly: `p,br,strong,em,ul,ol,li,h2,h3,h4,a,blockquote,pre,code,hr,table,thead,tbody,tr,th,td,del,input`; `input` only `type=checkbox`, `disabled`, optional `checked`; links HTTP(S)/root-relative.
- R6. Public Event detail response adds ordered `images`; list/all-catalog responses remain image-free.
- R7. `EventDetailViewComponent` renders first img full-width 16:9 `object-fit: contain`, neutral themed backdrop; rest 3 cols desktop/1 col mobile.
- R8. Lightbox is accessible dialog: focus trap; Escape close; ArrowLeft/ArrowRight nav; close restores trigger focus.
- R9. Null alt exact fallback: `{displayTitle} — image {1-based position}`. User alt max 300.
- R10. Actual `EventDetailViewComponent` accepts draft placeholder mode for later T5: muted placeholders only for missing required draft values; public mode never shows placeholders.
- R11. Add OpenAPI/client/fixture changes now; run publication/lifecycle/proposal suites so no `bodyHtml` writer survives.

## Inputs

- I1. `backend/src/Gones.Domain/Calendar/Event.cs:110-111,128,305-306,474` current body fields/sanitizer.
- I2. `backend/src/Gones.Infrastructure/Persistence/EventRecordConfigurations.cs:16-24` body mapping.
- I3. `backend/src/Gones.Api/Events/PublicEventEndpoints.cs:635-677` public response shapes.
- I4. `src/app/features/events/event-detail-view.component.ts:15-31` shared detail template.
- I5. `src/app/features/events/server-sanitized-html.component.ts:9-10` current narrow client allowlist.
- I6. **From Depends:** T1/T3 contracts copied below; do not redesign.
- I7. T1 provides `marked@18.0.11`, `Markdig@1.3.2` pins.
- I8. T3 provides:

```ts
interface EventImageVariantResponse { width: number; height: number; url: string; }
```

```http
GET /api/event-images/{id}/variants/{width} -> image/webp
```

`EventImage.State == EventOwned` permits anonymous read with `Cache-Control: public,max-age=31536000,immutable` + `ETag`; imgs order by contiguous `sort_order`.

## Interface contract (level 5)

- **Produces:**

```csharp
public interface IEventMarkdownRenderer
{
    string RenderAndSanitize(string markdown);
}
```

```ts
interface EventImageResponse {
  id: string;
  altText: string | null;
  variants: Array<{ width: number; height: number; url: string }>;
}
interface PublicEventDetailResponse {
  // existing fields unchanged except bodyHtml remains derived response
  bodyHtml?: string;
  images: EventImageResponse[];
}
interface EventPreviewRenderResponse {
  // same render fields as public detail
  bodyHtml?: string;
  images: EventImageResponse[];
}
```

```text
Allowed tags: p br strong em ul ol li h2 h3 h4 a blockquote pre code hr table thead tbody tr th td del input
Allowed attrs: a[href,target,rel]; input[type=checkbox,disabled,checked]
Allowed href: ^https?:// or ^/
```

- **Consumes:** `Event.BodyMarkdown`; EventOwned imgs ordered by `SortOrder`; T3 variant route.
- **Errors:** malformed Markdown never executes HTML; unsupported raw HTML/img nodes render as readable text or are omitted consistently per golden fixture; missing img variant returns existing route `404` without breaking surrounding detail.
- **Invariants:** DB/wire authoring source is Markdown only; `bodyHtml` exists only as derived render response; every current create/edit/proposal writer remains green before T5; frontend/backend normalized HTML parity; public list responses have no `images`; public detail order stable; public UI uses actual response, draft placeholder mode explicit.
- **Integration links:** Event row `body_markdown` → `IEventMarkdownRenderer` → `PublicEventDetailResponse.bodyHtml` → defense-in-depth component; EventOwned rows → response `images` → `EventDetailViewComponent` → variant route/S3; same component → T5 live preview.

## TDD

1. **Red** — golden parser/sanitizer corpus, schema/API response tests, DOM/lightbox/a11y tests.
2. **Green** — min renderer/schema/response/component.
3. **Refactor** — share detail media renderer between public/draft mode only.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| GFM-safe extensions | table/task/del/autolink | exact normalized TS/C# HTML match |
| Attacks | raw HTML, `javascript:`, Markdown img | stripped/disabled; no executable output |
| Heading map | h1..h6 | h2,h3,h4 cap |
| Detail imgs | 4 ordered EventOwned | hero first + gallery next 3; stable order |
| Null alt | display title + pos 2 | exact `Title — image 2` |
| Public catalog | same Event | no image data |
| Lightbox | keyboard flow | trap/nav/Escape/restore focus |
| Existing writers | current preview/create/edit/proposal with `bodyMarkdown` | all serialize/round-trip Markdown; no `bodyHtml` write property |
| Draft mode | missing title/location | muted placeholders; public mode none |

## Impl steps

- [x] 1. Add failing cross-stack Markdown golden fixtures/tests. Verify: targeted backend/frontend Markdown tests fail before production implementation.
- [x] 2. Add failing reset migration/domain/public API tests. Verify: targeted schema/domain/public API tests fail before production implementation.
- [x] 3. Add failing Event detail media/lightbox DOM+a11y tests. Verify: `npm run test -- --run src/app/features/events/event-detail-view.component.test.ts` fails before component implementation.
- [x] 4. Implement Markdown storage/render/sanitize + transition every current create/edit/proposal writer. Verify: targeted backend Markdown/publication/lifecycle/proposal tests pass and `rg 'BodyHtml|bodyHtml'` finds authoring use only in derived response/render sites.
- [x] 5. Implement hero/gallery/lightbox + draft placeholder input. Verify: `npm run test -- --run src/app/features/events/event-detail-view.component.test.ts` passes hero/gallery/alt/keyboard/focus/draft assertions.
- [x] 6. Update fixtures/OpenAPI/client/styles/i18n now; prove current preview-ticket flow remains green. Verify: `npm run api:generate && npm run api:check` plus targeted frontend create/edit/proposal tests pass.
- [x] 7. Run gates. Verify: every command and observable check under Validation passes.

## Validation

- [x] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventMarkdown|FullyQualifiedName~PublicEvent|FullyQualifiedName~EventPublication|FullyQualifiedName~EventLifecycle|FullyQualifiedName~EventProposal"`
- [x] `npm run test -- --run src/app/features/events/server-sanitized-html.test.ts src/app/features/events/event-detail-view.component.test.ts src/app/features/events/organizer-event-create.test.ts src/app/features/events/event-management.test.ts src/app/features/events/event-proposal-submit.test.ts`
- [x] `npm run api:generate && npm run api:check`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] manual check: hero contain behavior, 3→1 column breakpoint, complete keyboard lightbox path
- [x] no silent-failure swallow on added path — `none`
- [x] app functional — public detail renders safe Markdown/imgs; Event catalog payload remains image-free
- [x] commit msg draft: `feat(events): make Markdown and ordered media canonical on Event detail`
